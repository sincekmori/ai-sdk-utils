// Copyright 2026 Shinsuke Mori
// SPDX-License-Identifier: Apache-2.0

import type { LanguageModel } from "ai";
import * as z from "zod";

import { GatewayOptions } from "./backends.ts";

/**
 * Single source of truth for LLM providers, their models, and the role
 * assignments the app uses.
 *
 * The base form is declarative: list `providers`, the `models` each serves, and
 * the `roles` your app references. A provider resolves in one of three ways:
 *
 *   - **direct** — a bundled `@ai-sdk/*` vendor used straight (e.g. `openai`).
 *     The default: `{ id: openai }` calls `@ai-sdk/openai` directly. Override
 *     the endpoint with `baseURL` / `apiKey` if needed.
 *   - **gateway** — add a `gateway` block describing your own LLM gateway's
 *     topology and tag each model with its `backend`; it routes there instead.
 *   - **resolver** — a provider whose auth doesn't fit a bundled vendor or a
 *     bearer-token gateway (Amazon Bedrock, Google Vertex, Azure) is wired in
 *     code via `createCatalog(config, { resolvers })`.
 *
 * Validated from a plain object at startup (parsed from JSON or built in
 * code), so it works the same in Node and in the browser. Zod v4.
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
 * Resolves a provider's model id to a runtime handle. Supply one per provider
 * via `createCatalog(config, { resolvers })` for a provider that is neither a
 * built-in vendor nor a `gateway` block — for example Amazon Bedrock, Google
 * Vertex, or Azure, whose auth doesn't fit a bearer token. `api` is the model's
 * {@link ModelApi} (undefined when the config omits it), so the resolver can
 * pick the call surface.
 */
export type ProviderResolver = (modelId: string, api?: ModelApi) => LanguageModel;

/**
 * A bundled `@ai-sdk/*` provider. Used as a **direct** provider's vendor and as
 * a gateway **backend**. The OpenAI-compatible family (Fireworks, Together,
 * Cerebras, DeepInfra, Ollama, ...) is covered by `openai-compatible`.
 * Bedrock / Vertex / Azure are intentionally omitted: their bespoke cloud auth
 * doesn't fit here — wire them through a custom resolver instead.
 */
export const Vendor = z.enum([
	"anthropic",
	"openai",
	"openai-compatible",
	"mistral",
	"cohere",
	"groq",
	"xai",
	"deepseek",
	"perplexity",
	"google",
]);
export type Vendor = z.infer<typeof Vendor>;

/**
 * Default AI SDK call settings, baked into the model handle in
 * {@link createCatalog} via `defaultSettingsMiddleware`. They map 1:1 to the
 * parameters `generateText`/`streamText` accept, so anything set here can also
 * be overridden per call. Every field is optional.
 */
