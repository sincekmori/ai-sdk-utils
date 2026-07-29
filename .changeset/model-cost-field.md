---
"ai-sdk-catalog": minor
---

Add an optional per-model `cost` field — a price sheet in models.dev vocabulary (`input`/`output`/`cacheRead`/`cacheWrite`, USD per 1M tokens; prices above $1,000/1M are rejected as unit mix-ups), exposed via `meta`/`metaForRole` for app-side cost accounting.
