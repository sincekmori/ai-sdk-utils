---
"ai-sdk-catalog": minor
---

feat(catalog)!: bundle `@ai-sdk/xai` 5, which drops the Chat Completions API, and reject `api: "chat"` on an xAI model instead of silently sending it to the Responses API

**Breaking** (0.x minor): an `xai` vendor or gateway backend now speaks the Responses API only.
Models that omit `api` are unaffected — Responses was already xAI's default surface.
A model that sets `api: "chat"` now throws when its handle is resolved; drop the field to use the Responses API, or declare a Chat Completions-only endpoint as an `openai-compatible` vendor or backend.
Moving a model to `openai-compatible` drops its auto-filled `cost` and changes the `providerOptions` namespace to the block's `name`, so set `cost` and `name: "xai"` explicitly.
The chat-only provider options `searchParameters` and `parallel_function_calling` are not part of the Responses API and are ignored.
`catalog.provider<XaiProvider>(key)` returns the v5 provider, which has no `chat()`; `@ai-sdk/xai` 5 also removes the `XaiProviderOptions` and `XaiLanguageModelChatOptions` types.
