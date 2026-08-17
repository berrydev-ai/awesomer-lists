import type { RepositoryMetadata } from "../domain/types";

/** Shared cache entries stay usable for seven days. */
export const SHARED_CACHE_TTL_SECONDS = 7 * 24 * 60 * 60;
export const SHARED_CACHE_TTL_MILLISECONDS = SHARED_CACHE_TTL_SECONDS * 1_000;

/** One lookup request may ask about this many repositories. */
export const MAX_LOOKUP_REPOSITORIES = 500;
/** One publish request may carry this many metadata records. */
export const MAX_PUBLISH_RECORDS = 500;

const REPOSITORY_NAME_PATTERN =
  /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}\/[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
const MAX_DESCRIPTION_LENGTH = 1_000;
const MAX_LICENSE_LENGTH = 100;
const MAX_COUNT = 100_000_000;

export interface SharedCacheEntry {
  value: RepositoryMetadata;
  expiresAt: number;
}

/**
 * Builds the storage key for a repository, so `Owner/Repo` and `owner/repo`
 * share one entry.
 */
export function sharedCacheKey(nameWithOwner: string): string {
  return `metadata:${nameWithOwner.toLowerCase()}`;
}

/**
 * Confirms a value is a `owner/name` pair that GitHub could actually address.
 */
export function isRepositoryName(value: unknown): value is string {
  return typeof value === "string" && REPOSITORY_NAME_PATTERN.test(value);
}

function isIsoTimestamp(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length <= 40 &&
    !Number.isNaN(Date.parse(value))
  );
}

function isCount(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 0 &&
    value <= MAX_COUNT
  );
}

function isBoundedText(value: unknown, maximum: number): value is string | null {
  return (
    value === null || (typeof value === "string" && value.length <= maximum)
  );
}

/**
 * Validates one metadata record. Both sides of the shared cache use this: the
 * server refuses to store anything malformed, and the extension refuses to
 * display anything a server hands back that does not match the same shape.
 */
export function parseMetadataRecord(value: unknown): RepositoryMetadata | null {
  if (typeof value !== "object" || value === null) return null;

  const record = value as Record<string, unknown>;

  if (
    !isRepositoryName(record.nameWithOwner) ||
    record.url !== `https://github.com/${record.nameWithOwner}` ||
    !isBoundedText(record.description, MAX_DESCRIPTION_LENGTH) ||
    !isCount(record.stars) ||
    !isCount(record.forks) ||
    !isCount(record.openIssues) ||
    !(record.lastCommitAt === null || isIsoTimestamp(record.lastCommitAt)) ||
    !isBoundedText(record.license, MAX_LICENSE_LENGTH) ||
    typeof record.isArchived !== "boolean" ||
    !isIsoTimestamp(record.fetchedAt)
  ) {
    return null;
  }

  return {
    nameWithOwner: record.nameWithOwner,
    url: record.url,
    description: record.description,
    stars: record.stars,
    forks: record.forks,
    openIssues: record.openIssues,
    lastCommitAt: record.lastCommitAt,
    license: record.license,
    isArchived: record.isArchived,
    fetchedAt: record.fetchedAt,
  };
}

/**
 * Reads a `{ repositories: [...] }` request body, dropping nothing silently.
 */
export function parseLookupRequest(value: unknown): string[] | null {
  if (typeof value !== "object" || value === null) return null;

  const names = (value as { repositories?: unknown }).repositories;

  if (
    !Array.isArray(names) ||
    names.length > MAX_LOOKUP_REPOSITORIES ||
    !names.every(isRepositoryName)
  ) {
    return null;
  }

  return names;
}

/**
 * Reads a `{ metadata: [...] }` request body.
 */
export function parsePublishRequest(
  value: unknown,
): RepositoryMetadata[] | null {
  if (typeof value !== "object" || value === null) return null;

  const records = (value as { metadata?: unknown }).metadata;

  if (!Array.isArray(records) || records.length > MAX_PUBLISH_RECORDS) {
    return null;
  }

  const parsed = records.map(parseMetadataRecord);

  return parsed.every((record): record is RepositoryMetadata => record !== null)
    ? parsed
    : null;
}

/**
 * Keeps only the records a response is allowed to contribute: valid shape,
 * unexpired, and actually asked for.
 */
export function acceptMetadataResponse(
  value: unknown,
  requested: readonly string[],
): RepositoryMetadata[] {
  if (typeof value !== "object" || value === null) return [];

  const records = (value as { metadata?: unknown }).metadata;

  if (!Array.isArray(records)) return [];

  const allowed = new Set(requested.map((name) => name.toLowerCase()));
  const seen = new Set<string>();
  const accepted: RepositoryMetadata[] = [];

  for (const item of records.slice(0, MAX_LOOKUP_REPOSITORIES)) {
    const record = parseMetadataRecord(item);

    if (!record) continue;

    const key = record.nameWithOwner.toLowerCase();

    if (!allowed.has(key) || seen.has(key)) continue;

    seen.add(key);
    accepted.push(record);
  }

  return accepted;
}
