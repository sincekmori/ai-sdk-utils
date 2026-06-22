import type { LanguageModel } from "ai";
import { describe, expect, it, vi } from "vitest";

import { createCatalog, type ModelResolver } from "../src/catalog.ts";
import { Config } from "../src/schema.ts";

const config = Config.parse({
	providers: [
		{
			id: "openai",
			name: "OpenAI",
			models: [
				{
					id: "gpt-5.1-mini",
					type: "chat",
					name: "GPT-5.1 mini",
					contextWindow: 400_000,
					maxOutputTokens: 128_000,
					knowledgeCutoff: "2024-10-01",
				},
			],
		},
		{
			id: "anthropic",
			name: "Anthropic",
			models: [
				{
					id: "claude-sonnet-4-5",
					type: "default",
					name: "Claude Sonnet 4.5",
					contextWindow: 200_000,
					maxOutputTokens: 64_000,
				},
			],
		},
		{
			id: "ollama",
			name: "Ollama",
			models: [
				{
					id: "qwen3.6:35b",
					type: "chat",
					name: "Qwen3.6 35B",
					contextWindow: 256_000,
				},
			],
		},
	],
	roles: {
		chat: {
			provider: "anthropic",
			model: "claude-sonnet-4-5",
			description: "Default chat model.",
		},
		summarize: { provider: "openai", model: "gpt-5.1-mini" },
		local: { provider: "ollama", model: "qwen3.6:35b" },
	},
});

// A fake handle so no network call is ever made; tagged so we can identify it.
const makeHandle = (providerId: string, modelId: string): LanguageModel =>
	({
		specificationVersion: "v2",
		provider: providerId,
		modelId,
	}) as unknown as LanguageModel;

describe("createCatalog", () => {
	it("indexes every model by its provider:model key with metadata intact", () => {
		const catalog = createCatalog(config, makeHandle);
		expect([...catalog.meta.keys()].toSorted()).toStrictEqual([
			"anthropic:claude-sonnet-4-5",
			"ollama:qwen3.6:35b",
			"openai:gpt-5.1-mini",
		]);

		const mini = catalog.meta.get("openai:gpt-5.1-mini");
		expect(mini?.contextWindow).toBe(400_000);
		expect(mini?.maxOutputTokens).toBe(128_000);
		expect(mini?.knowledgeCutoff).toBe("2024-10-01");
		expect(mini?.provider).toBe("openai");
	});

	it("modelForRole returns a handle and throws on an unknown role", () => {
		const catalog = createCatalog(config, makeHandle);
		const model = catalog.modelForRole("chat") as unknown as {
			provider: string;
			modelId: string;
		};
		expect(model.provider).toBe("anthropic");
		expect(model.modelId).toBe("claude-sonnet-4-5");
		expect(() => catalog.modelForRole("nope")).toThrow(/Unknown role/u);
	});

	it("metaForRole returns the role's metadata", () => {
		const catalog = createCatalog(config, makeHandle);
		expect(catalog.metaForRole("summarize")?.key).toBe("openai:gpt-5.1-mini");
		expect(catalog.metaForRole("summarize")?.contextWindow).toBe(400_000);
		expect(catalog.metaForRole("nope")).toBeUndefined();
	});

	it("exposes each role's description (defaulting to empty string)", () => {
		const catalog = createCatalog(config, makeHandle);
		expect(catalog.roles.chat?.description).toBe("Default chat model.");
		expect(catalog.roles.summarize?.description).toBe("");
	});

	it("calls the custom resolver once per provider+model pair", () => {
		const resolve: ModelResolver = vi.fn(makeHandle);
		createCatalog(config, resolve);

		expect(resolve).toHaveBeenCalledTimes(3);
		expect(resolve).toHaveBeenCalledWith("openai", "gpt-5.1-mini");
		expect(resolve).toHaveBeenCalledWith("anthropic", "claude-sonnet-4-5");
		expect(resolve).toHaveBeenCalledWith("ollama", "qwen3.6:35b");
	});

	it("model(key) resolves an explicit address, including ids with colons", () => {
		const catalog = createCatalog(config, makeHandle);
		const model = catalog.model("ollama:qwen3.6:35b") as unknown as {
			modelId: string;
		};
		expect(model.modelId).toBe("qwen3.6:35b");
		expect(() => catalog.model("openai:nope")).toThrow(/Unknown model/u);
	});
});
