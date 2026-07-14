// Copyright 2026 Shinsuke Mori
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";

import { type Catalog, createCatalog } from "../src/catalog.ts";
import { Config } from "../src/schema.ts";

// Records the URL and headers of every request; replies with a canned 500 that
// ends the call — we only care about what would have hit the wire.
function recordingFetch(): { calls: { url: string; headers: Headers }[]; fetch: typeof fetch } {
	const calls: { url: string; headers: Headers }[] = [];
	const fetchImpl: typeof fetch = (input, init) => {
		calls.push({
			url: input instanceof Request ? input.url : input.toString(),
			headers: new Headers(input instanceof Request ? input.headers : init?.headers),
		});
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

describe("config headers and query on the wire", () => {
	it("gateway: merges gateway/backend headers, substitutes {apiKey}, appends query", async () => {
		const config = Config.parse({
			providers: [
				{
					id: "acme",
					gateway: {
						baseURL: "https://gateway.example.com/v1",
						apiKey: "gw-key", // inline so resolving needs no env var
						headers: { Authorization: "Bearer {apiKey}", "x-team-id": "platform" },
						query: { "api-version": "2026-01-01" },
						backends: {
							anthropic: {
								pathTemplate: "anthropic/{slug}",
								headers: { "x-team-id": "ml" }, // backend wins over the gateway value
							},
						},
					},
					models: [{ id: "claude-sonnet-4-6", backend: "anthropic", slug: "sonnet" }],
				},
			],
			roles: { chat: { provider: "acme", model: "claude-sonnet-4-6" } },
		});
		const { calls, fetch: baseFetch } = recordingFetch();
		const catalog = createCatalog(config, { fetch: baseFetch });

		await expect(doGenerate(catalog, "chat")).rejects.toThrow();

		expect(calls).toHaveLength(1);
		// Path rewritten first, then the query appended to the final gateway URL.
		expect(calls[0]?.url).toBe(
			"https://gateway.example.com/v1/anthropic/sonnet/messages?api-version=2026-01-01",
		);
		const headers = calls[0]?.headers;
		expect({
			authorization: headers?.get("authorization"), // {apiKey} substituted
			teamId: headers?.get("x-team-id"), // backend overrides gateway
			apiKeyHeader: headers?.get("x-api-key"), // vendor SDK default, untouched
		}).toStrictEqual({ authorization: "Bearer gw-key", teamId: "ml", apiKeyHeader: "gw-key" });
	});

	it("direct provider: sends configured headers and query alongside the vendor's own", async () => {
		const config = Config.parse({
			providers: [
				{
					id: "anthropic",
					baseURL: "https://proxy.example.com/anthropic",
					apiKey: "sk-123",
					headers: { "Ocp-Apim-Subscription-Key": "{apiKey}" },
					query: { "api-version": "2026-01-01" },
					models: [{ id: "claude-sonnet-5" }],
				},
			],
			roles: { chat: { provider: "anthropic", model: "claude-sonnet-5" } },
		});
		const { calls, fetch: baseFetch } = recordingFetch();
		const catalog = createCatalog(config, { fetch: baseFetch });

		await expect(doGenerate(catalog, "chat")).rejects.toThrow();

		expect(calls).toHaveLength(1);
		expect(calls[0]?.url).toBe(
			"https://proxy.example.com/anthropic/messages?api-version=2026-01-01",
		);
		expect(calls[0]?.headers.get("ocp-apim-subscription-key")).toBe("sk-123");
	});

	it("direct provider: a configured header overrides the vendor SDK's own", async () => {
		const config = Config.parse({
			providers: [
				{
					id: "anthropic",
					baseURL: "https://proxy.example.com/anthropic",
					apiKey: "placeholder", // would land in x-api-key, but the header below wins
					headers: { "x-api-key": "real-key" },
					models: [{ id: "claude-sonnet-5" }],
				},
			],
			roles: { chat: { provider: "anthropic", model: "claude-sonnet-5" } },
		});
		const { calls, fetch: baseFetch } = recordingFetch();
		const catalog = createCatalog(config, { fetch: baseFetch });

		await expect(doGenerate(catalog, "chat")).rejects.toThrow();

		expect(calls[0]?.headers.get("x-api-key")).toBe("real-key");
	});
});