export const ModelSettings = z.object({
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
 *   - `backend`/`slug` apply to gateway providers (which upstream serves it, and
 *     the path segment when it differs from `id`).
 *   - `settings` are default call settings, merged over the provider's own.
 * The schema keeps every field optional; {@link Config}'s refinement enforces
 * that the right ones are present for the provider's kind.
 */
export const Model = z.object({
	id: z.string().min(1), // must match the vendor's model id (e.g. "gpt-5.6")
	api: ModelApi.optional(), // call surface; omit for the vendor default
	backend: Vendor.optional(), // gateway providers only
	slug: z.string().min(1).optional(), // gateway providers only (path override)
	settings: ModelSettings.optional(),
});
export type Model = z.infer<typeof Model>;

/**
 * A provider and the models it serves.
 *   - Add a `gateway` block to route it through your own gateway (its models
 *     then require a `backend`).
 *   - Otherwise it is a **direct** provider: its vendor is `vendor ?? id` and it
 *     calls the bundled `@ai-sdk/*` package straight. `baseURL` / `apiKey` /
 *     `apiKeyEnvVarName` override the vendor's endpoint and key; `name` sets the
 *     metadata namespace for `openai-compatible`.
 *   - A provider whose vendor is not built in is resolved by a custom resolver
 *     passed to `createCatalog` (e.g. Amazon Bedrock, with its bespoke auth).
 */
export const Provider = z.object({
	id: z.string().min(1), // becomes the registry prefix => "openai:gpt-5.6"
	// Direct-vendor fields (ignored when `gateway` is set):
	vendor: Vendor.optional(), // defaults to `id`
	baseURL: z.string().min(1).optional(),
	apiKey: z.string().optional(),
	apiKeyEnvVarName: z.string().min(1).optional(),
	name: z.string().min(1).optional(), // openai-compatible metadata name
	// Gateway field:
	gateway: GatewayOptions.optional(),
	// Default call settings inherited by every model in this provider. Each
	// model's own `settings` are merged on top (model wins). Optional.
	settings: ModelSettings.optional(),
	models: z.array(Model).min(1),
});
export type Provider = z.infer<typeof Provider>;

/** A role points at exactly one provider+model pair. */
export const RoleRef = z.object({
	provider: z.string().min(1),
	model: z.string().min(1),
});
export type RoleRef = z.infer<typeof RoleRef>;

/**
 * Structural validation lives in the field schemas above. Whole-config
 * invariants (uniqueness, gateway/backend coherence, referential integrity)
 * live in the refinement below, where the full object is available.
 */
export const Config = z
	.object({
		providers: z.array(Provider).min(1),
		roles: z.record(z.string(), RoleRef), // role name -> { provider, model }
	})
	.superRefine((cfg, ctx) => {
		// 1. provider id uniqueness, model id uniqueness, and per-kind coherence
		const providerIds = new Set<string>();
		for (const [i, p] of cfg.providers.entries()) {
			if (providerIds.has(p.id)) {
				ctx.addIssue({
					code: "custom",
					message: `Duplicate provider id "${p.id}".`,
					path: ["providers", i, "id"],
					input: p.id,
				});
			}
			providerIds.add(p.id);

			const isGateway = p.gateway !== undefined;
			if (isGateway) {
				// A gateway provider configures its endpoint/key inside the `gateway`
				// block; the direct-vendor fields don't apply and would be ignored.
				for (const field of ["vendor", "baseURL", "apiKey", "apiKeyEnvVarName", "name"] as const) {
					if (p[field] !== undefined) {
						ctx.addIssue({
							code: "custom",
							message: `Provider "${p.id}" sets "${field}" alongside "gateway"; put it inside the "gateway" block, or drop the "gateway" block.`,
							path: ["providers", i, field],
							input: p[field],
						});
					}
				}
			} else if ((p.vendor ?? p.id) === "openai-compatible" && p.baseURL === undefined) {
				// The OpenAI-compatible vendor has no canonical endpoint.
				ctx.addIssue({
					code: "custom",
					message: `Provider "${p.id}" uses the "openai-compatible" vendor and must set a "baseURL".`,
					path: ["providers", i, "baseURL"],
					input: p.baseURL,
				});
			}

			const modelIds = new Set<string>();
			for (const [j, m] of p.models.entries()) {
				if (modelIds.has(m.id)) {
					ctx.addIssue({
						code: "custom",
						message: `Duplicate model id "${m.id}" in provider "${p.id}".`,
						path: ["providers", i, "models", j, "id"],
						input: m.id,
					});
				}
				modelIds.add(m.id);

				if (isGateway) {
					// gateway model must name a backend, and that backend must be configured
					if (m.backend === undefined) {
						ctx.addIssue({
							code: "custom",
							message: `Model "${m.id}" in gateway provider "${p.id}" must set a "backend".`,
							path: ["providers", i, "models", j, "backend"],
							input: m,
						});
					} else if (!p.gateway?.backends[m.backend]) {
						ctx.addIssue({
							code: "custom",
							message: `Model "${m.id}" uses backend "${m.backend}", but "${p.id}.gateway.backends.${m.backend}" is not configured.`,
							path: ["providers", i, "models", j, "backend"],
							input: m.backend,
						});
					}
				} else {
					// direct/resolver model must not carry gateway-only fields
					if (m.backend !== undefined) {
						ctx.addIssue({
							code: "custom",
							message: `Model "${m.id}" sets "backend", but provider "${p.id}" has no "gateway" block.`,
							path: ["providers", i, "models", j, "backend"],
							input: m.backend,
						});
					}
					if (m.slug !== undefined) {
						ctx.addIssue({
							code: "custom",
							message: `Model "${m.id}" sets "slug", but provider "${p.id}" has no "gateway" block.`,
							path: ["providers", i, "models", j, "slug"],
							input: m.slug,
						});
					}
				}
			}
		}

		// 2. every role must reference an existing provider+model
		const index = new Map(cfg.providers.map((p) => [p.id, new Set(p.models.map((m) => m.id))]));
		for (const [role, ref] of Object.entries(cfg.roles)) {
			const models = index.get(ref.provider);
			if (!models) {
				ctx.addIssue({
					code: "custom",
					message: `Role "${role}" references unknown provider "${ref.provider}".`,
					path: ["roles", role, "provider"],
					input: ref.provider,
				});
			} else if (!models.has(ref.model)) {
				ctx.addIssue({
					code: "custom",
					message: `Role "${role}" references unknown model "${ref.provider}:${ref.model}".`,
					path: ["roles", role, "model"],
					input: ref.model,
				});
			}
		}
	});

export type Config = z.infer<typeof Config>;

/** Stable address used everywhere: `${providerId}:${modelId}`. */
export type ModelKey = `${string}:${string}`;
