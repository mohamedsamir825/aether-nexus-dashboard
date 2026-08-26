# ADR 0004 — Provider-agnostic model layer

**Status:** Accepted · **Date:** 2026-08-26

## Context

NEXUS must be able to use Gemini, OpenRouter, Anthropic, OpenAI, xAI, or a
provider that does not exist yet, without agent logic changing. Vendor SDKs
disagree on message shape, tool-calling, streaming and structured output; the
usual failure is that one vendor's shape becomes the internal shape and every
later adapter fights it.

## Decision

Three layers, strictly separated:

1. **`ModelProvider`** — one adapter per vendor. Speaks the vendor's protocol,
   returns neutral types. Reports `isConfigured()` and `health()`.
2. **`ModelRouter`** — the only thing agents talk to. Takes a
   `ModelSelectionPolicy` (required capabilities, context window, cost ceiling,
   preferences) and resolves it to a concrete model.
3. **Agents** — state intent, never a vendor name.

Supporting rules:

- The neutral types are the *intersection* expressed in vendor-free terms: no
  vendor field names, no vendor enums.
- Vendor-specific knobs travel in `providerOptions`, set by configuration and
  never by agent code.
- Optional capabilities are genuinely optional. A provider that cannot embed
  omits `embed`; the router routes around it rather than receiving a stub that
  throws.
- Unconfigured providers are excluded from candidacy rather than called and
  failed.
- **The test:** adding a provider must not require editing
  `contracts/model-provider.ts`, any agent, or any skill. If it does, the
  abstraction is wrong and needs a superseding ADR.

## Consequences

Good: vendor choice becomes configuration. Fallback across providers is a policy
flag. The Core has no vendor SDK dependency, and the test suite runs with no
network and no credentials.

Bad: the neutral type is a lowest-common-denominator and will not expose every
vendor feature. `providerOptions` is an untyped escape hatch that can be abused.
A capability a vendor supports but the neutral type omits requires a Core change
— exactly the case the "edit means ADR" rule is designed to catch.

## Revisit when

The **second** adapter is written — not the first. One adapter always fits the
abstraction it was designed against; two reveal whether it is real.
