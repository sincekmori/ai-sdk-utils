// Copyright 2026 Shinsuke Mori
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";

import buildCostsModule from "../scripts/generate-costs.ts";

// Behavioral tests for the snapshot generator itself (bucket renaming,
// modality filtering, ordering) against a small fixture — the committed
// costs.gen.ts is data, so its shape is checked separately in costs.test.ts.

/** A models.dev-shaped dump covering every bundled vendor. */
function fixture(anthropicModels: Record<string, unknown>): Record<string, unknown> {
	const empty = { models: {} };
	return {
		anthropic: { models: anthropicModels },
		openai: empty,
		mistral: empty,
		cohere: empty,
		groq: empty,
		xai: empty,
		deepseek: empty,
		perplexity: empty,
		google: empty,
	};
}

describe("buildCostsModule", () => {
	const source = buildCostsModule(
		fixture({
			"model-b": {
				cost: { input: 3, output: 15, cache_read: 0.3, cache_write: 3.75 },
				modalities: { output: ["text"] },
			},
			"model-a": { cost: { input: 1, output: 5 }, modalities: { output: ["text"] } },
			"model-tts": { cost: { input: 1, output: 5 }, modalities: { output: ["audio"] } },
			"model-free": { modalities: { output: ["text"] } },
		}),
	);

	it("renames buckets to camelCase and sorts models by id", () => {
		expect(source).toContain('"model-a": { input: 1, output: 5 },');
		expect(source).toContain(
			'"model-b": { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },',
		);
		expect(source.indexOf('"model-a"')).toBeLessThan(source.indexOf('"model-b"'));
	});

	it("skips non-text models, unpriced models, and vendors without sheets", () => {
		expect(source).not.toContain("model-tts"); // no text output -> skipped
		expect(source).not.toContain("model-free"); // no price -> skipped
		expect(source).not.toContain('"openai"'); // no sheets at all -> vendor omitted
	});

	it("fails on a missing vendor and on an unrealistic price", () => {
		expect(() => buildCostsModule({ anthropic: { models: {} } })).toThrow(/models\.dev has no/u);
		expect(() =>
			buildCostsModule(
				fixture({ pricey: { cost: { input: 1200 }, modalities: { output: ["text"] } } }),
			),
		).toThrow(/unrealistically large/u);
	});
});
