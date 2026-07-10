import { describe, expect, it, vi } from "vitest";

import type { GoogleBackend } from "../src/backends.ts";
import { createBodyModelFetch, createGeminiFetch, MODEL_SLUG_PLACEHOLDER } from "../src/fetch.ts";

const googleBackend: GoogleBackend = {
	pathTemplate: "google/{slug}:{action}",
	actionMap: { streamGenerateContent: "customStreamGenerateContent" },
};

// Module-scope slug maps so tests stay free of inline conditionals.
const SLUGS: Record<string, string> = { "gpt-5.6": "gpt-mini", "gemini-3.5-flash": "flash" };
const slugFor = (model: string): string => SLUGS[model] ?? model;
const identitySlug = (model: string): string => model;

// Replaces globalThis.fetch with a recorder and returns the captured URLs.
function recordFetch(): string[] {
	const calls: string[] = [];
	vi.stubGlobal("fetch", (input: string | URL | Request) => {
		calls.push(input instanceof Request ? input.url : input.toString());
		return Promise.resolve(new Response("{}", { status: 200 }));
	});
	return calls;
}

// Records calls to a user-supplied fetch instead of globalThis.fetch.
function recorder(): { calls: { url: string; body?: BodyInit | null }[]; fetch: typeof fetch } {
	const calls: { url: string; body?: BodyInit | null }[] = [];
	const fetchImpl: typeof fetch = (input, init) => {
		calls.push({
			url: input instanceof Request ? input.url : input.toString(),
			body: init?.body,
		});
		return Promise.resolve(new Response("{}", { status: 200 }));
	};
	return { calls, fetch: fetchImpl };
}

describe("createBodyModelFetch", () => {
	it("substitutes the model slug into a fixed-path URL read from the request body", async () => {
		const calls = recordFetch();
		const fetchImpl = createBodyModelFetch(slugFor);

		await fetchImpl(`https://gw/openai/${MODEL_SLUG_PLACEHOLDER}/chat/completions`, {
			method: "POST",
			body: JSON.stringify({ model: "gpt-5.6" }),
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
		const fetchImpl = createGeminiFetch("https://gw/v1", googleBackend, { slugFor });

		await fetchImpl(
			"https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:streamGenerateContent?alt=sse",
		);

		expect(calls[0]).toBe("https://gw/v1/google/flash:customStreamGenerateContent?alt=sse");
	});

	it("passes the method through unchanged when it is not in actionMap", async () => {
		const calls = recordFetch();
		const fetchImpl = createGeminiFetch("https://gw/v1", googleBackend, {
			slugFor: identitySlug,
		});

		await fetchImpl(
			"https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent",
		);

		expect(calls[0]).toBe("https://gw/v1/google/gemini-3.5-flash:generateContent");
	});
});

describe("custom base fetch", () => {
	it("createBodyModelFetch routes the rewritten request through baseFetch, not the global", async () => {
		const globalCalls = recordFetch();
		const { calls, fetch: baseFetch } = recorder();
		const fetchImpl = createBodyModelFetch(slugFor, baseFetch);

		await fetchImpl(`https://gw/openai/${MODEL_SLUG_PLACEHOLDER}/chat/completions`, {
			method: "POST",
			body: JSON.stringify({ model: "gpt-5.6" }),
		});

		expect(calls[0]?.url).toBe("https://gw/openai/gpt-mini/chat/completions");
		expect(globalCalls).toHaveLength(0);
	});

	it("createBodyModelFetch uses baseFetch on the passthrough path too", async () => {
		const globalCalls = recordFetch();
		const { calls, fetch: baseFetch } = recorder();
		const fetchImpl = createBodyModelFetch(identitySlug, baseFetch);

		await fetchImpl("https://gw/health", { method: "GET" });

		expect(calls[0]?.url).toBe("https://gw/health");
		expect(globalCalls).toHaveLength(0);
	});

	it("createGeminiFetch hands baseFetch the final gateway URL and the untouched body", async () => {
		const globalCalls = recordFetch();
		const { calls, fetch: baseFetch } = recorder();
		const fetchImpl = createGeminiFetch("https://gw/v1", googleBackend, { slugFor, baseFetch });

		const body = JSON.stringify({ contents: [] });
		await fetchImpl(
			"https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent",
			{ method: "POST", body },
		);

		expect(calls[0]?.url).toBe("https://gw/v1/google/flash:generateContent");
		expect(calls[0]?.body).toBe(body);
		expect(globalCalls).toHaveLength(0);
	});
});
