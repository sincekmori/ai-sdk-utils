import { defineConfig } from "tsdown";

/**
 * Single, shared build configuration for every package in the monorepo.
 *
 * `workspace` makes tsdown discover each `packages/*` package and apply these
 * options to it, so individual packages need no tsdown config of their own.
 */
export default defineConfig({
	workspace: ["packages/*"],
	entry: ["src/index.ts"],
	format: ["esm", "cjs"],
	dts: true,
	clean: true,
	sourcemap: true,
	treeshake: true,
	// Auto-generate each package.json `exports` map (plus legacy `main`/
	// `module`/`types`) from the build outputs, so they are never hand-written.
	exports: {
		legacy: true,
	},
	// Validate the published package shape on every build (locally and in CI).
	publint: true,
	attw: true,
});
