# NEXUS Master Specification

**Status:** Specification — Phase 2. Nothing here is implemented except where
§27 says otherwise.
**Foundation this describes:** commit `eb33906`, `packages/core`, 78 tests.
**Supersedes:** nothing. **Superseded by:** nothing.

This document is the long-term product and architecture specification for NEXUS.
It is a target, not a plan of record for the next sprint — [`ROADMAP.md`](ROADMAP.md)
holds near-term sequencing, and [`ARCHITECTURE.md`](ARCHITECTURE.md) describes what
the Core actually does today.

**How to read this document.** Sections 1–26 describe the intended system.
Section 27 compares that intent against the built foundation and lists every
contract that must be added or changed. Section 28 lists decisions that need a
human, not an engineer. If §1–26 and §27 disagree, §27 is the true statement of
what exists.

**Rule of precedence.** Where this specification conflicts with an accepted ADR,
neither silently wins: the conflict is recorded in §27 and resolved by a new ADR.

---

## 1. Vision

NEXUS is a **Personal Intelligence & Execution System** that begins as a personal
AI operating system for one user and is designed to evolve into a Business /
Executive Intelligence OS.

It is not a chatbot. A chatbot answers the question in front of it. NEXUS is an
interconnected system of specialised divisions that maintains a model of the
user's state, goals, projects, knowledge and decisions, and that keeps working
when nobody is typing.

Three properties distinguish it from an assistant:

1. **Specialisation with boundaries.** A Finance specialist reasons like a
   Finance specialist and cannot read the Learning division's memory. Depth comes
   from narrowness; safety comes from the boundary being structural rather than
   advisory.
2. **Continuity.** State persists and evolves. A forecast is not a document
   produced once; it is a living position updated as actuals arrive.
3. **Execution over advice.** The system is measured by what changed, not by how
   good the recommendation sounded.

**Success criteria for the whole system.** NEXUS is working when: it notices
something the user did not ask about and is right to raise it; a forecast
updates itself correctly without being asked; a claim it makes can be traced to
a source; and a specialist declines to answer outside its competence and routes
the question instead.

**Non-goals.** NEXUS is not an autonomous agent that acts without authorisation
on high-impact operations; not a replacement for professional legal, financial
or medical judgement; not a general-purpose chat interface; and not a
multi-tenant SaaS product in its first several phases.

---

## 2. Core architecture

### 2.1 Responsibilities and boundaries

| Component | Owns | Must never |
| --- | --- | --- |
| **NEXUS Core** | Contracts, registries, runtime primitives, composition root | Contain product or division logic |
| **Supervisor** | Resolve target → check permission → build context → run → emit events | Plan, decompose, schedule, or retry |
| **Orchestrator** | Multi-step plans, decomposition, parallelism, retries, compensation | Bypass the Supervisor to reach an agent |
| **Agent** | A role's judgement within one division | Import another agent, or name a model vendor |
| **Division** | A roster of agents, shared knowledge, KPIs, escalation rules | Execute work itself |
| **Skill** | One reusable procedure, done well | Know which agent owns it |
| **Tool** | One capability for touching the outside world | Decide when it should be used |
| **Model Provider** | Speaking one vendor's protocol | Leak vendor shapes upward |
| **Model Router** | Turning a capability policy into a concrete model | Hold agent logic |
| **Memory** | Durable state, scoped and permissioned | Be globally readable |
| **User Intelligence** | The evolving model of the user | Be silently mutated by any agent |
| **Event Bus** | Decoupled observation of everything that happens | Be a request/response channel |
| **Execution Engine** | Run identity, budget, cancellation, context derivation | Grant capability |
| **Permissions** | Whether an action is allowed | Allow anything by omission |
| **Evidence** | Where an external claim came from | Be fabricated, ever |
| **Claims** | What is asserted and with what epistemic status | Conflate fact with inference |
| **Verification** | Whether evidence supports a claim | Resolve conflicts by hiding them |
| **Background Workers** | Work with no user waiting on it | Escape permissions or observability |
| **Scheduling** | When recurring work runs | Assume a run succeeded |
| **Notifications** | Reaching the user outside a session | Be the only record of an event |
| **Observability** | Cost, latency, errors, traces, audit | Contain secrets |
| **Security** | Secrets, authn/authz, audit, approval of high-impact actions | Be added later as a layer |

### 2.2 The two rules that keep it decoupled

**Rule A — the Supervisor is the only path to an agent.** Nothing constructs an
agent context or invokes `handle()` except the Supervisor. The Orchestrator sits
*above* the Supervisor and composes dispatches; it does not reach past it.

**Rule B — agents collaborate only through delegation.** An agent that needs
another specialist calls `context.delegate(...)`, which routes back through the
Supervisor for a fresh permission check, budget inheritance, run linkage and
depth bounding. No agent module imports another agent module. This is what keeps
the dependency graph a tree of runs rather than a mesh of imports.

### 2.3 Layer diagram

```txt
   User · Voice · Command Center · Schedules · Webhooks
                        │
              ┌─────────▼─────────┐
              │   ORCHESTRATOR    │  plans, retries, parallelism   (not built)
              └─────────┬─────────┘
                        │ dispatch()
              ┌─────────▼─────────┐
              │    SUPERVISOR     │  resolve · permit · context · run · emit
              └─────────┬─────────┘
                        │  delegate() loops back here, never sideways
   ┌──────────┬─────────┼─────────┬──────────┬──────────┐
   │ Finance  │ Research│Business │ Learning │   …      │   DIVISIONS
   │ Director │Director │Director │ Director │          │
   │ ├ Mgrs   │ ├ Mgrs  │ ├ Mgrs  │ ├ Mgrs   │          │
   │ └ Specs  │ └ Specs │ └ Specs │ └ Specs  │          │
   └──────────┴─────────┴────┬────┴──────────┴──────────┘
                             │  every agent receives exactly:
        ToolBelt · ModelRouter · ScopedMemory · EventBus · Permissions
                             │
   ┌─────────┬───────────┬───┴────┬──────────┬────────────┬──────────┐
   │  Tools  │ Providers │ Memory │  Events  │  Evidence  │ Workers  │
   └─────────┴───────────┴────────┴──────────┴────────────┴──────────┘
```

---

## 3. The agent company model

A division is a **company**, not a prompt. The distinction matters because a
single large prompt cannot hold role separation, escalation, or accountability —
it degrades as responsibilities accumulate.

### 3.1 Structure

| Tier | Role | Typical work |
| --- | --- | --- |
| **Director** | Owns the division's mandate and KPIs | Routes inbound work, sets standards, escalates, signs off |
| **Manager** | Owns one functional area | Decomposes within the area, aggregates specialist output |
| **Specialist** | Does one kind of analysis deeply | Executes skills, produces findings with evidence |

Small divisions may collapse Manager into Director. The tier is a
responsibility, not a mandatory object.

### 3.2 What a division owns

