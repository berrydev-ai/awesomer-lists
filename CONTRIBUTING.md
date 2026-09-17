# Contributing

Awesomer Lists turns a GitHub Awesome list into a sortable, grouped project table. Keep the Chrome and Safari builds in this repository. User data stays on the device, and the token goes only to `api.github.com`.

## Set up

Use Node 24, as specified in `.nvmrc` and CI:

```sh
npm ci
npm run check
```

To inspect the interface without credentials, run `npm run dev` and open [the local preview](http://127.0.0.1:4173/preview.html). The preview uses a committed GitHub snapshot and simulated cache updates. It does not call GitHub or save a token.

## Commands

| Command | Result |
| --- | --- |
| `npm test` | Runs behavior tests with local fixtures. |
| `npm run typecheck` | Checks TypeScript. |
| `npm run build` | Writes the Chrome extension to `dist/`. |
| `npm run build:safari` | Writes Safari resources to `dist-safari/`. |
| `npm run build:all` | Builds both browser packages. |
| `npm run verify:all` | Checks files, versions, permissions, and bundled code in both packages. |
| `npm run check` | Runs tests, type checking, both builds, and both distribution checks. |
| `npm run safari:package` | Creates a macOS Xcode project under `safari/generated/`. |
| `npm run safari:native-build` | Creates and compiles the unsigned macOS app. |
| `npm run dev` | Serves the preview with automatic reload. |
| `npm run preview` | Serves the preview without automatic reload. |

Xcode packaging requires macOS and an accepted Xcode license. Generated projects and build products are ignored by Git. Rebuild the project after web source changes. Packaging does not install or publish the extension.

The native build makes sure that the app and embedded extension use matching bundle identifiers and a macOS 12.0 deployment target. Safari 17.1 remains required. The Safari manifest omits Chrome-only background and options-page fields.

See [README.md](README.md) for Chrome installation, Safari temporary installation, and signed Safari development builds.

## Source layout

| Path | Purpose |
| --- | --- |
| `src/domain/` | README parsing, maintenance labels, and the table model. |
| `src/cache/` | Local metadata records, eviction, refresh coordination, and rate-limit pauses. |
| `src/github/` | Direct GitHub REST and GraphQL requests. |
| `src/token-store.ts` | Private session tokens and remembered tokens in extension-origin IndexedDB. |
| `src/sender.ts` | Request permissions for content scripts and extension pages. |
| `src/background.ts` | Browser events, authorization, and progress messages. |
| `src/content.ts` | The GitHub modal and progressive results. |
| `src/options.ts` | Local cache usage and clearing. |
| `src/ui/` | Display helpers. |
| `public/` | The base manifest, extension pages, and icons. |
| `scripts/` | Browser builds, distribution checks, preview, and Safari packaging. |
| `server/` | The earlier shared-cache service and its compatibility tests. Current extensions do not use it. |
| `src/server-cache/payload.ts` | The legacy service payload contract. It is excluded from browser bundles. |

## Behavior and tests

Tests sit next to the source that they cover. Use Vitest and local fixtures. Do not send test credentials or test requests to GitHub.

Cover changes to expiry, storage limits, interrupted loads, cache clearing, sender validation, and token migration. A failed batch must not discard earlier saved results. A cleared cache must not refill from work that started before the clear. Clearing metadata must preserve credentials and active rate-limit pauses.

The cache retains public metadata for 30 days, treats it as fresh for six hours, and limits metadata storage to 25 MiB. Missing repositories have a 15-minute cache. Cache schema changes need migration tests. Credentials never belong in this cache.

Before submission, run `npm run check`. For Safari packaging changes, also run `npm run safari:native-build` on a Mac with Xcode. Test the installed extension in each affected browser. The HTML preview and mocked browser tests do not prove extension permissions or service-worker behavior.

## Security and privacy

- Send the token only to `api.github.com`. Raw Markdown requests must omit it.
- Keep session storage restricted to trusted extension contexts. Remembered tokens belong in the extension-origin database.
- Validate message senders by protocol, host, and extension page. Custom extension schemes can have a `null` URL origin in some environments.
- Do not add analytics, third-party scripts, cache services, or arbitrary host permissions.
- Explain any permission change and add a distribution check for its intended scope.

Report vulnerabilities privately through [GitHub security advisories](https://github.com/berrydev-ai/awesomer-lists/security/advisories/new).

## Style and documentation

Use TypeScript and ES modules. Match surrounding code and avoid unrelated formatting. There is no separate lint or formatting command in this repository.

Update the README when behavior, permissions, or commands change. Keep each Markdown paragraph on one physical line. Add user-visible changes under Unreleased in `CHANGELOG.md`.

## Release process

1. Record the release version in `CHANGELOG.md`.
2. Set the same version in `package.json`, `package-lock.json`, and `public/manifest.json`.
3. Create and push the approved release tag.
4. Review the draft release and its separate Chrome, Safari resources, and Xcode project archives.
5. Publish the approved draft.

The release workflow builds both browser packages and compiles the unsigned Safari app. Apple signing and App Store submission are separate owner actions. The workflow does not submit to either browser store.

## License

Contributions use the repository’s [MIT License](LICENSE).
