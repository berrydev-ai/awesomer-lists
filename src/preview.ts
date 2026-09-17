import type {
  AuthStatus,
  ExtensionRequest,
  ExtensionResponse,
  LocalCacheStatus,
  MetadataLoadResult,
} from "./messages";
import { METADATA_PORT_NAME } from "./messages";
import type { PreviewConfig } from "./preview-config";
import {
  PREVIEW_MARKDOWN,
  PREVIEW_METADATA,
  PREVIEW_README_SOURCE_URL,
  PREVIEW_SNAPSHOT_CAPTURED_AT,
} from "./preview-snapshot";

type ContentListener = (message: unknown) => void;

let listener: ContentListener | null = null;
let connected = true;
const openPreviewButton = getOpenPreviewButton();

(
  globalThis as typeof globalThis & {
    __AWESOMER_PREVIEW__?: PreviewConfig;
  }
).__AWESOMER_PREVIEW__ = {
  pageUrl: PREVIEW_README_SOURCE_URL,
  sourceLabel:
    "awesome-agent-orchestrators · GitHub snapshot · Jul 10, 2026",
  referenceNow: PREVIEW_SNAPSHOT_CAPTURED_AT,
};

window.addEventListener("message", (event) => {
  if (event.origin !== location.origin) return;
  const data = event.data as {
    type?: unknown;
    auth?: { hasToken?: unknown };
  };
  if (data?.type === "awesomer.auth.saved" && data.auth?.hasToken === true) {
    connected = true;
  }
});

globalThis.chrome = {
  runtime: {
    onMessage: {
      addListener: (nextListener: ContentListener) => {
        listener = nextListener;
      },
    },
    sendMessage: async (request: ExtensionRequest) =>
      handlePreviewRequest(request),
    connect: (connectInfo?: { name?: string }) => {
      if (connectInfo?.name !== METADATA_PORT_NAME) {
        throw new Error("The UI preview received an unknown port.");
      }
      return createMetadataPort();
    },
    getURL: (path: string) =>
      new URL(
        path === "token.html" ? "token.html?preview=1" : path,
        location.href,
      ).href,
  },
} as unknown as typeof chrome;

void import("./content").then(() => {
  if (!listener) throw new Error("The UI preview could not start.");
  listener({ type: "awesomer.toggle" });
  openPreviewButton.addEventListener("click", () =>
    listener?.({ type: "awesomer.toggle" }),
  );
});

function getOpenPreviewButton(): HTMLButtonElement {
  const existing = document.querySelector<HTMLButtonElement>(
    "#open-preview-button",
  );
  if (existing) return existing;

  const button = document.createElement("button");
  button.id = "open-preview-button";
  button.type = "button";
  button.textContent = "Open UI preview";
  document.body.append(button);
  return button;
}

async function handlePreviewRequest(
  request: ExtensionRequest,
): Promise<ExtensionResponse<unknown>> {
  if (request.type === "auth.status") {
    return success<AuthStatus>({
      hasToken: connected,
      remembered: false,
      login: connected ? "UI preview" : null,
    });
  }

  if (request.type === "auth.save") {
    connected = true;
    return success<AuthStatus>({
      hasToken: true,
      remembered: request.remember,
      login: "UI preview",
    });
  }

  if (request.type === "auth.clear") {
    connected = false;
    return success<AuthStatus>({
      hasToken: false,
      remembered: false,
      login: null,
    });
  }

  if (request.type === "readme.load") return success(PREVIEW_MARKDOWN);

  if (request.type === "cache.status" || request.type === "cache.clear") {
    return success<LocalCacheStatus>({
      entries: request.type === "cache.clear" ? 0 : PREVIEW_METADATA.length,
      bytes: request.type === "cache.clear" ? 0 : 18_432,
      maxBytes: 5_242_880,
      freshHours: 6,
      retentionDays: 30,
    });
  }

  return {
    ok: false,
    error: {
      code: "INVALID_REQUEST",
      message: "Metadata uses the preview stream.",
    },
  };
}

