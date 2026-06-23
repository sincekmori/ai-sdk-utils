import { generateText } from "ai";

import { createGatewayProvider, loadGatewayConfig } from "../src/index.ts";

// In a real app this import is `from "ai-sdk-gateway-provider"`.
// Examples use the relative source path so they run against the local checkout.

// --- 1. Build a provider from a YAML config --------------------------------
// On Node you can read and validate the gateway topology in one call.
const config = await loadGatewayConfig("./examples/gateway.yaml");
const gateway = createGatewayProvider(config);

// One call surface: the gateway routes each model id to the right backend.
const { text } = await generateText({
	model: gateway("claude-sonnet-4-6"),
	prompt: "Invent a new holiday and describe its traditions.",
});
console.log(text);

// --- 2. Or configure it inline (no file system) ----------------------------
const inline = createGatewayProvider({
	baseURL: "https://gateway.example.com/v1",
	backends: {
		google: {
			pathTemplate: "google/{slug}:{action}",
			actionMap: { streamGenerateContent: "customStreamGenerateContent" },
		},
	},
	models: [{ id: "gemini-2.5-pro", backend: "google", slug: "pro" }],
});

await generateText({
	model: inline("gemini-2.5-pro"),
	prompt: "Summarize today's AI news.",
});

// --- 3. Compose with ai-sdk-catalog ----------------------------------------
// catalog resolves every model through a swappable resolver, so point it at the
// gateway and your declarative catalog (models.yaml) drives everything:
//
//   import { createCatalog, loadConfig } from "ai-sdk-catalog";
//
//   const catalog = createCatalog(
//     await loadConfig("./models.yaml"),
//     (_provider, modelId) => gateway(modelId),
//   );
//   await generateText({ model: catalog.modelForRole("chat"), prompt: "..." });
