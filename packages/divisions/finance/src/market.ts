/**
 * Market inputs, sourced by delegation to Research (§4.3).
 *
 * "Market inputs arrive by **delegation to Research**, and carry evidence."
 *
 * ## Finance addresses Research; it does not import it
 *
 * The delegation target is `{ division: 'research', role: 'analyst' }` -- a
 * name, resolved by the Supervisor at run time. There is no import from the
 * Research package, and that is the whole point of §4.4's "all via delegation":
 * a code-level dependency would let Finance call Research's pipeline directly,
 * outside the permission check, the shared budget and the event trail.
 *
 * ## What this deliberately will not do
 *
 * It never reads a number out of Research's prose. Parsing "growth is around
 * 4%" into a driver value is exactly the fabrication this project keeps
 * refusing: the sentence is a source's phrasing, not a measurement, and a
 * figure derived that way would carry Research's evidence while meaning
 * something Research never asserted.
 *
 * So the owner supplies the figure and delegation supplies the *basis* and the
 * *evidence* standing behind it. A market driver that comes back with no
 * evidence is reported by name rather than left looking like a sourced one.
 */
import {
  type AgentContext,
  type Evidence,
  type EvidenceId,
  type UsageMetrics,
  divisionId,
  emptyUsage,
  mergeUsage,
} from '@nexus/core';
import type { Driver, MarketInput } from './types.ts';

/** Research's published entry point (§3.2), addressed by name. */
const RESEARCH_DIVISION = divisionId('research');
const RESEARCH_ANALYST_ROLE = 'analyst';

/** Just the part of a Research result this needs. Structural, not imported. */
interface ResearchShape {
  readonly claims?: readonly { readonly statement: string; readonly status: string }[];
}

export interface SourcedMarket {
  readonly drivers: readonly Driver[];
  readonly evidence: readonly Evidence[];
  /** Market drivers that were asked about and came back with nothing. */
  readonly unsourced: readonly string[];
  /**
   * What the delegated runs cost.
   *
   * The Supervisor shares one budget guard across a delegation chain, so the
   * spend is *enforced* correctly without this. What it does not do is
   * aggregate usage back up, so a caller that ignores the delegate's metrics
   * reports less work than it caused -- which makes the observability numbers
   * quietly wrong even while the budget holds.
   */
  readonly usage: UsageMetrics;
}

/**
 * Enriches drivers with sourced bases and the evidence behind them.
 *
 * A failed delegation is not fatal. Research being unavailable, unpermitted or
 * finding nothing all mean the same thing to Finance -- this driver is not
 * sourced -- and that is reported rather than raised, because a forecast built
 * on the owner's own assumptions is still a legitimate forecast. What must not
 * happen is one that *looks* sourced and is not.
 */
export async function sourceMarketInputs(params: {
  readonly inputs: readonly MarketInput[];
  readonly drivers: readonly Driver[];
  readonly context: AgentContext;
}): Promise<SourcedMarket> {
  if (params.inputs.length === 0) {
    return { drivers: params.drivers, evidence: [], unsourced: [], usage: emptyUsage };
  }

  const evidence: Evidence[] = [];
  let usage: UsageMetrics = emptyUsage;
  const unsourced: string[] = [];
  const sourced = new Map<string, { basis: string; ids: EvidenceId[] }>();

  for (const input of params.inputs) {
    const delegated = await params.context.delegate<ResearchShape>({
      target: { division: RESEARCH_DIVISION, role: RESEARCH_ANALYST_ROLE },
      task: {
        id: `market_${input.driver}`,
        objective: 'research',
        input: { question: input.question, subjects: input.subjects },
      },
    });

    // Counted whether or not the result was usable: the work happened.
    if (delegated.ok) usage = mergeUsage(usage, delegated.value.usage);

    if (!delegated.ok || delegated.value.evidence.length === 0) {
      unsourced.push(input.driver);
      continue;
    }

    evidence.push(...delegated.value.evidence);

    // Only what a source stated. An inference of Research's is Research's
    // reasoning, not a market fact, and quoting it as a driver's basis would
    // launder a derivation into an observation.
    const stated = (delegated.value.output?.claims ?? [])
      .filter((c) => c.status === 'fact')
      .map((c) => c.statement);

    sourced.set(input.driver, {
      basis:
        stated.length > 0
          ? `sourced by Research: ${stated.join(' | ')}`
          : 'sourced by Research: evidence retrieved, no source stated a fact',
      ids: delegated.value.evidence.map((e) => e.id),
    });
  }

  const drivers = params.drivers.map((driver) => {
    const found = sourced.get(driver.id);
    if (found === undefined) return driver;
    return {
      ...driver,
      // The owner's basis is kept, not replaced: what Research found is
      // added to it, so the original assumption stays visible.
      basis: `${driver.basis}; ${found.basis}`,
      evidence: found.ids,
    };
  });

  return { drivers, evidence, unsourced, usage };
}
