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
interface RawVendor {
	id?: string;
	baseURL?: string;
	apiKey?: unknown;
	headers?: Record<string, unknown>;
	query?: Record<string, string>;
}
interface RawGateway {
	baseURL?: string;
	apiKey?: unknown;
	headers?: Record<string, unknown>;
	query?: Record<string, string>;
	backends: Record<string, Record<string, unknown>>;
}
interface RawProvider {
	id: string;
	vendor?: string | RawVendor;
	gateway?: RawGateway;
	models: RawModel[];
}
interface RawConfig {
	providers: RawProvider[];
	roles: Record<string, string | { provider: string; model: string }>;
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
				backends: { anthropic: { vendor: "anthropic", pathTemplate: "anthropic/{slug}" } },
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

// The gateway block of the second provider, known to exist in `valid`.
// eslint-disable-next-line typescript/no-non-null-assertion -- the fixture always has it
const gatewayOf = (config: RawConfig): RawGateway => config.providers[1].gateway!;

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

	it("rejects unknown keys instead of silently dropping them", () => {
		const bad = clone(valid) as RawConfig & {
			providers: (RawProvider & Record<string, unknown>)[];
		};
		bad.providers[0].apiKeyEnvVarName = "OPENAI_API_KEY"; // pre-0.7 field
		expect(errorOf(bad)).toContain("apiKeyEnvVarName");
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
		bad.roles.chat = { provider: "mistral", model: "claude-sonnet-5" };
		expect(errorOf(bad)).toContain("unknown provider");
	});

	it("invariant 3b: rejects a role referencing an unknown model", () => {
		const bad = clone(valid);
		bad.roles.chat = { provider: "acme", model: "claude-ghost" };
		expect(errorOf(bad)).toContain("unknown model");
	});

	it('invariant 4: rejects ":" in a provider id (it would break the role shorthand)', () => {
		const bad = clone(valid);
		bad.providers[0].id = "open:ai";
		bad.roles.summarize = { provider: "open:ai", model: "gpt-5.6" };
		expect(errorOf(bad)).toContain('must not contain ":"');
	});

	// --- Roles: string shorthand and object form ------------------------------

	it("accepts the string shorthand and splits it at the first colon", () => {
		const ok = clone(valid);
		ok.roles.chat = "acme:claude-sonnet-5";
		expect(errorOf(ok)).toBe("");
	});

	it("validates the shorthand's target like the object form", () => {
		const bad = clone(valid);
		bad.roles.chat = "acme:claude-ghost";
		expect(errorOf(bad)).toContain("unknown model");
		const badProvider = clone(valid);
		badProvider.roles.chat = "mistral:claude-sonnet-5";
		expect(errorOf(badProvider)).toContain("unknown provider");
	});

	it("rejects a shorthand with no colon", () => {
		const bad = clone(valid);
		bad.roles.chat = "claude-sonnet-5";
		expect(errorOf(bad)).not.toBe("");
	});

	// --- Vendor / gateway coherence ----------------------------------------

	it("requires a backend on a gateway provider's models", () => {
		const bad = clone(valid);
		delete bad.providers[1].models[0].backend;
		expect(errorOf(bad)).toContain('must set a "backend"');
	});

	it("rejects a backend key not configured in the gateway block", () => {
		const bad = clone(valid);
		bad.providers[1].models[0].backend = "openai";
		expect(errorOf(bad)).toContain("is not configured");
	});

	it("rejects a backend on a plain (non-gateway) provider", () => {
		const bad = clone(valid);
		bad.providers[0].models[0].backend = "openai";
		expect(errorOf(bad)).toContain('has no "gateway" block');
	});

	it("rejects vendor alongside a gateway block", () => {
		const bad = clone(valid);
		bad.providers[1].vendor = "anthropic";
		expect(errorOf(bad)).toContain('both "vendor" and "gateway"');
	});

	it("requires baseURL for a direct openai-compatible provider", () => {
		const bad: RawConfig = {
			providers: [{ id: "compat", vendor: "openai-compatible", models: [{ id: "m" }] }],
			roles: { r: { provider: "compat", model: "m" } },
		};
		expect(errorOf(bad)).toContain("baseURL");
	});

	// --- Headers / query ------------------------------------------------------

	it("accepts headers and query on a vendor block, a gateway, and a backend", () => {
		const ok = clone(valid);
		ok.providers[0].vendor = {
			apiKey: { envVarName: "OPENAI_API_KEY" },
			headers: {
				"x-team-id": "platform",
				"api-key": "{apiKey}",
				"Ocp-Apim-Subscription-Key": { envVarName: "APIM_KEY" },
			},
			query: { "api-version": "2026-01-01" },
		};
		const gateway = gatewayOf(ok);
		gateway.apiKey = { envVarName: "ACME_API_KEY" };
		gateway.headers = { Authorization: "Bearer {apiKey}" };
		gateway.query = { "api-version": "2026-01-01" };
		gateway.backends.anthropic.headers = { "x-route": "anthropic" };
		expect(errorOf(ok)).toBe("");
	});

	it("rejects {apiKey} in a vendor block's headers without a key to substitute", () => {
		const bad = clone(valid);
		bad.providers[0].vendor = { headers: { Authorization: "Bearer {apiKey}" } };
		expect(errorOf(bad)).toContain("{apiKey}");
	});

	// --- Gateway backends -----------------------------------------------------

	it("rejects a gateway pathTemplate missing the {slug} placeholder", () => {
		const bad = clone(valid);
		gatewayOf(bad).backends.anthropic.pathTemplate = "anthropic/fixed";
		expect(errorOf(bad)).toContain("{slug}");
	});

	it('requires {action} in a "google" backend\'s pathTemplate', () => {
		const bad = clone(valid);
		gatewayOf(bad).backends.anthropic = { vendor: "google", pathTemplate: "google/{slug}" };
		expect(errorOf(bad)).toContain("{action}");
	});

	it('rejects actionMap on a non-"google" backend', () => {
		const bad = clone(valid);
		gatewayOf(bad).backends.anthropic.actionMap = { a: "b" };
		expect(errorOf(bad)).toContain("actionMap");
	});

	it("rejects a backend without a vendor", () => {
		const bad = clone(valid);
		delete gatewayOf(bad).backends.anthropic.vendor;
		expect(errorOf(bad)).toContain("vendor");
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
