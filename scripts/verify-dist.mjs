/**
 * Checks a built browser extension before it is uploaded or packaged.
 */

export const alwaysAllowedHosts = [
  "https://api.github.com/*",
  "https://raw.githubusercontent.com/*",
];

export const requiredPermissions = [
  "activeTab",
  "scripting",
  "storage",
  "unlimitedStorage",
];

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

export const bundledScripts = [
  "background.js",
  "content.js",
  "options.js",
  "token.js",
];

const tokenPattern = /gh[pousr]_[A-Za-z0-9]{16,}|github_pat_[A-Za-z0-9_]{20,}/;
const serverCachePatterns = [
  /AWESOMER_CACHE_SERVER_URL/,
  /__AWESOMER_CACHE_SERVER_URL__/,
  /cache\.shared/,
  /\/v1\/metadata/,
  /shared cache server/i,
];

function manifestReferences(manifest) {
  const references = [];
  const add = (value) => {
    if (typeof value === "string" && value !== "") references.push(value);
  };

  add(manifest.background?.service_worker);
  for (const script of manifest.background?.scripts ?? []) add(script);
  add(manifest.options_ui?.page);
  add(manifest.action?.default_popup);
  for (const icon of Object.values(manifest.action?.default_icon ?? {})) add(icon);
  for (const icon of Object.values(manifest.icons ?? {})) add(icon);

  for (const entry of manifest.content_scripts ?? []) {
    for (const script of entry.js ?? []) add(script);
    for (const stylesheet of entry.css ?? []) add(stylesheet);
  }

  for (const entry of manifest.web_accessible_resources ?? []) {
    for (const resource of entry.resources ?? []) add(resource);
  }

  return [...new Set(references)];
}

function globMatchesFile(pattern, files) {
  if (!pattern.includes("*")) return files.has(pattern);
  const escaped = pattern
    .split("*")
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  const expression = new RegExp(`^${escaped}$`);
  return [...files].some((file) => expression.test(file));
}

export function findDistributionProblems({
  target,
  distributionName,
  manifest,
  packageVersion,
  presentFiles,
  scriptSources = {},
}) {
  const problems = [];
  const present = new Set(presentFiles);
  const location =
    distributionName ?? (target === "safari" ? "dist-safari" : "dist");

  for (const file of requiredFiles) {
    if (!present.has(file)) problems.push(`${location}/${file} is missing`);
  }

  if (!manifest) {
    problems.push(`${location}/manifest.json could not be read`);
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

  if (manifest.background?.service_worker !== "background.js") {
    problems.push("background service worker must reference background.js");
  }

  if (target === "chrome") {
    if (manifest.background?.type !== "module") {
      problems.push("Chrome background service worker must have type module");
    }
    if (manifest.minimum_chrome_version !== "114") {
      problems.push("Chrome manifest must set minimum_chrome_version to 114");
    }
    if (manifest.browser_specific_settings?.safari) {
      problems.push("Chrome manifest contains Safari-only settings");
    }
  } else if (target === "safari") {
    if ("type" in (manifest.background ?? {})) {
      problems.push("Safari manifest contains unsupported background.type");
    }
    if ("open_in_tab" in (manifest.options_ui ?? {})) {
      problems.push("Safari manifest contains unsupported options_ui.open_in_tab");
    }
    if ("minimum_chrome_version" in manifest) {
      problems.push("Safari manifest contains minimum_chrome_version");
    }
    if (
      manifest.browser_specific_settings?.safari?.strict_min_version !== "17.1"
    ) {
      problems.push("Safari manifest must set strict_min_version to 17.1");
    }
  } else {
    problems.push(`unknown verification target: ${JSON.stringify(target)}`);
  }

  const hostPermissions = manifest.host_permissions ?? [];
  for (const host of hostPermissions) {
    if (!alwaysAllowedHosts.includes(host)) {
      problems.push(`unexpected host permission: ${host}`);
    }
  }
  for (const host of alwaysAllowedHosts) {
    if (!hostPermissions.includes(host)) {
      problems.push(`missing host permission: ${host}`);
    }
  }

  for (const host of manifest.optional_host_permissions ?? []) {
    problems.push(`unexpected optional host permission: ${host}`);
  }

  const permissions = manifest.permissions ?? [];
  for (const permission of permissions) {
    if (!requiredPermissions.includes(permission)) {
      problems.push(`unexpected extension permission: ${permission}`);
    }
  }
  for (const permission of requiredPermissions) {
    if (!permissions.includes(permission)) {
      problems.push(`missing extension permission: ${permission}`);
    }
  }

  for (const reference of manifestReferences(manifest)) {
    if (!globMatchesFile(reference, present)) {
      problems.push(`manifest references missing file: ${reference}`);
    }
  }

  for (const [file, source] of Object.entries(scriptSources)) {
    if (tokenPattern.test(source)) {
      problems.push(`${location}/${file} looks like it contains a GitHub token`);
    }
    for (const pattern of serverCachePatterns) {
      if (pattern.test(source)) {
        problems.push(`${location}/${file} contains shared-cache build residue`);
        break;
      }
    }
  }

  return problems;
}
