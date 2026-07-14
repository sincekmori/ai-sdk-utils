// Copyright 2026 Shinsuke Mori
// SPDX-License-Identifier: Apache-2.0

import type { FetchFunction } from "@ai-sdk/provider-utils";
import type { LanguageModel } from "ai";
import * as z from "zod";

import { createDirectRuntime, createGatewayRuntime, type ProviderRuntime } from "./gateway.ts";
import { parseRoleRef, vendorBlockOf } from "./invariants.ts";
import { Config, type Model, type ModelKey, type Provider } from "./schema.ts";
import { mergeSettings, withSettings } from "./settings.ts";
import { isVendor } from "./vendors.ts";

/**
 * Builds one provider's runtime from its config and any override. A `resolve`
 * override replaces the runtime entirely (it looks entries up lazily, once
 * `meta` is fully indexed); otherwise the config decides between the gateway
 * and the direct runtime, with the override's `fetch` (then the global one) as
 * the base fetch.
 */
function createProviderRuntime(
	provider: Provider,
	context: {
		override: ProviderOverride | undefined;
		globalFetch: FetchFunction | undefined;
		meta: Map<ModelKey, ModelEntry>;
	},
): ProviderRuntime {
	const { override, globalFetch, meta } = context;
	const baseFetch = override?.fetch ?? globalFetch;
	if (override?.resolve) {
		const { resolve } = override;
		return {
			resolve: (modelId): LanguageModel => {
				const entry = meta.get(`${provider.id}:${modelId}`);
				if (!entry) {
					throw new Error(`Unknown model "${provider.id}:${modelId}".`);
				}
				return resolve(entry);
			},
		};
	}
	if (provider.gateway) {
		return createGatewayRuntime(provider.id, provider.gateway, {
			models: provider.models,
			baseFetch,
		});
	}
	const block = vendorBlockOf(provider);
	const vendor = block?.id ?? provider.id;
	if (!isVendor(vendor)) {
		throw new Error(
			`Provider "${provider.id}" is not a built-in vendor (resolved vendor "${vendor}"). Set "vendor" to a supported vendor, add a "gateway" block, or pass a "resolve" override in createCatalog options.`,
		);
	}
	return createDirectRuntime(
		vendor,
		{
			baseURL: block?.baseURL,
			apiKey: block?.apiKey,
			name: block?.name,
			headers: block?.headers,
			query: block?.query,
		},
		baseFetch,
	);
}

/**
 * A model's config entry, plus its provider and stable `provider:model` key.
 * `settings` here is the *effective* value — the provider's defaults merged
 * with the model's own settings — which is exactly what is baked into the handle.
 */
export interface ModelEntry extends Model {
	provider: string;
	key: ModelKey;
}

/**
 * Resolves a model to a runtime handle, for a provider that is neither a
 * built-in vendor nor a `gateway` block — for example Amazon Bedrock, Google
 * Vertex, or Azure, whose auth doesn't fit a bearer token. Receives the full
 * {@link ModelEntry}, so it can pick the call surface from `api` and read any
 * other model metadata it needs.
 */
export type ProviderResolver = (model: ModelEntry) => LanguageModel;

/**
 * Per-provider runtime overrides, keyed by provider id in
 * {@link CatalogOptions.providers}.
 */
export interface ProviderOverride {
	/**
	 * Resolves this provider's models in code, replacing the config-driven
	 * runtime entirely. An override always wins, so it can stand in for a
	 * built-in vendor or a gateway provider too. Required for a provider whose
	 * vendor is not built in and which has no `gateway` block. When set,
	 * `fetch` is ignored — the resolver owns its transport.
	 */
	resolve?: ProviderResolver;
	/**
	 * Base fetch for this provider only, taking precedence over the global
	 * {@link CatalogOptions.fetch} — e.g. to inject a short-lived OAuth token
	 * for one gateway without affecting the others.
	 */
	fetch?: FetchFunction;
}

/** Options for {@link createCatalog}. */
export interface CatalogOptions {
	/** Per-provider runtime overrides, keyed by provider id. */
	providers?: Record<string, ProviderOverride>;
	/**
	 * Base fetch every provider's HTTP requests are sent through (default:
	 * `globalThis.fetch`). For gateway providers it runs *after* the gateway
	 * path rewriting, so it sees the final gateway URL and body — the place to
	 * add logging, auth, or a gateway-specific payload adjustment without
	 * patching `globalThis.fetch`. A per-provider `fetch` override wins;
	 * resolver-backed providers are not affected (their resolver builds its
	 * own models).
	 */
	fetch?: FetchFunction;
}

/** A role resolved to a model key plus the model's metadata. */
export interface RoleEntry {
	key: ModelKey;
	meta: ModelEntry;
}

/**
 * The catalog built from a {@link Config}: a metadata index, role lookups, and
 * lazily-resolved model handles. The single source of truth is the config; each
 * provider decides how its models become real handles (a direct `@ai-sdk/*`
 * vendor, your own gateway, or a `resolve` override).
 */
