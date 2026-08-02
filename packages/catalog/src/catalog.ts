// Copyright 2026 Shinsuke Mori
// SPDX-License-Identifier: Apache-2.0

import type { FetchFunction } from "@ai-sdk/provider-utils";
import type { LanguageModel } from "ai";
import * as z from "zod";

import { defaultCostOf } from "./costs.ts";
import { createDirectRuntime, createGatewayRuntime, type ProviderRuntime } from "./gateway.ts";
import { parseRoleRef, vendorBlockOf } from "./invariants.ts";
import { Config, type ModelKey, type Provider } from "./schema.ts";
import { mergeSettings, withSettings } from "./settings.ts";
import type { Catalog, CatalogOptions, ModelEntry, ProviderOverride, RoleEntry } from "./types.ts";
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
 * Builds a {@link Catalog} from a config.
 *
 * The config is validated here at runtime — the `Config` parameter type is for
 * editor completion when authoring configs in code, but data parsed from JSON
 * passes straight in and gets the same checks. Invalid input throws a readable
 * error listing every issue with its path. Roles the app depends on can be
 * declared via {@link CatalogOptions.requiredRoles}; they are verified here too.
 *
 * Metadata is indexed eagerly; model handles are resolved on first access and
 * memoized. Resolution is lazy so a provider's API key is only needed when one
 * of its models is actually used — listing a provider you never call costs
 * nothing, and building the catalog never reads a key or hits the network.
 */
export function createCatalog<const Role extends string = string>(
	config: Config,
	options: CatalogOptions<Role> = {},
): Catalog<Role> {
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
			if (entry.cost === undefined) {
				// No cost in the config -> the embedded models.dev sheet, if known.
				const cost = defaultCostOf(provider, m);
				if (cost) {
					entry.cost = cost;
				}
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

	const missing = (options.requiredRoles ?? []).filter((role) => roles[role] === undefined);
	if (missing.length > 0) {
		throw new Error(
			`Config roles are missing ${missing.map((role) => `"${role}"`).join(", ")} required by createCatalog's "requiredRoles".`,
		);
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
			// RoleMeta's non-undefined branch is sound: `requiredRoles` presence
			// was verified right after the roles were built.
			return roles[role]?.meta;
		},
		provider: providerInstance,
	};
}

// Re-exported so callers can type a custom `CatalogOptions.fetch` without
// depending on `@ai-sdk/provider-utils` themselves.
export type { FetchFunction } from "@ai-sdk/provider-utils";
