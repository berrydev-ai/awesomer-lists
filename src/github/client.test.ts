import { describe, expect, it } from "vitest";

import { fetchRepositoryReadme } from "./client";
import type { RepositoryRef } from "../domain/types";

describe("fetchRepositoryReadme", () => {
  it("fetches an exact raw source without sending the GitHub token to the raw host", async () => {
    const repository = createRepository("andyrewlee/awesome-agent-orchestrators");
    const sourceUrl =
      "https://raw.githubusercontent.com/andyrewlee/awesome-agent-orchestrators/refs/heads/main/docs/awesome.md";
    let requestedUrl = "";
    let requestedHeaders = new Headers();

    const markdown = await fetchRepositoryReadme(repository, "github_pat_dedicated", {
      sourceUrl,
      fetchImplementation: async (input, init) => {
        requestedUrl = String(input);
        requestedHeaders = new Headers(init?.headers);
        return new Response("# Awesome Agents", { status: 200 });
      },
    });

    expect(markdown).toBe("# Awesome Agents");
    expect(requestedUrl).toBe(sourceUrl);
    expect(requestedHeaders.has("Authorization")).toBe(false);
  });
});

function createRepository(nameWithOwner: string): RepositoryRef {
  const [owner = "", name = ""] = nameWithOwner.split("/");

  return {
    owner,
    name,
    nameWithOwner: nameWithOwner,
    url: `https://github.com/${nameWithOwner}`,
  };
}
