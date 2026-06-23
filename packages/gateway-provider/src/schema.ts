// Copyright 2026 Shinsuke Mori
// SPDX-License-Identifier: Apache-2.0

import * as z from "zod";

/**
 * Single source of truth for a gateway's topology: where it lives, how each
 * upstream backend is laid out on it, and which models it serves.
 *
 * Validated from a plain object (parsed from YAML/JSON or built in code), so it
 * works the same in Node and in the browser. Nothing here is provider-specific
 * beyond the backend names — the URLs, path layouts, regions, and model ids are
 * all yours to supply.
 *
 * Zod v4 (package root export).
 */

/**
 * A path template for a fixed-path backend, appended to the config's `baseURL`.
 * Must contain `{slug}`, which is replaced per request with the model's slug.
 * Example: `"anthropic/{slug}"`.
 */
const fixedPathTemplate = z
	.string()
	.min(1)
	.refine((t) => t.includes("{slug}"), {
		message: 'pathTemplate must contain the "{slug}" placeholder',
	});

/**
 * The upstream AI SDK provider that serves a model. Every backend except
 * `google` carries the model in the request body (a "fixed-path" backend);
 * `google` carries it in the URL and is rewritten separately.
 *
 * The OpenAI-compatible family (Groq, xAI, DeepSeek, Fireworks, Together,
 * Cerebras, DeepInfra, Ollama, ...) is covered by the generic
 * `openai-compatible` backend — point it at the right path and list the models.
 */
export const Backend = z.enum([
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
export type Backend = z.infer<typeof Backend>;

/**
 * Which OpenAI call surface to reach a model through:
 *   - "chat"       -> `provider.chat(modelId)`        (Chat Completions)
 *   - "responses"  -> `provider.responses(modelId)`   (Responses API)
 *   - "completion" -> `provider.completion(modelId)`  (legacy Completions)
 * Most gateways expose only Chat Completions, so this defaults to "chat".
 */
export const OpenAIApi = z.enum(["chat", "responses", "completion"]);
export type OpenAIApi = z.infer<typeof OpenAIApi>;

/**
 * Shared shape for fixed-path backends (the model is carried in the request
 * body, so the URL slug is substituted per request).
 */
export const FixedPathBackend = z.object({
	pathTemplate: fixedPathTemplate,
});
export type FixedPathBackend = z.infer<typeof FixedPathBackend>;

export const OpenAIBackend = FixedPathBackend.extend({
	// Defaults to "chat" at runtime when omitted.
	api: OpenAIApi.optional(),
});
export type OpenAIBackend = z.infer<typeof OpenAIBackend>;

export const OpenAICompatibleBackend = FixedPathBackend.extend({
	// Provider name used for metadata namespacing. Defaults to "openai-compatible".
	name: z.string().min(1).optional(),
});
export type OpenAICompatibleBackend = z.infer<typeof OpenAICompatibleBackend>;

export const GoogleBackend = z.object({
	// The Google SDK already puts the model and method in the URL
	// (`/models/{model}:{method}`); this template rewrites it to your gateway's
	// layout. Must contain `{slug}` and `{action}`. A region is just a path
	// segment you write in, e.g. `"gemini/eu/{slug}:{action}"`.
	pathTemplate: z
		.string()
		.min(1)
		.refine((t) => t.includes("{slug}") && t.includes("{action}"), {
			message: 'pathTemplate must contain the "{slug}" and "{action}" placeholders',
		}),
	// Renames the Gemini method to your gateway's action name, e.g.
	// `{ streamGenerateContent: "customStreamGenerateContent" }`. Methods not listed
	// pass through unchanged.
	actionMap: z.record(z.string(), z.string()).optional(),
});
export type GoogleBackend = z.infer<typeof GoogleBackend>;

export const Backends = z.object({
	anthropic: FixedPathBackend.optional(),
	openai: OpenAIBackend.optional(),
	"openai-compatible": OpenAICompatibleBackend.optional(),
	mistral: FixedPathBackend.optional(),
	cohere: FixedPathBackend.optional(),
	groq: FixedPathBackend.optional(),
	xai: FixedPathBackend.optional(),
	deepseek: FixedPathBackend.optional(),
	perplexity: FixedPathBackend.optional(),
	google: GoogleBackend.optional(),
});
export type Backends = z.infer<typeof Backends>;

/**
 * One model the gateway serves. `id` is what callers pass and what the upstream
 * SDK sends in the request body; `slug` overrides the path segment when the
 * gateway endpoint differs from the id (defaults to `id`).
 */
export const ModelRoute = z.object({
	id: z.string().min(1),
	backend: Backend,
	slug: z.string().min(1).optional(),
});
export type ModelRoute = z.infer<typeof ModelRoute>;

/**
 * Structural validation lives in the field schemas above. Whole-config
 * invariants (unique model ids + every used backend is configured) live in the
 * refinement below, where the full object is available.
 */
export const GatewayConfig = z
	.object({
		// Base URL of the gateway, e.g. "https://gateway.example.com/v1".
		baseURL: z.string().min(1),
		// API key for the gateway. Falls back to `apiKeyEnvVarName` when omitted.
		apiKey: z.string().optional(),
		// Environment variable read for the key when `apiKey` is not set.
		// Defaults to "AI_GATEWAY_API_KEY".
		apiKeyEnvVarName: z.string().min(1).optional(),
		backends: Backends,
		models: z.array(ModelRoute).min(1),
	})
	.superRefine((cfg, ctx) => {
		const ids = new Set<string>();
		for (const [i, m] of cfg.models.entries()) {
			if (ids.has(m.id)) {
				ctx.addIssue({
					code: "custom",
					message: `Duplicate model id "${m.id}".`,
					path: ["models", i, "id"],
					input: m.id,
				});
			}
			ids.add(m.id);

			if (!cfg.backends[m.backend]) {
				ctx.addIssue({
					code: "custom",
					message: `Model "${m.id}" uses backend "${m.backend}", but "backends.${m.backend}" is not configured.`,
					path: ["models", i, "backend"],
					input: m.backend,
				});
			}
		}
	});
export type GatewayConfig = z.infer<typeof GatewayConfig>;
