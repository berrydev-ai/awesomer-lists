/**
 * Checks a built extension before it is uploaded or published.
 *
 * The rules here are the ones a reviewer would otherwise have to remember:
 * every file the manifest promises is present, the version in the manifest
 * matches the version in package.json, no host beyond the documented ones is
 * reachable, and no token was baked into the bundle. A build that breaks any of
 * them looks fine locally and fails in someone else's browser, or leaks.
 */

// Hosts the extension may always reach, matching public/manifest.json.
export const alwaysAllowedHosts = [
  "https://api.github.com/*",
  "https://raw.githubusercontent.com/*",
];

// Files the unpacked extension cannot load without.
export const requiredFiles = [
  "manifest.json",
  "background.js",
  "content.js",
  "options.html",
  "options.js",
  "token.html",
  "token.js",
  "icons/icon-16.png",
  "icons/icon-32.png",
  "icons/icon-48.png",
  "icons/icon-128.png",
  "fonts/geist-latin-400-normal.woff2",
  "fonts/geist-latin-500-normal.woff2",
  "fonts/geist-latin-600-normal.woff2",
  "fonts/geist-latin-700-normal.woff2",
  "fonts/geist-mono-latin-400-normal.woff2",
  "fonts/geist-mono-latin-500-normal.woff2",
  "fonts/GEIST-LICENSE.txt",
  "fonts/GEIST-MONO-LICENSE.txt",
];

// The bundled scripts a leaked token would end up inside.
export const bundledScripts = [
  "background.js",
  "content.js",
  "options.js",
  "token.js",
];

// Classic, fine-grained, OAuth, and refresh token shapes.
const tokenPattern = /gh[pousr]_[A-Za-z0-9]{16,}|github_pat_[A-Za-z0-9_]{20,}/;

/**
 * Returns every problem found in a built extension, as plain sentences.
 * An empty array means the build is good.
 *
 * Takes the already-read build rather than a directory so the rules can be
 * tested without writing files.
 */
export function findDistributionProblems({
  manifest,
  packageVersion,
  presentFiles,
  scriptSources = {},
  cacheServerUrl = "",
}) {
  const problems = [];
  const present = new Set(presentFiles);

  for (const file of requiredFiles) {
    if (!present.has(file)) {
      problems.push(`dist/${file} is missing`);
    }
  }

  if (!manifest) {
    problems.push("dist/manifest.json could not be read");
    return problems;
  }

  if (manifest.manifest_version !== 3) {
    problems.push(
      `manifest_version is ${JSON.stringify(manifest.manifest_version)}, expected 3`,
    );
  }

  if (manifest.version !== packageVersion) {
    problems.push(
      `manifest version ${manifest.version} does not match package.json version ${packageVersion}`,
    );
  }

  const hostPermissions = manifest.host_permissions ?? [];
  const allowedHosts = new Set(alwaysAllowedHosts);
  const trimmedCacheServerUrl = cacheServerUrl.trim();
  let cacheOrigin = "";

  if (trimmedCacheServerUrl !== "") {
    cacheOrigin = `${new URL(trimmedCacheServerUrl).origin}/*`;
    allowedHosts.add(cacheOrigin);
  }

  for (const host of hostPermissions) {
    if (!allowedHosts.has(host)) {
      problems.push(`unexpected host permission: ${host}`);
    }
  }

  for (const host of alwaysAllowedHosts) {
    if (!hostPermissions.includes(host)) {
      problems.push(`missing host permission: ${host}`);
    }
  }

  if (cacheOrigin !== "" && !hostPermissions.includes(cacheOrigin)) {
    problems.push(
      `AWESOMER_CACHE_SERVER_URL was set but ${cacheOrigin} is not in host_permissions`,
    );
  }

  for (const [file, source] of Object.entries(scriptSources)) {
    if (tokenPattern.test(source)) {
      problems.push(`dist/${file} looks like it contains a GitHub token`);
    }
  }

  return problems;
}
