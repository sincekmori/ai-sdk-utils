import { defineConfig } from "vitest/config";

/** Shared test configuration for every package (vitest resolves it upward). */
export default defineConfig({
	test: {
		environment: "node",
		passWithNoTests: true,
	},
});
