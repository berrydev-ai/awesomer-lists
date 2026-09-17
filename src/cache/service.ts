import type { RepositoryMetadata, RepositoryRef } from "../domain/types";
import {
  fetchRepositoryMetadataBatch,
  isGitHubClientError,
} from "../github/client";
import type { ParsedMetadataResponse, RateLimitInfo } from "../github/graphql";
import type { LocalCacheStatus, MetadataLoadResult } from "../messages";

const CACHE_PREFIX = "metadata.";
const CONTROL_PREFIX = "cache.metadata.";
const RATE_LIMIT_PREFIX = `${CONTROL_PREFIX}rateLimit.`;
const RECORD_VERSION = 1;
const BATCH_SIZE = 20;
const FRESH_MILLISECONDS = 6 * 60 * 60 * 1_000;
const RETENTION_MILLISECONDS = 30 * 24 * 60 * 60 * 1_000;
const NEGATIVE_MILLISECONDS = 15 * 60 * 1_000;
const DEFAULT_MAX_BYTES = 25 * 1024 * 1024;
const MAX_CONCURRENT_REQUESTS = 2;
const REQUEST_PACE_MILLISECONDS = 25;

export interface MetadataStorageArea {
  get(keys?: string | string[] | null): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(keys: string | string[]): Promise<void>;
}

export type MetadataBatchFetcher = (
  repositories: readonly RepositoryRef[],
  token: string,
) => Promise<ParsedMetadataResponse>;

export interface MetadataServiceOptions {
  storage: MetadataStorageArea;
  fetchBatch?: MetadataBatchFetcher;
  now?: () => number;
  /** Allows focused tests to exercise eviction without allocating 25 MiB. */
  maxBytes?: number;
}

export interface MetadataLoadOptions {
  repositories: RepositoryRef[];
  refresh: boolean;
  token: string | null;
  onProgress: (result: MetadataLoadResult) => void;
  isCancelled?: () => boolean;
}

export interface MetadataService {
  load(options: MetadataLoadOptions): Promise<MetadataLoadResult>;
  status(): Promise<LocalCacheStatus>;
  clear(): Promise<LocalCacheStatus>;
}

interface MetadataCacheRecord {
  v: typeof RECORD_VERSION;
  value: RepositoryMetadata;
  accessedAt: number;
}

interface MissingCacheRecord {
  v: typeof RECORD_VERSION;
  missing: true;
  nameWithOwner: string;
  fetchedAt: number;
  accessedAt: number;
}

type CacheRecord = MetadataCacheRecord | MissingCacheRecord;

interface RepositoryOutcome {
  metadata: RepositoryMetadata | null;
  missing: boolean;
  rateLimit: RateLimitInfo | null;
}

interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T): void;
  reject(reason: unknown): void;
}

interface FetchStartGuardError extends Error {
  code: "LOAD_CANCELLED" | "RATE_PAUSED";
  retryAt?: number;
}

interface RequestCoordinator {
  inFlightByToken: Map<string, Map<string, Promise<RepositoryOutcome>>>;
  recentByToken: Map<
    string,
    Map<
      string,
      { outcome: RepositoryOutcome; expiresAt: number; settledAt: number }
    >
  >;
  activeRequests: number;
  lastRequestStartedAt: number;
  requestWaiters: Array<() => void>;
}

