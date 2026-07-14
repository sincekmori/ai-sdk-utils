---
"ai-sdk-catalog": minor
---

feat(catalog): declarative `headers` and `query` for enterprise gateways

- `headers` on a direct provider, the `gateway` block, and each gateway backend: extra request headers merged over the vendor SDK's own (same-name wins, so an explicit auth header overrides the SDK's default). An inline value may embed the resolved API key via the `{apiKey}` placeholder (e.g. `"Bearer {apiKey}"`); `{ "envVarName": "..." }` reads the value from an environment variable as lazily as the key itself.
- `query` on the same three levels: query parameters appended to every request URL (after the gateway path rewriting), e.g. a mandatory `api-version`.
- Backend-level entries merge over the gateway-level ones (backend wins per name).
- New validation: `headers`/`query` are rejected alongside a `gateway` block (they belong inside it), and `{apiKey}` in a direct provider's headers requires `apiKey`/`apiKeyEnvVarName`.
