---
"ai-sdk-catalog": minor
---

feat(catalog)!: bundle `@ai-sdk/perplexity` 5, which replaces the Sonar Chat Completions API with Perplexity's Agent API and maps no Sonar model id

**Breaking** (0.x minor): a `perplexity` vendor or gateway backend now speaks the Agent API.
The SDK does not translate Sonar model ids, so a model such as `sonar-pro` fails at request time; rename it to an Agent API preset (`fast`, `low`, `medium`, `high`, `xhigh` — Perplexity suggests `sonar` → `fast`, `sonar-pro` → `low`, `sonar-reasoning` / `sonar-reasoning-pro` → `medium`, `sonar-deep-research` → `high`) or to a direct model id such as `perplexity/sonar`.
The embedded models.dev price sheets still carry the Sonar ids, so a renamed model no longer gets an auto-filled `cost`; set `cost` explicitly until models.dev lists the Agent API models.
A `baseURL` override or a gateway `pathTemplate` for this vendor must route the Agent API path (`/v1/agent`) rather than `/chat/completions`.
Staying on the 4.x SDK is no alternative: Perplexity shut Sonar Chat Completions down on 2026-09-27.
Every other bundled `@ai-sdk/*` package moves to its current patch release.
