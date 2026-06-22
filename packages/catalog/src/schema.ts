import * as z from "zod";

/**
 * Single source of truth for LLM providers, their models, and the role
 * assignments the app uses.
 * Validated from a plain object at startup (parsed from YAML/JSON or built in
 * code), so it works the same in Node and in the browser.
 *
 * Zod v4 (package root export). Core types live under `z.core`.
 */

export const ModelType = z.enum(["default", "chat"]);
export type ModelType = z.infer<typeof ModelType>;

export const Model = z.object({
	id: z.string().min(1), // must match the provider's model id (e.g. "gpt-5.1")
	type: ModelType,
	name: z.string().min(1),
	description: z.string().default(""),
	// Total tokens the model can consider in one request (input + output combined).
	contextWindow: z.number().int().positive(),
	// Separate ceiling on generated (output) tokens. Optional: some providers
	// do not publish a distinct output cap.
	maxOutputTokens: z.number().int().positive().optional(),
	// Training knowledge cutoff as an ISO date (YYYY-MM-DD). Optional: not all
	// models (e.g. some local ones) publish one.
	knowledgeCutoff: z.iso.date().optional(),
});
export type Model = z.infer<typeof Model>;

export const Provider = z.object({
	id: z.string().min(1), // becomes the registry prefix => "openai:gpt-5.1"
	name: z.string().min(1),
	models: z.array(Model).min(1),
});
export type Provider = z.infer<typeof Provider>;

/** A role points at exactly one provider+model pair. */
export const RoleRef = z.object({
	provider: z.string().min(1),
	model: z.string().min(1),
	// What this role is for (e.g. "Default chat model"). Optional.
	description: z.string().default(""),
});
export type RoleRef = z.infer<typeof RoleRef>;

/**
 * Structural validation lives in the field schemas above.
 * Whole-config invariants (uniqueness + referential integrity) live in the
 * refinement below, where the full object is available.
 */
export const Config = z
	.object({
		providers: z.array(Provider).min(1),
		roles: z.record(z.string(), RoleRef), // role name -> { provider, model }
	})
	.superRefine((cfg, ctx) => {
		// 1. provider id uniqueness + model id uniqueness within a provider
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
			}

			// Optional invariant: at most one `type: "default"` per provider.
			const defaults = p.models.filter((m) => m.type === "default");
			if (defaults.length > 1) {
				ctx.addIssue({
					code: "custom",
					message: `Provider "${p.id}" has ${defaults.length} models with type "default" (expected at most 1).`,
					path: ["providers", i, "models"],
					input: p.id,
				});
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
