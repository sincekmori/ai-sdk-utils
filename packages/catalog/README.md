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
});

// Model metadata travels with the role.
const meta = catalog.metaForRole("chat");
console.log(meta?.contextWindow, meta?.maxOutputTokens, meta?.knowledgeCutoff);
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
    name: Anthropic
    models:
      - id: claude-sonnet-4-5
        type: default
        name: Claude Sonnet 4.5
        contextWindow: 200000
        maxOutputTokens: 64000
        knowledgeCutoff: 2025-03-01

roles:
  chat:
    provider: anthropic
    model: claude-sonnet-4-5
    description: Default chat model. # optional
```

The config is validated up front.
It checks provider/model id uniqueness, at most one `type: "default"` per provider, and that every role references a real provider+model pair.

### Swapping the resolver

Ollama exposes an OpenAI-compatible API, so point `@ai-sdk/openai` at it for local models while everything else goes through the gateway.

```ts
import { createOpenAI } from "@ai-sdk/openai";
import { createCatalog, gatewayResolver, type ModelResolver } from "ai-sdk-catalog";

const ollama = createOpenAI({
	baseURL: "http://localhost:11434/v1",
	apiKey: "ollama", // required by the client but ignored by Ollama
});

const hybrid: ModelResolver = (providerId, modelId) =>
	providerId === "ollama" ? ollama(modelId) : gatewayResolver(providerId, modelId);

const catalog = createCatalog(config, hybrid);
```

See [`examples/basic.ts`](examples/basic.ts) for a full walkthrough, including generating a JSON Schema from the config for editor autocompletion.
