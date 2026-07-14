// Copyright 2026 Shinsuke Mori
// SPDX-License-Identifier: Apache-2.0

import { createAnthropic } from "@ai-sdk/anthropic";
import { createCohere } from "@ai-sdk/cohere";
import { createDeepSeek } from "@ai-sdk/deepseek";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createGroq } from "@ai-sdk/groq";
import { createMistral } from "@ai-sdk/mistral";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { createPerplexity } from "@ai-sdk/perplexity";
import type { FetchFunction } from "@ai-sdk/provider-utils";
import { createXai } from "@ai-sdk/xai";
import type { LanguageModel } from "ai";

import type { ModelApi } from "./schema.ts";
import { Vendor } from "./vendor-ids.ts";

/**
 * The call surfaces a bundled `@ai-sdk/*` provider may expose. Every provider
 * implements `languageModel` (its default surface); OpenAI adds `chat` /
 * `responses` / `completion`, and OpenAI-compatible adds `completionModel`.
 */
export interface VendorProvider {
	languageModel(modelId: string): LanguageModel;
	chat?(modelId: string): LanguageModel;
	responses?(modelId: string): LanguageModel;
	completion?(modelId: string): LanguageModel;
	completionModel?(modelId: string): LanguageModel;
}

/** Options passed to a vendor factory. All optional; vendors fill in defaults. */
export interface VendorOptions {
	apiKey?: string;
	baseURL?: string;
	fetch?: FetchFunction;
	/**
	 * Extra request headers, already resolved to concrete values. Merged over
	 * the vendor SDK's own headers (same-name wins), so an explicit auth header
	 * here overrides the SDK's default one.
	 */
	headers?: Record<string, string>;
	/** Metadata namespace for `openai-compatible` (defaults to the vendor name). */
	name?: string;
}

/** True when `value` names a bundled vendor. */
export function isVendor(value: string): value is Vendor {
	return Vendor.safeParse(value).success;
}

/**
 * Instantiates a bundled `@ai-sdk/*` provider. Used for both direct providers
 * (vendor endpoint, or a `baseURL` override) and gateway backends (gateway
 * `baseURL` plus a request-rewriting `fetch`).
 */
export function createVendor(vendor: Vendor, options: VendorOptions): VendorProvider {
	const { apiKey, baseURL, fetch, headers, name } = options;
	switch (vendor) {
		case "anthropic": {
			return createAnthropic({ apiKey, baseURL, fetch, headers });
		}
		case "openai": {
			return createOpenAI({ apiKey, baseURL, fetch, headers });
		}
		case "openai-compatible": {
			return createOpenAICompatible({
				name: name ?? "openai-compatible",
				baseURL: baseURL ?? "",
				apiKey,
				fetch,
				headers,
			});
		}
		case "mistral": {
			return createMistral({ apiKey, baseURL, fetch, headers });
		}
		case "cohere": {
			return createCohere({ apiKey, baseURL, fetch, headers });
		}
		case "groq": {
			return createGroq({ apiKey, baseURL, fetch, headers });
		}
		case "xai": {
			return createXai({ apiKey, baseURL, fetch, headers });
		}
		case "deepseek": {
			return createDeepSeek({ apiKey, baseURL, fetch, headers });
		}
		case "perplexity": {
			return createPerplexity({ apiKey, baseURL, fetch, headers });
		}
		case "google": {
			return createGoogleGenerativeAI({ apiKey, baseURL, fetch, headers });
		}
		default: {
			// Unreachable: `vendor` is exhaustively a {@link Vendor}. Defensive only.
			throw new Error(`Unknown vendor "${vendor as string}".`);
		}
	}
}

/**
 * Picks the call surface for a model handle from its {@link ModelApi}. Omit
 * `api` for the vendor's default surface (Responses for OpenAI, Chat Completions
 * for an OpenAI-compatible server, the single surface for everyone else).
 * Throws when a specific surface is asked for but the vendor lacks it.
 */
export function callSurface(
	provider: VendorProvider,
	modelId: string,
	api?: ModelApi,
): LanguageModel {
	switch (api) {
		case "responses": {
			if (typeof provider.responses !== "function") {
				throw new TypeError(`Model "${modelId}": api "responses" is not available on this vendor.`);
			}
			return provider.responses(modelId);
		}
		case "chat": {
			// OpenAI exposes `chat`; an OpenAI-compatible server's default surface IS
			// Chat Completions, so `languageModel` covers it there.
			return typeof provider.chat === "function"
				? provider.chat(modelId)
				: provider.languageModel(modelId);
		}
		case "completion": {
			if (typeof provider.completion === "function") {
				return provider.completion(modelId);
			}
			if (typeof provider.completionModel === "function") {
				return provider.completionModel(modelId);
			}
			throw new TypeError(`Model "${modelId}": api "completion" is not available on this vendor.`);
		}
		default: {
			// No api set -> the vendor's own default surface.
			return provider.languageModel(modelId);
		}
	}
}
