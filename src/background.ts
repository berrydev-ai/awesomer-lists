import type { RepositoryMetadata, RepositoryRef } from "./domain/types";
import { normalizeGitHubRawUrl } from "./domain/github-source";
import { normalizeRepositoryNames } from "./background-logic";
import {
  fetchRepositoryMetadataBatch,
  fetchRepositoryReadme,
  isGitHubClientError,
  validateGitHubToken,
} from "./github/client";
import type { RateLimitInfo } from "./github/graphql";
import type {
  AuthStatus,
  ExtensionRequest,
  ExtensionResponse,
  MetadataLoadResult,
} from "./messages";

const LOCAL_TOKEN_KEY = "auth.githubToken";
const SESSION_TOKEN_KEY = "auth.githubToken";
const LOGIN_KEY = "auth.githubLogin";
const CACHE_PREFIX = "metadata.";
const CACHE_TTL_MILLISECONDS = 6 * 60 * 60 * 1_000;
const BATCH_SIZE = 20;
const MAX_REPOSITORIES = 5_000;

interface CachedMetadata {
  value: RepositoryMetadata;
  expiresAt: number;
}

interface RequestMessage extends Record<string, unknown> {
  type: string;
}

type RequestType = ExtensionRequest["type"];
type RequestByType<T extends RequestType> = Extract<
  ExtensionRequest,
  { type: T }
>;
type RequestHandlers = {
  [T in RequestType]: (request: RequestByType<T>) => Promise<unknown>;
};

// Only the service worker needs direct storage access; requests wait until that boundary is active.
const storageReady = Promise.all([
  chrome.storage.local.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" }),
  chrome.storage.session.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" }),
]);

chrome.action.onClicked.addListener(async (tab) => {
  if (!tab.id) return;

  await chrome.action.setBadgeText({ tabId: tab.id, text: "" });

  try {
    await chrome.tabs.sendMessage(tab.id, { type: "awesomer.toggle" });
  } catch {
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ["content.js"],
      });
      await chrome.tabs.sendMessage(tab.id, { type: "awesomer.toggle" });
    } catch {
      await chrome.action.setBadgeText({ tabId: tab.id, text: "!" });
      await chrome.action.setBadgeBackgroundColor({
        tabId: tab.id,
        color: "#b42318",
      });
    }
  }
});

function isAllowedSender(sender: chrome.runtime.MessageSender): boolean {
  if (!sender.tab?.url) return false;

  try {
    return new URL(sender.tab.url).hostname === "github.com";
  } catch {
    return false;
  }
}

function isRequestMessage(value: unknown): value is RequestMessage {
  return (
    typeof value === "object" &&
    value !== null &&
    "type" in value &&
    typeof value.type === "string"
  );
}

async function getToken(): Promise<string | null> {
  await storageReady;
  const session = await chrome.storage.session.get(SESSION_TOKEN_KEY);

  if (typeof session[SESSION_TOKEN_KEY] === "string") {
    return session[SESSION_TOKEN_KEY];
  }

  const local = await chrome.storage.local.get(LOCAL_TOKEN_KEY);
  return typeof local[LOCAL_TOKEN_KEY] === "string"
    ? local[LOCAL_TOKEN_KEY]
    : null;
}

async function getAuthStatus(): Promise<AuthStatus> {
  await storageReady;
  const [token, local, login] = await Promise.all([
    getToken(),
    chrome.storage.local.get(LOCAL_TOKEN_KEY),
    chrome.storage.local.get(LOGIN_KEY),
  ]);

  return {
    hasToken: token !== null,
    remembered: typeof local[LOCAL_TOKEN_KEY] === "string",
    login: typeof login[LOGIN_KEY] === "string" ? login[LOGIN_KEY] : null,
  };
}

async function saveToken(token: string, remember: boolean): Promise<AuthStatus> {
  await storageReady;
  const trimmedToken = token.trim();

  if (trimmedToken.length < 20 || trimmedToken.length > 255) {
    throw new Error("Enter a valid GitHub personal access token.");
  }

  const login = await validateGitHubToken(trimmedToken);

  if (remember) {
    await chrome.storage.local.set({
      [LOCAL_TOKEN_KEY]: trimmedToken,
      [LOGIN_KEY]: login,
    });
    await chrome.storage.session.remove(SESSION_TOKEN_KEY);
  } else {
    await chrome.storage.session.set({ [SESSION_TOKEN_KEY]: trimmedToken });
    await chrome.storage.local.remove(LOCAL_TOKEN_KEY);
    await chrome.storage.local.set({ [LOGIN_KEY]: login });
  }

  return getAuthStatus();
}

async function clearToken(): Promise<AuthStatus> {
  await storageReady;
  await Promise.all([
    chrome.storage.session.remove(SESSION_TOKEN_KEY),
    chrome.storage.local.remove([LOCAL_TOKEN_KEY, LOGIN_KEY]),
  ]);
  return getAuthStatus();
}

function cacheKey(nameWithOwner: string): string {
  return `${CACHE_PREFIX}${nameWithOwner.toLowerCase()}`;
}

function isCachedMetadata(value: unknown): value is CachedMetadata {
  return (
    typeof value === "object" &&
    value !== null &&
    "expiresAt" in value &&
    typeof value.expiresAt === "number" &&
    "value" in value &&
    typeof value.value === "object" &&
    value.value !== null &&
    "nameWithOwner" in value.value &&
    typeof value.value.nameWithOwner === "string"
  );
}

