// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ExtensionRequest, LocalCacheStatus } from "./messages";

let sendMessage: ReturnType<typeof vi.fn>;
let cache: LocalCacheStatus;

beforeEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
  document.body.replaceChildren();
  cache = {
    entries: 12,
    bytes: 12_288,
    maxBytes: 5_242_880,
    freshHours: 6,
    retentionDays: 30,
  };
  sendMessage = vi.fn(async (request: ExtensionRequest) => {
    if (request.type === "cache.status") return { ok: true, data: cache };
    if (request.type === "cache.clear") {
      cache = { ...cache, entries: 0, bytes: 0 };
      return { ok: true, data: cache };
    }
    return { ok: false, error: { code: "INVALID_REQUEST", message: "Invalid" } };
  });

  globalThis.chrome = {
    runtime: { sendMessage },
  } as unknown as typeof chrome;
});

describe("options page", () => {
  it("shows local cache usage and retention without server controls", async () => {
    await import("./options");
    await waitUntil(() =>
      document.querySelector("#cache-entries")?.textContent === "12" ? true : null,
    );

    expect(document.querySelector("#cache-usage")?.textContent).toBe(
      "12.0 KB of 5.0 MB",
    );
    expect(document.querySelector("#cache-freshness")?.textContent).toBe(
      "6 hours",
    );
    expect(document.querySelector("#cache-retention")?.textContent).toBe(
      "30 days",
    );
    expect(document.querySelector('input[type="url"]')).toBeNull();
    expect(document.body.textContent).not.toContain("server");
  });

  it("clears metadata while explaining that the token stays connected", async () => {
    await import("./options");
    const button = document.querySelector<HTMLButtonElement>("#cache-clear");
    if (!button) throw new Error("Clear cache button was not rendered.");
    button.click();

    const status = await waitUntil(() => {
      const element = document.querySelector<HTMLElement>("#cache-status");
      return element && !element.hidden ? element : null;
    });

    expect(sendMessage).toHaveBeenCalledWith({ type: "cache.clear" });
    expect(document.querySelector("#cache-entries")?.textContent).toBe("0");
    expect(document.querySelector("#cache-usage")?.textContent).toBe(
      "0 B of 5.0 MB",
    );
    expect(status.textContent).toContain("GitHub token is unchanged");
    expect(status.dataset.tone).toBe("ok");
  });

  it("keeps the current usage visible when clearing fails", async () => {
    sendMessage.mockImplementation(async (request: ExtensionRequest) => {
      if (request.type === "cache.status") return { ok: true, data: cache };
      return {
        ok: false,
        error: { code: "INVALID_REQUEST", message: "Storage is unavailable." },
      };
    });
    await import("./options");
    await waitUntil(() =>
      document.querySelector("#cache-entries")?.textContent === "12" ? true : null,
    );
    document.querySelector<HTMLButtonElement>("#cache-clear")?.click();

    const status = await waitUntil(() => {
      const element = document.querySelector<HTMLElement>("#cache-status");
      return element && !element.hidden ? element : null;
    });
    expect(document.querySelector("#cache-entries")?.textContent).toBe("12");
    expect(status.textContent).toBe("Storage is unavailable.");
    expect(status.dataset.tone).toBe("error");
  });
});

async function waitUntil<T>(read: () => T | null): Promise<T> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const value = read();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error("Timed out waiting for the options page.");
}