- **Roster** — its agents and their roles.
- **Knowledge** — reference material and methodology specific to the domain.
- **Memory** — a division-scoped store its agents share.
- **Workflows** — named, repeatable sequences (see the FP&A cycle in §4.3).
- **KPIs** — how the division knows it is doing its job.
- **Escalation rules** — when to go to the Director, and when to leave the
  division entirely via delegation.
- **Collaboration interface** — the roles other divisions may address, which is
  narrower than its full roster. A division exposes its Director and named
  entry-point roles; its internal specialists are not addressable from outside.

### 3.3 Extensibility contract

Adding a division must require: a new package under `packages/divisions/<name>`,
agent registrations, permission policy entries, and nothing else. Zero Core
edits. This is testable and should be an actual test once the second division
exists.

---

## 4. Finance company

The most demanding division, and the reason the architecture must support
continuous background work rather than request/response only.

### 4.1 Roster

| Tier | Role | Mandate |
| --- | --- | --- |
| Director | **CFO** | Financial position, capital allocation, sign-off, escalation to user |
| Manager | **FP&A** | Planning, forecasting, variance, drivers, scenarios *(see §4.3)* |
| Manager | **Controller** | Actuals, close, reconciliation, data integrity |
| Manager | **Treasury** | Cash, liquidity, working capital, funding |
| Specialist | Budgeting | Budget construction and reforecast mechanics |
| Specialist | Forecasting | Model execution and calibration |
| Specialist | Cash Flow | Direct/indirect cash projection |
| Specialist | Management Accounting | Unit economics, contribution, cost allocation |
| Specialist | Risk | Exposure identification, sensitivity, stress |
| Specialist | Investment Intelligence | Opportunity appraisal, return analysis |
| Specialist | Market Intelligence | Rates, FX, commodities, macro inputs |
| Specialist | Inventory Finance | Inventory carrying cost, turns, obsolescence |
| Specialist | Financial Advisor | Personal financial position and planning |
| Specialist | Scenario Analysis | Multi-path modelling, probability weighting |
| Specialist | Financial Modeling | Model construction, validation, documentation |

### 4.2 KPIs

Forecast accuracy against subsequent actuals (tracked per horizon); variance
explained versus unexplained; time from actuals landing to forecast update;
proportion of recommendations acted on; number of material surprises the
division failed to flag in advance.

### 4.3 FP&A: the continuous forecast lifecycle

**FP&A must not produce static forecasts.** A forecast is a living position
carrying its assumptions, drivers, vintage and confidence. This is the single
most architecturally demanding requirement in this document, because it needs
scheduling, background execution, memory versioning and cross-division
delegation simultaneously.

```txt
        ┌──────────────────────────────────────────────────┐
        │                                                  │
        ▼                                                  │
   ┌─────────┐   ┌──────────┐   ┌────────┐   ┌──────────┐  │
   │ ACTUALS │──▶│ VARIANCE │──▶│ DRIVER │──▶│ FORECAST │  │
   │  land   │   │ analysis │   │analysis│   │  update  │  │
   └─────────┘   └──────────┘   └────────┘   └────┬─────┘  │
                                                  │        │
                      ┌───────────────────────────┘        │
                      ▼                                    │
              ┌──────────────┐   ┌────────────────┐   ┌────┴─────┐
              │   SCENARIO   │──▶│  MANAGEMENT    │──▶│ REVISED  │
              │   analysis   │   │ recommendation │   │ FORECAST │
              └──────────────┘   └────────────────┘   └──────────┘
                                          │
                                   user decision
                                   (may become a new assumption)
```

| Stage | Owner | Input | Output | Trigger |
| --- | --- | --- | --- | --- |
| Actuals | Controller | Source data | Validated period actuals | Data arrival / schedule |
| Variance analysis | FP&A | Actuals vs forecast | Variances, materiality flags | Actuals validated |
| Driver analysis | FP&A | Material variances | Causal attribution, assumption breaks | Variance material |
| Forecast update | FP&A | Revised drivers | New forecast vintage | Driver change |
| Scenario analysis | Scenario Analysis | Forecast + uncertainty | Weighted paths | Forecast updated, or on request |
| Recommendation | CFO | Scenarios + position | Actionable recommendation | Material change |
| Revised forecast | FP&A | Accepted recommendation | Committed forecast vintage | User decision |

**Architectural consequences.** Every forecast is a **versioned, immutable
vintage** with its assumptions attached — superseded, never overwritten, so
accuracy can be measured retrospectively. The loop is driven by **events and
schedules**, not by user requests. Variance materiality thresholds are
**configuration**, not model judgement. Market inputs arrive by **delegation to
Research**, and carry evidence.

### 4.4 Cross-division interfaces

Finance ⇄ **Research** (market data, rates, competitor financials — always with
evidence); ⇄ **Business** (strategic initiatives priced; financial constraints
on strategy); ⇄ **Performance** (goal feasibility, resource commitment); ⇄
**Legal** (regulatory or contractual financial obligations). All via delegation.

---

## 5. Business & Strategy company

| Tier | Role | Mandate |
| --- | --- | --- |
| Director | **Chief Strategy** | Strategic position, prioritisation, trade-offs |
| Manager | Market Intelligence | Market structure, sizing, segmentation, dynamics |
| Manager | Competitive Intelligence | Competitor tracking, positioning, likely moves |
| Manager | Growth | Acquisition, retention, expansion levers |
| Specialist | Marketing | Positioning, messaging, channel analysis |
| Specialist | Operations | Process, capacity, efficiency |
| Specialist | Product | Product strategy, roadmap analysis |
| Specialist | Sales Intelligence | Pipeline, conversion, sales motion |
| Specialist | Business Analysis | Model analysis, unit economics with Finance |
| Specialist | Decision Support | Option framing, criteria, trade-off surfacing |

**KPIs:** decision quality reviewed after outcomes are known; strategic surprises
not anticipated; opportunities identified that were acted on; time from market
signal to briefing.

**Boundary.** Business frames and analyses options; it does not price them —
that is Finance — and it does not assert market facts without Research evidence.
Its distinctive output is **option sets with explicit trade-offs**, not a single
recommendation, because the user makes the strategic call.

---

## 6. Research & Intelligence company

| Tier | Role | Mandate |
| --- | --- | --- |
| Director | **Research Director** | Question framing, method selection, quality bar |
| Manager | Web Research | Open-web retrieval and synthesis |
| Manager | News Intelligence | Event detection, significance assessment |
| Manager | Academic Research | Peer-reviewed and technical literature |
| Specialist | Source Verification | Provenance, credibility, independence |
| Specialist | Fact Extraction | Atomic claims from documents |
| Specialist | Cross-source Comparison | Agreement, conflict, corroboration |
| Specialist | Intelligence Briefing | Synthesis for decision-makers |
| Specialist | Trend Detection | Signal over time |
| Specialist | Monitoring | Standing watches on topics |

### 6.1 Epistemic classification — mandatory

Every Research output classifies each statement. **This is the division's core
discipline and its most important contract.**

