# ADR 0013 — Claim and Division as Core contracts

**Status:** Accepted · **Date:** 2026-08-27 · **Phase:** 5 (Research)

## Context

Phase 5 builds the first real Division. Two concepts it needs do not exist in
the Core, and both were anticipated: `NEXUS_MASTER_SPEC.md` §27.4 lists them as
additive gaps `A1` (Claim with epistemic status) and `A2` (Division contract),
both scheduled for this phase.

Three questions had to be settled before writing them.

## Decision 1 — Claim references Evidence; `evidence.ts` is not touched

Spec §19.1 already fixes the direction: `CLAIM ── supported by ──▶ EVIDENCE`.
A claim cites evidence by id. Nothing about that requires the Evidence contract
to change, so it does not change.

`Evidence.claim` remains a `string`, and that is not an oversight. It records
what the *collector* believed an excerpt spoke to, at collection time — a piece
of provenance about the act of collection. A `Claim` is a different object: the
division's structured assertion, which cites evidence. Two roles, two types.

The terminology overlap is real and worth naming: a reader will see `.claim` on
Evidence and `Claim` as a type and may expect them to be the same thing. They
are not, and both files say so.

## Decision 2 — Epistemic status and verification status are separate axes

The brief for this phase asked for four verification states: directly supported,
inferred, contradicted, uncertain. Following the specification rather than that
wording produces a better model, because two of those four are not the same kind
of thing.

| Question | Type | Values |
| --- | --- | --- |
| What kind of assertion is this? | `ClaimStatus` | `fact` · `inference` · `recommendation` · `uncertain` |
| What does the evidence say about it? | `VerificationStatus` | `verified` · `contradicted` · `insufficient` · `unverified` |

"Inferred" belongs to the first axis. Evidence can directly and strongly support
a claim that is nonetheless an inference — being an inference describes how the
claim was reached, not how well it is evidenced. Collapsing both into one enum
would make *"this is a well-supported inference"* inexpressible, which is
precisely the distinction a research system exists to preserve.

Mapping from the brief's wording:

| Brief | Expressed as |
| --- | --- |
| Directly supported | `VerificationStatus: 'verified'` |
| Inferred | `ClaimStatus: 'inference'` (verification is a separate answer) |
| Contradicted | `VerificationStatus: 'contradicted'` |
| Uncertain | `'insufficient'` when evidence exists but is not enough; `'unverified'` when nothing has been checked yet |

## Decision 3 — A Division is not an execution path

The obvious design gives `Division` a `dispatch()`. It is the wrong one.

Work reaches an agent through the Supervisor, which checks permission, inherits
the budget, bounds delegation depth and emits the event trail. A second entry
point would bypass all four. That is exactly the "parallel architecture" this
phase must not create, and it would contradict ADR 0007.

So `Division` is a bundle — identity, roster, entry points, required
capabilities — with a single `install(installer)` method. The installer surface
is deliberately narrow (register an agent, register a tool) and in particular
does **not** expose the permission engine: a division that could reach policy
during install could grant itself the capabilities it had just declared.

Declaring `requiredCapabilities` and `entryPoints` is what makes a division's
blast radius reviewable before it is installed. Deny-by-default still governs
(ADR 0005); declaring a capability requests it, it does not grant it.

## Consequences

Good: no existing contract changed. Claims carry provenance strong enough to
answer "what is claimed, on what evidence, from what source, inferred or not,
with what confidence, from which run". Contradictions are a recorded type rather
than an averaged score. Divisions gain a reviewable surface without gaining a
way around the Supervisor.

Bad: three new types to learn, and the `Evidence.claim` / `Claim` naming overlap
is a genuine papercut. `Claim.subject` is a plain string, so two claims about the
same thing under differently-worded subjects will not be compared — subject
normalisation is deliberately not approximated here (see Limitations).

## Contract baseline

Adding these files trips `tests/contract-stability.test.ts`, which is what it is
for. The baseline was regenerated with `bun run contracts:baseline` as the
deliberate act that test demands, and this ADR is the record it asks for. No
existing contract file was modified — verified by the same test, which reports
additions and modifications separately.

## Limitations

- `Claim.subject` is an opaque string. Contradiction detection compares claims
  sharing a subject; differently-worded subjects about one thing are missed.
  Normalisation needs either a controlled vocabulary or a model call, and both
  are worse than an honest limit at this stage.
- `ClaimValidator` is an interface here. Its implementation, and everything that
  produces claims, is Stage B of this phase.

## Revisit when

A second division needs claims. If Finance's notion of a claim does not fit —
numeric assertions with units and periods may not — that is the signal to
generalise, and it should be judged on that division's real needs rather than
anticipated now.