function cacheKey(nameWithOwner: string): string {
  return `${CACHE_PREFIX}${nameWithOwner.toLowerCase()}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isIsoTimestamp(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function isCount(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function isRepositoryName(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length <= 201 &&
    /^[-A-Za-z0-9_.]+\/[-A-Za-z0-9_.]+$/.test(value)
  );
}

function parseMetadata(value: unknown): RepositoryMetadata | null {
  if (!isRecord(value)) return null;

  if (
    !isRepositoryName(value.nameWithOwner) ||
    value.url !== `https://github.com/${value.nameWithOwner}` ||
    !isNullableString(value.description) ||
    (typeof value.description === "string" && value.description.length > 10_000) ||
    !isCount(value.stars) ||
    !isCount(value.forks) ||
    !isCount(value.openIssues) ||
    !isNullableString(value.lastCommitAt) ||
    (value.lastCommitAt !== null && !isIsoTimestamp(value.lastCommitAt)) ||
    !isNullableString(value.license) ||
    (typeof value.license === "string" && value.license.length > 100) ||
    typeof value.isArchived !== "boolean" ||
    !isIsoTimestamp(value.fetchedAt)
  ) {
    return null;
  }

  return {
    nameWithOwner: value.nameWithOwner,
    url: value.url,
    description: value.description,
    stars: value.stars,
    forks: value.forks,
    openIssues: value.openIssues,
    lastCommitAt: value.lastCommitAt,
    license: value.license,
    isArchived: value.isArchived,
    fetchedAt: value.fetchedAt,
  };
}

function parseCacheRecord(
  value: unknown,
  expectedNameWithOwner: string,
): CacheRecord | null {
  if (!isRecord(value)) return null;

  if (
    value.v === RECORD_VERSION &&
    value.missing === true &&
    isRepositoryName(value.nameWithOwner) &&
    typeof value.fetchedAt === "number" &&
    Number.isFinite(value.fetchedAt) &&
    typeof value.accessedAt === "number" &&
    Number.isFinite(value.accessedAt)
  ) {
    if (value.nameWithOwner.toLowerCase() !== expectedNameWithOwner.toLowerCase()) {
      return null;
    }
    return {
      v: RECORD_VERSION,
      missing: true,
      nameWithOwner: value.nameWithOwner,
      fetchedAt: value.fetchedAt,
      accessedAt: value.accessedAt,
    };
  }

  const metadata = parseMetadata(value.value);
  if (!metadata) return null;
  if (metadata.nameWithOwner.toLowerCase() !== expectedNameWithOwner.toLowerCase()) {
    return null;
  }

  if (
    value.v === RECORD_VERSION &&
    typeof value.accessedAt === "number" &&
    Number.isFinite(value.accessedAt)
  ) {
    return { v: RECORD_VERSION, value: metadata, accessedAt: value.accessedAt };
  }

  // Migrate the original `{ value, expiresAt }` shape. Freshness always comes
  // from the public record's fetchedAt, so migration cannot make old data new.
  if (typeof value.expiresAt === "number" && Number.isFinite(value.expiresAt)) {
    return {
      v: RECORD_VERSION,
      value: metadata,
      accessedAt: Math.min(value.expiresAt, Date.parse(metadata.fetchedAt)),
    };
  }

  return null;
}

function fetchedAt(record: CacheRecord): number {
  return "missing" in record
    ? record.fetchedAt
    : Date.parse(record.value.fetchedAt);
}

function isRetained(record: CacheRecord, currentTime: number): boolean {
  const age = currentTime - fetchedAt(record);
  if (age < 0) return false;
  return "missing" in record
    ? age <= NEGATIVE_MILLISECONDS
    : age <= RETENTION_MILLISECONDS;
}

function isFresh(record: MetadataCacheRecord, currentTime: number): boolean {
  const age = currentTime - Date.parse(record.value.fetchedAt);
  return age >= 0 && age <= FRESH_MILLISECONDS;
}

function sameCachedValue(left: CacheRecord, right: CacheRecord): boolean {
  if ("missing" in left || "missing" in right) {
    return (
      "missing" in left &&
      "missing" in right &&
      left.nameWithOwner.toLowerCase() === right.nameWithOwner.toLowerCase() &&
      left.fetchedAt === right.fetchedAt
    );
  }
  return (
    left.value.nameWithOwner.toLowerCase() ===
      right.value.nameWithOwner.toLowerCase() &&
    left.value.fetchedAt === right.value.fetchedAt
  );
}

function encodedBytes(key: string, value: unknown): number {
  return new TextEncoder().encode(JSON.stringify({ [key]: value })).byteLength;
}

