# Security Policy

Awesomer Lists uses a GitHub token to read repository data. Report token exposure and other vulnerabilities privately.

## Reporting a vulnerability

Use [GitHub security advisories](https://github.com/berrydev-ai/awesomer-lists/security/advisories/new). Do not include vulnerability details in a public issue, discussion, or pull request.

Include reproduction steps, the affected build, and the access an attacker gains. A proof of concept against `main` helps us reproduce the problem.

We aim to provide:

- An acknowledgement within three business days.
- An assessment within 14 days.
- Credit in the advisory and changelog, unless you request anonymity.

Please allow time for a fix before you publish details.

## Supported versions

This project is pre-1.0. Fixes go into the next release, and older tags are not patched. Use the latest release or build from `main`.

## In scope

- A GitHub token sent to any host except `api.github.com`.
- A website, content script, or another extension that reads a token from this extension.
- Script execution caused by a crafted README, repository name, or cache record.
- A message sender that gains access to an unauthorized operation.
- An unexpected network destination, permission, third-party script, or analytics request.

The earlier Worker in `server/` still accepts private vulnerability reports. Current browser builds do not use it.

## Out of scope

- GitHub outages and rate limits.
- Outdated counters that are correctly marked as cached data.
- Attacks that require a compromised machine or control of the user’s browser profile.
- Resource limits on a legacy Worker operated by a third party.
- The documented absence of encryption for remembered credentials on disk.

## Token storage

Session storage is the default. Supported browsers restrict it to trusted extension contexts. Remember on this device saves a token in IndexedDB under the extension’s origin. Website content scripts cannot access this database. The database is not an operating-system password vault and does not encrypt the token itself.

On upgrade, the extension moves earlier remembered tokens out of general extension local storage. It removes the old copy only after the database write succeeds. If migration fails, token operations fail rather than silently discarding the original token.

Repository metadata uses separate extension local storage. Clear cache removes metadata and preserves credentials. Disconnect GitHub removes both remembered and session credentials.

Token reads and writes run in order. If a storage transition fails, the extension restores the previous credentials. If restoration also fails, token reads stay blocked across background restarts until Disconnect clears the stores successfully.

## Network and message boundaries

Tokens are sent only to `api.github.com`. Raw Markdown requests to `raw.githubusercontent.com` omit authorization. Current builds have no shared-cache host permission or optional arbitrary-host permission.

The background code validates the sender’s protocol, host, extension ID when supplied, and page path. The token page can save credentials and request status. The options page can inspect and clear metadata. GitHub content scripts can request repository data and disconnect credentials, but cannot read or save a token.

The token form is in an extension-origin iframe. It sends status to the GitHub page, never the token. There is no analytics or third-party script.

## If a token leaks

Revoke the token at [Personal access tokens](https://github.com/settings/personal-access-tokens), then report the leak privately. Use a dedicated, read-only token with a short expiration date for this extension.
