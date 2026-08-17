// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ExtensionRequest } from "./messages";

type ContentListener = (message: unknown) => void;

let contentListener: ContentListener | null;
let connected: boolean;
let sendMessage: ReturnType<typeof vi.fn>;
let modalShadowRoot: ShadowRoot | null;
let removeWindowListener: ReturnType<typeof vi.spyOn>;
const nativeAttachShadow = Element.prototype.attachShadow;

beforeEach(async () => {
  vi.restoreAllMocks();
  vi.resetModules();
  document.getElementById("awesomer-lists-extension-root")?.remove();
  (
    window as typeof window & { happyDOM: { setURL: (url: string) => void } }
  ).happyDOM.setURL("https://github.com/sindresorhus/awesome#readme");
  contentListener = null;
  connected = false;
  modalShadowRoot = null;
  removeWindowListener = vi.spyOn(window, "removeEventListener");
  vi.spyOn(Element.prototype, "attachShadow").mockImplementation(function (
    this: Element,
    options: ShadowRootInit,
  ) {
    const root = nativeAttachShadow.call(this, options);
    if (this.id === "awesomer-lists-extension-root") modalShadowRoot = root;
    return root;
  });
  sendMessage = vi.fn(async (request: ExtensionRequest) => {
    if (request.type === "auth.status") {
      return {
        ok: true,
        data: { hasToken: connected, remembered: false, login: null },
      };
    }

    if (request.type === "auth.save") {
      connected = true;
      return {
        ok: true,
        data: { hasToken: true, remembered: false, login: "octocat" },
      };
    }

    if (request.type === "readme.load") {
      return {
        ok: true,
        data: `# Awesome Agents

## Frameworks

- [Mastra](https://github.com/mastra-ai/mastra) - Build AI applications and agents.
`,
      };
    }

    if (request.type === "metadata.load") {
      return {
        ok: true,
        data: {
          metadata: [
            {
              nameWithOwner: "mastra-ai/mastra",
              url: "https://github.com/mastra-ai/mastra",
              description: "Build AI applications and agents.",
              stars: 20_000,
              forks: 1_500,
              openIssues: 125,
              lastCommitAt: new Date().toISOString(),
              license: "Apache-2.0",
              isArchived: false,
              fetchedAt: "2026-07-09T12:00:00Z",
            },
          ],
          missing: [],
          rateLimit: {
            remaining: 4_900,
            resetAt: "2026-07-09T13:00:00Z",
          },
          cachedCount: 0,
        },
      };
    }

    return { ok: true, data: null };
  });

  globalThis.chrome = {
    runtime: {
      onMessage: {
        addListener: vi.fn((listener: ContentListener) => {
          contentListener = listener;
        }),
      },
      sendMessage,
      getURL: vi.fn((path: string) =>
        path === "token.html" ? "about:blank" : `chrome-extension://test/${path}`,
      ),
    },
  } as unknown as typeof chrome;

  await import("./content");
});

