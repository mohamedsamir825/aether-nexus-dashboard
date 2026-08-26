# NEXUS Architecture

This document records the architecture the Core is built to. It is the reference
for every later decision; if a change contradicts it, the change needs an ADR in
[`adr/`](adr/) first.

## 1. Shape of the system

```txt
                    ┌─────────────────────────────────────────┐
                    │              Entry points               │
                    │   CLI · API · UI · jobs · webhooks      │
                    └────────────────────┬────────────────────┘
                                         │ dispatch(task)
                    ┌────────────────────▼────────────────────┐
                    │              SUPERVISOR                 │
                    │  resolve target · check permission ·    │
                    │  build context · run · emit events      │
                    └────────────────────┬────────────────────┘
                                         │
        ┌────────────────┬───────────────┼───────────────┬────────────────┐
        │                │               │               │                │
   ┌────▼────┐     ┌─────▼─────┐   ┌─────▼─────┐   ┌─────▼─────┐   ┌──────▼──────┐
   │ Finance │     │ Research  │   │ Business  │   │Engineering│   │   future    │
   │ division│     │ division  │   │ division  │   │ division  │   │  divisions  │
   └────┬────┘     └─────┬─────┘   └─────┬─────┘   └─────┬─────┘   └──────┬──────┘
        └────────────────┴───────────────┼───────────────┴────────────────┘
                                         │  every agent gets exactly:
                    ┌────────────────────▼────────────────────┐
                    │  ToolBelt · ModelRouter · ScopedMemory  │
                    │  · EventBus · PermissionEngine          │
                    └────────────────────┬────────────────────┘
                                         │
        ┌────────────────┬───────────────┼───────────────┬────────────────┐
   ┌────▼────┐     ┌─────▼─────┐   ┌─────▼─────┐   ┌─────▼─────┐   ┌──────▼──────┐
   │  Tools  │     │  Model    │   │  Memory   │   │  Events   │   │  Evidence   │
   │         │     │ Providers │   │  Store    │   │           │   │             │
   └─────────┘     └───────────┘   └───────────┘   └───────────┘   └─────────────┘
```

An agent never sees more than the middle band. It cannot reach a tool it did not
declare, a memory scope it does not own, or a named vendor.

## 2. The layers, and why they are separate

| Layer | Answers | Never does |
| --- | --- | --- |
| **Tool** | "How do I touch the outside world?" | Decide when it should be used |
| **Skill** | "How do I do one thing well?" | Know which agent owns it |
| **Agent** | "What am I responsible for?" | Import another agent, or name a vendor |
| **Division** | "Which specialists belong together?" | Execute anything itself |
| **Supervisor** | "Who should handle this, and may they?" | Plan, decompose, or schedule |
| **Model Router** | "Which model satisfies this need?" | Contain agent logic |
| **Provider** | "How do I speak to this vendor?" | Leak vendor shapes upward |
| **Memory** | "What do we know, and who may know it?" | Be globally readable |
| **Permissions** | "Is this allowed?" | Grant anything implicitly |
| **Evidence** | "Where did this claim come from?" | Be optional for external claims |

The separation is not stylistic. Each boundary is the place a future requirement
lands without touching the Core: a new vendor is a Provider, a new capability is
a Tool, a new specialist is an Agent, a new department is a Division.

## 3. Decisions that hold the whole thing together

### Result, not exceptions
Every expected failure is a value: `Result<T, NexusError>` with a closed set of
error codes. Callers branch on `code`, never on message text. A provider being
down is data, not a stack unwind — which is what makes "fail safely" (principle 8)
testable rather than aspirational.

### Deny by default
The permission engine consults ordered policies. A policy may abstain; if all
abstain, the answer is **no**. There is no implicit allow anywhere. A freshly
constructed system denies everything until policies are supplied.

### The agent never names a vendor
An agent declares a `ModelSelectionPolicy` — required capabilities, context
window, cost ceiling, preferences. The router turns that into a concrete model.
Adding Gemini, OpenRouter, Anthropic, OpenAI or xAI is registering a provider;
no agent, skill, or Core file changes. **If adding a provider requires editing
`contracts/model-provider.ts`, the abstraction was wrong and needs an ADR.**
Vendor-specific knobs travel in `providerOptions`, which configuration sets and
agent code must never populate.

### Tools are the only exit
Three gates before anything executes: the tool must be on the agent's declared
belt, the subject must hold every capability the tool declares, and the input
must validate. A tool that declares `producesEvidence` and returns none is a
hard error — principle 5 is enforced at the boundary, not left to each tool's
good behaviour.

