# ADR 0018 — Run lineage lives in the Supervisor's payloads, not on `NexusEvent`

**Status:** Accepted · **Date:** 2026-08-27 · **Phase:** 9 (Cross-Agent Intelligence)

## Context

NEXUS delegates by name through the Supervisor, so one strategic question
becomes five runs across three divisions. The event stream is the only record
of that having happened — and it was flat. `NexusEvent` carries `runId`;
nothing named a parent, and `agent.task.started` payloads carried
`{ agentId, taskId }`.

The consequence was concrete: after `bun run nexus` you could count the runs
and relate none of them. Phase 9 asks for "full trace reconstruction", §18.1
describes a canonical chain, and neither is checkable against a trail that
cannot say who called whom.

## Decision — lineage goes in the `agent.task.*` payloads

Four fields, on `agent.task.started`, `.completed`, `.failed` and
`agent.dispatch.denied`:

| field | meaning |
| --- | --- |
| `agentId` | already present |
| `division` | from `AgentDescriptor.division` |
| `role` | from `AgentDescriptor.role` |
| `depth` | derived from the in-flight record of the parent run |
| `parentRunId` | the **immediate** parent; **omitted** at the top of a tree |

`contracts/events.ts` is **not** edited. The envelope stays exactly as it was,
the tripwire stays green for that file, and lineage is something the Supervisor
publishes rather than something every event is obliged to carry.

## Decision — the source of every field is the Supervisor's own state

None of it is read from the task input, the dispatch metadata, or anything an
agent returned. Depth and the ancestor path come from `inFlight`, which is
keyed by run id and written only by the Supervisor; division and role come from
the registered descriptor.

This is the G1 property generalised. A run that can describe its own position
in the tree can misdescribe it, and a trace assembled from self-reported
lineage would look authoritative while being whatever the agent said. Tests
assert it directly: an agent returning `{ division: 'finance', role: 'cfo',
depth: 99 }` still appears as what it was registered as.

## Decision — lineage is descriptive, never authoritative

Nothing branches on it. Permission, capability, budget and routing decisions
read `Subject` and the registries exactly as before. A payload claiming a
permitted parent does not make a denied dispatch permitted, and there is a test
that says so.

Stated because the failure mode is easy to reach later: lineage is the obvious
thing to consult when writing "trusted callers may…", and the moment it decides
anything, a field designed for reading becomes a field worth forging.

## Consequences

- `buildRunTree(events)` reconstructs the tree from the trail alone. It refuses
  to guess: a run naming an absent parent becomes a root marked `orphaned`,
  two unrelated dispatches stay two roots, and an `agent.task.*` event with no
  readable agent id is counted in `unreadable` rather than dropped. A trace
  that looks complete when it is not is worse than an obviously partial one.
- A denied dispatch carries lineage but is **not** a node. It never executed,
  and a tree showing it would report work that did not happen.
- The convention is only as strong as the publisher. That is the cost of not
  editing the envelope, and it is why this ADR and the tests exist rather than
  a comment.

## Deferred — `parentRunId` on `NexusEvent`

The alternative was to add `readonly parentRunId?: RunId` to the envelope,
making lineage a property of every event from any publisher. It was not taken
because there is exactly one publisher of run lifecycle events today, and a
Core contract edit made for one publisher's convenience is the shape ADR 0004
exists to resist.

**Revisit when a second independent publisher needs lineage semantics** — a
background worker (Phase 12), or an Orchestrator emitting its own step events.
At that point the question becomes whether lineage belongs on the universal
envelope, and the answer may well be yes. It is not yes yet.
