import { describe, expect, it } from "vitest";

import {
  alwaysAllowedHosts,
  findDistributionProblems,
  requiredFiles,
  requiredPermissions,
} from "./verify-dist.mjs";

const goodBuild = (target = "chrome") => ({
  target,
  distributionName: target === "safari" ? "dist-safari" : "dist",
  manifest: {
    manifest_version: 3,
    version: "1.2.3",
    ...(target === "chrome"
      ? { minimum_chrome_version: "114" }
      : {
          browser_specific_settings: {
            safari: { strict_min_version: "17.1" },
          },
        }),
    permissions: [...requiredPermissions],
    host_permissions: [...alwaysAllowedHosts],
    background:
      target === "chrome"
        ? { service_worker: "background.js", type: "module" }
        : { service_worker: "background.js" },
    options_ui: { page: "options.html" },
    icons: { 16: "icons/icon-16.png" },
    web_accessible_resources: [
      { resources: ["fonts/*.woff2", "token.html"], matches: [] },
    ],
  },
  packageVersion: "1.2.3",
  presentFiles: [...requiredFiles],
  scriptSources: { "background.js": "console.log('hello');" },
});

describe("built extension verification", () => {
  it.each(["chrome", "safari"])("accepts a complete %s build", (target) => {
    expect(findDistributionProblems(goodBuild(target))).toEqual([]);
  });

  it("reports required and manifest-referenced files that are missing", () => {
    const build = goodBuild();
    build.manifest.action = { default_popup: "popup.html" };
    build.presentFiles = build.presentFiles.filter(
      (file) => file !== "background.js",
    );

    expect(findDistributionProblems(build)).toEqual(
      expect.arrayContaining([
        "dist/background.js is missing",
        "manifest references missing file: background.js",
        "manifest references missing file: popup.html",
      ]),
    );
  });

  it("reports version and target drift", () => {
    const build = goodBuild("safari");
    build.manifest.version = "9.9.9";
    build.manifest.minimum_chrome_version = "114";
    build.manifest.browser_specific_settings.safari.strict_min_version = "16.0";

    expect(findDistributionProblems(build)).toEqual(
      expect.arrayContaining([
        "manifest version 9.9.9 does not match package.json version 1.2.3",
        "Safari manifest contains minimum_chrome_version",
        "Safari manifest must set strict_min_version to 17.1",
      ]),
    );
  });

  it("requires an ECMAScript module background service worker", () => {
    const build = goodBuild();
    build.manifest.background = { scripts: ["background.js"] };

    expect(findDistributionProblems(build)).toEqual(
      expect.arrayContaining([
        "background service worker must reference background.js",
        "Chrome background service worker must have type module",
      ]),
    );
  });

  it("rejects manifest keys unsupported by Safari", () => {
    const build = goodBuild("safari");
    build.manifest.background.type = "module";
    build.manifest.options_ui.open_in_tab = false;

    expect(findDistributionProblems(build)).toEqual(
      expect.arrayContaining([
        "Safari manifest contains unsupported background.type",
        "Safari manifest contains unsupported options_ui.open_in_tab",
      ]),
    );
  });

  it("rejects broad or optional host access", () => {
    const build = goodBuild();
    build.manifest.host_permissions.push("https://*/*");
    build.manifest.optional_host_permissions = ["http://localhost/*"];

    expect(findDistributionProblems(build)).toEqual(
      expect.arrayContaining([
        "unexpected host permission: https://*/*",
        "unexpected optional host permission: http://localhost/*",
      ]),
    );
  });

  it("requires the complete permission set and rejects additions", () => {
    const build = goodBuild();
    build.manifest.permissions = ["activeTab", "scripting", "storage", "tabs"];

    expect(findDistributionProblems(build)).toEqual(
      expect.arrayContaining([
        "unexpected extension permission: tabs",
        "missing extension permission: unlimitedStorage",
      ]),
    );
  });

  it.each([
    ['const token = "ghp_0123456789abcdefghijABCDEFGHIJ";', "token"],
    ['const url = "AWESOMER_CACHE_SERVER_URL";', "cache"],
    ['fetch("/v1/metadata")', "cache"],
  ])("rejects sensitive or removed bundle content", (source, kind) => {
    const build = goodBuild();
    build.scriptSources = { "background.js": source };

    expect(findDistributionProblems(build)).toContain(
      kind === "token"
        ? "dist/background.js looks like it contains a GitHub token"
        : "dist/background.js contains shared-cache build residue",
    );
  });

  it("reports an unreadable manifest without inspecting its contents", () => {
    const build = goodBuild();
    build.manifest = undefined;

    expect(findDistributionProblems(build)).toEqual([
      "dist/manifest.json could not be read",
    ]);
  });
});
