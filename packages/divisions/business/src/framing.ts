/**
 * Framing options from delegated inputs (spec §5, §18.1).
 *
 * Both divisions are addressed by name through the Supervisor:
 *
 *   { division: 'research', role: 'analyst' }   -- market facts, with evidence
 *   { division: 'finance',  role: 'fpa'     }   -- prices, with a run behind them
 *
 * No import from either package. §4.4 says every cross-division interface is a
 * delegation, and a code-level dependency would let Business call their
 * pipelines directly, outside the permission check, the shared budget and the
 * event trail.
 *
 * ## What this refuses to do
 *
 * It never invents a price and never asserts a market fact of its own. When
 * Research finds nothing, the market question is reported unsourced; when
 * Finance cannot price a driver, the driver is reported unpriced. Filling
 * either gap with a plausible number would put Business's guess where another
 * division's accountable answer belongs -- and it would look identical to the
 * real thing in the output.
 *
 * It also keeps apart the two ways a gap happens. A delegation that was
 * *refused* -- denied, or stopped by the tree's agent-run budget -- is recorded
 * in `refusals` as well as in the gap it caused. Without that, a run the system
 * cut short reads exactly like a market nobody has written about.
 */
import {
  type AgentContext,
  type Claim,
  type ClaimId,
  type Evidence,
  type EvidenceId,
  type RunId,
  type UsageMetrics,
  claimId,
  divisionId,
  emptyUsage,
  mergeUsage,
} from '@nexus/core';
import type { OptionSketch, PricedConsequence, RefusedInput } from './types.ts';

const RESEARCH = divisionId('research');
const FINANCE = divisionId('finance');

/** Structural, not imported: only the parts of each result this needs. */
interface ResearchShape {
  readonly claims?: readonly { readonly statement: string; readonly status: string }[];
}
interface FinanceShape {
  readonly revised?: {
    readonly id: string;
    readonly amounts?: readonly {
      readonly lineItem: string;
      readonly period: string;
      readonly value: number;
    }[];
  } | null;
}

export interface SourcedInputs {
  /** Facts Research established, as claims Business may cite but not assert. */
  readonly claims: readonly Claim[];
  readonly evidence: readonly Evidence[];
  readonly priced: readonly PricedConsequence[];
  /** Market questions that came back with no evidence. */
  readonly unsourced: readonly string[];
  /** Cost drivers Finance could not price. */
  readonly unpriced: readonly string[];
  /** Of those gaps, the ones caused by a refused run rather than by the evidence. */
  readonly refusals: readonly RefusedInput[];
  readonly usage: UsageMetrics;
}

/**
 * Gathers the inputs one option needs.
 *
 * A failed delegation is not fatal. Research or Finance being unavailable or
 * unpermitted means this option is less well supported, which the validator
 * will notice and the output will say -- but an analysis that stops entirely
 * because one price is missing is less useful than one that names the gap.
 */
export async function gatherInputs(params: {
  readonly sketch: OptionSketch;
  readonly context: AgentContext;
  readonly runId: RunId;
  readonly createdAt: string;
  /** The period Finance should price. The owner's calendar, not ours. */
  readonly pricingPeriod: string;
}): Promise<SourcedInputs> {
  const claims: Claim[] = [];
  const evidence: Evidence[] = [];
  const priced: PricedConsequence[] = [];
  const unsourced: string[] = [];
  const unpriced: string[] = [];
  const refusals: RefusedInput[] = [];
  let usage: UsageMetrics = emptyUsage;

  // --- market facts, from Research -----------------------------------------
  for (const question of params.sketch.marketQuestions ?? []) {
    const delegated = await params.context.delegate<ResearchShape>({
      target: { division: RESEARCH, role: 'analyst' },
      task: {
        id: `market_${params.sketch.id}_${slug(question)}`,
        objective: 'research',
        input: { question, subjects: [question] },
      },
    });

    if (delegated.ok) usage = mergeUsage(usage, delegated.value.usage);
    if (!delegated.ok) {
      // Refused, not unproductive. Both leave the question unsourced -- only
      // one of them is a statement about the market.
      unsourced.push(question);
      refusals.push({
        input: question,
        division: String(RESEARCH),
        code: delegated.error.code,
        message: delegated.error.message,
      });
      continue;
    }
    if (delegated.value.evidence.length === 0) {
      unsourced.push(question);
      continue;
    }

    evidence.push(...delegated.value.evidence);

    // Only what a source stated. An inference of Research's is Research's
    // reasoning; carrying it as a market fact would launder a derivation into
    // an observation.
    const stated = (delegated.value.output?.claims ?? []).filter((c) => c.status === 'fact');
    if (stated.length === 0) {
      unsourced.push(question);
      continue;
    }

    for (const [index, fact] of stated.entries()) {
      claims.push({
        id: claimId(`cl_${params.runId}_mkt_${slug(question)}_${index}`),
        statement: fact.statement,
        // A fact about the market, cited from Research's evidence. Business
        // never upgrades this to something it asserts on its own authority.
        status: 'fact',
        subject: question,
        supportedBy: delegated.value.evidence.map((e) => e.id as EvidenceId),
        contradictedBy: [],
        derivedFrom: [],
        assumptions: [],
        confidence: 1,
        runId: params.runId,
        createdAt: params.createdAt,
      });
    }
  }

  // --- prices, from Finance -------------------------------------------------
  const drivers = params.sketch.costDrivers ?? [];
  // No baseline means nothing to price against, and Business will not invent
  // one. The drivers are reported unpriced instead.
  if (drivers.length > 0 && params.sketch.pricingBaseline === undefined) {
    unpriced.push(...drivers);
  } else if (drivers.length > 0) {
    const delegated = await params.context.delegate<FinanceShape>({
      target: { division: FINANCE, role: 'fpa' },
      task: {
        id: `price_${params.sketch.id}`,
        objective: 'finance',
        input: {
          question: `price the consequences of: ${params.sketch.label}`,
          actuals: { period: params.pricingPeriod },
          // Carried, never constructed. Finance validates it.
          baseline: params.sketch.pricingBaseline,
        },
      },
    });

    if (delegated.ok) {
      usage = mergeUsage(usage, delegated.value.usage);
      const vintage = delegated.value.output?.revised ?? null;
      const amounts = vintage?.amounts ?? [];
      for (const driver of drivers) {
        const found = amounts.find((a) => a.lineItem === driver);
        if (found === undefined) {
          unpriced.push(driver);
          continue;
        }
        priced.push({
          driver,
          amount: found.value,
          period: found.period,
          // Which run is accountable for this figure.
          pricedBy: vintage?.id ?? String(delegated.value.usage.toolCalls),
        });
      }
    } else {
      unpriced.push(...drivers);
      for (const driver of drivers) {
        refusals.push({
          input: driver,
          division: String(FINANCE),
          code: delegated.error.code,
          message: delegated.error.message,
        });
      }
    }
  }

  return { claims, evidence, priced, unsourced, unpriced, refusals, usage };
}

/** Ids of the claims a consequence may cite. */
export function citable(claims: readonly Claim[]): readonly ClaimId[] {
  return claims.map((c) => c.id);
}

function slug(text: string): string {
  return text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '').slice(0, 32);
}
