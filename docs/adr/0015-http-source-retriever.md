# ADR 0015 — A native HTTP `SourceRetriever`

**Status:** Accepted · **Date:** 2026-08-27 · **Phase:** 5 (Research)

## Context

Research retrieval was local only: fixtures and a directory, both behind
`SourceRetriever`. The interface reserved this from the start — *"A real HTTP
retriever is future work behind this same interface."*

Agent-Reach was assessed as a candidate dependency and rejected. Its execution
model is a skill that instructs a model to shell out to third-party CLIs, which
bypasses the Supervisor, the permission check, the ToolBelt and the budget by
construction. What survived the assessment was not code but a rule set: its URL
guard is the best-audited part of that project, and the rules are reimplemented
here natively. Nothing is vendored, imported or depended upon.

## Decision 1 — It retrieves; it does not discover

`discover(query)` presumes a known corpus, and a web retriever cannot turn a
question into URLs without a search engine. Rather than bend the interface, the
HTTP retriever is given the sources its owner chose and ranks that list by term
overlap with **no network access at all**. Only `retrieve()` makes a request.

This is what keeps the slice inside the existing contract, and it is also the
stronger security property: there is no code path from retrieved content to the
next fetch. Crawling is not "not implemented yet" — it is structurally absent,
and a test asserts that a document naming another URL cannot add it.

## Decision 2 — The URL guard fails closed, and does not resolve DNS

A URL is refused unless it is affirmatively public HTTP(S): non-HTTP schemes,
userinfo disguises (`https://trusted.example@evil.test`), loopback, RFC 1918,
CGNAT, link-local (including `169.254.169.254`, which is credentials-as-a-
service on every major cloud), multicast, non-global IPv6, internal suffixes,
single-label intranet names, control characters and backslashes.

Legacy IPv4 spellings get a real parser rather than a dotted-quad check.
`2130706433`, `0x7f000001`, `017700000001` and `127.1` are all loopback, and all
four pass a naive check. Sabotaging the parser back to dotted-quad-only fails
five tests, which is the evidence that they are doing work.

**It never resolves DNS, deliberately.** Resolving here would be worse than not
resolving: the name is resolved again when the request is made, so a hostile
name can answer public at check time and private a moment later, and the check
itself would leak every URL to a resolver. The guarantee is therefore precise
and limited — no literal or syntactic path to a private address — and the
residual gap (a public name pointed at a private IP) is documented rather than
implied away. Closing it needs connection-time pinning, which is a fetch-layer
concern, not a parser's.

## Decision 3 — Redirects are followed manually

`redirect: 'manual'`, with every hop re-checked from scratch. Letting the
runtime follow redirects would make the guard decorative: a public URL that
302s to the metadata address is the standard way past a URL allowlist.

This one is easy to lose in a refactor and invisible when lost, so a test pins
the request options directly rather than the outcome.

## Decision 4 — The byte cap is enforced while streaming

Not after. `Content-Length` is a claim by the server, which a hostile or broken
one can omit or lie about, and reading first to measure afterwards performs
exactly the allocation the cap exists to prevent. The read is cancelled the
moment the budget is exceeded.

## Decision 5 — Direct fetch by default; a reader service is recorded, never hidden

A reader service (Jina Reader and similar) turns arbitrary HTML into text, which
is genuinely useful. It also learns every page its user reads, and its output is
a *rendering* of the source rather than the source.

So it is off by default, and when enabled the transformation is recorded on
`RetrievedContent.via` and named in the evidence. This matters more than it
looks: a "verbatim excerpt" of a rendering is verbatim with respect to the
rendering, and letting `contentHash` silently attest to a third party's Markdown
while the evidence claims to quote the origin would make the guarantee attest to
the wrong artefact.

## Decision 6 — Rate limiting reuses the Core tracker

`createLimitTracker`, keyed per host. There is a real semantic stretch here: the
tracker's keys are `ProviderId` and a website is not a provider. The mechanism
is generic (rolling windows, attempt recorded before dispatch) and a second
limiter would be a second set of bugs, so the stretch is accepted and named
rather than hidden behind a wrapper.

## Consequences

**No Core contract changed.** `SourceRetriever`, `Evidence`, `EvidenceSource`,
`Tool` and `Claim` all accommodated this unchanged, and the stability tripwire
stayed green through the whole slice. That is the useful result: it is evidence
that the retrieval seam was drawn in the right place in Phase 5B.

One division-local type gained an optional field (`RetrievedContent.via`).

The error codes are the existing closed set. `UNSUPPORTED` carries "larger than
we accept" and "too many redirects"; there is no `LIMIT_EXCEEDED` and none was
added, because a closed enum that grows on demand is not closed.

Untrusted content is unchanged in status: the same hostile document now arrives
over HTTP and must still pass the existing assertions — carried, quoted,
attributed, and inert.
