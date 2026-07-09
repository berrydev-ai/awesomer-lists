import { parseGitHubRepositoryPage } from "./domain/github-page";
import { normalizeGitHubRawUrl } from "./domain/github-source";
import { getMaintenanceStatus } from "./domain/maintenance";
import { parseAwesomeList } from "./domain/awesome-list";
import { buildTableGroups } from "./domain/table-model";
import type {
  AwesomeEntry,
  RepositoryMetadata,
  RepositoryRef,
  SortDirection,
  SortField,
  TableOptions,
} from "./domain/types";
import type {
  AuthStatus,
  ExtensionRequest,
  ExtensionResponse,
  MetadataLoadResult,
} from "./messages";
import { formatRepositoryCount } from "./ui/format";

const ROOT_ID = "awesomer-lists-extension-root";

interface RequestFailure extends Error {
  code: string;
}

interface ModalState {
  auth: AuthStatus | null;
  entries: AwesomeEntry[];
  metadata: RepositoryMetadata[];
  missing: string[];
  cachedCount: number;
  rateLimit: MetadataLoadResult["rateLimit"];
  hasLoaded: boolean;
  options: TableOptions;
  collapsedGroups: Set<string>;
}

const STYLES = `
  :host {
    all: initial;
    color-scheme: light;
    --aw-ink: #172327;
    --aw-muted: #5f6f72;
    --aw-line: #d8dfdd;
    --aw-soft: #f3f5f0;
    --aw-paper: #fffef9;
    --aw-brand: #123f3b;
    --aw-brand-strong: #0a2f2c;
    --aw-accent: #e7a53b;
    --aw-danger: #b42318;
    --aw-success: #16794b;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    font-size: 16px;
    line-height: 1.45;
  }

  *, *::before, *::after { box-sizing: border-box; }
  button, input, select { font: inherit; }
  button { cursor: pointer; }
  [hidden] { display: none !important; }

  .backdrop {
    position: fixed;
    inset: 0;
    z-index: 2147483647;
    display: grid;
    place-items: center;
    padding: 24px;
    background: rgba(5, 19, 18, 0.72);
    backdrop-filter: blur(4px);
  }

  .dialog {
    width: min(1480px, 96vw);
    height: min(920px, 94vh);
    display: grid;
    grid-template-rows: auto minmax(0, 1fr);
    overflow: hidden;
    border: 1px solid rgba(255, 255, 255, 0.18);
    border-radius: 18px;
    background: var(--aw-paper);
    color: var(--aw-ink);
    box-shadow: 0 30px 100px rgba(0, 0, 0, 0.42);
  }

  .header {
    display: flex;
    align-items: center;
    gap: 16px;
    min-height: 76px;
    padding: 14px 18px 14px 22px;
    background: var(--aw-brand);
    color: white;
  }

  .brand-mark {
    display: grid;
    width: 42px;
    height: 42px;
    flex: 0 0 auto;
    place-items: center;
    border-radius: 12px;
    background: var(--aw-accent);
    color: var(--aw-brand-strong);
    font-size: 24px;
    font-weight: 900;
  }

  .title-block { min-width: 0; }
  .title {
    margin: 0;
    font-size: 20px;
    font-weight: 760;
    letter-spacing: -0.02em;
  }

  .source-link {
    display: block;
    max-width: 520px;
    overflow: hidden;
    color: rgba(255, 255, 255, 0.72);
    font-size: 13px;
    text-decoration: none;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .source-link:hover { color: white; text-decoration: underline; }

  .header-actions {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-left: auto;
  }

  .header-button, .close-button {
    min-height: 38px;
    border: 1px solid rgba(255, 255, 255, 0.2);
    border-radius: 9px;
    background: rgba(255, 255, 255, 0.08);
    color: white;
  }
  .header-button { padding: 7px 12px; font-size: 13px; font-weight: 650; }
  .close-button { width: 38px; font-size: 22px; line-height: 1; }
  .header-button:hover, .close-button:hover { background: rgba(255, 255, 255, 0.16); }

  .body { min-height: 0; overflow: hidden; }
  .center-view {
    height: 100%;
    display: grid;
    place-items: center;
    overflow: auto;
    padding: 42px 24px;
    background:
      radial-gradient(circle at 15% 20%, rgba(231, 165, 59, 0.12), transparent 28%),
      var(--aw-soft);
  }

  .panel {
    width: min(620px, 100%);
    padding: 30px;
    border: 1px solid var(--aw-line);
    border-radius: 16px;
    background: var(--aw-paper);
    box-shadow: 0 12px 32px rgba(23, 35, 39, 0.08);
  }
  .panel h2 { margin: 0 0 8px; font-size: 24px; letter-spacing: -0.025em; }
  .panel p { margin: 0 0 18px; color: var(--aw-muted); }
  .panel ol { margin: 0 0 22px; padding-left: 22px; }
  .panel li { margin: 8px 0; }
  .panel a { color: #086c64; font-weight: 650; }

  .field-label {
    display: block;
    margin: 0 0 7px;
    font-size: 13px;
    font-weight: 750;
  }
  .token-input, .search-input, .select-input {
    border: 1px solid #aebbb8;
    border-radius: 9px;
    background: white;
    color: var(--aw-ink);
    outline: none;
  }
  .token-input { width: 100%; min-height: 44px; padding: 9px 12px; }
  .token-input:focus, .search-input:focus, .select-input:focus {
    border-color: #167d73;
    box-shadow: 0 0 0 3px rgba(22, 125, 115, 0.14);
  }

  .check-row {
    display: flex;
    align-items: flex-start;
    gap: 9px;
    margin: 12px 0 4px;
    font-size: 14px;
  }
  .check-row input { margin-top: 3px; accent-color: var(--aw-brand); }
  .storage-warning { margin: 0 0 18px !important; font-size: 12px; }

  .button-row { display: flex; flex-wrap: wrap; align-items: center; gap: 9px; }
  .primary-button, .secondary-button, .danger-button {
    min-height: 40px;
    padding: 8px 14px;
    border-radius: 9px;
    font-weight: 700;
  }
  .primary-button { border: 1px solid var(--aw-brand); background: var(--aw-brand); color: white; }
  .primary-button:hover { background: var(--aw-brand-strong); }
  .secondary-button { border: 1px solid #aebbb8; background: white; color: var(--aw-ink); }
  .secondary-button:hover { background: var(--aw-soft); }
  .danger-button { border: 1px solid #efc2bc; background: #fff5f4; color: var(--aw-danger); }
  button:disabled { cursor: wait; opacity: 0.58; }

  .inline-error {
    margin: 12px 0 0 !important;
    padding: 10px 12px;
    border-radius: 8px;
    background: #fff0ee;
    color: var(--aw-danger) !important;
    font-size: 13px;
    font-weight: 650;
  }

  .loader {
    width: 44px;
    height: 44px;
    margin: 0 auto 16px;
    border: 4px solid #d6dfdc;
    border-top-color: var(--aw-brand);
    border-radius: 50%;
    animation: aw-spin 0.8s linear infinite;
  }
  @keyframes aw-spin { to { transform: rotate(360deg); } }
  .loading-copy { text-align: center; }
  .loading-copy h2 { margin: 0 0 6px; font-size: 20px; }
  .loading-copy p { margin: 0; color: var(--aw-muted); }

  .main-view {
    height: 100%;
    display: grid;
    grid-template-rows: auto minmax(0, 1fr) auto;
    background: var(--aw-paper);
  }

  .toolbar {
    display: grid;
    grid-template-columns: minmax(260px, 1fr) auto auto auto;
    align-items: end;
    gap: 12px;
    padding: 14px 18px;
    border-bottom: 1px solid var(--aw-line);
    background: var(--aw-soft);
  }
  .toolbar-field { min-width: 0; }
  .toolbar-label {
    display: block;
    margin-bottom: 5px;
    color: var(--aw-muted);
    font-size: 11px;
    font-weight: 800;
    letter-spacing: 0.05em;
    text-transform: uppercase;
  }
  .search-input, .select-input { width: 100%; min-height: 38px; padding: 7px 10px; }
  .toolbar-check { align-self: center; margin: 17px 0 0; white-space: nowrap; }
  .refresh-button { min-height: 38px; }

  .table-wrap { min-height: 0; overflow: auto; background: white; }
  .table { width: 100%; border-collapse: separate; border-spacing: 0; font-size: 13px; }
  .table thead { position: sticky; top: 0; z-index: 3; }
  .table thead th {
    height: 42px;
    padding: 0 12px;
    border-bottom: 1px solid #c6d0cd;
    background: #e9eeea;
    color: #42504f;
    font-size: 11px;
    font-weight: 800;
    letter-spacing: 0.045em;
    text-align: left;
    text-transform: uppercase;
    white-space: nowrap;
  }
  .table thead th:first-child { padding-left: 18px; }
  .sort-button {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 5px 0;
    border: 0;
    background: transparent;
    color: inherit;
    font: inherit;
    font-weight: inherit;
    letter-spacing: inherit;
    text-transform: inherit;
  }
  .sort-button:hover { color: var(--aw-brand); }
  .sort-indicator { min-width: 10px; color: #177d73; }

  .group-row th {
    position: sticky;
    top: 42px;
    z-index: 2;
    padding: 0 !important;
    border-bottom: 1px solid #cbd6d2;
    background: #dfe8e3;
  }
  .group-button {
    width: 100%;
    min-height: 38px;
    display: flex;
    align-items: center;
    gap: 9px;
    padding: 8px 18px;
    border: 0;
    background: transparent;
    color: #1b4641;
    text-align: left;
  }
  .group-button:hover { background: #d5e0db; }
  .group-chevron { width: 12px; font-size: 12px; }
  .group-title { font-size: 13px; font-weight: 800; }
  .group-count { color: #60716e; font-size: 12px; font-weight: 600; }

  .project-row td {
    padding: 12px;
    border-bottom: 1px solid #edf0ee;
    vertical-align: top;
  }
  .project-row td:first-child { padding-left: 18px; }
  .project-row:hover td { background: #fffaf0; }
  .project-cell { min-width: 280px; max-width: 660px; }
  .project-link { color: #075e57; font-size: 14px; font-weight: 780; text-decoration: none; }
  .project-link:hover { text-decoration: underline; }
  .repository-name { margin-left: 7px; color: #7a8785; font-size: 11px; white-space: nowrap; }
  .description { display: -webkit-box; margin-top: 4px; overflow: hidden; color: #52615f; line-height: 1.4; -webkit-box-orient: vertical; -webkit-line-clamp: 2; }
  .number { font-variant-numeric: tabular-nums; font-weight: 720; white-space: nowrap; }
  .sub-number { display: block; margin-top: 3px; color: #788481; font-size: 11px; font-weight: 500; }
  .date { white-space: nowrap; }
  .date time { font-weight: 680; }
  .date small { display: block; margin-top: 3px; color: #788481; }
  .license { white-space: nowrap; }
  .empty-value { color: #98a3a1; }

  .status-pill {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 4px 8px;
    border-radius: 999px;
    font-size: 11px;
    font-weight: 800;
    white-space: nowrap;
  }
  .status-pill::before { width: 7px; height: 7px; border-radius: 50%; content: ""; }
  .status-active { background: #e8f7ef; color: #116a42; }
  .status-active::before { background: #1b995e; }
  .status-quiet { background: #fff4d8; color: #835d0b; }
  .status-quiet::before { background: #d59a22; }
  .status-stale, .status-archived { background: #fbe9e6; color: #9d2c22; }
  .status-stale::before, .status-archived::before { background: #cf4437; }
  .status-unknown { background: #ecefee; color: #64706e; }
  .status-unknown::before { background: #8e9997; }

  .footer {
    min-height: 42px;
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 10px 18px;
    padding: 9px 18px;
    border-top: 1px solid var(--aw-line);
    background: var(--aw-soft);
    color: var(--aw-muted);
    font-size: 12px;
  }
  .footer strong { color: var(--aw-ink); }
  .footer-warning { color: #9a4d11; font-weight: 650; }

  @media (max-width: 900px) {
    .backdrop { padding: 8px; }
    .dialog { width: 100%; height: 98vh; border-radius: 12px; }
    .toolbar { grid-template-columns: 1fr 1fr; }
    .header-button span { display: none; }
    .table th:nth-child(6), .table td:nth-child(6) { display: none; }
  }

  @media (prefers-reduced-motion: reduce) {
    .loader { animation-duration: 1.8s; }
  }
`;

