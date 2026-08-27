# Research Division

The first NEXUS Division. It answers a question by retrieving sources,
extracting evidence, and producing **typed claims with provenance** — not prose
that a reader has to take on trust.

Contracts: [ADR 0013](adr/0013-claim-and-division-contracts.md).
Package: `packages/divisions/research`.

## Boundary

A Division is not an execution path. Work reaches the analyst through the
Supervisor like any other agent; the division only declares who it is and
installs its agent and tool.

| | |
| --- | --- |
| Entry point | `research.analyst` (the only role addressable from outside) |
| Tool | `research.retrieve` — the sole route to the outside world |
| Capabilities requested | `agent:dispatch`, `tool:execute`, `research:retrieve` |
| External calls | none — no network, no model required |

## Workflow

```txt
ResearchRequest
   → retrieve      (Tool, through ToolBelt's three gates)
   → extract       (verbatim excerpts, source provenance attached)
   → build claims  (fact · inference · uncertain)
   → detect contradictions
   → verify        (verified · contradicted · insufficient · unverified)
   → synthesise    (derived from claims; model optional)
ResearchResult
```

Only the first step leaves the process. Everything after it is a pure function,
which is why the whole workflow reproduces without a network or a credential.

## Claim semantics

Two independent axes (ADR 0013). A claim can be an inference *and* verified.

| `ClaimStatus` | Produced when | Requires |
| --- | --- | --- |
| `fact` | A source states it | ≥1 evidence, cited |
| `inference` | Independent sources agree | The claims it derives from |
| `recommendation` | **Never produced deterministically** | Derivation + stated assumptions |
| `uncertain` | A subject was asked about and nothing was found | A reason |

| `VerificationStatus` | Meaning |
| --- | --- |
| `verified` | Evidence supports it |
| `contradicted` | Conflicting evidence exists — outranks support, never netted out |
| `insufficient` | Weighed and found wanting |
| `unverified` | Nothing weighed yet |

**Recommendations are never invented.** A recommendation is a judgement about
what someone should do, and no deterministic rule over sentences produces one
honestly. The type is supported and validated; this pipeline does not emit it.

## Provenance chain

```txt
SourceRef → RetrievedContent (retrievedAt + contentHash)
          → Evidence (verbatim excerpt, publisher, published vs retrieved date)
          → Claim (cites evidence by id)
          → ResearchResult
```

Retrieval time is recorded separately from publication time, and a content hash
lets a later re-fetch detect drift (§19.2). Excerpts are verbatim — a paraphrase
is already an interpretation, and interpretation is not evidence.

## Contradiction handling

Claims sharing a `subject` are compared on two narrow, checkable signals:

1. **Polarity** — one asserts what the other negates (English and Arabic markers)
2. **Quantity** — both state a number for the same subject and the numbers differ

A detected conflict is recorded as a `Contradiction`, both claims survive, and
their confidence drops to at most `0.4`. Nothing is merged, averaged, or dropped.
Aggregate confidence falls as conflicts accumulate.

## Security — retrieved content is data

Retrieved text is untrusted and is only ever read as data. It is split, matched
and copied verbatim into excerpts; it is never interpreted.

It **cannot**: name a tool, be spliced into a system-prompt position, carry a
capability, or influence which agent runs. There is no code path from source
text to an action.

This is tested, not asserted: a fixture document contains a prompt injection
placed inside a sentence about the subject, so extraction genuinely carries it
into the result. The tests confirm it arrives as quoted, attributed evidence and
that the tool belt, event trail and permission decisions are all unchanged.

## Residual risk in synthesis

One place deserves naming rather than glossing. Synthesis passes the
deterministic summary — which quotes source text — to a model as a **user**
message, with instructions in the **system** position. A determined injection
in a source could therefore influence the *prose*.

Its blast radius is bounded and worth stating precisely: no tools are offered
on that call, so nothing can be invoked; the structured result is already final
before synthesis runs, so claims, evidence, verifications and contradictions
cannot be altered; and `synthesisFromModel` records that the prose was
model-written. The claims remain the source of truth, and a reader who distrusts
the prose can read them.

## Model usage

The model layer is **optional by design**. Every stage before synthesis is
deterministic. Synthesis asks the `ModelRouter` with a capability policy — never
a provider name — and falls back to the deterministic writer when no provider is
available, setting `synthesisFromModel: false` rather than going silent.

The structured result is the source of truth. Prose is derived from claims;
claims are never derived from prose.

## Known limitations

- **Subject matching is literal.** `Claim.subject` is an opaque string, so two
  claims about the same thing under differently-worded subjects are never
  compared. Normalisation needs a controlled vocabulary or a model call; both
  are worse than an honest limit.
- **Contradiction detection is lexical.** It catches negation and differing
  numbers. It misses paraphrased disagreement, disagreement without a negation
  marker, and anything needing world knowledge. General NL contradiction
  detection is unsolved and is not approximated here.
- **Relevance is term overlap.** No semantic search until memory has an index
  (Phase 10).
- **Retrieval is local only.** Fixtures and a local directory. No web retrieval,
  no crawler, no browser — a real HTTP retriever is future work behind the same
  `SourceRetriever` interface.
- **No verification across runs.** Claims are not persisted, so a later run
  cannot contradict an earlier one. That needs durable memory (Phase 10).

## Future extensions

Each fits behind an existing seam: an HTTP retriever (`SourceRetriever`), a
model-assisted extractor for claims the deterministic rules miss (as an
*additional* source of candidate claims, never replacing the verbatim path),
semantic relevance once an index exists, and cross-run contradiction once claims
persist.
