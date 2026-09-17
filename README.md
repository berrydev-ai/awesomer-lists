# Awesomer Lists

[![CI](https://github.com/berrydev-ai/awesomer-lists/actions/workflows/ci.yml/badge.svg)](https://github.com/berrydev-ai/awesomer-lists/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

Awesomer Lists is a Chrome and Safari extension that turns a GitHub Awesome list into a sortable, grouped project table. Both builds use the same source code and keep their repository cache on the user’s computer.

<img width="1188" height="857" alt="CleanShot 2026-08-25 at 12 04 52" src="https://github.com/user-attachments/assets/1fa638cc-3448-4788-8cc4-faa184686c44" />

## What it shows

- Stars and forks
- Latest commit on the default branch
- Open issues, excluding pull requests
- License, archived state, and a maintenance label: Active, Quiet, Stale, or Archived
- The same section hierarchy used by the source README

Search and filters work across project names, descriptions, repository names, and README sections. Sorting happens inside each section, so the list keeps its original structure.

## Build locally

Use Node 24. Install the dependencies and build both browser packages:

```sh
npm ci
npm run build:all
```

The Chrome package is in `dist/`. The Safari package is in `dist-safari/`. Chrome 114 and Safari 17.1 are the minimum versions declared by the builds. Safari 17.1 provides [session storage restricted to trusted extension contexts](https://webkit.org/blog/14735/webkit-features-in-safari-17-1/).

### Chrome

1. Open `chrome://extensions`.
2. Turn on Developer mode.
3. Choose Load unpacked and select `dist/`.
4. Pin Awesomer Lists in the Extensions menu.

### Safari

On Safari versions that offer Add Temporary Extension, open Safari > Settings > Developer and select `dist-safari/`. Safari removes temporary extensions when you quit or after 24 hours. See [Apple’s local testing instructions](https://developer.apple.com/documentation/safariservices/running-your-safari-web-extension) for developer configuration and unsigned extensions.

To create and compile a macOS app with Xcode:

```sh
npm run safari:native-build
```

This command creates the Xcode project in `safari/generated/` and the unsigned build in `safari/build/products/Release/`. It requires macOS, Xcode, and acceptance of the Xcode license. It does not install, sign, publish, or submit the app.

The native app targets macOS Monterey or later with Safari 17.1 or later. The build includes Intel and Apple silicon binaries. Packaging sets matching app and extension identifiers and keeps the deployment target independent of the installed Xcode version.

To prepare a signed app, generate the project with `npm run safari:package`, open the `.xcodeproj` under `safari/generated/`, and select your development team for the app and extension targets. Run the macOS app from Xcode, then enable Awesomer Lists in Safari > Settings > Extensions. The packaging command replaces generated files, so keep custom native changes outside `safari/generated/`.

You can also upload a ZIP of the contents of `dist-safari/` to [Apple’s Safari Web Extension Packager](https://developer.apple.com/documentation/safariservices/packaging-and-distributing-safari-web-extensions-with-app-store-connect). This project currently targets macOS Safari. It does not include an iPhone or iPad interface validation.

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

By default, the token stays in the browser’s private extension session storage. It clears when the browser session ends. Remember on this device stores the token in IndexedDB, a database under the extension’s own origin. GitHub content scripts cannot read that database. This storage is not an encrypted password vault. Existing remembered tokens move out of general extension storage when the updated extension starts.

## Local cache

Each browser keeps its own repository metadata on the computer. No cache server, cloud database, or companion process is required. Fresh data comes directly from GitHub through each user’s own token. Chrome and Safari do not share their caches, even on the same Mac.

Cached records load before network requests finish. Records under six hours old need no automatic refresh. Older records remain visible while the extension requests current values. The footer shows the data age, refresh progress, and any failure. Refresh data requests new values while the current table stays visible.

Each successful batch is saved immediately. If a later request fails, earlier results remain available. Try again resumes ordinary loading from saved results. Missing repositories are remembered for 15 minutes to avoid repeated failed lookups. Requests for the same repository share pending work across tabs, and GitHub rate limits pause later requests until the reset time.

The cache keeps older metadata for up to 30 days and limits metadata storage to 25 MiB. When it needs space, it removes the least recently used records. Browser storage can still fail when disk space is low. The extension shows fetched results even when it cannot save them.

Open the extension’s options page to see cache usage or clear repository metadata. Clear cache keeps your token and active GitHub rate-limit pauses. In Chrome, find this page under chrome://extensions > Awesomer Lists > Details > Extension options. In Safari, use the extension’s configuration control in Settings > Extensions.

This is a metadata cache, not a complete offline copy of GitHub. Opening a list still requires its README. Refreshing repository data requires network access and a valid token.

The `server/` directory preserves the earlier shared-cache service for older builds. Current browser builds do not contact it or use `AWESOMER_CACHE_SERVER_URL`. This change does not remove any deployed service.

## Privacy and permissions

- `activeTab` gives temporary access only after you click the toolbar button.
- `scripting` injects the modal into that active GitHub tab.
- `storage` keeps session credentials and the local repository cache.
- `unlimitedStorage` permits the same 25 MiB cache budget in both browsers. The extension enforces its own limit.
- Host permissions allow requests to `https://api.github.com/*` and `https://raw.githubusercontent.com/*`. The raw source request does not include the token.

The token is sent only to `api.github.com`. Page code can check whether a token exists, but cannot read it back. The extension has no analytics.

The extension accepts up to 5,000 unique GitHub repositories from one source file. The cap prevents a compromised page from creating an unbounded API workload.

Private Awesome lists are not supported in this version. Exact Markdown blob sources are fetched without sending the token to `raw.githubusercontent.com`.

## Maintenance labels

- **Active:** latest commit was within 90 days.
- **Quiet:** latest commit was between 91 days and one year ago.
- **Stale:** latest commit was more than one year ago.
- **Archived:** GitHub marks the repository as archived.

These labels are visible rules, not a hidden quality score. Stars and issue counts remain separate signals.

## Development

| Command | Result |
| --- | --- |
| `npm run check` | Runs tests, type checking, both browser builds, and both distribution checks. |
| `npm run build:all` | Creates Chrome resources in `dist/` and Safari resources in `dist-safari/`. |
| `npm run safari:native-build` | Generates and compiles an unsigned macOS app with Xcode. |
| `npm run dev` | Serves the UI preview and reloads the browser after changes. |
| `npm run preview` | Serves the UI preview at `http://127.0.0.1:4173/preview.html`. |

See [CONTRIBUTING.md](CONTRIBUTING.md) for individual test, type, build, and distribution commands.

CI runs tests, type checking, both browser builds, and distribution verification on every pull request. A separate macOS job compiles the generated Safari app. Security reports go through [SECURITY.md](SECURITY.md), and released changes are recorded in [CHANGELOG.md](CHANGELOG.md).

See [CONTRIBUTING.md](CONTRIBUTING.md) for source locations, token and local cache rules, and the release process.

### Preview the UI without loading the extension

Run:

```sh
npm run preview
```

Then open [http://127.0.0.1:4173/preview.html](http://127.0.0.1:4173/preview.html). The preview uses a committed snapshot of public GitHub data captured on July 10, 2026. Its source URLs are recorded in `src/preview-snapshot.ts`. It does not call GitHub, require a token, or store anything. Changes to the modal source rebuild when the page is refreshed. Press `Ctrl+C` to stop the server.

For automatic browser reload while editing the preview UI, run `npm run dev` instead. Changes under `src`, `preview`, or `public` rebuild the affected files and reload the open page.

## License

[MIT](LICENSE) © Berry Development
