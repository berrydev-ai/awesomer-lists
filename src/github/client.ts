import type { RepositoryRef } from "../domain/types";
import {
  buildRepositoryMetadataQuery,
  parseRepositoryMetadataResponse,
  type ParsedMetadataResponse,
} from "./graphql";

const GRAPHQL_ENDPOINT = "https://api.github.com/graphql";
const REST_API_VERSION = "2026-03-10";

export type GitHubErrorCode =
  | "AUTH_REQUIRED"
  | "INVALID_TOKEN"
  | "RATE_LIMITED"
  | "GITHUB_ERROR";

export interface GitHubClientError extends Error {
  code: GitHubErrorCode;
}

function createClientError(
  code: GitHubErrorCode,
  message: string,
): GitHubClientError {
  return Object.assign(new Error(message), { code });
}

/**
 * Identifies the safe error shape returned by GitHub client functions.
 */
export function isGitHubClientError(
  error: unknown,
): error is GitHubClientError {
  return (
    error instanceof Error &&
    "code" in error &&
    ["AUTH_REQUIRED", "INVALID_TOKEN", "RATE_LIMITED", "GITHUB_ERROR"].includes(
      String(error.code),
    )
  );
}

function authorizationHeaders(token: string): Record<string, string> {
  if (!token.trim()) {
    throw createClientError(
      "AUTH_REQUIRED",
      "Add a dedicated GitHub token to load repository data.",
    );
  }

  return { Authorization: `Bearer ${token.trim()}` };
}

async function assertSuccessfulResponse(response: Response): Promise<void> {
  if (response.ok) return;

  if (response.status === 401) {
    throw createClientError(
      "INVALID_TOKEN",
      "GitHub rejected the token. Check it and try again.",
    );
  }

  if (response.status === 403 || response.status === 429) {
    throw createClientError(
      "RATE_LIMITED",
      "GitHub is rate limiting this token. Wait for the reset time and retry.",
    );
  }

  throw createClientError(
    "GITHUB_ERROR",
    `GitHub returned HTTP ${response.status}.`,
  );
}

function readGraphqlErrors(value: unknown): string[] {
  if (typeof value !== "object" || value === null || !("errors" in value)) {
    return [];
  }

  const errors = (value as { errors?: unknown }).errors;

  if (!Array.isArray(errors)) return [];

  return errors
    .map((error) =>
      typeof error === "object" &&
      error !== null &&
      "message" in error &&
      typeof error.message === "string"
        ? error.message
        : null,
    )
    .filter((message): message is string => message !== null);
}

/**
 * Confirms that a GitHub token is accepted without exposing it to page code.
 */
export async function validateGitHubToken(
  token: string,
  fetchImplementation: typeof fetch = fetch,
): Promise<string> {
  const response = await fetchImplementation(GRAPHQL_ENDPOINT, {
    method: "POST",
    headers: {
      ...authorizationHeaders(token),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query: "query TokenCheck { viewer { login } }" }),
  });
  await assertSuccessfulResponse(response);

  const payload: unknown = await response.json();
  const errors = readGraphqlErrors(payload);

  if (errors.length > 0) {
    throw createClientError("INVALID_TOKEN", errors[0] ?? "Invalid token.");
  }

  if (
    typeof payload !== "object" ||
    payload === null ||
    !("data" in payload) ||
    typeof payload.data !== "object" ||
    payload.data === null ||
    !("viewer" in payload.data) ||
    typeof payload.data.viewer !== "object" ||
    payload.data.viewer === null ||
    !("login" in payload.data.viewer) ||
    typeof payload.data.viewer.login !== "string"
  ) {
    throw createClientError("GITHUB_ERROR", "GitHub returned an invalid login.");
  }

  return payload.data.viewer.login;
}

/**
 * Loads the preferred repository README as raw Markdown.
 */
export async function fetchRepositoryReadme(
  repository: RepositoryRef,
  token: string,
  fetchImplementation: typeof fetch = fetch,
): Promise<string> {
  const endpoint = `https://api.github.com/repos/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.name)}/readme`;
  const response = await fetchImplementation(endpoint, {
    headers: {
      ...authorizationHeaders(token),
      Accept: "application/vnd.github.raw+json",
      "X-GitHub-Api-Version": REST_API_VERSION,
    },
  });
  await assertSuccessfulResponse(response);
  return response.text();
}

/**
 * Loads exact repository metadata for one GraphQL-sized batch.
 */
export async function fetchRepositoryMetadataBatch(
  repositories: readonly RepositoryRef[],
  token: string,
  fetchImplementation: typeof fetch = fetch,
): Promise<ParsedMetadataResponse> {
  const request = buildRepositoryMetadataQuery(repositories);
  const response = await fetchImplementation(GRAPHQL_ENDPOINT, {
    method: "POST",
    headers: {
      ...authorizationHeaders(token),
      "Content-Type": "application/json",
    },
    body: JSON.stringify(request),
  });
  await assertSuccessfulResponse(response);

  const payload: unknown = await response.json();
  const errors = readGraphqlErrors(payload);

  if (errors.length > 0) {
    throw createClientError(
      "GITHUB_ERROR",
      errors[0] ?? "GitHub could not load repository metadata.",
    );
  }

  return parseRepositoryMetadataResponse(
    payload,
    repositories,
    new Date().toISOString(),
  );
}
