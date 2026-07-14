// Copyright 2026 Shinsuke Mori
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it, vi } from "vitest";

import { headersNeedApiKey, resolveApiKey, resolveHeaders } from "../src/headers.ts";

const DESCRIPTION = { description: 'provider "acme"' };

describe("resolveApiKey", () => {
	it("returns an inline string as-is", () => {
		expect(resolveApiKey("sk-123", DESCRIPTION)).toBe("sk-123");
	});

	it("reads an envVarName reference from the environment", () => {
		vi.stubEnv("ACME_API_KEY", "sk-from-env");
		expect(resolveApiKey({ envVarName: "ACME_API_KEY" }, DESCRIPTION)).toBe("sk-from-env");
		vi.unstubAllEnvs();
	});

	it("falls back to defaultEnvVarName when the config sets no key", () => {
		vi.stubEnv("AI_GATEWAY_API_KEY", "sk-default");
		expect(
			resolveApiKey(undefined, { defaultEnvVarName: "AI_GATEWAY_API_KEY", ...DESCRIPTION }),
		).toBe("sk-default");
		vi.unstubAllEnvs();
	});

	it("resolves to undefined without a key or default (the vendor SDK's default applies)", () => {
		expect(resolveApiKey(undefined, DESCRIPTION)).toBeUndefined();
	});

	it("throws a readable error when the environment variable is unset", () => {
		expect(() =>
			resolveApiKey({ envVarName: "AI_SDK_CATALOG_TEST_UNSET_KEY" }, DESCRIPTION),
		).toThrow(/AI_SDK_CATALOG_TEST_UNSET_KEY/u);
	});
});

describe("resolveHeaders", () => {
	it("passes inline string values through as-is", () => {
		expect(resolveHeaders({ "x-team-id": "platform" }, DESCRIPTION)).toStrictEqual({
			"x-team-id": "platform",
		});
	});

	it("substitutes {apiKey} into inline values", () => {
		expect(
			resolveHeaders(
				{ Authorization: "Bearer {apiKey}", "api-key": "{apiKey}" },
				{ apiKey: "sk-123", ...DESCRIPTION },
			),
		).toStrictEqual({ Authorization: "Bearer sk-123", "api-key": "sk-123" });
	});

	it("throws a readable error when {apiKey} is used but no key is configured", () => {
		expect(() => resolveHeaders({ Authorization: "Bearer {apiKey}" }, DESCRIPTION)).toThrow(
			/\{apiKey\}/u,
		);
	});

	it("reads an envVarName value from the environment, verbatim", () => {
		vi.stubEnv("APIM_SUBSCRIPTION_KEY", "sekrit");
		expect(
			resolveHeaders(
				{ "Ocp-Apim-Subscription-Key": { envVarName: "APIM_SUBSCRIPTION_KEY" } },
				DESCRIPTION,
			),
		).toStrictEqual({ "Ocp-Apim-Subscription-Key": "sekrit" });
		vi.unstubAllEnvs();
	});

	it("does not substitute {apiKey} inside an env-var value (secrets are opaque)", () => {
		vi.stubEnv("RAW_HEADER", "literal {apiKey}");
		expect(
			resolveHeaders(
				{ "x-raw": { envVarName: "RAW_HEADER" } },
				{ apiKey: "sk-123", ...DESCRIPTION },
			),
		).toStrictEqual({ "x-raw": "literal {apiKey}" });
		vi.unstubAllEnvs();
	});

	it("throws a readable error when the environment variable is unset", () => {
		expect(() =>
			resolveHeaders({ "x-key": { envVarName: "AI_SDK_CATALOG_TEST_UNSET_VAR" } }, DESCRIPTION),
		).toThrow(/AI_SDK_CATALOG_TEST_UNSET_VAR/u);
	});
});

describe("headersNeedApiKey", () => {
	it("detects the placeholder only in inline string values", () => {
		expect([
			headersNeedApiKey({ Authorization: "Bearer {apiKey}" }),
			headersNeedApiKey({ "x-team-id": "platform" }),
			headersNeedApiKey({ "x-key": { envVarName: "SOME_VAR" } }),
		]).toStrictEqual([true, false, false]);
	});
});
