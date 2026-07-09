import { describe, expect, it } from "vitest";

import {
  buildRepositoryMetadataQuery,
  parseRepositoryMetadataResponse,
} from "./graphql";
import type { RepositoryRef } from "../domain/types";

describe("buildRepositoryMetadataQuery", () => {
  it("builds one aliased repository query with exact maintenance fields", () => {
    const repositories: RepositoryRef[] = [
      createRepository("mastra-ai/mastra"),
      createRepository("langchain-ai/langchain"),
    ];

    const request = buildRepositoryMetadataQuery(repositories);

    expect(request.variables).toEqual({
      owner0: "mastra-ai",
      name0: "mastra",
      owner1: "langchain-ai",
      name1: "langchain",
    });
    expect(request.query).toContain(
      "r0: repository(owner: $owner0, name: $name0)",
    );
    expect(request.query).toContain(
      "r1: repository(owner: $owner1, name: $name1)",
    );
    expect(request.query).toContain("issues(states: OPEN)");
    expect(request.query).toContain("committedDate");
  });

  it("maps GitHub repository data into sortable metadata", () => {
    const repositories = [createRepository("mastra-ai/mastra")];
    const response = {
      data: {
        r0: {
          nameWithOwner: "mastra-ai/mastra",
          url: "https://github.com/mastra-ai/mastra",
          description: "Build AI applications and agents.",
          stargazerCount: 20_000,
          forkCount: 1_500,
          isArchived: false,
          issues: { totalCount: 125 },
          defaultBranchRef: {
            target: { committedDate: "2026-07-08T12:00:00Z" },
          },
          licenseInfo: { spdxId: "Apache-2.0" },
        },
        rateLimit: { remaining: 4_900, resetAt: "2026-07-09T13:00:00Z" },
      },
    };

    expect(
      parseRepositoryMetadataResponse(
        response,
        repositories,
        "2026-07-09T12:00:00Z",
      ),
    ).toEqual({
      metadata: [
        {
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
        },
      ],
      missing: [],
      rateLimit: { remaining: 4_900, resetAt: "2026-07-09T13:00:00Z" },
    });
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
