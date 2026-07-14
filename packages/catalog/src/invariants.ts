// Copyright 2026 Shinsuke Mori
// SPDX-License-Identifier: Apache-2.0

import type * as z from "zod";

import { API_KEY_PLACEHOLDER, headersNeedApiKey } from "./headers.ts";
import type { Provider, RoleRef, RoleTarget, VendorBlock } from "./schema.ts";

/**
 * Whole-config invariants for {@link Config}: uniqueness, gateway/backend
 * coherence, and referential integrity. Structural validation lives in the
 * field schemas; these checks need the full object, so they run in the
 * schema's `superRefine`. The small config helpers shared with the catalog
 * (`vendorBlockOf`, `parseRoleRef`) live here too.
 */

/** The shape `Config`'s refinement receives (its base object, pre-refinement). */
interface ConfigShape {
	$schema?: string | undefined;
	providers: Provider[];
	roles: Record<string, RoleRef>;
}

type Ctx = z.core.$RefinementCtx<ConfigShape>;

/**
 * A direct provider's vendor block, with the string shorthand normalized to
 * `{ id }`. Undefined when the provider sets no `vendor` at all (its vendor
 * then defaults to the provider id, with no overrides).
 */
export function vendorBlockOf(p: Provider): VendorBlock | undefined {
	return typeof p.vendor === "string" ? { id: p.vendor } : p.vendor;
}

/**
 * Normalizes a role reference to its `{ provider, model }` target. The string
 * shorthand splits at the **first** `:`, so model ids may contain colons
 * (`"ollama:qwen3.6:35b"` -> provider `ollama`, model `qwen3.6:35b`).
 */
export function parseRoleRef(ref: RoleRef): RoleTarget {
	if (typeof ref === "string") {
		const separator = ref.indexOf(":");
		return { provider: ref.slice(0, separator), model: ref.slice(separator + 1) };
	}
	return ref;
}

/** Per-kind coherence of a provider's own fields. */
export function checkProviderFields(p: Provider, i: number, ctx: Ctx): void {
	if (p.id.includes(":")) {
		// ":" would make the "provider:model" role shorthand ambiguous.
		ctx.addIssue({
			code: "custom",
			message: `Provider id "${p.id}" must not contain ":".`,
			path: ["providers", i, "id"],
			input: p.id,
		});
	}
	if (p.gateway !== undefined) {
		if (p.vendor !== undefined) {
			ctx.addIssue({
				code: "custom",
				message: `Provider "${p.id}" sets both "vendor" and "gateway"; a provider is either direct or gateway-routed.`,
				path: ["providers", i, "vendor"],
				input: p.vendor,
			});
		}
		return;
	}
	const block = vendorBlockOf(p);
	if ((block?.id ?? p.id) === "openai-compatible" && block?.baseURL === undefined) {
		// The OpenAI-compatible vendor has no canonical endpoint.
		ctx.addIssue({
			code: "custom",
			message: `Provider "${p.id}" uses the "openai-compatible" vendor and must set a "baseURL" in its "vendor" block.`,
			path: ["providers", i, "vendor"],
			input: p.vendor,
		});
	}
	if (
		block?.headers !== undefined &&
		headersNeedApiKey(block.headers) &&
		block.apiKey === undefined
	) {
		// A vendor's own default key (e.g. OPENAI_API_KEY) is read inside the
		// SDK and never surfaces here, so there is nothing to substitute.
		ctx.addIssue({
			code: "custom",
			message: `Provider "${p.id}" uses "${API_KEY_PLACEHOLDER}" in "vendor.headers" but its "vendor" block sets no "apiKey".`,
			path: ["providers", i, "vendor", "headers"],
			input: block.headers,
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
		const target = parseRoleRef(ref);
		// The string shorthand has no sub-fields to point at.
		const isShorthand = typeof ref === "string";
		const models = index.get(target.provider);
		if (!models) {
			ctx.addIssue({
				code: "custom",
				message: `Role "${role}" references unknown provider "${target.provider}".`,
				path: isShorthand ? ["roles", role] : ["roles", role, "provider"],
				input: target.provider,
			});
		} else if (!models.has(target.model)) {
			ctx.addIssue({
				code: "custom",
				message: `Role "${role}" references unknown model "${target.provider}:${target.model}".`,
				path: isShorthand ? ["roles", role] : ["roles", role, "model"],
				input: target.model,
			});
		}
	}
}
