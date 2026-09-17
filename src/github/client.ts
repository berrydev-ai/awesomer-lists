import type { RepositoryRef } from "../domain/types";
import {
  buildRepositoryMetadataQuery,
  parseRepositoryMetadataResponse,
  type ParsedMetadataResponse,
} from "./graphql";

const GRAPHQL_ENDPOINT = "https://api.github.com/graphql";
const REST_API_VERSION = "2026-03-10";
const REQUEST_TIMEOUT_MILLISECONDS = 15_000;

export type GitHubErrorCode =
  | "AUTH_REQUIRED"
  | "INVALID_TOKEN"
  | "RATE_LIMITED"
  | "GITHUB_ERROR";

export interface GitHubClientError extends Error {
  code: GitHubErrorCode;
  /** Epoch milliseconds when GitHub says another request can be attempted. */
  retryAt?: number;
}

export interface ReadmeRequestOptions {
  sourceUrl: string | null;
  fetchImplementation?: typeof fetch;
}

interface GraphqlResponseError {
  message: string;
  type: string | null;
  path: unknown[] | null;
}

function createClientError(
  code: GitHubErrorCode,
  message: string,
  retryAt?: number,
): GitHubClientError {
  return Object.assign(
    new Error(message),
    retryAt === undefined ? { code } : { code, retryAt },
  );
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

function responseRetryAt(response: Response): number | undefined {
  const retryAfter = response.headers.get("retry-after");
  if (retryAfter !== null) {
    const seconds = Number(retryAfter);
    if (retryAfter.trim() && Number.isFinite(seconds) && seconds >= 0) {
      return Date.now() + seconds * 1_000;
    }
    const timestamp = Date.parse(retryAfter);
    return Number.isFinite(timestamp) ? timestamp : undefined;
  }

  if (response.headers.get("x-ratelimit-remaining") !== "0") {
    return undefined;
  }

  const resetSeconds = Number(response.headers.get("x-ratelimit-reset"));
  return Number.isFinite(resetSeconds) && resetSeconds > 0
    ? resetSeconds * 1_000
    : undefined;
}

async function fetchWithTimeout<T>(
  fetchImplementation: typeof fetch,
  input: string,
  init: RequestInit,
  consume: (response: Response) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  const timeoutError = createClientError(
    "GITHUB_ERROR",
    "GitHub did not respond before the request timed out.",
  );
  let timer: ReturnType<typeof setTimeout> | undefined;

  try {
    return await Promise.race([
      (async () => {
        const response = await fetchImplementation(input, {
          ...init,
          signal: controller.signal,
        });
        await assertSuccessfulResponse(response);
        return consume(response);
      })(),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(timeoutError);
        }, REQUEST_TIMEOUT_MILLISECONDS);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

async function assertSuccessfulResponse(response: Response): Promise<void> {
  if (response.ok) return;

  const body = await response.text();

  if (response.status === 401) {
    throw createClientError(
      "INVALID_TOKEN",
      "GitHub rejected the token. Check it and try again.",
    );
  }

  let message = body;
  try {
    const parsed = JSON.parse(body) as { message?: unknown };
    message = typeof parsed.message === "string" ? parsed.message : "";
  } catch {
    // GitHub can return plain text. Inspect it without exposing it to callers.
  }

  const rateLimited =
    response.status === 429 ||
    (response.status === 403 &&
      (response.headers.get("x-ratelimit-remaining") === "0" ||
        response.headers.has("retry-after") ||
        /rate limit/i.test(message)));

  if (rateLimited) {
    throw createClientError(
      "RATE_LIMITED",
      "GitHub is rate limiting this token. Wait for the reset time and retry.",
      responseRetryAt(response),
    );
  }

  throw createClientError(
    "GITHUB_ERROR",
    `GitHub returned HTTP ${response.status}.`,
  );
}

function readGraphqlErrors(value: unknown): GraphqlResponseError[] {
  if (typeof value !== "object" || value === null || !("errors" in value)) {
    return [];
  }

  const errors = (value as { errors?: unknown }).errors;

  if (!Array.isArray(errors)) return [];

  return errors
    .map((error): GraphqlResponseError | null => {
      if (
        typeof error !== "object" ||
        error === null ||
        !("message" in error) ||
        typeof error.message !== "string"
      ) {
        return null;
      }

      return {
        message: error.message,
        type:
          "type" in error && typeof error.type === "string"
            ? error.type
            : null,
        path: "path" in error && Array.isArray(error.path) ? error.path : null,
      };
    })
    .filter((error): error is GraphqlResponseError => error !== null);
}

function isMissingRepositoryError(
  error: GraphqlResponseError,
  payload: unknown,
): boolean {
  if (
    error.type !== "NOT_FOUND" ||
    error.path?.length !== 1 ||
    typeof error.path[0] !== "string" ||
    !/^r\d+$/.test(error.path[0]) ||
    typeof payload !== "object" ||
    payload === null ||
    !("data" in payload) ||
    typeof payload.data !== "object" ||
    payload.data === null
  ) {
    return false;
  }

  return (payload.data as Record<string, unknown>)[error.path[0]] === null;
}

/**
 * Confirms that a GitHub token is accepted without exposing it to page code.
 */
export async function validateGitHubToken(
  token: string,
  fetchImplementation: typeof fetch = fetch,
): Promise<string> {
  const payload: unknown = await fetchWithTimeout(
    fetchImplementation,
    GRAPHQL_ENDPOINT,
    {
      method: "POST",
      headers: {
        ...authorizationHeaders(token),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query: "query TokenCheck { viewer { login } }" }),
    },
    (response) => response.json(),
  );
  const errors = readGraphqlErrors(payload);

  if (errors.length > 0) {
    throw createClientError(
      "INVALID_TOKEN",
      errors[0]?.message ?? "Invalid token.",
    );
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
  options: ReadmeRequestOptions,
): Promise<string> {
  const fetchImplementation = options.fetchImplementation ?? fetch;

  if (options.sourceUrl) {
    return fetchWithTimeout(
      fetchImplementation,
      options.sourceUrl,
      { headers: { Accept: "text/plain" } },
      (response) => response.text(),
    );
  }

  const endpoint = `https://api.github.com/repos/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.name)}/readme`;
  return fetchWithTimeout(
    fetchImplementation,
    endpoint,
    {
      headers: {
        ...authorizationHeaders(token),
        Accept: "application/vnd.github.raw+json",
        "X-GitHub-Api-Version": REST_API_VERSION,
      },
    },
    (response) => response.text(),
  );
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
  const payload: unknown = await fetchWithTimeout(
    fetchImplementation,
    GRAPHQL_ENDPOINT,
    {
      method: "POST",
      headers: {
        ...authorizationHeaders(token),
        "Content-Type": "application/json",
      },
      body: JSON.stringify(request),
    },
    (response) => response.json(),
  );
  const errors = readGraphqlErrors(payload);
  const fatalError = errors.find(
    (error) => !isMissingRepositoryError(error, payload),
  );

  if (fatalError) {
    const rateLimit =
      typeof payload === "object" &&
      payload !== null &&
      "data" in payload &&
      typeof payload.data === "object" &&
      payload.data !== null &&
      "rateLimit" in payload.data &&
      typeof payload.data.rateLimit === "object" &&
      payload.data.rateLimit !== null &&
      "resetAt" in payload.data.rateLimit &&
      typeof payload.data.rateLimit.resetAt === "string"
        ? Date.parse(payload.data.rateLimit.resetAt)
        : Number.NaN;
    throw createClientError(
      fatalError.type === "RATE_LIMITED" ? "RATE_LIMITED" : "GITHUB_ERROR",
      fatalError.message || "GitHub could not load repository metadata.",
      fatalError.type === "RATE_LIMITED" && Number.isFinite(rateLimit)
        ? rateLimit
        : undefined,
    );
  }

  return parseRepositoryMetadataResponse(
    payload,
    repositories,
    new Date().toISOString(),
  );
}
