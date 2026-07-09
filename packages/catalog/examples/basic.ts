import { readFile } from "node:fs/promises";

import { generateText } from "ai";
import * as z from "zod";

import { Config, createCatalog } from "../src/index.ts";

// In a real app this import is `from "ai-sdk-catalog"`.
// Examples use the relative source path so they run against the local checkout.

// --- 1. Load the unified config -------------------------------------------
// Read the JSON file however you like and hand the object to createCatalog —
// validation happens in there, so there is no separate parse step. This
// directory has three sizes: minimal / standard / advanced.
const configText = await readFile("./examples/ai-sdk-catalog.advanced.json", "utf8");
const raw: unknown = JSON.parse(configText);
const catalog = createCatalog(raw as Config);

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

// --- 2. Browser / no file system: hand createCatalog a plain object --------
// createCatalog validates whatever it gets, so fetched JSON goes straight in.
const response = await fetch("/ai-sdk-catalog.json");
const fetched: unknown = await response.json();
createCatalog(fetched as Config);

// --- 3. An OpenAI-compatible server (Ollama), still config-only ------------
// `vendor: openai` reuses @ai-sdk/openai; `baseURL` points it at the local
// endpoint — no resolver code, Ollama is just a direct provider. (Providers with
// bespoke auth like Bedrock/Vertex use createCatalog(config, { resolvers }).)
const local = createCatalog({
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
});
await generateText({ model: local.modelForRole("local"), prompt: "ping" });

// --- 4. Bonus: emit a JSON Schema so editors autocomplete/validate configs -
// The package already ships this as schema.json — point a `"$schema"` key at
// "./node_modules/ai-sdk-catalog/schema.json" (or a versioned CDN URL). This
// is how scripts/generate-schema.ts produces it.
const jsonSchema = z.toJSONSchema(Config);
console.log(JSON.stringify(jsonSchema, undefined, 2));
