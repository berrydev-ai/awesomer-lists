// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AuthStatus, ExtensionResponse } from "./messages";

let modalShadowRoot: ShadowRoot | null;
const nativeAttachShadow = Element.prototype.attachShadow;

beforeEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
  document.body.replaceChildren();
  document.getElementById("awesomer-lists-extension-root")?.remove();
  (
    window as typeof window & { happyDOM: { setURL: (url: string) => void } }
  ).happyDOM.setURL("http://127.0.0.1:4173/preview.html");
  modalShadowRoot = null;
  vi.spyOn(Element.prototype, "attachShadow").mockImplementation(function (
    this: Element,
    options: ShadowRootInit,
  ) {
    const root = nativeAttachShadow.call(this, options);
    if (this.id === "awesomer-lists-extension-root") modalShadowRoot = root;
    return root;
  });
});

describe("standalone UI preview", () => {
  it("opens the grouped production modal without extension APIs", async () => {
    await import("./preview");

    const shadow = await waitUntil(() => modalShadowRoot);
    await waitUntil(() => shadow.querySelector(".project-row"));

    expect(shadow.querySelectorAll(".project-row").length).toBeGreaterThan(3);
    expect(
      [...shadow.querySelectorAll<HTMLElement>(".group-title")].map(
        (element) => element.textContent,
      ),
    ).toContain("Parallel Agent Runners");
    expect(
      shadow.querySelector<HTMLAnchorElement>("#source-link")?.textContent,
    ).toContain("awesome-agent-orchestrators");
    expect(
      shadow.querySelector<HTMLElement>("#main-view")?.hidden,
    ).toBe(false);
    expect(
      document.getElementById("awesomer-lists-extension-root")?.shadowRoot,
    ).toBeNull();

    await chrome.runtime.sendMessage({ type: "auth.clear" });
    window.dispatchEvent(
      new MessageEvent("message", {
        origin: location.origin,
        data: {
          type: "awesomer.auth.saved",
          auth: { hasToken: true, remembered: false, login: "UI preview" },
        },
      }),
    );
    const authResponse = (await chrome.runtime.sendMessage({
      type: "auth.status",
    })) as ExtensionResponse<AuthStatus>;
    expect(authResponse).toEqual({
      ok: true,
      data: { hasToken: true, remembered: false, login: "UI preview" },
    });

    const openButton = document.querySelector<HTMLButtonElement>(
      "#open-preview-button",
    );
    if (!openButton) throw new Error("Preview launcher was not rendered.");
    openButton.click();
    expect(document.getElementById("awesomer-lists-extension-root")).toBeNull();

    const previousShadow = modalShadowRoot;
    openButton.click();
    await waitUntil(() =>
      modalShadowRoot && modalShadowRoot !== previousShadow
        ? modalShadowRoot
        : null,
    );
  });
});

async function waitUntil<T>(read: () => T | null): Promise<T> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const value = read();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  throw new Error("Timed out waiting for the standalone preview.");
}
