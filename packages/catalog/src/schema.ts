import * as z from "zod";

/**
 * Single source of truth for LLM providers, their models, and the role
 * assignments the app uses.
 * Validated from a plain object at startup (parsed from YAML/JSON or built in
 * code), so it works the same in Node and in the browser.
 *
 * Zod v4 (package root export). Core types live under `z.core`.
 */

/**
 * How a model id is turned into a handle by the {@link ModelResolver}:
 *   - "default" -> `provider(modelId)`        (e.g. `openai("gpt-4o")`)
 *   - "chat"    -> `provider.chat(modelId)`   (e.g. `openai.chat("gpt-4o")`)
 * Use "chat" for providers/endpoints that only work through the
 * chat-completions surface (many OpenAI-compatible servers, older models).
 */
export const ModelType = z.enum(["default", "chat"]);
export type ModelType = z.infer<typeof ModelType>;

/**
 * Default AI SDK call settings, applied to the model handle in
 * {@link createCatalog} via `defaultSettingsMiddleware`. They map 1:1 to the
 * parameters `generateText`/`streamText` accept, so anything set here can also
 * be overridden per call. Every field is optional; omit the block entirely to
 * fall back to the provider's own defaults.
 */
export const ModelSettings = z.object({
	maxOutputTokens: z.number().int().positive().optional(),
	temperature: z.number().optional(),
	topP: z.number().optional(),
	topK: z.number().int().optional(),
	presencePenalty: z.number().optional(),
	frequencyPenalty: z.number().optional(),
	stopSequences: z.array(z.string()).optional(),
	seed: z.number().int().optional(),
	// Provider-specific options, passed through untouched
	// (e.g. { openai: { reasoningEffort: "low" } }). Values must be JSON.
	providerOptions: z.record(z.string(), z.record(z.string(), z.json())).optional(),
});
export type ModelSettings = z.infer<typeof ModelSettings>;

export const Model = z.object({
	id: z.string().min(1), // must match the provider's model id (e.g. "gpt-5.1")
	type: ModelType,
	// Default call settings (temperature, topP, ...) baked into the handle. Optional.
	settings: ModelSettings.optional(),
});
export type Model = z.infer<typeof Model>;

export const Provider = z.object({
	id: z.string().min(1), // becomes the registry prefix => "openai:gpt-5.1"
	// Default call settings inherited by every model in this provider. Each
	// model's own `settings` are merged on top (model wins; `providerOptions`
	// is merged per provider namespace). Optional.
	settings: ModelSettings.optional(),
	models: z.array(Model).min(1),
});
export type Provider = z.infer<typeof Provider>;

/** A role points at exactly one provider+model pair. */
export const RoleRef = z.object({
	provider: z.string().min(1),
	model: z.string().min(1),
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
