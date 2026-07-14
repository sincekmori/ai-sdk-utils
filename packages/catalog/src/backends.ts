// Copyright 2026 Shinsuke Mori
// SPDX-License-Identifier: Apache-2.0

import * as z from "zod";

import { QueryParams, RequestHeaders } from "./headers.ts";

/**
 * Gateway topology schemas: how each upstream backend is laid out on your own
 * LLM gateway. Used by a provider's `gateway` block (see {@link GatewayOptions}).
 * Nothing here is provider-specific beyond the backend names — the URLs, path
 * layouts, regions, and model ids are all yours to supply.
 *
 * Zod v4.
 */

/**
 * A path template for a fixed-path backend, appended to the gateway's `baseURL`.
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
 * Shared shape for fixed-path backends: the model is carried in the request
 * body, so the URL slug is substituted per request. Covers every backend except
 * `google` (whose model lives in the URL).
 */
export const FixedPathBackend = z.object({
	pathTemplate: fixedPathTemplate,
	// Extra headers / query params for this backend only, merged over the
	// gateway-level ones (backend wins per name).
	headers: RequestHeaders.optional(),
	query: QueryParams.optional(),
});
export type FixedPathBackend = z.infer<typeof FixedPathBackend>;

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
	// `{ streamGenerateContent: "customStreamGenerateContent" }`. Methods not
	// listed pass through unchanged.
	actionMap: z.record(z.string(), z.string()).optional(),
	// Extra headers / query params for this backend only, merged over the
	// gateway-level ones (backend wins per name).
	headers: RequestHeaders.optional(),
	query: QueryParams.optional(),
});
export type GoogleBackend = z.infer<typeof GoogleBackend>;

/** How each upstream backend is laid out on the gateway. */
export const Backends = z.object({
	anthropic: FixedPathBackend.optional(),
	openai: FixedPathBackend.optional(),
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
 * The topology of a provider that lives behind your own LLM gateway: where it
 * lives, the key, and how each upstream backend is laid out on it. The models
 * live at the provider level (tagged with `backend`). Presence of this block is
 * what makes a provider gateway-routed.
 */
export const GatewayOptions = z.object({
	// Base URL of the gateway, e.g. "https://gateway.example.com/v1".
	baseURL: z.string().min(1),
	// API key for the gateway. Falls back to `apiKeyEnvVarName` when omitted.
	apiKey: z.string().optional(),
	// Environment variable read for the key when `apiKey` is not set.
	// Defaults to "AI_GATEWAY_API_KEY".
	apiKeyEnvVarName: z.string().min(1).optional(),
	// Extra headers sent with every request to the gateway (all backends).
	// An inline value may embed the gateway key via "{apiKey}", e.g.
	// { "Authorization": "Bearer {apiKey}" }; `{ "envVarName": "..." }` reads
	// the value from that environment variable at first use.
	headers: RequestHeaders.optional(),
	// Query params appended to every request URL (after the path rewriting),
	// e.g. { "api-version": "2026-01-01" }.
	query: QueryParams.optional(),
	backends: Backends,
});
export type GatewayOptions = z.infer<typeof GatewayOptions>;
