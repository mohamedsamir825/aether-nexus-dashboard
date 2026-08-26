# ADR 0011 — Free-tier-only providers, and the two-adapter pattern

**Status:** Accepted · **Date:** 2026-08-26

## Context

NEXUS is a private, personal system. The project owner requires that it run on
**free API tiers only** for the foreseeable future. Anthropic, which the earlier
draft named as a candidate, has no free tier and is therefore out of scope for
now.

A survey of the landscape (August 2026):

| Provider | Free allowance | Role here |
| --- | --- | --- |
| Google Gemini | ~1,500 req/day, 10–15 RPM, 1M context, multimodal | Primary — largest context, images |
| Groq | 30 RPM, ~1,000 req/day, fastest generation | Interactive, and voice later (§16) |
| Cerebras | ~1M tokens/day | Background and batch work (§15) |
| OpenRouter | 20 RPM, 50 free-model req/day, ~14 models | Model variety through one adapter |
| Mistral · SambaNova · Cloudflare | smaller tiers | Additional fallback |

Two observations shaped this decision.

**First:** every free tier is rate-limited, and each differently — some by
requests per minute, some per day, some by tokens per day. A system that must run
free therefore *cannot* be served by a single provider. It must move between them
as limits bind.

**Second:** Groq, Cerebras, OpenRouter, Mistral and SambaNova are all
**OpenAI-compatible**. Gemini is not — it uses Google's own protocol.

## Decision

**Free tiers only**, and a **two-adapter pattern**:

1. **`openai-compatible`** — one adapter parameterised by base URL, covering
   Groq, Cerebras, OpenRouter, Mistral, SambaNova, and later local runtimes
   (Ollama, vLLM) which speak the same shape.
2. **`google`** — Gemini's native protocol, a genuinely different request and
   tool-calling shape.

Two adapters, six-plus providers, zero cost.

**The router must be limit-aware from the first day**, not eventually. §13.2
already required tracking quota, rate limit and health; the free-tier constraint
promotes that from a good idea to a functional requirement. A provider at its
limit is excluded from candidacy rather than called and failed.

**These two adapters are the real test of [ADR 0004](0004-provider-agnostic-model-layer.md).**
Two genuinely different wire protocols is the condition that ADR named for
judging the abstraction — "revisit when the second adapter is written, not the
first". If both land without editing `contracts/model-provider.ts`, any agent, or
any skill, the abstraction holds. If either forces such an edit, ADR 0004 was
wrong and needs a superseding ADR. That outcome is acceptable and planned for.

## Consequences

Good: zero running cost. The constraint forces the quota-aware routing and
cross-provider fallback the specification wanted anyway, so the architecture gets
exercised properly instead of theoretically. Local models slot into the
OpenAI-compatible adapter with no new work, which keeps the privacy option open.

Bad: free tiers are unstable — limits get cut (Google reduced its free tier
50–80% in late 2025), terms change, and models are withdrawn. Rate limits will
constrain what NEXUS can do at once, and background work (§15) must be paced
against daily quotas rather than run freely. Some capabilities may simply be
unavailable free.

The system must degrade honestly when every provider is exhausted — a typed
failure saying so, never a silent wait or a fabricated answer.

## Revisit when

The owner is willing to spend, or a workload cannot be done within free limits.
Adding a paid provider then requires no architectural change — it is one more
registration, which is the point.
