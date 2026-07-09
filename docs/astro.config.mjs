// @ts-check
import starlight from "@astrojs/starlight";
import { defineConfig } from "astro/config";
import starlightLlmsTxt from "starlight-llms-txt";

// https://astro.build/config
export default defineConfig({
	site: "https://sincekmori.github.io",
	base: "/ai-sdk-utils",
	integrations: [
		starlight({
			title: "ai-sdk-utils",
			description: "Companion libraries for the Vercel AI SDK.",
			social: [
				{ icon: "github", label: "GitHub", href: "https://github.com/sincekmori/ai-sdk-utils" },
			],
			editLink: {
				baseUrl: "https://github.com/sincekmori/ai-sdk-utils/edit/main/docs/",
			},
			defaultLocale: "root",
			locales: {
				root: { label: "English", lang: "en" },
				ja: { label: "日本語", lang: "ja" },
			},
			sidebar: [
				{
					label: "ai-sdk-catalog",
					items: [
						{
							label: "Getting started",
							translations: { ja: "はじめに" },
							slug: "catalog/getting-started",
						},
						{
							label: "Configuration file",
							translations: { ja: "設定ファイル" },
							slug: "catalog/configuration",
						},
						{
							label: "Configuration reference",
							translations: { ja: "設定リファレンス" },
							slug: "catalog/reference",
						},
					],
				},
			],
			// /llms.txt, /llms-small.txt, /llms-full.txt — generated into dist/ at
			// build time (never committed), so LLMs can read the docs as Markdown.
			plugins: [starlightLlmsTxt()],
		}),
	],
});
