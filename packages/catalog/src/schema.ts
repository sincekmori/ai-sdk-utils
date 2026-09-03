// Copyright 2026 Shinsuke Mori
// SPDX-License-Identifier: Apache-2.0

import * as z from "zod";

import { GatewayOptionsSchema } from "./backends.ts";
import { ApiKeySchema, QueryParamsSchema, RequestHeadersSchema } from "./headers.ts";
import { configInvariants } from "./invariants.ts";
import { VendorSchema } from "./vendor-ids.ts";

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
const JsonObjectSchema = z.record(z.string(), z.json());

/**
 * A sane price: nonnegative, and bounded above the most expensive model ever
 * listed on models.dev — a lone $600/1M legacy outlier; current flagships top
 * out around $180/1M — so a unit mix-up (per 1K, per-token, cents) fails
 * validation instead of silently inflating every estimate.
 */
const PriceSchema = z
	.number()
	.nonnegative()
	.max(1000, "unrealistically large — prices are USD per 1 MILLION tokens");

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
export const ModelApiSchema = z.enum(["responses", "chat", "completion"]);
export type ModelApi = z.infer<typeof ModelApiSchema>;

/**
 * Default AI SDK call settings, baked into the model handle in
 * {@link createCatalog} via `defaultSettingsMiddleware`. They map 1:1 to the
 * parameters `generateText`/`streamText` accept, so anything set here can also
 * be overridden per call. Every field is optional.
 */
export const ModelSettingsSchema = z.strictObject({
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
	providerOptions: z.record(z.string(), JsonObjectSchema).optional(),
});
export type ModelSettings = z.infer<typeof ModelSettingsSchema>;

/**
 * What one model run costs, in the billing buckets of models.dev
 * (https://models.dev, the community model database): **USD per 1 million
 * tokens**, one price per bucket, spelled in this config's own camelCase
 * (models.dev writes `cache_read`/`cache_write`). `input` prices the
 * NON-cached input — cache reads and writes are their own buckets — so with
 * token counts kept in the same four buckets, a run's cost is the plain dot
 * product: Σ tokens[bucket] × cost[bucket] / 1e6. Every field is optional;
 * an absent bucket has no price. A model that omits `cost` entirely gets the
 * embedded models.dev sheet for its vendor and id when one exists (see
 * {@link Model}); a `cost` still absent after that reads as "unknown or
 * free" — local models simply have no sheet.
 */
export const ModelCostSchema = z.strictObject({
	input: PriceSchema.optional(),
	output: PriceSchema.optional(),
	cacheRead: PriceSchema.optional(),
	cacheWrite: PriceSchema.optional(),
});
export type ModelCost = z.infer<typeof ModelCostSchema>;

/**
 * One model a provider serves.
 *   - `api` picks the call surface (see {@link ModelApi}); omit for the vendor
 *     default. Applies to any provider kind.
 *   - `backend`/`slug` apply to gateway providers (the `gateway.backends` key
 *     that serves it, and the path segment when it differs from `id`).
 *   - `settings` are default call settings, merged over the provider's own.
 *   - `cost` is the model's price sheet (see {@link ModelCost}); declarative
 *     metadata — the catalog never computes with it, it is read back via
 *     `meta`/`metaForRole` for the app's own cost accounting. Omitted, it is
 *     filled from an embedded models.dev snapshot when the model's vendor and
 *     id are known there; an explicit `cost` always wins.
 * The schema keeps every field optional; {@link ConfigSchema}'s refinement enforces
 * that the right ones are present for the provider's kind.
 */
export const ModelSchema = z.strictObject({
	id: z.string().min(1), // must match the vendor's model id (e.g. "gpt-5.6")
	api: ModelApiSchema.optional(), // call surface; omit for the vendor default
	backend: z.string().min(1).optional(), // gateway providers only (backends key)
	slug: z.string().min(1).optional(), // gateway providers only (path override)
	settings: ModelSettingsSchema.optional(),
	cost: ModelCostSchema.optional(), // USD per 1M tokens, models.dev vocabulary
});
export type Model = z.infer<typeof ModelSchema>;

/**
 * A direct provider's vendor: which bundled `@ai-sdk/*` package backs it, and
 * transport overrides for its endpoint. Everything is optional — `id` defaults
 * to the provider's own id, and with no overrides the vendor SDK's defaults
 * apply (its endpoint, its key env var). The string shorthand `"vendor": "x"`
 * means `{ "id": "x" }`.
 */
export const VendorBlockSchema = z.strictObject({
	id: VendorSchema.optional(), // defaults to the provider id
	baseURL: z.string().min(1).optional(), // custom endpoint (proxy, Ollama, ...)
	apiKey: ApiKeySchema.optional(), // literal or { envVarName }; omit for the SDK default
	name: z.string().min(1).optional(), // openai-compatible metadata namespace
	// openai-compatible only: the server supports JSON-schema structured outputs.
	supportsStructuredOutputs: z.boolean().optional(),
	// openai-compatible only: ask for usage in streaming responses
	// (`stream_options: { include_usage: true }`).
	includeUsage: z.boolean().optional(),
	// Extra headers sent with every request (merged over the vendor SDK's own,
	// same-name wins). An inline value may embed the key via "{apiKey}".
	headers: RequestHeadersSchema.optional(),
	// Query params appended to every request URL, e.g. { "api-version": "..." }.
	query: QueryParamsSchema.optional(),
});
export type VendorBlock = z.infer<typeof VendorBlockSchema>;

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
export const ProviderSchema = z.strictObject({
	id: z.string().min(1), // becomes the registry prefix => "openai:gpt-5.6"
	vendor: z.union([VendorSchema, VendorBlockSchema]).optional(), // direct providers only
	gateway: GatewayOptionsSchema.optional(), // gateway providers only
	// Default call settings inherited by every model in this provider. Each
	// model's own `settings` are merged on top (model wins). Optional.
	settings: ModelSettingsSchema.optional(),
	models: z.array(ModelSchema).min(1),
});
export type Provider = z.infer<typeof ProviderSchema>;

/** A role's target, spelled out as an object. */
export const RoleTargetSchema = z.strictObject({
	provider: z.string().min(1),
	model: z.string().min(1),
});
export type RoleTarget = z.infer<typeof RoleTargetSchema>;

/**
 * A role points at exactly one provider+model pair: either the shorthand string
 * `"provider:model"` (split at the first `:`, so model ids may contain colons),
 * or a {@link RoleTarget} object. Both forms are equivalent.
 */
export const RoleRefSchema = z.union([
	z.string().regex(/^[^:]+:./u, 'expected "provider:model"'),
	RoleTargetSchema,
]);
export type RoleRef = z.infer<typeof RoleRefSchema>;

/**
 * Structural validation lives in the field schemas above. Whole-config
 * invariants (uniqueness, gateway/backend coherence, referential integrity)
 * need the full object, so they live in `configInvariants` (see invariants.ts),
 * wired in as the refinement here.
 */
export const ConfigSchema = z
	.strictObject({
		// Optional editor pointer to the JSON Schema; ignored at runtime.
		$schema: z.string().optional(),
		providers: z.array(ProviderSchema).min(1),
		roles: z.record(z.string(), RoleRefSchema), // role name -> target
	})
	.superRefine(configInvariants);

export type Config = z.infer<typeof ConfigSchema>;

/** Stable address used everywhere: `${providerId}:${modelId}`. */
export type ModelKey = `${string}:${string}`;

// Re-exported from its own module (it is shared with the gateway backends) so
// consumers keep importing everything schema-shaped from one place.
export { type Vendor, VendorSchema } from "./vendor-ids.ts";
