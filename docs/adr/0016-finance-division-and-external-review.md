# ADR 0016 — The Finance Division, and what the reference projects contributed

**Status:** Accepted · **Date:** 2026-08-27 · **Phase:** 6 (Finance Intelligence)

## Context

Phase 6 is the FP&A continuous forecast lifecycle (§4.3). Before designing it,
the owner's collected reference repositories were inspected for architecture,
technique, security model, algorithms and testing strategy worth adopting.

## Part 1 — External review

Four repositories were inspected as actual code. Findings are recorded whether
or not they changed a decision.

### `mohamedsamir825/OpenBB` — **not adopted**

Financial data platform; 28 provider integrations; inspected at
`openbb_platform/core/openbb_core/provider/abstract/provider.py`.

**Licence is the decisive fact: AGPL-3.0.** NEXUS is MIT. Vendoring, importing
or linking any part of it would relicense NEXUS, and the network clause reaches
further than the owner of a private system would expect. There is no version of
"just take the fetchers" that is safe here.

*Useful:* a provider declares `credentials: list[str]` and the platform stays
functional without them — the free path is the default path, not a degraded
mode. *Redundant:* NEXUS already decided this in ADR 0011 and implements it in
the provider abstraction. *Do not import:* anything, on licence grounds.
*Belongs:* nowhere; the pattern is already present. Its real contribution was
confirming that a standardised model with swappable fetchers is the right shape,
which is the shape `SourceRetriever` already has.

### `mohamedsamir825/langgraph-supervisor-py` — **rejected, and worth recording why**

MIT. Inspected `langgraph_supervisor/handoff.py`.

Delegation is a tool the model calls: `create_handoff_tool` exposes
`transfer_to_<agent_name>` and the LLM chooses to invoke it.

**This is precisely what ADR 0007 refuses.** In NEXUS the Supervisor is not a
planner and delegation is not a model decision — `context.delegate()` runs
through the Supervisor so that permission checks, budget inheritance, delegation
depth bounding and the event trail all apply. Making handoff a tool call moves
the routing decision inside the model's output, where none of those apply.

Adopting it would create exactly the parallel architecture this project keeps
refusing. *Not adopted.* Recorded because the idea is attractive and will
resurface.

### `mohamedsamir825/crewAI` — **one idea adopted, its mechanism rejected**

MIT. Inspected `lib/crewai/src/crewai/process.py` and `crew.py`.

`Process.hierarchical` runs a roster under a `manager_agent`, and a crew
validates that a manager LLM exists before it will run hierarchically.

*Adopted:* the tiered roster with an accountable director is the right shape for
a division, and it matches §4.1 independently. *Rejected:* the manager is an LLM
that plans and assigns — ADR 0007 again. *Belongs:* the roster shape is in
`DivisionDescriptor`; the accountability is expressed as stages with named
owners, not as a model that decides who works next.

### `mohamedsamir825/letta` — **nothing to review**

The fork contains **nine files, all documentation and policy — no source code**.
Its memory model could not be inspected, so nothing is claimed about it. Noted
because "we looked at Letta for memory versioning" would otherwise be assumed.

### Repositories not consulted for Phase 6

`deck.gl`, `arwes`, `tremor`, `shadcn-echarts`, `palantir-demo`, `lattice`,
`Vane`, `forge-ui`, `three.js`, `motion` are visualisation and UI. Phase 6 does
not build UI, and reviewing them now would be Phase 14 work done early.
`dify`, `n8n`, `MetaGPT`, `litellm`, `anything-llm`, `opencti` are orchestration,
routing and OSINT platforms whose relevant patterns are already settled by
ADRs 0007, 0011 and 0013.

## Part 2 — Finance decisions

### Decision 1 — A vintage ledger, in memory, behind a narrow interface

§4.3 requires vintages that are "superseded, never overwritten, so accuracy can
be measured retrospectively". The reason is the clause at the end: if a forecast
is edited in place, then once actuals arrive there is nothing to compare them
against — the record says the forecast was always right.

The ledger enforces this rather than documenting it. Vintages are
`Object.freeze`d, because `readonly` is erased at runtime and an audit chain
that depends on nobody trying is not an audit chain. Appending onto a stale head
is refused rather than rebased.

Durable storage is gap `A3`, Phase 10. What is implemented here is the
*semantics*, so Phase 10 replaces the storage without touching callers. Until
then, history within a process is complete and history across restarts does not
exist. **The full Phase 6 loop is not achievable before Phase 10, and the spec
says so.**

### Decision 2 — The residual is never distributed

Driver attribution reports `unexplained` rather than forcing the bridge to tie
out. A bridge that always sums to the total reports perfect explanation whether
or not the drivers explain anything, and §4.2 asks specifically for "variance
explained versus unexplained" — distributing the residual would delete the
metric it is meant to produce.

Downstream, an unexplained variance is allowed to stop the loop: a material
variance no driver movement accounts for does **not** produce a revised
forecast. Revising anyway would encode a cause nobody identified.

### Decision 3 — A recommendation is a `Claim`

`ClaimStatus: 'recommendation'` already requires, per §6.1, that a claim name
what it derives from AND the assumptions it rests on. Phase 6's test requirement
"recommendations carry their scenario basis" is therefore satisfied structurally
rather than by a field somebody could forget to populate, and no second, weaker
standard for financial advice is created.

The consequence is deliberate: this division cannot emit a recommendation
without also emitting the variance and driver claims behind it.

### Decision 4 — Materiality is configuration

§4.3 is explicit. A model deciding what counts as material would be a model
deciding what the owner gets told about. Thresholds are supplied by the owner
and a test asserts that the same numbers under a stricter policy change the
answer.

### Decision 5 — One agent, not four

§4.3 names four stage owners. All six stages run, but inside one registered
agent. Four agents would mean four registrations, four grants and three
delegations for a pipeline that is pure arithmetic with no independent decision
at any boundary — cost with no guarantee bought. The role ids exist so a later
phase can split them without renaming anything. The remaining eleven specialists
in §4.1 are **not** registered: a roster entry resolving to nothing is a fake
implementation.

## Consequences

No Core contract changed; the stability tripwire stayed green throughout. No
dependency was added. No paid API. The whole division is deterministic and runs
with no provider, no network and no cost.

One misplacement was noticed and deliberately not fixed here: `ClaimValidator`
is a Core contract but its only implementation, `createClaimValidator`, lives in
the Research division. Finance now also needs §6.1 enforcement, so the
implementation arguably belongs in the Core. Moving it would edit Research
outside Phase 6's scope, so it is recorded instead.
