# ai-sdk-ping

## 0.3.0

### Minor Changes

- fa765b1: Migrate to AI SDK v7.

  All packages now target the AI SDK v7 line (`ai@7`, `@ai-sdk/provider@4` / `@ai-sdk/provider-utils@5`, providers at `^4`) and require `ai@7` (`peerDependencies: ">=7.0.0"`). A single build cannot support both v6 and v7 because the provider spec differs, so v6 is no longer supported.

  - **gateway-provider**: model type `LanguageModelV3` -> `LanguageModelV4`; the v4 providers fix binary (image / PDF / audio) inputs that the v6-era v3 providers mis-encoded under ai@7.
  - **local-fetch**: replace the now-deprecated `result.toUIMessageStreamResponse()` with the standalone `toUIMessageStream` + `createUIMessageStreamResponse` helpers. Public API is unchanged.
  - **ping**: `streamText` result `fullStream` -> `stream`.

## 0.2.0

### Minor Changes

- 7683625: First release from the ai-sdk-utils monorepo
