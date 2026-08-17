// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ExtensionRequest, SharedCacheStatus } from "./messages";

let sendMessage: ReturnType<typeof vi.fn>;
let requestPermission: ReturnType<typeof vi.fn>;
let saved: SharedCacheStatus | null;

beforeEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
  document.body.replaceChildren();
  saved = null;
  requestPermission = vi.fn(async () => true);
  sendMessage = vi.fn(async (request: ExtensionRequest) => {
    if (request.type === "cache.status") {
      return {
        ok: true,
        data: {
          serverUrl: "",
          enabled: true,
          builtInUrl: "https://built-in.example.com",
          activeUrl: "https://built-in.example.com",
        },
      };
    }

    if (request.type === "cache.save") {
      saved = {
        serverUrl: request.serverUrl,
        enabled: request.enabled,
        builtInUrl: "https://built-in.example.com",
        activeUrl: request.enabled
          ? request.serverUrl || "https://built-in.example.com"
          : "",
      };
      return { ok: true, data: saved };
    }

    return { ok: false, error: { code: "INVALID_REQUEST", message: "Invalid" } };
  });

  globalThis.chrome = {
    runtime: { sendMessage },
    permissions: { request: requestPermission },
  } as unknown as typeof chrome;
});

function form(): {
  element: HTMLFormElement;
  url: HTMLInputElement;
  enabled: HTMLInputElement;
  status: HTMLElement;
} {
  const element = document.querySelector<HTMLFormElement>("#cache-form");
  const url = document.querySelector<HTMLInputElement>("#cache-url");
  const enabled = document.querySelector<HTMLInputElement>("#cache-enabled");
  const status = document.querySelector<HTMLElement>("#cache-status");

  if (!element || !url || !enabled || !status) {
    throw new Error("The options form was not rendered.");
  }

  return { element, url, enabled, status };
}

function submit(element: HTMLFormElement): void {
  element.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
}

describe("options page", () => {
  it("shows the server this build ships with", async () => {
    await import("./options");
    await waitUntil(() =>
      document.body.textContent?.includes("built-in.example.com") ? true : null,
    );

    const note = document.querySelector<HTMLElement>("#cache-default");
    expect(note?.hidden).toBe(false);
    expect(note?.textContent).toContain("https://built-in.example.com");
  });

  it("asks Chrome for access before saving a server URL", async () => {
    await import("./options");
    const fields = form();

    fields.url.value = "https://cache.example.com/";
    submit(fields.element);

    await waitUntil(() => (saved ? true : null));

    expect(requestPermission).toHaveBeenCalledWith({
      origins: ["https://cache.example.com/*"],
    });
    expect(saved).toMatchObject({
      serverUrl: "https://cache.example.com",
      enabled: true,
    });
    expect(fields.status.textContent).toBe("Saved.");
  });

  it("does not save when Chrome refuses the permission", async () => {
    requestPermission.mockResolvedValue(false);
    await import("./options");
    const fields = form();

    fields.url.value = "https://cache.example.com";
    submit(fields.element);

    await waitUntil(() => (fields.status.hidden ? null : true));

    expect(saved).toBeNull();
    expect(fields.status.dataset.tone).toBe("error");
  });

  it("explains a URL it cannot use and asks for no permission", async () => {
    await import("./options");
    const fields = form();

    fields.url.value = "http://cache.example.com";
    submit(fields.element);

    await waitUntil(() => (fields.status.hidden ? null : true));

    expect(fields.status.textContent).toContain("https://");
    expect(requestPermission).not.toHaveBeenCalled();
    expect(saved).toBeNull();
  });

  it("turns the shared cache off without needing a permission prompt", async () => {
    await import("./options");
    const fields = form();

    fields.url.value = "";
    fields.enabled.checked = false;
    submit(fields.element);

    await waitUntil(() => (saved ? true : null));

    expect(requestPermission).not.toHaveBeenCalled();
    expect(saved).toMatchObject({ serverUrl: "", enabled: false, activeUrl: "" });
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
