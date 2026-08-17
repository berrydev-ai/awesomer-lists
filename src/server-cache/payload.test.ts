import { describe, expect, it } from "vitest";

import type { RepositoryMetadata } from "../domain/types";
import {
  MAX_LOOKUP_REPOSITORIES,
  acceptMetadataResponse,
  isRepositoryName,
  parseLookupRequest,
  parseMetadataRecord,
  parsePublishRequest,
  sharedCacheKey,
} from "./payload";

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

describe("shared cache payloads", () => {
  it("treats repository names case-insensitively for storage", () => {
    expect(sharedCacheKey("Mastra-AI/Mastra")).toBe(
      sharedCacheKey("mastra-ai/mastra"),
    );
  });

  it("rejects names that are not a plain owner and repository pair", () => {
    expect(isRepositoryName("mastra-ai/mastra")).toBe(true);
    expect(isRepositoryName("mastra-ai/mastra/tree/main")).toBe(false);
    expect(isRepositoryName("../etc/passwd")).toBe(false);
    expect(isRepositoryName("mastra-ai")).toBe(false);
    expect(isRepositoryName("")).toBe(false);
    expect(isRepositoryName(42)).toBe(false);
  });

  it("accepts a well-formed metadata record", () => {
    expect(parseMetadataRecord(record)).toEqual(record);
    expect(parseMetadataRecord({ ...record, description: null })).not.toBeNull();
    expect(parseMetadataRecord({ ...record, lastCommitAt: null })).not.toBeNull();
  });

  it("refuses a record whose url does not match the repository it names", () => {
    expect(
      parseMetadataRecord({ ...record, url: "https://evil.example.com/x" }),
    ).toBeNull();
    expect(
      parseMetadataRecord({
        ...record,
        url: "javascript:alert(1)" as unknown as string,
      }),
    ).toBeNull();
  });

  it("refuses records with impossible counts or wrong types", () => {
    expect(parseMetadataRecord({ ...record, stars: -1 })).toBeNull();
    expect(parseMetadataRecord({ ...record, stars: 1.5 })).toBeNull();
    expect(parseMetadataRecord({ ...record, forks: Number.NaN })).toBeNull();
    expect(parseMetadataRecord({ ...record, isArchived: "yes" })).toBeNull();
    expect(parseMetadataRecord({ ...record, fetchedAt: "not a date" })).toBeNull();
    expect(
      parseMetadataRecord({ ...record, description: "x".repeat(1_001) }),
    ).toBeNull();
    expect(parseMetadataRecord(null)).toBeNull();
  });

  it("reads a lookup body and refuses oversized or invalid ones", () => {
    expect(parseLookupRequest({ repositories: ["a/b", "c/d"] })).toEqual([
      "a/b",
      "c/d",
    ]);
    expect(parseLookupRequest({ repositories: [] })).toEqual([]);
    expect(parseLookupRequest({ repositories: ["a/b", "nope"] })).toBeNull();
    expect(
      parseLookupRequest({
        repositories: new Array(MAX_LOOKUP_REPOSITORIES + 1).fill("a/b"),
      }),
    ).toBeNull();
    expect(parseLookupRequest({})).toBeNull();
  });

  it("rejects an entire publish body when any record is malformed", () => {
    expect(parsePublishRequest({ metadata: [record] })).toEqual([record]);
    expect(
      parsePublishRequest({ metadata: [record, { ...record, stars: -5 }] }),
    ).toBeNull();
  });

  it("keeps only valid, requested, and unique records from a response", () => {
    const other = {
      ...record,
      nameWithOwner: "vercel/next.js",
      url: "https://github.com/vercel/next.js",
    };
    const accepted = acceptMetadataResponse(
      {
        metadata: [
          record,
          record,
          other,
          { ...record, nameWithOwner: "attacker/injected" },
          { ...record, stars: "many" },
        ],
      },
      ["mastra-ai/mastra", "vercel/next.js"],
    );

    expect(accepted.map((item) => item.nameWithOwner)).toEqual([
      "mastra-ai/mastra",
      "vercel/next.js",
    ]);
  });

  it("returns nothing for a response that is not a metadata envelope", () => {
    expect(acceptMetadataResponse(null, ["a/b"])).toEqual([]);
    expect(acceptMetadataResponse({ metadata: "everything" }, ["a/b"])).toEqual([]);
  });
});
