# ADR 0001 — TypeScript Core on Bun, with zero dependencies

**Status:** Accepted · **Date:** 2026-08-26

## Context

NEXUS needs a language for the Core, Supervisor, agents and tools. The realistic
options were TypeScript everywhere, a Python Core with a TypeScript UI, or a
TypeScript Core with Python reserved behind a worker boundary for quantitative
workloads.

This decision was put to the project owner, who did not select an option and
directed implementation to proceed. **It was taken as a default, not an explicit
approval**, and is the ADR most worth revisiting deliberately.

## Decision

TypeScript everywhere, on Bun, with `strict` plus `exactOptionalPropertyTypes`
and `noUncheckedIndexedAccess`.

Tests run on `bun test`, which is built into the runtime. The Core package
declares **no runtime dependencies and no test dependencies**; the only dev
dependencies in the repo are `typescript` and type definitions.

## Consequences

Good: one toolchain, one test runner, and type safety that actually spans the
agent/tool/model boundaries — a `ToolId` cannot be passed where an `AgentId`
belongs. Nothing to install to run the suite, and no supply-chain surface in the
Core.

Bad: TypeScript is the weaker ecosystem for the quantitative finance and data
work the Finance division will eventually want. Bun is a younger runtime than
Node.

## Revisit when

The first Finance workload needs numerical libraries that have no credible TS
equivalent. The escape hatch is already shaped: expose it as a `Tool` backed by
a Python worker process, which requires no Core change. Prefer that to rewriting
the Core.