export interface Catalog {
	/** Metadata for every model, keyed by `provider:model`. */
	meta: Map<ModelKey, ModelEntry>;
	/** Role name -> key + metadata. */
	roles: Record<string, RoleEntry>;
	/** Model handle by explicit address, e.g. `model("anthropic:claude-sonnet-5")`. */
	model(key: ModelKey): LanguageModel;
	/** Model handle for a role, e.g. `modelForRole("chat")` -> pass to generateText. */
	modelForRole(role: string): LanguageModel;
	/** Metadata for a role (id, settings, provider, key, ...). */
	metaForRole(role: string): ModelEntry | undefined;
	/**
	 * The underlying AI SDK provider instance backing a model, for provider-native
	 * features — tools, embeddings, image models, typed provider metadata. For a
	 * gateway provider this is the sub-provider for the model's backend (e.g. the
	 * Google instance behind a Gemini model, exposing `tools.enterpriseWebSearch`).
	 * Pass the vendor's provider type as `P`. Returns undefined for a
	 * resolver-backed provider (no instance) or an unknown key.
	 */
	// eslint-disable-next-line typescript/no-unnecessary-type-parameters -- P is a caller-supplied cast target
	provider<P = unknown>(key: ModelKey): P | undefined;
}

/**
 * Builds a {@link Catalog} from a config.
 *
 * The config is validated here at runtime — the `Config` parameter type is for
 * editor completion when authoring configs in code, but data parsed from JSON
 * passes straight in and gets the same checks. Invalid input throws a readable
 * error listing every issue with its path.
 *
 * Metadata is indexed eagerly; model handles are resolved on first access and
 * memoized. Resolution is lazy so a provider's API key is only needed when one
 * of its models is actually used — listing a provider you never call costs
 * nothing, and building the catalog never reads a key or hits the network.
 */
export function createCatalog(config: Config, options: CatalogOptions = {}): Catalog {
	const parsed = Config.safeParse(config);
	if (!parsed.success) {
		// ZodError#message is a raw JSON dump; prettifyError renders each issue
		// with its path in a single readable block.
		throw new Error(z.prettifyError(parsed.error));
	}
	const cfg = parsed.data;
	const meta = new Map<ModelKey, ModelEntry>();
	const runtimeByProvider = new Map<string, ProviderRuntime>();

	for (const provider of cfg.providers) {
		runtimeByProvider.set(
			provider.id,
			createProviderRuntime(provider, {
				override: options.providers?.[provider.id],
				globalFetch: options.fetch,
				meta,
			}),
		);

		for (const m of provider.models) {
			const key: ModelKey = `${provider.id}:${m.id}`;
			const settings = mergeSettings(provider.settings, m.settings);
			const entry: ModelEntry = { ...m, provider: provider.id, key };
			if (settings) {
				entry.settings = settings;
			}
			meta.set(key, entry);
		}
	}

	const handles = new Map<ModelKey, LanguageModel>();
	const model = (key: ModelKey): LanguageModel => {
		const cached = handles.get(key);
		if (cached !== undefined) {
			return cached;
		}
		const entry = meta.get(key);
		if (!entry) {
			throw new Error(`Unknown model "${key}".`);
		}
		const runtime = runtimeByProvider.get(entry.provider);
		if (!runtime) {
			throw new Error(`No runtime for provider "${entry.provider}".`);
		}
		const handle = withSettings(runtime.resolve(entry.id, entry.api), entry.settings);
		handles.set(key, handle);
		return handle;
	};

	// The underlying AI SDK provider instance behind a model (for provider-native
	// tools/embeddings). Caller supplies the concrete vendor type as `P`.
	// eslint-disable-next-line typescript/no-unnecessary-type-parameters -- P is a caller-supplied cast target
	const providerInstance = <P = unknown>(key: ModelKey): P | undefined => {
		const entry = meta.get(key);
		if (!entry) {
			return undefined;
		}
		const instance: unknown = runtimeByProvider.get(entry.provider)?.instance?.(entry.id);
		return instance as P | undefined;
	};

	const roles: Record<string, RoleEntry> = {};
	for (const [role, ref] of Object.entries(cfg.roles)) {
		const target = parseRoleRef(ref);
		const key: ModelKey = `${target.provider}:${target.model}`;
		const entry = meta.get(key);
		// entry is guaranteed by Config validation; the guard keeps types honest.
		if (!entry) {
			throw new Error(`Unknown model "${key}".`);
		}
		roles[role] = { key, meta: entry };
	}

	return {
		meta,
		roles,
		model,
		modelForRole(role) {
			const entry: RoleEntry | undefined = roles[role];
			if (entry === undefined) {
				throw new Error(`Unknown role "${role}".`);
			}
			return model(entry.key);
		},
		metaForRole(role) {
			return roles[role]?.meta;
		},
		provider: providerInstance,
	};
}

// Re-exported so callers can type a custom `CatalogOptions.fetch` without
// depending on `@ai-sdk/provider-utils` themselves.
export type { FetchFunction } from "@ai-sdk/provider-utils";
