---
"ai-sdk-catalog": minor
---

feat(catalog)!: rename every exported Zod schema constant to `<Name>Schema` so it no longer shares its name with the inferred type

**Breaking** (0.x minor): every exported schema constant gains a `Schema` suffix — `Config`, `Provider`, `Model`, `ModelSettings`, `ModelCost`, `ModelApi`, `VendorBlock`, `Vendor`, `RoleRef`, `RoleTarget`, `GatewayOptions`, `GatewayBackend`, `ApiKey`, `EnvVarRef`, `HeaderValue`, `RequestHeaders`, `QueryParams`. The type exports keep their names, so only value usages change (`Config.parse(...)` → `ConfigSchema.parse(...)`, `z.toJSONSchema(Config)` → `z.toJSONSchema(ConfigSchema)`); `createCatalog(config)` callers are unaffected.