function ownedKey(key: string): boolean {
  return key.startsWith(CACHE_PREFIX) || key.startsWith(CONTROL_PREFIX);
}

function cacheEntryKey(key: string): boolean {
  return key.startsWith(CACHE_PREFIX);
}

function makeDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function tokenScope(token: string): Promise<string> {
  const bytes = new TextEncoder().encode(token);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest).slice(0, 16), (value) =>
    value.toString(16).padStart(2, "0"),
  ).join("");
}

async function waitForRequestSlot(state: RequestCoordinator): Promise<void> {
  if (state.activeRequests >= MAX_CONCURRENT_REQUESTS) {
    await new Promise<void>((resolve) => state.requestWaiters.push(resolve));
  }

  state.activeRequests += 1;
  const wait = Math.max(
    0,
    state.lastRequestStartedAt + REQUEST_PACE_MILLISECONDS - Date.now(),
  );
  if (wait > 0) {
    await new Promise((resolve) => setTimeout(resolve, wait));
  }
  state.lastRequestStartedAt = Date.now();
}

function releaseRequestSlot(state: RequestCoordinator): void {
  state.activeRequests -= 1;
  state.requestWaiters.shift()?.();
}

async function scheduledFetch(
  repositories: readonly RepositoryRef[],
  token: string,
  fetchBatch: MetadataBatchFetcher,
  state: RequestCoordinator,
  beforeStart: () => Promise<void>,
): Promise<ParsedMetadataResponse> {
  await waitForRequestSlot(state);
  try {
    await beforeStart();
    return await fetchBatch(repositories, token);
  } finally {
    releaseRequestSlot(state);
  }
}

async function fetchWithDeduplication(
  repositories: readonly RepositoryRef[],
  token: string,
  scope: string,
  fetchBatch: MetadataBatchFetcher,
  requestStartedAt: number,
  state: RequestCoordinator,
  isCurrentGeneration: () => boolean,
  beforeStart: () => Promise<void>,
): Promise<RepositoryOutcome[]> {
  let tokenRequests = state.inFlightByToken.get(scope);
  if (!tokenRequests) {
    tokenRequests = new Map();
    state.inFlightByToken.set(scope, tokenRequests);
  }

  const promises: Promise<RepositoryOutcome>[] = [];
  const claimed: RepositoryRef[] = [];
  const claimedDeferred = new Map<string, Deferred<RepositoryOutcome>>();
  const recent = state.recentByToken.get(scope);

  for (const repository of repositories) {
    const key = repository.nameWithOwner.toLowerCase();
    const existing = tokenRequests.get(key);
    if (existing) {
      promises.push(existing);
      continue;
    }
    const recentResult = recent?.get(key);
    if (
      recentResult &&
      recentResult.expiresAt > Date.now() &&
      requestStartedAt <= recentResult.settledAt
    ) {
      promises.push(Promise.resolve(recentResult.outcome));
      continue;
    }

    const deferred = makeDeferred<RepositoryOutcome>();
    claimed.push(repository);
    claimedDeferred.set(key, deferred);
    tokenRequests.set(key, deferred.promise);
    promises.push(deferred.promise);
  }

  if (claimed.length > 0) {
    void scheduledFetch(claimed, token, fetchBatch, state, beforeStart)
      .then((result) => {
        const metadata = new Map(
          result.metadata.map((item) => [
            item.nameWithOwner.toLowerCase(),
            item,
          ]),
        );
        const missing = new Set(result.missing.map((name) => name.toLowerCase()));

        for (const repository of claimed) {
          const key = repository.nameWithOwner.toLowerCase();
          const item = metadata.get(key);
          const deferred = claimedDeferred.get(key);
          if (!deferred) continue;

          if (item) {
            const outcome = { metadata: item, missing: false, rateLimit: result.rateLimit };
            deferred.resolve(outcome);
            if (isCurrentGeneration()) rememberRecent(state, scope, key, outcome);
          } else if (missing.has(key)) {
            const outcome = { metadata: null, missing: true, rateLimit: result.rateLimit };
            deferred.resolve(outcome);
            if (isCurrentGeneration()) rememberRecent(state, scope, key, outcome);
          } else {
            deferred.reject(new Error("GitHub returned an incomplete metadata batch."));
          }
        }
      })
      .catch((error: unknown) => {
        for (const deferred of claimedDeferred.values()) deferred.reject(error);
      })
      .finally(() => {
        const current = state.inFlightByToken.get(scope);
        if (current !== tokenRequests) return;
        for (const repository of claimed) {
          current?.delete(repository.nameWithOwner.toLowerCase());
        }
        if (current?.size === 0) state.inFlightByToken.delete(scope);
      });
  }

  return Promise.all(promises);
}

