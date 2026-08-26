# ADR 0009 — SpeechProvider is a sibling contract, not an extension

**Status:** Accepted · **Date:** 2026-08-26 · **Resolves:** C2

## Context

`NEXUS_MASTER_SPEC.md` §16 requires realtime voice: wake word, speech-to-text,
text-to-speech, barge-in, and a latency budget tight enough that a correct
answer arriving late is a failure.

`ModelProvider` currently advertises an `audio_input` capability, which implies
speech belongs inside it. It does not. Speech-to-text and text-to-speech are not
text generation:

- **Different request shape.** Audio in or audio out, not messages in / content
  blocks out.
- **Different streaming semantics.** TTS streams audio frames as text arrives;
  STT streams partial transcripts with revisions. Neither resembles token
  streaming.
- **Different failure modes.** Barge-in, silence detection, and endpointing have
  no analogue in text generation.
- **Different latency class.** Voice is bounded in the low hundreds of
  milliseconds; deep analysis is not.

Widening `ModelProvider` to cover all of that would break ADR 0004's central
rule — that adding a provider requires no contract edit — with the *first* voice
provider. The rule would fail exactly when it was first tested against something
it did not anticipate.

## Decision

**`SpeechProvider` is a sibling of `ModelProvider`**, with its own registry and
its own router, sitting at the same level in the architecture. Neither contains
the other.

Consequently:

- `audio_input` is **removed** from `ModelCapability`. It described a capability
  no `ModelProvider` will implement, and leaving it would invite exactly the
  conflation this ADR rejects.
- Speech capability is declared on `SpeechProvider` (`transcribe`, `synthesize`,
  `streaming`, `wake_word`), not borrowed from the model layer.
- Wake-word detection stays **local** and is not a provider concern at all
  (§16.3 privacy).
- A provider that happens to offer both text and speech implements both
  contracts. That is a packaging detail, not a reason to merge them.

Multimodal *input to a text model* — an image, or audio treated as content for
a text model that natively accepts it — remains `ModelProvider`'s business under
`vision` and any future equivalent. The line is drawn at the operation: producing
or consuming speech as speech is `SpeechProvider`; reasoning over content is
`ModelProvider`.

## Consequences

Good: ADR 0004's rule survives contact with voice. Each contract stays honest to
its domain, and the voice latency budget can be expressed where it belongs.
Removing a capability nothing implements makes the model contract smaller.

Bad: two provider registries and two routers to build and maintain. A vendor
offering both is configured twice. Some cross-cutting concerns — cost tracking,
health, quota — will need to be shared rather than duplicated, which is a real
design task deferred to Phase 13.

## Revisit when

A provider appears whose speech and text surfaces are so genuinely unified that
two contracts create more friction than they prevent. Judge that on an actual
adapter, not on a vendor's marketing.
