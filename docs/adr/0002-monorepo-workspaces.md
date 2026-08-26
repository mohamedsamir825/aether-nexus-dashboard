# ADR 0002 — Bun workspaces monorepo

**Status:** Accepted · **Date:** 2026-08-26

## Context

Divisions must be addable without touching the Core, and the Core must never
depend on the UI. Directory conventions inside one package express that but do
not enforce it; nothing stops an import.

Like ADR 0001, this was proposed to the project owner and taken as a default
when no selection was made.

## Decision

Bun workspaces: `packages/*` and `apps/*`. The Core lives in `packages/core`.
Divisions will become `packages/divisions/<name>`. Applications live in `apps/`.

## Consequences

Good: the boundary is mechanical. A division package that does not depend on the
dashboard cannot import it, and the dependency direction is visible in each
manifest rather than trusted. Packages can be tested and typechecked in
isolation.

Bad: more manifests and tsconfigs than a single package; slightly heavier
onboarding.

## Revisit when

Never expected to reverse. If the workspace overhead outweighs the benefit
before the second division exists, collapsing back to one package is cheap —
growing into workspaces later is not.
