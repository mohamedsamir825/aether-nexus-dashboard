# ADR 0019 — `maxAgentRuns`: breadth is a budgeted resource

**Status:** Accepted · **Date:** 2026-08-27 · **Phase:** 9 (Cross-Agent Intelligence)

## Context

`ExecutionBudget` charged two things: model calls and tool calls. A delegation
hop cost nothing.

`MAX_DELEGATION_DEPTH = 8` bounded how *deep* a chain could go and said nothing
about how *wide* it could get. Business delegates once per market question and
once per cost driver per option, so a caller supplying a hundred options
produces two hundred runs — every one of them at depth 1, none of them charged.
Breadth was the single unbounded resource in an otherwise budgeted system, and
the input that decides it comes from outside.

## Decision — a third budget dimension, on the existing contract

`contracts/execution.ts` gains:

```ts
readonly maxAgentRuns?: number;   // ExecutionBudget
readonly agentRuns: number;       // BudgetUsage
chargeAgentRun(): Result<void>;   // BudgetGuard
```

This edits a Core contract, which is an ADR-level act (ADR 0004). The baseline
was regenerated with `bun run contracts:baseline` and this file is the reason.

A constant in `supervisor.ts` was the alternative and was rejected: the right
ceiling depends on the dispatch, not on the build. A caller framing three
options and a caller framing ninety want different limits, and only one of them
should have to change the source to get one.

## Decision — charged before the work, after the permission check

Charged against the **shared** guard, so the ceiling covers the whole tree and
a child cannot widen what its parent was given (§18.2).

Ordering is deliberate:

- **Before** anything is built or published, so a refused run leaves no
  half-started trace. There is no `started` event for a run that never ran.
- **After** the permission check, because a denied dispatch never became a run
  and must not consume the tree's allowance. A caller could otherwise exhaust
  someone's budget with requests that were refused anyway.

Unset means no limit for this dimension — never zero. Same rule as every other
budget field, and there is a test that pins it, because "omitted" quietly
meaning "none allowed" is the kind of default that fails closed in the wrong
direction.

## Consequence — a refused delegation must not read as a silent gap

Introducing this dimension made a pre-existing conflation reachable in a new
way. Business treats a failed delegation as an unestablished input and
continues, which is correct — an analysis that stops because one price is
missing is less useful than one that names the gap. But "Research established
nothing" and "the run was stopped by this tree's budget" both landed in
`unsourced`, where the first reads as a thin corpus and the second is invisible.

`OptionSet.refusals` now records the refused delegations with their error code
alongside the gap they caused, and the narrative says so in its own line.
`unsourced` and `unpriced` stay complete; `refusals` says which of those gaps
are the system's own doing.

## What would make us revisit

A budget dimension per division, or a ceiling expressed in wall-clock rather
than run count. Neither is needed while a run tree is a handful of runs inside
one process.
