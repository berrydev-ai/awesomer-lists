import { describe, expect, it } from "vitest";

import type { RepositoryMetadata } from "../../src/domain/types";
import { SHARED_CACHE_TTL_SECONDS } from "../../src/server-cache/payload";
import {
  handleCacheRequest,
  type CacheKeyValueStore,
  type WorkerEnv,
} from "./worker";

const NOW = Date.parse("2026-07-09T12:00:00Z");
const DAY = 24 * 60 * 60 * 1_000;

const record: RepositoryMetadata = {
  nameWithOwner: "mastra-ai/mastra",
  url: "https://github.com/mastra-ai/mastra",
  description: "Build AI applications and agents.",
  stars: 20_000,
  forks: 1_500,
  openIssues: 125,
  lastCommitAt: "2026-07-08T12:00:00Z",
  license: "Apache-2.0",
  isArchived: false,
  fetchedAt: "2026-07-09T12:00:00Z",
};

interface MemoryStore extends CacheKeyValueStore {
  data: Map<string, string>;
  ttls: Map<string, number | undefined>;
}

function createStore(): MemoryStore {
  const data = new Map<string, string>();
  const ttls = new Map<string, number | undefined>();

  return {
    data,
    ttls,
    async get(key) {
      return data.get(key) ?? null;
    },
    async put(key, value, options) {
      data.set(key, value);
      ttls.set(key, options?.expirationTtl);
    },
  };
}

function post(path: string, body: unknown): Request {
  return new Request(`https://cache.example.com${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function call(
  request: Request,
  env: WorkerEnv,
  now = NOW,
): Promise<{ status: number; body: any }> {
  const response = await handleCacheRequest(request, env, now);
  const text = await response.text();

  return { status: response.status, body: text ? JSON.parse(text) : null };
}

describe("shared cache worker", () => {
  it("stores a published record and hands it back on lookup", async () => {
    const env: WorkerEnv = { CACHE: createStore() };

    const published = await call(post("/v1/metadata/publish", { metadata: [record] }), env);
    expect(published.status).toBe(200);
    expect(published.body).toEqual({ stored: 1 });

    const looked = await call(
      post("/v1/metadata/lookup", { repositories: ["mastra-ai/mastra"] }),
      env,
    );
    expect(looked.status).toBe(200);
    expect(looked.body.metadata).toEqual([record]);
    expect(looked.body.requested).toBe(1);
  });

  it("applies a seven-day lifetime to every entry", async () => {
    const store = createStore();
    await call(post("/v1/metadata/publish", { metadata: [record] }), { CACHE: store });

    expect([...store.ttls.values()]).toEqual([SHARED_CACHE_TTL_SECONDS]);
    expect(SHARED_CACHE_TTL_SECONDS).toBe(604_800);
  });

  it("stops serving an entry once seven days have passed", async () => {
    const env: WorkerEnv = { CACHE: createStore() };
    await call(post("/v1/metadata/publish", { metadata: [record] }), env);

    const body = { repositories: ["mastra-ai/mastra"] };
    const beforeExpiry = await call(post("/v1/metadata/lookup", body), env, NOW + 6 * DAY);
    const afterExpiry = await call(post("/v1/metadata/lookup", body), env, NOW + 8 * DAY);

    expect(beforeExpiry.body.metadata).toHaveLength(1);
    expect(afterExpiry.body.metadata).toEqual([]);
  });

  it("matches a lookup regardless of how the name is capitalized", async () => {
    const env: WorkerEnv = { CACHE: createStore() };
    await call(post("/v1/metadata/publish", { metadata: [record] }), env);

    const looked = await call(
      post("/v1/metadata/lookup", { repositories: ["Mastra-AI/Mastra"] }),
      env,
    );
    expect(looked.body.metadata).toEqual([record]);
  });

  it("returns only the repositories that are cached, without failing on the rest", async () => {
    const env: WorkerEnv = { CACHE: createStore() };
    await call(post("/v1/metadata/publish", { metadata: [record] }), env);

    const looked = await call(
      post("/v1/metadata/lookup", {
        repositories: ["mastra-ai/mastra", "vercel/next.js"],
      }),
      env,
    );

    expect(looked.status).toBe(200);
    expect(looked.body.metadata).toHaveLength(1);
    expect(looked.body.requested).toBe(2);
  });

  it("refuses a publish body containing a malformed record", async () => {
    const store = createStore();
    const response = await call(
      post("/v1/metadata/publish", {
        metadata: [record, { ...record, url: "https://evil.example.com" }],
      }),
      { CACHE: store },
    );

    expect(response.status).toBe(400);
    expect(store.data.size).toBe(0);
  });

  it("refuses a lookup for something that is not a repository name", async () => {
    const env: WorkerEnv = { CACHE: createStore() };

    expect(
      (await call(post("/v1/metadata/lookup", { repositories: ["../../etc"] }), env))
        .status,
    ).toBe(400);
    expect(
      (await call(post("/v1/metadata/lookup", { repositories: "everything" }), env))
        .status,
    ).toBe(400);
  });

  it("refuses batches larger than the documented cap", async () => {
    const env: WorkerEnv = { CACHE: createStore() };
    const response = await call(
      post("/v1/metadata/lookup", {
        repositories: new Array(501).fill("mastra-ai/mastra"),
      }),
      env,
    );

    expect(response.status).toBe(400);
  });

  it("ignores an entry that was corrupted in storage", async () => {
    const store = createStore();
    store.data.set("metadata:mastra-ai/mastra", "{ not json");

    const looked = await call(
      post("/v1/metadata/lookup", { repositories: ["mastra-ai/mastra"] }),
      { CACHE: store },
    );

    expect(looked.status).toBe(200);
    expect(looked.body.metadata).toEqual([]);
  });

  it("answers health checks, preflights, wrong methods, and unknown paths", async () => {
    const env: WorkerEnv = { CACHE: createStore() };

    const health = await call(
      new Request("https://cache.example.com/health"),
      env,
    );
    expect(health.status).toBe(200);
    expect(health.body).toEqual({ ok: true, ttlSeconds: SHARED_CACHE_TTL_SECONDS });

    const preflight = await handleCacheRequest(
      new Request("https://cache.example.com/v1/metadata/lookup", {
        method: "OPTIONS",
      }),
      env,
    );
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("Access-Control-Allow-Origin")).toBe("*");

    expect(
      (
        await call(
          new Request("https://cache.example.com/v1/metadata/lookup"),
          env,
        )
      ).status,
    ).toBe(405);
    expect(
      (await call(new Request("https://cache.example.com/nope"), env)).status,
    ).toBe(404);
  });

  it("rejects a body that is not valid JSON", async () => {
    const response = await call(
      new Request("https://cache.example.com/v1/metadata/lookup", {
        method: "POST",
        body: "{",
      }),
      { CACHE: createStore() },
    );

    expect(response.status).toBe(400);
  });

  it("keeps working when the store itself throws", async () => {
    const failing: CacheKeyValueStore = {
      async get() {
        throw new Error("KV is down");
      },
      async put() {
        throw new Error("KV is down");
      },
    };

    const looked = await call(
      post("/v1/metadata/lookup", { repositories: ["mastra-ai/mastra"] }),
      { CACHE: failing },
    );
    const published = await call(
      post("/v1/metadata/publish", { metadata: [record] }),
      { CACHE: failing },
    );

    expect(looked.body.metadata).toEqual([]);
    expect(published.body).toEqual({ stored: 0 });
  });
});
