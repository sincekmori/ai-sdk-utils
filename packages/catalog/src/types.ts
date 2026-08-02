// Copyright 2026 Shinsuke Mori
// SPDX-License-Identifier: Apache-2.0

import type { FetchFunction } from "@ai-sdk/provider-utils";
import type { LanguageModel } from "ai";

import type { Model, ModelKey } from "./schema.ts";

/**
 * The catalog's public API surface: the {@link Catalog} shape returned by
 * `createCatalog` and the option types it accepts. Pure type declarations —
 * the construction logic lives in catalog.ts.
 */

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

/** Options for `createCatalog`. */
export interface CatalogOptions<Role extends string = string> {
	/** Per-provider runtime overrides, keyed by provider id. */
	providers?: Record<string, ProviderOverride>;
	/**
	 * Role names the app depends on. `createCatalog` throws when the config's
	 * `roles` lack any of them, so a missing assignment fails at startup instead
	 * of at the first lookup. The declared names also flow into the returned
	 * {@link Catalog}'s type: `modelForRole`/`metaForRole` accept exactly these
	 * roles (a typo fails to compile) and `metaForRole` loses its `undefined`.
	 * Omitted, any role name is accepted and lookups stay runtime-checked.
	 */
	requiredRoles?: readonly Role[];
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
 * `metaForRole`'s result. For a catalog with declared `requiredRoles` the
 * argument can only name a role that is proven to exist, so the `undefined`
 * disappears; with the open `string` default it stays.
 */
export type RoleMeta<Role extends string> = string extends Role
	? ModelEntry | undefined
	: ModelEntry;

/**
 * The catalog built from a `Config`: a metadata index, role lookups, and
 * lazily-resolved model handles. The single source of truth is the config; each
 * provider decides how its models become real handles (a direct `@ai-sdk/*`
 * vendor, your own gateway, or a `resolve` override).
 *
 * `Role` is the union of role names declared via
 * {@link CatalogOptions.requiredRoles} (default: `string`, i.e. any name).
 */
export interface Catalog<Role extends string = string> {
	/** Metadata for every model, keyed by `provider:model`. */
	meta: Map<ModelKey, ModelEntry>;
	/** Role name -> key + metadata. */
	roles: Record<Role, RoleEntry>;
	/** Model handle by explicit address, e.g. `model("anthropic:claude-sonnet-5")`. */
	model(key: ModelKey): LanguageModel;
	/** Model handle for a role, e.g. `modelForRole("chat")` -> pass to generateText. */
	modelForRole(role: Role): LanguageModel;
	/** Metadata for a role (id, settings, provider, key, ...). */
	metaForRole(role: Role): RoleMeta<Role>;
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
