import type { LanguageModel } from "ai";
import { describe, expect, it } from "vitest";

import { createCatalog } from "../src/catalog.ts";
import { modelCosts } from "../src/costs.gen.ts";
import { ModelCost } from "../src/schema.ts";
import { Vendor } from "../src/vendor-ids.ts";

// Cost fallback: a model whose config omits `cost` gets the embedded
// models.dev sheet for its vendor+id. Assertions compare against the
// committed snapshot itself, so a price refresh never breaks them.

describe("embedded models.dev costs", () => {
	it("fills a direct provider's missing cost from the snapshot", () => {
		const catalog = createCatalog({
			providers: [{ id: "anthropic", models: [{ id: "claude-sonnet-5" }] }],
			roles: {},
		});
		expect(modelCosts.anthropic?.["claude-sonnet-5"]).toBeDefined();
		expect(catalog.meta.get("anthropic:claude-sonnet-5")?.cost).toStrictEqual(
			modelCosts.anthropic?.["claude-sonnet-5"],
		);
	});

	it("resolves the vendor through a vendor block, not the provider id", () => {
		const catalog = createCatalog({
			providers: [{ id: "my-proxy", vendor: "openai", models: [{ id: "gpt-4o" }] }],
			roles: {},
		});
		expect(catalog.meta.get("my-proxy:gpt-4o")?.cost).toStrictEqual(modelCosts.openai?.["gpt-4o"]);
	});

	it("an explicit cost in the config always wins", () => {
		const cost = { input: 1, output: 2 };
		const catalog = createCatalog({
			providers: [{ id: "anthropic", models: [{ id: "claude-sonnet-5", cost }] }],
			roles: {},
		});
		expect(catalog.meta.get("anthropic:claude-sonnet-5")?.cost).toStrictEqual(cost);
	});

	it("leaves cost undefined for a model id the snapshot does not list", () => {
		const catalog = createCatalog({
			providers: [{ id: "anthropic", models: [{ id: "claude-imaginary-9" }] }],
			roles: {},
		});
		expect(catalog.meta.get("anthropic:claude-imaginary-9")?.cost).toBeUndefined();
	});

	it("leaves cost undefined for a resolver provider (vendor unknown)", () => {
		const catalog = createCatalog(
			{
				providers: [{ id: "ollama", models: [{ id: "gpt-4o" }] }],
				roles: {},
			},
			{ providers: { ollama: { resolve: () => ({}) as unknown as LanguageModel } } },
		);
		expect(catalog.meta.get("ollama:gpt-4o")?.cost).toBeUndefined();
	});

	it("leaves cost undefined for the openai-compatible vendor (no single upstream)", () => {
		const catalog = createCatalog({
			providers: [
				{
					id: "local",
					vendor: { id: "openai-compatible", baseURL: "http://localhost:1234/v1" },
					models: [{ id: "gpt-4o" }],
				},
			],
			roles: {},
		});
		expect(catalog.meta.get("local:gpt-4o")?.cost).toBeUndefined();
	});

	it("fills a gateway model's missing cost from its backend's vendor", () => {
		const catalog = createCatalog({
			providers: [
				{
					id: "acme",
					gateway: {
						baseURL: "https://gateway.example.com/v1",
						backends: { anthro: { vendor: "anthropic", pathTemplate: "anthropic/{slug}" } },
					},
					models: [{ id: "claude-sonnet-5", backend: "anthro" }],
				},
			],
			roles: {},
		});
		expect(catalog.meta.get("acme:claude-sonnet-5")?.cost).toStrictEqual(
			modelCosts.anthropic?.["claude-sonnet-5"],
		);
	});

	it("snapshot sanity: bundled vendors only, every sheet a valid ModelCost", () => {
		expect(Object.keys(modelCosts).length).toBeGreaterThan(0);
		for (const [vendor, sheets] of Object.entries(modelCosts)) {
			expect(Vendor.options).toContain(vendor);
			expect(vendor).not.toBe("openai-compatible");
			expect(Object.keys(sheets).length).toBeGreaterThan(0);
			for (const sheet of Object.values(sheets)) {
				expect(() => ModelCost.parse(sheet)).not.toThrow();
			}
		}
	});
});
