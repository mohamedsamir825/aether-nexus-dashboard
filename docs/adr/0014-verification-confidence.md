# ADR 0014 — `VerificationResult` carries a confidence

**Status:** Accepted · **Date:** 2026-08-27 · **Phase:** 5 (Research)

## Context

A gap analysis of the shipped Research division against the specification found
one real divergence. `NEXUS_MASTER_SPEC.md` §19.1 models verification as:

```txt
└── VERIFICATION ──▶ status · supporting · conflicting · rationale · confidence
```

The implemented contract carried `claim`, `status`, `supporting`, `conflicting`,
`rationale` and `checkedAt` — but no `confidence`.

Confidence did exist elsewhere: on `Claim`, and as an aggregate on
`ResearchResult`. What could not be expressed was the middle term. The system
could say *"evidence supports this"* but not *"how strongly"*, which is the
question a reader of a verification actually has.

This is the first change to an existing Core contract since the founding commit.
`evidence.ts` had not been edited since `eb33906`. The contract-stability
tripwire fired on it, correctly, and this ADR is the deliberate acceptance it
demands (ADR 0004).

## Decision 1 — The field is required, not optional

`readonly confidence: number` with no `?`.

An optional confidence would be omitted by every implementation under time
pressure and the gap would silently reopen. Making it required means the
compiler enumerates every construction site — which is how the change was
verified to be complete rather than assumed to be.

## Decision 2 — It is derived from the evidence, and capped by the claim

```txt
support   = mean confidence of the resolved supporting evidence
conflict  = mean confidence of the resolved conflicting evidence
settled   = min(claim.confidence, support)
result    = settled × (1 − conflict)
```

Two properties matter more than the exact arithmetic.

**Verification never outranks what it verifies.** `min(claim.confidence, …)` is
the cap. A claim asserted at 0.9 cannot be verified to 1.0 because its evidence
happens to be certain — that would let the verification step manufacture
confidence the assertion never had.

**Conflict reduces, it does not net out.** `× (1 − conflict)` scales down what
support had settled; the supporting evidence is still reported in full. This is
§19.2 in arithmetic: a conflict must never average into a comfortable middle
that reads like partial agreement.

`insufficient` and `unverified` are exactly `0`. Both mean nothing was weighed
that could settle anything, and a small non-zero number there would be an
invented reassurance.

## Decision 3 — The verifier is handed the evidence it weighs

`createClaimVerifier({ now, evidence })` — required, not optional.

A confidence not derived from evidence is a number with no meaning, so a
verifier that cannot see the evidence has no business scoring how well a claim
is settled. Making the evidence a construction input turns that from a
convention into a signature.

When a cited id cannot be resolved, the score is not quietly deflated: the
rationale says how many pieces were unavailable to weigh. An incomplete evidence
set is a defect in the caller, and a defect that reads as a low score is worse
than one that reads as a defect.

## Consequences

The pipeline in `agent.ts` now assembles the evidence array *before*
verification rather than after — the only ordering change, and it is forced by
the decision above rather than incidental.

`Claim.confidence` and `VerificationResult.confidence` are now two different
numbers with two different meanings, which is a real cost in reader confusion.
Both fields document the distinction at their definition, as `Evidence.claim`
versus `Claim` does (ADR 0013).

Nothing else in the Core changed. No other contract file was touched.
