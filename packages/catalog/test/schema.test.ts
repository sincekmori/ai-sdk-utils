import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import buildConfigJsonSchema from "../scripts/generate-schema.ts";
import { createCatalog } from "../src/catalog.ts";
import { Config } from "../src/schema.ts";

// Loosely typed shapes so negative tests can mutate freely and indexing never
// produces cross-shape unions. The real validation happens in createCatalog.
interface RawModel {
	id: string;
	api?: string;
	backend?: string;
	slug?: string;
	settings?: Record<string, unknown>;
}
interface RawProvider {
	id: string;
	vendor?: string;
	baseURL?: string;
	gateway?: Record<string, unknown>;
	models: RawModel[];
}
interface RawConfig {
	providers: RawProvider[];
	roles: Record<string, { provider: string; model: string }>;
}

// A minimal, fully valid config reused across tests: one plain provider and one
// gateway provider.
const valid: RawConfig = {
	providers: [
		{
			id: "openai",
			models: [{ id: "gpt-5.6", settings: { temperature: 0.7, maxOutputTokens: 128_000 } }],
		},
		{
			id: "acme",
			gateway: {
				baseURL: "https://gateway.example.com/v1",
				backends: { anthropic: { pathTemplate: "anthropic/{slug}" } },
			},
			models: [{ id: "claude-sonnet-5", backend: "anthropic" }],
		},
	],
	roles: {
		chat: { provider: "acme", model: "claude-sonnet-5" },
		summarize: { provider: "openai", model: "gpt-5.6" },
	},
};

const clone = <T>(value: T): T => structuredClone(value);

// The validation error message for `data`, or "" if it validated.
const errorOf = (data: unknown): string => {
	try {
		createCatalog(data as Config);
		return "";
	} catch (error) {
		return (error as Error).message;
	}
};

describe("config schema", () => {
	it("parses a valid config", () => {
		expect(() => Config.parse(valid)).not.toThrow();
	});

	it("keeps call settings on the model", () => {
		const parsed = Config.parse(valid);
		expect(parsed.providers[0]?.models[0]?.settings).toStrictEqual({
			temperature: 0.7,
			maxOutputTokens: 128_000,
		});
	});

	it("allows omitting settings", () => {
		const parsed = Config.parse(valid);
		expect(parsed.providers[1]?.models[0]?.settings).toBeUndefined();
	});

	it("rejects an unknown api value", () => {
		const bad = clone(valid);
		bad.providers[0].models[0].api = "bogus";
		expect(errorOf(bad)).not.toBe("");
	});

	// --- Invariants ---------------------------------------------------------

	it("invariant 1: rejects duplicate provider ids", () => {
		const bad = clone(valid);
		bad.providers.push(clone(valid.providers[0]));
		expect(errorOf(bad)).toContain("Duplicate provider id");
	});

	it("invariant 2: rejects duplicate model ids within a provider", () => {
		const bad = clone(valid);
		bad.providers[0].models.push(clone(valid.providers[0].models[0]));
		expect(errorOf(bad)).toContain("Duplicate model id");
	});

	it("invariant 3a: rejects a role referencing an unknown provider", () => {
		const bad = clone(valid);
		bad.roles.chat.provider = "mistral";
		expect(errorOf(bad)).toContain("unknown provider");
	});

	it("invariant 3b: rejects a role referencing an unknown model", () => {
		const bad = clone(valid);
		bad.roles.chat.model = "claude-ghost";
		expect(errorOf(bad)).toContain("unknown model");
	});

	// --- Gateway / backend coherence ----------------------------------------

	it("requires a backend on a gateway provider's models", () => {
		const bad = clone(valid);
		delete bad.providers[1].models[0].backend;
		expect(errorOf(bad)).toContain('must set a "backend"');
	});

	it("rejects a backend not configured in the gateway block", () => {
		const bad = clone(valid);
		bad.providers[1].models[0].backend = "openai";
		expect(errorOf(bad)).toContain("is not configured");
	});

	it("rejects a backend on a plain (non-gateway) provider", () => {
		const bad = clone(valid);
		bad.providers[0].models[0].backend = "openai";
		expect(errorOf(bad)).toContain('has no "gateway" block');
	});

	it("rejects direct-vendor fields alongside a gateway block", () => {
		const bad = clone(valid);
		bad.providers[1].baseURL = "https://elsewhere.example.com";
		expect(errorOf(bad)).toContain("baseURL");
	});

	it("requires baseURL for a direct openai-compatible provider", () => {
		const bad: RawConfig = {
			providers: [{ id: "compat", vendor: "openai-compatible", models: [{ id: "m" }] }],
			roles: { r: { provider: "compat", model: "m" } },
		};
		expect(errorOf(bad)).toContain("baseURL");
	});

	it("rejects a gateway pathTemplate missing the {slug} placeholder", () => {
		const bad = clone(valid);
		(
			bad.providers[1].gateway as { backends: Record<string, { pathTemplate: string }> }
		).backends.anthropic.pathTemplate = "anthropic/fixed";
		expect(errorOf(bad)).not.toBe("");
	});
});

describe("shipped examples and schema.json", () => {
	it.each([
		"./examples/ai-sdk-catalog.minimal.json",
		"./examples/ai-sdk-catalog.standard.json",
		"./examples/ai-sdk-catalog.advanced.json",
	])("%s builds a catalog as-is", async (path) => {
		const raw: unknown = JSON.parse(await readFile(path, "utf8"));
		const catalog = createCatalog(raw as Config);
		expect(catalog.meta.size).toBeGreaterThan(0);
		expect(catalog.roles.chat).toBeDefined();
	});

	it("keeps the shipped schema.json in sync with the Zod schema", async () => {
		// schema.json is committed (and published) so `$schema` pointers resolve;
		// this guards it against drifting from src/schema.ts. Regenerate with
		// `pnpm generate-schema && pnpm format` — formatting-only differences
		// don't matter here because both sides are compared parsed.
		const committed: unknown = JSON.parse(await readFile("./schema.json", "utf8"));
		expect(committed).toStrictEqual(buildConfigJsonSchema());
	});
});
