# ADR 0006 — Result values over exceptions

**Status:** Accepted · **Date:** 2026-08-26

## Context

Core principle 8 requires failing safely when a dependency is unavailable. If a
provider outage throws, it unwinds the agent run, and "handle it safely" becomes
a discipline that every call site must remember.

## Decision

Expected failures are values: `Result<T, NexusError>`, with a closed set of
error codes (`PERMISSION_DENIED`, `PROVIDER_UNAVAILABLE`, `NOT_CONFIGURED`,
`INVALID_INPUT`, …). Callers branch on `code`, never on message text. Exceptions
remain for genuine programming errors.

Boundaries that could receive a throw from third-party or user-supplied code
contain it and convert: the model router (a provider adapter that throws), the
tool belt (a tool that throws), the supervisor (an agent that throws), the event
bus (a subscriber that throws), and the health registry (a check that throws).
Each has a test proving containment.

## Consequences

Good: failure paths are typed, visible in signatures, and testable. A broken
subscriber cannot abort an agent run; a broken vendor adapter cannot take down
the process.

Bad: more ceremony than `try`/`catch` — every call site checks `.ok`. Without
do-notation this is verbose, and a caller can ignore a `Result` (the compiler
does not force handling).

## Revisit when

Not expected. If the verbosity becomes the dominant cost, add ergonomic helpers
(`map`, `andThen`) rather than reverting to exceptions.
