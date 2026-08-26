# Contributing

## Setup

```bash
bun install
bun test          # Core suite: no network, no credentials required
bun run typecheck
bun run health
```

## Checks before a pull request

```bash
bun run typecheck
bun test packages
```

## Architectural changes

Read [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) first.

A change that contradicts an accepted ADR needs a **new ADR superseding it**,
not a silent edit. Add it to [`docs/adr/`](docs/adr/) in the same pull request.

Two rules deserve calling out because they are easy to break by accident:

- **Adding a model provider must not require editing the Core.** If a new
  adapter forces a change to `contracts/model-provider.ts`, to any agent, or to
  any skill, the abstraction is wrong — say so in the PR rather than widening
  the contract. See ADR 0004.
- **Agents must not import each other.** Collaboration goes through
  `context.delegate(...)`. See ADR 0007.

## Code

- The Core has **zero runtime dependencies**. Adding one to `packages/core` needs
  justification in the PR.
- Expected failures return `Result`, not thrown exceptions. See ADR 0006.
- Nothing is permitted by default. New capabilities are declared on descriptors
  and granted by policy. See ADR 0005.
- No fake implementations that pretend to be real. Test doubles live in
  `packages/core/tests/support/` and are never exported from the package.
- Never commit secrets. Configuration is rendered only through `describeConfig`,
  which emits credential presence and never values.

## `apps/dashboard`

A vendored third-party template that is not wired to NEXUS Core (ADR 0003).
Changes there are unrelated to Core work — keep them in separate pull requests.
