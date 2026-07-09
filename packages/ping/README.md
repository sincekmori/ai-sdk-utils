# ai-sdk-ping

Ping a [AI SDK](https://ai-sdk.dev/) `LanguageModel` to verify it is reachable and correctly configured.

## Why

Before committing a model instance to a long-running task or application startup, you may want to confirm that credentials, endpoint, and model ID are all valid.
`ping` sends the smallest possible request, aborts the stream the moment the provider responds, and returns a plain `boolean` — keeping latency and cost to a minimum.

## Installation

```sh
npm install ai-sdk-ping
```

## Usage

```typescript
import { openai } from "@ai-sdk/openai";
import { ping } from "ai-sdk-ping";

const model = openai("gpt-5.2-chat");
const reachable = await ping(model);

if (reachable) {
  // `model` is verified reachable — reuse it with confidence.
}
```

Works with any AI SDK-compatible provider:

```typescript
import { anthropic } from "@ai-sdk/anthropic";
import { ping } from "ai-sdk-ping";

const reachable = await ping(anthropic("claude-opus-4-6"));
```
