# ai-sdk-gateway-provider

Turn your own LLM gateway into a [Vercel AI SDK](https://ai-sdk.dev) provider.

Many organizations put every model behind a single gateway, each backend with its own URL layout.
That is awkward with the AI SDK: each official provider points at its vendor's API, and Google in particular needs the request URL rewritten **and** the endpoint switched between streaming and non-streaming calls.

`ai-sdk-gateway-provider` absorbs that. You describe your gateway's topology **once** as data, and get back a standard provider that routes each model to the right backend through one endpoint:

```ts
import { createGatewayProvider } from "ai-sdk-gateway-provider";
import { generateText } from "ai";

const gateway = createGatewayProvider({
	baseURL: "https://gateway.example.com/v1",
	// apiKey defaults to process.env.AI_GATEWAY_API_KEY
	backends: {
		anthropic: { pathTemplate: "anthropic/{slug}" },
		openai: { pathTemplate: "openai/{slug}" },
		google: {
			pathTemplate: "google/{slug}:{action}",
			actionMap: { streamGenerateContent: "customStreamGenerateContent" },
		},
	},
	models: [
		{ id: "claude-sonnet-4-6", backend: "anthropic" },
		{ id: "gpt-5.1", backend: "openai" },
		{ id: "gemini-2.5-pro", backend: "google", slug: "pro" },
	],
});

const { text } = await generateText({
	model: gateway("claude-sonnet-4-6"), // routed to the anthropic backend
	prompt: "Hello!",
});
```

## Install

```bash
npm install ai-sdk-gateway-provider ai
```

The official provider packages are bundled as dependencies (they share most of their transitive deps, so the marginal cost is small); `ai` is a peer dependency.

## Supported backends

| Backend             | Package                     | Notes                                                                                          |
| ------------------- | --------------------------- | ---------------------------------------------------------------------------------------------- |
| `anthropic`         | `@ai-sdk/anthropic`         |                                                                                                |
| `openai`            | `@ai-sdk/openai`            | `api`: `chat` (default) / `responses` / `completion`                                           |
| `mistral`           | `@ai-sdk/mistral`           |                                                                                                |
| `cohere`            | `@ai-sdk/cohere`            |                                                                                                |
| `groq`              | `@ai-sdk/groq`              |                                                                                                |
| `xai`               | `@ai-sdk/xai`               | Grok                                                                                           |
| `deepseek`          | `@ai-sdk/deepseek`          |                                                                                                |
| `perplexity`        | `@ai-sdk/perplexity`        |                                                                                                |
| `openai-compatible` | `@ai-sdk/openai-compatible` | Generic: covers Fireworks, Together, Cerebras, DeepInfra, Ollama, and any OpenAI-spec endpoint |
| `google`            | `@ai-sdk/google`            | Gemini — model carried in the URL                                                              |

OpenAI-compatible upstreams (Ollama included) don't need a dedicated backend — point `openai-compatible` at the right path and distinguish them by model `slug`.
Bedrock / Vertex / Azure are intentionally omitted: their bespoke (AWS/GCP/Azure) auth doesn't fit a single bearer-token gateway.

## How it works

`{slug}` is the model's `slug`, falling back to its `id`.
Every backend except `google` carries the model in the **request body**, so the upstream URL path is fixed per provider instance and the slug is substituted at request time.
For `google` the model is already in the **URL**, so it is rewritten to your layout — which is also where the streaming / non-streaming endpoint switch is handled (`actionMap`).

Regions, versions, and any other gateway-specific segments are just text you put in `baseURL` or a `pathTemplate` (e.g. `"gemini/eu/{slug}:{action}"`).
Nothing about your gateway is hard-coded into this package.

## Configuration as data

`createGatewayProvider` takes a plain object, so the topology can live in a YAML or JSON file and be loaded at startup:

```ts
import { createGatewayProvider, loadGatewayConfig } from "ai-sdk-gateway-provider";

const gateway = createGatewayProvider(await loadGatewayConfig("./gateway.yaml"));
```

- `parseGatewayConfig(data)` — validate an object you already have (browser-safe).
- `parseGatewayConfigString(text)` — validate a YAML/JSON string (browser-safe).
- `loadGatewayConfig(path)` — read and validate a file (Node only).

Validation reports unknown backends, duplicate model ids, and malformed path templates with their location in the config.

## Provider-native features

The underlying provider instances are exposed for tools and typed provider metadata:

```ts
await generateText({
	model: gateway("gemini-2.5-pro"),
	tools: { web_search: gateway.google.tools.googleSearch({}) },
	prompt: "What changed recently?",
});
```

Embeddings and image models are reached the same way, e.g. `gateway.openai.textEmbeddingModel("text-embedding-3-small")`.

## Composing with `ai-sdk-catalog`

[`ai-sdk-catalog`](../catalog) resolves every model through a swappable resolver, so the gateway drops in as a one-liner and your declarative catalog drives model and role selection:

```ts
import { createCatalog, loadConfig } from "ai-sdk-catalog";

const catalog = createCatalog(await loadConfig("./models.yaml"), (_provider, modelId) =>
	gateway(modelId),
);

await generateText({ model: catalog.modelForRole("chat"), prompt: "..." });
```
