---
"ai-sdk-catalog": minor
---

**Breaking:** drop YAML support to keep the package lean — the `yaml` dependency is gone and the documented config format is JSON. To keep loading YAML configs, parse them yourself and hand the object to `createCatalog`:

```ts
import { readFile } from "node:fs/promises";
import { parse } from "yaml";

const text = await readFile("./ai-sdk-catalog.yaml", "utf8");
const config = parse(text);
const catalog = createCatalog(config);
```
