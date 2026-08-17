import { describe, expect, it } from "vitest";

import type { RepositoryMetadata } from "../../src/domain/types";
import {
  lookupSharedMetadata,
  publishSharedMetadata,
} from "../../src/server-cache/client";
import {
  handleCacheRequest,
  type CacheKeyValueStore,
  type WorkerEnv,
} from "./worker";

/**
 * Drives the real worker with the real extension client, so a disagreement
 * about paths, bodies, or field names fails here instead of in production.
 */
function createServer(now: () => number): {
  fetch: typeof fetch;
  env: WorkerEnv;
} {
  const data = new Map<string, string>();
  const CACHE: CacheKeyValueStore = {
    async get(key) {
      return data.get(key) ?? null;
    },
    async put(key, value) {
      data.set(key, value);
    },
  };
  const env: WorkerEnv = { CACHE };

  const fetchImplementation = (async (input: string, init?: RequestInit) =>
    handleCacheRequest(new Request(input, init), env, now())) as typeof fetch;

  return { fetch: fetchImplementation, env };
}

function makeRecord(index: number, fetchedAt: string): RepositoryMetadata {
  const nameWithOwner = `owner${index}/repo${index}`;

  return {
    nameWithOwner,
    url: `https://github.com/${nameWithOwner}`,
    description: `Project number ${index}.`,
    stars: index * 10,
    forks: index,
    openIssues: index % 7,
    lastCommitAt: "2026-07-08T12:00:00Z",
    license: "MIT",
    isArchived: false,
    fetchedAt,
  };
}

const FETCHED_AT = "2026-07-09T12:00:00Z";
const NOW = Date.parse(FETCHED_AT);
const DAY = 24 * 60 * 60 * 1_000;

describe("extension and cache server round trip", () => {
  it("hands one person's results to the next person", async () => {
    let clock = NOW;
    const server = createServer(() => clock);
    const options = { fetchImplementation: server.fetch };
    const records = [makeRecord(1, FETCHED_AT), makeRecord(2, FETCHED_AT)];

    // The first visitor pays GitHub for the data and offers it back.
    const stored = await publishSharedMetadata(
      "https://cache.example.com",
      records,
      options,
    );
    expect(stored).toBe(2);

    // The next visitor opens a list containing the same projects.
    clock = NOW + DAY;
    const found = await lookupSharedMetadata(
      "https://cache.example.com",
      ["owner1/repo1", "owner2/repo2", "owner3/repo3"],
      options,
    );

    expect(found).toEqual(records);
  });

  it("stops sharing an entry after seven days", async () => {
    let clock = NOW;
    const server = createServer(() => clock);
    const options = { fetchImplementation: server.fetch };

    await publishSharedMetadata(
      "https://cache.example.com",
      [makeRecord(1, FETCHED_AT)],
      options,
    );

    clock = NOW + 7 * DAY - 1_000;
    const justInside = await lookupSharedMetadata(
      "https://cache.example.com",
      ["owner1/repo1"],
      options,
    );

    clock = NOW + 7 * DAY + 1_000;
    const justOutside = await lookupSharedMetadata(
      "https://cache.example.com",
      ["owner1/repo1"],
      options,
    );

    expect(justInside).toHaveLength(1);
    expect(justOutside).toEqual([]);
  });

  it("carries a list larger than one batch across the wire intact", async () => {
    const server = createServer(() => NOW);
    const options = { fetchImplementation: server.fetch };
    const records = Array.from({ length: 1_200 }, (_, index) =>
      makeRecord(index, FETCHED_AT),
    );

    expect(
      await publishSharedMetadata("https://cache.example.com", records, options),
    ).toBe(1_200);

    const found = await lookupSharedMetadata(
      "https://cache.example.com",
      records.map((record) => record.nameWithOwner),
      options,
    );

    expect(found).toHaveLength(1_200);
    expect(new Set(found.map((record) => record.nameWithOwner)).size).toBe(1_200);
  });

  it("gives the extension nothing when the server rejects a poisoned record", async () => {
    const server = createServer(() => NOW);
    const options = { fetchImplementation: server.fetch };
    const poisoned = {
      ...makeRecord(1, FETCHED_AT),
      url: "https://phishing.example.com/owner1/repo1",
    };

    expect(
      await publishSharedMetadata(
        "https://cache.example.com",
        [poisoned as RepositoryMetadata],
        options,
      ),
    ).toBe(0);
    expect(
      await lookupSharedMetadata(
        "https://cache.example.com",
        ["owner1/repo1"],
        options,
      ),
    ).toEqual([]);
  });
});
