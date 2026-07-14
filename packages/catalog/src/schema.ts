// Copyright 2026 Shinsuke Mori
// SPDX-License-Identifier: Apache-2.0

import * as z from "zod";

import { GatewayOptions } from "./backends.ts";
import { ApiKey, QueryParams, RequestHeaders } from "./headers.ts";
import { configInvariants } from "./invariants.ts";
import { Vendor } from "./vendor-ids.ts";

/**
 * Single source of truth for LLM providers, their models, and the role
 * assignments the app uses.
 *
 * The base form is declarative: list `providers`, the `models` each serves, and
 * the `roles` your app references. A provider resolves in one of three ways:
 *
 *   - **direct** — a bundled `@ai-sdk/*` vendor used straight (e.g. `openai`).
 *     The default: `{ id: openai }` calls `@ai-sdk/openai` directly. The
 *     `vendor` block overrides the endpoint, key, headers, and query if needed.
 *   - **gateway** — add a `gateway` block describing your own LLM gateway's
 *     topology and tag each model with its `backend`; it routes there instead.
 *   - **resolver** — a provider whose auth doesn't fit a bundled vendor or a
 *     bearer-token gateway (Amazon Bedrock, Google Vertex, Azure) is wired in
 *     code via `createCatalog(config, { providers })`.
 *
 * Every object is strict: an unknown key fails validation instead of being
 * silently dropped. Validated from a plain object at startup (parsed from JSON
 * or built in code), so it works the same in Node and in the browser. Zod v4.
 */

/** A plain JSON object, mirroring the AI SDK's `JSONObject` type. */
const JsonObject = z.record(z.string(), z.json());

/**
 * Which API surface a model is reached through:
 *   - "responses"  -> `provider.responses(modelId)` (OpenAI Responses API)
 *   - "chat"       -> `provider.chat(modelId)`      (Chat Completions)
 *   - "completion" -> `provider.completion(modelId)` (legacy Completions)
 *
 * Omit it to use the vendor's own default surface — for OpenAI that is the
 * **Responses API** (the current default), for an OpenAI-compatible server it is
 * Chat Completions, and for every other vendor it is their single surface. Set
 * it explicitly when a gateway or server speaks a specific one (e.g. `chat` for
 * a gateway that only exposes Chat Completions).
 */
export const ModelApi = z.enum(["responses", "chat", "completion"]);
export type ModelApi = z.infer<typeof ModelApi>;

/**
 * Default AI SDK call settings, baked into the model handle in
 * {@link createCatalog} via `defaultSettingsMiddleware`. They map 1:1 to the
 * parameters `generateText`/`streamText` accept, so anything set here can also
 * be overridden per call. Every field is optional.
 */
export const ModelSettings = z.strictObject({
	maxOutputTokens: z.number().int().positive().optional(),
	temperature: z.number().optional(),
	topP: z.number().optional(),
	topK: z.number().int().optional(),
	presencePenalty: z.number().optional(),
	frequencyPenalty: z.number().optional(),
	stopSequences: z.array(z.string()).optional(),
	seed: z.number().int().optional(),
	// Provider-specific options, passed through untouched
	// (e.g. { openai: { reasoningEffort: "low" } }). Values must be JSON.
	providerOptions: z.record(z.string(), JsonObject).optional(),
});
export type ModelSettings = z.infer<typeof ModelSettings>;

/**
 * One model a provider serves.
 *   - `api` picks the call surface (see {@link ModelApi}); omit for the vendor
 *     default. Applies to any provider kind.
 *   - `backend`/`slug` apply to gateway providers (the `gateway.backends` key
 *     that serves it, and the path segment when it differs from `id`).
 *   - `settings` are default call settings, merged over the provider's own.
 * The schema keeps every field optional; {@link Config}'s refinement enforces
 * that the right ones are present for the provider's kind.
 */
