import type { LanguageModel } from "ai";
import { describe, expect, it, vi } from "vitest";

import { createCatalog } from "../src/catalog.ts";
import { Config, type ProviderResolver } from "../src/schema.ts";

// Behavioral config: every provider is backed by a resolver override, so the
// catalog never touches a real SDK or the network for these tests.
const config = Config.parse({
	providers: [
		{
			id: "openai",
			models: [{ id: "gpt-5.1-mini", settings: { temperature: 0.7, maxOutputTokens: 128_000 } }],
		},
		{ id: "anthropic", models: [{ id: "claude-sonnet-4-5" }] },
		{ id: "ollama", models: [{ id: "qwen3.6:35b", api: "chat" }] },
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

// Resolver overrides that inject fake handles for every provider.
const fakeResolvers = (
	make: (providerId: string, modelId: string) => LanguageModel = makeHandle,
): Record<string, ProviderResolver> => ({
	openai: (id): LanguageModel => make("openai", id),
	anthropic: (id): LanguageModel => make("anthropic", id),
	ollama: (id): LanguageModel => make("ollama", id),
});

describe("createCatalog", () => {
	it("indexes every model by its provider:model key with metadata intact", () => {
		const catalog = createCatalog(config, { resolvers: fakeResolvers() });
		expect([...catalog.meta.keys()].toSorted()).toStrictEqual([
			"anthropic:claude-sonnet-4-5",
			"ollama:qwen3.6:35b",
			"openai:gpt-5.1-mini",
		]);

		const mini = catalog.meta.get("openai:gpt-5.1-mini");
		expect(mini?.settings).toStrictEqual({ temperature: 0.7, maxOutputTokens: 128_000 });
		expect(mini?.provider).toBe("openai");
	});

	it("modelForRole returns a handle and throws on an unknown role", () => {
		const catalog = createCatalog(config, { resolvers: fakeResolvers() });
		const model = catalog.modelForRole("chat") as unknown as { provider: string; modelId: string };
		expect(model.provider).toBe("anthropic");
		expect(model.modelId).toBe("claude-sonnet-4-5");
		expect(() => catalog.modelForRole("nope")).toThrow(/Unknown role/u);
	});

	it("metaForRole returns the role's metadata", () => {
		const catalog = createCatalog(config, { resolvers: fakeResolvers() });
		expect(catalog.metaForRole("summarize")?.key).toBe("openai:gpt-5.1-mini");
		expect(catalog.metaForRole("summarize")?.provider).toBe("openai");
		expect(catalog.metaForRole("nope")).toBeUndefined();
	});

	it("resolves lazily and passes each model's api to its provider's resolver", () => {
		const openai = vi.fn<ProviderResolver>((id) => makeHandle("openai", id));
		const anthropic = vi.fn<ProviderResolver>((id) => makeHandle("anthropic", id));
		const ollama = vi.fn<ProviderResolver>((id) => makeHandle("ollama", id));
		const catalog = createCatalog(config, { resolvers: { openai, anthropic, ollama } });

		// Nothing is resolved until a handle is actually requested.
		expect(openai).not.toHaveBeenCalled();

		catalog.model("openai:gpt-5.1-mini");
		catalog.model("anthropic:claude-sonnet-4-5");
		catalog.model("ollama:qwen3.6:35b");

		// Models with no `api` reach the resolver with undefined (vendor default).
		expect(openai).toHaveBeenCalledWith("gpt-5.1-mini", undefined);
		expect(anthropic).toHaveBeenCalledWith("claude-sonnet-4-5", undefined);
		// An explicit api is passed through so the resolver can pick the surface.
		expect(ollama).toHaveBeenCalledWith("qwen3.6:35b", "chat");
	});

	it("memoizes handles: a model is resolved once and the same handle is returned", () => {
		let calls = 0;
		const openai: ProviderResolver = (id) => {
			calls += 1;
			return makeHandle("openai", id);
		};
		const catalog = createCatalog(config, { resolvers: { ...fakeResolvers(), openai } });

		const first = catalog.model("openai:gpt-5.1-mini");
		const second = catalog.model("openai:gpt-5.1-mini");
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
		const catalog = createCatalog(config, { resolvers: fakeResolvers(make) });

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
						{ id: "gpt-5.1" },
						{
							id: "gpt-5.1-mini",
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
		const catalog = createCatalog(merged, { resolvers: fakeResolvers() });

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
		const catalog = createCatalog(config, { resolvers: fakeResolvers() });
		const model = catalog.model("ollama:qwen3.6:35b") as unknown as { modelId: string };
		expect(model.modelId).toBe("qwen3.6:35b");
		expect(() => catalog.model("openai:nope")).toThrow(/Unknown model/u);
	});

	it("throws for a provider that is neither a built-in vendor nor has a resolver", () => {
		const cfg = Config.parse({
			providers: [{ id: "ollama", models: [{ id: "qwen3.6:35b" }] }],
			roles: { local: { provider: "ollama", model: "qwen3.6:35b" } },
		});
		expect(() => createCatalog(cfg)).toThrow(/not a built-in vendor/u);
	});
});

describe("createCatalog with a direct vendor", () => {
	it("resolves a bare provider through its @ai-sdk vendor (vendor defaults to id)", () => {
		const cfg = Config.parse({
			providers: [{ id: "openai", apiKey: "test-key", models: [{ id: "gpt-5.1-mini" }] }],
			roles: { chat: { provider: "openai", model: "gpt-5.1-mini" } },
		});
		const catalog = createCatalog(cfg);
		const model = catalog.modelForRole("chat") as unknown as { modelId: string };
		expect(model.modelId).toBe("gpt-5.1-mini");
	});

	it("honors an explicit vendor different from the provider id", () => {
		const cfg = Config.parse({
			providers: [
				{
					id: "claude",
					vendor: "anthropic",
					apiKey: "test-key",
					models: [{ id: "claude-opus-4-6" }],
				},
			],
			roles: { chat: { provider: "claude", model: "claude-opus-4-6" } },
		});
		const catalog = createCatalog(cfg);
		const model = catalog.modelForRole("chat") as unknown as { modelId: string };
		expect(model.modelId).toBe("claude-opus-4-6");
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
					backends: { anthropic: { pathTemplate: "anthropic/{slug}" } },
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

	it("routes a gateway model to a real handle without a custom resolver", () => {
		const catalog = createCatalog(gatewayConfig);
		const model = catalog.modelForRole("chat") as unknown as { modelId: string };
		expect(model.modelId).toBe("claude-sonnet-4-6");
	});

	it("routes each gateway model to its backend's vendor", () => {
		const cfg = Config.parse({
			providers: [
				{
					id: "gw",
					gateway: {
						baseURL: "https://gw.example.com/v1",
						apiKey: "test-key",
						backends: {
							anthropic: { pathTemplate: "anthropic/{slug}" },
							openai: { pathTemplate: "gpt/{slug}" },
							google: { pathTemplate: "gemini/{slug}:{action}" },
						},
					},
					models: [
						{ id: "claude", backend: "anthropic" },
						{ id: "gpt", backend: "openai", api: "chat" },
						{ id: "gemini", backend: "google" },
					],
				},
			],
			roles: { a: { provider: "gw", model: "claude" } },
		});
		const catalog = createCatalog(cfg);
		const providerOf = (key: `${string}:${string}`): string =>
			(catalog.model(key) as unknown as { provider: string }).provider;
		expect(providerOf("gw:claude")).toMatch(/anthropic/u);
		expect(providerOf("gw:gpt")).toMatch(/openai/u);
		expect(providerOf("gw:gemini")).toMatch(/google/u);
	});

	it("exposes the backend's provider instance via provider(key)", () => {
		const catalog = createCatalog(gatewayConfig);
		const anthropic = catalog.provider<{ languageModel: unknown }>("acme:claude-sonnet-4-6");
		// The underlying @ai-sdk/anthropic instance, for provider-native features.
		expect(anthropic?.languageModel).toBeTypeOf("function");
	});
});

describe("catalog.provider(key)", () => {
	it("returns the vendor instance for a direct provider", () => {
		const cfg = Config.parse({
			providers: [{ id: "openai", apiKey: "test-key", models: [{ id: "gpt-5.1-mini" }] }],
			roles: { chat: { provider: "openai", model: "gpt-5.1-mini" } },
		});
		const catalog = createCatalog(cfg);
		const openai = catalog.provider<{ languageModel: unknown }>("openai:gpt-5.1-mini");
		expect(openai?.languageModel).toBeTypeOf("function");
	});

	it("returns undefined for a resolver-backed provider and for an unknown key", () => {
		const catalog = createCatalog(config, { resolvers: fakeResolvers() });
		expect(catalog.provider("ollama:qwen3.6:35b")).toBeUndefined();
		expect(catalog.provider("openai:nope")).toBeUndefined();
	});
});
