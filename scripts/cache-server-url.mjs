/**
 * Reads the shared cache server this build should ship with.
 *
 * An unset variable is the normal case: the build simply has no shared cache
 * until someone sets one in the extension's options page. A set-but-broken
 * value is a mistake worth failing the build over, because a silently dropped
 * URL would look exactly like a working cache that never hits.
 */
export function readCacheServerUrl(value) {
  const trimmed = (value ?? "").trim();

  if (trimmed === "") return "";

  let url;

  try {
    url = new URL(trimmed);
  } catch {
    throw new Error(
      `AWESOMER_CACHE_SERVER_URL is not a URL: ${JSON.stringify(trimmed)}`,
    );
  }

  const isLocalhost =
    url.hostname === "localhost" || url.hostname === "127.0.0.1";

  if (url.protocol !== "https:" && !(url.protocol === "http:" && isLocalhost)) {
    throw new Error("AWESOMER_CACHE_SERVER_URL must use https, except on localhost.");
  }

  if (url.search || url.hash || url.username || url.password) {
    throw new Error(
      "AWESOMER_CACHE_SERVER_URL must not carry a query, fragment, or credentials.",
    );
  }

  return `${url.origin}${url.pathname.replace(/\/+$/, "")}`;
}
