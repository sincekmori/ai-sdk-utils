// Copyright 2026 Shinsuke Mori
// SPDX-License-Identifier: Apache-2.0

import { type LanguageModel, streamText } from "ai";

/**
 * Options for {@link ping}.
 */
export type PingOptions = Pick<Parameters<typeof streamText>[0], "providerOptions" | "prompt">;

/**
 * Sends a minimal probe request to a {@link LanguageModel} and returns
 * whether the model is reachable and responsive.
 *
 * The stream is aborted immediately upon receiving the first `start-step`
 * event, keeping latency and cost to a minimum.
 *
 * @param model - The language model instance to probe.
 * @param options - Optional settings forwarded to {@link streamText}.
 * @returns A promise that resolves to `true` if the model responded,
 *          or `false` if it did not (e.g. invalid credentials, unknown model,
 *          or network failure).
 *
 * @example
 * ```typescript
 * import { openai } from "@ai-sdk/openai";
 * import { ping } from "ai-sdk-ping";
 *
 * const model = openai("gpt-5.2-chat");
 * const reachable = await ping(model);
 *
 * if (reachable) {
 *   // `model` is verified reachable — reuse it with confidence.
 * }
 * ```
 */
export const ping = async (model: LanguageModel, options?: PingOptions): Promise<boolean> => {
	const abortController = new AbortController();

	try {
		const { stream } = streamText({
			model,
			prompt: "Say this is a test.",
			maxRetries: 0,
			abortSignal: abortController.signal,
			onError: () => {
				// Errors surface as a `false` return below; nothing to do here.
			},
			...options,
		});

		for await (const part of stream) {
			if (part.type === "start-step") {
				abortController.abort();
				return true;
			}
		}

		return false;
	} catch (error) {
		if (error instanceof Error && error.name === "AbortError") {
			return true;
		}

		return false;
	}
};
