import { createOpenAI } from "@ai-sdk/openai";
import { generateText } from "ai";
import * as z from "zod";

import {
	Config,
	createCatalog,
	gatewayResolver,
	loadConfig,
	type ModelResolver,
	parseConfig,
} from "../src/index.ts";

// In a real app this import is `from "ai-sdk-catalog"`.
// Examples use the relative source path so they run against the local checkout.

// --- 1. Default: everything via the Vercel AI Gateway ----------------------
// On Node you can read and validate a file in one call.
const config = await loadConfig("./examples/models.yaml");
const catalog = createCatalog(config); // uses gatewayResolver

const { text } = await generateText({
	model: catalog.modelForRole("chat"),
	prompt: "Invent a new holiday and describe its traditions.",
});

console.log(text);

const chatMeta = catalog.metaForRole("chat");
console.log("context window:", chatMeta?.contextWindow);
console.log("max output tokens:", chatMeta?.maxOutputTokens);
console.log("knowledge cutoff:", chatMeta?.knowledgeCutoff);

// --- 2. Browser / no file system: validate a plain object ------------------
// parseConfig is the portable core and takes data you already have.
// Here the config is fetched as JSON; no Node APIs are involved.
const response = await fetch("/models.json");
const browserConfig = parseConfig(await response.json());
createCatalog(browserConfig);

// --- 3. Your own provider: just resolve its ids to your handles -------------
// The config stays the same; the resolver decides how each id becomes a model.
// Here the "ollama" provider is served by your own OpenAI-compatible endpoint.
const ollama = createOpenAI({
	baseURL: "http://localhost:11434/v1",
	apiKey: "ollama", // required by the client but ignored by Ollama
});

const hybridResolver: ModelResolver = (providerId, modelId) =>
	providerId === "ollama"
		? ollama(modelId) // your provider
		: gatewayResolver(providerId, modelId); // everything else via the gateway

const hybrid = createCatalog(config, hybridResolver);
await generateText({ model: hybrid.modelForRole("local"), prompt: "ping" });

// --- 4. Bonus: emit a JSON Schema so editors autocomplete/validate the YAML -
// Write this to models.schema.json and reference it from your YAML language server.
const jsonSchema = z.toJSONSchema(Config);
console.log(JSON.stringify(jsonSchema, undefined, 2));
