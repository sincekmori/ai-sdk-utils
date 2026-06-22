# ai-sdk-catalog

> Manage [Vercel AI SDK](https://ai-sdk.dev) providers, models, and roles from one declarative config.

Keep the answer to "which provider has which models, and what are their limits" in one place instead of scattered across code.
Reference models by **role** (`"chat"`, `"fast"`, `"summarize"`) so you can swap the underlying model without touching app code.
Swap a single **resolver** function to move between the Vercel AI Gateway, direct providers, or a local Ollama — same config.

## Install

```bash
npm install ai-sdk-catalog ai zod
```

## Usage

```ts
import { generateText } from "ai";
import { loadConfig, createCatalog } from "ai-sdk-catalog";

const config = await loadConfig("./models.yaml");
const catalog = createCatalog(config); // defaults to the Vercel AI Gateway

const { text } = await generateText({
	model: catalog.modelForRole("chat"),
	prompt: "Invent a new holiday and describe its traditions.",
	// No need to pass temperature here — the config's settings are already
	// baked into the handle (see "Default call settings" below).
});

// Model metadata travels with the role.
const meta = catalog.metaForRole("chat");
console.log(meta?.id, meta?.type, meta?.settings);
```

### In the browser (or any non-Node runtime)

The core validates a plain object, so it runs anywhere.
`loadConfig` is a Node-only convenience that reads a file; the browser-safe entry points are `parseConfig` (an object) and `parseConfigString` (YAML or JSON text).

```ts
import { parseConfig, createCatalog } from "ai-sdk-catalog";

const config = parseConfig(await (await fetch("/models.json")).json());
const catalog = createCatalog(config);
```

`loadConfig` imports `node:fs` lazily, so it tree-shakes out of browser bundles when you don't use it.

### Config file

```yaml
providers:
  - id: anthropic
    models:
      - id: claude-sonnet-4-5
        type: default
        settings: # optional default call settings
          temperature: 1

roles:
  chat:
    provider: anthropic
    model: claude-sonnet-4-5
```

The config is validated up front.
It checks provider/model id uniqueness and that every role references a real provider+model pair.

### Model type: `default` vs `chat`

`type` tells the resolver which call surface to use for a model:

- `default` → `provider(modelId)` (e.g. `openai("gpt-4o")`)
- `chat` → `provider.chat(modelId)` (e.g. `openai.chat("gpt-4o")`)

Use `chat` for providers/endpoints that only work through the chat-completions API — for example, OpenAI-compatible local servers like Ollama. The resolver receives the type as its third argument (see below); the default `gatewayResolver` ignores it because the Vercel AI Gateway exposes a single surface.

### Default call settings

Add a `settings` block to set AI SDK call parameters (`temperature`, `topP`, `maxOutputTokens`, `seed`, …) from the config. They are baked into the model handle via `defaultSettingsMiddleware`, so they apply to every `generateText`/`streamText` call automatically and can still be overridden per call.

`settings` can sit on a **provider** (default for all its models) and/or on a **model**. The two are merged, with the model winning: scalar fields are overridden, and `providerOptions` is merged per provider namespace (so a model adds/overrides individual options without dropping the provider-level ones).

```yaml
providers:
  - id: openai
    settings: # provider-level defaults, inherited by every model below
      temperature: 0.7
      maxOutputTokens: 128000
      providerOptions: # provider-specific options, passed through untouched
        openai:
          reasoningEffort: low
    models:
      - id: gpt-5.1
        type: default # inherits the provider defaults as-is
      - id: gpt-5.1-mini
        type: default
        settings:
          temperature: 0.2 # overrides; maxOutputTokens stays inherited
          providerOptions:
            openai:
              parallelToolCalls: false # merged with reasoningEffort: low
```

`metaForRole(role)?.settings` returns the **effective** (merged) settings — exactly what is baked into the handle.

### Swapping the resolver

Ollama exposes an OpenAI-compatible API, so point `@ai-sdk/openai` at it for local models while everything else goes through the gateway.

```ts
import { createOpenAI } from "@ai-sdk/openai";
import { createCatalog, gatewayResolver, type ModelResolver } from "ai-sdk-catalog";

const ollama = createOpenAI({
	baseURL: "http://localhost:11434/v1",
	apiKey: "ollama", // required by the client but ignored by Ollama
});

const hybrid: ModelResolver = (providerId, modelId, type) => {
	if (providerId !== "ollama") return gatewayResolver(providerId, modelId, type);
	// Ollama's endpoint only speaks chat-completions, so honor type: chat.
	return type === "chat" ? ollama.chat(modelId) : ollama(modelId);
};

const catalog = createCatalog(config, hybrid);
```

See [`examples/basic.ts`](examples/basic.ts) for a full walkthrough, including generating a JSON Schema from the config for editor autocompletion.
