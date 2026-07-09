import { describe, expect, it } from "vitest";

import { buildTableGroups } from "./table-model";
import type { AwesomeEntry, RepositoryMetadata } from "./types";

describe("buildTableGroups", () => {
  it("keeps section order while sorting projects within each section", () => {
    const entries: AwesomeEntry[] = [
      createEntry("vitejs/vite", ["Frameworks"]),
      createEntry("facebook/react", ["Frameworks"]),
      createEntry("sindresorhus/awesome", ["Resources"]),
    ];
    const metadata: RepositoryMetadata[] = [
      createMetadata("vitejs/vite", 10),
      createMetadata("facebook/react", 20),
      createMetadata("sindresorhus/awesome", 30),
    ];

    const groups = buildTableGroups(entries, metadata, {
      query: "",
      hideArchived: false,
      updatedWithinDays: null,
      sort: { field: "stars", direction: "desc" },
      now: new Date("2026-07-09T12:00:00Z"),
    });

    expect(groups.map((group) => group.label)).toEqual([
      "Frameworks",
      "Resources",
    ]);
    expect(groups[0]?.rows.map((row) => row.repository.nwo)).toEqual([
      "facebook/react",
      "vitejs/vite",
    ]);
  });

  it("searches project names, descriptions, repositories, and sections", () => {
    const entries: AwesomeEntry[] = [
      createEntry("vitejs/vite", ["Build tools"]),
      createEntry("facebook/react", ["User interfaces"]),
    ];
    entries[0] = { ...entries[0]!, description: "Frontend build tool" };

    const groups = buildTableGroups(entries, [], {
      query: "frontend",
      hideArchived: false,
      updatedWithinDays: null,
      sort: { field: "name", direction: "asc" },
      now: new Date("2026-07-09T12:00:00Z"),
    });

    expect(groups.flatMap((group) => group.rows)).toHaveLength(1);
    expect(groups[0]?.rows[0]?.repository.nwo).toBe("vitejs/vite");
  });

  it("filters out archived projects and projects older than the freshness limit", () => {
    const entries = [
      createEntry("vitejs/vite", ["Frameworks"]),
      createEntry("facebook/react", ["Frameworks"]),
      createEntry("sindresorhus/awesome", ["Frameworks"]),
    ];
    const metadata = [
      createMetadata("vitejs/vite", 10),
      { ...createMetadata("facebook/react", 20), isArchived: true },
      {
        ...createMetadata("sindresorhus/awesome", 30),
        lastCommitAt: "2024-01-01T12:00:00Z",
      },
    ];

    const groups = buildTableGroups(entries, metadata, {
      query: "",
      hideArchived: true,
      updatedWithinDays: 365,
      sort: { field: "stars", direction: "desc" },
      now: new Date("2026-07-09T12:00:00Z"),
    });

    expect(groups[0]?.rows.map((row) => row.repository.nwo)).toEqual([
      "vitejs/vite",
    ]);
  });
});

function createEntry(nwo: string, sectionPath: string[]): AwesomeEntry {
  const [owner = "", name = ""] = nwo.split("/");
  const url = `https://github.com/${nwo}`;

  return {
    title: name,
    description: `${name} project`,
    repository: { owner, name, nwo, url },
    sectionPath,
    sourceUrl: url,
  };
}

function createMetadata(nwo: string, stars: number): RepositoryMetadata {
  return {
    nwo,
    url: `https://github.com/${nwo}`,
    description: null,
    stars,
    forks: 0,
    openIssues: 0,
    lastCommitAt: "2026-07-01T12:00:00Z",
    license: null,
    isArchived: false,
    fetchedAt: "2026-07-09T12:00:00Z",
  };
}
