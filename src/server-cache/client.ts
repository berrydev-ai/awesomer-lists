import type { RepositoryMetadata } from "../domain/types";
import {
  MAX_LOOKUP_REPOSITORIES,
  MAX_PUBLISH_RECORDS,
  acceptMetadataResponse,
  isRepositoryName,
} from "./payload";

const LOOKUP_PATH = "/v1/metadata/lookup";
const PUBLISH_PATH = "/v1/metadata/publish";
const REQUEST_TIMEOUT_MILLISECONDS = 6_000;
const CONCURRENCY = 4;

export interface SharedCacheOptions {
  fetchImplementation?: typeof fetch;
  timeoutMilliseconds?: number;
}

function chunk<T>(values: readonly T[], size: number): T[][] {
  const chunks: T[][] = [];

  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }

  return chunks;
}

async function mapWithLimit<T, R>(
  items: readonly T[],
  limit: number,
  run: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;

  async function worker(): Promise<void> {
    while (next < items.length) {
      const index = next++;
      const item = items[index];

      if (item === undefined) continue;
      results[index] = await run(item);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, worker),
  );

  return results;
}

async function postJson(
  url: string,
  body: unknown,
  options: SharedCacheOptions,
): Promise<unknown> {
  const fetchImplementation = options.fetchImplementation ?? fetch;
  const timeout =
    options.timeoutMilliseconds ?? REQUEST_TIMEOUT_MILLISECONDS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetchImplementation(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
      // The shared cache holds public GitHub data and needs no identity.
      credentials: "omit",
      cache: "no-store",
    });

    if (!response.ok) return null;
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Asks the shared cache for repository metadata other people already loaded.
 *
 * The shared cache is an accelerator, never a dependency: any failure, timeout,
 * or malformed answer resolves to the records that did arrive intact, and the
 * caller falls back to GitHub for the rest.
 */
export async function lookupSharedMetadata(
  serverUrl: string,
  repositories: readonly string[],
  options: SharedCacheOptions = {},
): Promise<RepositoryMetadata[]> {
  const names = repositories.filter(isRepositoryName);

  if (!serverUrl || names.length === 0) return [];

  const batches = chunk(names, MAX_LOOKUP_REPOSITORIES);
  const results = await mapWithLimit(batches, CONCURRENCY, async (batch) => {
    try {
      const payload = await postJson(
        `${serverUrl}${LOOKUP_PATH}`,
        { repositories: batch },
        options,
      );
      return acceptMetadataResponse(payload, batch);
    } catch {
      return [];
    }
  });

  return results.flat();
}

/**
 * Offers freshly fetched metadata back to the shared cache so the next person
 * to open a list containing these repositories does not pay for them again.
 * Returns how many records the server accepted.
 */
export async function publishSharedMetadata(
  serverUrl: string,
  metadata: readonly RepositoryMetadata[],
  options: SharedCacheOptions = {},
): Promise<number> {
  if (!serverUrl || metadata.length === 0) return 0;

  const batches = chunk(metadata, MAX_PUBLISH_RECORDS);
  const stored = await mapWithLimit(batches, CONCURRENCY, async (batch) => {
    try {
      const payload = await postJson(
        `${serverUrl}${PUBLISH_PATH}`,
        { metadata: batch },
        options,
      );

      if (
        typeof payload === "object" &&
        payload !== null &&
        "stored" in payload &&
        typeof payload.stored === "number"
      ) {
        return payload.stored;
      }

      return 0;
    } catch {
      return 0;
    }
  });

  return stored.reduce((total, count) => total + count, 0);
}
