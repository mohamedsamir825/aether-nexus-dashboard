/**
 * Synthesis: structured research state -> prose.
 *
 * The direction is one-way and load-bearing. Claims are never derived from
 * prose; prose is derived from claims. If the two ever disagree the claims are
 * right, which is why the deterministic writer below is the default and a model
 * is only ever an alternative renderer of the same facts.
 *
 * The model is optional by design. Every stage before this one runs without a
 * provider, so with no API key configured the structured result is complete and
 * only the narrative falls back -- and says so, rather than going silent.
 */
import {
  type Claim,
  type Contradiction,
  type ModelRouter,
  type ModelSelectionPolicy,
  DEFAULT_TASK_CLASSES,
} from '@nexus/core';

export interface SynthesisInput {
  readonly question: string;
  readonly claims: readonly Claim[];
  readonly contradictions: readonly Contradiction[];
}

export interface SynthesisOutput {
  readonly text: string;
  readonly fromModel: boolean;
}

/**
 * Renders the claims as prose with no model involved. Plain by design: its job
 * is to be true, and a reader who wants elegance can read the claims.
 */
export function writeDeterministicSynthesis(input: SynthesisInput): string {
  const facts = input.claims.filter((c) => c.status === 'fact');
  const inferences = input.claims.filter((c) => c.status === 'inference');
  const uncertain = input.claims.filter((c) => c.status === 'uncertain');

  const lines: string[] = [`Question: ${input.question}`, ''];

  if (facts.length > 0) {
    lines.push(`Sources state (${facts.length}):`);
    for (const claim of facts) lines.push(`  - ${claim.statement}`);
    lines.push('');
  }

  if (inferences.length > 0) {
    lines.push(`Derived (${inferences.length}):`);
    for (const claim of inferences) {
      lines.push(`  - ${claim.statement} [inference, confidence ${claim.confidence.toFixed(2)}]`);
    }
    lines.push('');
  }

  if (input.contradictions.length > 0) {
    // Surfaced before the caveats, because a conflict is the most important
    // thing a reader can be told and must not be buried.
    lines.push(`Unresolved conflicts (${input.contradictions.length}):`);
    for (const contradiction of input.contradictions) {
      lines.push(`  - on "${contradiction.subject}": ${contradiction.reason}`);
    }
    lines.push('');
  }

  if (uncertain.length > 0) {
    lines.push(`Not established (${uncertain.length}):`);
    for (const claim of uncertain) {
      lines.push(`  - ${claim.statement} (${claim.uncertaintyReason ?? 'no reason recorded'})`);
    }
    lines.push('');
  }

  if (facts.length === 0 && inferences.length === 0) {
    lines.push('No source in the corpus supported an answer to this question.');
  }

  return lines.join('\n').trimEnd();
}

export interface SynthesizeOptions extends SynthesisInput {
  /** Omitted, or unable to serve, means the deterministic writer is used. */
  readonly models?: ModelRouter;
  readonly policy?: ModelSelectionPolicy;
}

export async function synthesize(options: SynthesizeOptions): Promise<SynthesisOutput> {
  const deterministic = writeDeterministicSynthesis(options);
  if (!options.models) return { text: deterministic, fromModel: false };

  // A task class, never a provider name (ADR 0004, ADR 0011).
  const policy = options.policy ?? DEFAULT_TASK_CLASSES.text;

  const generated = await options.models.generate(policy, {
    system:
      'You rewrite a structured research summary as prose. Use ONLY the statements ' +
      'given. Do not add facts, sources, numbers or conclusions. Preserve every ' +
      'conflict explicitly. If something is marked uncertain, keep it uncertain.',
    messages: [{ role: 'user', content: [{ type: 'text', text: deterministic }] }],
    maxOutputTokens: 800,
  });

  if (!generated.ok) {
    // The honest fallback: the structured answer stands, and the reader is told
    // the narrative was not model-written rather than being shown nothing.
    return { text: deterministic, fromModel: false };
  }

  const text = generated.value.content
    .filter((part): part is Extract<typeof part, { type: 'text' }> => part.type === 'text')
    .map((part) => part.text)
    .join('')
    .trim();

  if (text === '') return { text: deterministic, fromModel: false };
  return { text, fromModel: true };
}