| Status | Means | Requires |
| --- | --- | --- |
| **FACT** | Asserted by a traceable source | ≥1 Evidence with a resolvable source and retrieval timestamp |
| **INFERENCE** | Derived by reasoning from facts | The facts it derives from, explicitly linked |
| **RECOMMENDATION** | A suggested action | The inferences supporting it, and stated assumptions |
| **UNCERTAIN** | Insufficient or conflicting basis | An explicit statement of what is missing or conflicting |

**Rules.** A FACT without evidence is a defect, not a stylistic issue. Conflicts
between sources are represented explicitly as conflicts — never averaged,
silently resolved, or dropped. Absence of evidence is reported as UNCERTAIN,
never as a confident negative. **Fabricating a source, a URL, a quotation or a
retrieval timestamp is the single most severe failure mode in NEXUS**; the
system must be built so this is structurally difficult, not merely discouraged.

**KPIs:** claims traceable to source; conflicts surfaced rather than missed;
briefing lead time on monitored topics; correction rate after the fact.

---

## 7. Learning & Development company

The most personalised division. Its quality depends on User Intelligence (§11)
more than on any model.

| Tier | Role | Mandate |
| --- | --- | --- |
| Director | **Learning Director** | Curriculum, sequencing, level assessment |
| Manager | Course Manager | Active courses, deadlines, coverage |
| Specialist | German Coach | German language acquisition |
| Specialist | English Coach | English language acquisition |
| Specialist | Business Tutor | Business concepts |
| Specialist | Finance Tutor | Finance concepts *(teaching, not analysis)* |
| Specialist | Economics Tutor | Economics concepts |
| Specialist | Knowledge Synthesizer | Cross-topic connection |
| Specialist | Scenario Simulator | Applied practice scenarios |
| Specialist | Exam Preparation | Assessment readiness |
| Specialist | Skill Gap Analyst | Target level vs current level |
| Specialist | Progress Analyst | Retention, velocity, plateau detection |

### 7.1 Special rule — specialisation must not create blindness

A specialist that answers *"that is outside my domain"* to a legitimate
cross-domain question has failed, even though it respected its boundary.

**Required behaviour, in order:**

1. **Explain the connection** at the educational level appropriate to the user's
   current state, when the specialist genuinely understands it.
2. **Delegate for depth** when real specialist analysis is needed, via the
   Supervisor.
3. **Attribute clearly** — the user sees which part is the tutor's explanation
   and which is the specialist division's analysis.
4. **Never fabricate** specialist-grade analysis it is not qualified to produce.

**Worked example.** The user is studying Business and asks about the financial
consequence of a decision. The Business Tutor explains the *concept* — why the
decision has a financial dimension and what mechanism connects them — and, if
the user's actual numbers are involved, delegates to Finance for the analysis,
presenting both parts distinctly.

The boundary being crossed is **memory and authority**, not comprehension. The
tutor may understand and explain; it may not read Finance's memory or assert
Finance's conclusions as its own.

**KPIs:** demonstrated level change against targets; retention over time;
cross-domain questions answered rather than deflected; gap closure rate.

---

## 8. Performance company

| Tier | Role | Mandate |
| --- | --- | --- |
| Director | **Performance Director** | Execution across all commitments |
| Manager | Goal Management | Goal definition, decomposition, tracking |
| Manager | Execution | What is actually moving, and what is stuck |
| Specialist | Habit / Behavior Analysis | Behavioural patterns, adherence |
| Specialist | Decision Review | Retrospective decision quality |
| Specialist | Scenario Training | Rehearsal of high-stakes situations |
| Specialist | Progress Analysis | Trajectory versus target |
| Specialist | Accountability | Surfacing avoidance and drift |
| Specialist | Planning | Sequencing and capacity realism |

**Bias toward execution.** Performance outputs are commitments, blockers and
next actions — not advice. Its distinctive value is **Decision Review**: a
recorded decision, its stated reasoning, and its actual outcome, compared once
the outcome is known. That is only possible because decisions are stored with
their reasoning in memory.

**KPIs:** commitments completed; time-to-unblock; decision quality trend;
detected drift raised before failure.

---

## 9. Engineering company

| Tier | Role | Mandate |
| --- | --- | --- |
| Director | **Software Architect** | Architecture, contracts, technical direction |
| Specialist | Backend Engineer | Core services and data |
| Specialist | Frontend Engineer | Interface implementation |
| Specialist | AI / Agent Engineer | Agents, skills, prompts, evaluation |
| Specialist | Testing Engineer | Test strategy and coverage |
| Specialist | Security Engineer | Threat modelling, review, hardening |
| Specialist | DevOps | Build, deploy, runtime operations |
| Specialist | GitHub Engineer | Repository, PR and CI operations |
| Specialist | Technical Research | Technology evaluation |

**Constraint.** Engineering agents must reach code and repositories through
**Tools**, never through a hardcoded SDK or a specific provider's coding
capability. This division is also the one most likely to want write access to
the world; §20's high-impact authorisation applies with full force.

---

## 10. Legal / Compliance intelligence

| Role | Mandate |
| --- | --- |
| Legal Research | Statute, regulation, case material retrieval |
| Compliance | Obligation tracking against the user's context |
| Regulatory Monitoring | Standing watch on relevant regimes |
| Contract Intelligence | Term extraction, obligation and risk surfacing |
| Risk Analysis | Legal exposure assessment |

**Hard boundary.** This division is **intelligence and support, never authority**.
It does not give legal advice, does not certify compliance, and does not
authorise action. Every output carries an explicit statement that it is research
requiring qualified human review, and every factual assertion carries Evidence.
Jurisdiction is a required parameter, never inferred.

---

## 11. User Intelligence

NEXUS maintains an evolving model of the user. Its failure mode is **staleness**:
continuing to treat the user as a student after they have become a practitioner,
or optimising for a goal abandoned months ago.

### 11.1 Contents

Current role · current level per domain · goals (with horizon) · active projects ·
learning state · progress · decision history · preferences (interaction, depth,
format) · active priorities · long-term objectives · constraints (time, capital,
obligations).

### 11.2 Lifecycle

**Update.** Only through explicit, attributed writes. Sources: direct user
statement (highest trust), observed behaviour, division assessment (e.g. Skill
Gap Analyst), and elapsed time (which decays confidence rather than asserting
change).

**Verify.** Any assertion that changes the user model materially — role, level,
goal — is either confirmed by the user or held at reduced confidence. **Agents
must not silently redefine the user.**

**Version.** The user model is versioned. Superseding a fact retains the prior
value with its validity interval. "The user was a student in 2025 and is a
practitioner in 2026" must both be answerable.

**Access.** Read access is scoped: divisions receive the user projection relevant
to them. Learning does not need the user's cash position; Finance does not need
their German level. Write access is narrower still — most agents propose changes
rather than commit them.

**Decay.** Facts have confidence that decays on a per-field schedule. A stated
preference ages slowly; an assessed skill level ages fast.

