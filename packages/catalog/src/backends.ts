// Copyright 2026 Shinsuke Mori
// SPDX-License-Identifier: Apache-2.0

import * as z from "zod";

import { ApiKey, QueryParams, RequestHeaders } from "./headers.ts";
import { Vendor } from "./vendor-ids.ts";

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
export const GatewayBackend = z
	.strictObject({
		// The upstream vendor this backend speaks.
		vendor: Vendor,
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
		// Extra headers / query params for this backend only, merged over the
		// gateway-level ones (backend wins per name).
		headers: RequestHeaders.optional(),
		query: QueryParams.optional(),
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
		if (backend.name !== undefined && backend.vendor !== "openai-compatible") {
			ctx.addIssue({
				code: "custom",
				message: '"name" applies only to an "openai-compatible" backend',
				path: ["name"],
				input: backend.name,
			});
		}
	});
export type GatewayBackend = z.infer<typeof GatewayBackend>;

/**
 * The topology of a provider that lives behind your own LLM gateway: where it
 * lives, the key, and how each upstream backend is laid out on it. The models
 * live at the provider level (tagged with `backend`). Presence of this block is
 * what makes a provider gateway-routed.
 */
export const GatewayOptions = z.strictObject({
	// Base URL of the gateway, e.g. "https://gateway.example.com/v1".
	baseURL: z.string().min(1),
	// API key for the gateway: a literal string, or { "envVarName": "..." }.
	// Omitted, the "AI_GATEWAY_API_KEY" environment variable is read instead.
	apiKey: ApiKey.optional(),
	// Extra headers sent with every request to the gateway (all backends).
	// An inline value may embed the gateway key via "{apiKey}", e.g.
	// { "Authorization": "Bearer {apiKey}" }.
	headers: RequestHeaders.optional(),
	// Query params appended to every request URL (after the path rewriting),
	// e.g. { "api-version": "2026-01-01" }.
	query: QueryParams.optional(),
	// The upstream backends, under keys of your choice (see GatewayBackend).
	backends: z.record(z.string().min(1), GatewayBackend),
});
export type GatewayOptions = z.infer<typeof GatewayOptions>;
