import { describe, expect, it } from "vitest";

import {
  alwaysAllowedHosts,
  findDistributionProblems,
  requiredFiles,
} from "./verify-dist.mjs";

const goodBuild = () => ({
  manifest: {
    manifest_version: 3,
    version: "1.2.3",
    host_permissions: [...alwaysAllowedHosts],
  },
  packageVersion: "1.2.3",
  presentFiles: [...requiredFiles],
  scriptSources: { "background.js": "console.log('hello');" },
  cacheServerUrl: "",
});

describe("built extension verification", () => {
  it("accepts a complete build", () => {
    expect(findDistributionProblems(goodBuild())).toEqual([]);
  });

  it("reports a file the extension cannot load without", () => {
    const build = goodBuild();
    build.presentFiles = build.presentFiles.filter(
      (file) => file !== "background.js",
    );

    expect(findDistributionProblems(build)).toContain(
      "dist/background.js is missing",
    );
  });

  it("reports a manifest version that drifted from package.json", () => {
    const build = goodBuild();
    build.manifest.version = "9.9.9";

    expect(findDistributionProblems(build)).toContain(
      "manifest version 9.9.9 does not match package.json version 1.2.3",
    );
  });

  it("reports a host the extension should not be able to reach", () => {
    const build = goodBuild();
    build.manifest.host_permissions.push("https://tracker.example.com/*");

    expect(findDistributionProblems(build)).toContain(
      "unexpected host permission: https://tracker.example.com/*",
    );
  });

  it("allows the shared cache origin the build was given", () => {
    const build = goodBuild();
    build.cacheServerUrl = "https://cache.example.workers.dev";
    build.manifest.host_permissions.push("https://cache.example.workers.dev/*");

    expect(findDistributionProblems(build)).toEqual([]);
  });

  it("reports a shared cache URL the build never wrote into the manifest", () => {
    const build = goodBuild();
    build.cacheServerUrl = "https://cache.example.workers.dev";

    expect(findDistributionProblems(build)).toContain(
      "AWESOMER_CACHE_SERVER_URL was set but https://cache.example.workers.dev/* is not in host_permissions",
    );
  });

  it("reports a token baked into a bundled script", () => {
    const build = goodBuild();
    build.scriptSources = {
      "background.js": 'const token = "ghp_0123456789abcdefghijABCDEFGHIJ";',
    };

    expect(findDistributionProblems(build)).toContain(
      "dist/background.js looks like it contains a GitHub token",
    );
  });

  it("reports a fine-grained token baked into a bundled script", () => {
    const build = goodBuild();
    build.scriptSources = {
      "token.js": 'x = "github_pat_11ABCDEFG0aBcDeFgHiJkL_mNoPqRsTuVwXyZ";',
    };

    expect(findDistributionProblems(build)).toContain(
      "dist/token.js looks like it contains a GitHub token",
    );
  });

  it("does not mistake ordinary bundled code for a token", () => {
    const build = goodBuild();
    build.scriptSources = {
      "content.js":
        'const message = "Add a token"; const key = "awesomer:token";',
    };

    expect(findDistributionProblems(build)).toEqual([]);
  });

  it("reports a missing required host permission", () => {
    const build = goodBuild();
    build.manifest.host_permissions = ["https://api.github.com/*"];

    expect(findDistributionProblems(build)).toContain(
      "missing host permission: https://raw.githubusercontent.com/*",
    );
  });

  it("reports an unreadable manifest without also blaming its contents", () => {
    const build = goodBuild();
    build.manifest = undefined;

    expect(findDistributionProblems(build)).toEqual([
      "dist/manifest.json could not be read",
    ]);
  });
});
