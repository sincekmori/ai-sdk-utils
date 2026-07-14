// Copyright 2026 Shinsuke Mori
// SPDX-License-Identifier: Apache-2.0

import type { FetchFunction } from "@ai-sdk/provider-utils";

import type { GoogleBackend } from "./backends.ts";
import type { QueryParams } from "./headers.ts";

/**
 * Placeholder substituted into a fixed-path backend's `baseURL` in place of the
 * model slug. A single fixed-path provider instance serves several models, so
 * the real slug is resolved per request from the request body (which carries the
 * `model` field) and substituted by {@link createBodyModelFetch}.
 */
export const MODEL_SLUG_PLACEHOLDER = "__ai_sdk_catalog_model_slug__";

/**
 * Wraps fetch for fixed-path gateway backends (every backend except Google): the
 * URL path is fixed per provider instance, so the model is read from the request
 * body and the {@link MODEL_SLUG_PLACEHOLDER} in the URL is rewritten to the
 * model's slug.
 *
 * `baseFetch` is the fetch the rewritten request is sent through (default:
 * `globalThis.fetch`, resolved per request so later global patches still apply);
 * it sees the final gateway URL and body.
 */
export function createBodyModelFetch(
	slugFor: (model: string) => string,
	baseFetch?: FetchFunction,
): FetchFunction {
	return (input, init) => {
		const doFetch = baseFetch ?? globalThis.fetch;
		const requestUrl = input instanceof Request ? input.url : input.toString();
		if (typeof init?.body === "string" && requestUrl.includes(MODEL_SLUG_PLACEHOLDER)) {
			const { model } = JSON.parse(init.body) as { model?: string };
			if (model !== undefined && model !== "") {
				return doFetch(requestUrl.replaceAll(MODEL_SLUG_PLACEHOLDER, slugFor(model)), init);
			}
		}
		return doFetch(input, init);
	};
}

/**
 * Wraps fetch to append the configured query parameters to every request URL
 * (e.g. a gateway's mandatory `?api-version=...`). A parameter already present
 * in the URL is overridden, so the config value wins deterministically.
 *
 * In a gateway chain this sits *inside* the path-rewriting fetch (it sees the
 * final gateway URL) and *before* `baseFetch` / `globalThis.fetch`.
 */
export function createQueryFetch(query: QueryParams, baseFetch?: FetchFunction): FetchFunction {
	return (input, init) => {
		const doFetch = baseFetch ?? globalThis.fetch;
		const url = new URL(input instanceof Request ? input.url : input.toString());
		for (const [name, value] of Object.entries(query)) {
			url.searchParams.set(name, value);
		}
		return doFetch(url.toString(), init);
	};
}

/** Options for {@link createGeminiFetch}. */
export interface GeminiFetchOptions {
	/** Maps a model id to the slug substituted into the gateway path. */
	slugFor: (model: string) => string;
	/**
	 * Fetch the rewritten request is sent through (default: `globalThis.fetch`,
	 * resolved per request so later global patches still apply); it sees the
	 * final gateway URL and body.
	 */
	baseFetch?: FetchFunction;
}

/**
 * Wraps fetch for the Google gateway backend, whose URL already carries the
 * model (`.../models/{model}:{method}`). Rewrites it to the gateway layout
 * described by {@link GoogleBackend.pathTemplate}, renaming the method via
 * {@link GoogleBackend.actionMap} and preserving the query string (e.g.
 * `?alt=sse`).
 */
export function createGeminiFetch(
	baseURL: string,
	backend: GoogleBackend,
	options: GeminiFetchOptions,
): FetchFunction {
	const { slugFor, baseFetch } = options;
	return (input, init) => {
		const doFetch = baseFetch ?? globalThis.fetch;
		const requestUrl = new URL(input instanceof Request ? input.url : input.toString());
		const match = /\/models\/(?<model>[^:]+):(?<method>\w+)/u.exec(requestUrl.pathname);
		if (!match?.groups) {
			return doFetch(input, init);
		}
		const { model, method } = match.groups;
		const action = backend.actionMap?.[method] ?? method;
		const path = backend.pathTemplate
			.replace(/^\/+/u, "")
			.replaceAll("{slug}", slugFor(model))
			.replaceAll("{action}", action);
		return doFetch(`${baseURL}/${path}${requestUrl.search}`, init);
	};
}
