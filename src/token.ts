import type {
  AuthStatus,
  ExtensionRequest,
  ExtensionResponse,
} from "./messages";

const params = new URLSearchParams(location.search);
const theme = params.get("theme");
const accent = params.get("accent") ?? "indigo";
const parentOrigin = document.referrer
  ? new URL(document.referrer).origin
  : "*";

document.documentElement.dataset.theme =
  theme === "light" || theme === "dark" ? theme : "system";
document.documentElement.dataset.accent = accent;
document.body.innerHTML = `
  <style>
    @font-face { font-family: "Geist"; src: url("fonts/geist-latin-400-normal.woff2") format("woff2"); font-weight: 400; font-display: swap; }
    @font-face { font-family: "Geist"; src: url("fonts/geist-latin-600-normal.woff2") format("woff2"); font-weight: 600; font-display: swap; }
    @font-face { font-family: "Geist Mono"; src: url("fonts/geist-mono-latin-400-normal.woff2") format("woff2"); font-weight: 400; font-display: swap; }
    :root {
      color-scheme: dark;
      --accent-c: .16;
      --accent-h: 268;
      --accent: oklch(.68 var(--accent-c) var(--accent-h));
      --accent-soft: oklch(.68 var(--accent-c) var(--accent-h) / .16);
      --text: oklch(.96 .004 265);
      --muted: oklch(.72 .008 265);
      --faint: oklch(.55 .01 265);
      --border: oklch(1 0 0 / .16);
      --input: oklch(.13 .006 265);
      --danger: oklch(.72 .16 32);
    }
    :root[data-accent="blue"] { --accent-c: .15; --accent-h: 248; }
    :root[data-accent="teal"] { --accent-c: .12; --accent-h: 190; }
    :root[data-accent="green"] { --accent-c: .14; --accent-h: 150; }
    :root[data-accent="amber"] { --accent-c: .14; --accent-h: 85; }
    :root[data-accent="orange"] { --accent-c: .16; --accent-h: 55; }
    :root[data-accent="rose"] { --accent-c: .17; --accent-h: 15; }
    :root[data-theme="light"] {
      color-scheme: light;
      --accent: oklch(.55 var(--accent-c) var(--accent-h));
      --accent-soft: oklch(.55 var(--accent-c) var(--accent-h) / .12);
      --text: oklch(.24 .01 265);
      --muted: oklch(.48 .012 265);
      --faint: oklch(.60 .01 265);
      --border: oklch(0 0 0 / .14);
      --input: oklch(1 0 0);
      --danger: oklch(.53 .17 30);
    }
    @media (prefers-color-scheme: light) {
      :root[data-theme="system"] {
        color-scheme: light;
        --accent: oklch(.55 var(--accent-c) var(--accent-h));
        --accent-soft: oklch(.55 var(--accent-c) var(--accent-h) / .12);
        --text: oklch(.24 .01 265);
        --muted: oklch(.48 .012 265);
        --faint: oklch(.60 .01 265);
        --border: oklch(0 0 0 / .14);
        --input: oklch(1 0 0);
        --danger: oklch(.53 .17 30);
      }
    }
    * { box-sizing: border-box; }
    body { margin: 0; color: var(--text); font-family: "Geist", system-ui, sans-serif; }
    form { display: grid; gap: 9px; }
    label { color: var(--muted); font-size: 12px; }
    input[type="password"] {
      width: 100%; height: 38px; padding: 0 11px; border: 1px solid var(--border);
      border-radius: 8px; outline: 0; background: var(--input); color: var(--text);
      font: 12.5px "Geist Mono", ui-monospace, monospace;
    }
    input[type="password"]:focus { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-soft); }
    .check { display: flex; align-items: center; gap: 8px; color: var(--muted); font-size: 12px; }
    .check input { accent-color: var(--accent); }
    .actions { display: flex; align-items: center; gap: 10px; }
    button {
      min-height: 34px; padding: 6px 12px; border: 1px solid var(--accent); border-radius: 8px;
      background: var(--accent); color: white; cursor: pointer; font: 600 12.5px system-ui, sans-serif;
    }
    button:disabled { cursor: wait; opacity: .58; }
    .note { margin: 0; color: var(--faint); font-size: 11px; line-height: 1.45; }
    .error { margin: 0; color: var(--danger); font-size: 12px; font-weight: 600; }
    [hidden] { display: none !important; }
  </style>
  <form id="token-form">
    <label for="token-input">Personal access token</label>
    <input id="token-input" name="token" type="password" autocomplete="off" spellcheck="false" placeholder="github_pat_…" required />
    <label class="check"><input id="remember-token" type="checkbox" /><span>Remember on this device</span></label>
    <div class="actions"><button id="save-token" type="submit">Save and analyze</button></div>
    <p class="note">The token field runs on the extension’s own origin, isolated from page scripts.</p>
    <p class="error" id="token-error" role="alert" hidden></p>
  </form>
`;

const form = document.querySelector<HTMLFormElement>("#token-form");
const tokenInput = document.querySelector<HTMLInputElement>("#token-input");
const rememberToken = document.querySelector<HTMLInputElement>("#remember-token");
const saveToken = document.querySelector<HTMLButtonElement>("#save-token");
const tokenError = document.querySelector<HTMLElement>("#token-error");

if (!form || !tokenInput || !rememberToken || !saveToken || !tokenError) {
  throw new Error("Secure token form could not start.");
}

async function sendRequest<T>(request: ExtensionRequest): Promise<T> {
  const response = (await chrome.runtime.sendMessage(
    request,
  )) as ExtensionResponse<T>;

  if (!response.ok) throw new Error(response.error.message);
  return response.data;
}

void sendRequest<AuthStatus>({ type: "auth.status" }).then((auth) => {
  rememberToken.checked = auth.remembered;
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  tokenError.hidden = true;
  saveToken.disabled = true;

  try {
    const auth = await sendRequest<AuthStatus>({
      type: "auth.save",
      token: tokenInput.value,
      remember: rememberToken.checked,
    });
    tokenInput.value = "";
    window.parent.postMessage(
      { type: "awesomer.auth.saved", auth },
      parentOrigin,
    );
  } catch (error) {
    tokenError.textContent =
      error instanceof Error ? error.message : "Could not save this token.";
    tokenError.hidden = false;
  } finally {
    saveToken.disabled = false;
  }
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    window.parent.postMessage(
      { type: "awesomer.auth.key", key: "Escape" },
      parentOrigin,
    );
    return;
  }

  if (event.key !== "Tab") return;
  const focusable = [tokenInput, rememberToken, saveToken];
  const atBackwardBoundary = event.shiftKey && document.activeElement === focusable[0];
  const atForwardBoundary =
    !event.shiftKey && document.activeElement === focusable.at(-1);

  if (!atBackwardBoundary && !atForwardBoundary) return;
  event.preventDefault();
  window.parent.postMessage(
    {
      type: "awesomer.auth.key",
      key: "Tab",
      direction: atBackwardBoundary ? "backward" : "forward",
    },
    parentOrigin,
  );
});

tokenInput.focus();
