# ADR 0010 — User Intelligence precedes Learning

**Status:** Accepted · **Date:** 2026-08-26 · **Resolves:** C3

## Context

The phase plan in `NEXUS_MASTER_SPEC.md` §25 placed **Learning & Development** at
Phase 8 and **User Intelligence** at Phase 11. But §7 states that Learning's
quality "depends on User Intelligence more than on any model", and §8's exit
criterion requires answering a cross-domain question at the level appropriate to
the user's *current* state.

Learning without a user model is generic tutoring. It cannot assess a level it
cannot read, cannot close a gap it cannot measure, and cannot avoid the exact
staleness failure §11 exists to prevent — continuing to treat the user as a
student after they have become a practitioner. Building it first would mean
building it twice.

## Decision

Reorder so that dependencies run forward:

| Phase | Was | Now |
| --- | --- | --- |
| 8 | Learning & Development | *(vacated — Learning moves later)* |
| 10 | Memory | Memory |
| 11 | *(Background Intelligence)* | **User Intelligence** |
| 12 | — | **Learning & Development** |

Learning now sits after both Memory (Phase 10) and User Intelligence (Phase 11),
which is the order its own requirements imply. Cross-agent intelligence (§18),
previously Phase 9, keeps its position — it needs divisions to connect, not a
user model.

This also acknowledges a deviation already present: separating User Intelligence
from Memory produced a **16-phase plan against the 15 originally requested**. The
separation is deliberate. Memory is storage with scoping; the user model is a
maintained, versioned, confidence-decaying belief about a person. Different
lifecycle, different failure modes, different tests.

## Consequences

Good: no phase depends on a later one. Learning is built once, correctly, on a
user model that exists. The staleness test (§25 Phase 11) can gate Learning
rather than trail it.

Bad: Learning — one of the most immediately visible divisions to the user — moves
later, so NEXUS feels less personal for longer. Research and Finance carry the
early value instead. That is the cost of not building the same thing twice.

## Revisit when

Not expected. If Learning must ship earlier for motivation, ship it explicitly
*without* personalisation and label it so, rather than quietly letting it invent
a user model of its own.
