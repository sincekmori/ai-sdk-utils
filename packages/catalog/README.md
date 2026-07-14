# ai-sdk-catalog

> Manage [Vercel AI SDK](https://ai-sdk.dev) providers, models, and roles from one declarative config — direct vendors or your own LLM gateway, batteries included.

Keep the answer to "which provider has which models, with what limits" in one place instead of scattered across code.
Reference models by **role** (`"chat"`, `"fast"`, `"summarize"`) so you can swap the underlying model without touching app code.

A provider resolves in one of three ways, and they all coexist in the same config:

- **direct** — a bundled `@ai-sdk/*` vendor used straight. `{ id: openai }` calls `@ai-sdk/openai` directly with `OPENAI_API_KEY`. A `vendor` block overrides the endpoint — that covers OpenAI-compatible servers like Ollama too (`vendor: { id: openai, baseURL }`), still config-only.
- **gateway** — add a `gateway` block describing your own LLM gateway's topology and tag each model with its `backend`; it routes there instead. No extra code.
- **resolver** — a provider whose auth doesn't fit a bundled vendor or a bearer-token gateway (Amazon Bedrock, Google Vertex, Azure) is wired in code via `createCatalog(config, { providers })`.

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
        "apiKey": { "envVarName": "ACME_API_KEY" },
        "backends": {
          "claude": { "vendor": "anthropic", "pathTemplate": "anthropic/{slug}" },
          "gemini": {
            "vendor": "google",
            "pathTemplate": "google/{slug}:{action}",
            "actionMap": { "streamGenerateContent": "customStreamGenerateContent" }
          }
        }
      },
      "models": [
        { "id": "claude-opus-4-8", "backend": "claude" },
        { "id": "gemini-3.5-flash", "backend": "gemini", "slug": "flash" }
      ]
    }
  ],
  "roles": {
    "chat": "anthropic:claude-sonnet-5",
    "search": "acme:gemini-3.5-flash",
    "cheap": { "provider": "openai", "model": "gpt-5.6-luna" }
  }
}
```

- `openai` and `anthropic` are **direct vendors**: the vendor defaults to `id`, so they call `@ai-sdk/openai` / `@ai-sdk/anthropic` straight, reading `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` out of the box. The `settings` block sets default call settings, inherited by every model of the provider.
- `acme` is a **gateway provider**: the `gateway` block describes your gateway's topology (omit `apiKey` to read `AI_GATEWAY_API_KEY`; `{ "envVarName": ... }` reads any env var). `backends` live under keys of your choice — the same vendor can appear twice (e.g. two regions) — and each model names its backend by key.
- `roles` map stable names to provider+model pairs — as the shorthand string `"provider:model"` (split at the first `:`, so model ids may contain colons) or the equivalent object form.

The `$schema` line is optional — with it, your editor validates and autocompletes the file; `createCatalog` ignores the key. The package ships the schema as [`schema.json`](schema.json), so the `./node_modules/...` pointer above works right after `npm install` and always matches the installed version. Prefer a URL? Any npm CDN serves it, pinned per version:

```json
{ "$schema": "https://cdn.jsdelivr.net/npm/ai-sdk-catalog@0.7.0/schema.json" }
```

Ready-made configs at three sizes live in [`examples/`](examples/): minimal, standard, and advanced.

`createCatalog` validates the config up front: provider/model id uniqueness, that every role references a real provider+model pair, and — for gateway providers — that each model names a `backend` key that the `gateway` block actually configures. Every object is strict, so an unknown or misspelled field fails validation instead of being silently dropped. Invalid input throws a readable error listing every issue with its path.

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
`vendor` names the backing `@ai-sdk/*` package — as a plain string (`"vendor": "anthropic"`) or a block with transport overrides — and defaults to `id`, so `{ id: openai }` is `@ai-sdk/openai`.
The block's fields (all optional):

- `id` — the vendor; defaults to the provider id.
- `baseURL` — a custom endpoint (e.g. a proxy).
- `apiKey` — the key: a literal string, or `{ "envVarName": "..." }` to read an env var. Omit to use the vendor SDK's own default (e.g. `OPENAI_API_KEY`).
- `name` — metadata namespace for `openai-compatible`.
- `headers` / `query` — extra request headers and URL query parameters (see [Extra headers and query parameters](#extra-headers-and-query-parameters)).

A model's `api` picks the call surface — `responses`, `chat`, or `completion`.
Omit it for the vendor's default: **OpenAI defaults to the Responses API**, an OpenAI-compatible server to Chat Completions, and every other vendor to its single surface.
Set `api: chat` when a gateway or server only speaks Chat Completions.

Supported vendors: `anthropic`, `openai`, `openai-compatible`, `mistral`, `cohere`, `groq`, `xai`, `deepseek`, `perplexity`, `google`.
The OpenAI-compatible family (Fireworks, Together, Cerebras, DeepInfra, Ollama, …) is covered by `openai-compatible`.
Bedrock / Vertex / Azure are intentionally omitted — their bespoke cloud auth doesn't fit; wire them through a `resolve` override.

```json
{
  "providers": [
    {
      "id": "fireworks",
      "vendor": {
        "id": "openai-compatible",
        "baseURL": "https://api.fireworks.ai/inference/v1",
        "apiKey": { "envVarName": "FIREWORKS_API_KEY" },
        "name": "fireworks"
      },
      "models": [{ "id": "accounts/fireworks/models/gpt-oss-120b" }]
    }
  ]
}
```

An OpenAI-compatible server defaults to Chat Completions, so the model's `api` can stay unset here.

### Your own gateway

Add a `gateway` block to route a provider through a single gateway endpoint, each model to the right upstream backend.
`backends` is a map under keys of your choice; each entry names the `vendor` it speaks, so the same vendor can appear more than once (two regions, two api-versions), and each model picks its backend by key.
`{slug}` is the model's `slug` (falling back to its `id`); every vendor except `google` carries the model in the request body, so the path is fixed per backend and the slug is substituted at request time.
For `google` the model is in the URL, which is rewritten to your layout — including the streaming/non-streaming action switch via `actionMap`.
Regions and versions are just text in `baseURL` or a `pathTemplate`.

### Extra headers and query parameters

Enterprise gateways often need transport details beyond a bearer token — an APIM-style subscription-key header, tenant/routing headers, or a mandatory `?api-version=...` on every request.
A direct provider's `vendor` block, the `gateway` block, and each gateway backend all accept:

- `headers` — extra request headers, merged over the vendor SDK's own (a same-name header overrides the SDK's — e.g. an explicit `x-api-key`). A value is either a **literal string**, in which `{apiKey}` is replaced with the resolved API key, or **`{ "envVarName": "..." }`** to read it from an environment variable — as lazily as the key itself, when a model of the provider is first used.
- `query` — query parameters appended to every request URL (for a gateway, after the path rewriting). A parameter already in the URL is overridden. Values are plain text — don't put secrets in URLs; use a header instead.

```json
{
  "providers": [
    {
      "id": "acme",
      "gateway": {
        "baseURL": "https://gateway.example.com/v1",
        "apiKey": { "envVarName": "ACME_API_KEY" },
        "headers": {
          "Authorization": "Bearer {apiKey}",
          "Ocp-Apim-Subscription-Key": { "envVarName": "ACME_SUBSCRIPTION_KEY" }
        },
        "query": { "api-version": "2026-01-01" },
        "backends": {
          "claude": {
            "vendor": "anthropic",
            "pathTemplate": "anthropic/{slug}",
            "headers": { "x-route": "anthropic" }
          }
        }
      },
      "models": [{ "id": "claude-opus-4-8", "backend": "claude" }]
    }
  ]
}
```

Backend-level `headers` / `query` merge over the gateway-level ones (backend wins per name).
The `Authorization` line covers gateways that authenticate every backend with a bearer token — including the `anthropic` backend, whose SDK would otherwise only send the key as `x-api-key`.

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

### Per-provider overrides (resolvers, fetch)

Most providers need no code: a vendor block (optionally with a `baseURL`, which covers OpenAI-compatible servers like Ollama) or a `gateway` block resolves from config alone.
`createCatalog`'s `providers` option overrides single providers by id for the rest, with two knobs:

- `resolve` — resolves the provider's models in code, replacing the config-driven runtime entirely. The escape hatch for a provider whose auth or transport fits neither a bundled vendor nor a bearer-token gateway, such as Amazon Bedrock (AWS SigV4), Google Vertex, or Azure. List it like any provider (no `vendor`/`gateway`) and wire just that one in code. An override always wins, so it can also stand in for a built-in vendor or a gateway provider. The resolver receives the full `ModelEntry` (id, `api`, effective settings, ...).
- `fetch` — a base fetch for this provider only, winning over the global `fetch` option. The place to inject a short-lived OAuth token for one gateway without affecting the others.

```ts
import { createAmazonBedrock } from "@ai-sdk/amazon-bedrock";
import { createCatalog, type ProviderResolver } from "ai-sdk-catalog";

// Bedrock authenticates with AWS SigV4 — not a bearer token — so it's wired here.
const bedrock = createAmazonBedrock({ region: "us-east-1" });
const bedrockResolver: ProviderResolver = (model) => bedrock(model.id);

const catalog = createCatalog(config, {
  providers: {
    bedrock: { resolve: bedrockResolver },
    acme: { fetch: fetchWithFreshOAuthToken }, // per-provider transport, config untouched
  },
});
```

Resolution is **lazy and memoized**: a provider's API key is only read when one of its models is actually used, so listing a provider you never call costs nothing, and building the catalog never reads a key or hits the network.

See [`examples/`](examples/) for ready-made configs at three sizes (minimal / standard / advanced) and [`examples/basic.ts`](examples/basic.ts) for a full walkthrough, including generating a JSON Schema from the config for editor autocompletion.
