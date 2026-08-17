import type {
  ExtensionRequest,
  ExtensionResponse,
  SharedCacheStatus,
} from "./messages";
import { normalizeCacheServerUrl } from "./server-cache/config";

document.title = "Awesomer Lists options";
document.body.innerHTML = `
  <style>
    :root {
      color-scheme: light dark;
      --text: #16181d;
      --muted: #5a6070;
      --faint: #7a8090;
      --border: rgba(0, 0, 0, .16);
      --input: #fff;
      --accent: #4f46e5;
      --danger: #b42318;
      --ok: #027a48;
    }
    @media (prefers-color-scheme: dark) {
      :root {
        --text: #f2f3f6;
        --muted: #a8aebd;
        --faint: #868c9c;
        --border: rgba(255, 255, 255, .18);
        --input: #16181d;
        --accent: #8b85f5;
        --danger: #f97066;
        --ok: #6ce9a6;
      }
    }
    * { box-sizing: border-box; }
    body {
      margin: 0; padding: 24px; max-width: 620px; color: var(--text);
      font: 14px/1.5 system-ui, sans-serif;
    }
    h1 { margin: 0 0 4px; font-size: 17px; }
    h2 { margin: 24px 0 4px; font-size: 14px; }
    p { margin: 0 0 12px; color: var(--muted); font-size: 12.5px; }
    form { display: grid; gap: 10px; }
    label { color: var(--muted); font-size: 12px; }
    input[type="url"] {
      width: 100%; height: 38px; padding: 0 11px; border: 1px solid var(--border);
      border-radius: 8px; background: var(--input); color: var(--text);
      font: 12.5px ui-monospace, monospace;
    }
    input[type="url"]:focus { outline: 2px solid var(--accent); outline-offset: 1px; }
    .check { display: flex; align-items: center; gap: 8px; font-size: 12.5px; }
    .check input { accent-color: var(--accent); }
    .actions { display: flex; align-items: center; gap: 10px; }
    button {
      min-height: 34px; padding: 6px 14px; border: 1px solid var(--accent);
      border-radius: 8px; background: var(--accent); color: #fff; cursor: pointer;
      font: 600 12.5px system-ui, sans-serif;
    }
    button:disabled { cursor: wait; opacity: .58; }
    .note { margin: 0; color: var(--faint); font-size: 11.5px; }
    .status { margin: 0; font-size: 12.5px; font-weight: 600; }
    .status[data-tone="error"] { color: var(--danger); }
    .status[data-tone="ok"] { color: var(--ok); }
    [hidden] { display: none !important; }
  </style>
  <h1>Awesomer Lists</h1>
  <p>Your GitHub token is set from the extension window on a GitHub page, not here.</p>

  <h2>Shared cache</h2>
  <p>
    A shared cache server keeps public repository counts for seven days, so a list
    someone already opened loads without waiting on GitHub again. Looking a list up
    tells that server which repository names you are viewing. Your token, the README,
    and everything else stay on this device.
  </p>
  <form id="cache-form">
    <label for="cache-url">Cache server URL</label>
    <input id="cache-url" name="cache-url" type="url" spellcheck="false"
      autocomplete="off" placeholder="https://cache.example.com" />
    <p class="note" id="cache-default" hidden></p>
    <label class="check"><input id="cache-enabled" type="checkbox" /><span>Use the shared cache</span></label>
    <div class="actions"><button id="cache-save" type="submit">Save</button></div>
    <p class="status" id="cache-status" role="status" hidden></p>
  </form>
`;

function requiredElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);

  if (!element) throw new Error("The options page could not start.");
  return element;
}

const form = requiredElement<HTMLFormElement>("#cache-form");
const urlInput = requiredElement<HTMLInputElement>("#cache-url");
const enabledInput = requiredElement<HTMLInputElement>("#cache-enabled");
const saveButton = requiredElement<HTMLButtonElement>("#cache-save");
const defaultNote = requiredElement<HTMLElement>("#cache-default");
const status = requiredElement<HTMLElement>("#cache-status");

async function sendRequest<T>(request: ExtensionRequest): Promise<T> {
  const response = (await chrome.runtime.sendMessage(
    request,
  )) as ExtensionResponse<T>;

  if (!response.ok) throw new Error(response.error.message);
  return response.data;
}

function report(message: string, tone: "ok" | "error"): void {
  status.textContent = message;
  status.dataset.tone = tone;
  status.hidden = false;
}

function apply(cache: SharedCacheStatus): void {
  urlInput.value = cache.serverUrl;
  enabledInput.checked = cache.enabled;
  defaultNote.hidden = cache.builtInUrl === "";
  defaultNote.textContent = cache.builtInUrl
    ? `Leave this empty to use the server this build ships with: ${cache.builtInUrl}`
    : "";
}

void sendRequest<SharedCacheStatus>({ type: "cache.status" })
  .then(apply)
  .catch(() => report("Could not read the current settings.", "error"));

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  status.hidden = true;

  let serverUrl: string;

  try {
    serverUrl = normalizeCacheServerUrl(urlInput.value);
  } catch (error) {
    report(
      error instanceof Error ? error.message : "Enter a valid URL.",
      "error",
    );
    return;
  }

  // Chrome only grants an optional host permission during the user gesture that
  // asked for it, so this runs before any await.
  const permission =
    serverUrl === ""
      ? Promise.resolve(true)
      : chrome.permissions.request({ origins: [`${new URL(serverUrl).origin}/*`] });

  saveButton.disabled = true;

  try {
    if (!(await permission)) {
      report("Chrome did not grant access to that server.", "error");
      return;
    }

    apply(
      await sendRequest<SharedCacheStatus>({
        type: "cache.save",
        serverUrl,
        enabled: enabledInput.checked,
      }),
    );
    report("Saved.", "ok");
  } catch (error) {
    report(
      error instanceof Error ? error.message : "Could not save these settings.",
      "error",
    );
  } finally {
    saveButton.disabled = false;
  }
});