---

## 12. Memory architecture

### 12.1 Layers

| Layer | Lifetime | Contents | Typical access |
| --- | --- | --- | --- |
| **Working** | One run | Intermediate state within a task | The run only |
| **Episodic** | Long | What happened: runs, decisions, outcomes | Owning division + Performance |
| **Semantic** | Long | Domain knowledge, methodology | Owning division, read-mostly |
| **User Profile** | Permanent, versioned | §11 | Scoped projection per division |
| **Project** | Project lifetime | One project's context and history | Contributing divisions |
| **Agent** | Long | One agent's private working knowledge | That agent only |
| **Organizational** | Permanent | Cross-division shared truth | All, read; Director-gated write |

### 12.2 Access model

Access is granted by **scope plus capability**, both required. Holding a scope id
is not authorisation. Divisions get their own scope, a scoped projection of User
Profile, and the project scopes they contribute to. Organizational memory is
broadly readable and narrowly writable. Agent memory is private by construction.

### 12.3 Requirements

Records are **attributed** (which run wrote this) and **versioned** (supersession
retains history with validity intervals). Retrieval must eventually be semantic,
not substring. Forgetting is a first-class operation for correction and for user
request. Memory reads and writes are auditable.

---

## 13. Model layer

### 13.1 Principle

**No provider is ever named in agent logic.** An agent declares what it needs;
the Router decides who serves it. Providers under consideration: Gemini,
OpenRouter, Anthropic/Claude, OpenAI, xAI/Grok, future providers, and local
models. Local models are a first-class case, not an afterthought: they change
the cost and latency calculus, and they may be the only option for
privacy-sensitive work.

### 13.2 Routing inputs

| Dimension | Purpose |
| --- | --- |
| Capability | Hard filter — tool use, vision, audio, structured output, reasoning |
| Context window | Hard filter on input size |
| Cost | Ceiling per task class, and cumulative budget |
| Free tier | Prefer a free quota when it satisfies the task |
| Quota | Remaining allowance; a provider near its limit deprioritised |
| Rate limit | Current pressure; back off rather than fail |
| Latency | Interactive and voice work needs a latency ceiling |
| Reliability | Observed error rate feeds selection |
| Health | Unhealthy providers excluded, not attempted |
| Task class | Named classes (`interactive`, `deep-analysis`, `voice`, `batch`) resolve to policies |

### 13.3 Cost, quota and fallback

Budgets exist at task, run, division and global level. Exceeding a budget is a
**typed failure**, never a silent downgrade to a cheaper model, and never a
silent overspend. Fallback is a policy decision — ordered candidates, tried on
failure — and each attempt is recorded with its outcome.

**Task-class routing** is the ergonomic layer: agents should normally name a task
class rather than assemble a policy by hand, so cost policy can be tuned centrally.

---

## 14. Tools & external integrations

### 14.1 Candidates

Web research · news · academic research · financial data · market data · GitHub ·
email · calendar · databases · documents · browser automation · notifications ·
voice · text-to-speech · speech-to-text.

### 14.2 Rules

Every tool **declares before it runs**: input and output schema, required
capabilities, side-effect class (`none` / `read` / `write` / `external`), and
whether it produces evidence. A tool that declares evidence and returns none is
a hard error.

**Secrets never reach the frontend.** Every credentialed integration is called
from the server side. The interface receives results, never keys. There is no
exception for convenience or for local development.

**Write and external tools are gated.** Anything that leaves the system or
changes external state is subject to §20 authorisation. Rate limiting and quota
handling belong to the tool, and exhaustion is a typed failure, not an exception.

---

## 15. Background intelligence

Work with nobody waiting. This is what makes NEXUS a system rather than an
interface.

**Candidates:** news monitoring · market monitoring · FP&A forecast updates ·
research monitoring · competitive intelligence · project monitoring · alerting ·
scheduled reporting · knowledge refresh.

**Requirements.** Every job is: **observable** (start, finish, duration, cost,
outcome), **retryable** with a declared policy and backoff, **permission-carrying**
(it runs as a subject and is checked exactly like an interactive run — background
is not a privilege escalation), **failure-aware** (a job that fails repeatedly
surfaces to the user rather than retrying forever), **idempotent** or explicitly
marked otherwise, and **cancellable**.

**Scheduling** must support intervals, cron, and event-driven triggers. A missed
run is a recorded fact, not a silent gap. Overlap policy is explicit per job.

---

## 16. Realtime voice

### 16.1 Target interaction

The user enters a room and says *"NEXUS…"*. The system wakes, listens, answers in
a natural executive voice, and the interface reacts visually throughout.

### 16.2 Pipeline

```txt
  Wake word  →  Microphone  →  Speech-to-Text  →  SUPERVISOR
      ▲                                              │
      │                                       agent selection
      │                                              │
      │                                     tool / model execution
      │                                              │
  UI reacts ◀── Text-to-Speech ◀── response ◀────────┘
  (listening · thinking · speaking · error)
```

### 16.3 Requirements

**Latency is the design constraint**, not quality — a correct answer that arrives
late fails the interaction. This forces streaming end to end, a latency-bounded
routing class, and speculative TTS start before generation completes.

**Barge-in.** The user interrupts; the system stops speaking immediately and
listens. Non-negotiable for natural conversation.

**Privacy.** Wake-word detection is local. Audio is not retained beyond the
interaction unless the user explicitly asks. The interface always shows when the
microphone is live.

**Voice is an interface, not an authority.** High-impact actions are never
authorised by voice alone (§20).

---

## 17. Command Center

The final interface. **The dashboard currently in `apps/dashboard/` is a
temporary visual reference and must not define the product architecture** — it
is a third-party template with fixture data, quarantined under ADR 0003.

### 17.1 Direction

Dark luxury intelligence aesthetic · Gotham-inspired atmosphere · executive
operations room · glassmorphism · depth · motion · agent visualisation ·
interactive globe · intelligence map · live event stream · agent status · radial
progress · financial dashboards · KPI visualisation · real-time execution ·
voice visualisation · alerts · notifications · command interface · responsive
layouts.

> **Design direction is fixed by [ADR 0012](adr/0012-command-center-design-direction.md).**
> A strict reference hierarchy governs: the NEXUS Command Center mock-up is
> authoritative; Z.E.R.O. contributes voice, module status, transcript line and
> typographic detail; Maxton contributes information density only. The agent
> visualisation gets its own view, and each of its regions is a real division lit
> by real activity. See [`design/`](design/).

### 17.2 The governing constraint

**Function first.** The Command Center's job is to make system state legible at a
glance — what is running, what needs attention, what changed, what it cost. Every
visual decision is subordinate to that. Motion that does not encode state is
decoration; glass that reduces contrast below accessible thresholds is a defect;
a globe that shows nothing real is a screensaver.

The aesthetic is the reward for the information being genuinely there. Building
the visual language before the system produces real state would produce exactly
the fake dashboard this project has been careful to avoid — which is why the
Command Center is Phase 13, not Phase 3.

