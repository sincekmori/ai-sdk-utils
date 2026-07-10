---
"ai-sdk-catalog": minor
---

Add `CatalogOptions.fetch`: a base fetch every provider's HTTP requests are sent through (default: `globalThis.fetch`). For gateway providers it runs after the gateway path rewriting, so it sees the final gateway URL and body — the place to add logging, auth, or a gateway-specific payload adjustment without patching `globalThis.fetch`. The `FetchFunction` type is re-exported so callers can type a custom fetch without depending on `@ai-sdk/provider-utils` themselves.
