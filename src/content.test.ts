// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from "vitest";

import type {
  ExtensionRequest,
  ExtensionResponse,
  MetadataLoadResult,
} from "./messages";
import { METADATA_PORT_NAME } from "./messages";

type ContentListener = (
  message: unknown,
  sender?: chrome.runtime.MessageSender,
  sendResponse?: (response: unknown) => void,
) => boolean | undefined;

let contentListener: ContentListener | null;
let connected: boolean;
let sendMessage: ReturnType<typeof vi.fn>;
let connect: ReturnType<typeof vi.fn>;
let modalShadowRoot: ShadowRoot | null;
let removeWindowListener: ReturnType<typeof vi.spyOn>;
let readmeMarkdown: string;
let nextAutoResults: Array<MetadataLoadResult | null>;
let ports: TestPort[];
let runtimeLastError: { message: string } | undefined;
let runtimeLastErrorReads: number;
let authStatusFailure: string | null;
let authClearFailuresRemaining: number;
const nativeAttachShadow = Element.prototype.attachShadow;

interface TestPort {
  port: chrome.runtime.Port;
  postMessage: ReturnType<typeof vi.fn>;
  disconnect: ReturnType<typeof vi.fn>;
  emit: (response: ExtensionResponse<MetadataLoadResult>) => void;
  drop: (message?: string) => void;
}

const MASTRA_METADATA = {
  nameWithOwner: "mastra-ai/mastra",
  url: "https://github.com/mastra-ai/mastra",
  description: "Build AI applications and agents.",
  stars: 20_000,
  forks: 1_500,
  openIssues: 125,
  lastCommitAt: "2026-07-09T12:00:00Z",
  license: "Apache-2.0",
  isArchived: false,
  fetchedAt: "2026-07-09T12:00:00Z",
};

const defaultResult = (): MetadataLoadResult => ({
  metadata: [MASTRA_METADATA],
  missing: [],
  rateLimit: { remaining: 4_900, resetAt: "2026-07-09T13:00:00Z" },
  cachedCount: 1,
  staleCount: 0,
  pendingCount: 0,
  complete: true,
  warning: null,
});

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
  ports = [];
  nextAutoResults = [];
  runtimeLastError = undefined;
  runtimeLastErrorReads = 0;
  authStatusFailure = null;
  authClearFailuresRemaining = 0;
  readmeMarkdown = `# Awesome Agents

## Frameworks

- [Mastra](https://github.com/mastra-ai/mastra) - Build AI applications and agents.
`;
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
      if (authStatusFailure) {
        return {
          ok: false,
          error: { code: "INVALID_REQUEST", message: authStatusFailure },
        };
      }
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

    if (request.type === "auth.clear") {
      if (authClearFailuresRemaining > 0) {
        authClearFailuresRemaining -= 1;
        return {
          ok: false,
          error: {
            code: "INVALID_REQUEST",
            message: "Saved access could not be removed.",
          },
        };
      }
      connected = false;
      authStatusFailure = null;
      return {
        ok: true,
        data: { hasToken: false, remembered: false, login: null },
      };
    }

    if (request.type === "readme.load") {
      return { ok: true, data: readmeMarkdown };
    }

    return { ok: true, data: null };
  });
  connect = vi.fn(() => {
    const testPort = createTestPort();
    ports.push(testPort);
    return testPort.port;
  });

  globalThis.chrome = {
    runtime: {
      onMessage: {
        addListener: vi.fn((listener: ContentListener) => {
          contentListener = listener;
        }),
      },
      sendMessage,
      connect,
      get lastError() {
        runtimeLastErrorReads += 1;
        return runtimeLastError;
      },
      getURL: vi.fn((path: string) =>
        path === "token.html" ? "about:blank" : `chrome-extension://test/${path}`,
      ),
    },
  } as unknown as typeof chrome;

  await import("./content");
});