### 17.3 Views

Situation (global state, priorities, alerts) · Division (roster, activity, KPIs) ·
Intelligence (map, events, briefings) · Finance (forecast, variance, scenarios) ·
Execution (goals, commitments, blockers) · Operations (runs, cost, latency,
errors, jobs) · Memory (what NEXUS knows and why) · Command (direct instruction,
voice, history).

---

## 18. Agent communication

### 18.1 Canonical path

```txt
User → Supervisor → Research ─┐
                              ├→ Finance → Business → Risk ─┐
                              │  (each hop re-enters the     │
                              │   Supervisor for permission) │
                              └──────────────────────────────┘
                                          │
                              Supervisor → User
```

Every arrow between divisions is a **delegation through the Supervisor**, not a
direct call. Each hop: re-checks permission, inherits the parent's budget,
records parent/child run linkage, increments depth against a bound.

### 18.2 Rules

Delegation is **depth-bounded** so cycles fail cleanly. Budget is **inherited,
never reset** — a nested chain cannot escape the ceiling its parent was given.
Every hop is **traceable**: a complete run tree is reconstructible after the
fact. Delegation **may be denied** by permission policy — one division being able
to reach another is a grant, not a default.

Circular delegation is expected in a mesh of specialists and must fail as a
typed error rather than exhausting the stack.

---

## 19. Evidence & verification

### 19.1 Model

```txt
   CLAIM ──── asserts ────▶ statement + epistemic status (§6.1)
     │
     ├── supported by ──▶ EVIDENCE ──▶ SOURCE (uri, publisher, retrievedAt, hash)
     ├── contradicted by ▶ EVIDENCE
     │
     └── VERIFICATION ──▶ status · supporting · conflicting · rationale · confidence
```

### 19.2 Requirements

Sources are traceable and carry a **retrieval timestamp** distinct from a
publication date, and a content hash so later drift is detectable. Confidence is
explicit. **Conflicts are represented, never resolved by omission.** Knowledge
and inference are structurally distinct (§6.1) rather than distinguished by
wording.

**Never fabricate evidence.** Not a source, not a URL, not a quotation, not a
timestamp. Where a tool claims to produce evidence, the runtime enforces that it
did — the guarantee is structural.

---

## 20. Security

### 20.1 Requirements

**Secrets** live in the environment, never in the repository, never in the
frontend, never in logs, never in an event payload, and never in a health
report. Configuration is rendered only through a redacting summary.

**Permissions** are deny-by-default at every boundary: agent dispatch, tool
invocation, memory access, delegation, and background execution.

**Audit** covers every consequential action: who, what, when, under which
authorisation, with what outcome. Audit is append-only and separate from
observability, which may be sampled.

**Authentication** is single-user initially, but `Subject` is modelled from the
start so multi-user is additive rather than a rewrite.

**Safe failure** — a missing dependency degrades explicitly. The system says what
it cannot do rather than guessing.

### 20.2 High-impact authorisation

Some actions require **explicit user authorisation** at execution time: money
movement, external communication sent on the user's behalf, code pushed to a
repository, data deletion, and any external write with real-world consequence.

**This is a human-in-the-loop gate, and it is asynchronous.** The user may not be
present; the request must survive waiting, be presentable in the interface,
expire safely, and be denied by default on timeout. §27 records that the current
permission contract cannot express this.

Voice alone never satisfies a high-impact authorisation.

---

## 21. Observability

| Surface | Captured |
| --- | --- |
| Agent executions | Run tree, duration, outcome, delegation depth |
| Tool calls | Tool, side-effect class, duration, outcome, evidence produced |
| Model calls | Provider, model, tokens, **cost**, latency, fallbacks attempted |
| Costs | Per run, division, task class, provider, period — against budget |
| Latency | Distribution, not just mean; interactive and voice tracked separately |
| Errors | Typed code, frequency, affected component |
| Background jobs | Schedule adherence, duration, retries, failure streaks |
| Memory | Reads, writes, supersessions, scope violations attempted |
| Permissions | Grants, denials, and denials that recur (a signal of misconfiguration) |
| Evidence | Claims made, evidence attached, verification outcomes, conflicts |
| User commands | What was asked, what ran, what it cost, what changed |

**Rules.** Observability data contains no secrets and no raw personal content
beyond what is needed to operate. Traces span delegation boundaries — a run tree
is reconstructible end to end. Cost is a first-class metric, not derived later.

---

## 22. Design system

Deferred to Phase 13. Specified here only so it is designed rather than
accumulated.

**Scope:** typography (including Arabic alongside Latin, given the user's
context) · colour system with semantic state tokens · spacing scale · component
inventory · card and panel patterns · agent state visualisation (idle, thinking,
executing, blocked, failed) · chart language (see the `dataviz` guidance) · map
and globe treatment · motion vocabulary tied to system state · voice indicators ·
notification hierarchy · command interface · responsive behaviour to mobile.

**Constraints:** dark-first but theme-aware; accessible contrast is a hard floor;
motion respects reduced-motion preferences; every visual state maps to a real
system state. The reference hierarchy in [ADR 0012](adr/0012-command-center-design-direction.md)
governs; references live in [`design/references/`](design/references/).

---

## 23. Extensibility

The architecture must absorb, without Core changes: new agents · new divisions ·
new skills · new tools · new model providers · new external APIs · new databases ·
new voice providers · new background workers.

**The test that proves it.** Adding a model provider must not require editing
`contracts/model-provider.ts`, any agent, or any skill. Adding a division must
touch only its own package plus registration and policy. When either stops being
true, the abstraction is wrong and needs an ADR — not a widened contract.

The Core is stable; capability accretes at the edges.

---

## 24. Hybrid computing

The Core stays **TypeScript on Bun** for orchestration, contracts and
application architecture (ADR 0001).

**Python is permitted later, behind an explicit Worker/Tool contract**, for
quantitative finance, data science, advanced financial modelling, machine
learning and scientific computation. It communicates through a defined boundary —
never by importing into the Core, and never as a second orchestration runtime.

**Do not introduce Python yet.** The trigger is a Finance workload with no
credible TypeScript equivalent, not a preference.

---

## 25. Phased roadmap

Each phase states objective, dependencies, deliverables, tests and exit criteria.
Phases are gated: exit criteria are met before the next phase begins.

### Phase 1 — Foundation ✅ COMPLETE
**Objective:** contracts, registries, runtime primitives, test infrastructure.
**Dependencies:** none.
**Deliverables:** 12 Core contracts; agent/skill/tool/provider registries;
in-memory event bus; deny-by-default permissions; scoped memory; capability model
router; tool belt; execution context; health aggregation; Core Supervisor;
configuration with secret redaction; CI.
**Tests:** 78 passing, zero dependencies, no network.
**Exit:** ✅ met at `eb33906`.

