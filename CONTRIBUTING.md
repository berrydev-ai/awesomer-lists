# Contributing

Thanks for helping improve Awesomer Lists. This is a small project, so the process is short.

## Before you start

For anything larger than a bug fix or a typo, open an issue first and describe the change. That avoids work that does not fit the extension's scope: turning a GitHub Awesome list into a sortable, grouped project table, without analytics and without sending your token anywhere but `api.github.com`.

## Set up

```sh
npm install
npm run check
```

`npm run check` runs the tests, the type check, and the build. It should pass before you change anything.

To try your build in Chrome:

1. Run `npm run build`.
2. Open `chrome://extensions` and turn on **Developer mode**.
3. Choose **Load unpacked** and select the `dist` folder.
4. Click **Reload** on the extension card after each rebuild.

For UI work you usually do not need the extension at all. Run `npm run dev` and open [http://127.0.0.1:4173/preview.html](http://127.0.0.1:4173/preview.html). It uses a committed snapshot of public GitHub data, reloads on save, and never calls GitHub.

## Commands

- `npm test` runs behavior tests. `npm run test:watch` keeps them running.
- `npm run typecheck` checks TypeScript.
- `npm run build` writes the unpacked extension to `dist`.
- `npm run dev` serves the UI preview with browser reload.
- `npm run preview` serves the same preview without reload.
- `npm run check` runs tests, type check, and build together.
- `npx wrangler dev` inside `server/` serves the shared cache Worker at `http://localhost:8787`.

## Where code lives

| Path                | What it holds                                                          |
| ------------------- | ---------------------------------------------------------------------- |
| `src/domain/`       | Parsing Awesome READMEs, maintenance labels, and the table model        |
| `src/github/`       | The GitHub REST and GraphQL clients                                     |
| `src/server-cache/` | The shared cache client, config, and the payload shape both sides share |
| `src/ui/`           | Formatting helpers for the modal                                        |
| `src/`              | Background service worker, content script, options, and token pages     |
| `public/`           | `manifest.json` and static extension pages                              |
| `scripts/`          | Build and preview scripts                                               |
| `server/`           | The Cloudflare Worker for the shared cache                              |

Tests sit next to the file they cover, as `name.test.ts`.

## Changing the shared cache payload

`src/server-cache/payload.ts` is validated by both the extension and the Worker. A change there is a protocol change: update the validator, the tests on both sides, and `server/README.md` in the same pull request. Deployed Workers hold cached records for seven days, so keep new fields optional where you can.

## Tests

Write tests for behavior, not for internals. Add a failing test with any bug fix, and cover the new path with any feature. Tests use [Vitest](https://vitest.dev) with `happy-dom`, and they must not make network calls. Use fixtures instead of live GitHub responses.

## Style

- TypeScript, ES modules, no build-time framework.
- Match the surrounding file. There is no formatter step, so keep diffs small and free of unrelated reformatting.
- Keep user-facing text plain and short, in the voice already used in the UI and the README.

## Security and privacy rules

These are not negotiable, because people paste a GitHub token into this extension.

- The token goes only to `api.github.com`. Never send it to `raw.githubusercontent.com`, to the cache server, or anywhere else.
- Page code must never be able to read the token back.
- Do not add analytics, telemetry, or any third-party script.
- Do not widen `permissions` or `host_permissions` in `public/manifest.json` without explaining why in the pull request.
- The shared cache carries public counters only. Do not send README contents, URLs of private repositories, or anything identifying a user.

Found a vulnerability? Do not open a public issue. Report it privately through [GitHub's security advisories](https://github.com/berrydev-ai/awesomer-lists/security/advisories/new).

## Commits and pull requests

Commit messages follow [Conventional Commits](https://www.conventionalcommits.org), as in `feat(ui): move refresh data into the settings panel` and `fix: parse tables and skip missing repositories`. Common scopes here are `extension`, `ui`, `dev`, and `server`.

In the pull request, describe what changed and why, note anything a reviewer should click through in the extension or the preview, and confirm `npm run check` passes. Update the README when behavior, permissions, or commands change.

## License

By contributing, you agree that your contributions are licensed under the [MIT License](LICENSE) that covers this project.
