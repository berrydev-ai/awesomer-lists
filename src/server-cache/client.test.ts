import { describe, expect, it, vi } from "vitest";

import type { RepositoryMetadata } from "../domain/types";
import { lookupSharedMetadata, publishSharedMetadata } from "./client";

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

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

type FetchCall = [string, RequestInit];

function requestAt(
  calls: readonly FetchCall[],
  index: number,
): [string, RequestInit] {
  const call = calls[index];

  if (!call) throw new Error(`No request was sent at index ${index}.`);
  return call;
}

function sentBody(
  calls: readonly FetchCall[],
  index: number,
): Record<string, unknown> {
  return JSON.parse(String(requestAt(calls, index)[1].body)) as Record<
    string,
    unknown
  >;
}

describe("shared cache lookup", () => {
  it("asks the configured server and returns the records it trusts", async () => {
    const fetchImplementation = vi.fn(
      async (_url: string, _init: RequestInit) =>
        jsonResponse({ metadata: [record] }),
    );
    const metadata = await lookupSharedMetadata(
      "https://cache.example.com",
      ["mastra-ai/mastra"],
      { fetchImplementation: fetchImplementation as unknown as typeof fetch },
    );

    expect(metadata).toEqual([record]);

    const [url, init] = requestAt(fetchImplementation.mock.calls, 0);
    expect(url).toBe("https://cache.example.com/v1/metadata/lookup");
    expect(init.method).toBe("POST");
    expect(init.credentials).toBe("omit");
    expect(sentBody(fetchImplementation.mock.calls, 0)).toEqual({
      repositories: ["mastra-ai/mastra"],
    });
  });

  it("never contacts a server when none is configured", async () => {
    const fetchImplementation = vi.fn();

    await expect(
      lookupSharedMetadata("", ["mastra-ai/mastra"], {
        fetchImplementation: fetchImplementation as unknown as typeof fetch,
      }),
    ).resolves.toEqual([]);
    expect(fetchImplementation).not.toHaveBeenCalled();
  });

  it("degrades to no records when the server fails, stalls, or lies", async () => {
    const cases: Array<() => Promise<Response>> = [
      async () => {
        throw new Error("offline");
      },
      async () => jsonResponse({ metadata: [record] }, 503),
      async () => new Response("<html>not json</html>", { status: 200 }),
      async () => jsonResponse({ metadata: [{ ...record, stars: -1 }] }),
    ];

    for (const implementation of cases) {
      await expect(
        lookupSharedMetadata("https://cache.example.com", ["mastra-ai/mastra"], {
          fetchImplementation: implementation as unknown as typeof fetch,
        }),
      ).resolves.toEqual([]);
    }
  });

  it("splits a long list into server-sized batches", async () => {
    const names = Array.from({ length: 1_100 }, (_, index) =>
      index < 550 ? `owner${index}/repo` : `other${index}/repo`,
    );
    const fetchImplementation = vi.fn(
      async (_url: string, _init: RequestInit) => jsonResponse({ metadata: [] }),
    );

    await lookupSharedMetadata("https://cache.example.com", names, {
      fetchImplementation: fetchImplementation as unknown as typeof fetch,
    });

    expect(fetchImplementation).toHaveBeenCalledTimes(3);
    const sizes = fetchImplementation.mock.calls.map(
      (_call, index) =>
        (sentBody(fetchImplementation.mock.calls, index).repositories as string[])
          .length,
    );
    expect(sizes).toEqual([500, 500, 100]);
  });

  it("abandons a request that outlives its timeout", async () => {
    const fetchImplementation = vi.fn(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new Error("aborted")),
          );
        }),
    );

    await expect(
      lookupSharedMetadata("https://cache.example.com", ["mastra-ai/mastra"], {
        fetchImplementation: fetchImplementation as unknown as typeof fetch,
        timeoutMilliseconds: 5,
      }),
    ).resolves.toEqual([]);
  });
});

describe("shared cache publish", () => {
  it("offers fresh records back and reports what was stored", async () => {
    const fetchImplementation = vi.fn(
      async (_url: string, _init: RequestInit) => jsonResponse({ stored: 1 }),
    );

    await expect(
      publishSharedMetadata("https://cache.example.com", [record], {
        fetchImplementation: fetchImplementation as unknown as typeof fetch,
      }),
    ).resolves.toBe(1);

    const [url] = requestAt(fetchImplementation.mock.calls, 0);
    expect(url).toBe("https://cache.example.com/v1/metadata/publish");
    expect(sentBody(fetchImplementation.mock.calls, 0)).toEqual({
      metadata: [record],
    });
  });

  it("stays quiet when there is nothing to publish or nowhere to publish it", async () => {
    const fetchImplementation = vi.fn();
    const options = {
      fetchImplementation: fetchImplementation as unknown as typeof fetch,
    };

    await expect(publishSharedMetadata("", [record], options)).resolves.toBe(0);
    await expect(
      publishSharedMetadata("https://cache.example.com", [], options),
    ).resolves.toBe(0);
    expect(fetchImplementation).not.toHaveBeenCalled();
  });

  it("reports nothing stored when the server refuses the write", async () => {
    await expect(
      publishSharedMetadata("https://cache.example.com", [record], {
        fetchImplementation: (async () =>
          jsonResponse({ error: "no" }, 500)) as unknown as typeof fetch,
      }),
    ).resolves.toBe(0);
  });
});
