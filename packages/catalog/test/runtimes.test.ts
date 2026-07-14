import { describe, expect, it } from "vitest";

import { createCatalog } from "../src/catalog.ts";
import { Config } from "../src/schema.ts";

// Runtime behavior of the two config-driven provider kinds: a direct @ai-sdk
// vendor and a gateway. Resolve-override behavior lives in catalog.test.ts.

describe("createCatalog with a direct vendor", () => {
	it("resolves a bare provider through its @ai-sdk vendor (vendor defaults to id)", () => {
		const cfg = Config.parse({
			providers: [
				{ id: "openai", vendor: { apiKey: "test-key" }, models: [{ id: "gpt-5.6-luna" }] },
			],
			roles: { chat: { provider: "openai", model: "gpt-5.6-luna" } },
		});
		const catalog = createCatalog(cfg);
		const model = catalog.modelForRole("chat") as unknown as { modelId: string };
		expect(model.modelId).toBe("gpt-5.6-luna");
	});

	it("honors an explicit vendor different from the provider id", () => {
		const cfg = Config.parse({
			providers: [
				{
					id: "claude",
					vendor: { id: "anthropic", apiKey: "test-key" },
					models: [{ id: "claude-opus-4-8" }],
				},
			],
			roles: { chat: { provider: "claude", model: "claude-opus-4-8" } },
		});
		const catalog = createCatalog(cfg);
		const model = catalog.modelForRole("chat") as unknown as { modelId: string };
		expect(model.modelId).toBe("claude-opus-4-8");
	});

	it("accepts the string shorthand for the vendor", () => {
		const cfg = Config.parse({
			providers: [{ id: "claude", vendor: "anthropic", models: [{ id: "claude-opus-4-8" }] }],
			roles: { chat: { provider: "claude", model: "claude-opus-4-8" } },
		});
		const catalog = createCatalog(cfg);
		const model = catalog.modelForRole("chat") as unknown as { modelId: string };
		expect(model.modelId).toBe("claude-opus-4-8");
	});

	it("returns the vendor instance for a direct provider", () => {
		const cfg = Config.parse({
			providers: [
				{ id: "openai", vendor: { apiKey: "test-key" }, models: [{ id: "gpt-5.6-luna" }] },
			],
			roles: { chat: { provider: "openai", model: "gpt-5.6-luna" } },
		});
		const catalog = createCatalog(cfg);
		const openai = catalog.provider<{ languageModel: unknown }>("openai:gpt-5.6-luna");
		expect(openai?.languageModel).toBeTypeOf("function");
	});
});

describe("createCatalog with a gateway provider", () => {
	const gatewayConfig = Config.parse({
		providers: [
			{
				id: "acme",
				gateway: {
					baseURL: "https://gateway.example.com/v1",
					apiKey: "test-key", // inline so resolving needs no env var
					backends: { anthropic: { vendor: "anthropic", pathTemplate: "anthropic/{slug}" } },
				},
				models: [{ id: "claude-sonnet-4-6", backend: "anthropic", slug: "sonnet" }],
			},
		],
		roles: { chat: { provider: "acme", model: "claude-sonnet-4-6" } },
	});

	it("indexes gateway metadata (backend, slug)", () => {
		const catalog = createCatalog(gatewayConfig);
		const meta = catalog.meta.get("acme:claude-sonnet-4-6");
		expect(meta?.backend).toBe("anthropic");
		expect(meta?.slug).toBe("sonnet");
	});

	it("routes a gateway model to a real handle without a resolve override", () => {
		const catalog = createCatalog(gatewayConfig);
		const model = catalog.modelForRole("chat") as unknown as { modelId: string };
		expect(model.modelId).toBe("claude-sonnet-4-6");
	});

	it("routes each gateway model to its backend's vendor, including two backends of one vendor", () => {
		const cfg = Config.parse({
			providers: [
				{
					id: "gw",
					gateway: {
						baseURL: "https://gw.example.com/v1",
						apiKey: "test-key",
						backends: {
							"claude-eu": { vendor: "anthropic", pathTemplate: "eu/anthropic/{slug}" },
							"claude-us": { vendor: "anthropic", pathTemplate: "us/anthropic/{slug}" },
							gpt: { vendor: "openai", pathTemplate: "gpt/{slug}" },
							gemini: { vendor: "google", pathTemplate: "gemini/{slug}:{action}" },
						},
					},
					models: [
						{ id: "claude", backend: "claude-eu" },
						{ id: "claude-fallback", backend: "claude-us", slug: "claude" },
						{ id: "gpt", backend: "gpt", api: "chat" },
						{ id: "gemini", backend: "gemini" },
					],
				},
			],
			roles: { a: { provider: "gw", model: "claude" } },
		});
		const catalog = createCatalog(cfg);
		const providerOf = (key: `${string}:${string}`): string =>
			(catalog.model(key) as unknown as { provider: string }).provider;
		expect(providerOf("gw:claude")).toMatch(/anthropic/u);
		expect(providerOf("gw:claude-fallback")).toMatch(/anthropic/u);
		expect(providerOf("gw:gpt")).toMatch(/openai/u);
		expect(providerOf("gw:gemini")).toMatch(/google/u);
		// Two backends of the same vendor stay distinct provider instances.
		expect(catalog.provider("gw:claude")).not.toBe(catalog.provider("gw:claude-fallback"));
	});

	it("exposes the backend's provider instance via provider(key)", () => {
		const catalog = createCatalog(gatewayConfig);
		const anthropic = catalog.provider<{ languageModel: unknown }>("acme:claude-sonnet-4-6");
		// The underlying @ai-sdk/anthropic instance, for provider-native features.
		expect(anthropic?.languageModel).toBeTypeOf("function");
	});
});
