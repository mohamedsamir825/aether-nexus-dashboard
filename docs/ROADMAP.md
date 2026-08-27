# Roadmap

What exists, what comes next, and what is deliberately not built.

This file holds **near-term sequencing**. The full 16-phase plan, and the product
specification behind it, live in
[`NEXUS_MASTER_SPEC.md`](NEXUS_MASTER_SPEC.md) — see its §25 (phases), §27 (gap
analysis) and §28 (decisions pending).

## Done — Phases 1-7 and 10

**Phase 1 — Foundation.** Contracts, registries, runtime primitives, tests.

**Phase 2 — Specification.** `NEXUS_MASTER_SPEC.md`, 5 contradictions and 1
defect surfaced before any code was built on them.

**Phase 3 — Engineering environment.** Zero-dependency `SchemaValidator`,
provider conformance suite, contract-stability tripwire.

**Phase 4 — Providers and routing.** Two adapters on different protocols;
budget enforcement; rate-limit and quota aware routing; the first real tool; a
task crossing every layer (`bun run demo`).

**Phase 6 — Finance Intelligence (static subset).** The FP&A lifecycle with
immutable forecast vintages, configured materiality, driver attribution that
keeps its residual, weighted scenarios, and recommendations that carry their
basis. See [`FINANCE_DIVISION.md`](FINANCE_DIVISION.md). The *continuous* loop
needs durable memory (Phase 10) and a scheduler (Phase 12); the spec anticipated
this and permits the static subset first.

**Phase 5 — Research Division.** Typed claims with provenance, a deterministic
pipeline, contradictions recorded rather than merged, and retrieved content
treated as data. See [`RESEARCH_DIVISION.md`](RESEARCH_DIVISION.md).

**Phase 7 — Business & Strategy.** Option sets with explicit trade-offs and no
recommendation — §5 gives the strategic call to the user, so there is nowhere in
the type to put one. Market facts arrive by delegation to Research and prices by
delegation to Finance, both by name, with no import between the packages. See
[`BUSINESS_DIVISION.md`](BUSINESS_DIVISION.md).

**Phase 10 — Memory.** Durable, append-only, versioned with validity intervals
and supersession chains, scope-isolated under adversarial ids. Forecast vintages
and scenario sets now outlive the process, Research contradicts across runs, and
Business remembers the framings it presented. Retrieval is BM25 and is called
lexical rather than semantic, because it is (ADR 0017).

**The composition root.** `packages/nexus` assembles Core, memory and all three
divisions under one policy, and `bun run nexus` runs the whole chain on
fixtures. Before it, no code outside a test ever installed a division: three
harnesses meant the suite proved each division worked under *a* configuration
rather than under *the* one a deployment runs.

**767 tests. Zero dependencies in the Core. Two Core contract edits, each
carrying an ADR** — `VerificationResult.confidence` (0014) and
`ExecutionBudget.maxAgentRuns` (0019).

## Detail — the foundation

- Core contracts: Agent, Skill, Tool, ModelProvider, ModelRouter, Supervisor,
  Memory, EventBus, Permissions, Execution, Evidence/Verification, Health.
- Registries for agents, skills, tools and providers, with duplicate rejection.
- Runtime: in-memory event bus, deny-by-default permission engine, volatile
  memory store with scoping, capability-based model router, tool belt, execution
  context, health aggregation, Core Supervisor.
- Configuration with secret redaction; `.env.example`; hardened `.gitignore`.
- 78 tests, zero dependencies, no network, no credentials.
- `bun run health`.

## Decided since this file was written

