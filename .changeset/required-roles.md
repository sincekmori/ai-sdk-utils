---
"ai-sdk-catalog": minor
---

feat(catalog): `requiredRoles` option — declare the roles the app depends on so `createCatalog` fails at startup when the config misses any, and the declared names narrow `modelForRole`/`metaForRole` (typos fail to compile, `metaForRole` loses `undefined`)
