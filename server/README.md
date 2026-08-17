# Awesomer Lists shared cache

A Cloudflare Worker backed by Workers KV that stores repository metadata for
seven days so a list one person opens loads quickly for everyone after them.

The worker is a cache and nothing else. It holds no tokens, talks to no other
service, and never contacts GitHub. The extension keeps using each person's own
GitHub token for anything the cache cannot answer.

## Endpoints

| Method | Path                  | Body                              | Answer                                |
| ------ | --------------------- | --------------------------------- | ------------------------------------- |
| `GET`  | `/health`             | —                                 | `{ "ok": true, "ttlSeconds": 604800 }` |
| `POST` | `/v1/metadata/lookup` | `{ "repositories": ["owner/name"] }` | `{ "metadata": [...], "requested": n }` |
| `POST` | `/v1/metadata/publish`| `{ "metadata": [record, ...] }`   | `{ "stored": n }`                     |

Both `POST` endpoints accept at most 500 items and a 2 MB body. Names must match
`owner/name`; records must match the exact metadata shape in
`src/server-cache/payload.ts`, whose validator both sides share. A lookup only
returns entries that are still inside their seven-day window, and only for
repositories that were asked for.

## Deploy

```sh
cd server
npx wrangler kv namespace create CACHE   # copy the printed id into wrangler.jsonc
npx wrangler deploy
```

Then build the extension against the deployed worker:

```sh
AWESOMER_CACHE_SERVER_URL=https://awesomer-lists-cache.<subdomain>.workers.dev npm run build
```

The build writes that origin into `dist/manifest.json` as a host permission, so
no other host is reachable unless someone grants it from the options page.

Run it locally with `npx wrangler dev` and point a development build at
`http://localhost:8787`.

## Trust model

Entries are contributed by clients, so a determined contributor could publish
inaccurate star or commit counts. What that buys an attacker is bounded:

- Every record is re-validated against the same strict schema on read and write,
  and `url` must equal `https://github.com/<nameWithOwner>`, so no record can
  point the extension's links anywhere but the repository it names.
- No token, README, or personal data is ever sent to or stored by the worker —
  only public repository names and their public counters.
- **Refresh data** in the extension bypasses both caches and re-reads GitHub.

If exact numbers matter more than speed for your deployment, put Cloudflare
Access or a WAF rate-limiting rule in front of `/v1/metadata/publish`, or turn
the shared cache off in the extension's options page.

## Privacy

A lookup tells the worker which repository names a user is viewing. The worker
sends no cookies (`credentials: "omit"`) and stores nothing per user, but the
request itself is a disclosure. Anyone who does not want it can clear the server
URL or untick **Use the shared cache** in the extension's options page.