function createMetadataPort(): chrome.runtime.Port {
  const messageListeners = new Set<
    (message: ExtensionResponse<MetadataLoadResult>, port: chrome.runtime.Port) =>
      void
  >();
  const disconnectListeners = new Set<(port: chrome.runtime.Port) => void>();
  let disconnected = false;
  let timers: number[] = [];

  const port = {
    name: METADATA_PORT_NAME,
    onMessage: {
      addListener: (listener: (message: ExtensionResponse<MetadataLoadResult>, port: chrome.runtime.Port) => void) => {
        messageListeners.add(listener);
      },
      removeListener: (listener: (message: ExtensionResponse<MetadataLoadResult>, port: chrome.runtime.Port) => void) => {
        messageListeners.delete(listener);
      },
      hasListener: (listener: (message: ExtensionResponse<MetadataLoadResult>, port: chrome.runtime.Port) => void) =>
        messageListeners.has(listener),
      hasListeners: () => messageListeners.size > 0,
      addRules: () => undefined,
      getRules: () => undefined,
      removeRules: () => undefined,
    },
    onDisconnect: {
      addListener: (listener: (port: chrome.runtime.Port) => void) => {
        disconnectListeners.add(listener);
      },
      removeListener: (listener: (port: chrome.runtime.Port) => void) => {
        disconnectListeners.delete(listener);
      },
      hasListener: (listener: (port: chrome.runtime.Port) => void) =>
        disconnectListeners.has(listener),
      hasListeners: () => disconnectListeners.size > 0,
      addRules: () => undefined,
      getRules: () => undefined,
      removeRules: () => undefined,
    },
    postMessage: (value: unknown) => {
      const request = value as Partial<Extract<ExtensionRequest, { type: "metadata.load" }>>;
      if (
        request.type !== "metadata.load" ||
        !Array.isArray(request.repositories) ||
        typeof request.refresh !== "boolean"
      ) {
        return;
      }

      const requested = new Set(
        request.repositories.map((repository) => repository.toLocaleLowerCase()),
      );
      const allMetadata = PREVIEW_METADATA.filter((item) =>
        requested.has(item.nameWithOwner.toLocaleLowerCase()),
      );
      const cached = request.refresh ? [] : allMetadata.slice(0, 2);
      const batches = request.refresh
        ? [allMetadata.slice(0, 4), allMetadata.slice(4)]
        : [allMetadata.slice(2, 6), allMetadata.slice(6)];
      let loaded = [...cached];

      emit({
        metadata: cached,
        missing: [],
        rateLimit: null,
        cachedCount: cached.length,
        staleCount: cached.length > 0 ? 1 : 0,
        pendingCount: allMetadata.length - cached.length,
        complete: false,
        warning:
          cached.length > 0
            ? "Showing one older cached result while GitHub updates it."
            : null,
      });

      batches.forEach((batch, index) => {
        const timer = setTimeout(() => {
          loaded = [...loaded, ...batch];
          const complete = index === batches.length - 1;
          emit({
            metadata: loaded,
            missing: [],
            rateLimit: {
              remaining: 4_868 - index * 20,
              resetAt: "2026-07-10T14:32:33Z",
            },
            cachedCount: cached.length,
            staleCount: complete ? 0 : cached.length > 0 ? 1 : 0,
            pendingCount: complete ? 0 : batches[index + 1]?.length ?? 0,
            complete,
            warning: null,
          });
        }, 12 * (index + 1));
        timers.push(timer);
      });
    },
    disconnect: () => {
      if (disconnected) return;
      disconnected = true;
      timers.forEach((timer) => clearTimeout(timer));
      timers = [];
    },
  } as unknown as chrome.runtime.Port;

  const emit = (result: MetadataLoadResult): void => {
    if (disconnected) return;
    const response = success(result);
    messageListeners.forEach((listener) => listener(response, port));
  };

  return port;
}

function success<T>(data: T): ExtensionResponse<T> {
  return { ok: true, data };
}
