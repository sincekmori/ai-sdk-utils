// Copyright 2026 Shinsuke Mori
// SPDX-License-Identifier: Apache-2.0

import { defaultSettingsMiddleware, type LanguageModel, wrapLanguageModel } from "ai";

import type { ModelSettings } from "./schema.ts";

/**
 * Merges a provider's default settings with a model's own settings.
 * Model settings win for scalar fields; `providerOptions` is merged per
 * provider namespace so a model can add or override individual options without
 * dropping the provider-level ones.
 */
export function mergeSettings(
	base?: ModelSettings,
	override?: ModelSettings,
): ModelSettings | undefined {
	if (!base) {
		return override;
	}
	if (!override) {
		return base;
	}
	const merged: ModelSettings = { ...base, ...override };
	if (base.providerOptions || override.providerOptions) {
		const providerOptions: NonNullable<ModelSettings["providerOptions"]> = {};
		const namespaces = new Set([
			...Object.keys(base.providerOptions ?? {}),
			...Object.keys(override.providerOptions ?? {}),
		]);
		for (const ns of namespaces) {
			providerOptions[ns] = {
				...base.providerOptions?.[ns],
				...override.providerOptions?.[ns],
			};
		}
		merged.providerOptions = providerOptions;
	}
	return merged;
}

/**
 * Bakes the config's default call settings (temperature, topP, ...) into a
 * model handle via `defaultSettingsMiddleware`, so they apply to every call
 * unless overridden at the call site. Returns the handle untouched when there
 * are no settings, when it is a bare model-id string, or for legacy v2 models
 * (which `wrapLanguageModel` does not accept).
 */
export function withSettings(model: LanguageModel, settings?: ModelSettings): LanguageModel {
	if (!settings || typeof model === "string" || model.specificationVersion === "v2") {
		return model;
	}
	return wrapLanguageModel({
		model,
		middleware: defaultSettingsMiddleware({ settings }),
	});
}
