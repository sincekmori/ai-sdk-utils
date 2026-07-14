# ai-sdk-utils

A monorepo of small companion libraries for the [Vercel AI SDK](https://ai-sdk.dev).

## Packages

| Package                                      | Description                                                                                               |
| -------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| [`ai-sdk-local-fetch`](packages/local-fetch) | Use AI SDK `streamText` directly on the client — no server required.                                      |
| [`ai-sdk-ping`](packages/ping)               | Ping an AI SDK `LanguageModel` to verify it is reachable and configured.                                  |
| [`ai-sdk-catalog`](packages/catalog)         | Manage providers, models, and roles from one declarative config — direct vendors or your own LLM gateway. |

## Development

This repo uses [pnpm](https://pnpm.io) workspaces and [Turborepo](https://turborepo.com).

```bash
pnpm install        # install dependencies
pnpm build          # build every package with tsdown (incl. publint + attw)
pnpm test           # run vitest across packages
pnpm typecheck      # tsc --noEmit across packages
pnpm lint           # oxlint
pnpm format         # oxfmt --write .
pnpm format:check   # oxfmt --check .
```

### Tooling

- **[pnpm](https://pnpm.io) workspaces** — package management
- **[Turborepo](https://turborepo.com)** — task running and caching
- **[tsdown](https://tsdown.dev)** — bundling (one shared config in [`tsdown.config.ts`](tsdown.config.ts))
- **[oxlint](https://oxc.rs) + [oxfmt](https://oxc.rs)** — linting and formatting
- **[Vitest](https://vitest.dev)** — testing
- **[Changesets](https://github.com/changesets/changesets)** — versioning and publishing (independent versioning, OIDC trusted publishing)

## Releasing

Versioning and publishing are handled by Changesets with independent versioning.

```bash
pnpm changeset      # describe a change (creates a changeset file)
```

Merging the changeset to `main` opens a "Version Packages" PR; merging that PR
publishes the changed packages to npm via OIDC trusted publishing.
