import type { LanguageModel } from "ai";
import { describe, expect, it } from "vitest";

import { callSurface, type VendorProvider } from "../src/vendors.ts";

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
});
