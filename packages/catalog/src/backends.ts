// Copyright 2026 Shinsuke Mori
// SPDX-License-Identifier: Apache-2.0

import * as z from "zod";

import { ApiKeySchema, QueryParamsSchema, RequestHeadersSchema } from "./headers.ts";
import { VendorSchema } from "./vendor-ids.ts";

/**
 * Gateway topology schemas: how each upstream backend is laid out on your own
 * LLM gateway. Used by a provider's `gateway` block (see {@link GatewayOptions}).
 * Nothing here is provider-specific beyond the vendor each backend speaks — the
 * URLs, path layouts, regions, and model ids are all yours to supply.
 *
 * Zod v4.
 */

/**
 * One upstream backend on the gateway. Backends live in a map under a key of
 * your choice, so the same vendor can appear more than once (e.g. two regions);
 * each model picks its backend by that key via `backend`.
 *
 * `pathTemplate` is appended to the gateway's `baseURL` and must contain
 * `{slug}`, replaced per request with the model's slug. For every vendor except
 * `google` the model also travels in the request body, so the path is fixed per
 * backend. For `google` the model lives in the URL (`/models/{model}:{method}`),
 * so the template must also contain `{action}` and the whole URL is rewritten —
 * including the streaming/non-streaming method switch via `actionMap`.
 */
export const GatewayBackendSchema = z
	.strictObject({
		// The upstream vendor this backend speaks.
		vendor: VendorSchema,
		// Path appended to the gateway's baseURL, e.g. "anthropic/{slug}" or
		// "google/eu/{slug}:{action}". A region is just a path segment you write in.
		pathTemplate: z
			.string()
			.min(1)
			.refine((t) => t.includes("{slug}"), {
				message: 'pathTemplate must contain the "{slug}" placeholder',
			}),
		// google only: renames the Gemini method to your gateway's action name,
		// e.g. { streamGenerateContent: "customStreamGenerateContent" }. Methods
		// not listed pass through unchanged.
		actionMap: z.record(z.string(), z.string()).optional(),
		// openai-compatible only: provider name used for metadata namespacing.
		// Defaults to "openai-compatible".
		name: z.string().min(1).optional(),
		// openai-compatible only: the upstream supports JSON-schema structured
		// outputs.
		supportsStructuredOutputs: z.boolean().optional(),
		// openai-compatible only: ask for usage in streaming responses
		// (`stream_options: { include_usage: true }`).
		includeUsage: z.boolean().optional(),
		// Extra headers / query params for this backend only, merged over the
		// gateway-level ones (backend wins per name).
		headers: RequestHeadersSchema.optional(),
		query: QueryParamsSchema.optional(),
	})
	.superRefine((backend, ctx) => {
		if (backend.vendor === "google") {
			if (!backend.pathTemplate.includes("{action}")) {
				ctx.addIssue({
					code: "custom",
					message:
						'a "google" backend\'s pathTemplate must also contain the "{action}" placeholder',
					path: ["pathTemplate"],
					input: backend.pathTemplate,
				});
			}
		} else if (backend.actionMap !== undefined) {
			ctx.addIssue({
				code: "custom",
				message: '"actionMap" applies only to a "google" backend',
				path: ["actionMap"],
				input: backend.actionMap,
			});
		}
		for (const field of ["name", "supportsStructuredOutputs", "includeUsage"] as const) {
			if (backend[field] !== undefined && backend.vendor !== "openai-compatible") {
				ctx.addIssue({
					code: "custom",
					message: `"${field}" applies only to an "openai-compatible" backend`,
					path: [field],
					input: backend[field],
				});
			}
		}
	});
export type GatewayBackend = z.infer<typeof GatewayBackendSchema>;

/**
 * The topology of a provider that lives behind your own LLM gateway: where it
 * lives, the key, and how each upstream backend is laid out on it. The models
 * live at the provider level (tagged with `backend`). Presence of this block is
 * what makes a provider gateway-routed.
 */
export const GatewayOptionsSchema = z.strictObject({
	// Base URL of the gateway, e.g. "https://gateway.example.com/v1".
	baseURL: z.string().min(1),
	// API key for the gateway: a literal string, or { "envVarName": "..." }.
	// Omitted, the "AI_GATEWAY_API_KEY" environment variable is read instead.
	apiKey: ApiKeySchema.optional(),
	// Extra headers sent with every request to the gateway (all backends).
	// An inline value may embed the gateway key via "{apiKey}", e.g.
	// { "Authorization": "Bearer {apiKey}" }.
	headers: RequestHeadersSchema.optional(),
	// Query params appended to every request URL (after the path rewriting),
	// e.g. { "api-version": "2026-01-01" }.
	query: QueryParamsSchema.optional(),
	// The upstream backends, under keys of your choice (see GatewayBackendSchema).
	backends: z.record(z.string().min(1), GatewayBackendSchema),
});
export type GatewayOptions = z.infer<typeof GatewayOptionsSchema>;
