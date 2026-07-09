import { describe, expect, it } from "vitest";

import { parseGitHubRepositoryPage } from "./github-page";

describe("parseGitHubRepositoryPage", () => {
  it("reads repository pages and rejects non-repository GitHub routes", () => {
    expect(
      parseGitHubRepositoryPage(
        "https://github.com/sindresorhus/awesome#readme",
      ),
    ).toEqual({ owner: "sindresorhus", name: "awesome" });

    expect(parseGitHubRepositoryPage("https://github.com/settings/profile")).toBe(
      null,
    );
    expect(parseGitHubRepositoryPage("https://example.com/org/repo")).toBe(null);
    expect(parseGitHubRepositoryPage("not a URL")).toBe(null);
  });
});
