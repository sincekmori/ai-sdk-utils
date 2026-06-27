import { generateText } from "ai";
import * as z from "zod";

import { Config, createCatalog, loadConfig, parseConfig } from "../src/index.ts";

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

// --- 3. An OpenAI-compatible server (Ollama), still config-only ------------
// `vendor: openai` reuses @ai-sdk/openai; `baseURL` points it at the local
// endpoint — no resolver code, Ollama is just a direct provider. (Providers with
// bespoke auth like Bedrock/Vertex use createCatalog(config, { resolvers }).)
const local = createCatalog(
	parseConfig({
		providers: [
			{
				id: "ollama",
				vendor: "openai",
				baseURL: "http://localhost:11434/v1",
				apiKey: "ollama", // required by the client but ignored by Ollama
				models: [{ id: "llama3.3", api: "chat" }], // Ollama speaks Chat Completions
			},
		],
		roles: { local: { provider: "ollama", model: "llama3.3" } },
	}),
);
await generateText({ model: local.modelForRole("local"), prompt: "ping" });

// --- 4. Bonus: emit a JSON Schema so editors autocomplete/validate the YAML -
// Write this to models.schema.json and reference it from your YAML language server.
const jsonSchema = z.toJSONSchema(Config);
console.log(JSON.stringify(jsonSchema, undefined, 2));
