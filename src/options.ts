import type {
  ExtensionRequest,
  ExtensionResponse,
  LocalCacheStatus,
} from "./messages";

document.title = "Awesomer Lists options";
document.body.innerHTML = `
  <style>
    :root {
      color-scheme: light dark;
      --text: #16181d;
      --muted: #5a6070;
      --border: rgba(0, 0, 0, .16);
      --panel: rgba(0, 0, 0, .035);
      --danger: #b42318;
      --ok: #027a48;
    }
    @media (prefers-color-scheme: dark) {
      :root {
        --text: #f2f3f6;
        --muted: #a8aebd;
        --border: rgba(255, 255, 255, .18);
        --panel: rgba(255, 255, 255, .055);
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
    dl {
      display: grid; grid-template-columns: 1fr auto; gap: 8px 20px;
      margin: 12px 0; padding: 14px; border: 1px solid var(--border);
      border-radius: 10px; background: var(--panel);
    }
    dt { color: var(--muted); }
    dd { margin: 0; font-variant-numeric: tabular-nums; font-weight: 650; }
    button {
      min-height: 34px; padding: 6px 14px; border: 1px solid var(--danger);
      border-radius: 8px; background: transparent; color: var(--danger); cursor: pointer;
      font: 600 12.5px system-ui, sans-serif;
    }
    button:disabled { cursor: wait; opacity: .58; }
    .note { font-size: 11.5px; }
    .status { margin-top: 10px; font-size: 12.5px; font-weight: 600; }
    .status[data-tone="error"] { color: var(--danger); }
    .status[data-tone="ok"] { color: var(--ok); }
    [hidden] { display: none !important; }
  </style>
  <h1>Awesomer Lists</h1>
  <p>Your GitHub token is set from the extension window on a GitHub page.</p>

  <h2>Metadata cache</h2>
  <p>Repository metadata stays on this device. Fresh entries load immediately while older entries update in the background.</p>
  <dl aria-label="Local cache details">
    <dt>Repositories</dt><dd id="cache-entries">—</dd>
    <dt>Storage used</dt><dd id="cache-usage">—</dd>
    <dt>Fresh for</dt><dd id="cache-freshness">—</dd>
    <dt>Kept for</dt><dd id="cache-retention">—</dd>
  </dl>
  <button id="cache-clear" type="button">Clear metadata cache</button>
  <p class="note">This removes cached repository metadata only. Your GitHub token stays connected.</p>
  <p class="status" id="cache-status" role="status" hidden></p>
`;

function requiredElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error("The options page could not start.");
  return element;
}

const entries = requiredElement<HTMLElement>("#cache-entries");
const usage = requiredElement<HTMLElement>("#cache-usage");
const freshness = requiredElement<HTMLElement>("#cache-freshness");
const retention = requiredElement<HTMLElement>("#cache-retention");
const clearButton = requiredElement<HTMLButtonElement>("#cache-clear");
const status = requiredElement<HTMLElement>("#cache-status");

async function sendRequest<T>(request: ExtensionRequest): Promise<T> {
  const response = (await chrome.runtime.sendMessage(
    request,
  )) as ExtensionResponse<T>;
  if (!response.ok) throw new Error(response.error.message);
  return response.data;
}

function formatBytes(bytes: number): string {
  if (bytes < 1_024) return `${bytes} B`;
  if (bytes < 1_048_576) return `${(bytes / 1_024).toFixed(1)} KB`;
  return `${(bytes / 1_048_576).toFixed(1)} MB`;
}

function report(message: string, tone: "ok" | "error"): void {
  status.textContent = message;
  status.dataset.tone = tone;
  status.hidden = false;
}

function apply(cache: LocalCacheStatus): void {
  entries.textContent = String(cache.entries);
  usage.textContent = `${formatBytes(cache.bytes)} of ${formatBytes(cache.maxBytes)}`;
  freshness.textContent = `${cache.freshHours} ${cache.freshHours === 1 ? "hour" : "hours"}`;
  retention.textContent = `${cache.retentionDays} ${cache.retentionDays === 1 ? "day" : "days"}`;
}

void sendRequest<LocalCacheStatus>({ type: "cache.status" })
  .then(apply)
  .catch(() => report("Could not read the local cache.", "error"));

clearButton.addEventListener("click", async () => {
  clearButton.disabled = true;
  status.hidden = true;

  try {
    apply(await sendRequest<LocalCacheStatus>({ type: "cache.clear" }));
    report("Metadata cache cleared. Your GitHub token is unchanged.", "ok");
  } catch (error) {
    report(
      error instanceof Error ? error.message : "Could not clear the metadata cache.",
      "error",
    );
  } finally {
    clearButton.disabled = false;
  }
});