### Phase 2 — Master Specification ◀ CURRENT
**Objective:** full product specification; contradictions surfaced before code.
**Dependencies:** Phase 1.
**Deliverables:** this document; gap analysis (§27); decisions requiring human
approval (§28).
**Tests:** existing suite still green; no Core behaviour changed.
**Exit:** specification reviewed by the user; §28 answered or explicitly deferred.

### Phase 3 — Engineering Environment ✅ COMPLETE
**Objective:** make building NEXUS repeatable before building product.
**Dependencies:** Phase 2.
**Deliverables:** schema validation behind `SchemaValidator`; agent/skill/tool
scaffolding conventions; evaluation harness for prompt-bearing components;
richer CI (coverage, contract-conformance tests).
**Tests:** a conformance suite any provider/tool/agent implementation must pass.
**Exit:** ✅ met. `SchemaValidator` implemented (zero dependencies, subset of
JSON Schema, rejects assertions it cannot enforce rather than ignoring them);
provider conformance suite published as `@nexus/core/testing`; contract-stability
tripwire turns ADR 0004's rule into a guarantee.

### Phase 4 — Supervisor & Providers ✅ COMPLETE (Orchestrator deferred)
**Objective:** first real provider adapter; orchestration above the Supervisor.
**Dependencies:** Phase 3.
**Deliverables:** one `ModelProvider` adapter; task-class routing; `Orchestrator`
contract and minimal implementation (sequential plan, retry, compensation);
budget enforcement; cost recording.
**Tests:** adapter conformance; router selection under cost/quota/health;
orchestrator retry and failure; **a test asserting the adapter required no Core
edit**.
**Exit:** ✅ met, with one part deferred. Two provider adapters on genuinely
different protocols (`openai-compatible` covering five vendors, and `google`),
neither requiring a contract edit — see the verdict in ADR 0004. Budget
enforcement, cost field, and rate-limit/quota-aware routing with cross-provider
fallback are in place. A task now crosses every layer end to end
(`bun run demo`), and the model layer reports honestly that no adapter is
registered until a free key is added.

**Deferred:** the `Orchestrator` contract. Nothing multi-step needs it yet, and
ADR 0007 is explicit that it belongs above the Supervisor rather than inside it.
It lands with the first workflow that genuinely decomposes.

### Phase 5 — Research Intelligence ✅ FOUNDATION COMPLETE
**Objective:** first division; the evidence discipline made real.
**Dependencies:** Phase 4.
**Deliverables:** `Claim` contract with epistemic status; `Division` contract;
Research roster (Director, Web Research, Source Verification, Fact Extraction,
Cross-source Comparison); real research tools; `Verifier` implementation.
**Tests:** every FACT carries evidence; conflicts represented not collapsed;
fabricated-source detection; division registration requires no Core edit.
**Exit:** ✅ met. A research request returns typed claims with full provenance,
explicit contradictions, and a synthesis derived from the claims rather than the
other way round. `Claim` and `Division` contracts added (ADR 0013); the pipeline
is deterministic and runs with no provider and no network. See
[`RESEARCH_DIVISION.md`](RESEARCH_DIVISION.md) for semantics and limitations.

**Not yet:** a `Verifier` that re-reads source text, semantic relevance, web
retrieval, and cross-run contradiction — each behind an existing seam.

### Phase 6 — Finance Intelligence
**Objective:** the hardest division; the continuous forecast loop.
**Dependencies:** Phase 5 (market inputs), Phase 10 (versioned memory) for the
full loop; a static subset can precede Phase 10.
**Deliverables:** Finance roster; FP&A lifecycle (§4.3); forecast vintages;
variance and driver analysis; scenario analysis; financial data tools.
**Tests:** forecast versioning and supersession; variance correctness on fixtures;
lifecycle triggers fire on actuals; recommendations carry their scenario basis.
**Exit:** a forecast updates itself correctly when new actuals arrive.

### Phase 7 — Business Intelligence
**Objective:** strategic analysis with Finance and Research collaboration.
**Dependencies:** Phases 5, 6.
**Deliverables:** Business roster; option-framing outputs; competitive tracking.
**Tests:** delegation to Finance for pricing and Research for facts; option sets
carry explicit trade-offs.
**Exit:** a strategic question produces a defensible option set with sourced
inputs and priced consequences.

### Phase 8 — Learning & Development
> ⚠️ **Reordered by [ADR 0010](adr/0010-user-intelligence-before-learning.md).**
> Learning now runs at **Phase 12**, after Memory (10) and User Intelligence (11).
> Phase 8 is vacated; Cross-Agent Intelligence keeps Phase 9.

**Objective:** personalisation; the anti-blindness rule proven.
**Dependencies:** Memory (Phase 10) and User Intelligence (Phase 11) — hard.
**Deliverables:** Learning roster; level assessment; gap analysis; progress
tracking; cross-domain explanation with attributed delegation.
**Tests:** **the §7.1 rule** — a cross-domain question is answered and delegated,
never deflected; attribution is visible; tutor cannot read Finance memory.
**Exit:** a cross-domain learning question is answered correctly with clear
attribution.

### Phase 9 — Cross-Agent Intelligence
**Objective:** multi-division chains that hold together.
**Dependencies:** Phases 5–8.
**Deliverables:** the §18.1 canonical chain; delegation policy; run-tree tracing.
**Tests:** budget inheritance across hops; cycles fail typed; denied delegation;
full trace reconstruction.
**Exit:** the canonical chain executes, stays in budget, and is fully traceable.

### Phase 10 — Memory
**Objective:** durable, versioned, semantically searchable memory.
**Dependencies:** Phase 4. Blocks the full Phase 6 loop.
**Deliverables:** persistent `MemoryStore`; layers (§12.1); versioning and
supersession; semantic retrieval; project scope; migration from volatile.
**Tests:** durability across restart; supersession preserves history; scope
isolation under adversarial ids; retrieval quality fixtures.
**Exit:** NEXUS remembers correctly across restarts, and can explain why it
believes something.

### Phase 11 — User Intelligence
> Position confirmed by [ADR 0010](adr/0010-user-intelligence-before-learning.md):
> immediately after Memory, and **before** Learning.

**Objective:** the evolving user model.
**Dependencies:** Phase 10.
**Deliverables:** user-model contract; versioned attributes with validity
intervals; confidence decay; scoped projections; proposal-vs-commit write path.
**Tests:** role change supersedes without losing history; **the staleness test —
a user who becomes a practitioner is no longer treated as a student**; agents
cannot silently redefine the user; projection scoping.
**Exit:** the user model evolves correctly and is queryable at any point in time.

### Phase 12 — Background Intelligence
**Objective:** work that runs with nobody watching.
**Dependencies:** Phases 4, 10.
**Deliverables:** `BackgroundJob` and `Scheduler` contracts; worker runtime;
retry with backoff; job observability; alerting; the FP&A trigger loop.
**Tests:** retry and backoff; permission enforcement for background subjects;
failure-streak surfacing; missed-run recording; idempotency.
**Exit:** a monitoring job runs on schedule, survives failure, and alerts
correctly.

