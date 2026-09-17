import { describe, expect, it, vi } from "vitest";

import {
  fetchRepositoryMetadataBatch,
  fetchRepositoryReadme,
  isGitHubClientError,
} from "./client";
import type { RepositoryRef } from "../domain/types";

describe("fetchRepositoryReadme", () => {
  it("fetches an exact raw source without sending the GitHub token to the raw host", async () => {
    const repository = createRepository("andyrewlee/awesome-agent-orchestrators");
    const sourceUrl =
      "https://raw.githubusercontent.com/andyrewlee/awesome-agent-orchestrators/refs/heads/main/docs/awesome.md";
    let requestedUrl = "";
    let requestedHeaders = new Headers();

    const markdown = await fetchRepositoryReadme(
      repository,
      "dedicated-token-value-for-test",
      {
        sourceUrl,
        fetchImplementation: async (input, init) => {
          requestedUrl = String(input);
          requestedHeaders = new Headers(init?.headers);
          return new Response("# Awesome Agents", { status: 200 });
        },
      },
    );

    expect(markdown).toBe("# Awesome Agents");
    expect(requestedUrl).toBe(sourceUrl);
    expect(requestedHeaders.has("Authorization")).toBe(false);
  });

  it.each([200, 403])(
    "times out when an HTTP %s response body stalls",
    async (status) => {
      vi.useFakeTimers();

      try {
        const requestState: { signal?: AbortSignal } = {};
        const response = new Response(null, { status });
        vi.spyOn(response, "text").mockImplementation(
          () => new Promise<string>(() => undefined),
        );

        const request = fetchRepositoryReadme(
          createRepository("azu/cmux-hub"),
          "dedicated-token-value-for-test",
          {
            sourceUrl: "https://raw.githubusercontent.com/azu/cmux-hub/main/README.md",
            fetchImplementation: async (_input, init) => {
              if (init?.signal) requestState.signal = init.signal;
              return response;
            },
          },
        );
        const rejection = expect(request).rejects.toMatchObject({
          code: "GITHUB_ERROR",
          message: "GitHub did not respond before the request timed out.",
        });

        await vi.advanceTimersByTimeAsync(15_000);
        await rejection;
        expect(requestState.signal?.aborted).toBe(true);
      } finally {
        vi.useRealTimers();
      }
    },
  );
});

