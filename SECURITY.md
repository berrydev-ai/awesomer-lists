# Security Policy

Awesomer Lists asks people for a GitHub token, so security reports are taken
seriously and answered.

## Reporting a vulnerability

Report privately through
[GitHub security advisories](https://github.com/berrydev-ai/awesomer-lists/security/advisories/new).
Do not open a public issue, and do not post details in a discussion or a pull
request.

Include what you found, how to reproduce it, and what an attacker gains. A
proof of concept against a build from `main` is ideal.

What to expect:

- An acknowledgement within 3 business days.
- An assessment, with a fix or an explanation of why it is not a vulnerability,
  within 14 days.
- Credit in the advisory and the changelog when the fix ships, unless you prefer
  not to be named.

Please give a reasonable window to ship a fix before publishing anything.

## Supported versions

This project is pre-1.0 and moves on `main`. Fixes land in the next release, and
older tags are not patched. Use the newest release, or build from `main`.

## What is in scope

- Any path where a GitHub token reaches a host other than `api.github.com`.
- Any way page code, a content script on a GitHub page, or another extension can
  read a stored token.
- Any way a crafted README or repository name causes script execution in the
  modal, the options page, or the token page.
- Permission problems: a build that reaches a host outside `manifest.json`, or
  an optional permission granted without a clear prompt.
- The shared cache Worker in `server/`: cache poisoning that harms clients,
  unbounded storage, or bypassing the payload validator.
- Anything sending user-identifying data anywhere.

## What is not in scope

- Inaccurate numbers from the shared cache. Cached counters are contributed by
  clients, not verified, and are documented as an approximation. **Refresh data**
  reads GitHub directly.
- Rate limiting or abuse of a shared cache server you deployed yourself. Sizing
  and protecting your deployment is yours to configure.
- GitHub API behavior, GitHub outages, or rate limits on your own token.
- Attacks needing a compromised machine or a browser profile the attacker
  already controls.
- Choosing **Remember on this device**, which is documented as storing the token
  in local extension storage, not a password vault.

## If you think your token leaked

Revoke it first at
[Personal access tokens](https://github.com/settings/personal-access-tokens),
then report the leak. Tokens for this extension should be fine-grained,
read-only, short-lived, and used for nothing else, which keeps the damage small.

## Design rules the code follows

These hold in every build, and a break in any of them is a bug worth reporting:

- The token is sent only to `api.github.com`. Raw Markdown is fetched from
  `raw.githubusercontent.com` without it.
- Page code can ask whether a token exists but cannot read its value.
- Session storage is the default. Local storage is opt-in.
- The shared cache receives repository names and public counters only. It never
  receives a token, a README, or anything identifying a user.
- There is no analytics and no third-party script.
