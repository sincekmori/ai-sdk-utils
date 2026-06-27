// Copyright 2026 Shinsuke Mori
// SPDX-License-Identifier: Apache-2.0

import { loadApiKey, withoutTrailingSlash } from "@ai-sdk/provider-utils";
import type { LanguageModel } from "ai";

import type { GatewayOptions } from "./backends.ts";
import { createBodyModelFetch, createGeminiFetch, MODEL_SLUG_PLACEHOLDER } from "./fetch.ts";
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
	models: Model[],
): ProviderRuntime {
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
	const bodyModelFetch = createBodyModelFetch(slugFor);

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
		const created =
			backend === "google"
				? createVendor("google", {
						baseURL,
						apiKey: getApiKey(),
						fetch: createGeminiFetch(baseURL, cfg, slugFor),
					})
				: createVendor(backend, {
						baseURL: fixedPathBaseURL(cfg.pathTemplate),
						apiKey: getApiKey(),
						fetch: bodyModelFetch,
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
 */
export function createDirectRuntime(
	vendor: Vendor,
	options: { baseURL?: string; apiKey?: string; apiKeyEnvVarName?: string; name?: string },
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
			provider = createVendor(vendor, { apiKey, baseURL: options.baseURL, name: options.name });
		}
		return provider;
	};
	return {
		resolve: (modelId, api): LanguageModel => callSurface(get(), modelId, api),
		instance: (): VendorProvider => get(),
	};
}
