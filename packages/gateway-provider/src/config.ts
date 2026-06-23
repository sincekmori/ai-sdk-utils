// Copyright 2026 Shinsuke Mori
// SPDX-License-Identifier: Apache-2.0

import { parse as parseYaml } from "yaml";
import * as z from "zod";

import { GatewayConfig } from "./schema.ts";

/**
 * Validates an already-parsed config object and returns a typed
 * {@link GatewayConfig}. This is the portable core: it runs anywhere (Node or
 * browser) and takes the data however you obtained it — a fetched JSON response,
 * an imported object, or {@link parseGatewayConfigString} output.
 *
 * Throws a readable aggregated error (with paths) if validation fails.
 */
export function parseGatewayConfig(data: unknown): GatewayConfig {
	const result = GatewayConfig.safeParse(data);
	if (!result.success) {
		// z.prettifyError renders issues with their paths in a single block.
		throw new Error(z.prettifyError(result.error));
	}
	return result.data;
}

/**
 * Parses a YAML or JSON string and validates it.
 * YAML is a superset of JSON, so a single parser handles both. Browser-safe.
 */
export function parseGatewayConfigString(text: string): GatewayConfig {
	return parseGatewayConfig(parseYaml(text));
}

/**
 * Node-only convenience: reads `path` (.yaml/.yml/.json) and validates it.
 * `node:fs` is imported dynamically so the package's main entry stays
 * browser-safe; this function tree-shakes away in browser bundles.
 */
export async function loadGatewayConfig(path: string): Promise<GatewayConfig> {
	const { readFile } = await import("node:fs/promises");
	const text = await readFile(path, "utf8");
	try {
		return parseGatewayConfigString(text);
	} catch (error) {
		throw new Error(`${path}:\n${(error as Error).message}`, { cause: error });
	}
}
