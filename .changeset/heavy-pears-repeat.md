---
"ai-sdk-catalog": minor
---

Ship the config file's JSON Schema as `schema.json` in the package (exported as `ai-sdk-catalog/schema.json`). Point a config's `"$schema"` at `./node_modules/ai-sdk-catalog/schema.json` — or a versioned CDN URL such as `https://cdn.jsdelivr.net/npm/ai-sdk-catalog@<version>/schema.json` — for editor validation and autocompletion. Also add JSON example configs at three sizes under `examples/`.
