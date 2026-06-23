import { describe, expect, it, vi } from "vitest";

import { parseGatewayConfig } from "../src/config.ts";
import { createBodyModelFetch, createGeminiFetch, MODEL_SLUG_PLACEHOLDER } from "../src/fetch.ts";
import { createGatewayProvider } from "../src/provider.ts";
import type { GatewayConfig, GoogleBackend } from "../src/schema.ts";

const config = {
	baseURL: "https://gateway.example.com/v1",
	apiKey: "test-key",
	backends: {
		anthropic: { pathTemplate: "anthropic/{slug}" },
		openai: { pathTemplate: "openai/{slug}", api: "chat" },
		"openai-compatible": { pathTemplate: "compat/{slug}", name: "gateway" },
		mistral: { pathTemplate: "mistral/{slug}" },
		groq: { pathTemplate: "groq/{slug}" },
		google: {
			pathTemplate: "google/{slug}:{action}",
			actionMap: { streamGenerateContent: "customStreamGenerateContent" },
		},
	},
	models: [
		{ id: "claude-sonnet-4-6", backend: "anthropic" },
		{ id: "gpt-5.1", backend: "openai" },
		{ id: "llama-3.3-70b", backend: "openai-compatible" },
		{ id: "mistral-large-latest", backend: "mistral" },
		{ id: "moonshotai/kimi-k2", backend: "groq" },
		{ id: "gemini-2.5-pro", backend: "google", slug: "pro" },
	],
} satisfies GatewayConfig;

const googleBackend: GoogleBackend = {
	pathTemplate: "google/{slug}:{action}",
	actionMap: { streamGenerateContent: "customStreamGenerateContent" },
};

// Module-scope slug maps so tests stay free of inline conditionals.
const SLUGS: Record<string, string> = { "gpt-5.1": "gpt-mini", "gemini-2.5-pro": "pro" };
const slugFor = (model: string): string => SLUGS[model] ?? model;
const identitySlug = (model: string): string => model;

// Replaces globalThis.fetch with a recorder and returns the captured URLs.
// Each test calls this first, so no teardown hook is needed for isolation.
function recordFetch(): string[] {
	const calls: string[] = [];
	vi.stubGlobal("fetch", (input: string | URL | Request) => {
		calls.push(input instanceof Request ? input.url : input.toString());
		return Promise.resolve(new Response("{}", { status: 200 }));
	});
	return calls;
}

describe("createGatewayProvider", () => {
	it("routes the core backends (anthropic, openai, google) by model id", () => {
		const gateway = createGatewayProvider(config);
		expect(gateway("claude-sonnet-4-6").provider).toMatch(/anthropic/u);
		expect(gateway("gpt-5.1").provider).toMatch(/openai/u);
		expect(gateway("gemini-2.5-pro").provider).toMatch(/google/u);
	});

	it("routes the added backends (openai-compatible, mistral, groq) by model id", () => {
		const gateway = createGatewayProvider(config);
		expect(gateway("llama-3.3-70b").provider).toMatch(/gateway/u);
		expect(gateway("mistral-large-latest").provider).toMatch(/mistral/u);
		expect(gateway("moonshotai/kimi-k2").provider).toMatch(/groq/u);
	});

	it("exposes equivalent languageModel and chat surfaces", () => {
		const gateway = createGatewayProvider(config);
		expect(gateway.languageModel("claude-sonnet-4-6").modelId).toBe("claude-sonnet-4-6");
		expect(gateway.chat("gpt-5.1").modelId).toBe("gpt-5.1");
	});

	it("throws for a model id that is not in the config", () => {
		const gateway = createGatewayProvider(config);
		expect(() => gateway("nope")).toThrow(/Unknown model/u);
	});

	it("throws when a sub-provider's backend is not configured", () => {
		const gateway = createGatewayProvider({
			baseURL: "https://gateway.example.com",
			apiKey: "k",
			backends: { anthropic: { pathTemplate: "anthropic/{slug}" } },
			models: [{ id: "claude", backend: "anthropic" }],
		});
		expect(() => gateway.openai).toThrow(/openai/u);
	});
});

describe("createBodyModelFetch", () => {
	it("substitutes the model slug into a fixed-path URL read from the request body", async () => {
		const calls = recordFetch();
		const fetchImpl = createBodyModelFetch(slugFor);

		await fetchImpl(`https://gw/openai/${MODEL_SLUG_PLACEHOLDER}/chat/completions`, {
			method: "POST",
			body: JSON.stringify({ model: "gpt-5.1" }),
		});

		expect(calls[0]).toBe("https://gw/openai/gpt-mini/chat/completions");
	});

	it("passes the request through untouched when there is no placeholder", async () => {
		const calls = recordFetch();
		const fetchImpl = createBodyModelFetch(identitySlug);

		await fetchImpl("https://gw/health", { method: "GET" });

		expect(calls[0]).toBe("https://gw/health");
	});
});

describe("createGeminiFetch", () => {
	it("rewrites the models URL to the gateway layout, renames the action, and keeps the query", async () => {
		const calls = recordFetch();
		const fetchImpl = createGeminiFetch("https://gw/v1", googleBackend, slugFor);

		await fetchImpl(
			"https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:streamGenerateContent?alt=sse",
		);

		expect(calls[0]).toBe("https://gw/v1/google/pro:customStreamGenerateContent?alt=sse");
	});

	it("passes the method through unchanged when it is not in actionMap", async () => {
		const calls = recordFetch();
		const fetchImpl = createGeminiFetch("https://gw/v1", googleBackend, identitySlug);

		await fetchImpl(
			"https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent",
		);

		expect(calls[0]).toBe("https://gw/v1/google/gemini-2.5-pro:generateContent");
	});
});

describe("parseGatewayConfig", () => {
	it("accepts a valid config", () => {
		expect(() => parseGatewayConfig(config)).not.toThrow();
	});

	it("rejects a model whose backend is not configured", () => {
		expect(() =>
			parseGatewayConfig({
				baseURL: "https://gw",
				backends: { anthropic: { pathTemplate: "anthropic/{slug}" } },
				models: [{ id: "gpt", backend: "openai" }],
			}),
		).toThrow(/not configured/u);
	});

	it("rejects duplicate model ids", () => {
		expect(() =>
			parseGatewayConfig({
				baseURL: "https://gw",
				backends: { anthropic: { pathTemplate: "anthropic/{slug}" } },
				models: [
					{ id: "dup", backend: "anthropic" },
					{ id: "dup", backend: "anthropic" },
				],
			}),
		).toThrow(/Duplicate model id/u);
	});

	it("rejects a path template missing the {slug} placeholder", () => {
		expect(() =>
			parseGatewayConfig({
				baseURL: "https://gw",
				backends: { anthropic: { pathTemplate: "anthropic" } },
				models: [{ id: "claude", backend: "anthropic" }],
			}),
		).toThrow(/\{slug\}/u);
	});

	it("rejects a google template missing the {action} placeholder", () => {
		expect(() =>
			parseGatewayConfig({
				baseURL: "https://gw",
				backends: { google: { pathTemplate: "google/{slug}" } },
				models: [{ id: "gemini", backend: "google" }],
			}),
		).toThrow(/\{action\}/u);
	});
});
