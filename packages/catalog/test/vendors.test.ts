// Copyright 2026 Shinsuke Mori
// SPDX-License-Identifier: Apache-2.0

import type { LanguageModel } from "ai";
import { describe, expect, it } from "vitest";

import type { ModelApi } from "../src/schema.ts";
import { type Vendor, VendorSchema } from "../src/vendor-ids.ts";
import { callSurface, createVendor, type VendorProvider } from "../src/vendors.ts";

// A fake provider whose surfaces tag their return value, so we can assert which
// one callSurface picked without any network.
const tagged = (surface: string): LanguageModel => ({ surface }) as unknown as LanguageModel;

const surfaceOf = (model: LanguageModel): string =>
	(model as unknown as { surface: string }).surface;

// OpenAI-like: every surface present.
const openaiLike: VendorProvider = {
	languageModel: () => tagged("languageModel"),
	chat: () => tagged("chat"),
	responses: () => tagged("responses"),
	completion: () => tagged("completion"),
};

// OpenAI-compatible-like: only languageModel (= chat) and completionModel.
const compatibleLike: VendorProvider = {
	languageModel: () => tagged("languageModel"),
	completionModel: () => tagged("completionModel"),
};

// Single-surface vendor (e.g. anthropic).
const singleSurface: VendorProvider = { languageModel: () => tagged("languageModel") };

// xAI-like: names a responses surface (its default) but no chat one.
const responsesOnly: VendorProvider = {
	languageModel: () => tagged("languageModel"),
	responses: () => tagged("responses"),
};

describe("callSurface", () => {
	it("uses the vendor default surface when api is omitted", () => {
		expect(surfaceOf(callSurface(openaiLike, "m"))).toBe("languageModel");
	});

	it("selects responses / chat / completion when asked", () => {
		expect(surfaceOf(callSurface(openaiLike, "m", "responses"))).toBe("responses");
		expect(surfaceOf(callSurface(openaiLike, "m", "chat"))).toBe("chat");
		expect(surfaceOf(callSurface(openaiLike, "m", "completion"))).toBe("completion");
	});

	it("maps chat to languageModel when the vendor has no chat surface", () => {
		// OpenAI-compatible's default surface IS Chat Completions.
		expect(surfaceOf(callSurface(compatibleLike, "m", "chat"))).toBe("languageModel");
	});

	it("falls back to completionModel for completion", () => {
		expect(surfaceOf(callSurface(compatibleLike, "m", "completion"))).toBe("completionModel");
	});

	it("throws when a requested surface is unavailable", () => {
		expect(() => callSurface(singleSurface, "m", "responses")).toThrow(/responses/u);
		expect(() => callSurface(singleSurface, "m", "completion")).toThrow(/completion/u);
	});

	it("rejects chat on a Responses-only vendor instead of falling back to its default", () => {
		expect(() => callSurface(responsesOnly, "m", "chat")).toThrow(/api "chat" is not available/u);
		expect(surfaceOf(callSurface(responsesOnly, "m", "responses"))).toBe("responses");
		expect(surfaceOf(callSurface(responsesOnly, "m"))).toBe("languageModel");
	});
});

// Pins what the REAL bundled SDKs resolve to. A dependency bump that adds or
// removes a surface, or moves a vendor's default to another API, fails here
// instead of silently changing which API a configured model talks to.

// Each SDK names the API a handle speaks in its `provider` string.
const resolved = (vendor: Vendor, api?: ModelApi): string => {
	const options = { apiKey: "test-key", baseURL: "http://localhost:9999/v1" };
	const handle = callSurface(createVendor(vendor, options), "m", api);
	return (handle as unknown as { provider: string }).provider;
};

const defaults: Record<Vendor, string> = {
	anthropic: "anthropic.messages",
	openai: "openai.responses",
	"openai-compatible": "openai-compatible.chat",
	mistral: "mistral.chat",
	cohere: "cohere.chat",
	groq: "groq.chat",
	xai: "xai.responses",
	deepseek: "deepseek.chat",
	perplexity: "perplexity",
	google: "google.generative-ai",
};

// Vendors with one surface: `chat` is just another name for it.
const singleSurfaceVendors = VendorSchema.options.filter(
	(vendor) => vendor !== "openai" && vendor !== "xai",
);

describe("callSurface on the bundled SDKs", () => {
	it.each(VendorSchema.options)(
		"%s: omitting api reaches the vendor's default surface",
		(vendor) => {
			expect(resolved(vendor)).toBe(defaults[vendor]);
		},
	);

	it("openai serves every surface by name", () => {
		expect(resolved("openai", "chat")).toBe("openai.chat");
		expect(resolved("openai", "responses")).toBe("openai.responses");
		expect(resolved("openai", "completion")).toBe("openai.completion");
	});

	it("xai implements the Responses API only, so chat is rejected", () => {
		expect(resolved("xai", "responses")).toBe("xai.responses");
		expect(() => resolved("xai", "chat")).toThrow(/api "chat" is not available/u);
	});

	it.each(singleSurfaceVendors)("%s: chat resolves to its one surface", (vendor) => {
		expect(resolved(vendor, "chat")).toBe(defaults[vendor]);
	});
});
