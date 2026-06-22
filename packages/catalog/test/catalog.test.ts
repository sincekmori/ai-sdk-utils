import type { LanguageModel } from "ai";
import { describe, expect, it, vi } from "vitest";

import { createCatalog, type ModelResolver } from "../src/catalog.ts";
import { Config } from "../src/schema.ts";

const config = Config.parse({
	providers: [
		{
			id: "openai",
			models: [
				{
					id: "gpt-5.1-mini",
					type: "default",
					settings: { temperature: 0.7, maxOutputTokens: 128_000 },
				},
			],
		},
		{
			id: "anthropic",
			models: [{ id: "claude-sonnet-4-5", type: "default" }],
		},
		{
			id: "ollama",
			models: [{ id: "qwen3.6:35b", type: "chat" }],
		},
	],
	roles: {
		chat: { provider: "anthropic", model: "claude-sonnet-4-5" },
		summarize: { provider: "openai", model: "gpt-5.1-mini" },
		local: { provider: "ollama", model: "qwen3.6:35b" },
	},
});

// A fake handle so no network call is ever made; tagged so we can identify it.
// specificationVersion "v3" so withSettings will wrap it when settings exist.
const makeHandle = (providerId: string, modelId: string): LanguageModel =>
	({
		specificationVersion: "v3",
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
		expect(mini?.type).toBe("default");
		expect(mini?.settings).toStrictEqual({ temperature: 0.7, maxOutputTokens: 128_000 });
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
		expect(catalog.metaForRole("summarize")?.type).toBe("default");
		expect(catalog.metaForRole("nope")).toBeUndefined();
	});

	it("passes each model's type to the resolver", () => {
		const resolve: ModelResolver = vi.fn(makeHandle);
		createCatalog(config, resolve);

		expect(resolve).toHaveBeenCalledTimes(3);
		expect(resolve).toHaveBeenCalledWith("openai", "gpt-5.1-mini", "default");
		expect(resolve).toHaveBeenCalledWith("anthropic", "claude-sonnet-4-5", "default");
		// "chat" models reach the resolver so it can call provider.chat(modelId).
		expect(resolve).toHaveBeenCalledWith("ollama", "qwen3.6:35b", "chat");
	});

	it("bakes config settings into the handle via middleware", () => {
		// Return stable references so we can detect wrapping by identity.
		const handles = new Map<string, LanguageModel>();
		const resolve: ModelResolver = (providerId, modelId) => {
			const key = `${providerId}:${modelId}`;
			const handle = makeHandle(providerId, modelId);
			handles.set(key, handle);
			return handle;
		};
		const catalog = createCatalog(config, resolve);

		// Model with settings is wrapped -> a different object than the resolver returned.
		expect(catalog.model("openai:gpt-5.1-mini")).not.toBe(handles.get("openai:gpt-5.1-mini"));
		// Model without settings is returned untouched -> same reference.
		expect(catalog.model("anthropic:claude-sonnet-4-5")).toBe(
			handles.get("anthropic:claude-sonnet-4-5"),
		);
	});

	it("merges provider-level default settings with the model's own (model wins)", () => {
		const merged = Config.parse({
			providers: [
				{
					id: "openai",
					settings: {
						temperature: 0.7,
						maxOutputTokens: 128_000,
						providerOptions: { openai: { reasoningEffort: "low" } },
					},
					models: [
						// inherits provider defaults as-is
						{ id: "gpt-5.1", type: "default" },
						// overrides temperature; merges providerOptions; keeps maxOutputTokens
						{
							id: "gpt-5.1-mini",
							type: "default",
							settings: {
								temperature: 0.2,
								providerOptions: { openai: { parallelToolCalls: false } },
							},
						},
					],
				},
			],
			roles: { chat: { provider: "openai", model: "gpt-5.1" } },
		});
		const catalog = createCatalog(merged, makeHandle);

		expect(catalog.meta.get("openai:gpt-5.1")?.settings).toStrictEqual({
			temperature: 0.7,
			maxOutputTokens: 128_000,
			providerOptions: { openai: { reasoningEffort: "low" } },
		});
		expect(catalog.meta.get("openai:gpt-5.1-mini")?.settings).toStrictEqual({
			temperature: 0.2, // model overrides
			maxOutputTokens: 128_000, // inherited
			providerOptions: { openai: { reasoningEffort: "low", parallelToolCalls: false } }, // merged
		});
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