describe("content modal workflow", () => {
  it("acknowledges toolbar presence without opening the modal", () => {
    const reply = vi.fn();

    expect(contentListener?.({ type: "awesomer.ping" }, undefined, reply)).toBe(false);
    expect(reply).toHaveBeenCalledWith("awesomer.ready");
    expect(document.getElementById("awesomer-lists-extension-root")).toBeNull();
  });

  it("acknowledges toolbar toggles", async () => {
    const reply = vi.fn();

    expect(contentListener?.({ type: "awesomer.toggle" }, undefined, reply)).toBe(false);
    expect(reply).toHaveBeenCalledWith("awesomer.ready");
    await waitUntil(() => modalShadowRoot);
  });

  it("offers disconnect when saved GitHub access status cannot be read", async () => {
    authStatusFailure = "Saved access needs recovery.";
    contentListener?.({ type: "awesomer.toggle" });
    const shadow = await waitUntil(() => modalShadowRoot);
    const disconnect = await waitUntil(() => {
      const button = shadow.querySelector<HTMLButtonElement>("#remove-token");
      return button && !button.hidden ? button : null;
    });

    expect(shadow.querySelector("#auth-error")?.textContent).toContain(
      "Could not read saved GitHub access",
    );
    expect(disconnect.textContent).toBe("Disconnect");
    disconnect.click();

    await waitUntil(() =>
      shadow.querySelector("#auth-error")?.textContent?.includes("disconnected")
        ? true
        : null,
    );
    expect(sendMessage).toHaveBeenCalledWith({ type: "auth.clear" });
    expect(disconnect.hidden).toBe(true);
  });

  it("shows a disconnect failure and lets the user retry", async () => {
    authStatusFailure = "Saved access needs recovery.";
    authClearFailuresRemaining = 1;
    contentListener?.({ type: "awesomer.toggle" });
    const shadow = await waitUntil(() => modalShadowRoot);
    const disconnect = await waitUntil(() => {
      const button = shadow.querySelector<HTMLButtonElement>("#remove-token");
      return button && !button.hidden ? button : null;
    });
    disconnect.click();

    await waitUntil(() =>
      shadow.querySelector("#auth-error")?.textContent?.includes(
        "Could not disconnect GitHub access",
      )
        ? true
        : null,
    );
    expect(disconnect.hidden).toBe(false);
    expect(disconnect.disabled).toBe(false);

    disconnect.click();
    await waitUntil(() =>
      shadow.querySelector("#auth-error")?.textContent?.includes("disconnected")
        ? true
        : null,
    );
    expect(
      sendMessage.mock.calls.filter(([request]) => request.type === "auth.clear"),
    ).toHaveLength(2);
    expect(disconnect.hidden).toBe(true);
  });

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
    expect(connect).toHaveBeenCalledWith({ name: METADATA_PORT_NAME });
    expect(ports[0]?.postMessage).toHaveBeenCalledWith({
      type: "metadata.load",
      repositories: ["mastra-ai/mastra"],
      refresh: false,
    });

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

    const metadataCallsBeforeClose = ports.length;
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
    expect(ports).toHaveLength(metadataCallsBeforeClose);

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
      ports.some((testPort) =>
        testPort.postMessage.mock.calls.some(
          ([request]) => request.type === "metadata.load" && request.refresh,
        ),
      ) || null,
    );
  });

  it("renders cached rows before completion and applies later cumulative snapshots", async () => {
    connected = true;
    readmeMarkdown +=
      "\n- [Trigger.dev](https://github.com/triggerdotdev/trigger.dev) - Run background jobs.\n";
    nextAutoResults.push({
      ...defaultResult(),
      staleCount: 1,
      pendingCount: 1,
      complete: false,
      warning: "Showing older cached data while GitHub updates it.",
    });
    contentListener?.({ type: "awesomer.toggle" });

    const shadow = await waitUntil(() => modalShadowRoot);
    await waitUntil(() =>
      shadow.querySelector("#footer")?.textContent?.includes("still loading")
        ? true
        : null,
    );
    expect(shadow.querySelectorAll(".project-row")).toHaveLength(2);
    expect(shadow.querySelector("#footer")?.textContent).toContain("1 cached");
    expect(shadow.querySelector("#footer")?.textContent).toContain("1 stale");
    expect(shadow.querySelector("#footer")?.textContent).toContain(
      "Showing older cached data",
    );

    ports[0]?.emit({
      ok: true,
      data: {
        ...defaultResult(),
        metadata: [
          MASTRA_METADATA,
          {
            ...MASTRA_METADATA,
            nameWithOwner: "triggerdotdev/trigger.dev",
            url: "https://github.com/triggerdotdev/trigger.dev",
            stars: 9_000,
          },
        ],
      },
    });

    await waitUntil(() =>
      [...shadow.querySelectorAll(".popularity-cell")].some((cell) =>
        cell.textContent?.includes("9,000"),
      )
        ? true
        : null,
    );
    expect(shadow.querySelector("#footer")?.textContent).not.toContain(
      "still loading",
    );
    expect(shadow.querySelector("#footer")?.textContent).not.toContain(
      "Showing older cached data",
    );
  });

  it("removes cached metadata when a later snapshot marks a repository missing", async () => {
    connected = true;
    readmeMarkdown +=
      "\n- [Trigger.dev](https://github.com/triggerdotdev/trigger.dev) - Run background jobs.\n";
    const triggerMetadata = {
      ...MASTRA_METADATA,
      nameWithOwner: "triggerdotdev/trigger.dev",
      url: "https://github.com/triggerdotdev/trigger.dev",
      stars: 9_000,
    };
    nextAutoResults.push({
      ...defaultResult(),
      metadata: [MASTRA_METADATA, triggerMetadata],
      cachedCount: 2,
      pendingCount: 1,
      complete: false,
    });
    contentListener?.({ type: "awesomer.toggle" });
    const shadow = await waitUntil(() => modalShadowRoot);
    await waitUntil(() =>
      shadow.querySelector(".popularity-cell")?.textContent?.includes("20,000")
        ? true
        : null,
    );

    ports[0]?.emit({
      ok: true,
      data: {
        ...defaultResult(),
        metadata: [triggerMetadata],
        missing: ["mastra-ai/mastra"],
        cachedCount: 0,
      },
    });

    await waitUntil(() =>
      shadow.querySelector("#footer")?.textContent?.includes("1 unavailable")
        ? true
        : null,
    );
    const mastraRow = [...shadow.querySelectorAll<HTMLElement>(".project-row")]
      .find((row) => row.textContent?.includes("mastra-ai/mastra"));
    expect(mastraRow?.querySelector(".popularity-cell")?.textContent).toBe("—");
  });

  it("keeps rows during refresh and ignores a superseded stream", async () => {
    connected = true;
    nextAutoResults.push(
      { ...defaultResult(), pendingCount: 1, complete: false },
      null,
    );
    contentListener?.({ type: "awesomer.toggle" });
    const shadow = await waitUntil(() => modalShadowRoot);
    await waitUntil(() => shadow.querySelector(".project-row"));

    shadow.querySelector<HTMLButtonElement>("#settings-button")?.click();
    shadow.querySelector<HTMLButtonElement>("#refresh-button")?.click();
    await waitUntil(() => (ports.length === 2 ? true : null));
    expect(shadow.querySelector(".popularity-cell")?.textContent).toContain(
      "20,000",
    );
    expect(ports[0]?.disconnect).toHaveBeenCalled();

    ports[0]?.emit({
      ok: true,
      data: {
        ...defaultResult(),
        metadata: [{ ...MASTRA_METADATA, stars: 1 }],
      },
    });
    await Promise.resolve();
    expect(shadow.querySelector(".popularity-cell")?.textContent).toContain(
      "20,000",
    );

    ports[1]?.emit({
      ok: true,
      data: {
        ...defaultResult(),
        metadata: [{ ...MASTRA_METADATA, stars: 30_000 }],
        cachedCount: 0,
      },
    });
    await waitUntil(() =>
      shadow.querySelector(".popularity-cell")?.textContent?.includes("30,000")
        ? true
        : null,
    );
  });

  it("keeps visible values when a manual refresh ends with pending work", async () => {
    connected = true;
    nextAutoResults.push(defaultResult(), null);
    contentListener?.({ type: "awesomer.toggle" });
    const shadow = await waitUntil(() => modalShadowRoot);
    await waitUntil(() => shadow.querySelector(".project-row"));

    shadow.querySelector<HTMLButtonElement>("#settings-button")?.click();
    shadow.querySelector<HTMLButtonElement>("#refresh-button")?.click();
    await waitUntil(() => (ports.length === 2 ? true : null));
    ports[1]?.emit({
      ok: true,
      data: {
        ...defaultResult(),
        metadata: [],
        cachedCount: 0,
        pendingCount: 1,
        complete: true,
        warning: "GitHub did not respond before the request timed out.",
      },
    });

    await waitUntil(() =>
      shadow.querySelector("#footer")?.textContent?.includes("not updated")
        ? true
        : null,
    );
    expect(shadow.querySelector(".popularity-cell")?.textContent).toContain(
      "20,000",
    );
    expect(shadow.querySelector("#footer")?.textContent).not.toContain(
      "still loading",
    );
  });

  it("keeps useful rows and offers retry when the stream disconnects", async () => {
    connected = true;
    nextAutoResults.push({ ...defaultResult(), pendingCount: 1, complete: false });
    contentListener?.({ type: "awesomer.toggle" });
    const shadow = await waitUntil(() => modalShadowRoot);
    await waitUntil(() => shadow.querySelector(".project-row"));

    ports[0]?.drop("The extension service worker restarted.");
    const retry = await waitUntil(() =>
      shadow.querySelector<HTMLButtonElement>("#stream-retry-button"),
    );
    expect(shadow.querySelector(".project-row")).not.toBeNull();
    expect(shadow.querySelector("#footer")?.textContent).toContain(
      "Metadata updates stopped",
    );
    expect(shadow.querySelector("#footer")?.textContent).toContain(
      "1 project was not updated",
    );
    expect(shadow.querySelector("#footer")?.textContent).not.toContain(
      "still loading",
    );
    expect(runtimeLastErrorReads).toBeGreaterThan(0);

    nextAutoResults.push(defaultResult());
    retry.click();
    await waitUntil(() => (ports.length === 2 ? true : null));
  });

  it("offers GitHub access when a terminal warning says the token was rejected", async () => {
    connected = true;
    nextAutoResults.push({
      ...defaultResult(),
      pendingCount: 1,
      complete: true,
      warning: "GitHub rejected the token. Check it and try again.",
    });
    contentListener?.({ type: "awesomer.toggle" });
    const shadow = await waitUntil(() => modalShadowRoot);
    const tokenButton = await waitUntil(() =>
      shadow.querySelector<HTMLButtonElement>("#stream-token-button"),
    );

    expect(shadow.querySelector("#footer")?.textContent).toContain(
      "1 project was not updated",
    );
    tokenButton.click();
    expect(shadow.querySelector<HTMLElement>("#auth-view")?.hidden).toBe(false);
    expect(shadow.querySelector("#auth-error")?.textContent).toContain(
      "GitHub rejected the token",
    );
  });
});

