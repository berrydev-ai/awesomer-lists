declare const __AWESOMER_CACHE_SERVER_URL__: string;

/**
 * The cache server this build ships with. `scripts/build.mjs` replaces the
 * identifier from `AWESOMER_CACHE_SERVER_URL`; an unset variable means the
 * build has no shared cache until someone sets one in the options page.
 */
export const BUILT_IN_CACHE_SERVER_URL: string =
  typeof __AWESOMER_CACHE_SERVER_URL__ === "string"
    ? __AWESOMER_CACHE_SERVER_URL__
    : "";

export const SHARED_CACHE_SETTINGS_KEY = "cache.shared";

export interface SharedCacheSettings {
  /** Empty means "use the built-in server, if this build has one". */
  serverUrl: string;
  enabled: boolean;
}

export interface ResolvedSharedCache {
  serverUrl: string;
  enabled: boolean;
  builtInUrl: string;
  /** The URL actually used, or empty when the shared cache is off. */
  activeUrl: string;
}

/**
 * Accepts a cache server URL the user typed, or throws with a readable reason.
 * Only `https` is allowed off localhost, because repository names would
 * otherwise travel in the clear.
 */
export function normalizeCacheServerUrl(value: string): string {
  const trimmed = value.trim();

  if (trimmed === "") return "";

  let url: URL;

  try {
    url = new URL(trimmed);
  } catch {
    throw new Error("Enter a full URL, such as https://cache.example.com.");
  }

  const isLocalhost =
    url.hostname === "localhost" || url.hostname === "127.0.0.1";

  if (url.protocol !== "https:" && !(url.protocol === "http:" && isLocalhost)) {
    throw new Error("The cache server URL must start with https://.");
  }

  if (url.search || url.hash) {
    throw new Error("Leave query strings and fragments off the cache URL.");
  }

  if (url.username || url.password) {
    throw new Error("Do not put credentials in the cache server URL.");
  }

  return `${url.origin}${url.pathname.replace(/\/+$/, "")}`;
}

function isSharedCacheSettings(value: unknown): value is SharedCacheSettings {
  return (
    typeof value === "object" &&
    value !== null &&
    "serverUrl" in value &&
    typeof value.serverUrl === "string" &&
    "enabled" in value &&
    typeof value.enabled === "boolean"
  );
}

/**
 * Combines the stored preference with the built-in URL into the single answer
 * the rest of the extension asks for: which server, if any, to talk to.
 */
export function resolveSharedCache(
  stored: unknown,
  builtInUrl: string = BUILT_IN_CACHE_SERVER_URL,
): ResolvedSharedCache {
  const settings = isSharedCacheSettings(stored)
    ? stored
    : { serverUrl: "", enabled: true };

  let serverUrl = "";

  try {
    serverUrl = normalizeCacheServerUrl(settings.serverUrl);
  } catch {
    serverUrl = "";
  }

  let normalizedBuiltIn = "";

  try {
    normalizedBuiltIn = normalizeCacheServerUrl(builtInUrl);
  } catch {
    normalizedBuiltIn = "";
  }

  const effective = serverUrl || normalizedBuiltIn;

  return {
    serverUrl: settings.serverUrl,
    enabled: settings.enabled,
    builtInUrl: normalizedBuiltIn,
    activeUrl: settings.enabled ? effective : "",
  };
}