chrome.runtime.onMessage.addListener((message: unknown) => {
  if (
    typeof message !== "object" ||
    message === null ||
    !("type" in message) ||
    message.type !== "awesomer.toggle"
  ) {
    return;
  }

  const existing = document.getElementById(ROOT_ID);

  if (existing) {
    existing.remove();
    return;
  }

  void openModal();
});

async function sendRequest<T>(request: ExtensionRequest): Promise<T> {
  const response = (await chrome.runtime.sendMessage(
    request,
  )) as ExtensionResponse<T>;

  if (!response.ok) {
    throw Object.assign(new Error(response.error.message), {
      code: response.error.code,
    }) as RequestFailure;
  }

  return response.data;
}

function requiredElement<T extends Element>(
  root: ParentNode,
  selector: string,
): T {
  const element = root.querySelector<T>(selector);
  if (!element) throw new Error(`Missing extension element: ${selector}`);
  return element;
}

function createRepositoryRef(owner: string, name: string): RepositoryRef {
  return {
    owner,
    name,
    nameWithOwner: `${owner}/${name}`,
    url: `https://github.com/${owner}/${name}`,
  };
}

function findCurrentRawSource(
  repository: NonNullable<ReturnType<typeof parseGitHubRepositoryPage>>,
): string | null {
  if (!location.pathname.includes("/blob/")) return null;

  const selectors = [
    'a[data-testid="raw-button"]',
    'a[data-hotkey="r"]',
    'a[aria-label*="raw" i][href]',
  ];

  for (const selector of selectors) {
    const candidate = document.querySelector<HTMLAnchorElement>(selector)?.href;
    const sourceUrl = candidate
      ? normalizeGitHubRawUrl(candidate, repository)
      : null;

    if (sourceUrl) return sourceUrl;
  }

  return null;
}

function formatCalendarDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(new Date(value));
}

function formatRelativeDate(value: string, now: Date): string {
  const days = Math.max(
    0,
    Math.floor((now.getTime() - new Date(value).getTime()) / 86_400_000),
  );

  if (days === 0) return "Today";
  if (days < 30) return `${days}d ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}

function statusLabel(status: ReturnType<typeof getMaintenanceStatus>): string {
  return {
    active: "Active",
    quiet: "Quiet",
    stale: "Stale",
    archived: "Archived",
    unknown: "Unknown",
  }[status];
}

function appendEmptyValue(cell: HTMLTableCellElement): void {
  const empty = document.createElement("span");
  empty.className = "empty-value";
  empty.textContent = "—";
  cell.append(empty);
}

async function openModal(): Promise<void> {
  const page = parseGitHubRepositoryPage(location.href);
  const currentRawSource = page ? findCurrentRawSource(page) : null;
  const host = document.createElement("div");
  host.id = ROOT_ID;
  document.documentElement.append(host);
  const shadow = host.attachShadow({ mode: "open" });

  shadow.innerHTML = `
    <style>${STYLES}</style>
    <div class="backdrop" id="backdrop">
      <section class="dialog" role="dialog" aria-modal="true" aria-labelledby="awesomer-title">
        <header class="header">
          <div class="brand-mark" aria-hidden="true">✦</div>
          <div class="title-block">
            <h1 class="title" id="awesomer-title">Awesomer Lists</h1>
            <a class="source-link" id="source-link" target="_blank" rel="noreferrer"></a>
          </div>
          <div class="header-actions">
            <button class="header-button" id="auth-button" type="button" title="GitHub token settings">GitHub <span>access</span></button>
            <button class="close-button" id="close-button" type="button" aria-label="Close">×</button>
          </div>
        </header>
        <div class="body">
          <div class="center-view" id="unsupported-view" hidden>
            <div class="panel">
              <h2>Open a GitHub repository</h2>
              <p>This page does not look like a repository. Open an Awesome list repository, then click the extension again.</p>
              <button class="primary-button" id="unsupported-close" type="button">Close</button>
            </div>
          </div>

          <div class="center-view" id="auth-view" hidden>
            <form class="panel" id="auth-form">
              <h2>Connect a dedicated GitHub token</h2>
              <p>Awesomer Lists uses read-only access to batch exact repository metadata.</p>
              <ol>
                <li><a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noreferrer">Create a fine-grained personal access token</a>.</li>
                <li>Set an expiration date. Public repositories are readable by default.</li>
                <li>Set <strong>Issues</strong> to <strong>Read-only</strong>. Leave every write permission off.</li>
              </ol>
              <label class="field-label" for="token-input">Personal access token</label>
              <input class="token-input" id="token-input" name="token" type="password" autocomplete="off" spellcheck="false" placeholder="github_pat_…" required>
              <label class="check-row">
                <input id="remember-token" type="checkbox">
                <span>Remember on this device</span>
              </label>
              <p class="storage-warning">Off by default. Remembered tokens use Chrome extension storage, which is local but is not a password vault.</p>
              <div class="button-row">
                <button class="primary-button" id="save-token" type="submit">Save and analyze</button>
                <button class="secondary-button" id="cancel-auth" type="button" hidden>Cancel</button>
                <button class="danger-button" id="remove-token" type="button" hidden>Remove token</button>
              </div>
              <p class="inline-error" id="auth-error" role="alert" hidden></p>
            </form>
          </div>

          <div class="center-view" id="loading-view" hidden>
            <div class="loading-copy" role="status">
              <div class="loader" aria-hidden="true"></div>
              <h2 id="loading-title">Reading the Awesome list…</h2>
              <p id="loading-detail">Fetching raw Markdown from GitHub.</p>
            </div>
          </div>

          <div class="center-view" id="error-view" hidden>
            <div class="panel">
              <h2>Could not analyze this list</h2>
              <p id="error-message"></p>
              <div class="button-row">
                <button class="primary-button" id="retry-button" type="button">Try again</button>
                <button class="secondary-button" id="error-token-button" type="button">GitHub access</button>
              </div>
            </div>
          </div>

          <div class="main-view" id="main-view" hidden>
            <div class="toolbar">
              <label class="toolbar-field">
                <span class="toolbar-label">Find a project</span>
                <input class="search-input" id="search-input" type="search" placeholder="Search name, description, repository, or section">
              </label>
              <label class="toolbar-field">
                <span class="toolbar-label">Last commit</span>
                <select class="select-input" id="freshness-select">
                  <option value="">Any time</option>
                  <option value="90">Past 90 days</option>
                  <option value="365">Past year</option>
                  <option value="730">Past 2 years</option>
                </select>
              </label>
              <label class="check-row toolbar-check">
                <input id="hide-archived" type="checkbox" checked>
                <span>Hide archived</span>
              </label>
              <button class="secondary-button refresh-button" id="refresh-button" type="button">Refresh data</button>
            </div>
            <div class="table-wrap" id="table-wrap">
              <table class="table">
                <thead>
                  <tr>
                    <th><button class="sort-button" type="button" data-sort="name">Project <span class="sort-indicator"></span></button></th>
                    <th>Maintenance</th>
                    <th><button class="sort-button" type="button" data-sort="stars">Popularity <span class="sort-indicator"></span></button></th>
                    <th><button class="sort-button" type="button" data-sort="lastCommitAt">Last commit <span class="sort-indicator"></span></button></th>
                    <th><button class="sort-button" type="button" data-sort="openIssues">Open issues <span class="sort-indicator"></span></button></th>
                    <th>License</th>
                  </tr>
                </thead>
                <tbody id="table-body"></tbody>
              </table>
            </div>
            <footer class="footer" id="footer"></footer>
          </div>
        </div>
      </section>
    </div>
  `;

  const state: ModalState = {
    auth: null,
    entries: [],
    metadata: [],
    missing: [],
    cachedCount: 0,
    rateLimit: null,
    hasLoaded: false,
    options: {
      query: "",
      hideArchived: true,
      updatedWithinDays: null,
      sort: { field: "stars", direction: "desc" },
      now: new Date(),
    },
    collapsedGroups: new Set(),
  };

  const views = [
    "unsupported-view",
    "auth-view",
    "loading-view",
    "error-view",
    "main-view",
  ].map((id) => requiredElement<HTMLElement>(shadow, `#${id}`));
  const sourceLink = requiredElement<HTMLAnchorElement>(shadow, "#source-link");
  const tokenInput = requiredElement<HTMLInputElement>(shadow, "#token-input");
  const rememberToken = requiredElement<HTMLInputElement>(
    shadow,
    "#remember-token",
  );
  const authError = requiredElement<HTMLElement>(shadow, "#auth-error");
  const cancelAuth = requiredElement<HTMLButtonElement>(shadow, "#cancel-auth");
  const removeToken = requiredElement<HTMLButtonElement>(shadow, "#remove-token");
  const saveToken = requiredElement<HTMLButtonElement>(shadow, "#save-token");
  const loadingTitle = requiredElement<HTMLElement>(shadow, "#loading-title");
  const loadingDetail = requiredElement<HTMLElement>(shadow, "#loading-detail");
  const errorMessage = requiredElement<HTMLElement>(shadow, "#error-message");
  const searchInput = requiredElement<HTMLInputElement>(shadow, "#search-input");
  const freshnessSelect = requiredElement<HTMLSelectElement>(
    shadow,
    "#freshness-select",
  );
  const hideArchived = requiredElement<HTMLInputElement>(
    shadow,
    "#hide-archived",
  );
  const tableBody = requiredElement<HTMLTableSectionElement>(
    shadow,
    "#table-body",
  );
  const footer = requiredElement<HTMLElement>(shadow, "#footer");

  const close = (): void => host.remove();
  const showView = (id: string): void => {
    views.forEach((view) => {
      view.hidden = view.id !== id;
    });
  };

  const showAuth = (message = ""): void => {
    showView("auth-view");
    authError.hidden = !message;
    authError.textContent = message;
    rememberToken.checked = state.auth?.remembered ?? false;
    cancelAuth.hidden = !state.hasLoaded;
    removeToken.hidden = !(state.auth?.hasToken ?? false);
    tokenInput.value = "";
    queueMicrotask(() => tokenInput.focus());
  };

  const renderTable = (): void => {
    state.options.now = new Date();
    const groups = buildTableGroups(
      state.entries,
      state.metadata,
      state.options,
    );
    tableBody.replaceChildren();

    for (const group of groups) {
      const groupRow = document.createElement("tr");
      groupRow.className = "group-row";
      const groupCell = document.createElement("th");
      groupCell.colSpan = 6;
      const groupButton = document.createElement("button");
      groupButton.className = "group-button";
      groupButton.type = "button";
      const isCollapsed = state.collapsedGroups.has(group.key);
      groupButton.setAttribute("aria-expanded", String(!isCollapsed));

      const chevron = document.createElement("span");
      chevron.className = "group-chevron";
      chevron.textContent = isCollapsed ? "▶" : "▼";
      const label = document.createElement("span");
      label.className = "group-title";
      label.textContent = group.label;
      const count = document.createElement("span");
      count.className = "group-count";
      count.textContent = `${group.rows.length} ${group.rows.length === 1 ? "project" : "projects"}`;
      groupButton.append(chevron, label, count);
      groupButton.addEventListener("click", () => {
        if (state.collapsedGroups.has(group.key)) {
          state.collapsedGroups.delete(group.key);
        } else {
          state.collapsedGroups.add(group.key);
        }
        renderTable();
      });
      groupCell.append(groupButton);
      groupRow.append(groupCell);
      tableBody.append(groupRow);

      if (isCollapsed) continue;

      for (const row of group.rows) {
        const projectRow = document.createElement("tr");
        projectRow.className = "project-row";

        const projectCell = document.createElement("td");
        projectCell.className = "project-cell";
        const projectLink = document.createElement("a");
        projectLink.className = "project-link";
        projectLink.href = row.repository.url;
        projectLink.target = "_blank";
        projectLink.rel = "noreferrer";
        projectLink.textContent = row.title;
        const repositoryName = document.createElement("span");
        repositoryName.className = "repository-name";
        repositoryName.textContent = row.repository.nameWithOwner;
        const description = document.createElement("span");
        description.className = "description";
        description.textContent =
          row.description || row.metadata?.description || "No description provided.";
        projectCell.append(projectLink, repositoryName, description);

        const maintenanceCell = document.createElement("td");
        const status = getMaintenanceStatus(
          row.metadata?.lastCommitAt ?? null,
          row.metadata?.isArchived ?? false,
          state.options.now,
        );
        const pill = document.createElement("span");
        pill.className = `status-pill status-${status}`;
        pill.textContent = statusLabel(status);
        maintenanceCell.append(pill);

        const popularityCell = document.createElement("td");
        popularityCell.className = "number";
        if (row.metadata) {
          popularityCell.textContent = `★ ${formatRepositoryCount(row.metadata.stars)}`;
          const forks = document.createElement("span");
          forks.className = "sub-number";
          forks.textContent = `${formatRepositoryCount(row.metadata.forks)} forks`;
          popularityCell.append(forks);
        } else {
          appendEmptyValue(popularityCell);
        }

        const commitCell = document.createElement("td");
        commitCell.className = "date";
        if (row.metadata?.lastCommitAt) {
          const time = document.createElement("time");
          time.dateTime = row.metadata.lastCommitAt;
          time.textContent = formatRelativeDate(
            row.metadata.lastCommitAt,
            state.options.now,
          );
          const exactDate = document.createElement("small");
          exactDate.textContent = formatCalendarDate(row.metadata.lastCommitAt);
          commitCell.append(time, exactDate);
        } else {
          appendEmptyValue(commitCell);
        }

        const issuesCell = document.createElement("td");
        issuesCell.className = "number";
        if (row.metadata) {
          issuesCell.textContent = formatRepositoryCount(row.metadata.openIssues);
        } else {
          appendEmptyValue(issuesCell);
        }

        const licenseCell = document.createElement("td");
        licenseCell.className = "license";
        if (row.metadata?.license) {
          licenseCell.textContent = row.metadata.license;
        } else {
          appendEmptyValue(licenseCell);
        }

        projectRow.append(
          projectCell,
          maintenanceCell,
          popularityCell,
          commitCell,
          issuesCell,
          licenseCell,
        );
        tableBody.append(projectRow);
      }
    }

    const visibleCount = groups.reduce(
      (total, group) => total + group.rows.length,
      0,
    );
    footer.replaceChildren();

    const resultSummary = document.createElement("span");
    const resultStrong = document.createElement("strong");
    resultStrong.textContent = String(visibleCount);
    resultSummary.append(resultStrong, ` of ${state.entries.length} projects`);
    footer.append(resultSummary);

    if (state.auth?.login) {
      const account = document.createElement("span");
      account.textContent = `GitHub: ${state.auth.login}`;
      footer.append(account);
    }

    const cache = document.createElement("span");
    cache.textContent = `${state.cachedCount} from cache`;
    footer.append(cache);

    if (state.rateLimit) {
      const rate = document.createElement("span");
      rate.textContent = `${formatRepositoryCount(state.rateLimit.remaining)} API points left`;
      rate.title = `Resets ${formatCalendarDate(state.rateLimit.resetAt)}`;
      footer.append(rate);
    }

    if (state.missing.length > 0) {
      const missing = document.createElement("span");
      missing.className = "footer-warning";
      missing.textContent = `${state.missing.length} unavailable ${state.missing.length === 1 ? "repository" : "repositories"}`;
      footer.append(missing);
    }

    shadow.querySelectorAll<HTMLButtonElement>("[data-sort]").forEach((button) => {
      const indicator = requiredElement<HTMLElement>(button, ".sort-indicator");
      const field = button.dataset.sort as SortField;
      indicator.textContent =
        state.options.sort.field === field
          ? state.options.sort.direction === "asc"
            ? "↑"
            : "↓"
          : "";
      button.parentElement?.setAttribute(
        "aria-sort",
        state.options.sort.field === field
          ? state.options.sort.direction === "asc"
            ? "ascending"
            : "descending"
          : "none",
      );
    });
  };

  const showMain = (): void => {
    state.hasLoaded = true;
    showView("main-view");
    renderTable();
  };

  const loadData = async (refresh: boolean): Promise<void> => {
    if (!page) return;

    showView("loading-view");
    loadingTitle.textContent = "Reading the Awesome list…";
    loadingDetail.textContent = "Fetching raw Markdown from GitHub.";

    try {
      const repository = createRepositoryRef(page.owner, page.name);

      if (location.pathname.includes("/blob/") && !currentRawSource) {
        throw new Error(
          "GitHub did not expose the raw source for this file. Open the repository README and try again.",
        );
      }

      const markdown = await sendRequest<string>({
        type: "readme.load",
        repository: repository.nameWithOwner,
        sourceUrl: currentRawSource,
      });
      state.entries = parseAwesomeList(markdown);

      if (state.entries.length === 0) {
        throw new Error(
          "The README does not contain Awesome-style bullet items linked to GitHub repositories.",
        );
      }

      loadingTitle.textContent = `Loading ${state.entries.length} projects…`;
      loadingDetail.textContent =
        "Batching exact stars, commits, issues, licenses, and archived state.";
      const result = await sendRequest<MetadataLoadResult>({
        type: "metadata.load",
        repositories: state.entries.map((entry) => entry.repository.nameWithOwner),
        refresh,
      });
      state.metadata = result.metadata;
      state.missing = result.missing;
      state.cachedCount = result.cachedCount;
      state.rateLimit = result.rateLimit;
      showMain();
    } catch (error) {
      const failure = error as Partial<RequestFailure>;

      if (failure.code === "AUTH_REQUIRED" || failure.code === "INVALID_TOKEN") {
        state.auth = await sendRequest<AuthStatus>({ type: "auth.status" });
        showAuth(error instanceof Error ? error.message : "Add a GitHub token.");
        return;
      }

      errorMessage.textContent =
        error instanceof Error ? error.message : "The extension could not continue.";
      showView("error-view");
    }
  };

  requiredElement<HTMLButtonElement>(shadow, "#close-button").addEventListener(
    "click",
    close,
  );
  requiredElement<HTMLButtonElement>(shadow, "#unsupported-close").addEventListener(
    "click",
    close,
  );
  requiredElement<HTMLElement>(shadow, "#backdrop").addEventListener(
    "click",
    (event) => {
      if (event.target === event.currentTarget) close();
    },
  );
  requiredElement<HTMLButtonElement>(shadow, "#auth-button").addEventListener(
    "click",
    () => showAuth(),
  );
  requiredElement<HTMLButtonElement>(shadow, "#error-token-button").addEventListener(
    "click",
    () => showAuth(),
  );
  requiredElement<HTMLButtonElement>(shadow, "#retry-button").addEventListener(
    "click",
    () => void loadData(false),
  );
  requiredElement<HTMLButtonElement>(shadow, "#refresh-button").addEventListener(
    "click",
    () => void loadData(true),
  );

  requiredElement<HTMLFormElement>(shadow, "#auth-form").addEventListener(
    "submit",
    async (event) => {
      event.preventDefault();
      authError.hidden = true;
      saveToken.disabled = true;

      try {
        state.auth = await sendRequest<AuthStatus>({
          type: "auth.save",
          token: tokenInput.value,
          remember: rememberToken.checked,
        });
        tokenInput.value = "";
        await loadData(false);
      } catch (error) {
        authError.textContent =
          error instanceof Error ? error.message : "Could not save this token.";
        authError.hidden = false;
      } finally {
        saveToken.disabled = false;
      }
    },
  );

  cancelAuth.addEventListener("click", showMain);
  removeToken.addEventListener("click", async () => {
    state.auth = await sendRequest<AuthStatus>({ type: "auth.clear" });
    showAuth("The GitHub token was removed.");
  });

  searchInput.addEventListener("input", () => {
    state.options.query = searchInput.value;
    renderTable();
  });
  freshnessSelect.addEventListener("change", () => {
    state.options.updatedWithinDays = freshnessSelect.value
      ? Number(freshnessSelect.value)
      : null;
    renderTable();
  });
  hideArchived.addEventListener("change", () => {
    state.options.hideArchived = hideArchived.checked;
    renderTable();
  });
  shadow.querySelectorAll<HTMLButtonElement>("[data-sort]").forEach((button) => {
    button.addEventListener("click", () => {
      const field = button.dataset.sort as SortField;
      const isCurrent = state.options.sort.field === field;
      const defaultDirection: SortDirection =
        field === "name" || field === "openIssues" ? "asc" : "desc";
      state.options.sort = {
        field,
        direction: isCurrent
          ? state.options.sort.direction === "asc"
            ? "desc"
            : "asc"
          : defaultDirection,
      };
      renderTable();
    });
  });

  const handleKeydown = (event: Event): void => {
    if (event instanceof KeyboardEvent && event.key === "Escape") close();
  };
  shadow.addEventListener("keydown", handleKeydown);

  if (!page) {
    sourceLink.textContent = "Not a repository page";
    sourceLink.removeAttribute("href");
    showView("unsupported-view");
    return;
  }

  sourceLink.textContent = `${page.owner}/${page.name} · ${currentRawSource ? "current file source" : "README source"}`;
  sourceLink.href =
    currentRawSource ?? `https://github.com/${page.owner}/${page.name}#readme`;
  state.auth = await sendRequest<AuthStatus>({ type: "auth.status" });

  if (!state.auth.hasToken) {
    showAuth();
  } else {
    await loadData(false);
  }
}
