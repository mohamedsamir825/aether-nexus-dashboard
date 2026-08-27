# ADR 0003 — Quarantine the vendored dashboard template

**Status:** Accepted · **Date:** 2026-08-26

## Context

The repository was described as clean. It was not: it contained a complete
frontend-only dashboard template — React 19, Vite, Tailwind, Recharts, ~840
lines across three components, all data hardcoded — MIT-licensed and authored by
[bymilon](https://github.com/bymilon), together with its own README, design
notes, release backlog and CI.

Left at the repository root, `src/` would have been ambiguous from the first
commit, and the boundary between product UI and Core would have blurred
immediately.

The disposition was put to the project owner (keep and quarantine / delete /
leave in place) and no option was selected; quarantine was taken as the default
because it is the only one of the three that is reversible in both directions.

## Decision

Move it wholesale to `apps/dashboard/` with its own manifest, unmodified. It is
a presentation-layer artifact and **is not wired to NEXUS Core**. Its docs
(`README.md`, `DESIGN.md`, `TODO.md`, `OSS_RELEASE_PLAYBOOK.md`) moved with it,
since they describe that template and not this system.

Nothing in `packages/core` depends on it. Its build is verified but is not part
of the Core test suite.

## Consequences

Good: the visual work and its attribution are preserved, root-level ambiguity is
gone, and the Core stays UI-agnostic. Deleting it later is one `git rm`.

Bad: the repository carries an app that does nothing for NEXUS yet, which may
mislead a newcomer. Its README now states this explicitly.

Note: the naming mismatch this ADR flagged is resolved. The project now lives in
the private repository `mohamedsamir825/NEXUS`, matching the root `package.json`
name. The original public fork of the template is retired. This does not change
the template's disposition — it remains quarantined in `apps/dashboard/` and
undecided until Phase 14.

## Revisit when

The real NEXUS UI is built. At that point either adopt this template as its
starting point or delete it — do not maintain both.