function rememberRecent(
  state: RequestCoordinator,
  scope: string,
  key: string,
  outcome: RepositoryOutcome,
): void {
  let recent = state.recentByToken.get(scope);
  if (!recent) {
    recent = new Map();
    state.recentByToken.set(scope, recent);
  }
  const settledAt = Date.now();
  recent.set(key, { outcome, settledAt, expiresAt: settledAt + 1_000 });
  for (const [recentKey, value] of recent) {
    if (value.expiresAt <= Date.now()) recent.delete(recentKey);
  }
  if (recent.size === 0) state.recentByToken.delete(scope);
}

function uniqueRepositories(repositories: readonly RepositoryRef[]): RepositoryRef[] {
  const seen = new Set<string>();
  return repositories.filter((repository) => {
    const key = repository.nameWithOwner.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function warningMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message;
  return "Some repository metadata could not be refreshed.";
}

function rateLimitWarning(retryAt: number): string {
  return `GitHub rate limit reached. Try again after ${new Date(retryAt).toLocaleString()}.`;
}

function combineWarning(
  current: string | null,
  next: string | null,
): string | null {
  if (!next || next === current) return current;
  return current ? `${current} ${next}` : next;
}

function createFetchStartGuardError(
  code: FetchStartGuardError["code"],
  retryAt?: number,
): FetchStartGuardError {
  const message =
    code === "LOAD_CANCELLED"
      ? "Metadata loading was cancelled."
      : "GitHub rate limit pause became active.";
  return Object.assign(
    new Error(message),
    retryAt === undefined ? { code } : { code, retryAt },
  );
}

function isFetchStartGuardError(
  error: unknown,
): error is FetchStartGuardError {
  return (
    error instanceof Error &&
    "code" in error &&
    (error.code === "LOAD_CANCELLED" || error.code === "RATE_PAUSED")
  );
}

export function createMetadataService(
  options: MetadataServiceOptions,
): MetadataService {
  const now = options.now ?? Date.now;
  const fetchBatch = options.fetchBatch ?? fetchRepositoryMetadataBatch;
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const requestCoordinator: RequestCoordinator = {
    inFlightByToken: new Map(),
    recentByToken: new Map(),
    activeRequests: 0,
    lastRequestStartedAt: 0,
    requestWaiters: [],
  };
  let generation = 0;
  let mutationTail: Promise<void> = Promise.resolve();
  let cacheIndex: Map<string, { record: CacheRecord; bytes: number }> | null =
    null;
  let indexedBytes = 0;
  const ratePauses = new Map<string, number>();
  const initializedRateKeys = new Set<string>();

  function serialize<T>(mutation: () => Promise<T>): Promise<T> {
    const result = mutationTail.then(mutation, mutation);
    mutationTail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  async function removeAndSet(
    updates: Record<string, CacheRecord>,
    loadGeneration: number,
    touchOnly = false,
  ): Promise<string | null> {
    return serialize(async () => {
      if (loadGeneration !== generation) return null;
      try {
        const currentTime = now();
        const remove = new Set<string>();
        let baseline = cacheIndex;

        if (!baseline) {
          const stored = await options.storage.get(null);
          const rebuilt = new Map<
            string,
            { record: CacheRecord; bytes: number }
          >();
          for (const [key, value] of Object.entries(stored)) {
            if (key.startsWith(RATE_LIMIT_PREFIX)) {
              if (
                !isRecord(value) ||
                typeof value.retryAt !== "number" ||
                !Number.isFinite(value.retryAt) ||
                value.retryAt <= currentTime
              ) {
                remove.add(key);
              }
              continue;
            }
            if (!cacheEntryKey(key)) continue;
            const record = parseCacheRecord(
              value,
              key.slice(CACHE_PREFIX.length),
            );
            if (!record || !isRetained(record, currentTime)) {
              remove.add(key);
              continue;
            }
            rebuilt.set(key, { record, bytes: encodedBytes(key, record) });
          }
          baseline = rebuilt;
        }

        const nextIndex = new Map(baseline);
        const effectiveUpdates: Record<string, CacheRecord> = {};

        for (const [key, requested] of Object.entries(updates)) {
          if (!cacheEntryKey(key)) continue;
          let value = requested;
          if (touchOnly) {
            const current = nextIndex.get(key)?.record;
            if (!current || !sameCachedValue(current, requested)) continue;
            value = {
              ...current,
              accessedAt: Math.max(current.accessedAt, requested.accessedAt),
            } as CacheRecord;
          }
          const bytes = encodedBytes(key, value);
          nextIndex.set(key, { record: value, bytes });
          effectiveUpdates[key] = value;
        }

        let nextBytes = [...nextIndex.values()].reduce(
          (total, indexed) => total + indexed.bytes,
          0,
        );
        const byLeastRecent = [...nextIndex.entries()].sort(
          ([, left], [, right]) =>
            left.record.accessedAt - right.record.accessedAt,
        );
        while (nextBytes > maxBytes && byLeastRecent.length > 0) {
          const oldest = byLeastRecent.shift();
          if (!oldest) break;
          const [key, indexed] = oldest;
          nextIndex.delete(key);
          delete effectiveUpdates[key];
          remove.add(key);
          nextBytes -= indexed.bytes;
        }

        if (remove.size > 0) await options.storage.remove([...remove]);
        if (loadGeneration !== generation) {
          cacheIndex = null;
          indexedBytes = 0;
          return null;
        }

        try {
          await options.storage.set(effectiveUpdates);
          cacheIndex = nextIndex;
          indexedBytes = nextBytes;
          return null;
        } catch {
          // Storage can be full because of unrelated extension data. Evict
          // owned entries only, oldest first, and retry the compact batch.
          for (const [key, indexed] of byLeastRecent) {
            if (loadGeneration !== generation) {
              cacheIndex = null;
              indexedBytes = 0;
              return null;
            }
            await options.storage.remove(key);
            if (nextIndex.delete(key)) nextBytes -= indexed.bytes;
            delete effectiveUpdates[key];
            try {
              await options.storage.set(effectiveUpdates);
              cacheIndex = nextIndex;
              indexedBytes = nextBytes;
              return "Older cached repository data was removed to make room.";
            } catch {
              // Continue evicting only this cache.
            }
          }
          cacheIndex = null;
          indexedBytes = 0;
          return "Repository data loaded, but this device could not cache it.";
        }
      } catch (error) {
        cacheIndex = null;
        indexedBytes = 0;
        throw error;
      }
    });
  }

  async function readRequested(
    repositories: readonly RepositoryRef[],
    rateKey: string | null,
    loadGeneration: number,
  ): Promise<{
    records: Map<string, CacheRecord>;
    retryAt: number | null;
    warning: string | null;
  }> {
    try {
      await mutationTail;
      const keys = repositories.map((repository) =>
        cacheKey(repository.nameWithOwner),
      );
      if (rateKey) keys.push(rateKey);
      const stored = await options.storage.get(keys);
      const currentTime = now();
      const records = new Map<string, CacheRecord>();
      const touched: Record<string, CacheRecord> = {};
      let needsCleanup = false;

      for (const repository of repositories) {
        const key = cacheKey(repository.nameWithOwner);
        const record = parseCacheRecord(stored[key], repository.nameWithOwner);
        if (!record || !isRetained(record, currentTime)) {
          if (key in stored) needsCleanup = true;
          continue;
        }
        const touchedRecord = { ...record, accessedAt: currentTime } as CacheRecord;
        records.set(repository.nameWithOwner.toLowerCase(), touchedRecord);
        touched[key] = touchedRecord;
      }

      let warning: string | null = null;
      if (needsCleanup || Object.keys(touched).length > 0) {
        warning = await removeAndSet(touched, loadGeneration, true);
      }

      const rateValue = rateKey ? stored[rateKey] : null;
      const retryAt =
        isRecord(rateValue) &&
        typeof rateValue.retryAt === "number" &&
        rateValue.retryAt > currentTime
          ? rateValue.retryAt
          : null;

      if (rateKey) {
        initializedRateKeys.add(rateKey);
        const knownPause = ratePauses.get(rateKey) ?? 0;
        if (retryAt && retryAt > knownPause) ratePauses.set(rateKey, retryAt);
        else if (knownPause <= currentTime) ratePauses.delete(rateKey);
      }

      return { records, retryAt, warning };
    } catch {
      return {
        records: new Map(),
        retryAt: null,
        warning: "The device cache is unavailable; loading directly from GitHub.",
      };
    }
  }

  async function readActiveRetryAt(
    rateKey: string,
  ): Promise<{ retryAt: number | null; warning: string | null }> {
    if (initializedRateKeys.has(rateKey)) {
      const retryAt = ratePauses.get(rateKey) ?? null;
      if (retryAt !== null && retryAt <= now()) {
        ratePauses.delete(rateKey);
        return { retryAt: null, warning: null };
      }
      return { retryAt, warning: null };
    }

    try {
      await mutationTail;
      const stored = await options.storage.get(rateKey);
      const value = stored[rateKey];
      const retryAt =
        isRecord(value) &&
        typeof value.retryAt === "number" &&
        value.retryAt > now()
          ? value.retryAt
          : null;
      initializedRateKeys.add(rateKey);
      if (retryAt) ratePauses.set(rateKey, retryAt);
      return {
        retryAt,
        warning: null,
      };
    } catch {
      return {
        retryAt: null,
        warning: "The device cache is unavailable; GitHub backoff could not be checked.",
      };
    }
  }

  async function persistRatePause(
    rateKey: string,
    retryAt: number,
  ): Promise<string | null> {
    initializedRateKeys.add(rateKey);
    ratePauses.set(rateKey, retryAt);
    try {
      return await serialize(async () => {
        await options.storage.set({ [rateKey]: { retryAt } });
        return null;
      });
    } catch {
      return "The GitHub reset time could not be saved to the device cache.";
    }
  }

  function getStatusFrom(stored: Record<string, unknown>): LocalCacheStatus {
    let entries = 0;
    let bytes = 0;
    for (const [key, value] of Object.entries(stored)) {
      if (!ownedKey(key)) continue;
      bytes += encodedBytes(key, value);
      if (
        cacheEntryKey(key) &&
        parseCacheRecord(value, key.slice(CACHE_PREFIX.length))
      ) {
        entries += 1;
      }
    }
    return {
      entries,
      bytes,
      maxBytes,
      freshHours: FRESH_MILLISECONDS / (60 * 60 * 1_000),
      retentionDays: RETENTION_MILLISECONDS / (24 * 60 * 60 * 1_000),
    };
  }

  async function status(): Promise<LocalCacheStatus> {
    return serialize(async () => {
      const stored = await options.storage.get(null);
      const currentTime = now();
      const expired = Object.entries(stored)
        .filter(([key, value]) => {
          if (cacheEntryKey(key)) {
            const record = parseCacheRecord(
              value,
              key.slice(CACHE_PREFIX.length),
            );
            return !record || !isRetained(record, currentTime);
          }
          if (key.startsWith(RATE_LIMIT_PREFIX)) {
            return (
              !isRecord(value) ||
              typeof value.retryAt !== "number" ||
              value.retryAt <= currentTime
            );
          }
          return false;
        })
        .map(([key]) => key);
      if (expired.length > 0) await options.storage.remove(expired);
      cacheIndex = null;
      indexedBytes = 0;
      return getStatusFrom(await options.storage.get(null));
    });
  }

  async function clear(): Promise<LocalCacheStatus> {
    generation += 1;
    requestCoordinator.inFlightByToken.clear();
    requestCoordinator.recentByToken.clear();
    return serialize(async () => {
      const stored = await options.storage.get(null);
      const keys = Object.keys(stored).filter(cacheEntryKey);
      if (keys.length > 0) await options.storage.remove(keys);
      cacheIndex = new Map();
      indexedBytes = 0;
      return getStatusFrom(await options.storage.get(null));
    });
  }

  async function load(loadOptions: MetadataLoadOptions): Promise<MetadataLoadResult> {
    const requestStartedAt = Date.now();
    const repositories = uniqueRepositories(loadOptions.repositories);
    const loadGeneration = generation;
    const currentTime = now();
    const scope = loadOptions.token ? await tokenScope(loadOptions.token) : null;
    const rateKey = scope ? `${RATE_LIMIT_PREFIX}${scope}` : null;
    const cached = await readRequested(repositories, rateKey, loadGeneration);
    const metadata = new Map<string, RepositoryMetadata>();
    const missing = new Set<string>();
    const stale = new Set<string>();
    const pending = new Set<string>();
    const cachedValues = new Set<string>();
    let rateLimit: RateLimitInfo | null = null;
    let warning: string | null = cached.warning;

    for (const repository of repositories) {
      const key = repository.nameWithOwner.toLowerCase();
      const record = cached.records.get(key);

      if (!record) {
        pending.add(key);
      } else if ("missing" in record) {
        missing.add(repository.nameWithOwner);
        if (loadOptions.refresh) pending.add(key);
      } else {
        metadata.set(key, record.value);
        cachedValues.add(key);
        if (!isFresh(record, currentTime)) stale.add(key);
        if (loadOptions.refresh || !isFresh(record, currentTime)) pending.add(key);
      }
    }

    const snapshot = (forceComplete = false): MetadataLoadResult => ({
      metadata: repositories.flatMap((repository) => {
        const item = metadata.get(repository.nameWithOwner.toLowerCase());
        return item ? [item] : [];
      }),
      missing: repositories
        .filter((repository) => missing.has(repository.nameWithOwner))
        .map((repository) => repository.nameWithOwner),
      rateLimit,
      cachedCount: cachedValues.size,
      staleCount: stale.size,
      pendingCount: pending.size,
      complete: forceComplete,
      warning,
    });

    loadOptions.onProgress(snapshot(pending.size === 0));
    if (pending.size === 0) return snapshot(true);

    if (!loadOptions.token || !scope) {
      warning = combineWarning(
        warning,
        "Add a dedicated GitHub token to refresh repository data.",
      );
      const result = snapshot(true);
      loadOptions.onProgress(result);
      return result;
    }

    if (cached.retryAt) {
      warning = combineWarning(warning, rateLimitWarning(cached.retryAt));
      const result = snapshot(true);
      loadOptions.onProgress(result);
      return result;
    }

    const toFetch = repositories.filter((repository) =>
      pending.has(repository.nameWithOwner.toLowerCase()),
    );
    let rateLimited = false;
    let stopped = false;

    for (let index = 0; index < toFetch.length; index += BATCH_SIZE) {
      if (
        loadGeneration !== generation ||
        loadOptions.isCancelled?.()
      ) {
        break;
      }
      const activePause = await readActiveRetryAt(
        rateKey ?? `${RATE_LIMIT_PREFIX}${scope}`,
      );
      warning = combineWarning(warning, activePause.warning);
      if (activePause.retryAt) {
        warning = combineWarning(warning, rateLimitWarning(activePause.retryAt));
        rateLimited = true;
        break;
      }
      const batch = toFetch.slice(index, index + BATCH_SIZE);

      try {
        const outcomes = await fetchWithDeduplication(
          batch,
          loadOptions.token,
          scope,
          fetchBatch,
          requestStartedAt,
          requestCoordinator,
          () => loadGeneration === generation,
          async () => {
            if (
              loadGeneration !== generation ||
              loadOptions.isCancelled?.()
            ) {
              throw createFetchStartGuardError("LOAD_CANCELLED");
            }
            const latestPause = await readActiveRetryAt(
              rateKey ?? `${RATE_LIMIT_PREFIX}${scope}`,
            );
            if (latestPause.retryAt) {
              throw createFetchStartGuardError(
                "RATE_PAUSED",
                latestPause.retryAt,
              );
            }
          },
        );
        const updates: Record<string, CacheRecord> = {};
        const persistedAt = now();

        for (const [outcomeIndex, outcome] of outcomes.entries()) {
          const repository = batch[outcomeIndex];
          if (!repository) continue;
          const key = repository.nameWithOwner.toLowerCase();
          pending.delete(key);
          rateLimit = outcome.rateLimit ?? rateLimit;

          if (outcome.metadata) {
            metadata.set(key, outcome.metadata);
            cachedValues.delete(key);
            missing.delete(repository.nameWithOwner);
            stale.delete(key);
            updates[cacheKey(repository.nameWithOwner)] = {
              v: RECORD_VERSION,
              value: outcome.metadata,
              accessedAt: persistedAt,
            };
          } else if (outcome.missing) {
            metadata.delete(key);
            cachedValues.delete(key);
            stale.delete(key);
            missing.add(repository.nameWithOwner);
            updates[cacheKey(repository.nameWithOwner)] = {
              v: RECORD_VERSION,
              missing: true,
              nameWithOwner: repository.nameWithOwner,
              fetchedAt: persistedAt,
              accessedAt: persistedAt,
            };
          }
        }

        if (rateLimit && rateLimit.remaining <= 0) {
          const retryAt = Date.parse(rateLimit.resetAt);
          if (Number.isFinite(retryAt) && retryAt > now()) {
            const pauseWarning = await persistRatePause(
              `${RATE_LIMIT_PREFIX}${scope}`,
              retryAt,
            );
            warning = combineWarning(warning, pauseWarning);
            warning = combineWarning(warning, rateLimitWarning(retryAt));
            rateLimited = true;
          }
        }

        const cacheWarning = await removeAndSet(updates, loadGeneration);
        warning = combineWarning(warning, cacheWarning);
        loadOptions.onProgress(snapshot(false));
        if (rateLimited) break;
      } catch (error: unknown) {
        if (isFetchStartGuardError(error)) {
          if (error.code === "RATE_PAUSED" && error.retryAt) {
            warning = combineWarning(warning, rateLimitWarning(error.retryAt));
            rateLimited = true;
          } else {
            stopped = true;
          }
        } else {
          warning = combineWarning(warning, warningMessage(error));
        }
        if (isGitHubClientError(error) && error.code === "RATE_LIMITED") {
          const retryAt = error.retryAt ?? now() + 60 * 1_000;
          const pauseWarning = await persistRatePause(
            `${RATE_LIMIT_PREFIX}${scope}`,
            retryAt,
          );
          warning = combineWarning(warning, rateLimitWarning(retryAt));
          warning = combineWarning(warning, pauseWarning);
          rateLimited = true;
        }
        loadOptions.onProgress(snapshot(false));
        if (rateLimited || stopped) break;
      }
    }

    const result = snapshot(true);
    loadOptions.onProgress(result);
    return result;
  }

  return { load, status, clear };
}
