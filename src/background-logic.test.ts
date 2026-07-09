import { describe, expect, it } from "vitest";

import { normalizeRepositoryNames } from "./background-logic";

describe("normalizeRepositoryNames", () => {
  it("validates and case-insensitively deduplicates page-supplied repositories", () => {
    expect(
      normalizeRepositoryNames(
        ["vitejs/vite", "VITEJS/VITE", "facebook/react"],
        5_000,
      ).map((repository) => repository.nameWithOwner),
    ).toEqual(["vitejs/vite", "facebook/react"]);

    expect(() => normalizeRepositoryNames(["settings/profile"], 5_000)).toThrow(
      "Invalid repository name",
    );
  });
});
