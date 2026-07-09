---
"ai-sdk-catalog": minor
---

**Breaking:** config loading collapses into `createCatalog`, which now validates its input itself and throws a readable issue list when it is invalid. `parseConfig`, `parseConfigString`, and `loadConfig` are removed — read the file however you like and hand the parsed object over:

```ts
import { readFile } from "node:fs/promises";
import { createCatalog } from "ai-sdk-catalog";

const text = await readFile("./ai-sdk-catalog.json", "utf8");
const config = JSON.parse(text);
const catalog = createCatalog(config);
```

With `loadConfig` gone the package no longer touches `node:fs` at all, so every entry point is runtime-agnostic.
