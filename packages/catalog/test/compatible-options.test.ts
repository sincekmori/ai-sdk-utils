// Copyright 2026 Shinsuke Mori
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";

import { createCatalog } from "../src/catalog.ts";
import type { Config } from "../src/schema.ts";

// The openai-compatible-only SDK options (`supportsStructuredOutputs`,
// `includeUsage`, `name`): accepted from the config for that vendor — direct
// blocks and gateway backends alike — and rejected everywhere else.

// Records each request's JSON body; replies with a canned 500 that ends the call.
function bodyRecordingFetch(): { bodies: unknown[]; fetch: typeof fetch } {
	const bodies: unknown[] = [];
	const fetchImpl: typeof fetch = (_input, init) => {
		if (typeof init?.body === "string") {
			bodies.push(JSON.parse(init.body));
		}
		return Promise.resolve(Response.json({ error: { message: "stop here" } }, { status: 500 }));
	};
	return { bodies, fetch: fetchImpl };
}

const compatibleVendor = (flags: Record<string, boolean>): unknown => ({
	providers: [
		{
			id: "local",
			vendor: { id: "openai-compatible", baseURL: "http://localhost:9999/v1", ...flags },
			models: [{ id: "some-model" }],
		},
	],
	roles: {},
});

describe("openai-compatible options", () => {
	it("passes supportsStructuredOutputs through to the created model", () => {
		const catalog = createCatalog(compatibleVendor({ supportsStructuredOutputs: true }) as Config);
		const model = catalog.model("local:some-model") as unknown as {
			supportsStructuredOutputs: boolean;
		};
		expect(model.supportsStructuredOutputs).toBe(true);
	});

	it("defaults to the SDK's own value when the flag is not set", () => {
		const catalog = createCatalog(compatibleVendor({}) as Config);
		const model = catalog.model("local:some-model") as unknown as {
			supportsStructuredOutputs: boolean;
		};
		expect(model.supportsStructuredOutputs).toBe(false);
	});

	it("includeUsage puts stream_options.include_usage on streaming requests", async () => {
		const { bodies, fetch: baseFetch } = bodyRecordingFetch();
		const catalog = createCatalog(compatibleVendor({ includeUsage: true }) as Config, {
			fetch: baseFetch,
		});
		const model = catalog.model("local:some-model") as unknown as {
			doStream(options: unknown): Promise<unknown>;
		};
		await expect(
			model.doStream({ prompt: [{ role: "user", content: [{ type: "text", text: "hi" }] }] }),
		).rejects.toThrow();
		expect(bodies).toHaveLength(1);
		expect(bodies[0]).toMatchObject({ stream_options: { include_usage: true } });
	});

	it("a gateway backend forwards the flags to its sub-provider", () => {
		const catalog = createCatalog({
			providers: [
				{
					id: "acme",
					gateway: {
						baseURL: "https://gateway.example.com/v1",
						apiKey: "gw-key",
						backends: {
							fw: {
								vendor: "openai-compatible",
								pathTemplate: "fireworks/{slug}",
								supportsStructuredOutputs: true,
							},
						},
					},
					models: [{ id: "some-model", backend: "fw" }],
				},
			],
			roles: {},
		});
		const model = catalog.model("acme:some-model") as unknown as {
			supportsStructuredOutputs: boolean;
		};
		expect(model.supportsStructuredOutputs).toBe(true);
	});

	it("rejects the openai-compatible-only fields on another vendor", () => {
		for (const flags of [
			{ supportsStructuredOutputs: true },
			{ includeUsage: false },
			{ name: "nope" },
		]) {
			expect(() =>
				createCatalog({
					providers: [{ id: "anthropic", vendor: flags, models: [{ id: "claude-sonnet-5" }] }],
					roles: {},
				}),
			).toThrow(/applies only to the "openai-compatible" vendor/u);
		}
	});

	it("rejects the openai-compatible-only fields on another backend vendor", () => {
		expect(() =>
			createCatalog({
				providers: [
					{
						id: "acme",
						gateway: {
							baseURL: "https://gateway.example.com/v1",
							backends: {
								claude: {
									vendor: "anthropic",
									pathTemplate: "anthropic/{slug}",
									includeUsage: true,
								},
							},
						},
						models: [{ id: "claude-sonnet-5", backend: "claude" }],
					},
				],
				roles: {},
			}),
		).toThrow(/"includeUsage" applies only to an "openai-compatible" backend/u);
	});
});
