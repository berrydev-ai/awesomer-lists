import { describe, expect, it } from "vitest";

import { normalizeCacheServerUrl, resolveSharedCache } from "./config";

describe("cache server URL", () => {
  it("keeps a usable https origin and drops a trailing slash", () => {
    expect(normalizeCacheServerUrl(" https://cache.example.com/ ")).toBe(
      "https://cache.example.com",
    );
    expect(normalizeCacheServerUrl("https://cache.example.com/api/")).toBe(
      "https://cache.example.com/api",
    );
  });

  it("treats an empty value as no server", () => {
    expect(normalizeCacheServerUrl("   ")).toBe("");
  });

  it("allows plain http only on localhost", () => {
    expect(normalizeCacheServerUrl("http://localhost:8787")).toBe(
      "http://localhost:8787",
    );
    expect(() => normalizeCacheServerUrl("http://cache.example.com")).toThrow(
      /https/,
    );
  });

  it("refuses credentials, queries, and values that are not URLs", () => {
    expect(() => normalizeCacheServerUrl("https://a:b@cache.example.com")).toThrow(
      /credentials/,
    );
    expect(() => normalizeCacheServerUrl("https://cache.example.com?x=1")).toThrow(
      /query/,
    );
    expect(() => normalizeCacheServerUrl("cache.example.com")).toThrow(/full URL/);
  });
});

describe("resolving the active shared cache", () => {
  it("falls back to the built-in server when nothing is stored", () => {
    const resolved = resolveSharedCache(undefined, "https://built-in.example.com");

    expect(resolved.activeUrl).toBe("https://built-in.example.com");
    expect(resolved.enabled).toBe(true);
    expect(resolved.serverUrl).toBe("");
  });

  it("prefers a stored server over the built-in one", () => {
    const resolved = resolveSharedCache(
      { serverUrl: "https://mine.example.com", enabled: true },
      "https://built-in.example.com",
    );

    expect(resolved.activeUrl).toBe("https://mine.example.com");
    expect(resolved.builtInUrl).toBe("https://built-in.example.com");
  });

  it("has no active server when the shared cache is turned off", () => {
    const resolved = resolveSharedCache(
      { serverUrl: "https://mine.example.com", enabled: false },
      "https://built-in.example.com",
    );

    expect(resolved.activeUrl).toBe("");
    expect(resolved.serverUrl).toBe("https://mine.example.com");
  });

  it("has no active server when the build ships without one", () => {
    expect(resolveSharedCache(undefined, "").activeUrl).toBe("");
  });

  it("ignores a stored value that is corrupt or no longer valid", () => {
    expect(resolveSharedCache("nonsense", "https://built-in.example.com").activeUrl).toBe(
      "https://built-in.example.com",
    );
    expect(
      resolveSharedCache(
        { serverUrl: "http://insecure.example.com", enabled: true },
        "https://built-in.example.com",
      ).activeUrl,
    ).toBe("https://built-in.example.com");
  });
});
