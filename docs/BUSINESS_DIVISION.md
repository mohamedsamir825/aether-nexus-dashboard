# Business & Strategy Division

Option sets with explicit trade-offs (spec §5), over the NEXUS Core. No tools,
no provider, no network, no cost. Everything it knows came from another
division's run.

## What it produces, and what it refuses to

```txt
                    ┌──▶ Research   facts, with evidence behind them
User ──▶ Business ──┤
                    └──▶ Finance    prices, with a vintage behind them
                          │
                    OPTION SET with stated trade-offs
                          │
                    the strategic call is the USER's
```

§5 is explicit that the user decides. So `StrategicOption` has no `preferred`
field, no ranking and no recommendation — there is nowhere to put one. A
division that frames the choice and then makes it is not framing a choice.

The narrative is derived from the structure and never carries a finding of its
own; the last line says no option is recommended, which is the division
declining a job that is not its.

## Every input arrives by delegation

Market facts from `{ division: 'research', role: 'analyst' }`, prices from
`{ division: 'finance', role: 'fpa' }` — addressed **by name** through the
Supervisor, so each hop re-checks permission, shares the tree's budget, and
lands in the event trail (§18.1). The package imports nothing from either
division: a code-level dependency would let Business call their pipelines
directly, outside all three.

`requiredCapabilities` is the boundary written as a permission set:
`agent:dispatch`, `memory:read`, `memory:write`, and nothing else. No
`tool:execute`, no `research:retrieve`, no `finance:actuals`. Business *cannot*
run a tool, read a corpus or touch actuals — it is not merely asked not to.

## Only facts cross the boundary

Of the claims Research returns, only `status === 'fact'` is carried. An
inference is Research's reasoning, and repeating it as a market fact would
launder a derivation into an observation — the option set would then rest on
confidence nobody earned.

**A number never comes from prose.** Finance supplies the value and the vintage
accountable for it; extracting a figure from a sentence is the fabrication this
system exists to refuse. An option with no baseline to price against reports its
drivers unpriced rather than inventing one.

## Gaps are named, and attributed

Three different things can leave an input unestablished, and the output keeps
them apart:

| what happened | where it appears |
| --- | --- |
| Research found no evidence | `unsourced` |
| Finance could not price a driver | `unpriced` |
| the delegation was **refused** — denied, or stopped by the tree's `maxAgentRuns` | `refusals`, *and* the gap it caused |

`refusals` exists because the first two read as "the evidence is thin" while the
third is the system stopping itself, and without it a run cut short by its own
budget is indistinguishable from a market nobody has written about (ADR 0019).

An option resting on unknowns also carries that as a stated downside: it really
is worse than one that does not, and hiding it would make the two look alike.

## Durable memory

Business holds one scope, `division:business`, and a versioned view narrowed to
it — never Research's or Finance's, in either direction.

It records the framings it presented and **nothing else**. `evaluatedAt`,
`selectedOptionId` and `outcome` are `null` and stay null, because NEXUS has no
source that observes a user reviewing a set, choosing from it, or seeing a
result. `null` means NOT RECORDED, never "nothing happened", and
`deliberationState()` exists so a caller reads the state through a function that
cannot be misread rather than by testing nulls.

Asking the same question again supersedes rather than overwrites; `validFrom` is
the set's own `createdAt`, so "what was on the table in March" answers with
March's framing rather than June's paperwork.

## KPIs — all four BLOCKED

§5 names: decision quality reviewed after outcomes are known; strategic
surprises not anticipated; opportunities identified that were acted on; time
from market signal to briefing.

None computes, and `src/kpi.ts` says so with what each waits on. Every one needs
a fact about something outside this division — what the user decided, what
actually happened, when a signal first arrived — and §4.3's user-decision stage
is not built. Persisting the framings did not change that; it recorded the
artifact those KPIs will one day be computed from.

`tallyDeliberations()` is a **census, not a metric**: `selected: 0` counts
records, and never claims nobody chose.

## Known limitations

- **No competitive tracking.** Phase 7 lists it; nothing here does it.
- **One role of the ten in §5.** The Director. An entry on the roster that
  resolves to nothing is a fake implementation, so the other nine are absent.
- **Criteria matching is literal.** A consequence is emitted where an input
  mentions a criterion. Nothing infers relevance, and a criterion no input
  names simply produces no row — an empty cell rather than a guessed one.
- **Finance is not asked to source its own market inputs.** Business asks
  Research directly, so a real run is two levels deep rather than three. The
  run trace shows this rather than implying a chain that does not happen.