describe("content modal workflow", () => {
  it("moves from dedicated-token setup to an exact sortable project table", async () => {
    contentListener?.({ type: "awesomer.toggle" });

    const shadow = await waitUntil(() => modalShadowRoot);
    expect(
      document.getElementById("awesomer-lists-extension-root")?.shadowRoot,
    ).toBeNull();
    const authView = await waitUntil(() => {
      const view = shadow.querySelector<HTMLElement>("#auth-view");
      return view && !view.hidden ? view : null;
    });
    expect(authView.hidden).toBe(false);

    expect(shadow.querySelector('input[type="password"]')).toBeNull();
    const tokenFrame = shadow.querySelector<HTMLIFrameElement>("#token-frame");
    if (!tokenFrame?.contentWindow) {
      throw new Error("Secure token frame was not rendered.");
    }
    connected = true;
    window.dispatchEvent(
      new MessageEvent("message", {
        source: tokenFrame.contentWindow,
        origin: new URL("about:blank").origin,
        data: {
          type: "awesomer.auth.saved",
          auth: { hasToken: true, remembered: false, login: "octocat" },
        },
      }),
    );

    const projectLink = await waitUntil(() =>
      shadow.querySelector<HTMLAnchorElement>(".project-link"),
    );
    const popularity = shadow.querySelector<HTMLElement>(".popularity-cell");

    expect(projectLink.textContent).toBe("Mastra");
    expect(popularity?.textContent).toContain("20,000");
    expect(shadow.querySelector('[role="table"]')).not.toBeNull();
    expect(shadow.querySelectorAll('.project-row [role="cell"]')).toHaveLength(
      6,
    );
    expect(shadow.querySelector('.group-row [role="rowheader"]')).not.toBeNull();
    expect(sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "metadata.load",
        repositories: ["mastra-ai/mastra"],
      }),
    );

    const dialog = shadow.querySelector<HTMLElement>(".dialog");
    const settingsButton = shadow.querySelector<HTMLButtonElement>(
      "#settings-button",
    );
    const settingsPanel = shadow.querySelector<HTMLElement>("#settings-panel");
    if (!dialog || !settingsButton || !settingsPanel) {
      throw new Error("The redesigned modal shell was not rendered.");
    }

    expect(dialog.dataset.theme).toBe("system");
    expect(settingsPanel.hidden).toBe(true);
    settingsButton.click();
    expect(settingsPanel.hidden).toBe(false);

    const lightTheme = shadow.querySelector<HTMLButtonElement>(
      '[data-theme-mode="light"]',
    );
    if (!lightTheme) throw new Error("Light theme control was not rendered.");
    lightTheme.click();
    expect(dialog.dataset.theme).toBe("light");

    shadow
      .querySelector<HTMLButtonElement>('[data-accent="rose"]')
      ?.click();
    expect(dialog.dataset.accent).toBe("rose");
    shadow.querySelector<HTMLButtonElement>("#settings-close")?.click();
    await Promise.resolve();

    const activeChip = shadow.querySelector<HTMLButtonElement>(
      '[data-maintenance="active"]',
    );
    activeChip?.click();
    expect(activeChip?.getAttribute("aria-pressed")).toBe("true");

    shadow.querySelector<HTMLButtonElement>("#license-filter-button")?.click();
    expect(
      shadow.querySelector<HTMLElement>("#license-filter-panel")?.hidden,
    ).toBe(false);
    expect(shadow.querySelector("#license-filter-panel")?.textContent).toContain(
      "Apache-2.0",
    );
    const licenseOption = shadow.querySelector<HTMLButtonElement>(
      '#license-filter-options [data-filter-value="Apache-2.0"]',
    );
    licenseOption?.click();
    await Promise.resolve();
    expect(shadow.activeElement?.textContent).toContain("Apache-2.0");
    shadow.querySelector<HTMLInputElement>("#search-input")?.click();
    expect(
      shadow.querySelector<HTMLElement>("#license-filter-panel")?.hidden,
    ).toBe(true);

    const collapseButton = shadow.querySelector<HTMLButtonElement>(
      "#toggle-groups-button",
    );
    collapseButton?.click();
    expect(shadow.querySelectorAll(".project-row")).toHaveLength(0);
    expect(collapseButton?.textContent).toContain("Expand all");
    collapseButton?.click();
    expect(shadow.querySelectorAll(".project-row")).toHaveLength(1);

    expect(
      shadow.querySelector<HTMLAnchorElement>("#project-repository-link")?.href,
    ).toBe("https://github.com/berrydev-ai/awesomer-lists");

    const metadataCallsBeforeClose = sendMessage.mock.calls.filter(
      ([request]) => request.type === "metadata.load",
    ).length;
    contentListener?.({ type: "awesomer.toggle" });
    expect(document.getElementById("awesomer-lists-extension-root")).toBeNull();
    expect(removeWindowListener).toHaveBeenCalledWith(
      "message",
      expect.any(Function),
    );
    window.dispatchEvent(
      new MessageEvent("message", {
        source: tokenFrame.contentWindow,
        origin: new URL("about:blank").origin,
        data: {
          type: "awesomer.auth.saved",
          auth: { hasToken: true, remembered: false, login: "octocat" },
        },
      }),
    );
    await Promise.resolve();
    expect(
      sendMessage.mock.calls.filter(
        ([request]) => request.type === "metadata.load",
      ),
    ).toHaveLength(metadataCallsBeforeClose);

    const previousShadow = modalShadowRoot;
    contentListener?.({ type: "awesomer.toggle" });
    const reopenedShadow = await waitUntil(() =>
      modalShadowRoot && modalShadowRoot !== previousShadow
        ? modalShadowRoot
        : null,
    );
    await waitUntil(() => reopenedShadow.querySelector(".project-row"));
    const reopenedTokenFrame = reopenedShadow.querySelector<HTMLIFrameElement>(
      "#token-frame",
    );
    if (!reopenedTokenFrame?.contentWindow) {
      throw new Error("Reopened secure token frame was not rendered.");
    }
    window.dispatchEvent(
      new MessageEvent("message", {
        source: reopenedTokenFrame.contentWindow,
        origin: new URL("about:blank").origin,
        data: { type: "awesomer.auth.key", key: "Escape" },
      }),
    );
    expect(document.getElementById("awesomer-lists-extension-root")).toBeNull();
  });

  it("refreshes data from the settings panel", async () => {
    connected = true;
    contentListener?.({ type: "awesomer.toggle" });

    const shadow = await waitUntil(() => modalShadowRoot);
    await waitUntil(() => shadow.querySelector(".project-row"));

    const settingsPanel = shadow.querySelector<HTMLElement>("#settings-panel");
    const refreshButton = shadow.querySelector<HTMLButtonElement>(
      "#refresh-button",
    );
    if (!settingsPanel || !refreshButton) {
      throw new Error("The settings refresh control was not rendered.");
    }

    expect(shadow.querySelector(".toolbar #refresh-button")).toBeNull();
    expect(settingsPanel.contains(refreshButton)).toBe(true);
    expect(refreshButton.className).toContain("compact-button");

    shadow.querySelector<HTMLButtonElement>("#settings-button")?.click();
    expect(settingsPanel.hidden).toBe(false);

    refreshButton.click();
    expect(settingsPanel.hidden).toBe(true);
    await waitUntil(() =>
      sendMessage.mock.calls.some(
        ([request]) => request.type === "metadata.load" && request.refresh,
      ) || null,
    );
  });
});

async function waitUntil<T>(read: () => T | null): Promise<T> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const value = read();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  throw new Error("Timed out waiting for the modal workflow.");
}
