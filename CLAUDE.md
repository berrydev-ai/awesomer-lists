# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Awesomer Lists is a Chrome extension (Manifest V3, built with [WXT](https://wxt.dev)) that turns a GitHub Awesome-list README into a sortable, grouped project table. UI is React 19 + Ant Design 6.

## Commands

- `npm run dev` — WXT dev mode; opens a Chrome profile with the extension installed (needed to test injection, storage, the token iframe, and the real manifest).
- `npm run preview` — serves the same React app at `http://127.0.0.1:4173/preview/` using committed snapshot data (`src/preview-snapshot.ts`). No token, no GitHub calls. Fastest way to iterate on UI.
- `npm test` — all tests (`vitest run`).
- `npx vitest run src/domain/table-model.test.ts` — a single test file.
- `npm run typecheck` — runs `wxt prepare` first (required: the root tsconfig extends generated `.wxt/tsconfig.json`), then `tsc --noEmit`.
- `npm run build` — production build to `.output/chrome-mv3`.
- `npm run check` — full gate: tests, typecheck, build, and manifest verification. Run before considering work done.

Build output lives in `.output/chrome-mv3`. A stale `dist/` directory from a pre-WXT build system may exist; it is gitignored — ignore it.

## Testing conventions

- No vitest config file. Tests default to the node environment; DOM/React tests opt in per file with `// @vitest-environment happy-dom` on the first line and use `@testing-library/react`.
- Tests are colocated as `*.test.ts(x)` next to their source.
- UI tests drive `AwesomerApp` with a mocked `ExtensionClient` (a `vi.fn` handling `ExtensionRequest`s) — no Chrome APIs needed.

## Architecture

`entrypoints/` files are thin WXT shells; almost all logic lives in `src/`. WXT auto-imports are disabled (`imports: false` in `wxt.config.ts`) — import everything explicitly, including `defineBackground` / `defineContentScript` from `wxt/utils/*`.

Four entrypoints:

- `entrypoints/background.ts` → calls `registerBackground()` from `src/background.ts` (the service worker).
- `entrypoints/content.content/` → mounts the React app into a closed shadow root on `github.com`. Registered with `registration: "runtime"` — there is **no persistent content script**; the background injects it with `chrome.scripting.executeScript` only after a toolbar click (`activeTab` model).
- `entrypoints/token/` → the token-entry page. The content UI embeds it as an iframe (`web_accessible_resources`) so page scripts can never read the token; it talks to the parent via `postMessage` and to the background via `chrome.runtime.sendMessage`.
- `entrypoints/preview/` → standalone browser page that runs the same `AwesomerApp` against snapshot fixtures instead of the extension client.

Layers in `src/`:

- `src/domain/` — pure functions, no Chrome APIs: Awesome-list markdown parsing (`awesome-list.ts`), GitHub URL parsing (`github-page.ts`, `github-source.ts`), table sorting/filtering (`table-model.ts`), maintenance labels (`maintenance.ts`), shared types (`types.ts`).
- `src/github/` — GitHub API access: `graphql.ts` builds/parses batched GraphQL queries; `client.ts` does the fetching and maps failures to typed `GitHubErrorCode` errors.
- `src/ui/` — React components. `AwesomerApp` receives an injected `ExtensionClient` (just `send` + `getUrl`), which is how the content script, token page, and preview all share one application.
- `src/background.ts` — the service worker. It is the **only** code that holds the GitHub token or talks to the network. Maintains a 6-hour metadata cache in `chrome.storage.local`, fetches in GraphQL batches of 20, caps input at 5,000 repositories, and rejects messages from senders that are not `github.com` tabs.
- `src/messages.ts` — the typed `ExtensionRequest` / `ExtensionResponse` contract between UI surfaces and the background. Add new message types here first; `src/background.ts` maps them to handlers via the `RequestHandlers` type, so the compiler enforces exhaustiveness.

## Permissions and manifest invariants

The manifest is deliberately locked down and is enforced in three cooperating places — a permission change must touch all of them together:

1. `src/extension/manifest.ts` — declares the manifest (`activeTab`, `scripting`, `storage`, and exactly two host permissions: `api.github.com` and `raw.githubusercontent.com`).
2. `normalizeGeneratedManifest` (same file, wired via the `build:manifestGenerated` hook in `wxt.config.ts`) — strips host permissions and empty `content_scripts` that WXT infers on its own.
3. `scripts/verify-build.mjs` (`npm run verify:build`) — asserts the built manifest matches exactly and that no persistent content script was registered.

Security expectations to preserve: the token is sent only to `api.github.com` (raw.githubusercontent.com fetches are tokenless), only the background reads or writes token storage (`setAccessLevel: TRUSTED_CONTEXTS`), and content is injected only after a user click.
