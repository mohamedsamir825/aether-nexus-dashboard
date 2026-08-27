/**
 * The Chief Strategy agent (§5).
 *
 * §5 lists ten roles. One is registered: the Director, who owns "strategic
 * position, prioritisation, trade-offs" — which is the whole of this slice.
 * The other nine are not implemented and are not on the roster, because an
 * entry that resolves to nothing is a fake implementation.
 *
 * The agent owns no infrastructure. Market facts arrive by delegation to
 * Research and prices by delegation to Finance, both through the Supervisor,
 * so each hop re-checks permission, shares the budget and lands in the event
 * trail (§18.1). Everything after that is arithmetic and assembly over data.
 */
import {
  type AgentContext,
  type AgentResult,
  type AnyAgent,
  type Claim,
  type Result,
  type RunId,
  agentId,
  divisionId,
  emptyUsage,
  err,
  mergeUsage,
  nexusError,
  ok,
} from '@nexus/core';
import { gatherInputs, citable } from './framing.ts';
import { createOptionValidator } from './option-validator.ts';
import type {
  Consequence,
  OptionSet,
  OptionSketch,
  RejectedOption,
  StrategicOption,
  StrategicQuestion,
} from './types.ts';

export const BUSINESS_DIVISION_ID = divisionId('business');
export const BUSINESS_STRATEGY_ID = agentId('business.strategy');
export const BUSINESS_STRATEGY_ROLE = 'strategy';

function isStrategicQuestion(input: unknown): input is StrategicQuestion {
  if (typeof input !== 'object' || input === null) return false;
  const q = input as Partial<StrategicQuestion>;
  return (
    typeof q.question === 'string' &&
    q.question.trim() !== '' &&
    Array.isArray(q.criteria) &&
    q.criteria.length > 0 &&
    Array.isArray(q.options) &&
    q.options.length > 0
  );
}

/**
 * Turns sourced inputs into consequences on the owner's criteria.
 *
 * Deterministic and deliberately literal: a consequence is emitted only where
 * an input actually speaks to a criterion. Inventing a consequence to fill a
 * gap in the matrix would produce a comparison whose completeness is fictional,
 * and the validator would then pass a set that says nothing.
 */
function consequencesFor(params: {
  readonly sketch: OptionSketch;
  readonly criteria: readonly string[];
  readonly claims: readonly Claim[];
  readonly priced: readonly { readonly driver: string; readonly amount: number }[];
  readonly unsourced: readonly string[];
  readonly unpriced: readonly string[];
}): { upsides: Consequence[]; downsides: Consequence[] } {
  const cite = citable(params.claims);
  const upsides: Consequence[] = [];
  const downsides: Consequence[] = [];

  for (const criterion of params.criteria) {
    const relevant = params.claims.filter(
      (c) =>
        c.subject.toLowerCase().includes(criterion.toLowerCase()) ||
        c.statement.toLowerCase().includes(criterion.toLowerCase()),
    );

    if (relevant.length > 0) {
      upsides.push({
        criterion,
        statement:
          `${relevant.length} sourced fact(s) bear on ${criterion}: ` +
          relevant.map((c) => c.statement).join(' | '),
        favourable: true,
        derivedFrom: relevant.map((c) => c.id),
      });
    }

    // A cost is a downside on the criterion it touches. This is the one place
    // a number reaches an option, and it came from Finance.
    const cost = params.priced.filter((p) =>
      p.driver.toLowerCase().includes(criterion.toLowerCase()),
    );
    if (cost.length > 0) {
      downsides.push({
        criterion,
        statement: `costs ${cost.map((c) => `${c.driver} ${c.amount}`).join(', ')}`,
        favourable: false,
        derivedFrom: cite,
      });
    }
  }

  // What could not be established is a downside in its own right: an option
  // resting on unknowns is genuinely worse than one that does not, and hiding
  // that would make the two look equivalent.
  const gaps = [...params.unsourced, ...params.unpriced];
  if (gaps.length > 0 && cite.length > 0) {
    downsides.push({
      criterion: params.criteria[0] as string,
      statement: `rests on ${gaps.length} unestablished input(s): ${gaps.join(', ')}`,
      favourable: false,
      derivedFrom: cite,
    });
  }

  return { upsides, downsides };
}

