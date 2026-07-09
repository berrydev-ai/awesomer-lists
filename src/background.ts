import type { RepositoryMetadata, RepositoryRef } from "./domain/types";
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
const MAX_REPOSITORIES = 1_000;
const REPOSITORY_PATTERN = /^[a-z0-9_.-]+\/[a-z0-9_.-]+$/i;

interface CachedMetadata {
  value: RepositoryMetadata;
  expiresAt: number;
}

// Only the service worker needs direct storage access; the page-facing script uses narrow messages.
void chrome.storage.local.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" });
void chrome.storage.session.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" });

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

function isExtensionRequest(value: unknown): value is ExtensionRequest {
  if (typeof value !== "object" || value === null || !("type" in value)) {
    return false;
  }

  return [
    "auth.status",
    "auth.save",
    "auth.clear",
    "readme.load",
    "metadata.load",
  ].includes(String(value.type));
}

function parseRepository(nwo: string): RepositoryRef {
  if (!REPOSITORY_PATTERN.test(nwo)) {
    throw new Error("Invalid repository name.");
  }

  const [owner = "", name = ""] = nwo.split("/");

  return {
    owner,
    name,
    nwo: `${owner}/${name}`,
    url: `https://github.com/${owner}/${name}`,
  };
}

async function getToken(): Promise<string | null> {
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
  await Promise.all([
    chrome.storage.session.remove(SESSION_TOKEN_KEY),
    chrome.storage.local.remove([LOCAL_TOKEN_KEY, LOGIN_KEY]),
  ]);
  return getAuthStatus();
}

function cacheKey(nwo: string): string {
  return `${CACHE_PREFIX}${nwo.toLowerCase()}`;
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
    "nwo" in value.value &&
    typeof value.value.nwo === "string"
  );
}

async function readCachedMetadata(
  repositories: readonly RepositoryRef[],
): Promise<Map<string, RepositoryMetadata>> {
  const keys = repositories.map((repository) => cacheKey(repository.nwo));
  const stored = await chrome.storage.local.get(keys);
  const now = Date.now();
  const metadata = new Map<string, RepositoryMetadata>();

  for (const repository of repositories) {
    const cached = stored[cacheKey(repository.nwo)];

    if (isCachedMetadata(cached) && cached.expiresAt > now) {
      metadata.set(repository.nwo.toLowerCase(), cached.value);
    }
  }

  return metadata;
}

async function writeCachedMetadata(
  metadata: readonly RepositoryMetadata[],
): Promise<void> {
  const expiresAt = Date.now() + CACHE_TTL_MILLISECONDS;
  const values = Object.fromEntries(
    metadata.map((item) => [
      cacheKey(item.nwo),
      { value: item, expiresAt } satisfies CachedMetadata,
    ]),
  );

  if (metadata.length > 0) {
    await chrome.storage.local.set(values);
  }
}

function uniqueRepositories(values: readonly string[]): RepositoryRef[] {
  if (values.length > MAX_REPOSITORIES) {
    throw new Error(`Awesome lists are limited to ${MAX_REPOSITORIES} projects.`);
  }

  const seen = new Set<string>();
  const repositories: RepositoryRef[] = [];

  for (const value of values) {
    const repository = parseRepository(value);
    const key = repository.nwo.toLowerCase();

    if (!seen.has(key)) {
      seen.add(key);
      repositories.push(repository);
    }
  }

  return repositories;
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

  const repositories = uniqueRepositories(values);
  const cached = refresh
    ? new Map<string, RepositoryMetadata>()
    : await readCachedMetadata(repositories);
  const toFetch = repositories.filter(
    (repository) => !cached.has(repository.nwo.toLowerCase()),
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
    ...loaded.map((item) => [item.nwo.toLowerCase(), item] as const),
  ]);

  return {
    metadata: repositories.flatMap((repository) => {
      const item = byRepository.get(repository.nwo.toLowerCase());
      return item ? [item] : [];
    }),
    missing,
    rateLimit,
    cachedCount: cached.size,
  };
}

async function handleRequest(request: ExtensionRequest): Promise<unknown> {
  if (request.type === "auth.status") return getAuthStatus();
  if (request.type === "auth.clear") return clearToken();

  if (request.type === "auth.save") {
    if (typeof request.token !== "string" || typeof request.remember !== "boolean") {
      throw new Error("Invalid token settings.");
    }
    return saveToken(request.token, request.remember);
  }

  if (request.type === "readme.load") {
    if (typeof request.repository !== "string") {
      throw new Error("Invalid repository name.");
    }

    const token = await getToken();
    if (!token) {
      throw Object.assign(
        new Error("Add a dedicated GitHub token to load this README."),
        { code: "AUTH_REQUIRED" },
      );
    }
    return fetchRepositoryReadme(parseRepository(request.repository), token);
  }

  if (
    !Array.isArray(request.repositories) ||
    !request.repositories.every((value) => typeof value === "string") ||
    typeof request.refresh !== "boolean"
  ) {
    throw new Error("Invalid metadata request.");
  }

  return loadMetadata(request.repositories, request.refresh);
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!isAllowedSender(sender) || !isExtensionRequest(message)) {
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
