---
"ai-sdk-catalog": minor
---

feat(catalog)!: restructure the config schema for structural validation and expressiveness

**Breaking changes** (0.x minor):

- **Vendor block**: a direct provider's endpoint overrides move from flat provider fields into `vendor`, which is either the vendor id string or a block: `{ "vendor": { "id": "openai", "baseURL": ..., "apiKey": ..., "name": ..., "headers": ..., "query": ... } }`. `vendor.id` defaults to the provider id, so `{ "vendor": { "apiKey": ... } }` works. `vendor` and `gateway` are mutually exclusive.
- **Unified secrets**: `apiKeyEnvVarName` is removed everywhere. `apiKey` now accepts a literal string or `{ "envVarName": "..." }` — the same union header values use. A gateway with no `apiKey` still falls back to `AI_GATEWAY_API_KEY`.
- **Free-form gateway backends**: `gateway.backends` is a map under keys of your choice and each entry names its `vendor`, so the same vendor can appear more than once (e.g. two regions): `"backends": { "claude-eu": { "vendor": "anthropic", "pathTemplate": "eu/anthropic/{slug}" } }`. `model.backend` references the key. `actionMap` is validated as `google`-only and `name` as `openai-compatible`-only.
- **Catalog options**: `CatalogOptions.resolvers` becomes `CatalogOptions.providers`, a per-provider override map with `resolve` (replaces the runtime; the old resolvers) and `fetch` (per-provider base fetch, winning over the global `fetch` — e.g. to inject a short-lived OAuth token for one gateway). `ProviderResolver` now receives the full `ModelEntry` instead of `(modelId, api)`.
- **Strict schema**: every config object rejects unknown keys instead of silently dropping them, so removed fields (like `apiKeyEnvVarName`) fail loudly with a path.
- Provider ids must not contain `:`. Removed exports: `FixedPathBackend`, `GoogleBackend`, `OpenAICompatibleBackend`, `Backends` (replaced by `GatewayBackend`).

**Non-breaking addition**: roles accept the shorthand string `"provider:model"` (split at the first `:`, so model ids may contain colons) alongside the existing `{ "provider": ..., "model": ... }` object form.

Migration:

| 0.6                                                                      | 0.7                                                                                        |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------ |
| `{ "id": "x", "vendor": "openai", "baseURL": B, "apiKeyEnvVarName": E }` | `{ "id": "x", "vendor": { "id": "openai", "baseURL": B, "apiKey": { "envVarName": E } } }` |
| `gateway.apiKeyEnvVarName: E`                                            | `gateway.apiKey: { "envVarName": E }`                                                      |
| `backends: { "anthropic": { ... } }`                                     | `backends: { "anthropic": { "vendor": "anthropic", ... } }`                                |
| `createCatalog(cfg, { resolvers: { x: r } })`                            | `createCatalog(cfg, { providers: { x: { resolve: (m) => r(m.id, m.api) } } })`             |
