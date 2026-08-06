---
"ai-sdk-catalog": minor
---

feat(catalog): `openai-compatible` vendor blocks and gateway backends accept `supportsStructuredOutputs` and `includeUsage` from the config; the `openai-compatible`-only fields (these two and `name`) now fail validation when written on any other vendor
