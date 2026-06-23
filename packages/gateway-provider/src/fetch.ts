// Copyright 2026 Shinsuke Mori
// SPDX-License-Identifier: Apache-2.0

import type { FetchFunction } from "@ai-sdk/provider-utils";

import type { GoogleBackend } from "./schema.ts";

/**
 * Placeholder substituted into a fixed-path backend's `baseURL` in place of the
 * model slug. A single fixed-path provider instance serves several models, so
 * the real slug is resolved per request from the request body (which carries the
 * `model` field) and substituted by {@link createBodyModelFetch}.
 */
export const MODEL_SLUG_PLACEHOLDER = "__ai_sdk_gateway_model_slug__";

/**
 * Wraps fetch for fixed-path backends (every backend except Google): the URL
 * path is fixed per provider instance, so the model is read from the request
 * body and the {@link MODEL_SLUG_PLACEHOLDER} in the URL is rewritten to the
 * model's slug.
 *
 * Exposed for advanced wiring; `createGatewayProvider` uses it internally.
 */
export function createBodyModelFetch(slugFor: (model: string) => string): FetchFunction {
	return (input, init) => {
		const requestUrl = input instanceof Request ? input.url : input.toString();
		if (typeof init?.body === "string" && requestUrl.includes(MODEL_SLUG_PLACEHOLDER)) {
			const { model } = JSON.parse(init.body) as { model?: string };
			if (model) {
				return globalThis.fetch(
					requestUrl.replaceAll(MODEL_SLUG_PLACEHOLDER, slugFor(model)),
					init,
				);
			}
		}
		return globalThis.fetch(input, init);
	};
}

/**
 * Wraps fetch for the Google backend, whose URL already carries the model
 * (`.../models/{model}:{method}`). Rewrites it to the gateway layout described
 * by {@link GoogleBackend.pathTemplate}, renaming the method via
 * {@link GoogleBackend.actionMap} and preserving the query string (e.g.
 * `?alt=sse`).
 *
 * Exposed for advanced wiring; `createGatewayProvider` uses it internally.
 */
export function createGeminiFetch(
	baseURL: string,
	backend: GoogleBackend,
	slugFor: (model: string) => string,
): FetchFunction {
	return (input, init) => {
		const requestUrl = new URL(input instanceof Request ? input.url : input.toString());
		const match = requestUrl.pathname.match(/\/models\/(?<model>[^:]+):(?<method>\w+)/u);
		if (!match?.groups) {
			return globalThis.fetch(input, init);
		}
		const { model, method } = match.groups;
		const action = backend.actionMap?.[method] ?? method;
		const path = backend.pathTemplate
			.replace(/^\/+/u, "")
			.replaceAll("{slug}", slugFor(model))
			.replaceAll("{action}", action);
		return globalThis.fetch(`${baseURL}/${path}${requestUrl.search}`, init);
	};
}
