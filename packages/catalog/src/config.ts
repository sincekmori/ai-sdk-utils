import { parse as parseYaml } from "yaml";
import * as z from "zod";

import { Config } from "./schema.ts";

/**
 * Validates an already-parsed config object and returns a typed Config.
 * This is the portable core: it runs anywhere (Node or browser) and takes the
 * data however you obtained it — a fetched JSON response, an imported object,
 * or `parseConfigString` output.
 *
 * Throws a readable aggregated error (with paths) if validation fails.
 */
export function parseConfig(data: unknown): Config {
	const result = Config.safeParse(data);
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
export function parseConfigString(text: string): Config {
	return parseConfig(parseYaml(text));
}

/**
 * Node-only convenience: reads `path` (.yaml/.yml/.json) and validates it.
 * `node:fs` is imported dynamically so the package's main entry stays
 * browser-safe; this function tree-shakes away in browser bundles.
 */
export async function loadConfig(path: string): Promise<Config> {
	const { readFile } = await import("node:fs/promises");
	const text = await readFile(path, "utf8");
	try {
		return parseConfigString(text);
	} catch (error) {
		throw new Error(`${path}:\n${(error as Error).message}`, { cause: error });
	}
}
