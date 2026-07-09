import { parseGitHubRepositoryPage } from "./domain/github-page";
import { normalizeGitHubRawUrl } from "./domain/github-source";
import {
  getMaintenanceStatus,
  type MaintenanceStatus,
} from "./domain/maintenance";
import { parseAwesomeList } from "./domain/awesome-list";
import { buildTableFacets, buildTableGroups } from "./domain/table-model";
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
  settingsOpen: boolean;
  openFilter: "maintenance" | "license" | null;
  themeMode: "system" | "light" | "dark";
  accent: "indigo" | "blue" | "teal" | "green" | "amber" | "orange" | "rose";
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

const REDESIGN_STYLES = `
  :host {
    color-scheme: dark light;
    font-family: "Geist", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  }

  .backdrop {
    padding: 16px;
    background: rgb(3 5 11 / 72%);
    backdrop-filter: blur(5px);
  }

  .dialog {
    --accent-l: 0.68;
    --accent-c: 0.16;
    --accent-h: 268;
    --bg: oklch(0.15 0.006 265);
    --panel: oklch(0.175 0.007 265);
    --panel-2: oklch(0.215 0.008 265);
    --row-hover: oklch(0.205 0.008 265);
    --border: oklch(1 0 0 / 0.08);
    --border-strong: oklch(1 0 0 / 0.16);
    --text: oklch(0.96 0.004 265);
    --text-muted: oklch(0.72 0.008 265);
    --text-faint: oklch(0.55 0.01 265);
    --header-bg: oklch(0.13 0.006 265);
    --header-fg: oklch(0.96 0.004 265);
    --header-muted: oklch(0.60 0.01 265);
    --btn-bg: oklch(1 0 0 / 0.05);
    --input-bg: oklch(0.13 0.006 265);
    --star: oklch(0.80 0.10 92);
    --ok: oklch(0.78 0.15 155);
    --ok-bg: oklch(0.78 0.15 155 / 0.14);
    --warn: oklch(0.82 0.13 88);
    --warn-bg: oklch(0.82 0.13 88 / 0.14);
    --bad: oklch(0.72 0.16 32);
    --bad-bg: oklch(0.72 0.16 32 / 0.14);
    --mute: oklch(0.62 0.01 265);
    --mute-bg: oklch(1 0 0 / 0.06);
    --accent: oklch(var(--accent-l) var(--accent-c) var(--accent-h));
    --accent-soft: oklch(var(--accent-l) var(--accent-c) var(--accent-h) / 0.16);
    --link: oklch(0.79 calc(var(--accent-c) * 0.82) var(--accent-h));
    --cols: minmax(250px, 1fr) 116px 124px 128px 104px 118px;
    position: relative;
    width: min(980px, calc(100vw - 32px));
    height: min(688px, calc(100vh - 32px));
    display: flex;
    flex-direction: column;
    overflow: hidden;
    border: 1px solid var(--border);
    border-radius: 14px;
    background: var(--bg);
    color: var(--text);
    box-shadow: 0 30px 70px -25px rgb(0 0 0 / 55%);
    font-family: "Geist", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    -webkit-font-smoothing: antialiased;
  }

  .dialog[data-accent="blue"] { --accent-c: 0.15; --accent-h: 248; }
  .dialog[data-accent="teal"] { --accent-c: 0.12; --accent-h: 190; }
  .dialog[data-accent="green"] { --accent-c: 0.14; --accent-h: 150; }
  .dialog[data-accent="amber"] { --accent-c: 0.14; --accent-h: 85; }
  .dialog[data-accent="orange"] { --accent-c: 0.16; --accent-h: 55; }
  .dialog[data-accent="rose"] { --accent-c: 0.17; --accent-h: 15; }

  .dialog[data-theme="light"] {
    --accent-l: 0.55;
    --bg: oklch(0.98 0.003 265);
    --panel: oklch(1 0 0);
    --panel-2: oklch(0.965 0.004 265);
    --row-hover: oklch(0.975 0.004 265);
    --border: oklch(0 0 0 / 0.08);
    --border-strong: oklch(0 0 0 / 0.14);
    --text: oklch(0.24 0.01 265);
    --text-muted: oklch(0.48 0.012 265);
    --text-faint: oklch(0.60 0.01 265);
    --header-bg: oklch(0.99 0.003 265);
    --header-fg: oklch(0.24 0.01 265);
    --header-muted: oklch(0.55 0.01 265);
    --btn-bg: oklch(0 0 0 / 0.05);
    --input-bg: oklch(1 0 0);
    --star: oklch(0.60 0.12 88);
    --ok: oklch(0.48 0.14 155);
    --ok-bg: oklch(0.48 0.14 155 / 0.12);
    --warn: oklch(0.56 0.12 72);
    --warn-bg: oklch(0.56 0.12 72 / 0.14);
    --bad: oklch(0.53 0.17 30);
    --bad-bg: oklch(0.53 0.17 30 / 0.12);
    --mute: oklch(0.50 0.01 265);
    --mute-bg: oklch(0 0 0 / 0.05);
    --accent-soft: oklch(var(--accent-l) var(--accent-c) var(--accent-h) / 0.12);
    --link: oklch(0.52 var(--accent-c) var(--accent-h));
  }

  @media (prefers-color-scheme: light) {
    .dialog[data-theme="system"] {
      --accent-l: 0.55;
      --bg: oklch(0.98 0.003 265);
      --panel: oklch(1 0 0);
      --panel-2: oklch(0.965 0.004 265);
      --row-hover: oklch(0.975 0.004 265);
      --border: oklch(0 0 0 / 0.08);
      --border-strong: oklch(0 0 0 / 0.14);
      --text: oklch(0.24 0.01 265);
      --text-muted: oklch(0.48 0.012 265);
      --text-faint: oklch(0.60 0.01 265);
      --header-bg: oklch(0.99 0.003 265);
      --header-fg: oklch(0.24 0.01 265);
      --header-muted: oklch(0.55 0.01 265);
      --btn-bg: oklch(0 0 0 / 0.05);
      --input-bg: oklch(1 0 0);
      --accent-soft: oklch(var(--accent-l) var(--accent-c) var(--accent-h) / 0.12);
      --link: oklch(0.52 var(--accent-c) var(--accent-h));
    }
  }

  .header {
    min-height: 70px;
    gap: 14px;
    padding: 15px 20px;
    border-bottom: 1px solid var(--border);
    background: var(--header-bg);
    color: var(--header-fg);
  }
  .brand-mark {
    width: 40px;
    height: 40px;
    border-radius: 11px;
    background: var(--accent);
    color: oklch(0.15 0.006 265);
    font-size: 21px;
    box-shadow: 0 3px 10px rgb(0 0 0 / 28%);
  }
  .title { font-size: 17px; font-weight: 700; }
  .source-link {
    max-width: 620px;
    color: var(--header-muted);
    font-family: "Geist Mono", ui-monospace, SFMono-Regular, monospace;
    font-size: 12px;
  }
  .icon-button {
    width: 34px;
    height: 34px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    border: 1px solid var(--border-strong);
    border-radius: 9px;
    background: var(--btn-bg);
    color: var(--header-fg);
  }
  .icon-button:hover { background: var(--row-hover); }

  .settings-scrim { position: absolute; inset: 0; z-index: 20; }
  .settings-panel {
    position: absolute;
    top: 56px;
    right: 16px;
    z-index: 21;
    width: 322px;
    overflow: hidden;
    border: 1px solid var(--border-strong);
    border-radius: 13px;
    background: var(--panel);
    box-shadow: 0 24px 60px -18px rgb(0 0 0 / 60%);
  }
  .settings-heading,
  .settings-section { border-bottom: 1px solid var(--border); }
  .settings-heading {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px 15px;
    font-size: 13.5px;
    font-weight: 600;
  }
  .settings-section { padding: 14px 15px; }
  .settings-section:last-child { border-bottom: 0; }
  .eyebrow,
  .toolbar-label {
    color: var(--text-faint);
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.09em;
    text-transform: uppercase;
  }
  .connection-row { display: flex; align-items: center; gap: 9px; margin: 10px 0; }
  .connection-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--ok); }
  .connection-copy { min-width: 0; flex: 1; font-size: 13px; }
  .compact-button {
    min-height: 28px;
    padding: 4px 10px;
    border: 1px solid var(--border-strong);
    border-radius: 7px;
    background: transparent;
    color: var(--text-muted);
    font-size: 12px;
    font-weight: 500;
  }
  .compact-button:hover { color: var(--text); background: var(--row-hover); }
  .settings-form { display: grid; gap: 7px; }
  .settings-form label { color: var(--text-muted); font-size: 12px; }
  .settings-note { margin: 0; color: var(--text-faint); font-size: 11px; line-height: 1.45; }
  .settings-actions { display: flex; align-items: center; gap: 8px; }
  .appearance-control { display: grid; gap: 7px; margin-top: 12px; }
  .appearance-control > span { color: var(--text-muted); font-size: 12px; }
  .theme-segment {
    display: flex;
    gap: 3px;
    padding: 3px;
    border: 1px solid var(--border);
    border-radius: 9px;
    background: var(--input-bg);
  }
  .theme-button {
    flex: 1;
    padding: 6px 0;
    border: 0;
    border-radius: 7px;
    background: transparent;
    color: var(--text-muted);
    font-size: 12.5px;
  }
  .theme-button[aria-pressed="true"] { background: var(--accent); color: white; }
  .swatches { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
  .swatch {
    width: 20px;
    height: 20px;
    padding: 0;
    border: 2px solid var(--panel);
    border-radius: 50%;
    box-shadow: 0 0 0 1px var(--border-strong);
  }
  .swatch[aria-pressed="true"] { box-shadow: 0 0 0 2px var(--accent); }
  .swatch[data-accent="indigo"] { background: oklch(0.66 0.16 268); }
  .swatch[data-accent="blue"] { background: oklch(0.66 0.15 248); }
  .swatch[data-accent="teal"] { background: oklch(0.66 0.12 190); }
  .swatch[data-accent="green"] { background: oklch(0.66 0.14 150); }
  .swatch[data-accent="amber"] { background: oklch(0.66 0.14 85); }
  .swatch[data-accent="orange"] { background: oklch(0.66 0.16 55); }
  .swatch[data-accent="rose"] { background: oklch(0.66 0.17 15); }

  .body { min-height: 0; flex: 1; }
  .center-view { background: var(--bg); color: var(--text); }
  .panel {
    border-color: var(--border-strong);
    background: var(--panel);
    color: var(--text);
    box-shadow: 0 12px 32px rgb(0 0 0 / 18%);
  }
  .panel p { color: var(--text-muted); }
  .panel a, .project-link { color: var(--link); }
  .token-input, .search-input, .select-input {
    border-color: var(--border-strong);
    background: var(--input-bg);
    color: var(--text);
  }
  .token-input:focus, .search-input:focus, .select-input:focus {
    border-color: var(--accent);
    box-shadow: 0 0 0 3px var(--accent-soft);
  }
  .primary-button { border-color: var(--accent); background: var(--accent); color: white; }
  .primary-button:hover { filter: brightness(0.95); }
  .secondary-button { border-color: var(--border-strong); background: var(--btn-bg); color: var(--text); }

  .main-view { display: flex; flex-direction: column; background: var(--panel); }
  .toolbar {
    display: flex;
    flex-direction: column;
    align-items: stretch;
    gap: 13px;
    padding: 14px 20px 13px;
    border-bottom: 1px solid var(--border);
    background: var(--panel);
  }
  .toolbar-primary { display: flex; align-items: flex-end; gap: 14px; }
  .search-field { flex: 1; min-width: 0; }
  .toolbar-field { display: flex; flex-direction: column; gap: 6px; }
  .search-shell, .select-shell { position: relative; }
  .search-icon {
    position: absolute;
    left: 11px;
    top: 50%;
    display: flex;
    color: var(--text-faint);
    transform: translateY(-50%);
    pointer-events: none;
  }
  .search-input { height: 38px; padding: 0 12px 0 34px; font-size: 13.5px; }
  .select-input { height: 38px; min-width: 138px; padding: 0 12px; font-size: 13px; }
  .toolbar-check { height: 38px; margin: 0; align-items: center; color: var(--text-muted); }
  .toolbar-check input { accent-color: var(--accent); }
  .refresh-button { height: 38px; min-height: 38px; padding: 0 14px; white-space: nowrap; }
  .maintenance-bar { display: flex; align-items: center; gap: 9px; flex-wrap: wrap; }
  .maintenance-chip, .toggle-groups {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 5px 10px;
    border: 1px solid var(--border-strong);
    border-radius: 8px;
    background: transparent;
    color: var(--text-muted);
    font-size: 12px;
    font-weight: 500;
  }
  .maintenance-chip[aria-pressed="true"] { border-color: var(--accent); background: var(--accent-soft); color: var(--accent); }
  .chip-dot { width: 6px; height: 6px; border-radius: 50%; }
  .chip-dot::before { display: none; }
  .chip-dot.status-active { background: var(--ok); }
  .chip-dot.status-quiet { background: var(--warn); }
  .chip-dot.status-stale { background: var(--bad); }
  .chip-dot.status-archived { background: var(--mute); }
  .chip-count { opacity: 0.75; font-family: "Geist Mono", ui-monospace, monospace; font-size: 11px; }
  .toggle-groups { margin-left: auto; }

  .table-wrap { flex: 1; min-height: 0; overflow: auto; background: var(--panel); }
  .table-content { min-width: 960px; }
  .grid-row { display: grid; grid-template-columns: var(--cols); gap: 16px; padding-inline: 20px; }
  .table-header {
    position: sticky;
    top: 0;
    z-index: 3;
    border-bottom: 1px solid var(--border);
    background: var(--panel-2);
  }
  .header-cell { position: relative; display: flex; align-items: center; min-width: 0; }
  .sort-button {
    padding: 11px 0;
    color: var(--text-faint);
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.07em;
  }
  .sort-button:hover, .sort-button.is-active { color: var(--accent); }
  .filter-button {
    width: 20px;
    height: 20px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    border: 0;
    border-radius: 5px;
    background: transparent;
    color: var(--text-faint);
  }
  .filter-button.is-active { background: var(--accent-soft); color: var(--accent); }
  .filter-panel {
    position: absolute;
    top: calc(100% + 4px);
    left: 0;
    z-index: 30;
    width: 208px;
    display: flex;
    flex-direction: column;
    gap: 1px;
    padding: 6px;
    border: 1px solid var(--border-strong);
    border-radius: 12px;
    background: var(--panel);
    box-shadow: 0 18px 44px -14px rgb(0 0 0 / 55%);
  }
  .header-cell:last-child .filter-panel { right: 0; left: auto; }
  .filter-heading { display: flex; align-items: center; justify-content: space-between; padding: 5px 8px 8px; border-bottom: 1px solid var(--border); }
  .filter-option {
    display: flex;
    align-items: center;
    gap: 9px;
    padding: 7px 9px;
    border: 0;
    border-radius: 8px;
    background: transparent;
    color: var(--text);
    text-align: left;
  }
  .filter-option:hover, .filter-option[aria-checked="true"] { background: var(--accent-soft); }
  .filter-box {
    width: 16px;
    height: 16px;
    display: grid;
    flex: 0 0 auto;
    place-items: center;
    border: 1px solid var(--border-strong);
    border-radius: 5px;
  }
  .filter-option[aria-checked="true"] .filter-box { border-color: var(--accent); background: var(--accent); color: white; }
  .filter-name { flex: 1; overflow: hidden; font-family: "Geist Mono", ui-monospace, monospace; font-size: 12px; text-overflow: ellipsis; white-space: nowrap; }
  .filter-count { padding: 1px 6px; border: 1px solid var(--border); border-radius: 6px; background: var(--input-bg); color: var(--text-faint); font-family: "Geist Mono", ui-monospace, monospace; font-size: 11px; }

  .group-row {
    position: sticky;
    top: 37px;
    z-index: 2;
    width: 100%;
    min-height: 36px;
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 9px 20px;
    border: 0;
    border-bottom: 1px solid var(--border);
    border-radius: 0;
    background: var(--panel-2);
    color: var(--text);
    text-align: left;
  }
  .group-row:hover { background: var(--row-hover); }
  .group-chevron { width: 10px; color: var(--text-muted); font-size: 9px; }
  .group-title { font-size: 13px; font-weight: 600; }
  .group-count { color: var(--text-faint); font-family: "Geist Mono", ui-monospace, monospace; font-size: 11px; }
  .project-row {
    min-height: 61px;
    align-items: center;
    padding-block: 11px;
    border-bottom: 1px solid var(--border);
  }
  .project-row:hover { background: var(--row-hover); }
  .project-cell { min-width: 0; }
  .project-line { display: flex; align-items: baseline; gap: 8px; min-width: 0; }
  .project-link { flex: 0 0 auto; font-size: 13.5px; font-weight: 600; }
  .repository-name { overflow: hidden; color: var(--text-faint); font-family: "Geist Mono", ui-monospace, monospace; font-size: 11px; text-overflow: ellipsis; white-space: nowrap; }
  .description { display: block; margin-top: 3px; overflow: hidden; color: var(--text-muted); font-size: 12.5px; line-height: 1.35; text-overflow: ellipsis; white-space: nowrap; }
  .status-pill { padding: 3px 10px 3px 8px; font-size: 11.5px; font-weight: 500; }
  .status-active { background: var(--ok-bg); color: var(--ok); }
  .status-active::before { background: var(--ok); }
  .status-quiet { background: var(--warn-bg); color: var(--warn); }
  .status-quiet::before { background: var(--warn); }
  .status-stale { background: var(--bad-bg); color: var(--bad); }
  .status-stale::before { background: var(--bad); }
  .status-archived, .status-unknown { background: var(--mute-bg); color: var(--mute); }
  .status-archived::before, .status-unknown::before { background: var(--mute); }
  .number, .date, .license { color: var(--text); font-family: "Geist Mono", ui-monospace, monospace; font-size: 13px; font-weight: 600; }
  .star { color: var(--star); }
  .sub-number, .date small { color: var(--text-faint); font-family: "Geist Mono", ui-monospace, monospace; font-size: 11px; font-weight: 400; }
  .license { overflow: hidden; color: var(--text-muted); font-size: 11.5px; font-weight: 400; text-overflow: ellipsis; white-space: nowrap; }
  .empty-row { padding: 34px 20px; color: var(--text-muted); text-align: center; }

  .footer {
    min-height: 43px;
    gap: 18px;
    padding: 10px 20px;
    border-color: var(--border);
    background: var(--panel-2);
    color: var(--text-muted);
    font-family: "Geist Mono", ui-monospace, monospace;
    font-size: 12px;
  }
  .footer strong { color: var(--text); }
  .project-repository-link { margin-left: auto; color: var(--text-muted); }
  .project-repository-link:hover { color: var(--accent); }

  @media (max-width: 760px) {
    .backdrop { padding: 0; }
    .dialog { width: 100vw; height: 100vh; border-radius: 0; }
    .toolbar-primary { align-items: stretch; flex-wrap: wrap; }
    .search-field { flex-basis: 100%; }
    .toolbar-check { flex: 1; }
    .settings-panel { top: 60px; right: 8px; width: min(322px, calc(100% - 16px)); }
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

function appendEmptyValue(cell: HTMLElement): void {
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
    <style>${STYLES}${REDESIGN_STYLES}</style>
    <div class="backdrop" id="backdrop">
      <section class="dialog" role="dialog" aria-modal="true" aria-labelledby="awesomer-title" data-theme="system" data-accent="indigo">
        <header class="header">
          <div class="brand-mark" aria-hidden="true">✦</div>
          <div class="title-block">
            <h1 class="title" id="awesomer-title">Awesomer Lists</h1>
            <a class="source-link" id="source-link" target="_blank" rel="noreferrer"></a>
          </div>
          <div class="header-actions">
            <button class="icon-button" id="settings-button" type="button" title="Settings" aria-label="Settings" aria-expanded="false">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"></path><circle cx="12" cy="12" r="3"></circle></svg>
            </button>
            <button class="icon-button" id="close-button" type="button" aria-label="Close">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
            </button>
          </div>
        </header>
        <button class="settings-scrim" id="settings-scrim" type="button" aria-label="Close settings" hidden></button>
        <aside class="settings-panel" id="settings-panel" aria-label="Settings" hidden>
          <div class="settings-heading">
            <span>Settings</span>
            <button class="icon-button" id="settings-close" type="button" aria-label="Close settings">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
            </button>
          </div>
          <div class="settings-section">
            <div class="eyebrow">GitHub access</div>
            <div class="connection-row">
              <span class="connection-dot" aria-hidden="true"></span>
              <span class="connection-copy">Connected as <strong id="settings-login">GitHub user</strong></span>
              <button class="compact-button" id="settings-disconnect" type="button">Disconnect</button>
            </div>
            <form class="settings-form" id="settings-auth-form">
              <label for="settings-token-input">Replace personal access token</label>
              <input class="token-input" id="settings-token-input" type="password" autocomplete="off" spellcheck="false" placeholder="github_pat_…">
              <label class="check-row"><input id="settings-remember-token" type="checkbox"><span>Remember on this device</span></label>
              <div class="settings-actions">
                <button class="compact-button" id="settings-save-token" type="submit">Save token</button>
                <span class="inline-error" id="settings-auth-error" role="alert" hidden></span>
              </div>
              <p class="settings-note">Use a dedicated, read-only token. Public repositories only; write permissions are not needed.</p>
            </form>
          </div>
          <div class="settings-section">
            <div class="eyebrow">Appearance</div>
            <label class="appearance-control">
              <span>Theme</span>
              <span class="theme-segment">
                <button class="theme-button" type="button" data-theme-mode="system" aria-pressed="true">System</button>
                <button class="theme-button" type="button" data-theme-mode="light" aria-pressed="false">Light</button>
                <button class="theme-button" type="button" data-theme-mode="dark" aria-pressed="false">Dark</button>
              </span>
            </label>
            <label class="appearance-control">
              <span>Accent color</span>
              <span class="swatches">
                <button class="swatch" type="button" data-accent="indigo" title="Indigo" aria-label="Indigo" aria-pressed="true"></button>
                <button class="swatch" type="button" data-accent="blue" title="Blue" aria-label="Blue" aria-pressed="false"></button>
                <button class="swatch" type="button" data-accent="teal" title="Teal" aria-label="Teal" aria-pressed="false"></button>
                <button class="swatch" type="button" data-accent="green" title="Green" aria-label="Green" aria-pressed="false"></button>
                <button class="swatch" type="button" data-accent="amber" title="Amber" aria-label="Amber" aria-pressed="false"></button>
                <button class="swatch" type="button" data-accent="orange" title="Orange" aria-label="Orange" aria-pressed="false"></button>
                <button class="swatch" type="button" data-accent="rose" title="Rose" aria-label="Rose" aria-pressed="false"></button>
              </span>
            </label>
          </div>
        </aside>
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
              <div class="toolbar-primary">
                <label class="toolbar-field search-field">
                  <span class="toolbar-label">Find a project</span>
                  <span class="search-shell">
                    <span class="search-icon" aria-hidden="true"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg></span>
                    <input class="search-input" id="search-input" type="search" placeholder="Search name, description, repository, or section">
                  </span>
                </label>
                <label class="toolbar-field">
                  <span class="toolbar-label">Last commit</span>
                  <span class="select-shell">
                    <select class="select-input" id="freshness-select">
                      <option value="">Any time</option>
                      <option value="1">Past 24 hours</option>
                      <option value="7">Past week</option>
                      <option value="30">Past month</option>
                      <option value="365">Past year</option>
                    </select>
                  </span>
                </label>
                <label class="check-row toolbar-check">
                  <input id="hide-archived" type="checkbox">
                  <span>Hide archived</span>
                </label>
                <button class="secondary-button refresh-button" id="refresh-button" type="button">↻ Refresh data</button>
              </div>
              <div class="maintenance-bar">
                <span class="toolbar-label">Maintenance</span>
                <button class="maintenance-chip" type="button" data-maintenance="all" aria-pressed="true">All <span class="chip-count">0</span></button>
                <button class="maintenance-chip" type="button" data-maintenance="active" aria-pressed="false"><span class="chip-dot status-active"></span>Active <span class="chip-count">0</span></button>
                <button class="maintenance-chip" type="button" data-maintenance="quiet" aria-pressed="false"><span class="chip-dot status-quiet"></span>Quiet <span class="chip-count">0</span></button>
                <button class="maintenance-chip" type="button" data-maintenance="stale" aria-pressed="false"><span class="chip-dot status-stale"></span>Stale <span class="chip-count">0</span></button>
                <button class="maintenance-chip" type="button" data-maintenance="archived" aria-pressed="false"><span class="chip-dot status-archived"></span>Archived <span class="chip-count">0</span></button>
                <button class="toggle-groups" id="toggle-groups-button" type="button">⌄ Collapse all</button>
              </div>
            </div>
            <div class="table-wrap" id="table-wrap">
              <div class="table-content">
                <div class="table-header grid-row" role="row">
                  <div class="header-cell" role="columnheader"><button class="sort-button" type="button" data-sort="name">Project <span class="sort-indicator"></span></button></div>
                  <div class="header-cell" role="columnheader">
                    <button class="sort-button" type="button" data-sort="maintenance">Maintenance <span class="sort-indicator"></span></button>
                    <button class="filter-button" id="maintenance-filter-button" type="button" title="Filter maintenance" aria-label="Filter maintenance" aria-expanded="false">▽</button>
                    <div class="filter-panel" id="maintenance-filter-panel" hidden><div class="filter-heading"><span class="eyebrow">Filter · Maintenance</span><button class="compact-button" type="button" data-clear-filter="maintenance">Clear</button></div><div id="maintenance-filter-options"></div></div>
                  </div>
                  <div class="header-cell" role="columnheader"><button class="sort-button" type="button" data-sort="stars">Popularity <span class="sort-indicator"></span></button></div>
                  <div class="header-cell" role="columnheader"><button class="sort-button" type="button" data-sort="lastCommitAt">Last commit <span class="sort-indicator"></span></button></div>
                  <div class="header-cell" role="columnheader"><button class="sort-button" type="button" data-sort="openIssues">Open issues <span class="sort-indicator"></span></button></div>
                  <div class="header-cell" role="columnheader">
                    <button class="sort-button" type="button" data-sort="license">License <span class="sort-indicator"></span></button>
                    <button class="filter-button" id="license-filter-button" type="button" title="Filter licenses" aria-label="Filter licenses" aria-expanded="false">▽</button>
                    <div class="filter-panel" id="license-filter-panel" hidden><div class="filter-heading"><span class="eyebrow">Filter · License</span><button class="compact-button" type="button" data-clear-filter="license">Clear</button></div><div id="license-filter-options"></div></div>
                  </div>
                </div>
                <div id="table-body" role="rowgroup"></div>
              </div>
            </div>
            <footer class="footer" id="footer"><a class="project-repository-link" id="project-repository-link" href="https://github.com/berrydev-ai/awesomer-lists" target="_blank" rel="noreferrer" title="View Awesomer Lists on GitHub">GitHub ↗</a></footer>
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
      hideArchived: false,
      updatedWithinDays: null,
      maintenanceStatuses: [],
      licenses: [],
      sort: { field: "stars", direction: "desc" },
      now: new Date(),
    },
    collapsedGroups: new Set(),
    settingsOpen: false,
    openFilter: null,
    themeMode: "system",
    accent: "indigo",
  };

  const views = [
    "unsupported-view",
    "auth-view",
    "loading-view",
    "error-view",
    "main-view",
  ].map((id) => requiredElement<HTMLElement>(shadow, `#${id}`));
  const sourceLink = requiredElement<HTMLAnchorElement>(shadow, "#source-link");
  const dialog = requiredElement<HTMLElement>(shadow, ".dialog");
  const settingsButton = requiredElement<HTMLButtonElement>(
    shadow,
    "#settings-button",
  );
  const settingsPanel = requiredElement<HTMLElement>(shadow, "#settings-panel");
  const settingsScrim = requiredElement<HTMLButtonElement>(
    shadow,
    "#settings-scrim",
  );
  const settingsLogin = requiredElement<HTMLElement>(shadow, "#settings-login");
  const settingsTokenInput = requiredElement<HTMLInputElement>(
    shadow,
    "#settings-token-input",
  );
  const settingsRememberToken = requiredElement<HTMLInputElement>(
    shadow,
    "#settings-remember-token",
  );
  const settingsAuthError = requiredElement<HTMLElement>(
    shadow,
    "#settings-auth-error",
  );
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
  const tableBody = requiredElement<HTMLElement>(shadow, "#table-body");
  const footer = requiredElement<HTMLElement>(shadow, "#footer");
  const toggleGroupsButton = requiredElement<HTMLButtonElement>(
    shadow,
    "#toggle-groups-button",
  );
  const maintenanceFilterPanel = requiredElement<HTMLElement>(
    shadow,
    "#maintenance-filter-panel",
  );
  const licenseFilterPanel = requiredElement<HTMLElement>(
    shadow,
    "#license-filter-panel",
  );
  const maintenanceFilterOptions = requiredElement<HTMLElement>(
    shadow,
    "#maintenance-filter-options",
  );
  const licenseFilterOptions = requiredElement<HTMLElement>(
    shadow,
    "#license-filter-options",
  );

  const close = (): void => host.remove();
  const showView = (id: string): void => {
    views.forEach((view) => {
      view.hidden = view.id !== id;
    });
  };

  const renderAppearance = (): void => {
    dialog.setAttribute("data-theme", state.themeMode);
    dialog.setAttribute("data-accent", state.accent);
    shadow
      .querySelectorAll<HTMLButtonElement>("[data-theme-mode]")
      .forEach((button) => {
        button.setAttribute(
          "aria-pressed",
          String(button.getAttribute("data-theme-mode") === state.themeMode),
        );
      });
    shadow
      .querySelectorAll<HTMLButtonElement>(".swatch[data-accent]")
      .forEach((button) => {
        button.setAttribute(
          "aria-pressed",
          String(button.getAttribute("data-accent") === state.accent),
        );
      });
  };

  const setSettingsOpen = (open: boolean): void => {
    state.settingsOpen = open;
    settingsPanel.hidden = !open;
    settingsScrim.hidden = !open;
    settingsButton.setAttribute("aria-expanded", String(open));
    settingsLogin.textContent = state.auth?.login ?? "GitHub user";
    settingsRememberToken.checked = state.auth?.remembered ?? false;
    settingsTokenInput.value = "";
    settingsAuthError.hidden = true;
  };

  const showAuth = (message = ""): void => {
    setSettingsOpen(false);
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
    const groups = buildTableGroups(state.entries, state.metadata, state.options);
    const facets = buildTableFacets(state.entries, state.metadata, state.options);
    tableBody.replaceChildren();

    for (const group of groups) {
      const groupButton = document.createElement("button");
      groupButton.className = "group-row";
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
      tableBody.append(groupButton);

      if (isCollapsed) continue;

      for (const row of group.rows) {
        const projectRow = document.createElement("div");
        projectRow.className = "project-row grid-row";
        projectRow.setAttribute("role", "row");

        const projectCell = document.createElement("div");
        projectCell.className = "project-cell";
        const projectLine = document.createElement("div");
        projectLine.className = "project-line";
        const projectLink = document.createElement("a");
        projectLink.className = "project-link";
        projectLink.href = row.repository.url;
        projectLink.target = "_blank";
        projectLink.rel = "noreferrer";
        projectLink.textContent = row.title;
        const repositoryName = document.createElement("span");
        repositoryName.className = "repository-name";
        repositoryName.textContent = row.repository.nameWithOwner;
        projectLine.append(projectLink, repositoryName);
        const description = document.createElement("span");
        description.className = "description";
        description.textContent =
          row.description || row.metadata?.description || "No description provided.";
        projectCell.append(projectLine, description);

        const maintenanceCell = document.createElement("div");
        const status = getMaintenanceStatus(
          row.metadata?.lastCommitAt ?? null,
          row.metadata?.isArchived ?? false,
          state.options.now,
        );
        const pill = document.createElement("span");
        pill.className = `status-pill status-${status}`;
        pill.textContent = statusLabel(status);
        maintenanceCell.append(pill);

        const popularityCell = document.createElement("div");
        popularityCell.className = "number popularity-cell";
        if (row.metadata) {
          const stars = document.createElement("div");
          const star = document.createElement("span");
          star.className = "star";
          star.textContent = "★";
          stars.append(star, ` ${formatRepositoryCount(row.metadata.stars)}`);
          const forks = document.createElement("span");
          forks.className = "sub-number";
          forks.textContent = `${formatRepositoryCount(row.metadata.forks)} forks`;
          popularityCell.append(stars, forks);
        } else {
          appendEmptyValue(popularityCell);
        }

        const commitCell = document.createElement("div");
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

        const issuesCell = document.createElement("div");
        issuesCell.className = "number";
        if (row.metadata) {
          issuesCell.textContent = formatRepositoryCount(row.metadata.openIssues);
        } else {
          appendEmptyValue(issuesCell);
        }

        const licenseCell = document.createElement("div");
        licenseCell.className = "license";
        licenseCell.textContent = row.metadata?.license ?? "No license";

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

    if (groups.length === 0) {
      const empty = document.createElement("div");
      empty.className = "empty-row";
      empty.textContent = "No projects match these filters.";
      tableBody.append(empty);
    }

    const selectedMaintenance = state.options.maintenanceStatuses ?? [];
    shadow
      .querySelectorAll<HTMLButtonElement>("[data-maintenance]")
      .forEach((button) => {
        const value = button.dataset.maintenance;
        const isAll = value === "all";
        const selected = isAll
          ? selectedMaintenance.length === 0
          : selectedMaintenance.includes(value as MaintenanceStatus);
        const facetCount = isAll
          ? facets.total
          : facets.maintenance[value as MaintenanceStatus];
        button.setAttribute("aria-pressed", String(selected));
        requiredElement<HTMLElement>(button, ".chip-count").textContent = String(
          facetCount,
        );
      });

    const createFilterOption = (
      name: string,
      optionCount: number,
      selected: boolean,
      onToggle: () => void,
    ): HTMLButtonElement => {
      const button = document.createElement("button");
      button.className = "filter-option";
      button.type = "button";
      button.setAttribute("role", "checkbox");
      button.setAttribute("aria-checked", String(selected));
      const box = document.createElement("span");
      box.className = "filter-box";
      box.textContent = selected ? "✓" : "";
      const optionName = document.createElement("span");
      optionName.className = "filter-name";
      optionName.textContent = name;
      const optionCountElement = document.createElement("span");
      optionCountElement.className = "filter-count";
      optionCountElement.textContent = String(optionCount);
      button.append(box, optionName, optionCountElement);
      button.addEventListener("click", onToggle);
      return button;
    };

    maintenanceFilterOptions.replaceChildren();
    const maintenanceStatuses: MaintenanceStatus[] = [
      "active",
      "quiet",
      "stale",
      "archived",
      "unknown",
    ];
    maintenanceStatuses
      .filter(
        (status) =>
          status !== "unknown" ||
          facets.maintenance.unknown > 0 ||
          selectedMaintenance.includes("unknown"),
      )
      .forEach((status) => {
        maintenanceFilterOptions.append(
          createFilterOption(
            statusLabel(status),
            facets.maintenance[status],
            selectedMaintenance.includes(status),
            () => {
              state.options.maintenanceStatuses = selectedMaintenance.includes(status)
                ? selectedMaintenance.filter((item) => item !== status)
                : [...selectedMaintenance, status];
              renderTable();
            },
          ),
        );
      });

    licenseFilterOptions.replaceChildren();
    const selectedLicenses = state.options.licenses ?? [];
    const licenseCounts = new Map(
      facets.licenses.map((facet) => [facet.value, facet.count]),
    );
    selectedLicenses.forEach((license) => {
      if (!licenseCounts.has(license)) licenseCounts.set(license, 0);
    });
    [...licenseCounts.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .forEach(([license, optionCount]) => {
        licenseFilterOptions.append(
          createFilterOption(
            license,
            optionCount,
            selectedLicenses.includes(license),
            () => {
              state.options.licenses = selectedLicenses.includes(license)
                ? selectedLicenses.filter((item) => item !== license)
                : [...selectedLicenses, license];
              renderTable();
            },
          ),
        );
      });

    maintenanceFilterPanel.hidden = state.openFilter !== "maintenance";
    licenseFilterPanel.hidden = state.openFilter !== "license";
    const maintenanceFilterButton = requiredElement<HTMLButtonElement>(
      shadow,
      "#maintenance-filter-button",
    );
    const licenseFilterButton = requiredElement<HTMLButtonElement>(
      shadow,
      "#license-filter-button",
    );
    maintenanceFilterButton.setAttribute(
      "aria-expanded",
      String(state.openFilter === "maintenance"),
    );
    licenseFilterButton.setAttribute(
      "aria-expanded",
      String(state.openFilter === "license"),
    );
    maintenanceFilterButton.classList.toggle(
      "is-active",
      selectedMaintenance.length > 0,
    );
    licenseFilterButton.classList.toggle("is-active", selectedLicenses.length > 0);

    const allGroupsCollapsed =
      groups.length > 0 &&
      groups.every((group) => state.collapsedGroups.has(group.key));
    toggleGroupsButton.textContent = allGroupsCollapsed
      ? "⌃ Expand all"
      : "⌄ Collapse all";

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

    const projectRepositoryLink = document.createElement("a");
    projectRepositoryLink.className = "project-repository-link";
    projectRepositoryLink.id = "project-repository-link";
    projectRepositoryLink.href = "https://github.com/berrydev-ai/awesomer-lists";
    projectRepositoryLink.target = "_blank";
    projectRepositoryLink.rel = "noreferrer";
    projectRepositoryLink.title = "View Awesomer Lists on GitHub";
    projectRepositoryLink.textContent = "GitHub ↗";
    footer.append(projectRepositoryLink);

    shadow.querySelectorAll<HTMLButtonElement>("[data-sort]").forEach((button) => {
      const indicator = requiredElement<HTMLElement>(button, ".sort-indicator");
      const field = button.dataset.sort as SortField;
      const isCurrent = state.options.sort.field === field;
      indicator.textContent = isCurrent
        ? state.options.sort.direction === "asc"
          ? "▲"
          : "▼"
        : "";
      button.classList.toggle("is-active", isCurrent);
      button.parentElement?.setAttribute(
        "aria-sort",
        isCurrent
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
  settingsButton.addEventListener("click", () => {
    if (!state.auth?.hasToken) {
      showAuth();
      return;
    }
    setSettingsOpen(!state.settingsOpen);
  });
  requiredElement<HTMLButtonElement>(shadow, "#settings-close").addEventListener(
    "click",
    () => setSettingsOpen(false),
  );
  settingsScrim.addEventListener("click", () => setSettingsOpen(false));
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

  requiredElement<HTMLFormElement>(shadow, "#settings-auth-form").addEventListener(
    "submit",
    async (event) => {
      event.preventDefault();
      settingsAuthError.hidden = true;

      if (!settingsTokenInput.value.trim()) {
        settingsAuthError.textContent = "Paste a replacement token first.";
        settingsAuthError.hidden = false;
        return;
      }

      try {
        state.auth = await sendRequest<AuthStatus>({
          type: "auth.save",
          token: settingsTokenInput.value,
          remember: settingsRememberToken.checked,
        });
        settingsLogin.textContent = state.auth.login ?? "GitHub user";
        settingsTokenInput.value = "";
        setSettingsOpen(false);
        await loadData(false);
      } catch (error) {
        settingsAuthError.textContent =
          error instanceof Error ? error.message : "Could not save this token.";
        settingsAuthError.hidden = false;
      }
    },
  );
  requiredElement<HTMLButtonElement>(
    shadow,
    "#settings-disconnect",
  ).addEventListener("click", async () => {
    state.auth = await sendRequest<AuthStatus>({ type: "auth.clear" });
    showAuth("The GitHub token was removed.");
  });

  shadow.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;

    const themeButton = target.closest<HTMLButtonElement>("[data-theme-mode]");
    if (themeButton) {
      state.themeMode = themeButton.getAttribute(
        "data-theme-mode",
      ) as ModalState["themeMode"];
      renderAppearance();
      return;
    }

    const accentButton = target.closest<HTMLButtonElement>(".swatch[data-accent]");
    if (accentButton) {
      state.accent = accentButton.getAttribute(
        "data-accent",
      ) as ModalState["accent"];
      renderAppearance();
    }
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
  shadow
    .querySelectorAll<HTMLButtonElement>("[data-maintenance]")
    .forEach((button) => {
      button.addEventListener("click", () => {
        const value = button.dataset.maintenance;

        if (!value || value === "all") {
          state.options.maintenanceStatuses = [];
        } else {
          const status = value as MaintenanceStatus;
          const selected = state.options.maintenanceStatuses ?? [];
          state.options.maintenanceStatuses = selected.includes(status)
            ? selected.filter((item) => item !== status)
            : [...selected, status];
        }

        renderTable();
      });
    });
  requiredElement<HTMLButtonElement>(
    shadow,
    "#maintenance-filter-button",
  ).addEventListener("click", () => {
    state.openFilter =
      state.openFilter === "maintenance" ? null : "maintenance";
    renderTable();
  });
  requiredElement<HTMLButtonElement>(
    shadow,
    "#license-filter-button",
  ).addEventListener("click", () => {
    state.openFilter = state.openFilter === "license" ? null : "license";
    renderTable();
  });
  shadow
    .querySelectorAll<HTMLButtonElement>("[data-clear-filter]")
    .forEach((button) => {
      button.addEventListener("click", () => {
        if (button.dataset.clearFilter === "maintenance") {
          state.options.maintenanceStatuses = [];
        } else {
          state.options.licenses = [];
        }
        renderTable();
      });
    });
  toggleGroupsButton.addEventListener("click", () => {
    const groups = buildTableGroups(state.entries, state.metadata, state.options);
    const allGroupsCollapsed =
      groups.length > 0 &&
      groups.every((group) => state.collapsedGroups.has(group.key));

    if (allGroupsCollapsed) {
      groups.forEach((group) => state.collapsedGroups.delete(group.key));
    } else {
      groups.forEach((group) => state.collapsedGroups.add(group.key));
    }
    renderTable();
  });
  shadow.querySelectorAll<HTMLButtonElement>("[data-sort]").forEach((button) => {
    button.addEventListener("click", () => {
      const field = button.dataset.sort as SortField;
      const isCurrent = state.options.sort.field === field;
      const defaultDirection: SortDirection =
        field === "name" || field === "openIssues" || field === "license"
          ? "asc"
          : "desc";
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
    if (!(event instanceof KeyboardEvent) || event.key !== "Escape") return;

    if (state.settingsOpen) {
      setSettingsOpen(false);
    } else if (state.openFilter) {
      state.openFilter = null;
      renderTable();
    } else {
      close();
    }
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
  renderAppearance();
  state.auth = await sendRequest<AuthStatus>({ type: "auth.status" });

  if (!state.auth.hasToken) {
    showAuth();
  } else {
    await loadData(false);
  }
}
