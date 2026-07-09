import type { RepositoryMetadata, RepositoryRef } from "../domain/types";

export interface GraphqlRequest {
  query: string;
  variables: Record<string, string>;
}

export interface RateLimitInfo {
  remaining: number;
  resetAt: string;
}

export interface ParsedMetadataResponse {
  metadata: RepositoryMetadata[];
  missing: string[];
  rateLimit: RateLimitInfo | null;
}

const REPOSITORY_FIELDS = `
    nameWithOwner
    url
    description
    stargazerCount
    forkCount
    isArchived
    issues(states: OPEN) { totalCount }
    defaultBranchRef {
      target {
        ... on Commit { committedDate }
      }
    }
    licenseInfo { spdxId }
  `;

/**
 * Creates a batched GraphQL query without placing repository names in query text.
 */
export function buildRepositoryMetadataQuery(
  repositories: readonly RepositoryRef[],
): GraphqlRequest {
  if (repositories.length === 0) {
    throw new Error("At least one repository is required.");
  }

  const definitions: string[] = [];
  const selections: string[] = [];
  const variables: Record<string, string> = {};

  repositories.forEach((repository, index) => {
    definitions.push(`$owner${index}: String!`, `$name${index}: String!`);
    selections.push(`
      r${index}: repository(owner: $owner${index}, name: $name${index}) {
        ${REPOSITORY_FIELDS}
      }
    `);
    variables[`owner${index}`] = repository.owner;
    variables[`name${index}`] = repository.name;
  });

  return {
    query: `
      query AwesomerRepositoryMetadata(${definitions.join(", ")}) {
        ${selections.join("\n")}
        rateLimit { remaining resetAt }
      }
    `,
    variables,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function parseRepository(
  value: unknown,
  fetchedAt: string,
): RepositoryMetadata | null {
  if (!isRecord(value)) return null;

  const issues = isRecord(value.issues) ? value.issues : null;
  const defaultBranch = isRecord(value.defaultBranchRef)
    ? value.defaultBranchRef
    : null;
  const target = defaultBranch && isRecord(defaultBranch.target)
    ? defaultBranch.target
    : null;
  const licenseInfo = isRecord(value.licenseInfo) ? value.licenseInfo : null;

  if (
    typeof value.nameWithOwner !== "string" ||
    typeof value.url !== "string" ||
    typeof value.stargazerCount !== "number" ||
    typeof value.forkCount !== "number" ||
    typeof value.isArchived !== "boolean" ||
    typeof issues?.totalCount !== "number"
  ) {
    return null;
  }

  return {
    nameWithOwner: value.nameWithOwner,
    url: value.url,
    description: optionalString(value.description),
    stars: value.stargazerCount,
    forks: value.forkCount,
    openIssues: issues.totalCount,
    lastCommitAt: optionalString(target?.committedDate),
    license: optionalString(licenseInfo?.spdxId),
    isArchived: value.isArchived,
    fetchedAt,
  };
}

/**
 * Validates and maps GitHub's untrusted GraphQL response into extension data.
 */
export function parseRepositoryMetadataResponse(
  response: unknown,
  repositories: readonly RepositoryRef[],
  fetchedAt: string,
): ParsedMetadataResponse {
  if (!isRecord(response) || !isRecord(response.data)) {
    throw new Error("GitHub returned an invalid metadata response.");
  }

  const data = response.data;
  const metadata: RepositoryMetadata[] = [];
  const missing: string[] = [];

  repositories.forEach((repository, index) => {
    const item = parseRepository(data[`r${index}`], fetchedAt);

    if (item) {
      metadata.push(item);
    } else {
      missing.push(repository.nameWithOwner);
    }
  });

  const rateLimitValue = data.rateLimit;
  const rateLimit =
    isRecord(rateLimitValue) &&
    typeof rateLimitValue.remaining === "number" &&
    typeof rateLimitValue.resetAt === "string"
      ? {
          remaining: rateLimitValue.remaining,
          resetAt: rateLimitValue.resetAt,
        }
      : null;

  return { metadata, missing, rateLimit };
}
