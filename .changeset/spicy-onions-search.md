---
"ai-sdk-catalog": minor
---

feat(catalog): declarative `headers` and `query` for enterprise gateways

- `headers` on a direct provider's `vendor` block, the `gateway` block, and each gateway backend: extra request headers merged over the vendor SDK's own (same-name wins, so an explicit auth header overrides the SDK's default — e.g. an APIM `Ocp-Apim-Subscription-Key`, or `x-api-key` behind a Bearer-unified gateway). An inline value may embed the resolved API key via the `{apiKey}` placeholder (e.g. `"Bearer {apiKey}"`); `{ "envVarName": "..." }` reads the value from an environment variable as lazily as the key itself.
- `query` on the same three levels: query parameters appended to every request URL (after the gateway path rewriting), e.g. a mandatory `api-version`.
- Backend-level entries merge over the gateway-level ones (backend wins per name).
- New validation: `{apiKey}` in a vendor block's headers requires that block to configure an `apiKey`.
