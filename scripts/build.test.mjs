import { describe, expect, it } from "vitest";

import {
  buildTargets,
  createTargetManifest,
  parseBuildTarget,
} from "./build.mjs";

const sourceManifest = () => ({
  manifest_version: 3,
  minimum_chrome_version: "114",
  permissions: ["activeTab", "scripting", "storage", "unlimitedStorage"],
  background: { service_worker: "background.js", type: "module" },
  options_ui: { page: "options.html", open_in_tab: false },
});

describe("target-specific extension builds", () => {
  it("keeps the Chrome minimum only in the Chrome manifest", () => {
    const manifest = createTargetManifest(sourceManifest(), "chrome");

    expect(manifest.minimum_chrome_version).toBe("114");
    expect(manifest.browser_specific_settings).toBeUndefined();
    expect(buildTargets.chrome.javascriptTarget).toBe("chrome114");
  });

  it("uses Safari 17.1 and removes manifest keys unsupported by Safari", () => {
    const manifest = createTargetManifest(sourceManifest(), "safari");

    expect(manifest.minimum_chrome_version).toBeUndefined();
    expect(manifest.browser_specific_settings).toEqual({
      safari: { strict_min_version: "17.1" },
    });
    expect(manifest.background).toEqual({
      service_worker: "background.js",
    });
    expect(manifest.options_ui).toEqual({ page: "options.html" });
    expect(buildTargets.safari.javascriptTarget).toBe("safari17.1");
  });

  it("defaults to Chrome and rejects an unsupported target", () => {
    expect(parseBuildTarget([])).toBe("chrome");
    expect(parseBuildTarget(["--target", "safari"])).toBe("safari");
    expect(() => parseBuildTarget(["--target", "firefox"])).toThrow(
      /Use chrome or safari/,
    );
  });
});
