# Awesomer Lists

Awesomer Lists is a Chrome extension for turning a GitHub Awesome list into a sortable, grouped project table.

## What it shows

- Stars and forks
- Latest commit on the default branch
- Open issues, excluding pull requests
- License and archived state
- A plain maintenance label: Active, Quiet, Stale, or Archived
- The same section hierarchy used by the source README

Search and filters work across project names, descriptions, repository names, and README sections. Sorting happens inside each section, so the list keeps its original structure.

## Install locally

1. Run `npm install`.
2. Run `npm run build`.
3. Open `chrome://extensions` in Chrome.
4. Turn on **Developer mode**.
5. Choose **Load unpacked** and select the `dist` folder.
6. Pin **Awesomer Lists** from Chrome's Extensions menu.

## Use it

1. Open a GitHub repository containing an Awesome-style README.
2. Click the **Awesomer Lists** toolbar button.
3. Add a dedicated GitHub token when prompted.
4. Search, filter, collapse sections, or sort a column.

At a repository root, the extension reads the preferred README through GitHub's API. On a rendered Markdown file page, it reads that exact file's raw source. It recognizes GitHub repository links in Markdown list items and groups them by their nearest headings.

Standard Awesome tables of contents link to those headings, so the heading hierarchy is the grouping source of truth. Nested headings appear as `Parent › Child`.

## Create the GitHub token

Use a [fine-grained personal access token](https://github.com/settings/personal-access-tokens/new) created only for this extension.

Recommended settings:

- Give the token a short expiration date.
- Set **Contents** to **Read-only**.
- Set **Issues** to **Read-only**.
- Leave every write permission off.
- Keep repository access limited to public repositories.

Fine-grained tokens include read access to public repositories. The extension uses GraphQL batches so one request can load many projects with exact issue-only and default-branch commit data.

By default, the token is kept only in Chrome's session storage and is cleared when the browser session ends. **Remember on this device** stores it in local extension storage. Local extension storage is not a password vault.

## Privacy and permissions

- `activeTab` gives temporary access only after you click the toolbar button.
- `scripting` injects the modal into that active GitHub tab.
- `storage` keeps the token choice and a six-hour metadata cache.
- `https://api.github.com/*` allows README and metadata requests to GitHub.
- `https://raw.githubusercontent.com/*` allows the current rendered Markdown file to be read without sending the token to that host.

The token is sent only to `api.github.com`. Page code can check whether a token exists, but cannot read it back. The extension has no analytics or external service.

The extension accepts up to 5,000 unique GitHub repositories from one source file. The cap prevents a compromised page from creating an unbounded API workload.

Private Awesome lists are not supported in this version. Exact Markdown blob sources are fetched without sending the token to `raw.githubusercontent.com`.

## Maintenance labels

- **Active:** latest commit was within 90 days.
- **Quiet:** latest commit was between 91 days and one year ago.
- **Stale:** latest commit was more than one year ago.
- **Archived:** GitHub marks the repository as archived.

These labels are visible rules, not a hidden quality score. Stars and issue counts remain separate signals.

## Development

- `npm test` runs behavior tests.
- `npm run typecheck` checks TypeScript.
- `npm run build` creates the unpacked extension in `dist`.
- `npm run preview` opens a browser-ready UI build at `http://127.0.0.1:4173/preview.html`.
- `npm run check` runs all three checks.

### Preview the UI without loading the extension

Run:

```sh
npm run preview
```

Then open [http://127.0.0.1:4173/preview.html](http://127.0.0.1:4173/preview.html). The preview uses a committed snapshot of public GitHub data captured on July 10, 2026. Its source URLs are recorded in `src/preview-snapshot.ts`. It does not call GitHub, require a token, or store anything. Changes to the modal source rebuild when the page is refreshed. Press `Ctrl+C` to stop the server.
