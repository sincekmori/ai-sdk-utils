# ai-sdk-catalog

## 0.4.0

### Minor Changes

- f0efa79: Make `ai-sdk-catalog` an all-in-one, batteries-included package: it now bundles
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

## 0.3.0

### Minor Changes

- fa765b1: Migrate to AI SDK v7.

  All packages now target the AI SDK v7 line (`ai@7`, `@ai-sdk/provider@4` / `@ai-sdk/provider-utils@5`, providers at `^4`) and require `ai@7` (`peerDependencies: ">=7.0.0"`). A single build cannot support both v6 and v7 because the provider spec differs, so v6 is no longer supported.

  - **gateway-provider**: model type `LanguageModelV3` -> `LanguageModelV4`; the v4 providers fix binary (image / PDF / audio) inputs that the v6-era v3 providers mis-encoded under ai@7.
  - **local-fetch**: replace the now-deprecated `result.toUIMessageStreamResponse()` with the standalone `toUIMessageStream` + `createUIMessageStreamResponse` helpers. Public API is unchanged.
  - **ping**: `streamText` result `fullStream` -> `stream`.

## 0.2.0

### Minor Changes

- de45b7e: Add configurable call settings and implement the `chat` model type.

  - **Schema slimmed down**: removed `Model.{name, description, contextWindow, maxOutputTokens, knowledgeCutoff}`, `Provider.name`, and `RoleRef.description`.
  - **`ModelType: "chat"` now does something**: `ModelResolver` receives the model's `type` as a third argument, so a resolver can call `provider.chat(modelId)` instead of `provider(modelId)` for endpoints that only speak chat-completions (e.g. Ollama).
  - **Configurable call settings**: an optional `settings` block (`temperature`, `topP`, `maxOutputTokens`, `seed`, `providerOptions`, …) can be set from YAML/JSON. It is baked into the model handle via `defaultSettingsMiddleware`, so it applies to every call and can still be overridden per call.
  - **Provider-level defaults**: `settings` can also sit on a provider as defaults that each model merges/overrides (scalars: model wins; `providerOptions`: merged per provider namespace). `metaForRole().settings` exposes the effective merged value.
  - Removed the "at most one `type: default` per provider" invariant, which no longer fits the `default`/`chat` (call-surface) semantics.

  BREAKING CHANGE: `ModelResolver` gained a required third `type` argument, and several config fields were removed (see above).

## 0.1.0

### Minor Changes

- 7683625: First release from the ai-sdk-utils monorepo
