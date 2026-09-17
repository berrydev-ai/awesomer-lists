import { describe, expect, it } from "vitest";
import { mayRequest, senderRole } from "./sender";

describe.each(["chrome-extension://test/", "safari-web-extension://test/"])("sender validation for %s", (root) => {
  it("accepts extension token and options pages without a tab", () => {
    expect(senderRole({ url: `${root}token.html`, id: "test" }, root, "test")).toBe("token");
    expect(senderRole({ url: `${root}options.html`, id: "test" }, root, "test")).toBe("options");
  });
  it("checks protocol and host even when URL.origin is null", () => {
    expect(senderRole({ url: "safari-web-extension://other/token.html" }, root, "test")).toBeNull();
    expect(senderRole({ url: "chrome-extension://other/options.html" }, root, "test")).toBeNull();
    expect(senderRole({ url: "https://test/token.html" }, root, "test")).toBeNull();
    expect(senderRole({ url: `${root}token.html`, id: "other" }, root, "test")).toBeNull();
  });
  it("accepts only the top GitHub content script", () => {
    const sender = { url: "https://github.com/a/b", tab: { url: "https://github.com/a/b" } as chrome.tabs.Tab, frameId: 0 };
    expect(senderRole(sender, root, "test")).toBe("content");
    expect(senderRole({ ...sender, frameId: 1 }, root, "test")).toBeNull();
    expect(senderRole({ ...sender, url: "http://github.com/a/b" }, root, "test")).toBeNull();
    expect(senderRole({ ...sender, url: "https://github.com.evil.test/a/b" }, root, "test")).toBeNull();
    expect(senderRole({ ...sender, url: `${root}unrecognized.html` }, root, "test")).toBeNull();
  });
  it("limits each context to its intended requests", () => {
    expect(mayRequest("token", "auth.save")).toBe(true);
    expect(mayRequest("content", "auth.save")).toBe(false);
    expect(mayRequest("options", "auth.save")).toBe(false);
    expect(mayRequest("content", "metadata.load")).toBe(true);
    expect(mayRequest("options", "cache.clear")).toBe(true);
    expect(mayRequest("content", "cache.clear")).toBe(false);
  });
});
