import { describe, expect, it, vi } from "vitest";

import type { RepositoryMetadata, RepositoryRef } from "../domain/types";
import type { MetadataLoadResult } from "../messages";
import {
  createMetadataService,
  type MetadataStorageArea,
} from "./service";

const HOUR = 60 * 60 * 1_000;
const NOW = Date.parse("2026-09-16T12:00:00.000Z");

class MemoryStorage implements MetadataStorageArea {
  readonly data: Record<string, unknown>;
  quotaBytes: number | null = null;
  getAllCalls = 0;

  constructor(data: Record<string, unknown> = {}) {
    this.data = { ...data };
  }

  async get(keys?: string | string[] | null): Promise<Record<string, unknown>> {
    if (keys === null || keys === undefined) {
      this.getAllCalls += 1;
      return { ...this.data };
    }
    const requested = typeof keys === "string" ? [keys] : keys;
    return Object.fromEntries(
      requested.filter((key) => key in this.data).map((key) => [key, this.data[key]]),
    );
  }

  async set(items: Record<string, unknown>): Promise<void> {
    if (this.quotaBytes !== null) {
      const candidate = { ...this.data, ...items };
      if (JSON.stringify(candidate).length > this.quotaBytes) {
        throw new Error("QUOTA_BYTES exceeded");
      }
    }
    Object.assign(this.data, items);
  }

  async remove(keys: string | string[]): Promise<void> {
    for (const key of typeof keys === "string" ? [keys] : keys) {
      delete this.data[key];
    }
  }
}

