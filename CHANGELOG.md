# Changelog

All notable changes to this project are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and
this project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
The extension version in `public/manifest.json` and the `version` in
`package.json` are kept in step, and a release is the tag `vX.Y.Z`.

## [Unreleased]

Nothing has been released yet. Everything below ships in the first tagged
version.

### Added

- Sortable, grouped table of the projects in a GitHub Awesome list, with stars,
  forks, latest default-branch commit, open issues excluding pull requests,
  license, and archived state.
- A plain maintenance label for each project: Active, Quiet, Stale, or Archived.
- Section grouping that mirrors the README heading hierarchy, shown as
  `Parent › Child` for nested headings, with sorting applied inside each section.
- Search and filters across project names, descriptions, repository names, and
  sections.
- README reading from the repository root through GitHub's API, and from the raw
  source when a rendered Markdown file is open.
- Fine-grained token flow, stored in session storage by default with an opt-in
  **Remember on this device**. The token is sent only to `api.github.com` and
  cannot be read back by page code.
- GraphQL batching so one request loads many projects with exact issue-only and
  default-branch commit data.
- Six-hour repository metadata cache in extension storage.
- Optional shared cache server, a Cloudflare Worker in `server/` holding public
  counters for seven days, with **Refresh data** to bypass both caches.
- Options page for the shared cache server URL, which requests the host as an
  optional permission when set after install.
- UI preview at `npm run preview`, and `npm run dev` for the same preview with
  automatic rebuild and browser reload.

### Fixed

- Awesome lists that lay projects out in Markdown tables are parsed, and
  repositories that no longer exist are skipped instead of failing the load.
- Project counts stay unique, and totals and sources match what GitHub returns.

[unreleased]: https://github.com/berrydev-ai/awesomer-lists/commits/main
