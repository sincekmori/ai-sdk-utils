---
"ai-sdk-catalog": minor
---

Make `ai-sdk-catalog` an all-in-one, batteries-included package: it now bundles
the official `@ai-sdk/*` providers and resolves every provider from config, with
no companion package. A provider resolves in one of three ways:

- **direct** — a bundled vendor used straight. `{ id: openai }` calls
  `@ai-sdk/openai` directly (vendor defaults to `id`); set `vendor`, `baseURL`,
  `apiKey`, `apiKeyEnvVarName`, or `name` to point elsewhere.
- **gateway** — add a `gateway` block (gateway topology: `baseURL` + `backends`)
  and tag each model with a `backend`; it routes through your own LLM gateway.
  This brings `ai-sdk-gateway-provider`'s gateway routing into this package.
- **resolver** — a provider whose vendor is not built in (e.g. a local Ollama)
  is wired in code via `createCatalog(config, { resolvers })`.

All three coexist; roles address any of them by `provider:model`.

A model's `api` (`responses` | `chat` | `completion`) picks the call surface;
omit it for the vendor default — **OpenAI defaults to the Responses API**, an
OpenAI-compatible server to Chat Completions. Set `api: chat` for a gateway or
server that only speaks Chat Completions.

New `catalog.provider<P>(key)` returns the underlying AI SDK provider instance
behind a model (the backend's sub-provider for a gateway model), so
provider-native features — provider-executed tools, embeddings, image models,
typed metadata — are reachable from the catalog.

Breaking changes:

- `createCatalog(config, resolver)` → `createCatalog(config, { resolvers })`.
  The single global `ModelResolver` is replaced by per-provider overrides keyed
  by provider id (`ProviderResolver = (modelId, api?) => LanguageModel`). An
  override always wins. `ModelResolver` and `gatewayResolver` are removed.
- The default for a plain provider changed from the Vercel AI Gateway to the
  direct `@ai-sdk/*` vendor matching its `vendor`/`id`. A provider that is
  neither a built-in vendor nor a `gateway` block now requires a resolver.
- The model `type` field (`default` | `chat`) is replaced by `api` (`responses`
  | `chat` | `completion`); omit for the vendor default.
- Model handles are resolved lazily and memoized, so a provider's API key is
  only read when one of its models is first used.
- `RoleEntry` no longer eagerly holds a `model` handle; use `modelForRole(role)`
  (or `model(key)`) to resolve it.
- The config now rejects direct-vendor fields set alongside a `gateway` block,
  and requires `baseURL` for a direct `openai-compatible` provider.

Gateway routing that previously required `ai-sdk-gateway-provider` is now built
in, so `ai-sdk-catalog` is self-contained.