### Memory is scoped, not global
Memory is addressed by scope (`user` / `division` / `agent` / `run`). An agent
receives a `ScopedMemory` narrowed to its own scopes and capability-checked on
every access. Knowing another division's scope id is not enough to read it.

### Agents collaborate through the Supervisor
`context.delegate(...)` routes through the Supervisor, which re-checks
permissions, inherits the parent's budget, and records the parent run. Depth is
bounded, so a delegation cycle fails cleanly instead of recursing. Two agents
are never coupled by an import (principle 12).

### The composition root is one file
`src/system.ts` is the only place that decides which implementations are wired
together. Everything else depends on interfaces. That is what makes the Core
replaceable piece by piece (principle 13).

## 4. Technology

Minimum viable, and chosen for what it does *not* pull in:

| Choice | Why |
| --- | --- |
| TypeScript, strict | One language across Core, agents, and UI. `exactOptionalPropertyTypes` and `noUncheckedIndexedAccess` are on. |
| Bun | Already the repo standard. Runs TypeScript directly. |
| `bun test` | Built in. **The Core has zero runtime and zero test dependencies.** |
| Bun workspaces | Makes the boundaries physical: a division cannot import the UI. |
| No validation library | JSON Schema is carried opaquely behind a `SchemaValidator` seam. Deferred, not decided. |

The Core's `package.json` has no `dependencies` block at all. That is the point.

## 5. Health and honesty

`bun run health` prints a real report and exits non-zero when unavailable. Today
it reports `unavailable`, because no provider adapters are registered. The
in-memory memory store reports itself `degraded` and says "volatile" in its own
detail string, so nothing can mistake it for durable storage.

This matters more than it looks: a foundation that reported "healthy" while
being empty would be a demo. Worst-status-wins aggregation means one unavailable
dependency is never hidden behind healthy neighbours.

## 6. Secrets

Configuration is a pure function of an injected environment record — nothing
reads a global. `NexusConfig` holds credentials; the only supported way to render
it is `describeConfig`, which emits presence flags and never values. There is no
`toString`, no serialisation helper, and no logging path that takes a provider
entry. Tests assert that health output and config summaries contain no key
material.

## 7. Known architectural risks

| Risk | Why it matters | Current mitigation |
| --- | --- | --- |
| **Supervisor becomes a god object** | Every dispatch flows through it; planning and scheduling will want to live there. | It is deliberately not a planner. Orchestration goes in a layer *above* it. Watch its line count. |
| **The provider abstraction leaks** | Vendors differ on tool calling, reasoning traces, and structured output. The neutral type may not survive contact. | `providerOptions` passthrough; the "edit means ADR" rule in §3. Revisit after the second adapter, not the first. |
| **Permissions become unmanageable** | Capability strings are untyped and will multiply across dozens of agents. | Deny-by-default limits the blast radius. A capability taxonomy is needed before ~5 divisions exist. |
| **Memory has no durable backend** | Everything is volatile today; the persistence choice constrains recall quality later. | The `MemoryStore` interface is the seam. Semantic search is additive. Decide before the first agent that must remember across sessions. |
| **Evidence is opt-in per tool** | A tool that lies about `producesEvidence` bypasses verification. | Enforced at the ToolBelt for tools that declare it. Review at tool registration. |
| **No schema validation library** | Tools hand-roll `validate()`, which will drift. | Isolated behind `SchemaValidator`. Pick one when the first real tool is built. |
| **Cost and rate limits are unmodelled** | The router can select a model but cannot yet refuse one on budget grounds. | `ExecutionBudget` exists and is inherited by child runs; enforcement is not built. |

## 8. Build order

Deliberately: **one vertical slice before any breadth.**

1. One real provider adapter (whichever key you hold) + `SchemaValidator`.
2. One real tool, end to end, with evidence.
3. One real agent in one division, using that tool.
4. A durable `MemoryStore`.
5. Only then: a second division.

Building three divisions on an unproven Core means fixing the same mistake three
times.

## 9. Not yet built, on purpose

Finance, Research, Business, Learning, Performance, Engineering and Legal
divisions. Any agent or skill. Provider adapters. Background jobs, schedulers and
autonomous workflows. Realtime voice. Web research and financial data. GitHub and
notification integrations. UI wiring. Multi-user auth. Distributed transport.

Each has a defined seam in the Core, so each is additive. None of them is
blocked by the foundation; all of them would be premature before step 3 above.
