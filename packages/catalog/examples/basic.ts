import { createOpenAI } from "@ai-sdk/openai";
import { generateText } from "ai";
import * as z from "zod";

import {
	Config,
	createCatalog,
	loadConfig,
	parseConfig,
	type ProviderResolver,
} from "../src/index.ts";

// In a real app this import is `from "ai-sdk-catalog"`.
// Examples use the relative source path so they run against the local checkout.

// --- 1. Load the unified config -------------------------------------------
// On Node you can read and validate a file in one call. The file mixes direct
// vendors (@ai-sdk/openai, @ai-sdk/anthropic) with a gateway provider — see
// examples/models.yaml.
const config = await loadConfig("./examples/models.yaml");
const catalog = createCatalog(config);

const { text } = await generateText({
	model: catalog.modelForRole("chat"), // -> @ai-sdk/anthropic, called directly
	prompt: "Invent a new holiday and describe its traditions.",
	// No need to pass temperature here — the config's settings are already
	// baked into the handle.
});

console.log(text);

const chatMeta = catalog.metaForRole("chat");
console.log("model id:", chatMeta?.id);
console.log("settings:", chatMeta?.settings);

// The gateway role resolves to your own gateway, no extra wiring.
await generateText({ model: catalog.modelForRole("search"), prompt: "What changed recently?" });

// --- 2. Browser / no file system: validate a plain object ------------------
// parseConfig is the portable core and takes data you already have.
const response = await fetch("/models.json");
const browserConfig = parseConfig(await response.json());
createCatalog(browserConfig);

// --- 3. A provider that isn't a built-in vendor: a custom resolver ---------
// A local Ollama on an OpenAI-compatible endpoint, listed like any provider
// (no `vendor`/`gateway`) and wired in code — only this one needs a resolver.
const ollama = createOpenAI({
	baseURL: "http://localhost:11434/v1",
	apiKey: "ollama", // required by the client but ignored by Ollama
});

// `api` lets a resolver pick the call surface; Ollama speaks Chat Completions.
const ollamaResolver: ProviderResolver = (modelId, api) =>
	api === "chat" ? ollama.chat(modelId) : ollama.languageModel(modelId);

const local = createCatalog(
	parseConfig({
		providers: [{ id: "ollama", models: [{ id: "llama3.3", api: "chat" }] }],
		roles: { local: { provider: "ollama", model: "llama3.3" } },
	}),
	{ resolvers: { ollama: ollamaResolver } },
);
await generateText({ model: local.modelForRole("local"), prompt: "ping" });

// --- 4. Bonus: emit a JSON Schema so editors autocomplete/validate the YAML -
// Write this to models.schema.json and reference it from your YAML language server.
const jsonSchema = z.toJSONSchema(Config);
console.log(JSON.stringify(jsonSchema, undefined, 2));
