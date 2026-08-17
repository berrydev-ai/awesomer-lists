import type { RepositoryMetadata } from "./domain/types";
import type { GitHubErrorCode } from "./github/client";
import type { RateLimitInfo } from "./github/graphql";

export type ExtensionRequest =
  | { type: "auth.status" }
  | { type: "auth.save"; token: string; remember: boolean }
  | { type: "auth.clear" }
  | { type: "readme.load"; repository: string; sourceUrl: string | null }
  | {
      type: "metadata.load";
      repositories: string[];
      refresh: boolean;
    }
  | { type: "cache.status" }
  | { type: "cache.save"; serverUrl: string; enabled: boolean };

export interface AuthStatus {
  hasToken: boolean;
  remembered: boolean;
  login: string | null;
}

export interface SharedCacheStatus {
  /** The stored override, empty when the built-in server is in use. */
  serverUrl: string;
  enabled: boolean;
  builtInUrl: string;
  activeUrl: string;
}

export interface MetadataLoadResult {
  metadata: RepositoryMetadata[];
  missing: string[];
  rateLimit: RateLimitInfo | null;
  /** Repositories answered from this device's own six-hour cache. */
  cachedCount: number;
  /** Repositories answered by the shared cache server. */
  sharedCachedCount: number;
}

export type ExtensionResponse<T> =
  | { ok: true; data: T }
  | {
      ok: false;
      error: { code: GitHubErrorCode | "INVALID_REQUEST"; message: string };
    };
