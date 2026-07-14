// Copyright 2026 Shinsuke Mori
// SPDX-License-Identifier: Apache-2.0

import { type FetchFunction, loadApiKey, withoutTrailingSlash } from "@ai-sdk/provider-utils";
import type { LanguageModel } from "ai";

import type { GatewayOptions } from "./backends.ts";
import {
	createBodyModelFetch,
	createGeminiFetch,
	createQueryFetch,
	MODEL_SLUG_PLACEHOLDER,
} from "./fetch.ts";
import { mergeAndResolveHeaders, type QueryParams, type RequestHeaders } from "./headers.ts";
import type { Model, ProviderResolver, Vendor } from "./schema.ts";
import { callSurface, createVendor, type VendorProvider } from "./vendors.ts";

/**
 * One provider's runtime: how to resolve a model id to a handle, and the
 * underlying AI SDK provider instance behind a model (for provider-native
 * features like tools and embeddings). `instance` returns undefined for an
 * unknown model id; resolver-backed providers expose no instance at all.
 */
export interface ProviderRuntime {
	resolve: ProviderResolver;
	/** Omitted by resolver-backed providers, which expose no instance. */
	instance?(modelId: string): VendorProvider | undefined;
}

/** Options for {@link createGatewayRuntime}. */
export interface GatewayRuntimeOptions {
	/** The provider's models (backend routing + slugs come from these). */
	models: Model[];
	/**
	 * Fetch every backend's requests go through, *after* the gateway path
	 * rewriting — it sees the final gateway URL and body.
	 */
	baseFetch?: FetchFunction;
}

/**
 * Builds the runtime for a gateway provider: every model routes through one
 * gateway endpoint to the right upstream backend. Sub-providers are built lazily
 * and memoized, so the gateway key is only read when a model is first used and
 * only the referenced backends are ever constructed.
 *
 * For fixed-path backends the model is carried in the request body and the URL
 * slug is substituted per request; for `google` the model is in the URL, which
 * is rewritten to the gateway layout (including the streaming/non-streaming
 * action switch).
 */
export function createGatewayRuntime(
	providerId: string,
	gateway: GatewayOptions,
	options: GatewayRuntimeOptions,
): ProviderRuntime {
	const { models, baseFetch } = options;
	const baseURL = withoutTrailingSlash(gateway.baseURL) ?? gateway.baseURL;
	const getApiKey = (): string =>
		loadApiKey({
			apiKey: gateway.apiKey,
			environmentVariableName: gateway.apiKeyEnvVarName ?? "AI_GATEWAY_API_KEY",
			description: `gateway provider "${providerId}"`,
		});

	const backendOf = new Map<string, Vendor>();
	const slugOf = new Map<string, string>();
	for (const m of models) {
		if (m.backend !== undefined) {
			backendOf.set(m.id, m.backend);
		}
		slugOf.set(m.id, m.slug ?? m.id);
	}
	const slugFor = (model: string): string => slugOf.get(model) ?? model;

	const fixedPathBaseURL = (pathTemplate: string): string =>
		`${baseURL}/${pathTemplate.replace(/^\/+/u, "").replaceAll("{slug}", MODEL_SLUG_PLACEHOLDER)}`;

	const cache = new Map<Vendor, VendorProvider>();
	const instanceFor = (backend: Vendor): VendorProvider => {
		const cached = cache.get(backend);
		if (cached !== undefined) {
			return cached;
		}
		const cfg = gateway.backends[backend];
		if (!cfg) {
			throw new Error(
				`Model routed to backend "${backend}", but "${providerId}.gateway.backends.${backend}" is not configured.`,
			);
		}
		const apiKey = getApiKey();
		// Gateway-level headers/query apply to every backend; the backend's own
		// entries are merged on top (backend wins per name). Query params are
		// appended after the path rewriting, so they land on the final gateway URL.
		const headers = mergeAndResolveHeaders(gateway.headers, cfg.headers, {
			apiKey,
			description: `gateway provider "${providerId}"`,
		});
		const query: QueryParams = { ...gateway.query, ...cfg.query };
		const backendFetch =
			Object.keys(query).length > 0 ? createQueryFetch(query, baseFetch) : baseFetch;
		const created =
			backend === "google"
				? createVendor("google", {
						baseURL,
						apiKey,
						headers,
						fetch: createGeminiFetch(baseURL, cfg, { slugFor, baseFetch: backendFetch }),
					})
				: createVendor(backend, {
						baseURL: fixedPathBaseURL(cfg.pathTemplate),
						apiKey,
						headers,
						fetch: createBodyModelFetch(slugFor, backendFetch),
						name: "name" in cfg ? cfg.name : undefined,
					});
		cache.set(backend, created);
		return created;
	};

	return {
		resolve: (modelId, api): LanguageModel => {
			const backend = backendOf.get(modelId);
			if (backend === undefined) {
				throw new Error(`Unknown model "${modelId}" in gateway provider "${providerId}".`);
			}
			return callSurface(instanceFor(backend), modelId, api);
		},
		instance: (modelId): VendorProvider | undefined => {
			const backend = backendOf.get(modelId);
			return backend === undefined ? undefined : instanceFor(backend);
		},
	};
}

/**
 * Builds the runtime for a direct provider: the bundled `@ai-sdk/*` vendor used
 * straight, at its own endpoint (or a `baseURL` override). The vendor instance
 * is built lazily and memoized; the API key is taken from `apiKey` /
 * `apiKeyEnvVarName` when given, otherwise the vendor SDK's own default
 * (e.g. `OPENAI_API_KEY`).
 *
 * `baseFetch` (when given) is handed to the vendor SDK as its `fetch`.
 */
export function createDirectRuntime(
	vendor: Vendor,
	options: {
		baseURL?: string;
		apiKey?: string;
		apiKeyEnvVarName?: string;
		name?: string;
		headers?: RequestHeaders;
		query?: QueryParams;
	},
	baseFetch?: FetchFunction,
): ProviderRuntime {
	let provider: VendorProvider | undefined = undefined;
	const get = (): VendorProvider => {
		if (provider === undefined) {
			const apiKey =
				options.apiKey !== undefined || options.apiKeyEnvVarName !== undefined
					? loadApiKey({
							apiKey: options.apiKey,
							environmentVariableName: options.apiKeyEnvVarName ?? "",
							description: `provider vendor "${vendor}"`,
						})
					: undefined;
			// Headers resolve here — lazily, like the key — so an env-var-backed
			// header is only required once a model of this provider is used.
			const headers = mergeAndResolveHeaders(options.headers, undefined, {
				apiKey,
				description: `provider vendor "${vendor}"`,
			});
			provider = createVendor(vendor, {
				apiKey,
				baseURL: options.baseURL,
				fetch:
					options.query !== undefined && Object.keys(options.query).length > 0
						? createQueryFetch(options.query, baseFetch)
						: baseFetch,
				headers,
				name: options.name,
			});
		}
		return provider;
	};
	return {
		resolve: (modelId, api): LanguageModel => callSurface(get(), modelId, api),
		instance: (): VendorProvider => get(),
	};
}
