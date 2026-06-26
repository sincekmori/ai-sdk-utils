# ai-sdk-gateway-provider

## 0.2.0

### Minor Changes

- fa765b1: Migrate to AI SDK v7.

  All packages now target the AI SDK v7 line (`ai@7`, `@ai-sdk/provider@4` / `@ai-sdk/provider-utils@5`, providers at `^4`) and require `ai@7` (`peerDependencies: ">=7.0.0"`). A single build cannot support both v6 and v7 because the provider spec differs, so v6 is no longer supported.

  - **gateway-provider**: model type `LanguageModelV3` -> `LanguageModelV4`; the v4 providers fix binary (image / PDF / audio) inputs that the v6-era v3 providers mis-encoded under ai@7.
  - **local-fetch**: replace the now-deprecated `result.toUIMessageStreamResponse()` with the standalone `toUIMessageStream` + `createUIMessageStreamResponse` helpers. Public API is unchanged.
  - **ping**: `streamText` result `fullStream` -> `stream`.

## 0.1.0

### Minor Changes

- 4a55a79: Add `ai-sdk-gateway-provider`: turn a custom LLM gateway into a Vercel AI SDK provider. Describe the gateway topology once as data and get a standard provider that routes models to the right upstream backend through one endpoint — handling per-backend URL layouts and Gemini's stream / non-stream action switch.

  Supported backends: `anthropic`, `openai`, `mistral`, `cohere`, `groq`, `xai`, `deepseek`, `perplexity`, `google` (Gemini), plus a generic `openai-compatible` backend that covers Fireworks, Together, Cerebras, DeepInfra, Ollama, and any other OpenAI-spec endpoint. Composes with `ai-sdk-catalog` via a one-line resolver.