async function readCachedMetadata(
  repositories: readonly RepositoryRef[],
): Promise<Map<string, RepositoryMetadata>> {
  await storageReady;
  const keys = repositories.map((repository) => cacheKey(repository.nameWithOwner));
  const stored = await chrome.storage.local.get(keys);
  const now = Date.now();
  const metadata = new Map<string, RepositoryMetadata>();

  for (const repository of repositories) {
    const cached = stored[cacheKey(repository.nameWithOwner)];

    if (isCachedMetadata(cached) && cached.expiresAt > now) {
      metadata.set(repository.nameWithOwner.toLowerCase(), cached.value);
    }
  }

  return metadata;
}

async function writeCachedMetadata(
  metadata: readonly RepositoryMetadata[],
): Promise<void> {
  await storageReady;
  const expiresAt = Date.now() + CACHE_TTL_MILLISECONDS;
  const values = Object.fromEntries(
    metadata.map((item) => [
      cacheKey(item.nameWithOwner),
      { value: item, expiresAt } satisfies CachedMetadata,
    ]),
  );

  if (metadata.length > 0) {
    await chrome.storage.local.set(values);
  }
}

async function loadMetadata(
  values: readonly string[],
  refresh: boolean,
): Promise<MetadataLoadResult> {
  const token = await getToken();

  if (!token) {
    throw Object.assign(
      new Error("Add a dedicated GitHub token to load repository data."),
      { code: "AUTH_REQUIRED" },
    );
  }

  const repositories = normalizeRepositoryNames(values, MAX_REPOSITORIES);
  const cached = refresh
    ? new Map<string, RepositoryMetadata>()
    : await readCachedMetadata(repositories);
  const toFetch = repositories.filter(
    (repository) => !cached.has(repository.nameWithOwner.toLowerCase()),
  );
  const loaded: RepositoryMetadata[] = [];
  const missing: string[] = [];
  let rateLimit: RateLimitInfo | null = null;

  for (let index = 0; index < toFetch.length; index += BATCH_SIZE) {
    const batch = toFetch.slice(index, index + BATCH_SIZE);
    const result = await fetchRepositoryMetadataBatch(batch, token);
    loaded.push(...result.metadata);
    missing.push(...result.missing);
    rateLimit = result.rateLimit ?? rateLimit;
  }

  await writeCachedMetadata(loaded);

  const byRepository = new Map<string, RepositoryMetadata>([
    ...cached.entries(),
    ...loaded.map((item) => [item.nameWithOwner.toLowerCase(), item] as const),
  ]);

  return {
    metadata: repositories.flatMap((repository) => {
      const item = byRepository.get(repository.nameWithOwner.toLowerCase());
      return item ? [item] : [];
    }),
    missing,
    rateLimit,
    cachedCount: cached.size,
  };
}

const requestHandlers = {
  "auth.status": async () => getAuthStatus(),
  "auth.clear": async () => clearToken(),
  "auth.save": async (request) => {
    if (
      typeof request.token !== "string" ||
      typeof request.remember !== "boolean"
    ) {
      throw new Error("Invalid token settings.");
    }
    return saveToken(request.token, request.remember);
  },
  "readme.load": async (request) => {
    if (
      typeof request.repository !== "string" ||
      (request.sourceUrl !== null && typeof request.sourceUrl !== "string")
    ) {
      throw new Error("Invalid repository name.");
    }

    const repository = normalizeRepositoryNames([request.repository], 1)[0];

    if (!repository) {
      throw new Error("Invalid repository name.");
    }
    const sourceUrl = request.sourceUrl
      ? normalizeGitHubRawUrl(request.sourceUrl, repository)
      : null;

    if (request.sourceUrl && !sourceUrl) {
      throw new Error("The raw source does not belong to this repository.");
    }

    const token = await getToken();
    if (!token) {
      throw Object.assign(
        new Error("Add a dedicated GitHub token to load this README."),
        { code: "AUTH_REQUIRED" },
      );
    }
    return fetchRepositoryReadme(repository, token, { sourceUrl });
  },
  "metadata.load": async (request) => {
    if (
      !Array.isArray(request.repositories) ||
      !request.repositories.every((value) => typeof value === "string") ||
      typeof request.refresh !== "boolean"
    ) {
      throw new Error("Invalid metadata request.");
    }

    return loadMetadata(request.repositories, request.refresh);
  },
} satisfies RequestHandlers;

async function handleRequest(request: RequestMessage): Promise<unknown> {
  const handler = requestHandlers[request.type as RequestType] as
    | ((request: never) => Promise<unknown>)
    | undefined;

  if (!handler) throw new Error("Unknown extension request.");
  return handler(request as never);
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!isAllowedSender(sender) || !isRequestMessage(message)) {
    return false;
  }

  handleRequest(message)
    .then((data) => {
      sendResponse({ ok: true, data } satisfies ExtensionResponse<unknown>);
    })
    .catch((error: unknown) => {
      const isClientError = isGitHubClientError(error);
      const code = isClientError
        ? error.code
        : typeof error === "object" &&
            error !== null &&
            "code" in error &&
            error.code === "AUTH_REQUIRED"
          ? "AUTH_REQUIRED"
          : "INVALID_REQUEST";
      const message =
        error instanceof Error ? error.message : "The extension could not continue.";

      sendResponse({
        ok: false,
        error: { code, message },
      } satisfies ExtensionResponse<never>);
    });

  return true;
});
