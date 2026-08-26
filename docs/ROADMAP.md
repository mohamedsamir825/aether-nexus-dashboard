# Roadmap

What exists, what comes next, and what is deliberately not built.

This file holds **near-term sequencing**. The full 16-phase plan, and the product
specification behind it, live in
[`NEXUS_MASTER_SPEC.md`](NEXUS_MASTER_SPEC.md) — see its §25 (phases), §27 (gap
analysis) and §28 (decisions pending).

## Done — the foundation

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

## Next — one vertical slice, in this order

The rule: **prove the Core with one slice before adding breadth.** Building three
divisions on an unproven Core means fixing the same mistake three times.

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
| Finance, Research, Business, Learning, Performance, Engineering, Legal divisions | `AgentRegistry`, division packages | Nothing is proven until one agent works end to end |
| Any agent or skill | `Agent` / `Skill` contracts | Needs a real tool and a real provider first |
| Provider adapters | `ModelProvider` | Requires a credential and a deliberate first choice |
| Background jobs, schedulers, autonomous workflows | A layer above `Supervisor` (ADR 0007) | The Supervisor is deliberately not a planner |
| Realtime voice | `Tool` + streaming on `ModelProvider` | Depends on a provider adapter existing |
| Web research, financial data, GitHub, notifications | `Tool` + `Evidence` | Each is a tool; none is Core work |
| Verification strategy | `Verifier` (contract only) | Belongs to the Research division |
| UI wiring | `apps/` | `apps/dashboard` is a template, not the product (ADR 0003) |
| Multi-user auth, distributed transport | `Subject`, `EventBus` | Single-user, single-process is the honest current scope |

## Decisions still open

- **Persistence backend** for memory — deferred to step 5.
- **Schema validation library** — deferred to step 1.
- **Capability taxonomy.** Capability strings are plain strings. A taxonomy is
  needed before roughly five divisions exist; see the risk table in
  `ARCHITECTURE.md`.
- **Budget enforcement.** `ExecutionBudget` is defined and inherited by child
  runs, but nothing enforces it yet. Needed before autonomous execution.
- **Repository name.** Still `aether-nexus-dashboard`; the root package is
  `nexus`. Owner's call.
