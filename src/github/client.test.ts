import { describe, expect, it } from "vitest";

import { fetchRepositoryMetadataBatch, fetchRepositoryReadme } from "./client";
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
