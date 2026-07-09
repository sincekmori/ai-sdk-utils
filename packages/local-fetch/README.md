# ai-sdk-local-fetch

> Use Vercel AI SDK `streamText` directly on the client — no server required.

When users provide their own API key, you can skip the backend proxy entirely.  
`createLocalFetch` returns a `fetch`-compatible function that routes AI SDK transport calls straight to a `LanguageModel`, without any HTTP round-trip.

## Install

```bash
npm install ai-sdk-local-fetch
```

## Usage

```ts
import { createLocalFetch } from "ai-sdk-local-fetch";
import { openai } from "@ai-sdk/openai";

const fetch = createLocalFetch({
  model: openai("gpt-5.2-chat"),
  system: "You are a helpful assistant.",
});
```

### With `@assistant-ui/react`

```tsx
import { AssistantChatTransport, useChatRuntime } from "@assistant-ui/react-ai-sdk";
import { createLocalFetch } from "ai-sdk-local-fetch";
import { openai } from "@ai-sdk/openai";

function Assistant({ apiKey }: { apiKey: string }) {
  const runtime = useChatRuntime({
    transport: new AssistantChatTransport({
      fetch: createLocalFetch({
        model: openai("gpt-5.2-chat", { apiKey }),
        system: "You are a helpful assistant.",
      }),
    }),
  });

  // ...
}
```
