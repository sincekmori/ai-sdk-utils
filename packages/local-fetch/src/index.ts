// Copyright 2026 Shinsuke Mori
// SPDX-License-Identifier: Apache-2.0

import { convertToModelMessages, type LanguageModel, streamText, type UIMessage } from "ai";

type FetchFunction = typeof globalThis.fetch;

/**
 * Options passed to `streamText`.
 */
export type StreamTextOptions = {
	model: LanguageModel;
} & Omit<Parameters<typeof streamText>[0], "model" | "messages" | "prompt">;

/**
 * Options passed to `convertToModelMessages`.
 *
 * Mirrors the second parameter of `convertToModelMessages` but is kept as a
 * standalone exported type so callers can reference it without importing from
 * the `ai` package directly.
 */
export type ConvertToModelMessagesOptions = NonNullable<
	Parameters<typeof convertToModelMessages>[1]
>;

/**
 * Options passed to `result.toUIMessageStreamResponse()`.
 *
 * Derived from the first parameter of `toUIMessageStreamResponse` so it stays
 * in sync with the `ai` package automatically.
 */
export type ToUIMessageStreamResponseOptions = NonNullable<
	Parameters<ReturnType<typeof streamText>["toUIMessageStreamResponse"]>[0]
>;

export type LocalFetchOptions = {
	/**
	 * Options forwarded to `streamText`, including the required `model`.
	 */
	streamTextOptions: StreamTextOptions;
	/**
	 * Options forwarded to `convertToModelMessages`.
	 *
	 * `tools` defaults to `streamTextOptions.tools` when omitted, so you
	 * rarely need to set it explicitly.
	 */
	convertToModelMessagesOptions?: ConvertToModelMessagesOptions;
	/**
	 * Options forwarded to `result.toUIMessageStreamResponse()`.
	 */
	toUIMessageStreamResponseOptions?: ToUIMessageStreamResponseOptions;
};

/**
 * Creates a fetch-compatible function that executes `streamText` locally
 * using the provided `LanguageModel`, instead of making an HTTP request
 * to a server endpoint.
 *
 * Useful when the user supplies their own API key and no backend is available.
 *
 * @example
 * ```ts
 * import { createLocalFetch } from "ai-sdk-local-fetch";
 * import { openai } from "@ai-sdk/openai";
 *
 * const fetch = createLocalFetch({
 *   streamTextOptions: {
 *     model: openai("gpt-5.2-chat"),
 *     system: "You are a helpful assistant.",
 *     tools: { myTool }, // automatically forwarded to convertToModelMessages too
 *   },
 * });
 * ```
 */
export const createLocalFetch =
	({
		streamTextOptions,
		convertToModelMessagesOptions,
		toUIMessageStreamResponseOptions,
	}: LocalFetchOptions): FetchFunction =>
	async (_input: string | URL | Request, init?: RequestInit): Promise<Response> => {
		if (init?.body === undefined || init.body === null || typeof init.body !== "string") {
			throw new Error("[ai-sdk-local-fetch] init.body must be a non-empty string.");
		}

		const { messages } = JSON.parse(init.body) as { messages: UIMessage[] };

		const result = streamText({
			...streamTextOptions,
			messages: await convertToModelMessages(messages, {
				tools: streamTextOptions.tools,
				...convertToModelMessagesOptions,
			}),
		});

		return result.toUIMessageStreamResponse(toUIMessageStreamResponseOptions);
	};
