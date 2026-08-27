# ADR 0017 — Durable versioned memory, and why retrieval is called lexical

**Status:** Accepted · **Date:** 2026-08-27 · **Phase:** 10 (Memory)

## Context

Memory was volatile: a Map that reported itself `degraded` so nothing would
mistake it for storage. Three gaps depended on fixing that — `A3` (versioning
and supersession with validity intervals), `A5` (semantic retrieval), and the
Research and Finance limitations that follow from neither existing: forecast
vintages died with the process, and contradiction detection could not compare
across runs.

## Decision 1 — Versioning is a new contract file, not an edit

`contracts/versioned-memory.ts` is additive. `VersionedRecord extends
MemoryRecord`, so every existing reader keeps working and `contracts/memory.ts`
is not touched. This is the same move ADR 0013 made for `Claim`: the stability
tripwire fires on the new file, and accepting the baseline is a deliberate act
this ADR records.

## Decision 2 — Two timelines, kept separate

`createdAt` is when NEXUS recorded a belief. `validFrom`/`validTo` are when the
belief was true in the world.

Conflating them is the classic bitemporal mistake and it is not academic:
learning in June that a price changed in March has to be expressible, and with
one timeline it is not. A test asserts the two differ for exactly that case.

## Decision 3 — Supersession is a chain, never a flag

A version points back at the one it replaces. There is no `supersededBy` field,
because setting one would mean writing to a record that is supposed to be
immutable. "Is this current" is answered by asking whether anything points at
it — the same shape as `ForecastLedger`, for the same reason.

A version whose `validFrom` precedes its predecessor's is refused rather than
accepted and sorted. Two records claiming the same instant leave `asOf` with no
rule for choosing, and inventing one silently would be worse than the error.

## Decision 4 — Append-only, with tombstones

Records are appended as JSON lines and never rewritten. Deletion appends a
tombstone rather than removing a line: a fact that was believed and retracted is
different from one that never existed, and only an append-only log can tell them
apart.

A truncated final line — a crash mid-append — costs one record and is reported
through health, rather than failing to open the store. Losing one uncommitted
record is recoverable; refusing to open the file is not.

**The in-memory index is not updated when the append fails.** A store that
remembers what it could not persist tells the truth until the next restart and
then quietly starts lying. Sabotaging this fails two tests.

## Decision 5 — Scope keys are escaped

`{kind:'user', id:'a:b'}` and `{kind:'user:a', id:'b'}` both flatten to
`user:a:b` under naive concatenation, and would silently share memories. Both
halves are escaped so a crafted scope id cannot address another scope's
records. This is a permission boundary expressed as a string function, which is
exactly the kind of thing that is never noticed until it is exploited.

## Decision 6 — Retrieval is called lexical, because that is what it is

`A5` is written as "semantic retrieval". This ships **BM25**, and BM25 cannot
match "car" to "automobile" because it has no notion of meaning. Naming it
semantic would promise a capability the code does not have, and the first person
to rely on it would be misled by us rather than by the data. A test asserts the
synonym case fails, so the limit is a recorded fact rather than a surprise.

What it does improve is real. The previous implementation was
`content.includes(needle)`: it could not rank, and it missed a document that
said every query term in a different sentence. BM25 weights a matched term by
how distinctive it is and damps repetition, so keyword stuffing does not bury a
better document.

`EmbeddingProvider` is declared as the seam a real semantic backend would fill,
and deliberately not implemented. The reference implementations worth learning
from — anything-llm (MIT) ships twelve — either call a paid API or download a
~90MB ONNX model behind a native runtime and a vendor CDN. Both break something
this project holds to: free-tier-only providers (ADR 0011), zero dependencies,
and a default path that works offline with no credential. So the seam exists,
the deterministic ranker is the default, and filling it is a decision someone
makes later with the trade-off visible.

## Consequences

`contracts/memory.ts` unchanged; one new contract file, baseline accepted here.
No dependency added. The filesystem is injected, so the tests exercise the real
code against an in-memory implementation and touch no disk.

What this unblocks is not yet built: forecast vintages surviving a restart,
cross-run contradiction detection, and the two Finance KPIs that need history
(`kpi.ts` names them as absent). Those are follow-on work, and claiming them
here would be claiming a phase that has not been done.
