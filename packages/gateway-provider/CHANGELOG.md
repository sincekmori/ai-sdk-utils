# ai-sdk-gateway-provider

## 0.1.0

### Minor Changes

- 4a55a79: Add `ai-sdk-gateway-provider`: turn a custom LLM gateway into a Vercel AI SDK provider. Describe the gateway topology once as data and get a standard provider that routes models to the right upstream backend through one endpoint — handling per-backend URL layouts and Gemini's stream / non-stream action switch.

  Supported backends: `anthropic`, `openai`, `mistral`, `cohere`, `groq`, `xai`, `deepseek`, `perplexity`, `google` (Gemini), plus a generic `openai-compatible` backend that covers Fireworks, Together, Cerebras, DeepInfra, Ollama, and any other OpenAI-spec endpoint. Composes with `ai-sdk-catalog` via a one-line resolver.
