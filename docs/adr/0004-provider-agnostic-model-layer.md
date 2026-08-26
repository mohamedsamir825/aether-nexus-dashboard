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

## Verdict (2026-08-26)

The condition this ADR set for judging itself has now been met. Two adapters
exist, on genuinely different wire protocols:

- `@nexus/provider-openai-compatible` — OpenAI chat-completions, covering Groq,
  Cerebras, OpenRouter, Mistral, SambaNova and local runtimes.
- `@nexus/provider-google` — Gemini's native `generateContent`, which differs in
  roles (`user`/`model`, no `system` role), message structure (typed parts, not
  string plus side-channels), model addressing (URL path, not body), parameter
  nesting, and finish-reason vocabulary.

**Neither required editing `contracts/model-provider.ts`, any agent, or any
skill.** Verified by the contract-stability tripwire
(`tests/contract-stability.test.ts`), not asserted.

Two Core files did change, neither a contract: `config/config.ts` gained entries
for the new providers, and `errors.ts` gained `RATE_LIMITED`. The shared error
vocabulary growing is not the provider contract leaking — a 429 has to be
distinguishable from "the provider is down" or the router cannot tell backing
off from failing over.

**The one place the abstraction was genuinely stressed:** NEXUS keys a tool
result to the `callId` of the call it answers; Google has no call ids at all and
keys a `functionResponse` by function *name*. The Gemini adapter resolves the
name by scanning the conversation for the matching call, and synthesises
deterministic ids for inbound calls. That is real work inside the adapter, but
it stayed inside the adapter — the neutral shape carries strictly more
information than Google's, so the mapping is lossy only in the harmless
direction. Had it been the other way round, this ADR would have needed
superseding.

The abstraction stands. This verdict does not close the question permanently:
a provider whose capabilities the neutral type cannot express would reopen it.

## Revisit when

A provider appears that the neutral type cannot express without a contract edit
— streaming semantics, structured output, or a capability with no neutral
equivalent are the likely candidates. Speech already proved to be one, and was
resolved by a sibling contract rather than a widened one (ADR 0009).
