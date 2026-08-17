import type { RepositoryMetadata } from "../../src/domain/types";
import {
  MAX_LOOKUP_REPOSITORIES,
  MAX_PUBLISH_RECORDS,
  SHARED_CACHE_TTL_MILLISECONDS,
  SHARED_CACHE_TTL_SECONDS,
  type SharedCacheEntry,
  parseLookupRequest,
  parseMetadataRecord,
  parsePublishRequest,
  sharedCacheKey,
} from "../../src/server-cache/payload";

/** The slice of Cloudflare's KV binding this worker uses. */
export interface CacheKeyValueStore {
  get(key: string, type: "text"): Promise<string | null>;
  put(
    key: string,
    value: string,
    options?: { expirationTtl?: number },
  ): Promise<void>;
}

export interface WorkerEnv {
  CACHE: CacheKeyValueStore;
}

const MAX_BODY_BYTES = 2 * 1_024 * 1_024;
const KV_CONCURRENCY = 32;

const CORS_HEADERS: Record<string, string> = {
  // Entries are public GitHub data, so any extension build may read and contribute.
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...CORS_HEADERS,
    },
  });
}

function error(status: number, message: string): Response {
  return json({ error: message }, status);
}

async function readJsonBody(request: Request): Promise<unknown> {
  const declaredLength = Number(request.headers.get("Content-Length") ?? "0");

  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
    throw new Error("TOO_LARGE");
  }

  const text = await request.text();

  if (text.length > MAX_BODY_BYTES) throw new Error("TOO_LARGE");

  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error("INVALID_JSON");
  }
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

function readEntry(raw: string | null, now: number): RepositoryMetadata | null {
  if (raw === null) return null;

  let parsed: unknown;

  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    return null;
  }

  if (typeof parsed !== "object" || parsed === null) return null;

  const entry = parsed as Partial<SharedCacheEntry>;

  // KV expiry is eventually consistent, so the stored deadline decides.
  if (typeof entry.expiresAt !== "number" || entry.expiresAt <= now) {
    return null;
  }

  return parseMetadataRecord(entry.value);
}

async function handleLookup(
  request: Request,
  env: WorkerEnv,
  now: number,
): Promise<Response> {
  const body = await readJsonBody(request);
  const repositories = parseLookupRequest(body);

  if (!repositories) {
    return error(
      400,
      `Send { "repositories": ["owner/name", …] } with at most ${MAX_LOOKUP_REPOSITORIES} valid names.`,
    );
  }

  const found = await mapWithLimit(
    repositories,
    KV_CONCURRENCY,
    async (nameWithOwner) => {
      try {
        const raw = await env.CACHE.get(sharedCacheKey(nameWithOwner), "text");
        return readEntry(raw, now);
      } catch {
        return null;
      }
    },
  );

  const metadata = found.filter(
    (record): record is RepositoryMetadata => record !== null,
  );

  return json({ metadata, requested: repositories.length });
}

async function handlePublish(
  request: Request,
  env: WorkerEnv,
  now: number,
): Promise<Response> {
  const body = await readJsonBody(request);
  const metadata = parsePublishRequest(body);

  if (!metadata) {
    return error(
      400,
      `Send { "metadata": [record, …] } with at most ${MAX_PUBLISH_RECORDS} well-formed records.`,
    );
  }

  const expiresAt = now + SHARED_CACHE_TTL_MILLISECONDS;
  const results = await mapWithLimit(metadata, KV_CONCURRENCY, async (record) => {
    const entry: SharedCacheEntry = { value: record, expiresAt };

    try {
      await env.CACHE.put(
        sharedCacheKey(record.nameWithOwner),
        JSON.stringify(entry),
        { expirationTtl: SHARED_CACHE_TTL_SECONDS },
      );
      return true;
    } catch {
      return false;
    }
  });

  return json({ stored: results.filter(Boolean).length });
}

/**
 * Routes one shared-cache request. Exported separately from the default export
 * so tests can drive it with a plain in-memory store.
 */
export async function handleCacheRequest(
  request: Request,
  env: WorkerEnv,
  now: number = Date.now(),
): Promise<Response> {
  const { pathname } = new URL(request.url);

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  if (pathname === "/health") {
    return request.method === "GET"
      ? json({ ok: true, ttlSeconds: SHARED_CACHE_TTL_SECONDS })
      : error(405, "Use GET for /health.");
  }

  const isLookup = pathname === "/v1/metadata/lookup";
  const isPublish = pathname === "/v1/metadata/publish";

  if (!isLookup && !isPublish) return error(404, "Unknown endpoint.");
  if (request.method !== "POST") return error(405, "Use POST for this endpoint.");

  try {
    return isLookup
      ? await handleLookup(request, env, now)
      : await handlePublish(request, env, now);
  } catch (cause) {
    const reason = cause instanceof Error ? cause.message : "";

    if (reason === "TOO_LARGE") return error(413, "The request body is too large.");
    if (reason === "INVALID_JSON") return error(400, "The body is not valid JSON.");

    return error(500, "The cache server could not complete this request.");
  }
}

export default {
  fetch(request: Request, env: WorkerEnv): Promise<Response> {
    return handleCacheRequest(request, env);
  },
};