### Phase 13 — Voice
**Objective:** natural realtime conversation.
**Dependencies:** Phases 4, 12.
**Deliverables:** local wake word; STT and TTS behind provider contracts;
streaming pipeline; barge-in; latency-bounded routing class.
**Tests:** end-to-end latency budget; barge-in correctness; wake-word false
positive/negative rates; **voice cannot authorise a high-impact action**.
**Exit:** a spoken question is answered naturally within the latency budget.

### Phase 14 — Command Center
**Objective:** the real interface over real state.
**Dependencies:** Phases 5–13 — it visualises what exists.
**Deliverables:** design system (§22); Command Center views (§17.3); live event
stream; agent visualisation; voice visualisation; responsive layouts; decision on
the `apps/dashboard` template.
**Tests:** every panel is backed by real state (**no fixture data in production
paths**); accessibility floors; responsive behaviour.
**Exit:** the Command Center shows true system state and is usable daily.

### Phase 15 — Security & Hardening
**Objective:** safe for consequential action.
**Dependencies:** all prior.
**Deliverables:** async high-impact authorisation (§20.2); audit log;
authentication; secret rotation; threat model; external-action controls;
penetration review.
**Tests:** high-impact action blocked without authorisation; authorisation
expiry defaults to deny; audit completeness; secret-leak scanning across logs,
events and health.
**Exit:** an independent security review passes.

### Phase 16 — Production
**Objective:** run it for real.
**Dependencies:** Phase 15.
**Deliverables:** deployment; backup and restore; monitoring and alerting;
runbooks; cost controls in production; incident process.
**Tests:** restore from backup; graceful degradation under provider outage; load
behaviour; cost ceilings hold.
**Exit:** NEXUS runs continuously, recovers from failure, and stays within budget.

---

## 26. Architectural principles

These are binding. A change that violates one needs an ADR, not a justification
in a pull request.

1. **No fake integrations.** A tool either works or reports that it cannot.
2. **No fake AI outputs.** No canned responses presented as generated.
3. **No hardcoded provider dependencies.** Agents name capabilities, never vendors.
4. **No uncontrolled agent-to-agent coupling.** Collaboration goes through the
   Supervisor.
5. **No secrets in the frontend.** Ever, including in development.
6. **No premature complexity.** Build the seam; implement when a real requirement
   arrives.
7. **Everything important is testable.** If it cannot be tested, the design is
   wrong.
8. **Prefer explicit contracts.** Interfaces over conventions, types over comments.
9. **Prefer observable execution.** Untraceable work is unmaintainable work.
10. **Fail honestly.** Report the real state, including "unavailable" and
    "I don't know".
11. **Build incrementally.** One vertical slice before breadth.
12. **Keep the Core stable.** Capability accretes at the edges.
13. **Optimise for long-term evolution.** The five-year shape beats this week's
    convenience.

---

## 27. Gap analysis: specification versus built foundation

Reviewed against `packages/core` at commit `eb33906`. **This section is the true
statement of what exists.** The Phase 2 review itself modified no Core file;
items marked ✅ below were subsequently fixed in Step 2 of the Phase 3–4 plan and
are verified by tests.

### 27.1 Contract inventory

| Spec concept | Core today | Status |
| --- | --- | --- |
| Agent | `contracts/agent.ts` | ✅ Sufficient |
| Skill | `contracts/skill.ts` | ✅ Sufficient |
| Tool | `contracts/tool.ts` | ✅ Sufficient |
| Model Provider | `contracts/model-provider.ts` | ⚠️ Text-only; no speech |
| Model Router | `contracts/model-router.ts` | ⚠️ Capability + cost only |
| Supervisor | `contracts/supervisor.ts` | ⚠️ One defect (§27.3 G1) |
| Memory | `contracts/memory.ts` | ⚠️ No versioning, no project scope |
| Event Bus | `contracts/events.ts` | ⚠️ In-process, non-durable |
| Permissions | `contracts/permissions.ts` | ❌ Cannot express §20.2 |
| Execution | `contracts/execution.ts` | ⚠️ Budget unenforced; no cost |
| Evidence | `contracts/evidence.ts` | ⚠️ No Claim, no persisted conflict |
| Health | `contracts/health.ts` | ✅ Sufficient |
| **Division** | — | ❌ Missing (`DivisionId` is a bare branded string) |
| **Claim** | — | ❌ Missing |
| **User Intelligence** | — | ❌ Missing |
| **Orchestrator** | — | ❌ Missing (anticipated by ADR 0007) |
| **Background Job / Scheduler** | — | ❌ Missing |
| **Notifications** | — | ❌ Missing |
| **Audit log** | — | ❌ Missing |
| **Speech provider (STT/TTS)** | — | ❌ Missing |
| **Compute Worker (Python)** | — | ❌ Missing |

### 27.2 Contradictions — the specification cannot be built as the Core stands

**C1 — Permissions are synchronous; high-impact authorisation is asynchronous.**
`PermissionEngine.check()` returns a `PermissionDecision` synchronously. §20.2
requires waiting for a human who may be asleep. A synchronous interface cannot
await a person. This is a genuine contradiction, not a missing feature.
**RESOLVED by [ADR 0008](adr/0008-async-authorization-broker.md):** the engine
stays synchronous — it is on the hot path — and a separate `AuthorisationBroker`
issues, persists, expires and resolves authorisation requests. The engine checks
for a *held* token rather than waiting for one; expiry defaults to deny. Callers
gain a third outcome, `AUTHORISATION_REQUIRED`. Contract not yet written.

**C2 — Voice providers do not fit `ModelProvider`.** `ModelCapability` includes
`audio_input` but has no audio output, and STT/TTS are not text generation:
different request shapes, different streaming semantics, different latency
profile. Widening `ModelProvider` to cover them would violate ADR 0004's rule
that adding a provider requires no contract edit — the rule would be broken by
the first voice provider.
**RESOLVED by [ADR 0009](adr/0009-speech-provider-contract.md):** `SpeechProvider`
is a sibling contract with its own registry and router, not part of
`ModelProvider`. The unused `audio_input` capability is removed. Wake-word
detection stays local and is not a provider concern.

**C3 — Roadmap ordering inverts a dependency.** Phase 8 (Learning) has a hard
dependency on Phase 11 (User Intelligence), which comes later. Learning without a
user model degrades to generic tutoring, which is precisely the failure §7
targets. Note also that this roadmap has **16 phases against the 15 requested**,
because User Intelligence was separated from Memory rather than folded into it.
**RESOLVED by [ADR 0010](adr/0010-user-intelligence-before-learning.md):** User
Intelligence moves to Phase 11, immediately after Memory, and Learning follows at
Phase 12. No phase now depends on a later one. The 16-phase count is deliberate
and explained there.

