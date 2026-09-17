# Legacy Awesomer Lists shared cache

This Cloudflare Worker remains available for older extension builds. Current Chrome and Safari builds keep metadata on each device and do not contact this service. No deployed Worker or KV namespace is changed by the browser extension update.

The Worker stores contributed public repository metadata for seven days. It holds no tokens and never contacts GitHub. Older clients fetch missing data with their own tokens.

## Endpoints

| Method | Path | Body | Response |
| --- | --- | --- | --- |
| `GET` | `/health` | None | `{ "ok": true, "ttlSeconds": 604800 }` |
| `POST` | `/v1/metadata/lookup` | `{ "repositories": ["owner/name"] }` | `{ "metadata": [...], "requested": n }` |
| `POST` | `/v1/metadata/publish` | `{ "metadata": [record, ...] }` | `{ "stored": n }` |

Both POST endpoints accept at most 500 items and a 2 MB body. The validator in `src/server-cache/payload.ts` defines the shared contract. Lookup returns only requested records within their seven-day window.

## Existing deployments

Use the configuration in `wrangler.jsonc` to maintain an existing deployment. The browser build commands no longer accept `AWESOMER_CACHE_SERVER_URL`, and the current options page has no server URL control. Do not deploy this service to use the current extension.

The fixture client in `src/legacy-client.ts` preserves protocol coverage for older clients. Worker and round-trip tests still run with `npm test` from the repository root.

## Trust and privacy

Older clients contribute cache entries. Their counters are not verified against GitHub. The validator restricts record shape and repository URLs, but a contributor can submit inaccurate public counters. Earlier extension builds offer Refresh data to fetch directly from GitHub.

A lookup discloses the repository names in the request to the Worker. Requests omit cookies and tokens. The Worker stores no per-user profile. Existing operators remain responsible for deployment limits and access controls.
