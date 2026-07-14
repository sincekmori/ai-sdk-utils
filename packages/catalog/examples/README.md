# ai-sdk-catalog examples

Config files come in three sizes; each builds a catalog as-is with `createCatalog`:

| File                                                           | What it shows                                                                                                                                                                                                                                                     |
| -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`ai-sdk-catalog.minimal.json`](ai-sdk-catalog.minimal.json)   | The smallest valid config: one direct vendor, one model, one role.                                                                                                                                                                                                |
| [`ai-sdk-catalog.standard.json`](ai-sdk-catalog.standard.json) | Several direct vendors, inherited default call settings, and a local OpenAI-compatible server (Ollama) — still config-only.                                                                                                                                       |
| [`ai-sdk-catalog.advanced.json`](ai-sdk-catalog.advanced.json) | Everything above plus an `openai-compatible` vendor (Fireworks), your own gateway (multiple backends including two of one vendor, `headers`/`query`, `actionMap`, `slug` overrides), `"provider:model"` role shorthands, and per-model `providerOptions` merging. |

The JSON examples point at the package's shipped [`schema.json`](../schema.json) via `"$schema"` (here as the relative `../schema.json`; in your own project, `./node_modules/ai-sdk-catalog/schema.json` or a versioned CDN URL) so editors validate and autocomplete them. It is generated from the Zod `Config` schema by [`scripts/generate-schema.ts`](../scripts/generate-schema.ts), and a test fails if it drifts. Regenerate it after changing `src/schema.ts`:

```bash
pnpm generate-schema && pnpm format
```

[`basic.ts`](basic.ts) is a runnable walkthrough that loads the advanced config.

One provider kind is deliberately absent from these files: a **resolver-backed** provider (Amazon Bedrock, Google Vertex, Azure) is listed in the config like any other but wired in code via `createCatalog(config, { providers })` — with one here, `createCatalog` would throw unless you pass that `resolve` override. See "Per-provider overrides" in the [package README](../README.md).
