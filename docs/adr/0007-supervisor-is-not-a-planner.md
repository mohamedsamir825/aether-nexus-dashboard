# ADR 0007 — The Supervisor is not a planner

**Status:** Accepted · **Date:** 2026-08-26

## Context

"Supervisor" invites scope creep. The obvious next features — decomposing a goal
into steps, scheduling background work, retrying, running agents in parallel —
all feel like supervision, and all would land in the same file. That file then
becomes the thing nobody can change, which directly contradicts core principle
13 (evolve without rewriting the Core).

## Decision

The Supervisor does exactly five things: resolve a target agent, check
permission, assemble the `AgentContext`, run the agent, emit lifecycle events.

It does **not** plan, decompose, schedule, or retry. Those belong in a layer
*above* the `Supervisor` interface, added later without modifying it.

It also owns the collaboration seam: `context.delegate(...)` routes agent-to-agent
requests back through dispatch, re-checking permissions, inheriting the parent's
budget, recording the parent run, and bounding depth so a cycle fails cleanly
(principle 12).

## Consequences

Good: the Supervisor stays small enough to reason about and to test exhaustively.
Orchestration strategies become swappable rather than baked in. Agents stay
decoupled without a planner existing yet.

Bad: an orchestration layer must be built before anything multi-step ships, so
the first genuinely complex workflow costs more than if planning had been
inlined here.

## Revisit when

The orchestration layer is designed. Even then, prefer composing over the
`Supervisor` interface to editing the Core Supervisor. Its line count is the
early-warning signal — watch it.
