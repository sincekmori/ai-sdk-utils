import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { loadConfig, parseConfig, parseConfigString } from "../src/config.ts";
import { Config } from "../src/schema.ts";

// Loosely typed shapes so negative tests can mutate freely and indexing never
// produces cross-shape unions. The real validation happens in parseConfig.
interface RawModel {
	id: string;
	type: string;
	settings?: Record<string, unknown>;
}
interface RawConfig {
	providers: { id: string; models: RawModel[] }[];
	roles: Record<string, { provider: string; model: string }>;
}

// A minimal, fully valid config reused across tests.
const valid: RawConfig = {
	providers: [
		{
			id: "openai",
			models: [
				{
					id: "gpt-5.1",
					type: "chat",
					settings: { temperature: 0.7, maxOutputTokens: 128_000 },
				},
			],
		},
		{
			id: "anthropic",
			models: [{ id: "claude-sonnet-4-5", type: "default" }],
		},
	],
	roles: {
		chat: { provider: "anthropic", model: "claude-sonnet-4-5" },
		summarize: { provider: "openai", model: "gpt-5.1" },
	},
};

const clone = <T>(value: T): T => structuredClone(value);

// The validation error message for `data`, or "" if it validated.
const errorOf = (data: unknown): string => {
	try {
		parseConfig(data);
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

	it("accepts both model types (default and chat)", () => {
		const parsed = Config.parse(valid);
		expect(parsed.providers[0]?.models[0]?.type).toBe("chat");
		expect(parsed.providers[1]?.models[0]?.type).toBe("default");
	});

	it("rejects an unknown model type", () => {
		const bad = clone(valid);
		bad.providers[0].models[0].type = "completion";
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
});

describe("loadConfig", () => {
	it("reads and validates a .yaml file", async () => {
		const cfg = await loadConfig("./examples/models.yaml");
		expect(cfg.providers.length).toBeGreaterThan(0);
		expect(cfg.roles.chat).toBeDefined();
	});

	it("reads and validates a .json file", async () => {
		const dir = await mkdtemp(join(tmpdir(), "catalog-"));
		const file = join(dir, "models.json");
		await writeFile(file, JSON.stringify(valid), "utf8");
		const cfg = await loadConfig(file);
		expect(cfg.providers[0]?.id).toBe("openai");
	});

	it("throws a readable, path-tagged error on invalid config", async () => {
		const dir = await mkdtemp(join(tmpdir(), "catalog-"));
		const file = join(dir, "broken.yaml");
		await writeFile(file, "providers: []\nroles: {}\n", "utf8");
		await expect(loadConfig(file)).rejects.toThrow(file);
	});
});

describe("parseConfig (object) and parseConfigString (text)", () => {
	it("validates a plain object (browser-safe core)", () => {
		const cfg = parseConfig(valid);
		expect(cfg.roles.summarize?.provider).toBe("openai");
	});

	it("throws for an invalid object", () => {
		expect(() => parseConfig({ providers: [], roles: {} })).toThrow();
	});

	it("parses both YAML and JSON text", () => {
		const yamlCfg = parseConfigString(
			"providers:\n  - id: openai\n    models:\n      - id: gpt-5.1\n        type: chat\nroles:\n  chat: { provider: openai, model: gpt-5.1 }\n",
		);
		expect(yamlCfg.providers[0]?.id).toBe("openai");
		// YAML is a superset of JSON, so the same parser handles JSON too.
		const jsonCfg = parseConfigString(JSON.stringify(valid));
		expect(jsonCfg.providers[0]?.id).toBe("openai");
	});
});