export const Model = z.strictObject({
	id: z.string().min(1), // must match the vendor's model id (e.g. "gpt-5.6")
	api: ModelApi.optional(), // call surface; omit for the vendor default
	backend: z.string().min(1).optional(), // gateway providers only (backends key)
	slug: z.string().min(1).optional(), // gateway providers only (path override)
	settings: ModelSettings.optional(),
});
export type Model = z.infer<typeof Model>;

/**
 * A direct provider's vendor: which bundled `@ai-sdk/*` package backs it, and
 * transport overrides for its endpoint. Everything is optional — `id` defaults
 * to the provider's own id, and with no overrides the vendor SDK's defaults
 * apply (its endpoint, its key env var). The string shorthand `"vendor": "x"`
 * means `{ "id": "x" }`.
 */
export const VendorBlock = z.strictObject({
	id: Vendor.optional(), // defaults to the provider id
	baseURL: z.string().min(1).optional(), // custom endpoint (proxy, Ollama, ...)
	apiKey: ApiKey.optional(), // literal or { envVarName }; omit for the SDK default
	name: z.string().min(1).optional(), // openai-compatible metadata namespace
	// Extra headers sent with every request (merged over the vendor SDK's own,
	// same-name wins). An inline value may embed the key via "{apiKey}".
	headers: RequestHeaders.optional(),
	// Query params appended to every request URL, e.g. { "api-version": "..." }.
	query: QueryParams.optional(),
});
export type VendorBlock = z.infer<typeof VendorBlock>;

/**
 * A provider and the models it serves. Exactly one kind:
 *   - **direct** — no `gateway` block. Its vendor is `vendor` (string shorthand
 *     or a {@link VendorBlock}), defaulting to `id`, and it calls the bundled
 *     `@ai-sdk/*` package straight.
 *   - **gateway** — a `gateway` block routes it through your own gateway (its
 *     models then require a `backend`). `vendor` must not be set.
 *   - **resolver** — a provider whose vendor is not built in is resolved by a
 *     `resolve` override passed to `createCatalog` (e.g. Amazon Bedrock).
 */
export const Provider = z.strictObject({
	id: z.string().min(1), // becomes the registry prefix => "openai:gpt-5.6"
	vendor: z.union([Vendor, VendorBlock]).optional(), // direct providers only
	gateway: GatewayOptions.optional(), // gateway providers only
	// Default call settings inherited by every model in this provider. Each
	// model's own `settings` are merged on top (model wins). Optional.
	settings: ModelSettings.optional(),
	models: z.array(Model).min(1),
});
export type Provider = z.infer<typeof Provider>;

/** A role's target, spelled out as an object. */
export const RoleTarget = z.strictObject({
	provider: z.string().min(1),
	model: z.string().min(1),
});
export type RoleTarget = z.infer<typeof RoleTarget>;

/**
 * A role points at exactly one provider+model pair: either the shorthand string
 * `"provider:model"` (split at the first `:`, so model ids may contain colons),
 * or a {@link RoleTarget} object. Both forms are equivalent.
 */
export const RoleRef = z.union([
	z.string().regex(/^[^:]+:./u, 'expected "provider:model"'),
	RoleTarget,
]);
export type RoleRef = z.infer<typeof RoleRef>;

/**
 * Structural validation lives in the field schemas above. Whole-config
 * invariants (uniqueness, gateway/backend coherence, referential integrity)
 * need the full object, so they live in `configInvariants` (see invariants.ts),
 * wired in as the refinement here.
 */
export const Config = z
	.strictObject({
		// Optional editor pointer to the JSON Schema; ignored at runtime.
		$schema: z.string().optional(),
		providers: z.array(Provider).min(1),
		roles: z.record(z.string(), RoleRef), // role name -> target
	})
	.superRefine(configInvariants);

export type Config = z.infer<typeof Config>;

/** Stable address used everywhere: `${providerId}:${modelId}`. */
export type ModelKey = `${string}:${string}`;

// Re-exported from its own module (it is shared with the gateway backends) so
// consumers keep importing everything schema-shaped from one place.
export { Vendor } from "./vendor-ids.ts";
