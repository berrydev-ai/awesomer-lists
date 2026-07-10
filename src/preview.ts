import type {
  AuthStatus,
  ExtensionRequest,
  ExtensionResponse,
  MetadataLoadResult,
} from "./messages";
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

  const requested = new Set(
    request.repositories.map((repository) => repository.toLocaleLowerCase()),
  );
  const result: MetadataLoadResult = {
    metadata: PREVIEW_METADATA.filter((item) =>
      requested.has(item.nameWithOwner.toLocaleLowerCase()),
    ),
    missing: [],
    rateLimit: {
      remaining: 4_868,
      resetAt: "2026-07-10T14:32:33Z",
    },
    cachedCount: request.refresh ? 0 : 2,
  };
  return success(result);
}

function success<T>(data: T): ExtensionResponse<T> {
  return { ok: true, data };
}
