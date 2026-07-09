import type { RepositoryMetadata } from "./domain/types";
import type { GitHubErrorCode } from "./github/client";
import type { RateLimitInfo } from "./github/graphql";

export type ExtensionRequest =
  | { type: "auth.status" }
  | { type: "auth.save"; token: string; remember: boolean }
  | { type: "auth.clear" }
  | { type: "readme.load"; repository: string }
  | {
      type: "metadata.load";
      repositories: string[];
      refresh: boolean;
    };

export interface AuthStatus {
  hasToken: boolean;
  remembered: boolean;
  login: string | null;
}

export interface MetadataLoadResult {
  metadata: RepositoryMetadata[];
  missing: string[];
  rateLimit: RateLimitInfo | null;
  cachedCount: number;
}

export type ExtensionResponse<T> =
  | { ok: true; data: T }
  | {
      ok: false;
      error: { code: GitHubErrorCode | "INVALID_REQUEST"; message: string };
    };
