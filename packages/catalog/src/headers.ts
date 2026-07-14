// Copyright 2026 Shinsuke Mori
// SPDX-License-Identifier: Apache-2.0

import { loadSetting } from "@ai-sdk/provider-utils";
import * as z from "zod";

/**
 * Extra request headers and query parameters, declared in the config. Both are
 * aimed at enterprise gateways whose transport needs more than a bearer token:
 * an APIM-style subscription-key header, tenant/routing headers, or a mandatory
 * `?api-version=...` on every request.
 *
 * Zod v4.
 */

/**
 * One header value:
 *   - a **string**, sent as-is — except the {@link API_KEY_PLACEHOLDER}
 *     `{apiKey}` inside it, which is replaced with the provider's resolved API
 *     key (e.g. `"Bearer {apiKey}"`).
 *   - `{ "envVarName": "..." }` — read from that environment variable when the
 *     provider is first used (same laziness as the API key), sent verbatim.
 */
export const HeaderValue = z.union([
	z.string().min(1),
	z.object({ envVarName: z.string().min(1) }),
]);
export type HeaderValue = z.infer<typeof HeaderValue>;

/**
 * Extra request headers, by header name. Merged into every request the
 * provider (or gateway backend) makes, on top of the vendor SDK's own headers —
 * so a header named here overrides the SDK's (e.g. an explicit `x-api-key`).
 */
export const RequestHeaders = z.record(z.string().min(1), HeaderValue);
export type RequestHeaders = z.infer<typeof RequestHeaders>;

/**
 * Query parameters appended to every request URL (for a gateway, after the
 * path rewriting). A parameter already present in the URL is overridden.
 * Values are plain text — don't put secrets in URLs; use a header instead.
 */
export const QueryParams = z.record(z.string().min(1), z.string());
export type QueryParams = z.infer<typeof QueryParams>;

/** Placeholder in a string header value, replaced with the resolved API key. */
export const API_KEY_PLACEHOLDER = "{apiKey}";

/** True when any inline header value references the {@link API_KEY_PLACEHOLDER}. */
export function headersNeedApiKey(headers: RequestHeaders): boolean {
	return Object.values(headers).some(
		(value) => typeof value === "string" && value.includes(API_KEY_PLACEHOLDER),
	);
}

/** Options for {@link resolveHeaders}. */
export interface ResolveHeadersOptions {
	/** Substituted for `{apiKey}` in inline values. */
	apiKey?: string;
	/** Names the owner in error messages, e.g. `provider "acme"`. */
	description: string;
}

/**
 * Resolves configured headers to the concrete values handed to the vendor SDK:
 * env-var values are read (throwing a readable error when unset) and `{apiKey}`
 * is substituted into inline values. Called lazily, alongside the API key, when
 * the provider is first used.
 */
export function resolveHeaders(
	headers: RequestHeaders,
	options: ResolveHeadersOptions,
): Record<string, string> {
	const { apiKey, description } = options;
	const resolved: Record<string, string> = {};
	for (const [name, value] of Object.entries(headers)) {
		if (typeof value === "string") {
			if (value.includes(API_KEY_PLACEHOLDER) && apiKey === undefined) {
				throw new Error(
					`Header "${name}" for ${description} uses "${API_KEY_PLACEHOLDER}", but no "apiKey" or "apiKeyEnvVarName" is configured.`,
				);
			}
			resolved[name] = apiKey === undefined ? value : value.replaceAll(API_KEY_PLACEHOLDER, apiKey);
		} else {
			resolved[name] = loadSetting({
				settingValue: undefined,
				environmentVariableName: value.envVarName,
				settingName: `headers["${name}"]`,
				description: `Header "${name}" for ${description}`,
			});
		}
	}
	return resolved;
}

/**
 * Merges two header maps (override wins per name) and resolves them like
 * {@link resolveHeaders}. Returns undefined when both are absent, so the vendor
 * SDK sees no headers option at all in the common case.
 */
export function mergeAndResolveHeaders(
	base: RequestHeaders | undefined,
	override: RequestHeaders | undefined,
	options: ResolveHeadersOptions,
): Record<string, string> | undefined {
	const merged: RequestHeaders = { ...base, ...override };
	return Object.keys(merged).length > 0 ? resolveHeaders(merged, options) : undefined;
}
