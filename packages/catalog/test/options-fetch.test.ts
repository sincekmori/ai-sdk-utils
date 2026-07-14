// Copyright 2026 Shinsuke Mori
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";

import { type Catalog, createCatalog } from "../src/catalog.ts";
import { Config } from "../src/schema.ts";

const gatewayConfig = Config.parse({
	providers: [
		{
			id: "acme",
			gateway: {
				baseURL: "https://gateway.example.com/v1",
				apiKey: "test-key", // inline so resolving needs no env var
				backends: { anthropic: { vendor: "anthropic", pathTemplate: "anthropic/{slug}" } },
			},
			models: [{ id: "claude-sonnet-4-6", backend: "anthropic", slug: "sonnet" }],
		},
	],
	roles: { chat: { provider: "acme", model: "claude-sonnet-4-6" } },
});

// Records URLs passed to options.fetch; replies with a canned 500 that ends the call.
function recordingFetch(): { calls: string[]; fetch: typeof fetch } {
	const calls: string[] = [];
	const fetchImpl: typeof fetch = (input) => {
		calls.push(input instanceof Request ? input.url : input.toString());
		return Promise.resolve(
			Response.json({ type: "error", error: { message: "stop here" } }, { status: 500 }),
		);
	};
	return { calls, fetch: fetchImpl };
}

// A model handle's raw generate call — enough to put a request on the wire.
function doGenerate(catalog: Catalog, role: string): Promise<unknown> {
	const model = catalog.modelForRole(role) as unknown as {
		doGenerate(options: unknown): Promise<unknown>;
	};
	return model.doGenerate({
		prompt: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
	});
}

describe("options.fetch", () => {
	it("sends gateway requests through options.fetch, after the path rewrite", async () => {
		const { calls, fetch: baseFetch } = recordingFetch();
		const catalog = createCatalog(gatewayConfig, { fetch: baseFetch });

		// The canned 500 ends the call; we only care about what hit the wire.
		await expect(doGenerate(catalog, "chat")).rejects.toThrow();

		expect(calls).toHaveLength(1);
		// The custom fetch sees the final gateway URL: slug substituted, no placeholder.
		expect(calls[0]).toContain("https://gateway.example.com/v1/anthropic/sonnet");
	});

	it("a per-provider fetch override wins over the global fetch", async () => {
		const global = recordingFetch();
		const local = recordingFetch();
		const catalog = createCatalog(gatewayConfig, {
			fetch: global.fetch,
			providers: { acme: { fetch: local.fetch } },
		});

		await expect(doGenerate(catalog, "chat")).rejects.toThrow();

		expect(local.calls).toHaveLength(1);
		expect(global.calls).toHaveLength(0);
	});
});
