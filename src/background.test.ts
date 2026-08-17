import { beforeEach, describe, expect, it, vi } from "vitest";

import type {
  ExtensionRequest,
  ExtensionResponse,
  MetadataLoadResult,
} from "./messages";

const clientMocks = vi.hoisted(() => ({
  validateGitHubToken: vi.fn(),
  fetchRepositoryMetadataBatch: vi.fn(),
}));

const sharedCacheMocks = vi.hoisted(() => ({
  lookupSharedMetadata: vi.fn(),
  publishSharedMetadata: vi.fn(),
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

vi.mock("./server-cache/client", () => ({
  lookupSharedMetadata: sharedCacheMocks.lookupSharedMetadata,
  publishSharedMetadata: sharedCacheMocks.publishSharedMetadata,
}));

// `fetchedAt` is what the local cache measures a record's remaining life
// against, so fixtures that stand in for a fresh GitHub answer must be recent.
const JUST_FETCHED = new Date().toISOString();

const MASTRA = {
  nameWithOwner: "mastra-ai/mastra",
  url: "https://github.com/mastra-ai/mastra",
  description: "Build AI applications and agents.",
  stars: 20_000,
  forks: 1_500,
  openIssues: 125,
  lastCommitAt: "2026-07-08T12:00:00Z",
  license: "Apache-2.0",
  isArchived: false,
  fetchedAt: JUST_FETCHED,
};

const NEXT = {
  ...MASTRA,
  nameWithOwner: "vercel/next.js",
  url: "https://github.com/vercel/next.js",
};

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
  sharedCacheMocks.lookupSharedMetadata.mockReset().mockResolvedValue([]);
  sharedCacheMocks.publishSharedMetadata.mockReset().mockResolvedValue(0);
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
          fetchedAt: JUST_FETCHED,
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

describe("shared cache settings", () => {
  it("reports no shared cache until a server is saved", async () => {
    expect(await sendRequest({ type: "cache.status" })).toEqual({
      ok: true,
      data: { serverUrl: "", enabled: true, builtInUrl: "", activeUrl: "" },
    });
  });

  it("saves a normalized server URL and can turn the cache off again", async () => {
    expect(
      await sendRequest({
        type: "cache.save",
        serverUrl: "https://cache.example.com/",
        enabled: true,
      }),
    ).toEqual({
      ok: true,
      data: {
        serverUrl: "https://cache.example.com",
        enabled: true,
        builtInUrl: "",
        activeUrl: "https://cache.example.com",
      },
    });

    const off = (await sendRequest({
      type: "cache.save",
      serverUrl: "https://cache.example.com",
      enabled: false,
    })) as { data: { activeUrl: string } };
    expect(off.data.activeUrl).toBe("");
  });

  it("refuses a server URL that is not usable", async () => {
    const response = await sendRequest({
      type: "cache.save",
      serverUrl: "http://cache.example.com",
      enabled: true,
    });

    expect(response.ok).toBe(false);
    expect(localStorageArea.data["cache.shared"]).toBeUndefined();
  });
});

describe("shared cache during a metadata load", () => {
  const repositories = ["mastra-ai/mastra", "vercel/next.js"];

  async function connect(serverUrl = "https://cache.example.com"): Promise<void> {
    await sendRequest({
      type: "auth.save",
      token: "dedicated-token-value-for-test",
      remember: false,
    });

    if (serverUrl) {
      await sendRequest({ type: "cache.save", serverUrl, enabled: true });
    }
  }

  it("serves shared hits without asking GitHub and publishes what it did fetch", async () => {
    await connect();
    sharedCacheMocks.lookupSharedMetadata.mockResolvedValue([MASTRA]);
    clientMocks.fetchRepositoryMetadataBatch.mockResolvedValue({
      metadata: [NEXT],
      missing: [],
      rateLimit: null,
    });

    const response = (await sendRequest({
      type: "metadata.load",
      repositories,
      refresh: false,
    })) as { ok: true; data: MetadataLoadResult };

    expect(response.ok).toBe(true);
    expect(response.data.sharedCachedCount).toBe(1);
    expect(response.data.cachedCount).toBe(0);
    expect(response.data.metadata.map((item) => item.nameWithOwner)).toEqual(
      repositories,
    );
    expect(sharedCacheMocks.lookupSharedMetadata).toHaveBeenCalledWith(
      "https://cache.example.com",
      repositories,
    );
    // Only the repository GitHub actually answered for is offered back.
    expect(sharedCacheMocks.publishSharedMetadata).toHaveBeenCalledWith(
      "https://cache.example.com",
      [NEXT],
    );
    expect(
      clientMocks.fetchRepositoryMetadataBatch.mock.calls[0]?.[0].map(
        (repository: { nameWithOwner: string }) => repository.nameWithOwner,
      ),
    ).toEqual(["vercel/next.js"]);
  });

  it("keeps a shared hit on this device so the next visit skips the network", async () => {
    await connect();
    sharedCacheMocks.lookupSharedMetadata.mockResolvedValue([MASTRA, NEXT]);

    await sendRequest({ type: "metadata.load", repositories, refresh: false });
    sharedCacheMocks.lookupSharedMetadata.mockResolvedValue([]);
    const second = (await sendRequest({
      type: "metadata.load",
      repositories,
      refresh: false,
    })) as { data: MetadataLoadResult };

    expect(second.data.cachedCount).toBe(2);
    expect(second.data.sharedCachedCount).toBe(0);
    expect(clientMocks.fetchRepositoryMetadataBatch).not.toHaveBeenCalled();
  });

  it("does not let a shared record outlive the shared cache's own deadline", async () => {
    await connect();
    const sixDaysOld = {
      ...MASTRA,
      fetchedAt: new Date(Date.now() - 6 * 24 * 60 * 60 * 1_000).toISOString(),
    };
    sharedCacheMocks.lookupSharedMetadata.mockResolvedValue([sixDaysOld]);

    await sendRequest({
      type: "metadata.load",
      repositories: ["mastra-ai/mastra"],
      refresh: false,
    });

    const stored = localStorageArea.data["metadata.mastra-ai/mastra"] as {
      expiresAt: number;
    };
    const oneDay = 24 * 60 * 60 * 1_000;
    // Six hours would run past the record's seventh day, so it is trimmed to it.
    expect(stored.expiresAt - Date.now()).toBeGreaterThan(0);
    expect(stored.expiresAt - Date.now()).toBeLessThan(oneDay);
  });

  it("still loads from GitHub when the shared server cannot answer", async () => {
    await connect();
    sharedCacheMocks.lookupSharedMetadata.mockResolvedValue([]);
    clientMocks.fetchRepositoryMetadataBatch.mockResolvedValue({
      metadata: [MASTRA, NEXT],
      missing: [],
      rateLimit: null,
    });

    const response = (await sendRequest({
      type: "metadata.load",
      repositories,
      refresh: false,
    })) as { data: MetadataLoadResult };

    expect(response.data.metadata).toHaveLength(2);
    expect(response.data.sharedCachedCount).toBe(0);
  });

  it("never contacts a shared server that was not configured", async () => {
    await connect("");
    clientMocks.fetchRepositoryMetadataBatch.mockResolvedValue({
      metadata: [MASTRA, NEXT],
      missing: [],
      rateLimit: null,
    });

    await sendRequest({ type: "metadata.load", repositories, refresh: false });

    expect(sharedCacheMocks.lookupSharedMetadata).not.toHaveBeenCalled();
    expect(sharedCacheMocks.publishSharedMetadata).not.toHaveBeenCalled();
  });

  it("bypasses both caches on refresh and republishes the fresh answer", async () => {
    await connect();
    sharedCacheMocks.lookupSharedMetadata.mockResolvedValue([MASTRA, NEXT]);
    await sendRequest({ type: "metadata.load", repositories, refresh: false });

    sharedCacheMocks.lookupSharedMetadata.mockClear();
    clientMocks.fetchRepositoryMetadataBatch.mockResolvedValue({
      metadata: [MASTRA, NEXT],
      missing: [],
      rateLimit: null,
    });

    const refreshed = (await sendRequest({
      type: "metadata.load",
      repositories,
      refresh: true,
    })) as { data: MetadataLoadResult };

    expect(sharedCacheMocks.lookupSharedMetadata).not.toHaveBeenCalled();
    expect(clientMocks.fetchRepositoryMetadataBatch).toHaveBeenCalledTimes(1);
    expect(refreshed.data.cachedCount).toBe(0);
    expect(refreshed.data.sharedCachedCount).toBe(0);
    expect(sharedCacheMocks.publishSharedMetadata).toHaveBeenLastCalledWith(
      "https://cache.example.com",
      [MASTRA, NEXT],
    );
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
