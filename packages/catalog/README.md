# ai-sdk-catalog

> Manage [Vercel AI SDK](https://ai-sdk.dev) providers, models, and roles from one declarative config — direct vendors or your own LLM gateway, batteries included.

Keep the answer to "which provider has which models, with what limits" in one place instead of scattered across code.
Reference models by **role** (`"chat"`, `"fast"`, `"summarize"`) so you can swap the underlying model without touching app code.

A provider resolves in one of three ways, and they all coexist in the same config:

- **direct** — a bundled `@ai-sdk/*` vendor used straight. `{ id: openai }` calls `@ai-sdk/openai` directly with `OPENAI_API_KEY`. Override the endpoint with `baseURL` / `apiKey` — that covers OpenAI-compatible servers like Ollama too (`vendor: openai` + `baseURL`), still config-only.
- **gateway** — add a `gateway` block describing your own LLM gateway's topology and tag each model with its `backend`; it routes there instead. No extra code.
- **resolver** — a provider whose auth doesn't fit a bundled vendor or a bearer-token gateway (Amazon Bedrock, Google Vertex, Azure) is wired in code via `createCatalog(config, { resolvers })`.

## Install

```bash
npm install ai-sdk-catalog ai zod
```

The official `@ai-sdk/*` provider packages are bundled as dependencies (they share most of their transitive deps, so the marginal cost is small); `ai` is a peer dependency.

## Usage

```ts
import { readFile } from "node:fs/promises";

import { generateText } from "ai";
import { createCatalog } from "ai-sdk-catalog";

// createCatalog validates the config itself — no separate parse/load step.
const configText = await readFile("./ai-sdk-catalog.json", "utf8");
const config = JSON.parse(configText);
const catalog = createCatalog(config);

const { text } = await generateText({
  model: catalog.modelForRole("chat"),
  prompt: "Invent a new holiday and describe its traditions.",
  // No need to pass temperature here — the config's settings are already
  // baked into the handle (see "Default call settings" below).
});

// Model metadata travels with the role.
const meta = catalog.metaForRole("chat");
console.log(meta?.id, meta?.provider, meta?.settings);
```

### Config file

One JSON file, every kind of provider:

```json
{
  "$schema": "./node_modules/ai-sdk-catalog/schema.json",
  "providers": [
    {
      "id": "openai",
      "settings": { "temperature": 0.7 },
      "models": [{ "id": "gpt-5.6" }, { "id": "gpt-5.6-luna" }]
    },
    {
      "id": "anthropic",
      "models": [{ "id": "claude-sonnet-5" }]
    },
    {
      "id": "acme",
      "gateway": {
        "baseURL": "https://gateway.example.com/v1",
        "apiKeyEnvVarName": "ACME_API_KEY",
        "backends": {
          "anthropic": { "pathTemplate": "anthropic/{slug}" },
          "google": {
            "pathTemplate": "google/{slug}:{action}",
            "actionMap": { "streamGenerateContent": "customStreamGenerateContent" }
          }
        }
      },
      "models": [
        { "id": "claude-opus-4-8", "backend": "anthropic" },
        { "id": "gemini-3.5-flash", "backend": "google", "slug": "flash" }
      ]
    }
  ],
  "roles": {
    "chat": { "provider": "anthropic", "model": "claude-sonnet-5" },
    "search": { "provider": "acme", "model": "gemini-3.5-flash" },
    "cheap": { "provider": "openai", "model": "gpt-5.6-luna" }
  }
}
```

- `openai` and `anthropic` are **direct vendors**: `vendor` defaults to `id`, so they call `@ai-sdk/openai` / `@ai-sdk/anthropic` straight, reading `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` out of the box. The `settings` block sets default call settings, inherited by every model of the provider.
- `acme` is a **gateway provider**: the `gateway` block describes your gateway's topology (`apiKeyEnvVarName` defaults to `AI_GATEWAY_API_KEY`), and each model names the `backend` that serves it.
- `roles` map stable names to provider+model pairs.

The `$schema` line is optional — with it, your editor validates and autocompletes the file; `createCatalog` ignores the key. The package ships the schema as [`schema.json`](schema.json), so the `./node_modules/...` pointer above works right after `npm install` and always matches the installed version. Prefer a URL? Any npm CDN serves it, pinned per version:

```json
{ "$schema": "https://cdn.jsdelivr.net/npm/ai-sdk-catalog@0.5.0/schema.json" }
```

Ready-made configs at three sizes live in [`examples/`](examples/): minimal, standard, and advanced.

`createCatalog` validates the config up front: provider/model id uniqueness, that every role references a real provider+model pair, and — for gateway providers — that each model names a `backend` that the `gateway` block actually configures. Invalid input throws a readable error listing every issue with its path.

**Prefer YAML?** The package deliberately ships no YAML dependency. YAML parses to the same plain object — bring your own parser and hand the result to `createCatalog`:

```ts
import { readFile } from "node:fs/promises";
import { parse } from "yaml";

const text = await readFile("./ai-sdk-catalog.yaml", "utf8");
const config = parse(text);
const catalog = createCatalog(config);
```

### Direct vendors

A provider with no `gateway` block is a **direct vendor**.
Its vendor is `vendor ?? id`, so `{ id: openai }` is `@ai-sdk/openai`.
Point it elsewhere with:

- `baseURL` — a custom endpoint (e.g. a proxy).
- `apiKey` / `apiKeyEnvVarName` — the key, or the env var to read it from. Omit both to use the vendor SDK's own default (e.g. `OPENAI_API_KEY`).
- `name` — metadata namespace for `openai-compatible`.

A model's `api` picks the call surface — `responses`, `chat`, or `completion`.
Omit it for the vendor's default: **OpenAI defaults to the Responses API**, an OpenAI-compatible server to Chat Completions, and every other vendor to its single surface.
Set `api: chat` when a gateway or server only speaks Chat Completions.

Supported vendors: `anthropic`, `openai`, `openai-compatible`, `mistral`, `cohere`, `groq`, `xai`, `deepseek`, `perplexity`, `google`.
The OpenAI-compatible family (Fireworks, Together, Cerebras, DeepInfra, Ollama, …) is covered by `openai-compatible`.
Bedrock / Vertex / Azure are intentionally omitted — their bespoke cloud auth doesn't fit; wire them through a custom resolver.

```json
{
  "providers": [
    {
      "id": "fireworks",
      "vendor": "openai-compatible",
      "baseURL": "https://api.fireworks.ai/inference/v1",
      "apiKeyEnvVarName": "FIREWORKS_API_KEY",
      "name": "fireworks",
      "models": [{ "id": "accounts/fireworks/models/gpt-oss-120b" }]
    }
  ]
}
```

An OpenAI-compatible server defaults to Chat Completions, so the model's `api` can stay unset here.

### Your own gateway

Add a `gateway` block to route a provider through a single gateway endpoint, each model to the right upstream backend.
`{slug}` is the model's `slug` (falling back to its `id`); every backend except `google` carries the model in the request body, so the path is fixed per backend and the slug is substituted at request time.
For `google` the model is in the URL, which is rewritten to your layout — including the streaming/non-streaming action switch via `actionMap`.
Regions and versions are just text in `baseURL` or a `pathTemplate`.

### Provider-native features (tools, embeddings)

`catalog.provider(key)` returns the underlying AI SDK provider instance behind a model — so you can reach vendor-native features the model handle doesn't carry: provider-executed tools, embeddings, image models, typed metadata.
For a gateway model it's the sub-provider for that model's backend.
Pass the vendor's provider type to get it back typed.

```ts
import type { GoogleGenerativeAIProvider } from "@ai-sdk/google";
import { generateText } from "ai";

const google = catalog.provider<GoogleGenerativeAIProvider>(
  catalog.roles.search.key, // or an explicit "provider:model" key
);

await generateText({
  model: catalog.modelForRole("search"),
  tools: { web_search: google!.tools.googleSearch({}) },
  prompt: "What changed recently?",
});
```

Embeddings and image models are reached the same way, e.g. `catalog.provider<OpenAIProvider>(key)?.textEmbeddingModel("text-embedding-3-small")`.
`provider(key)` returns `undefined` for a resolver-backed provider (it exposes no instance) or an unknown key.

### In the browser (or any non-Node runtime)

The package never touches the filesystem — `createCatalog` takes a plain object, so it runs anywhere. Hand it data from wherever you got it:

```ts
import { createCatalog } from "ai-sdk-catalog";

const response = await fetch("/ai-sdk-catalog.json");
const config = await response.json();
const catalog = createCatalog(config);
```

### Default call settings

Add a `settings` block to set AI SDK call parameters (`temperature`, `topP`, `maxOutputTokens`, `seed`, …) from the config.
They are baked into the model handle via `defaultSettingsMiddleware`, so they apply to every `generateText`/`streamText` call automatically and can still be overridden per call.

`settings` can sit on a **provider** (default for all its models) and/or on a **model**.
The two are merged, with the model winning: scalar fields are overridden, and `providerOptions` is merged per provider namespace (so a model adds/overrides individual options without dropping the provider-level ones).

```json
{
  "providers": [
    {
      "id": "openai",
      "settings": {
        "temperature": 0.7,
        "maxOutputTokens": 128000,
        "providerOptions": { "openai": { "reasoningEffort": "low" } }
      },
      "models": [
        { "id": "gpt-5.6" },
        {
          "id": "gpt-5.6-luna",
          "settings": {
            "temperature": 0.2,
            "providerOptions": { "openai": { "parallelToolCalls": false } }
          }
        }
      ]
    }
  ]
}
```

Here `gpt-5.6` inherits the provider defaults as-is. `gpt-5.6-luna` overrides `temperature` (while `maxOutputTokens` stays inherited), and its `providerOptions.openai` gains `parallelToolCalls: false` alongside the inherited `reasoningEffort: "low"`. `providerOptions` values are provider-specific and passed through untouched.

`metaForRole(role)?.settings` returns the **effective** (merged) settings — exactly what is baked into the handle.

### Custom resolvers

Most providers need no code: a bundled vendor (optionally with a `baseURL`, which covers OpenAI-compatible servers like Ollama) or a `gateway` block resolves from config alone.
A resolver is the escape hatch for the rest — a provider whose auth or transport doesn't fit either, such as Amazon Bedrock (AWS SigV4), Google Vertex, or Azure.
List it like any provider (no `vendor`/`gateway`) and wire just that one in code.
An override always wins, so it can also stand in for a built-in vendor or a gateway provider.

```ts
import { createAmazonBedrock } from "@ai-sdk/amazon-bedrock";
import { createCatalog, type ProviderResolver } from "ai-sdk-catalog";

// Bedrock authenticates with AWS SigV4 — not a bearer token — so it's wired here.
// `api` is the model's call surface (undefined when the config omits it).
const bedrock = createAmazonBedrock({ region: "us-east-1" });
const bedrockResolver: ProviderResolver = (modelId) => bedrock(modelId);

const catalog = createCatalog(config, { resolvers: { bedrock: bedrockResolver } });
```

Resolution is **lazy and memoized**: a provider's API key is only read when one of its models is actually used, so listing a provider you never call costs nothing, and building the catalog never reads a key or hits the network.

See [`examples/`](examples/) for ready-made configs at three sizes (minimal / standard / advanced) and [`examples/basic.ts`](examples/basic.ts) for a full walkthrough, including generating a JSON Schema from the config for editor autocompletion.
