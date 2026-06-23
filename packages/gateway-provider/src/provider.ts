// Copyright 2026 Shinsuke Mori
// SPDX-License-Identifier: Apache-2.0

import { type AnthropicProvider, createAnthropic } from "@ai-sdk/anthropic";
import { type CohereProvider, createCohere } from "@ai-sdk/cohere";
import { createDeepSeek, type DeepSeekProvider } from "@ai-sdk/deepseek";
import { createGoogleGenerativeAI, type GoogleGenerativeAIProvider } from "@ai-sdk/google";
import { createGroq, type GroqProvider } from "@ai-sdk/groq";
import { createMistral, type MistralProvider } from "@ai-sdk/mistral";
import { createOpenAI, type OpenAIProvider } from "@ai-sdk/openai";
import { createOpenAICompatible, type OpenAICompatibleProvider } from "@ai-sdk/openai-compatible";
import { createPerplexity, type PerplexityProvider } from "@ai-sdk/perplexity";
import type { LanguageModelV3 } from "@ai-sdk/provider";
import { type FetchFunction, loadApiKey, withoutTrailingSlash } from "@ai-sdk/provider-utils";
import { createXai, type XaiProvider } from "@ai-sdk/xai";

import { createBodyModelFetch, createGeminiFetch, MODEL_SLUG_PLACEHOLDER } from "./fetch.ts";
import type { Backend, GatewayConfig } from "./schema.ts";

/**
 * A provider pointed at a custom gateway. Acts as a model factory that routes
 * each model id to the right upstream backend, and also exposes the underlying
 * provider instances so provider-native features (tools, typed provider
 * metadata) keep working:
 *
 * ```ts
 * const gateway = createGatewayProvider(config);
 * const { providerMetadata } = await generateText({
 *   model: gateway("gemini-2.5-pro"),
 *   tools: { web_search: gateway.google.tools.googleSearch({}) },
 *   prompt: "What are the latest regulatory updates?",
 * });
 * ```
 *
 * Embeddings and image models are not routed at the top level; reach them
 * through the typed sub-providers (e.g. `gateway.openai.textEmbeddingModel(id)`).
 */
export interface GatewayProvider {
	(modelId: string): LanguageModelV3;

	/** Creates a model for text generation, routed by the config's `models`. */
	languageModel(modelId: string): LanguageModelV3;

	/**
	 * Alias of {@link GatewayProvider.languageModel}. The gateway already selects
	 * the correct call surface per backend (e.g. Chat Completions for OpenAI), so
	 * `gateway(id)` and `gateway.chat(id)` are equivalent.
	 */
	chat(modelId: string): LanguageModelV3;

	/** The Anthropic provider, pointed at the gateway. */
	readonly anthropic: AnthropicProvider;
	/** The OpenAI provider, pointed at the gateway. */
	readonly openai: OpenAIProvider;
	/** The generic OpenAI-compatible provider, pointed at the gateway. */
	readonly openaiCompatible: OpenAICompatibleProvider;
	/** The Mistral provider, pointed at the gateway. */
	readonly mistral: MistralProvider;
	/** The Cohere provider, pointed at the gateway. */
	readonly cohere: CohereProvider;
	/** The Groq provider, pointed at the gateway. */
	readonly groq: GroqProvider;
	/** The xAI (Grok) provider, pointed at the gateway. */
	readonly xai: XaiProvider;
	/** The DeepSeek provider, pointed at the gateway. */
	readonly deepseek: DeepSeekProvider;
	/** The Perplexity provider, pointed at the gateway. */
	readonly perplexity: PerplexityProvider;
	/** The Google Generative AI provider, pointed at the gateway. */
	readonly google: GoogleGenerativeAIProvider;
}

/**
 * Create a gateway provider from a validated {@link GatewayConfig}.
 *
 * Sub-providers are built lazily and memoized, so no API key is required until a
 * model or sub-provider is actually used — and only the backends you reference
 * are ever constructed.
 */