describe("fetchRepositoryMetadataBatch", () => {
  it("keeps valid metadata when GitHub reports a missing repository", async () => {
    const repositories = [
      createRepository("azu/cmux-hub"),
      createRepository("adhvaay-karnwal/cmux"),
    ];
    const response = {
      data: {
        r0: {
          nameWithOwner: "azu/cmux-hub",
          url: "https://github.com/azu/cmux-hub",
          description: "Review coding-agent sessions.",
          stargazerCount: 23,
          forkCount: 2,
          isArchived: false,
          issues: { totalCount: 1 },
          defaultBranchRef: {
            target: { committedDate: "2026-07-09T12:00:00Z" },
          },
          licenseInfo: { spdxId: "MIT" },
        },
        r1: null,
        rateLimit: { remaining: 4_945, resetAt: "2026-07-10T15:29:46Z" },
      },
      errors: [
        {
          type: "NOT_FOUND",
          path: ["r1"],
          message:
            "Could not resolve to a Repository with the name 'adhvaay-karnwal/cmux'.",
        },
      ],
    };

    const result = await fetchRepositoryMetadataBatch(
      repositories,
      "dedicated-token-value-for-test",
      async () => Response.json(response),
    );

    expect(result.metadata.map((item) => item.nameWithOwner)).toEqual([
      "azu/cmux-hub",
    ]);
    expect(result.missing).toEqual(["adhvaay-karnwal/cmux"]);
  });

  it("still rejects GraphQL errors that are not missing repositories", async () => {
    const response = {
      data: { r0: null, rateLimit: null },
      errors: [
        {
          type: "FORBIDDEN",
          path: ["r0"],
          message: "Repository metadata is not accessible.",
        },
      ],
    };

    await expect(
      fetchRepositoryMetadataBatch(
        [createRepository("azu/cmux-hub")],
        "dedicated-token-value-for-test",
        async () => Response.json(response),
      ),
    ).rejects.toThrow("Repository metadata is not accessible.");
  });

  it("exposes the HTTP rate-limit reset time for cache pacing", async () => {
    const resetSeconds = 1_800_000_000;

    try {
      await fetchRepositoryMetadataBatch(
        [createRepository("azu/cmux-hub")],
        "dedicated-token-value-for-test",
        async () =>
          new Response("rate limited", {
            status: 429,
            headers: {
              "x-ratelimit-remaining": "0",
              "x-ratelimit-reset": String(resetSeconds),
            },
          }),
      );
      expect.unreachable("Expected GitHub to reject the request.");
    } catch (error) {
      expect(isGitHubClientError(error)).toBe(true);
      if (isGitHubClientError(error)) {
        expect(error.code).toBe("RATE_LIMITED");
        expect(error.retryAt).toBe(resetSeconds * 1_000);
      }
    }
  });

  it("uses Retry-After ahead of the primary rate-limit reset", async () => {
    const startedAt = Date.now();

    try {
      await fetchRepositoryMetadataBatch(
        [createRepository("azu/cmux-hub")],
        "dedicated-token-value-for-test",
        async () =>
          Response.json(
            { message: "You have exceeded a secondary rate limit." },
            {
              status: 403,
              headers: {
                "retry-after": "60",
                "x-ratelimit-remaining": "0",
                "x-ratelimit-reset": "1800000000",
              },
            },
          ),
      );
      expect.unreachable("Expected GitHub to reject the request.");
    } catch (error) {
      expect(isGitHubClientError(error)).toBe(true);
      if (isGitHubClientError(error)) {
        expect(error.code).toBe("RATE_LIMITED");
        expect(error.retryAt).toBeGreaterThanOrEqual(startedAt + 60_000);
        expect(error.retryAt).toBeLessThanOrEqual(Date.now() + 60_000);
      }
    }
  });

  it("keeps ordinary forbidden responses out of the rate-limit path", async () => {
    try {
      await fetchRepositoryMetadataBatch(
        [createRepository("azu/cmux-hub")],
        "dedicated-token-value-for-test",
        async () =>
          Response.json(
            { message: "Resource not accessible by integration." },
            {
              status: 403,
              headers: {
                "x-ratelimit-remaining": "42",
                "x-ratelimit-reset": "1800000000",
              },
            },
          ),
      );
      expect.unreachable("Expected GitHub to reject the request.");
    } catch (error) {
      expect(isGitHubClientError(error)).toBe(true);
      if (isGitHubClientError(error)) {
        expect(error.code).toBe("GITHUB_ERROR");
        expect(error.retryAt).toBeUndefined();
      }
    }
  });

  it("recognizes a rate-limit message on a 403 without rate headers", async () => {
    await expect(
      fetchRepositoryMetadataBatch(
        [createRepository("azu/cmux-hub")],
        "dedicated-token-value-for-test",
        async () =>
          Response.json(
            { message: "API rate limit exceeded." },
            { status: 403 },
          ),
      ),
    ).rejects.toMatchObject({ code: "RATE_LIMITED" });
  });

  it("classifies GraphQL RATE_LIMITED errors and keeps their reset time", async () => {
    const resetAt = "2027-01-15T12:00:00.000Z";

    try {
      await fetchRepositoryMetadataBatch(
        [createRepository("azu/cmux-hub")],
        "dedicated-token-value-for-test",
        async () =>
          Response.json({
            data: {
              r0: null,
              rateLimit: { remaining: 0, resetAt },
            },
            errors: [
              {
                type: "RATE_LIMITED",
                path: ["r0"],
                message: "API rate limit exceeded.",
              },
            ],
          }),
      );
      expect.unreachable("Expected GitHub to reject the request.");
    } catch (error) {
      expect(isGitHubClientError(error)).toBe(true);
      if (isGitHubClientError(error)) {
        expect(error.code).toBe("RATE_LIMITED");
        expect(error.retryAt).toBe(Date.parse(resetAt));
      }
    }
  });
});

function createRepository(nameWithOwner: string): RepositoryRef {
  const [owner = "", name = ""] = nameWithOwner.split("/");

  return {
    owner,
    name,
    nameWithOwner,
    url: `https://github.com/${nameWithOwner}`,
  };
}
