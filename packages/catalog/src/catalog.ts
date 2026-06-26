import { defaultSettingsMiddleware, gateway, type LanguageModel, wrapLanguageModel } from "ai";

import type { Config, Model, ModelKey, ModelSettings, ModelType } from "./schema.ts";

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

/**
 * Turns a (providerId, modelId, type) triple into a runtime model handle.
 * Swap this to change *how* models are instantiated without touching the
 * config or the rest of the app:
 *   - default: Vercel AI Gateway   -> gateway("openai/gpt-5.1")
 *   - direct providers             -> import { openai } from "@ai-sdk/openai"
 *   - your own custom provider      -> myProvider.languageModel(modelId)
 *
 * `type` reflects the model's {@link ModelType}: resolvers that talk to a
 * direct provider use it to choose the call surface — `provider(modelId)` for
 * "default" vs `provider.chat(modelId)` for "chat".
 */
export type ModelResolver = (providerId: string, modelId: string, type: ModelType) => LanguageModel;

/**
 * Default resolver: route everything through the Vercel AI Gateway.
 * The gateway exposes a single surface, so `type` is not needed here — it
 * matters for resolvers that call a direct provider's `.chat()` method.
 */
export const gatewayResolver: ModelResolver = (providerId, modelId) =>
	gateway(`${providerId}/${modelId}`);

/**
 * A model's config entry, plus its provider and stable `provider:model` key.
 * `settings` here is the *effective* value — the provider's defaults merged
 * with the model's own settings — which is exactly what is baked into the handle.
 */
export interface ModelEntry extends Model {
	provider: string;
	key: ModelKey;
}

/** A role resolved to a model handle plus the model's metadata. */
export interface RoleEntry {
	key: ModelKey;
	model: LanguageModel;
	meta: ModelEntry;
}

/**
 * The catalog built from a {@link Config}: a `provider:model` -> model mapping,
 * role lookups, and a metadata index. The single source of truth is the config;
 * the {@link ModelResolver} decides how each entry becomes a real handle.
 */
export interface Catalog {
	/** Metadata for every model, keyed by `provider:model`. */
	meta: Map<ModelKey, ModelEntry>;
	/** Role name -> resolved handle + metadata. */
	roles: Record<string, RoleEntry>;
	/** Model handle by explicit address, e.g. `model("anthropic:claude-sonnet-4-5")`. */
	model(key: ModelKey): LanguageModel;
	/** Model handle for a role, e.g. `modelForRole("chat")` -> pass to generateText. */
	modelForRole(role: string): LanguageModel;
	/** Metadata for a role (id, type, settings, provider, key). */
	metaForRole(role: string): ModelEntry | undefined;
}

/**
 * Builds a {@link Catalog} from a validated config.
 * Every model listed in the config is resolved once via `resolve`; roles are
 * resolved eagerly (their provider+model are guaranteed to exist by parsing).
 */
export function createCatalog(config: Config, resolve: ModelResolver = gatewayResolver): Catalog {
	const models = new Map<ModelKey, LanguageModel>();
	const meta = new Map<ModelKey, ModelEntry>();
	for (const provider of config.providers) {
		for (const m of provider.models) {
			const key: ModelKey = `${provider.id}:${m.id}`;
			const settings = mergeSettings(provider.settings, m.settings);
			const handle = withSettings(resolve(provider.id, m.id, m.type), settings);
			const entry: ModelEntry = { ...m, provider: provider.id, key };
			if (settings) {
				entry.settings = settings;
			}
			models.set(key, handle);
			meta.set(key, entry);
		}
	}

	const model = (key: ModelKey): LanguageModel => {
		const found = models.get(key);
		if (found === undefined) {
			throw new Error(`Unknown model "${key}".`);
		}
		return found;
	};

	const roles: Record<string, RoleEntry> = {};
	for (const [role, ref] of Object.entries(config.roles)) {
		const key: ModelKey = `${ref.provider}:${ref.model}`;
		const entry = meta.get(key);
		// entry is guaranteed by Config validation; the guard keeps types honest.
		if (!entry) {
			throw new Error(`Unknown model "${key}".`);
		}
		roles[role] = {
			key,
			model: model(key),
			meta: entry,
		};
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
			return entry.model;
		},
		metaForRole(role) {
			return roles[role]?.meta;
		},
	};
}
