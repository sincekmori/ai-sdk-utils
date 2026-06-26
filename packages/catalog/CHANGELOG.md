# ai-sdk-catalog

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
