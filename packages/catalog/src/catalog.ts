import { gateway, type LanguageModel } from "ai";

import type { Config, Model, ModelKey } from "./schema.ts";

/**
 * Turns a (providerId, modelId) pair into a runtime model handle.
 * Swap this to change *how* models are instantiated without touching the
 * config or the rest of the app:
 *   - default: Vercel AI Gateway   -> gateway("openai/gpt-5.1")
 *   - direct providers             -> import { openai } from "@ai-sdk/openai"
 *   - your own custom provider      -> myProvider.languageModel(modelId)
 */
export type ModelResolver = (providerId: string, modelId: string) => LanguageModel;

/** Default resolver: route everything through the Vercel AI Gateway. */
export const gatewayResolver: ModelResolver = (providerId, modelId) =>
	gateway(`${providerId}/${modelId}`);

/** A model's config entry, plus its provider and stable `provider:model` key. */
export interface ModelEntry extends Model {
	provider: string;
	key: ModelKey;
}

/** A role resolved to a model handle plus the model's metadata. */
export interface RoleEntry {
	key: ModelKey;
	model: LanguageModel;
	meta: ModelEntry;
	/** What this role is for, from the config (defaults to ""). */
	description: string;
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
	/** Metadata for a role (contextWindow, maxOutputTokens, knowledgeCutoff, ...). */
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
			models.set(key, resolve(provider.id, m.id));
			meta.set(key, { ...m, provider: provider.id, key });
		}
	}

	const model = (key: ModelKey): LanguageModel => {
		const found = models.get(key);
		if (!found) {
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
			description: ref.description,
		};
	}

	return {
		meta,
		roles,
		model,
		modelForRole(role) {
			const entry = roles[role];
			if (!entry) {
				throw new Error(`Unknown role "${role}".`);
			}
			return entry.model;
		},
		metaForRole(role) {
			return roles[role]?.meta;
		},
	};
}
