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
  | { type: "cache.clear" };

export interface AuthStatus {
  hasToken: boolean;
  remembered: boolean;
  login: string | null;
}

export interface LocalCacheStatus {
  entries: number;
  bytes: number;
  maxBytes: number;
  freshHours: number;
  retentionDays: number;
}

export interface MetadataLoadResult {
  metadata: RepositoryMetadata[];
  missing: string[];
  rateLimit: RateLimitInfo | null;
  /** Repositories answered from this device's cache, including older records. */
  cachedCount: number;
  staleCount: number;
  pendingCount: number;
  complete: boolean;
  warning: string | null;
}

export const METADATA_PORT_NAME = "awesomer.metadata";

export type ExtensionResponse<T> =
  | { ok: true; data: T }
  | {
      ok: false;
      error: { code: GitHubErrorCode | "INVALID_REQUEST"; message: string };
    };
