# Finance Division

The FP&A continuous forecast lifecycle (spec §4), over the NEXUS Core. Zero
dependencies, no provider, no network, no cost.

## The loop

```txt
ACTUALS ──▶ VARIANCE ──▶ DRIVER ──▶ FORECAST ──▶ SCENARIO ──▶ RECOMMENDATION
 land       analysis    analysis     update      analysis
   │            │           │           │            │             │
Controller     FP&A        FP&A        FP&A       Scenario        CFO
```

Actuals arrive through `finance.actuals`, a Tool, so the read passes ToolBelt's
three gates and is charged to the budget. Every stage after that is a pure
function over data, which is what makes a forecast update reproducible — the
precondition for ever measuring whether it was any good.

**The loop stops where the evidence stops.** A variance inside the owner's
thresholds ends the run with the forecast intact. A material variance that no
driver movement explains ends it with the variance recorded and the forecast
**unrevised** — revising anyway would encode a cause nobody identified.

## Forecast vintages

Immutable, append-only, superseded and never overwritten (§4.3). Vintages are
frozen at runtime, not merely typed `readonly`. Appending onto a stale head is
refused rather than rebased, because a chain whose stated order never happened
is worse than an error.

This is what makes retrospective accuracy measurable: the number believed in
January still exists in April, so `accuracyOf()` can compare actuals against
what was actually forecast rather than against a record edited to agree.

## Variance and attribution

Materiality is **configuration**, per §4.3 — an absolute threshold and a
relative one, either of which trips. A line item that was forecast and never
arrived, or arrived and was never forecast, is material regardless of size: its
absence is the finding.

Driver attribution reports `unexplained` and never distributes it. A bridge that
always ties out reports perfect explanation whether or not the drivers explain
anything, which would delete the "explained versus unexplained" KPI (§4.2).

## Recommendations

A recommendation is a `Claim` with `status: 'recommendation'`, so §6.1 already
requires it to name what it derives from and the assumptions it rests on. The
scenario basis is therefore structural, not a field somebody might forget.

## Known limitations

- ~~**No durability.**~~ **Resolved (Phase 10).** Vintages persist as versions
  of one key in the division's memory scope, and the ledger is rebuilt from
  history on start. A vintage and a `VersionedRecord` mean the same thing --
  immutable, ordered, superseded, with a reason -- so this is a fit rather than
  a forcing, and `asOf` works across processes without new machinery. Accuracy
  per horizon (§4.2) is finally measurable: a January forecast can be scored
  against April's actuals because January's numbers still exist. An unreadable
  stored vintage refuses rather than starting fresh, because a silently skipped
  vintage renumbers every one after it.
- **No scheduling.** §4.3 says the loop runs on "events and schedules".
  `Scheduler` is gap `A10`, Phase 12. The event half is implemented — a run
  begins when actuals arrive — and the schedule half is not.
- **One agent, four stage owners.** All six stages run; they run inside the FP&A
  analyst rather than as separate agents. See ADR 0016.
- **Eleven specialists unimplemented.** §4.1 lists fifteen roles. Four are
  modelled as stages; the rest are not built and are not registered.
- **No delegation to Research yet.** §4.3 says market inputs arrive by
  delegation and carry evidence. The seam exists (`context.delegate()`); Finance
  does not yet use it, so market-derived drivers are supplied as configuration.
- **Sensitivities are linear and supplied.** The owner's model, not an inferred
  one. An inferred sensitivity would be a number this system invented and then
  treated as the owner's.
