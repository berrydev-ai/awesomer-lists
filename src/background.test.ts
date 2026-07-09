import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ExtensionRequest, ExtensionResponse } from "./messages";

const clientMocks = vi.hoisted(() => ({
  validateGitHubToken: vi.fn(),
  fetchRepositoryMetadataBatch: vi.fn(),
}));

vi.mock("./github/client", async () => {
  const actual = await vi.importActual<typeof import("./github/client")>(
    "./github/client",
  );

  return {
    ...actual,
    validateGitHubToken: clientMocks.validateGitHubToken,
    fetchRepositoryMetadataBatch: clientMocks.fetchRepositoryMetadataBatch,
  };
});

type RuntimeListener = (
  message: unknown,
  sender: chrome.runtime.MessageSender,
  sendResponse: (response: ExtensionResponse<unknown>) => void,
) => boolean | undefined;

interface MemoryStorageArea {
  data: Record<string, unknown>;
  area: chrome.storage.StorageArea;
  setAccessLevel: ReturnType<typeof vi.fn>;
}

let runtimeListener: RuntimeListener | null;
let localStorageArea: MemoryStorageArea;
let sessionStorageArea: MemoryStorageArea;

beforeEach(async () => {
  vi.resetModules();
  clientMocks.validateGitHubToken.mockReset().mockResolvedValue("octocat");
  clientMocks.fetchRepositoryMetadataBatch.mockReset();
  localStorageArea = createMemoryStorageArea();
  sessionStorageArea = createMemoryStorageArea();
  runtimeListener = null;

  globalThis.chrome = {
    action: {
      onClicked: { addListener: vi.fn() },
      setBadgeText: vi.fn(),
      setBadgeBackgroundColor: vi.fn(),
    },
    runtime: {
      onMessage: {
        addListener: vi.fn((listener: RuntimeListener) => {
          runtimeListener = listener;
        }),
      },
    },
    scripting: { executeScript: vi.fn() },
    tabs: { sendMessage: vi.fn() },
    storage: {
      local: {
        ...localStorageArea.area,
        setAccessLevel: localStorageArea.setAccessLevel,
      },
      session: {
        ...sessionStorageArea.area,
        setAccessLevel: sessionStorageArea.setAccessLevel,
      },
    },
  } as unknown as typeof chrome;

  await import("./background");
});

describe("background message workflow", () => {
  it("keeps a session token private and reuses cached repository metadata", async () => {
    const token = "dedicated-token-value-for-test";
    const authResponse = await sendRequest({
      type: "auth.save",
      token,
      remember: false,
    });

    expect(authResponse).toEqual({
      ok: true,
      data: { hasToken: true, remembered: false, login: "octocat" },
    });
    expect(JSON.stringify(authResponse)).not.toContain(token);
    expect(sessionStorageArea.data["auth.githubToken"]).toBe(token);
    expect(localStorageArea.data["auth.githubToken"]).toBeUndefined();
    expect(localStorageArea.setAccessLevel).toHaveBeenCalledWith({
      accessLevel: "TRUSTED_CONTEXTS",
    });

    clientMocks.fetchRepositoryMetadataBatch.mockResolvedValue({
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
      rateLimit: { remaining: 4_900, resetAt: "2026-07-09T13:00:00Z" },
    });

    const request: ExtensionRequest = {
      type: "metadata.load",
      repositories: ["mastra-ai/mastra"],
      refresh: false,
    };
    const firstResponse = await sendRequest(request);
    const secondResponse = await sendRequest(request);

    expect(firstResponse.ok).toBe(true);
    expect(secondResponse.ok).toBe(true);
    expect(clientMocks.fetchRepositoryMetadataBatch).toHaveBeenCalledTimes(1);
  });
});

function createMemoryStorageArea(): MemoryStorageArea {
  const data: Record<string, unknown> = {};
  const area = {
    get: vi.fn(async (keys?: string | string[] | Record<string, unknown> | null) => {
      if (keys === null || keys === undefined) return { ...data };
      const names = Array.isArray(keys)
        ? keys
        : typeof keys === "string"
          ? [keys]
          : Object.keys(keys);
      return Object.fromEntries(
        names.flatMap((name) => (name in data ? [[name, data[name]]] : [])),
      );
    }),
    set: vi.fn(async (values: Record<string, unknown>) => {
      Object.assign(data, values);
    }),
    remove: vi.fn(async (keys: string | string[]) => {
      for (const key of Array.isArray(keys) ? keys : [keys]) delete data[key];
    }),
  } as unknown as chrome.storage.StorageArea;

  return {
    data,
    area,
    setAccessLevel: vi.fn(async () => undefined),
  };
}

async function sendRequest(
  request: ExtensionRequest,
): Promise<ExtensionResponse<unknown>> {
  if (!runtimeListener) throw new Error("Background listener was not registered.");

  return new Promise((resolve, reject) => {
    const keepAlive = runtimeListener?.(
      request,
      {
        tab: { url: "https://github.com/sindresorhus/awesome" } as chrome.tabs.Tab,
      },
      resolve,
    );

    if (!keepAlive) reject(new Error("Background rejected the GitHub sender."));
  });
}