function createTestPort(): TestPort {
  const messageListeners = new Set<(message: ExtensionResponse<MetadataLoadResult>) => void>();
  const disconnectListeners = new Set<() => void>();
  const autoResult = nextAutoResults.length > 0 ? nextAutoResults.shift() : defaultResult();
  let testPort: TestPort;
  const postMessage = vi.fn(() => {
    if (autoResult) {
      queueMicrotask(() => testPort.emit({ ok: true, data: autoResult }));
    }
  });
  const disconnect = vi.fn();
  const port = {
    name: METADATA_PORT_NAME,
    postMessage,
    disconnect,
    onMessage: {
      addListener: (listener: (message: ExtensionResponse<MetadataLoadResult>) => void) =>
        messageListeners.add(listener),
      removeListener: (listener: (message: ExtensionResponse<MetadataLoadResult>) => void) =>
        messageListeners.delete(listener),
    },
    onDisconnect: {
      addListener: (listener: () => void) => disconnectListeners.add(listener),
      removeListener: (listener: () => void) => disconnectListeners.delete(listener),
    },
  } as unknown as chrome.runtime.Port;
  testPort = {
    port,
    postMessage,
    disconnect,
    emit: (response) => messageListeners.forEach((listener) => listener(response)),
    drop: (message) => {
      runtimeLastError = message ? { message } : undefined;
      disconnectListeners.forEach((listener) => listener());
      runtimeLastError = undefined;
    },
  };
  return testPort;
}

async function waitUntil<T>(read: () => T | null): Promise<T> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const value = read();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  throw new Error("Timed out waiting for the modal workflow.");
}
