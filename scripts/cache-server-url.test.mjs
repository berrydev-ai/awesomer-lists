import { describe, expect, it } from "vitest";

import { readCacheServerUrl } from "./cache-server-url.mjs";

describe("AWESOMER_CACHE_SERVER_URL", () => {
  it("treats an unset or empty variable as no shared cache", () => {
    expect(readCacheServerUrl(undefined)).toBe("");
    expect(readCacheServerUrl("")).toBe("");
    expect(readCacheServerUrl("   ")).toBe("");
  });

  it("normalizes an https origin and drops a trailing slash", () => {
    expect(readCacheServerUrl(" https://cache.example.com/ ")).toBe(
      "https://cache.example.com",
    );
  });

  it("allows a localhost development server over plain http", () => {
    expect(readCacheServerUrl("http://localhost:8787")).toBe(
      "http://localhost:8787",
    );
  });

  it("fails the build rather than silently shipping a broken value", () => {
    expect(() => readCacheServerUrl("cache.example.com")).toThrow(/not a URL/);
    expect(() => readCacheServerUrl("http://cache.example.com")).toThrow(/https/);
    expect(() => readCacheServerUrl("https://cache.example.com?x=1")).toThrow(
      /query/,
    );
  });
});
