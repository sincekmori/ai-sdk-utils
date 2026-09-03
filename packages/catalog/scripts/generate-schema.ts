import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import * as z from "zod";

import { ConfigSchema } from "../src/index.ts";

// Emits schema.json (shipped in the npm package) from `ConfigSchema`,
// so a config file's `"$schema"` pointer gets editor validation and
// autocompletion. Regenerate after changing src/schema.ts (the format pass
// settles array wrapping the way the repo formatter likes it):
//
//   pnpm generate-schema && pnpm format
//
// A test asserts the committed schema.json matches this output, so a stale
// file cannot reach a release.

/** The JSON Schema for a config file, as written to schema.json. */
function buildConfigJsonSchema(): z.core.JSONSchema.BaseSchema {
	const schema = z.toJSONSchema(ConfigSchema);
	// The config schema knows nothing about the `$schema` pointer itself; allow
	// it so editors don't flag the very key that wires them up.
	schema.properties = { $schema: { type: "string" }, ...schema.properties };
	return schema;
}

if (process.argv[1] === import.meta.filename) {
	const out = join(import.meta.dirname, "..", "schema.json");
	await writeFile(out, `${JSON.stringify(buildConfigJsonSchema(), undefined, 2)}\n`);
	console.log(`wrote ${out}`);
}

export default buildConfigJsonSchema;