**C4 — Events are ephemeral; audit and background work need durability.**
`createInMemoryEventBus` is correct for one process, but §15 requires jobs
surviving restart and §20 requires an append-only audit trail. Events currently
vanish on restart, and an audit log that can be lost is not an audit log.
*Recommended resolution:* keep `EventBus` as the in-process seam; add a separate
durable `AuditLog` contract. Do not conflate the two — audit may not be sampled,
observability may.

**C5 — `ExecutionBudget` is defined but nothing enforces it.** ✅ **FIXED.**
A `BudgetGuard` (`runtime/budget.ts`) now enforces `maxToolCalls`, `maxModelCalls`
and `timeoutMs`, returning a typed `BUDGET_EXCEEDED`. One guard per run tree,
shared with every child context, so a delegation chain cannot escape its parent's
ceiling (§18.2). The ToolBelt charges tool calls and a per-run
`createBudgetedRouter` charges model calls — both **before** the work, so a
refused call reaches no provider.

### 27.3 Defects found in the existing foundation

**G1 — `Supervisor.delegate()` resets delegation depth.** ✅ **FIXED.**
The public `delegate()` passed a hardcoded depth of `1`, so an Orchestrator
looping through it would never trip the cycle guard. Depth is now derived from
the run tree — the Supervisor records the depth and budget guard of every run in
flight and looks the parent up — rather than trusted from the caller. Entries are
removed when a run finishes, and a parent always outlives its children, so the
map cannot grow without bound.

Verified by regression test: reinstating the hardcoded depth makes the test
recurse until killed; with the fix it fails cleanly with `delegation depth
exceeded` in milliseconds.

*Related finding:* `delegate()` acts as the `supervisor` subject, so a deployment
using that entry point must grant `agent:dispatch` to `kind: 'supervisor'`
explicitly. Deny-by-default still holds — omitting the grant blocks the path.

### 27.4 Additive gaps — no contradiction, contract simply absent

| # | Gap | Needed by | Phase |
| --- | --- | --- | --- |
| A1 | ~~`Claim` with epistemic status~~ ✅ done (ADR 0013) | Research | — |
| A2 | `Division` contract ✅ done (ADR 0013) — KPIs still deferred | All divisions | — |
| A3 | Memory versioning and supersession with validity intervals | User model, forecast vintages | 10 |
| A4 | ~~`project` memory scope~~ ✅ done | Project memory | — |
| A5 | Semantic retrieval (today: substring) | Memory quality | 10 |
| A6 | User Intelligence contract with confidence decay and scoped projection | Learning, all personalisation | 11 |
| A7 | Cost field in `UsageMetrics` ✅ done (aggregation still open) | Observability, budgets | 4 |
| A8 | Router inputs — **partly done**: quota, rate limit, free tier and task class ship (`limits.ts`, `task-classes.ts`, ADR 0011). Latency and reliability remain | Model layer | 4 |
| A9 | `Orchestrator` contract | Multi-step work | 4 |
| A10 | `BackgroundJob` + `Scheduler` contracts | Background intelligence | 12 |
| A11 | `Notification` contract | Alerts | 12 |
| A12 | ~~`SchemaValidator` implementation~~ ✅ done (§25 Phase 3 exit) | Every tool | — |
| A13 | `ComputeWorker` contract for Python | Quantitative finance | 6+ |
| A14 | Persisted conflict representation ✅ done — `Contradiction` (ADR 0013) | Research | — |
| A15 | ~~`VerificationResult.confidence`~~ ✅ done (ADR 0014) — §19.1 required it; the contract omitted it | Research | — |

### 27.5 What the foundation got right

Verified as sufficient for the specification without change: the **Result
convention** carries every failure mode §13.3 and §15 require; **deny-by-default
permissions** are the correct base for §20 even though C1 must be layered on;
**tool-belt triple gating** already enforces §14.2 and the evidence guarantee of
§19.2 structurally; **delegation through the Supervisor** implements §18 as
specified, including budget inheritance and depth bounding; the **provider
abstraction** satisfies §13.1 for text models, with C2 confined to speech; and
**`system.ts` as sole composition root** is what makes §23 achievable.

---

## 28. Decisions requiring human approval

Engineering cannot settle these.

**D1 — Roadmap sequencing (C3).** ✅ **DECIDED** — [ADR 0010](adr/0010-user-intelligence-before-learning.md).
User Intelligence to Phase 11, Learning to Phase 12.

**D2 — Async authorisation model (C1).** ✅ **DECIDED** — [ADR 0008](adr/0008-async-authorization-broker.md).
Separate broker; hot path stays synchronous.

**D3 — Speech provider separation (C2).** ✅ **DECIDED** — [ADR 0009](adr/0009-speech-provider-contract.md).
Sibling contract, preserving ADR 0004.

**D4 — First provider adapter.** ✅ **DECIDED** — [ADR 0011](adr/0011-free-tier-provider-strategy.md).
Free tiers only. Two adapters: `openai-compatible` (covering Groq, Cerebras,
OpenRouter, Mistral, SambaNova) and `google` (Gemini's native protocol). Together
they are the real test of ADR 0004.

**D5 — Memory persistence backend.** Constrains retrieval quality and operational
burden for the life of the system. Needed by Phase 10.

**D6 — Division scope for v1.** Full rosters as specified are large. Which roles
are genuinely needed first? *Recommendation:* Director plus two specialists per
division initially; expand on demand.

**D7 — Single-user assumption.** Confirm NEXUS remains single-user through Phase
15. If multi-user is wanted earlier, `Subject` and memory scoping need revisiting
now rather than later.

**D8 — Dashboard template disposition.** Still open — adopt `apps/dashboard` as
the Command Center starting point, or delete it at Phase 14? Deferred by ADR 0003.
Note that [ADR 0012](adr/0012-command-center-design-direction.md) now fixes the
*design direction* independently, and it is not the template's direction.

**D9 — Repository name.** ✅ **DECIDED.** The private repository
`mohamedsamir825/NEXUS` is the canonical home. Migrated with full history
preserved (11 commits, identical tree); `main` there carries the complete
project. The original public fork is retired and retained only as history.

---

## Appendix A — Document control

| | |
| --- | --- |
| Phase | 2 — Master Specification |
| Foundation reviewed | `eb33906` |
| Core files modified | **none** (as of Phase 2; Step 2 of the Phase 3–4 plan changes this) |
| Contradictions found | 5 (C1–C5) — **C1–C3 resolved** by ADRs 0008–0010; **C5 fixed** in code |
| Defects found | 1 (G1) — **fixed**, with a regression test |
| Additive gaps | 14 (A1–A14) |
| Decisions pending | 9 (D1–D9) — **D1–D4 and D9 decided**; D5–D8 open |

**Related:** [`ARCHITECTURE.md`](ARCHITECTURE.md) — what the Core does today ·
[`ROADMAP.md`](ROADMAP.md) — near-term sequencing · [`adr/`](adr/) — accepted
decisions.

**Amendment rule.** This document changes by pull request. A change that
contradicts an accepted ADR requires a superseding ADR in the same pull request.
