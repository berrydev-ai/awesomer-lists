import { normalizeGitHubRawUrl } from "./domain/github-source";
import { normalizeRepositoryNames } from "./background-logic";
import {
  fetchRepositoryReadme,
  isGitHubClientError,
  validateGitHubToken,
} from "./github/client";
import { createMetadataService } from "./cache/service";
import { createTokenVault } from "./token-store";
import { mayRequest, senderRole } from "./sender";
import { METADATA_PORT_NAME } from "./messages";
import type {
  ExtensionRequest,
  ExtensionResponse,
  MetadataLoadResult,
} from "./messages";

const MAX_REPOSITORIES = 5_000;
const TOOLBAR_ACK = "awesomer.ready";
const vault = createTokenVault(chrome.storage.local, chrome.storage.session);
const metadata = createMetadataService({ storage: chrome.storage.local });
let authGeneration = 0;
const toolbarActions = new Map<number, Promise<void>>();

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

async function sendToolbarMessage(
  tabId: number,
  type: "awesomer.ping" | "awesomer.toggle",
): Promise<boolean> {
  try {
    const response = await chrome.tabs.sendMessage(
      tabId,
      { type },
      { frameId: 0 },
    );
    return response === TOOLBAR_ACK;
  } catch {
    return false;
  }
}

async function runToolbarAction(tabId: number): Promise<void> {
  await chrome.action.setBadgeText({ tabId, text: "" });

  try {
    if (!(await sendToolbarMessage(tabId, "awesomer.ping"))) {
      await chrome.scripting.executeScript({
        target: { tabId, frameIds: [0] },
        files: ["content.js"],
      });
    }

    if (!(await sendToolbarMessage(tabId, "awesomer.toggle"))) {
      throw new Error("The content script did not acknowledge the toolbar action.");
    }
  } catch {
    await chrome.action.setBadgeText({ tabId, text: "!" });
    await chrome.action.setBadgeBackgroundColor({ tabId, color: "#b42318" });
  }
}

chrome.action.onClicked.addListener(async (tab) => {
  if (!tab.id || !tab.url?.startsWith("https://github.com/")) return;

  const tabId = tab.id;
  const previous = toolbarActions.get(tabId) ?? Promise.resolve();
  const current = previous.then(() => runToolbarAction(tabId));
  toolbarActions.set(tabId, current);
  await current.finally(() => {
    if (toolbarActions.get(tabId) === current) {
      toolbarActions.delete(tabId);
    }
  });
});

function isRequestMessage(value: unknown): value is RequestMessage {
  return (
    typeof value === "object" &&
    value !== null &&
    "type" in value &&
    typeof value.type === "string"
  );
}

function repositoriesFrom(request: Record<string, unknown>) {
  if (
    !Array.isArray(request.repositories) ||
    !request.repositories.every((value) => typeof value === "string") ||
    typeof request.refresh !== "boolean"
  ) throw new Error("Invalid metadata request.");
  return normalizeRepositoryNames(request.repositories, MAX_REPOSITORIES);
}

async function loadMetadata(
  request: Record<string, unknown>,
  onProgress: (result: MetadataLoadResult) => void = () => undefined,
  isCancelled: () => boolean = () => false,
): Promise<MetadataLoadResult> {
  const repositories = repositoriesFrom(request);
  const generation = authGeneration;
  return metadata.load({
    repositories,
    refresh: request.refresh === true,
    token: await vault.token(),
    onProgress,
    isCancelled: () => isCancelled() || generation !== authGeneration,
  });
}

const requestHandlers = {
  "auth.status": async () => vault.status(),
  "auth.clear": async () => {
    authGeneration += 1;
    return vault.clear();
  },
  "auth.save": async (request) => {
    if (
      typeof request.token !== "string" ||
      typeof request.remember !== "boolean"
    ) {
      throw new Error("Invalid token settings.");
    }
    const token = request.token.trim();
    if (token.length < 20 || token.length > 255) {
      throw new Error("Enter a valid GitHub personal access token.");
    }
    const generation = ++authGeneration;
    const login = await validateGitHubToken(token);
    if (generation !== authGeneration) throw new Error("Token setup was cancelled. Try again.");
    return vault.save({ token, login }, request.remember);
  },
  "cache.status": async () => metadata.status(),
  "cache.clear": async () => metadata.clear(),
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

    const token = await vault.token();
    if (!token) {
      throw Object.assign(
        new Error("Add a dedicated GitHub token to load this README."),
        { code: "AUTH_REQUIRED" },
      );
    }
    return fetchRepositoryReadme(repository, token, { sourceUrl });
  },
  "metadata.load": async (request) => loadMetadata(request),
} satisfies RequestHandlers;

async function handleRequest(request: RequestMessage): Promise<unknown> {
  const handler = requestHandlers[request.type as RequestType] as
    | ((request: never) => Promise<unknown>)
    | undefined;

  if (!handler) throw new Error("Unknown extension request.");
  return handler(request as never);
}

function failure(error: unknown): ExtensionResponse<never> {
  const code = isGitHubClientError(error) ? error.code : "INVALID_REQUEST";
  return {
    ok: false,
    error: { code, message: error instanceof Error ? error.message : "The extension could not continue." },
  };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const role = senderRole(sender, chrome.runtime.getURL("/"), chrome.runtime.id);
  if (!role || !isRequestMessage(message) || !mayRequest(role, message.type as RequestType)) {
    return false;
  }
  handleRequest(message)
    .then((data) => sendResponse({ ok: true, data } satisfies ExtensionResponse<unknown>))
    .catch((error: unknown) => sendResponse(failure(error)));
  return true;
});

chrome.runtime.onConnect.addListener((port) => {
  const role = port.sender && senderRole(port.sender, chrome.runtime.getURL("/"), chrome.runtime.id);
  if (port.name !== METADATA_PORT_NAME || role !== "content") {
    port.disconnect();
    return;
  }
  let disconnected = false;
  let started = false;
  port.onDisconnect.addListener(() => { disconnected = true; });
  const post = (response: ExtensionResponse<MetadataLoadResult>): void => {
    if (disconnected) return;
    try { port.postMessage(response); } catch { disconnected = true; }
  };
  port.onMessage.addListener((message: unknown) => {
    if (started || disconnected) return;
    started = true;
    if (!isRequestMessage(message) || message.type !== "metadata.load") {
      post(failure(new Error("Invalid metadata request.")));
      return;
    }
    void loadMetadata(message, (data) => post({ ok: true, data }), () => disconnected)
      .catch((error: unknown) => post(failure(error)));
  });
});
