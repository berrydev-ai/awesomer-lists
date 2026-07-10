// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ExtensionRequest } from "./messages";

let sendMessage: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
  document.body.replaceChildren();
  (
    window as typeof window & { happyDOM: { setURL: (url: string) => void } }
  ).happyDOM.setURL("chrome-extension://test/token.html?theme=dark&accent=indigo");
  sendMessage = vi.fn(async (request: ExtensionRequest) => {
    if (request.type === "auth.status") {
      return {
        ok: true,
        data: { hasToken: false, remembered: false, login: null },
      };
    }

    if (request.type === "auth.save") {
      return {
        ok: true,
        data: { hasToken: true, remembered: request.remember, login: "octocat" },
      };
    }

    return { ok: false, error: { code: "INVALID_REQUEST", message: "Invalid" } };
  });
  globalThis.chrome = {
    runtime: { sendMessage },
  } as unknown as typeof chrome;
});

describe("secure token page", () => {
  it("saves the token inside the extension page and posts back status only", async () => {
    const postMessage = vi.spyOn(window.parent, "postMessage");
    await import("./token");

    const form = document.querySelector<HTMLFormElement>("#token-form");
    const input = document.querySelector<HTMLInputElement>("#token-input");
    const remember = document.querySelector<HTMLInputElement>("#remember-token");
    const save = document.querySelector<HTMLButtonElement>("#save-token");
    if (!form || !input || !remember || !save) {
      throw new Error("Secure token form was not rendered.");
    }

    input.value = "dedicated-token-value-for-test";
    remember.checked = true;
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));

    await waitUntil(() => (postMessage.mock.calls.length > 0 ? true : null));
    expect(sendMessage).toHaveBeenCalledWith({
      type: "auth.save",
      token: "dedicated-token-value-for-test",
      remember: true,
    });
    expect(postMessage).toHaveBeenCalledWith(
      {
        type: "awesomer.auth.saved",
        auth: { hasToken: true, remembered: true, login: "octocat" },
      },
      "*",
    );
    expect(JSON.stringify(postMessage.mock.calls)).not.toContain(
      "dedicated-token-value-for-test",
    );

    postMessage.mockClear();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(postMessage).toHaveBeenCalledWith(
      { type: "awesomer.auth.key", key: "Escape" },
      "*",
    );

    postMessage.mockClear();
    input.focus();
    input.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Tab", shiftKey: true, bubbles: true }),
    );
    expect(postMessage).toHaveBeenCalledWith(
      { type: "awesomer.auth.key", key: "Tab", direction: "backward" },
      "*",
    );

    postMessage.mockClear();
    save.focus();
    save.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true }));
    expect(postMessage).toHaveBeenCalledWith(
      { type: "awesomer.auth.key", key: "Tab", direction: "forward" },
      "*",
    );
  });

  it("runs as a no-storage form inside the standalone UI preview", async () => {
    (
      window as typeof window & { happyDOM: { setURL: (url: string) => void } }
    ).happyDOM.setURL(
      "http://127.0.0.1:4173/token.html?preview=1&theme=dark&accent=indigo",
    );
    delete (globalThis as typeof globalThis & { chrome?: typeof chrome }).chrome;
    const postMessage = vi.spyOn(window.parent, "postMessage");

    await import("./token");

    expect(document.body.textContent).toContain("Preview mode only");
    const form = document.querySelector<HTMLFormElement>("#token-form");
    const input = document.querySelector<HTMLInputElement>("#token-input");
    if (!form || !input) throw new Error("Preview token form was not rendered.");

    input.value = "ui-test-value";
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));

    await waitUntil(() => (postMessage.mock.calls.length > 0 ? true : null));
    expect(postMessage).toHaveBeenCalledWith(
      {
        type: "awesomer.auth.saved",
        auth: { hasToken: true, remembered: false, login: "UI preview" },
      },
      "*",
    );
  });
});

async function waitUntil<T>(read: () => T | null): Promise<T> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const value = read();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  throw new Error("Timed out waiting for the secure token workflow.");
}
