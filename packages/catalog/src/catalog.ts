// Copyright 2026 Shinsuke Mori
// SPDX-License-Identifier: Apache-2.0

import { defaultSettingsMiddleware, type LanguageModel, wrapLanguageModel } from "ai";

import { createDirectRuntime, createGatewayRuntime, type ProviderRuntime } from "./gateway.ts";
import type { Config, Model, ModelKey, ModelSettings, ProviderResolver } from "./schema.ts";
import { isVendor } from "./vendors.ts";

/**
 * Merges a provider's default settings with a model's own settings.
 * Model settings win for scalar fields; `providerOptions` is merged per
 * provider namespace so a model can add or override individual options without
 * dropping the provider-level ones.
 */
function mergeSettings(base?: ModelSettings, override?: ModelSettings): ModelSettings | undefined {
	if (!base) {
		return override;
	}
	if (!override) {
		return base;
	}
	const merged: ModelSettings = { ...base, ...override };
	if (base.providerOptions || override.providerOptions) {
		const providerOptions: NonNullable<ModelSettings["providerOptions"]> = {};
		const namespaces = new Set([
			...Object.keys(base.providerOptions ?? {}),
			...Object.keys(override.providerOptions ?? {}),
		]);
		for (const ns of namespaces) {
			providerOptions[ns] = {
				...base.providerOptions?.[ns],
				...override.providerOptions?.[ns],
			};
		}
		merged.providerOptions = providerOptions;
	}
	return merged;
}

/**
 * Bakes the config's default call settings (temperature, topP, ...) into a
 * model handle via `defaultSettingsMiddleware`, so they apply to every call
 * unless overridden at the call site. Returns the handle untouched when there
 * are no settings, when it is a bare model-id string, or for legacy v2 models
 * (which `wrapLanguageModel` does not accept).
 */
function withSettings(model: LanguageModel, settings?: ModelSettings): LanguageModel {
	if (!settings || typeof model === "string" || model.specificationVersion === "v2") {
		return model;
	}
	return wrapLanguageModel({
		model,
		middleware: defaultSettingsMiddleware({ settings }),
	});
}

/** Options for {@link createCatalog}. */
export interface CatalogOptions {
	/**
	 * Per-provider resolver overrides, keyed by provider id. An override always
	 * wins, so it can stand in for a built-in vendor or a gateway provider too.
	 * Required for any provider whose vendor is not built in and which has no
	 * `gateway` block.
	 */
	resolvers?: Record<string, ProviderResolver>;
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

/** A role resolved to a model key plus the model's metadata. */
export interface RoleEntry {
	key: ModelKey;
	meta: ModelEntry;
}

/**
 * The catalog built from a {@link Config}: a metadata index, role lookups, and
 * lazily-resolved model handles. The single source of truth is the config; each
 * provider decides how its models become real handles (a direct `@ai-sdk/*`
 * vendor, your own gateway, or a custom resolver).
 */
export interface Catalog {
	/** Metadata for every model, keyed by `provider:model`. */
	meta: Map<ModelKey, ModelEntry>;
	/** Role name -> key + metadata. */
	roles: Record<string, RoleEntry>;
	/** Model handle by explicit address, e.g. `model("anthropic:claude-sonnet-4-5")`. */
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
 * Builds a {@link Catalog} from a validated config.
 *
 * Metadata is indexed eagerly; model handles are resolved on first access and
 * memoized. Resolution is lazy so a provider's API key is only needed when one
 * of its models is actually used — listing a provider you never call costs
 * nothing, and building the catalog never reads a key or hits the network.
 */
export function createCatalog(config: Config, options: CatalogOptions = {}): Catalog {
	const meta = new Map<ModelKey, ModelEntry>();
	const runtimeByProvider = new Map<string, ProviderRuntime>();

	for (const provider of config.providers) {
		const override = options.resolvers?.[provider.id];
		if (override) {
			// A resolver override exposes no underlying instance.
			runtimeByProvider.set(provider.id, { resolve: override });
		} else if (provider.gateway) {
			runtimeByProvider.set(
				provider.id,
				createGatewayRuntime(provider.id, provider.gateway, provider.models),
			);
		} else {
			const vendor = provider.vendor ?? provider.id;
			if (!isVendor(vendor)) {
				throw new Error(
					`Provider "${provider.id}" is not a built-in vendor (resolved vendor "${vendor}"). Set "vendor" to a supported vendor, add a "gateway" block, or pass a resolver in createCatalog options.`,
				);
			}
			runtimeByProvider.set(
				provider.id,
				createDirectRuntime(vendor, {
					baseURL: provider.baseURL,
					apiKey: provider.apiKey,
					apiKeyEnvVarName: provider.apiKeyEnvVarName,
					name: provider.name,
				}),
			);
		}

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
	for (const [role, ref] of Object.entries(config.roles)) {
		const key: ModelKey = `${ref.provider}:${ref.model}`;
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
