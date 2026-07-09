// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ExtensionRequest } from "./messages";

type ContentListener = (message: unknown) => void;

let contentListener: ContentListener | null;
let connected: boolean;
let sendMessage: ReturnType<typeof vi.fn>;

beforeEach(async () => {
  vi.resetModules();
  document.getElementById("awesomer-lists-extension-root")?.remove();
  (
    window as typeof window & { happyDOM: { setURL: (url: string) => void } }
  ).happyDOM.setURL("https://github.com/sindresorhus/awesome#readme");
  contentListener = null;
  connected = false;
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
              lastCommitAt: "2026-07-08T12:00:00Z",
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
    },
  } as unknown as typeof chrome;

  await import("./content");
});

describe("content modal workflow", () => {
  it("moves from dedicated-token setup to an exact sortable project table", async () => {
    contentListener?.({ type: "awesomer.toggle" });

    const shadow = await waitUntil(() =>
      document.getElementById("awesomer-lists-extension-root")?.shadowRoot ?? null,
    );
    const authView = await waitUntil(() => {
      const view = shadow.querySelector<HTMLElement>("#auth-view");
      return view && !view.hidden ? view : null;
    });
    expect(authView.hidden).toBe(false);

    const tokenInput = shadow.querySelector<HTMLInputElement>("#token-input");
    const authForm = shadow.querySelector<HTMLFormElement>("#auth-form");
    if (!tokenInput || !authForm) throw new Error("Token form was not rendered.");

    tokenInput.value = "dedicated-token-value-for-test";
    authForm.dispatchEvent(
      new Event("submit", { bubbles: true, cancelable: true }),
    );

    const projectLink = await waitUntil(() =>
      shadow.querySelector<HTMLAnchorElement>(".project-link"),
    );
    const popularity = shadow.querySelector<HTMLElement>(".popularity-cell");

    expect(projectLink.textContent).toBe("Mastra");
    expect(popularity?.textContent).toContain("20,000");
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
