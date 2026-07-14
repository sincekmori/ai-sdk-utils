// Copyright 2026 Shinsuke Mori
// SPDX-License-Identifier: Apache-2.0

import type * as z from "zod";

import { API_KEY_PLACEHOLDER, headersNeedApiKey } from "./headers.ts";
import type { Provider, RoleRef } from "./schema.ts";

/**
 * Whole-config invariants for {@link Config}: uniqueness, gateway/backend
 * coherence, and referential integrity. Structural validation lives in the
 * field schemas; these checks need the full object, so they run in the
 * schema's `superRefine`.
 */

/** The shape `Config`'s refinement receives (its base object, pre-refinement). */
interface ConfigShape {
	providers: Provider[];
	roles: Record<string, RoleRef>;
}

type Ctx = z.core.$RefinementCtx<ConfigShape>;

/** Fields of a direct provider that a gateway provider must not set. */
const DIRECT_ONLY_FIELDS = [
	"vendor",
	"baseURL",
	"apiKey",
	"apiKeyEnvVarName",
	"name",
	"headers",
	"query",
] as const;

/** Per-kind coherence of a provider's own fields. */
export function checkProviderFields(p: Provider, i: number, ctx: Ctx): void {
	if (p.gateway !== undefined) {
		// A gateway provider configures its endpoint/key inside the `gateway`
		// block; the direct-vendor fields don't apply and would be ignored.
		for (const field of DIRECT_ONLY_FIELDS) {
			if (p[field] !== undefined) {
				ctx.addIssue({
					code: "custom",
					message: `Provider "${p.id}" sets "${field}" alongside "gateway"; put it inside the "gateway" block, or drop the "gateway" block.`,
					path: ["providers", i, field],
					input: p[field],
				});
			}
		}
		return;
	}
	if ((p.vendor ?? p.id) === "openai-compatible" && p.baseURL === undefined) {
		// The OpenAI-compatible vendor has no canonical endpoint.
		ctx.addIssue({
			code: "custom",
			message: `Provider "${p.id}" uses the "openai-compatible" vendor and must set a "baseURL".`,
			path: ["providers", i, "baseURL"],
			input: p.baseURL,
		});
	}
	if (
		p.headers !== undefined &&
		headersNeedApiKey(p.headers) &&
		p.apiKey === undefined &&
		p.apiKeyEnvVarName === undefined
	) {
		// A vendor's own default key (e.g. OPENAI_API_KEY) is read inside the
		// SDK and never surfaces here, so there is nothing to substitute.
		ctx.addIssue({
			code: "custom",
			message: `Provider "${p.id}" uses "${API_KEY_PLACEHOLDER}" in "headers" but sets neither "apiKey" nor "apiKeyEnvVarName".`,
			path: ["providers", i, "headers"],
			input: p.headers,
		});
	}
}

/** Model id uniqueness and per-kind coherence of each model's fields. */
export function checkProviderModels(p: Provider, i: number, ctx: Ctx): void {
	const isGateway = p.gateway !== undefined;
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

/** The `superRefine` callback backing {@link Config}. */
export function configInvariants(cfg: ConfigShape, ctx: Ctx): void {
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
		checkProviderFields(p, i, ctx);
		checkProviderModels(p, i, ctx);
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
}
