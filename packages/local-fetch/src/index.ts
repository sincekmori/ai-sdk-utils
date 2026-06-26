// Copyright 2026 Shinsuke Mori
// SPDX-License-Identifier: Apache-2.0

import {
	convertToModelMessages,
	createUIMessageStreamResponse,
	type LanguageModel,
	streamText,
	toUIMessageStream,
	type UIMessage,
} from "ai";

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
 * Options for building the UI message stream `Response`.
 *
 * Combines the options of the standalone `toUIMessageStream` helper (stream
 * shaping: `sendReasoning`, `onError`, ...) and `createUIMessageStreamResponse`
 * (the HTTP response: `status`, `headers`, ...), minus the `stream` they each
 * receive internally. Derived from the `ai` package so it stays in sync.
 */
export type ToUIMessageStreamResponseOptions = Omit<
	Parameters<typeof toUIMessageStream>[0],
	"stream"
> &
	Omit<Parameters<typeof createUIMessageStreamResponse>[0], "stream">;

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
	 * Options for the UI message stream `Response` (stream shaping + HTTP init).
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
 *     instructions: "You are a helpful assistant.",
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

		// Non-deprecated v7 path: shape the stream with the standalone
		// `toUIMessageStream`, then wrap it with `createUIMessageStreamResponse`.
		// Each helper reads only the options it knows; the rest are ignored.
		const options = toUIMessageStreamResponseOptions ?? {};
		return createUIMessageStreamResponse({
			...options,
			stream: toUIMessageStream({ ...options, stream: result.stream }),
		});
	};
