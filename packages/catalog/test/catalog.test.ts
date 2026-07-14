import type { LanguageModel } from "ai";
import { describe, expect, it, vi } from "vitest";

import { createCatalog, type ModelEntry, type ProviderOverride } from "../src/catalog.ts";
import { Config } from "../src/schema.ts";

// Behavioral config: every provider is backed by a resolve override, so the
// catalog never touches a real SDK or the network for these tests.
const config = Config.parse({
	providers: [
		{
			id: "openai",
			models: [{ id: "gpt-5.6-luna", settings: { temperature: 0.7, maxOutputTokens: 128_000 } }],
		},
		{ id: "anthropic", models: [{ id: "claude-sonnet-5" }] },
		{ id: "ollama", models: [{ id: "qwen3.6:35b", api: "chat" }] },
	],
	roles: {
		chat: { provider: "anthropic", model: "claude-sonnet-5" },
		summarize: { provider: "openai", model: "gpt-5.6-luna" },
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

// Resolve overrides that inject fake handles for every provider.
const fakeOverrides = (
	make: (providerId: string, modelId: string) => LanguageModel = makeHandle,
): Record<string, ProviderOverride> => ({
	openai: { resolve: (m): LanguageModel => make("openai", m.id) },
	anthropic: { resolve: (m): LanguageModel => make("anthropic", m.id) },
	ollama: { resolve: (m): LanguageModel => make("ollama", m.id) },
});

describe("createCatalog", () => {
	it("indexes every model by its provider:model key with metadata intact", () => {
		const catalog = createCatalog(config, { providers: fakeOverrides() });
		expect([...catalog.meta.keys()].toSorted()).toStrictEqual([
			"anthropic:claude-sonnet-5",
			"ollama:qwen3.6:35b",
			"openai:gpt-5.6-luna",
		]);

		const mini = catalog.meta.get("openai:gpt-5.6-luna");
		expect(mini?.settings).toStrictEqual({ temperature: 0.7, maxOutputTokens: 128_000 });
		expect(mini?.provider).toBe("openai");
	});

	it("modelForRole returns a handle and throws on an unknown role", () => {
		const catalog = createCatalog(config, { providers: fakeOverrides() });
		const model = catalog.modelForRole("chat") as unknown as { provider: string; modelId: string };
		expect(model.provider).toBe("anthropic");
		expect(model.modelId).toBe("claude-sonnet-5");
		expect(() => catalog.modelForRole("nope")).toThrow(/Unknown role/u);
	});

	it("metaForRole returns the role's metadata", () => {
		const catalog = createCatalog(config, { providers: fakeOverrides() });
		expect(catalog.metaForRole("summarize")?.key).toBe("openai:gpt-5.6-luna");
		expect(catalog.metaForRole("summarize")?.provider).toBe("openai");
		expect(catalog.metaForRole("nope")).toBeUndefined();
	});

	it("resolves lazily and passes each model's full entry to its resolver", () => {
		const openai = vi.fn((m: ModelEntry) => makeHandle("openai", m.id));
		const anthropic = vi.fn((m: ModelEntry) => makeHandle("anthropic", m.id));
		const ollama = vi.fn((m: ModelEntry) => makeHandle("ollama", m.id));
		const catalog = createCatalog(config, {
			providers: {
				openai: { resolve: openai },
				anthropic: { resolve: anthropic },
				ollama: { resolve: ollama },
			},
		});

		// Nothing is resolved until a handle is actually requested.
		expect(openai).not.toHaveBeenCalled();

		catalog.model("openai:gpt-5.6-luna");
		catalog.model("anthropic:claude-sonnet-5");
		catalog.model("ollama:qwen3.6:35b");

		// The resolver receives the full model entry: id, key, api, settings, ...
		expect(openai).toHaveBeenCalledWith(
			expect.objectContaining({
				id: "gpt-5.6-luna",
				key: "openai:gpt-5.6-luna",
				settings: { temperature: 0.7, maxOutputTokens: 128_000 },
			}),
		);
		expect(anthropic).toHaveBeenCalledWith(
			expect.objectContaining({ id: "claude-sonnet-5", provider: "anthropic" }),
		);
		// An explicit api is part of the entry, so the resolver can pick the surface.
		expect(ollama).toHaveBeenCalledWith(
			expect.objectContaining({ id: "qwen3.6:35b", api: "chat" }),
		);
	});

	it("memoizes handles: a model is resolved once and the same handle is returned", () => {
		let calls = 0;
		const openai: ProviderOverride = {
			resolve: (m): LanguageModel => {
				calls += 1;
				return makeHandle("openai", m.id);
			},
		};
		const catalog = createCatalog(config, { providers: { ...fakeOverrides(), openai } });

		const first = catalog.model("openai:gpt-5.6-luna");
		const second = catalog.model("openai:gpt-5.6-luna");
		expect(second).toBe(first);
		expect(calls).toBe(1); // resolver invoked once, not per access
	});

	it("bakes config settings into the handle via middleware", () => {
		// Return stable references so we can detect wrapping by identity.
		const handles = new Map<string, LanguageModel>();
		const make = (providerId: string, modelId: string): LanguageModel => {
			const handle = makeHandle(providerId, modelId);
			handles.set(`${providerId}:${modelId}`, handle);
			return handle;
		};
		const catalog = createCatalog(config, { providers: fakeOverrides(make) });

		// Model with settings is wrapped -> a different object than the resolver returned.
		expect(catalog.model("openai:gpt-5.6-luna")).not.toBe(handles.get("openai:gpt-5.6-luna"));
		// Model without settings is returned untouched -> same reference.
		expect(catalog.model("anthropic:claude-sonnet-5")).toBe(
			handles.get("anthropic:claude-sonnet-5"),
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
						{ id: "gpt-5.6" },
						{
							id: "gpt-5.6-luna",
							settings: {
								temperature: 0.2,
								providerOptions: { openai: { parallelToolCalls: false } },
							},
						},
					],
				},
			],
			roles: { chat: { provider: "openai", model: "gpt-5.6" } },
		});
		const catalog = createCatalog(merged, { providers: fakeOverrides() });

		expect(catalog.meta.get("openai:gpt-5.6")?.settings).toStrictEqual({
			temperature: 0.7,
			maxOutputTokens: 128_000,
			providerOptions: { openai: { reasoningEffort: "low" } },
		});
		expect(catalog.meta.get("openai:gpt-5.6-luna")?.settings).toStrictEqual({
			temperature: 0.2, // model overrides
			maxOutputTokens: 128_000, // inherited
			providerOptions: { openai: { reasoningEffort: "low", parallelToolCalls: false } }, // merged
		});
	});

	it("model(key) resolves an explicit address, including ids with colons", () => {
		const catalog = createCatalog(config, { providers: fakeOverrides() });
		const model = catalog.model("ollama:qwen3.6:35b") as unknown as { modelId: string };
		expect(model.modelId).toBe("qwen3.6:35b");
		expect(() => catalog.model("openai:nope")).toThrow(/Unknown model/u);
	});

	it("resolves the string role shorthand, splitting at the first colon", () => {
		const shorthand = Config.parse({
			providers: [{ id: "ollama", models: [{ id: "qwen3.6:35b", api: "chat" }] }],
			roles: { local: "ollama:qwen3.6:35b" },
		});
		const catalog = createCatalog(shorthand, { providers: fakeOverrides() });
		expect(catalog.roles.local?.key).toBe("ollama:qwen3.6:35b");
		expect(catalog.metaForRole("local")?.id).toBe("qwen3.6:35b");
		const model = catalog.modelForRole("local") as unknown as { modelId: string };
		expect(model.modelId).toBe("qwen3.6:35b");
	});

	it("throws for a provider that is neither a built-in vendor nor has a resolve override", () => {
		const cfg = Config.parse({
			providers: [{ id: "ollama", models: [{ id: "qwen3.6:35b" }] }],
			roles: { local: { provider: "ollama", model: "qwen3.6:35b" } },
		});
		expect(() => createCatalog(cfg)).toThrow(/not a built-in vendor/u);
	});

	it("validates its input: raw objects work, invalid ones throw a prettified error", () => {
		const catalog = createCatalog({
			providers: [{ id: "openai", models: [{ id: "gpt-5.6" }] }],
			roles: { chat: { provider: "openai", model: "gpt-5.6" } },
		});
		expect(catalog.metaForRole("chat")?.id).toBe("gpt-5.6");
		expect(() => createCatalog({ providers: [], roles: {} })).toThrow(/✖/u);
	});
});

describe("catalog.provider(key)", () => {
	it("returns undefined for a resolver-backed provider and for an unknown key", () => {
		const catalog = createCatalog(config, { providers: fakeOverrides() });
		expect(catalog.provider("ollama:qwen3.6:35b")).toBeUndefined();
		expect(catalog.provider("openai:nope")).toBeUndefined();
	});
});
