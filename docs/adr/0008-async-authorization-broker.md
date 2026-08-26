# ADR 0008 — Asynchronous authorisation broker

**Status:** Accepted · **Date:** 2026-08-26 · **Resolves:** C1

## Context

`NEXUS_MASTER_SPEC.md` §20.2 requires explicit user authorisation at execution
time for high-impact actions — moving money, sending communication on the user's
behalf, pushing code, deleting data, any external write with real-world
consequence.

`PermissionEngine.check()` returns a `PermissionDecision` **synchronously**. A
synchronous interface cannot wait for a person who may be asleep. This is a
contradiction in the contract, not a missing feature: no implementation of the
current interface can satisfy §20.2.

Two ways out were considered:

1. Make the whole permission engine asynchronous.
2. Keep the engine synchronous and add a separate broker for the human gate.

Option 1 is simpler to describe and worse in practice. The engine is on the hot
path — every tool call, every memory access, every dispatch — and it answers a
question that genuinely is synchronous ("does this subject hold this
capability?"). Making all of it `async` to accommodate a rare case would put a
`Promise` in front of thousands of decisions to serve a handful, and would hide
the fact that *waiting for a human* is a categorically different operation from
*checking a policy*.

## Decision

Two collaborating components with distinct responsibilities:

**`PermissionEngine`** stays synchronous and unchanged. It answers: does this
subject hold this capability, right now, per policy? For a high-impact
capability it checks whether a **valid authorisation token** is already held —
it never waits for one to be created.

**`AuthorisationBroker`** is new and asynchronous. It owns the human gate:

- `request(...)` creates a pending authorisation, persists it, and returns
  immediately with its id. The run does not block on a person.
- The request carries what will happen, on whose behalf, its side-effect class,
  and an expiry.
- The user resolves it — approve or deny — through whatever surface exists
  (Command Center, notification, CLI).
- **Expiry defaults to deny.** An authorisation that is never answered is a
  denial, never an eventual approval.
- Resolution yields a scoped, single-use token bound to the specific action.
  A token is not a standing grant.

An agent needing a high-impact action gets a typed `AUTHORISATION_REQUIRED`
failure carrying the request id — not a hang. The orchestration layer decides
whether to park the run and resume it, or to report back and stop.

## Consequences

Good: the hot path stays synchronous and fast. "Waiting for a human" becomes an
explicit, observable, persistable state rather than a blocked promise. Pending
authorisations survive restart, are visible in the interface, and are auditable.
Expiry-denies-by-default keeps ADR 0005's posture intact.

Bad: two components instead of one, and callers must handle a third outcome
(allowed / denied / authorisation-required) rather than two. Runs that need a
human become genuinely long-lived, which the orchestration layer must support —
that work is real and lands in Phase 15.

## Revisit when

Never expected to reverse. If the broker's token model proves too coarse — for
example if an approval should cover a bounded batch rather than one action —
extend the token's scope, not the permission engine's signature.
