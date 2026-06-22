import type { LanguageModel } from "ai";
import { describe, expect, it, vi } from "vitest";

import { createLocalFetch } from "./index.js";

// ---------------------------------------------------------------------------
// Minimal LanguageModel stub
// ---------------------------------------------------------------------------
const mockStream = new ReadableStream({
	start(controller): void {
		controller.enqueue(new TextEncoder().encode(`0:"Hello"\n`));
		controller.close();
	},
});

const mockModel = {
	specificationVersion: "v2",
	provider: "mock",
	modelId: "mock-model",
	doStream: vi.fn().mockResolvedValue({
		stream: mockStream,
		rawCall: { rawPrompt: "", rawSettings: {} },
	}),
	doGenerate: vi.fn(),
} as unknown as LanguageModel;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const makeInit = (messages: unknown): RequestInit => ({
	method: "POST",
	body: JSON.stringify({ messages }),
});

// ai v6: UIMessage uses `parts` instead of `content`
const sampleMessages = [
	{
		id: "1",
		role: "user",
		parts: [{ type: "text", text: "Hello" }],
	},
];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("createLocalFetch", () => {
	it("returns a function", () => {
		const fetch = createLocalFetch({ streamTextOptions: { model: mockModel } });
		expect(fetch).toBeTypeOf("function");
	});

	it("throws when init.body is missing", async () => {
		const fetch = createLocalFetch({ streamTextOptions: { model: mockModel } });
		await expect(fetch("http://localhost/api/chat", {})).rejects.toThrow("[ai-sdk-local-fetch]");
	});

	it("throws when init.body is not a string", async () => {
		const fetch = createLocalFetch({ streamTextOptions: { model: mockModel } });
		await expect(
			fetch("http://localhost/api/chat", { method: "POST", body: new Blob() }),
		).rejects.toThrow("[ai-sdk-local-fetch]");
	});

	it("returns a Response for valid messages", async () => {
		const fetch = createLocalFetch({ streamTextOptions: { model: mockModel } });
		const response = await fetch("http://localhost/api/chat", makeInit(sampleMessages));
		expect(response).toBeInstanceOf(Response);
	});

	it("ignores the _input URL argument", async () => {
		const fetch = createLocalFetch({ streamTextOptions: { model: mockModel } });
		// should not throw regardless of the URL
		const response = await fetch(
			"https://any-url-is-ignored.example.com",
			makeInit(sampleMessages),
		);
		expect(response.ok).toBe(true);
	});
});
