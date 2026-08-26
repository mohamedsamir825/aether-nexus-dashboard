# ADR 0005 — Deny-by-default permissions

**Status:** Accepted · **Date:** 2026-08-26

## Context

Core principle 4 requires explicit permissions. A system of specialists that can
move money, call external APIs and read personal memory cannot grant access by
omission — the failure mode of an allow-by-default system is silent and
expensive.

## Decision

The `PermissionEngine` evaluates ordered policies. Each returns a decision or
`null` to abstain. **If every policy abstains, the request is denied.** There is
no implicit allow anywhere in the codebase, and a newly constructed
`NexusSystem` with no policies denies everything.

Enforcement points, all of which fail closed:

- **Supervisor dispatch** — caller must hold `agent:dispatch` for the target.
- **ToolBelt** — the tool must be declared by the agent *and* the subject must
  hold every capability the tool declares.
- **ScopedMemory** — the scope must be one the agent owns *and* the subject must
  hold `memory:read` / `memory:write`.

Every decision carries a human-readable `reason`; a denial that cannot explain
itself is treated as a bug.

## Consequences

Good: a new agent can do nothing until it is granted something, so the failure
mode of a misconfiguration is a denial rather than an unintended action. Denials
are inspectable and emit events.

Bad: more configuration up front, and a class of "why is this denied" debugging.
Capability strings are plain strings today and will multiply — a taxonomy is
needed before the system has roughly five divisions. This is listed as a known
risk in `ARCHITECTURE.md`.

## Revisit when

Capability sprawl makes policies hard to reason about. The fix is a typed
capability taxonomy and role bundles — not relaxing the default.
