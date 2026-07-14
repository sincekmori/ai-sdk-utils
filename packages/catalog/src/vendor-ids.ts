// Copyright 2026 Shinsuke Mori
// SPDX-License-Identifier: Apache-2.0

import * as z from "zod";

/**
 * A bundled `@ai-sdk/*` provider. Used as a **direct** provider's vendor and as
 * a gateway backend's `vendor`. The OpenAI-compatible family (Fireworks,
 * Together, Cerebras, DeepInfra, Ollama, ...) is covered by `openai-compatible`.
 * Bedrock / Vertex / Azure are intentionally omitted: their bespoke cloud auth
 * doesn't fit here — wire them through a `resolve` override instead.
 */
export const Vendor = z.enum([
	"anthropic",
	"openai",
	"openai-compatible",
	"mistral",
	"cohere",
	"groq",
	"xai",
	"deepseek",
	"perplexity",
	"google",
]);
export type Vendor = z.infer<typeof Vendor>;