Five ADRs (0008–0012) resolved the blocking contradictions and fixed the provider
and design direction. In short: a separate asynchronous authorisation broker;
`SpeechProvider` as a sibling contract; User Intelligence before Learning; **free
API tiers only**, served by two adapters (`openai-compatible` covering five
providers, plus Gemini's native protocol); and a fixed Command Center reference
hierarchy. See [`adr/`](adr/) and [`design/`](design/).

## In progress — Phase 9, Cross-Agent Intelligence

The chain exists; its properties are what is being made checkable.

**Landed:** run lineage in the Supervisor's own event payloads, so
`buildRunTree()` reconstructs who called whom from the trail alone (ADR 0018);
cycles refused by name at the first re-entry rather than eight hops later;
`maxAgentRuns`, because depth never bounded breadth (ADR 0019).

**Still open in Phase 9:** the §18.1 canonical chain includes Risk, which does
not exist; and the trace is reconstructed in memory from a live subscription
rather than from the durable log.

**Immediately useful:** add a free API key to `.env`, register the matching
adapter, and `bun run demo` performs a real model call. Nothing in the Core
changes to make that happen — that is the whole point.

## Historical — the original slice ordering

The rule was: **prove the Core with one slice before adding breadth.** Building
three divisions on an unproven Core means fixing the same mistake three times.

1. **A `SchemaValidator` implementation.** Every tool needs input validation and
   hand-rolled `validate()` will drift. Pick the library here, once.
2. **Two provider adapters, both free** ([ADR 0011](adr/0011-free-tier-provider-strategy.md)) —
   `openai-compatible` (Groq · Cerebras · OpenRouter · Mistral · SambaNova) and
   `google` (Gemini). Two genuinely different wire protocols, which is the
   condition ADR 0004 named for judging its own abstraction. If either forces a
   change to `contracts/model-provider.ts`, ADR 0004 was wrong and needs a
   superseding ADR.
3. **One real tool**, end to end, including evidence.
4. **One real agent**, in one division, using that tool through the Supervisor.
5. **A durable `MemoryStore`.** Needed before any agent must remember across
   sessions. Persistence choice constrains recall quality, so decide it with the
   first real agent's needs in view, not before.
6. **A second provider adapter** — the real test of the abstraction.

Only after step 6: a second division.

## Not yet built, on purpose

Each has a defined seam in the Core, so each is additive rather than blocked.

| Deferred | Seam it will attach to | Why not yet |
| --- | --- | --- |
| Learning, Performance, Engineering, Legal, Risk divisions | `AgentRegistry`, division packages | Research, Finance and Business are built; the rest wait on Phases 11-12 |
| Semantic retrieval | `EmbeddingProvider` (declared, unimplemented) | Every implementation costs a dependency or a model call; BM25 is honest in the meantime |
| Provider adapters | `ModelProvider` | Requires a credential and a deliberate first choice |
| Background jobs, schedulers, autonomous workflows | A layer above `Supervisor` (ADR 0007) | The Supervisor is deliberately not a planner |
| Realtime voice | `Tool` + streaming on `ModelProvider` | Depends on a provider adapter existing |
| Web research, financial data, GitHub, notifications | `Tool` + `Evidence` | Each is a tool; none is Core work |
| Verification strategy | `Verifier` (contract only) | Belongs to the Research division |
| UI wiring | `apps/` | `apps/dashboard` is a template, not the product (ADR 0003) |
| Multi-user auth, distributed transport | `Subject`, `EventBus` | Single-user, single-process is the honest current scope |

## Decisions still open

- ~~**Persistence backend** for memory.~~ Decided (ADR 0017): append-only JSON
  lines over a local file, zero dependencies.
- ~~**Schema validation library.**~~ Decided: a zero-dependency `SchemaValidator`
  that refuses assertions it cannot enforce rather than ignoring them.
- ~~**Budget enforcement.**~~ Enforced across a run tree on four dimensions:
  time, model calls, tool calls and agent runs.
- **Lineage on `NexusEvent`.** Deferred by ADR 0018: run lineage lives in the
  Supervisor's payloads today. Revisit when a second independent publisher needs
  it — a background worker, or an Orchestrator emitting its own step events.
- **Capability taxonomy.** Capability strings are plain strings. A taxonomy is
  needed before roughly five divisions exist; see the risk table in
  `ARCHITECTURE.md`.
- ~~**Repository name.**~~ Decided: `mohamedsamir825/NEXUS` (private) is the
  canonical repository, migrated with full history.