export function createGatewayProvider(config: GatewayConfig): GatewayProvider {
	const baseURL = withoutTrailingSlash(config.baseURL) ?? config.baseURL;

	const getApiKey = (): string =>
		loadApiKey({
			apiKey: config.apiKey,
			environmentVariableName: config.apiKeyEnvVarName ?? "AI_GATEWAY_API_KEY",
			description: "AI SDK gateway",
		});

	const backendOf = new Map<string, Backend>();
	const slugOf = new Map<string, string>();
	for (const m of config.models) {
		backendOf.set(m.id, m.backend);
		slugOf.set(m.id, m.slug ?? m.id);
	}
	const slugFor = (model: string): string => slugOf.get(model) ?? model;

	const bodyModelFetch = createBodyModelFetch(slugFor);

	const fixedPathBaseURL = (pathTemplate: string): string =>
		`${baseURL}/${pathTemplate.replace(/^\/+/u, "").replaceAll("{slug}", MODEL_SLUG_PLACEHOLDER)}`;

	const cache = new Map<Backend, unknown>();

	// Builds (and memoizes) a fixed-path sub-provider: the model is carried in
	// the request body and the URL slug is substituted by `bodyModelFetch`.
	const fixedPathProvider = <P>(
		key: Exclude<Backend, "google">,
		factory: (options: { baseURL: string; apiKey: string; fetch: FetchFunction }) => P,
	): P => {
		const cached = cache.get(key);
		if (cached) {
			return cached as P;
		}
		const backend = config.backends[key];
		if (!backend) {
			throw new Error(`The "${key}" backend is not configured in "backends.${key}".`);
		}
		const created = factory({
			baseURL: fixedPathBaseURL(backend.pathTemplate),
			apiKey: getApiKey(),
			fetch: bodyModelFetch,
		});
		cache.set(key, created);
		return created;
	};

	const getAnthropic = (): AnthropicProvider => fixedPathProvider("anthropic", createAnthropic);
	const getOpenAI = (): OpenAIProvider => fixedPathProvider("openai", createOpenAI);
	const getMistral = (): MistralProvider => fixedPathProvider("mistral", createMistral);
	const getCohere = (): CohereProvider => fixedPathProvider("cohere", createCohere);
	const getGroq = (): GroqProvider => fixedPathProvider("groq", createGroq);
	const getXai = (): XaiProvider => fixedPathProvider("xai", createXai);
	const getDeepSeek = (): DeepSeekProvider => fixedPathProvider("deepseek", createDeepSeek);
	const getPerplexity = (): PerplexityProvider => fixedPathProvider("perplexity", createPerplexity);
	const getOpenAICompatible = (): OpenAICompatibleProvider =>
		fixedPathProvider("openai-compatible", (options) =>
			createOpenAICompatible({
				name: config.backends["openai-compatible"]?.name ?? "openai-compatible",
				...options,
			}),
		);

	const getGoogle = (): GoogleGenerativeAIProvider => {
		const cached = cache.get("google");
		if (cached) {
			return cached as GoogleGenerativeAIProvider;
		}
		const backend = config.backends.google;
		if (!backend) {
			throw new Error('The "google" backend is not configured in "backends.google".');
		}
		const created = createGoogleGenerativeAI({
			baseURL,
			apiKey: getApiKey(),
			fetch: createGeminiFetch(baseURL, backend, slugFor),
		});
		cache.set("google", created);
		return created;
	};

	const openaiModel = (modelId: string): LanguageModelV3 => {
		const provider = getOpenAI();
		switch (config.backends.openai?.api ?? "chat") {
			case "responses": {
				return provider.responses(modelId);
			}
			case "completion": {
				return provider.completion(modelId);
			}
			default: {
				return provider.chat(modelId);
			}
		}
	};

	const languageModel = (modelId: string): LanguageModelV3 => {
		switch (backendOf.get(modelId)) {
			case "anthropic": {
				return getAnthropic().languageModel(modelId);
			}
			case "openai": {
				return openaiModel(modelId);
			}
			case "openai-compatible": {
				return getOpenAICompatible().languageModel(modelId);
			}
			case "mistral": {
				return getMistral().languageModel(modelId);
			}
			case "cohere": {
				return getCohere().languageModel(modelId);
			}
			case "groq": {
				return getGroq().languageModel(modelId);
			}
			case "xai": {
				return getXai().languageModel(modelId);
			}
			case "deepseek": {
				return getDeepSeek().languageModel(modelId);
			}
			case "perplexity": {
				return getPerplexity().languageModel(modelId);
			}
			case "google": {
				return getGoogle().languageModel(modelId);
			}
			default: {
				throw new Error(
					`Unknown model "${modelId}". Add it to the gateway config's "models" list.`,
				);
			}
		}
	};

	const provider = ((modelId: string) => languageModel(modelId)) as GatewayProvider;
	provider.languageModel = languageModel;
	provider.chat = languageModel;

	Object.defineProperties(provider, {
		anthropic: { get: getAnthropic, enumerable: true },
		openai: { get: getOpenAI, enumerable: true },
		openaiCompatible: { get: getOpenAICompatible, enumerable: true },
		mistral: { get: getMistral, enumerable: true },
		cohere: { get: getCohere, enumerable: true },
		groq: { get: getGroq, enumerable: true },
		xai: { get: getXai, enumerable: true },
		deepseek: { get: getDeepSeek, enumerable: true },
		perplexity: { get: getPerplexity, enumerable: true },
		google: { get: getGoogle, enumerable: true },
	});

	return provider;
}

// Re-exported provider option/metadata types for the most common backends, so
// both sides of a request can be typed from a single import. For other backends,
// import the option types directly from their `@ai-sdk/*` package.
export type { AnthropicMessageMetadata, AnthropicProviderOptions } from "@ai-sdk/anthropic";
export type {
	GoogleGenerativeAIProviderMetadata,
	GoogleGenerativeAIProviderOptions,
} from "@ai-sdk/google";
export type { OpenAIChatLanguageModelOptions } from "@ai-sdk/openai";