/** Prose derived from the structure. It never carries a finding of its own. */
function narrate(set: Omit<OptionSet, 'narrative'>): string {
  const lines: string[] = [`Question: ${set.question}`, `Criteria: ${set.criteria.join(', ')}`, ''];

  if (set.options.length === 0) {
    lines.push('No option could be analysed. Nothing is proposed.');
  } else {
    lines.push(`${set.options.length} option(s), each with stated trade-offs:`, '');
    for (const option of set.options) {
      lines.push(`## ${option.label}`);
      for (const up of option.upsides) lines.push(`  + [${up.criterion}] ${up.statement}`);
      for (const down of option.downsides) lines.push(`  - [${down.criterion}] ${down.statement}`);
      if (option.priced.length > 0) {
        lines.push(
          `  priced by Finance: ${option.priced.map((p) => `${p.driver} ${p.amount}`).join(', ')}`,
        );
      }
      lines.push(`  assumes: ${option.assumptions.join('; ')}`);
      lines.push('');
    }
  }

  if (set.rejected.length > 0) {
    lines.push('Not analysed:');
    for (const r of set.rejected) lines.push(`  - ${r.label}: ${r.reason}`);
    lines.push('');
  }
  if (set.unsourced.length > 0) lines.push(`Unsourced market questions: ${set.unsourced.join(', ')}`);
  if (set.unpriced.length > 0) lines.push(`Unpriced cost drivers: ${set.unpriced.join(', ')}`);

  // §5: the user makes the strategic call. Saying so is not decoration -- it
  // is the division declining a job that is not its own.
  lines.push('', 'No option is recommended. The strategic call is the user’s (§5).');
  return lines.join('\n');
}

export function createStrategyDirector(): AnyAgent {
  const validator = createOptionValidator();

  return {
    descriptor: {
      id: BUSINESS_STRATEGY_ID,
      division: BUSINESS_DIVISION_ID,
      role: BUSINESS_STRATEGY_ROLE,
      displayName: 'Chief Strategy',
      description:
        'Frames strategic options with explicit trade-offs. Delegates market facts ' +
        'to Research and pricing to Finance. Never recommends: the call is the user’s.',
      version: '1.0.0',
      skills: [],
      // No tools of its own. Everything it needs belongs to another division,
      // and is reached by delegation rather than by borrowing a tool.
      tools: [],
      capabilities: ['agent:dispatch'],
      memoryScopes: [],
      modelPolicy: { requiredCapabilities: ['text'], allowFallback: true },
    },

    async handle(task, context: AgentContext): Promise<Result<AgentResult>> {
      if (!isStrategicQuestion(task.input)) {
        return err(
          nexusError(
            'INVALID_INPUT',
            'a strategic question needs a question, at least one criterion, and at least one option',
            { details: { taskId: task.id } },
          ),
        );
      }

      const request: StrategicQuestion = task.input;
      const runId: RunId = context.runId;
      const createdAt = context.clock.now().toISOString();

      const options: StrategicOption[] = [];
      const rejected: RejectedOption[] = [];
      const allClaims: Claim[] = [];
      const unsourced: string[] = [];
      const unpriced: string[] = [];
      let usage = emptyUsage;

      for (const sketch of request.options) {
        const inputs = await gatherInputs({
          sketch,
          context,
          runId,
          createdAt,
          pricingPeriod: request.pricingPeriod ?? 'current',
        });
        usage = mergeUsage(usage, inputs.usage);
        allClaims.push(...inputs.claims);
        unsourced.push(...inputs.unsourced);
        unpriced.push(...inputs.unpriced);

        const { upsides, downsides } = consequencesFor({
          sketch,
          criteria: request.criteria,
          claims: inputs.claims,
          priced: inputs.priced,
          unsourced: inputs.unsourced,
          unpriced: inputs.unpriced,
        });

        const option: StrategicOption = {
          id: sketch.id,
          label: sketch.label,
          description: sketch.description,
          upsides,
          downsides,
          priced: inputs.priced,
          supportedBy: inputs.evidence.map((e) => e.id),
          assumptions: [
            ...inputs.claims.map((c) => `sourced: ${c.statement}`),
            ...inputs.unsourced.map((q) => `UNVERIFIED: ${q}`),
            ...inputs.unpriced.map((d) => `UNPRICED: ${d}`),
          ],
          openQuestions: [...inputs.unsourced, ...inputs.unpriced],
        };

        // An option that cannot be analysed is reported as rejected, never
        // emitted half-formed. A half-analysed option in a set of complete
        // ones reads as a weak choice rather than as missing work.
        const valid = validator.validateOption(option);
        if (!valid.ok) {
          rejected.push({ id: sketch.id, label: sketch.label, reason: valid.error.message });
          continue;
        }
        options.push(option);
      }

      const partial = {
        question: request.question,
        criteria: request.criteria,
        options,
        rejected,
        claims: allClaims,
        unsourced: [...new Set(unsourced)],
        unpriced: [...new Set(unpriced)],
        createdAt,
      };

      const set: OptionSet = { ...partial, narrative: narrate(partial) };

      return ok({
        output: set,
        summary:
          `${options.length} option(s) with stated trade-offs` +
          (rejected.length > 0 ? `, ${rejected.length} not analysable` : '') +
          (unsourced.length + unpriced.length > 0
            ? `, ${unsourced.length + unpriced.length} input(s) unestablished`
            : ''),
        // Business asserts nothing itself. The evidence behind its options
        // belongs to Research and travels with the claims that cite it.
        evidence: [],
        usage,
      });
    },

    async health() {
      return {
        component: `agent:${BUSINESS_STRATEGY_ID}`,
        status: 'healthy' as const,
        checkedAt: new Date().toISOString(),
        detail: 'option framing; no tools, no provider required',
      };
    },
  };
}