describe("metadata cache service", () => {
  it("emits stale migrated data immediately, refreshes it, and reuses it after restart", async () => {
    const repository = repo("owner/project");
    const old = metadata(repository.nameWithOwner, NOW - 7 * HOUR, 1);
    const fresh = metadata(repository.nameWithOwner, NOW, 2);
    const storage = new MemoryStorage({
      "metadata.owner/project": { value: old, expiresAt: NOW - HOUR },
    });
    const progress: MetadataLoadResult[] = [];
    const fetchBatch = vi.fn(async () => ({
      metadata: [fresh],
      missing: [],
      rateLimit: { remaining: 100, resetAt: new Date(NOW + HOUR).toISOString() },
    }));
    const service = createMetadataService({ storage, fetchBatch, now: () => NOW });

    const result = await service.load({
      repositories: [repository],
      refresh: false,
      token: "token-stale",
      onProgress: (value) => progress.push(value),
    });

    expect(progress[0]).toMatchObject({
      metadata: [old],
      staleCount: 1,
      pendingCount: 1,
      complete: false,
    });
    expect(result).toMatchObject({
      metadata: [fresh],
      cachedCount: 0,
      staleCount: 0,
      pendingCount: 0,
      complete: true,
    });

    const afterRestartFetch = vi.fn();
    const restarted = createMetadataService({
      storage,
      fetchBatch: afterRestartFetch,
      now: () => NOW + HOUR,
    });
    await restarted.load({
      repositories: [repository],
      refresh: false,
      token: "token-stale",
      onProgress: () => undefined,
    });
    expect(afterRestartFetch).not.toHaveBeenCalled();
  });

  it("persists successful batches and returns them when a later batch fails", async () => {
    const repositories = Array.from({ length: 21 }, (_, index) => repo(`owner/r${index}`));
    const storage = new MemoryStorage();
    const fetchBatch = vi
      .fn()
      .mockImplementationOnce(async (batch: RepositoryRef[]) => ({
        metadata: batch.map((item) => metadata(item.nameWithOwner, NOW, 10)),
        missing: [],
        rateLimit: null,
      }))
      .mockRejectedValueOnce(new Error("temporary GitHub failure"));
    const service = createMetadataService({ storage, fetchBatch, now: () => NOW });

    const result = await service.load({
      repositories,
      refresh: false,
      token: "token-partial",
      onProgress: () => undefined,
    });

    expect(result.metadata).toHaveLength(20);
    expect(result.pendingCount).toBe(1);
    expect(result.complete).toBe(true);
    expect(result.warning).toContain("temporary GitHub failure");
    expect(Object.keys(storage.data).filter((key) => key.startsWith("metadata."))).toHaveLength(20);
  });

  it("indexes stored records once instead of rescanning the cache for every batch", async () => {
    const repositories = Array.from({ length: 41 }, (_, index) =>
      repo(`owner/indexed${index}`),
    );
    const storage = new MemoryStorage();
    const service = createMetadataService({
      storage,
      now: () => NOW,
      fetchBatch: async (batch) => ({
        metadata: batch.map((item) => metadata(item.nameWithOwner, NOW, 1)),
        missing: [],
        rateLimit: null,
      }),
    });

    await service.load({
      repositories,
      refresh: true,
      token: "token-cache-index",
      onProgress: () => undefined,
    });

    expect(storage.getAllCalls).toBe(1);
  });

  it("rebuilds its cache index after storage initialization or writes fail", async () => {
    const storage = new MemoryStorage();
    const originalGet = storage.get.bind(storage);
    const originalSet = storage.set.bind(storage);
    let fullReadAttempts = 0;
    let failFullRead = true;
    let failSets = false;
    storage.get = async (keys) => {
      if (keys == null) {
        fullReadAttempts += 1;
        if (failFullRead) {
          failFullRead = false;
          throw new Error("read failed");
        }
      }
      return originalGet(keys);
    };
    storage.set = async (items) => {
      if (failSets) throw new Error("write failed");
      return originalSet(items);
    };
    const service = createMetadataService({
      storage,
      now: () => NOW,
      fetchBatch: async (batch) => ({
        metadata: batch.map((item) => metadata(item.nameWithOwner, NOW, 1)),
        missing: [],
        rateLimit: null,
      }),
    });
    const load = (name: string) =>
      service.load({
        repositories: [repo(name)],
        refresh: true,
        token: "token-index-failure",
        onProgress: () => undefined,
      });

    await load("owner/read-failure");
    await load("owner/read-recovery");
    expect(fullReadAttempts).toBe(2);

    failSets = true;
    await load("owner/write-failure");
    failSets = false;
    await load("owner/write-recovery");
    expect(fullReadAttempts).toBe(3);
    expect(storage.data["metadata.owner/write-recovery"]).toBeDefined();
  });

  it("does not let a delayed LRU touch overwrite newer fetched metadata", async () => {
    const old = metadata("owner/project", NOW - 7 * HOUR, 1);
    const fresh = metadata("owner/project", NOW, 2);
    const storage = new MemoryStorage({
      "metadata.owner/project": { v: 1, value: old, accessedAt: NOW - HOUR },
    });
    const originalGet = storage.get.bind(storage);
    let releaseTouch!: () => void;
    let delayFirstRead = true;
    storage.get = async (keys) => {
      const snapshot = await originalGet(keys);
      if (delayFirstRead && Array.isArray(keys)) {
        delayFirstRead = false;
        await new Promise<void>((resolve) => {
          releaseTouch = resolve;
        });
      }
      return snapshot;
    };
    const service = createMetadataService({
      storage,
      now: () => NOW,
      fetchBatch: async () => ({ metadata: [fresh], missing: [], rateLimit: null }),
    });

    const delayedTouch = service.load({
      repositories: [repo("owner/project")],
      refresh: false,
      token: null,
      onProgress: () => undefined,
    });
    await vi.waitFor(() => expect(releaseTouch).toBeTypeOf("function"));
    await service.load({
      repositories: [repo("owner/project")],
      refresh: true,
      token: "token-fresh-save",
      onProgress: () => undefined,
    });
    releaseTouch();
    await delayedTouch;

    const stored = storage.data["metadata.owner/project"] as {
      value: RepositoryMetadata;
    };
    expect(stored.value.stars).toBe(2);
    expect(stored.value.fetchedAt).toBe(fresh.fetchedAt);
  });

  it("deduplicates overlapping in-flight repositories for the same token", async () => {
    const a = repo("owner/a");
    const b = repo("owner/b");
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const fetchedNames: string[][] = [];
    const fetchBatch = vi.fn(async (batch: readonly RepositoryRef[]) => {
      fetchedNames.push(batch.map((item) => item.nameWithOwner));
      await gate;
      return {
        metadata: batch.map((item) => metadata(item.nameWithOwner, NOW, 1)),
        missing: [],
        rateLimit: null,
      };
    });
    const service = createMetadataService({
      storage: new MemoryStorage(),
      fetchBatch,
      now: () => NOW,
    });

    const first = service.load({
      repositories: [a, b],
      refresh: true,
      token: "token-dedup",
      onProgress: () => undefined,
    });
    await vi.waitFor(() => expect(fetchBatch).toHaveBeenCalledTimes(1));
    const second = service.load({
      repositories: [b],
      refresh: true,
      token: "token-dedup",
      onProgress: () => undefined,
    });
    release();

    const [firstResult, secondResult] = await Promise.all([first, second]);
    expect(firstResult.metadata).toHaveLength(2);
    expect(secondResult.metadata).toHaveLength(1);
    expect(fetchedNames.flat().filter((name) => name === "owner/b")).toHaveLength(1);
  });

  it("evicts least recently used records to stay below its byte cap", async () => {
    const first = metadata("owner/first", NOW - HOUR, 1);
    const second = metadata("owner/second", NOW - HOUR, 2);
    const firstRecord = { v: 1, value: first, accessedAt: NOW - 2 * HOUR };
    const secondRecord = { v: 1, value: second, accessedAt: NOW - HOUR };
    const oneRecordBytes = JSON.stringify({ "metadata.owner/second": secondRecord }).length;
    const storage = new MemoryStorage({
      "metadata.owner/first": firstRecord,
      "metadata.owner/second": secondRecord,
    });
    const service = createMetadataService({
      storage,
      now: () => NOW,
      maxBytes: oneRecordBytes + 32,
    });

    await service.load({
      repositories: [repo("owner/second")],
      refresh: false,
      token: null,
      onProgress: () => undefined,
    });
    const status = await service.status();

    expect(status.entries).toBe(1);
    expect(storage.data["metadata.owner/first"]).toBeUndefined();
    expect(storage.data["metadata.owner/second"]).toBeDefined();
  });

  it("keeps fetched results useful when quota recovery has to evict old entries", async () => {
    const old = metadata("owner/old", NOW - HOUR, 1);
    const storage = new MemoryStorage({
      "metadata.owner/old": { v: 1, value: old, accessedAt: NOW - HOUR },
      "unrelated.setting": "keep-me",
    });
    storage.quotaBytes = JSON.stringify(storage.data).length + 100;
    const service = createMetadataService({
      storage,
      now: () => NOW,
      fetchBatch: async ([repository]) => ({
        metadata: repository ? [metadata(repository.nameWithOwner, NOW, 99)] : [],
        missing: [],
        rateLimit: null,
      }),
    });

    const result = await service.load({
      repositories: [repo("owner/new")],
      refresh: false,
      token: "token-quota",
      onProgress: () => undefined,
    });

    expect(result.metadata[0]?.stars).toBe(99);
    expect(result.warning).toMatch(/removed|could not cache/);
    expect(storage.data["unrelated.setting"]).toBe("keep-me");
  });

  it("does not let an older in-flight load repopulate a cleared cache", async () => {
    const storage = new MemoryStorage({ "auth.githubToken": "keep-secret" });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const fetchBatch = vi.fn(async ([repository]: readonly RepositoryRef[]) => {
      await gate;
      return {
        metadata: repository ? [metadata(repository.nameWithOwner, NOW, 1)] : [],
        missing: [],
        rateLimit: null,
      };
    });
    const service = createMetadataService({
      storage,
      now: () => NOW,
      fetchBatch,
    });

    const loading = service.load({
      repositories: [repo("owner/project")],
      refresh: true,
      token: "token-clear",
      onProgress: () => undefined,
    });
    await vi.waitFor(() => expect(fetchBatch).toHaveBeenCalledTimes(1));
    await service.clear();
    release();
    await loading;

    expect(storage.data["metadata.owner/project"]).toBeUndefined();
    expect(storage.data["auth.githubToken"]).toBe("keep-secret");

    await service.load({
      repositories: [repo("owner/project")],
      refresh: true,
      token: "token-clear",
      onProgress: () => undefined,
    });
    expect(fetchBatch).toHaveBeenCalledTimes(2);
  });

  it("stops an old load before its next batch after clear", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const fetchBatch = vi.fn(async (batch: readonly RepositoryRef[]) => {
      await gate;
      return {
        metadata: batch.map((item) => metadata(item.nameWithOwner, NOW, 1)),
        missing: [],
        rateLimit: null,
      };
    });
    const service = createMetadataService({
      storage: new MemoryStorage(),
      fetchBatch,
      now: () => NOW,
    });
    const loading = service.load({
      repositories: Array.from({ length: 21 }, (_, index) => repo(`owner/c${index}`)),
      refresh: true,
      token: "token-clear-batches",
      onProgress: () => undefined,
    });
    await vi.waitFor(() => expect(fetchBatch).toHaveBeenCalledTimes(1));
    await service.clear();
    release();
    const result = await loading;

    expect(fetchBatch).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ complete: true, pendingCount: 1 });
  });

  it("does not let an old post-clear completion erase newer inflight deduplication", async () => {
    const gates: Array<() => void> = [];
    const fetchBatch = vi.fn(
      (batch: readonly RepositoryRef[]) =>
        new Promise<{
          metadata: RepositoryMetadata[];
          missing: string[];
          rateLimit: null;
        }>((resolve) => {
          gates.push(() =>
            resolve({
              metadata: batch.map((item) => metadata(item.nameWithOwner, NOW, 1)),
              missing: [],
              rateLimit: null,
            }),
          );
        }),
    );
    const service = createMetadataService({
      storage: new MemoryStorage(),
      fetchBatch,
      now: () => NOW,
    });
    const options = {
      repositories: [repo("owner/project")],
      refresh: true,
      token: "token-clear-overlap",
      onProgress: () => undefined,
    };

    const oldLoad = service.load(options);
    await vi.waitFor(() => expect(fetchBatch).toHaveBeenCalledTimes(1));
    await service.clear();
    const newLoad = service.load(options);
    await vi.waitFor(() => expect(fetchBatch).toHaveBeenCalledTimes(2));
    gates[0]?.();
    await oldLoad;
    const overlappingLoad = service.load(options);
    await Promise.resolve();
    expect(fetchBatch).toHaveBeenCalledTimes(2);
    gates[1]?.();
    await Promise.all([newLoad, overlappingLoad]);

    expect(fetchBatch).toHaveBeenCalledTimes(2);
  });

  it("keeps a rate pause discovered by a request that finishes after clear", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const fetchBatch = vi.fn(async () => {
      await gate;
      throw Object.assign(new Error("rate limited"), {
        code: "RATE_LIMITED" as const,
        retryAt: NOW + HOUR,
      });
    });
    const service = createMetadataService({
      storage: new MemoryStorage(),
      fetchBatch,
      now: () => NOW,
    });
    const options = {
      repositories: [repo("owner/project")],
      refresh: true,
      token: "token-rate-after-clear",
      onProgress: () => undefined,
    };

    const loading = service.load(options);
    await vi.waitFor(() => expect(fetchBatch).toHaveBeenCalledTimes(1));
    await service.clear();
    release();
    await loading;
    const retried = await service.load(options);

    expect(retried.warning).toContain("rate limit");
    expect(fetchBatch).toHaveBeenCalledTimes(1);
  });

  it("negative-caches missing repositories for a short repeat lookup", async () => {
    const storage = new MemoryStorage();
    const fetchBatch = vi.fn(async (batch: readonly RepositoryRef[]) => ({
      metadata: [],
      missing: batch.map((item) => item.nameWithOwner),
      rateLimit: null,
    }));
    const service = createMetadataService({ storage, fetchBatch, now: () => NOW });
    const options = {
      repositories: [repo("owner/gone")],
      refresh: false,
      token: "token-negative",
      onProgress: () => undefined,
    };

    expect((await service.load(options)).missing).toEqual(["owner/gone"]);
    expect((await service.load(options)).missing).toEqual(["owner/gone"]);
    expect(fetchBatch).toHaveBeenCalledTimes(1);
  });

  it("persists a rate-limit pause and avoids subsequent network requests", async () => {
    const retryAt = NOW + HOUR;
    const error = Object.assign(new Error("rate limited"), {
      code: "RATE_LIMITED" as const,
      retryAt,
    });
    const storage = new MemoryStorage();
    const fetchBatch = vi.fn().mockRejectedValue(error);
    const service = createMetadataService({ storage, fetchBatch, now: () => NOW });
    const options = {
      repositories: [repo("owner/project")],
      refresh: true,
      token: "token-rate",
      onProgress: () => undefined,
    };

    const first = await service.load(options);
    const second = await service.load(options);

    await service.clear();
    const afterClear = await service.load(options);

    expect(first.warning).toContain("rate limit");
    expect(second.warning).toContain("rate limit");
    expect(afterClear.warning).toContain("rate limit");
    expect(second.pendingCount).toBe(1);
    expect(fetchBatch).toHaveBeenCalledTimes(1);
  });

  it("marks no-token and cancelled loads complete while preserving pending work", async () => {
    const fetchBatch = vi.fn();
    const service = createMetadataService({
      storage: new MemoryStorage(),
      fetchBatch,
      now: () => NOW,
    });
    const repository = repo("owner/project");

    const noToken = await service.load({
      repositories: [repository],
      refresh: false,
      token: null,
      onProgress: () => undefined,
    });
    const cancelled = await service.load({
      repositories: [repository],
      refresh: true,
      token: "token-cancelled",
      onProgress: () => undefined,
      isCancelled: () => true,
    });

    expect(noToken).toMatchObject({ complete: true, pendingCount: 1 });
    expect(cancelled).toMatchObject({ complete: true, pendingCount: 1 });
    expect(fetchBatch).not.toHaveBeenCalled();
  });

  it("ignores cache records stored under the wrong repository or from the future", async () => {
    const storage = new MemoryStorage({
      "metadata.owner/expected": {
        v: 1,
        value: metadata("owner/different", NOW - HOUR, 1),
        accessedAt: NOW - HOUR,
      },
      "metadata.owner/future": {
        v: 1,
        value: metadata("owner/future", NOW + HOUR, 2),
        accessedAt: NOW,
      },
    });
    const fetched: string[] = [];
    const service = createMetadataService({
      storage,
      now: () => NOW,
      fetchBatch: async (batch) => {
        fetched.push(...batch.map((item) => item.nameWithOwner));
        return {
          metadata: batch.map((item) => metadata(item.nameWithOwner, NOW, 3)),
          missing: [],
          rateLimit: null,
        };
      },
    });

    const result = await service.load({
      repositories: [repo("owner/expected"), repo("owner/future")],
      refresh: false,
      token: "token-validation",
      onProgress: () => undefined,
    });

    expect(fetched).toEqual(["owner/expected", "owner/future"]);
    expect(result.cachedCount).toBe(0);
    expect(result.metadata.map((item) => item.stars)).toEqual([3, 3]);
  });

  it("surfaces a cache read failure and still returns fetched metadata", async () => {
    const storage = new MemoryStorage();
    const get = storage.get.bind(storage);
    let failRead = true;
    storage.get = async (keys) => {
      if (failRead) {
        failRead = false;
        throw new Error("storage unavailable");
      }
      return get(keys);
    };
    const service = createMetadataService({
      storage,
      now: () => NOW,
      fetchBatch: async ([repository]) => ({
        metadata: repository ? [metadata(repository.nameWithOwner, NOW, 5)] : [],
        missing: [],
        rateLimit: null,
      }),
    });

    const result = await service.load({
      repositories: [repo("owner/project")],
      refresh: false,
      token: "token-storage-error",
      onProgress: () => undefined,
    });

    expect(result.metadata[0]?.stars).toBe(5);
    expect(result.warning).toContain("device cache is unavailable");
    expect(result.complete).toBe(true);
  });

  it("rechecks a shared rate pause before starting a later queued batch", async () => {
    const storage = new MemoryStorage();
    const bulk = Array.from({ length: 21 }, (_, index) => repo(`bulk/r${index}`));
    const limiter = repo("limit/repo");
    let releaseBulk!: () => void;
    const bulkGate = new Promise<void>((resolve) => {
      releaseBulk = resolve;
    });
    const calls: string[][] = [];
    const retryAt = NOW + HOUR;
    const service = createMetadataService({
      storage,
      now: () => NOW,
      fetchBatch: async (batch) => {
        calls.push(batch.map((item) => item.nameWithOwner));
        if (batch[0]?.nameWithOwner === limiter.nameWithOwner) {
          throw Object.assign(new Error("rate limited"), {
            code: "RATE_LIMITED" as const,
            retryAt,
          });
        }
        await bulkGate;
        return {
          metadata: batch.map((item) => metadata(item.nameWithOwner, NOW, 1)),
          missing: [],
          rateLimit: null,
        };
      },
    });

    const bulkLoad = service.load({
      repositories: bulk,
      refresh: true,
      token: "token-shared-pause",
      onProgress: () => undefined,
    });
    await vi.waitFor(() => expect(calls).toHaveLength(1));
    const limitedLoad = service.load({
      repositories: [limiter],
      refresh: true,
      token: "token-shared-pause",
      onProgress: () => undefined,
    });
    await limitedLoad;
    releaseBulk();
    const result = await bulkLoad;

    expect(calls).toHaveLength(2);
    expect(calls.some((batch) => batch.includes("bulk/r20"))).toBe(false);
    expect(result).toMatchObject({ complete: true, pendingCount: 1 });
    expect(result.warning).toContain("rate limit");
  });

  it("rechecks backoff after a queued request obtains a network slot", async () => {
    let releaseBlocker!: () => void;
    let releaseLimiter!: () => void;
    const blockerGate = new Promise<void>((resolve) => {
      releaseBlocker = resolve;
    });
    const limiterGate = new Promise<void>((resolve) => {
      releaseLimiter = resolve;
    });
    const calls: string[] = [];
    const service = createMetadataService({
      storage: new MemoryStorage(),
      now: () => NOW,
      fetchBatch: async (batch) => {
        const name = batch[0]?.nameWithOwner ?? "";
        calls.push(name);
        if (name === "owner/blocker") {
          await blockerGate;
          return {
            metadata: batch.map((item) => metadata(item.nameWithOwner, NOW, 1)),
            missing: [],
            rateLimit: null,
          };
        }
        if (name === "owner/limiter") {
          await limiterGate;
          throw Object.assign(new Error("rate limited"), {
            code: "RATE_LIMITED" as const,
            retryAt: NOW + HOUR,
          });
        }
        return {
          metadata: batch.map((item) => metadata(item.nameWithOwner, NOW, 1)),
          missing: [],
          rateLimit: null,
        };
      },
    });
    const load = (name: string) =>
      service.load({
        repositories: [repo(name)],
        refresh: true,
        token: "token-queued-pause",
        onProgress: () => undefined,
      });

    const blocker = load("owner/blocker");
    await vi.waitFor(() => expect(calls).toEqual(["owner/blocker"]));
    const limiter = load("owner/limiter");
    await vi.waitFor(() => expect(calls).toContain("owner/limiter"));
    const queued = load("owner/queued");
    releaseLimiter();
    await limiter;
    const queuedResult = await queued;
    releaseBlocker();
    await blocker;

    expect(calls).not.toContain("owner/queued");
    expect(queuedResult.warning).toContain("rate limit");
    expect(queuedResult.pendingCount).toBe(1);
  });
});

function repo(nameWithOwner: string): RepositoryRef {
  const [owner = "", name = ""] = nameWithOwner.split("/");
  return {
    owner,
    name,
    nameWithOwner,
    url: `https://github.com/${nameWithOwner}`,
  };
}

function metadata(
  nameWithOwner: string,
  fetchedAt: number,
  stars: number,
): RepositoryMetadata {
  return {
    nameWithOwner,
    url: `https://github.com/${nameWithOwner}`,
    description: "A repository",
    stars,
    forks: 1,
    openIssues: 2,
    lastCommitAt: new Date(fetchedAt).toISOString(),
    license: "MIT",
    isArchived: false,
    fetchedAt: new Date(fetchedAt).toISOString(),
  };
}
