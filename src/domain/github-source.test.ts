import { describe, expect, it } from "vitest";

import { normalizeGitHubRawUrl } from "./github-source";

describe("normalizeGitHubRawUrl", () => {
  it("keeps an exact raw file while restricting it to the active repository", () => {
    const repository = { owner: "andyrewlee", name: "awesome-agent-orchestrators" };

    expect(
      normalizeGitHubRawUrl(
        "https://github.com/andyrewlee/awesome-agent-orchestrators/raw/refs/heads/main/docs/awesome.md",
        repository,
      ),
    ).toBe(
      "https://raw.githubusercontent.com/andyrewlee/awesome-agent-orchestrators/refs/heads/main/docs/awesome.md",
    );
    expect(
      normalizeGitHubRawUrl(
        "https://raw.githubusercontent.com/other/repository/main/README.md",
        repository,
      ),
    ).toBe(null);
  });
});
