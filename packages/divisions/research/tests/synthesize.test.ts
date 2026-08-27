import { test, expect, describe } from 'bun:test';
import {
  claimId, contradictionId, evidenceId, runId,
  type Claim, type Contradiction, type ModelRouter,
} from '@nexus/core';
import { synthesize, writeDeterministicSynthesis } from '../src/synthesize.ts';

const RUN = runId('run_test');
const fact: Claim = {
  id: claimId('cl_f'), statement: 'A states: the population is recovering.',
  status: 'fact', subject: 'seals', supportedBy: [evidenceId('ev_1')],
  contradictedBy: [], derivedFrom: [], assumptions: [], confidence: 1,
  runId: RUN, createdAt: '2026-06-01T12:00:00.000Z',
};
const uncertain: Claim = {
  ...fact, id: claimId('cl_u'), status: 'uncertain', statement: 'No source addresses otters.',
  subject: 'otters', supportedBy: [], uncertaintyReason: 'nothing found', confidence: 0,
};
const conflict: Contradiction = {
  id: contradictionId('ct_1'), subject: 'seals',
  claims: [claimId('cl_f'), claimId('cl_g')],
  reason: 'one claim asserts what the other negates',
  detectedAt: '2026-06-01T12:00:00.000Z',
};

const input = { question: 'are seals recovering?', claims: [fact, uncertain], contradictions: [conflict] };

describe('deterministic synthesis', () => {
  test('separates what sources state from what is derived and what is unknown', () => {
    const text = writeDeterministicSynthesis(input);
    expect(text).toContain('Sources state');
    expect(text).toContain('Not established');
  });

  test('surfaces conflicts, and before the caveats', () => {
    const text = writeDeterministicSynthesis(input);
    expect(text).toContain('Unresolved conflicts');
    expect(text.indexOf('Unresolved conflicts')).toBeLessThan(text.indexOf('Not established'));
  });

  test('says plainly when nothing was established', () => {
    const text = writeDeterministicSynthesis({ question: 'q', claims: [uncertain], contradictions: [] });
    expect(text).toContain('No source in the corpus supported an answer');
  });
});

describe('model-optional synthesis', () => {
  test('with no router it uses the deterministic writer and says so', async () => {
    const out = await synthesize(input);
    expect(out.fromModel).toBe(false);
    expect(out.text).toContain('Sources state');
  });

  test('a failing model layer degrades honestly rather than going silent', async () => {
    const failing: ModelRouter = {
      route: async () => ({ ok: false, error: { code: 'NOT_CONFIGURED', message: 'none' } }),
      generate: async () => ({ ok: false, error: { code: 'NOT_CONFIGURED', message: 'none' } }),
    };
    const out = await synthesize({ ...input, models: failing });
    expect(out.fromModel).toBe(false);
    // The structured answer still renders in full.
    expect(out.text).toContain('Sources state');
  });

  test('uses the router when it works, and names no provider', async () => {
    let sawPolicy: unknown;
    const working: ModelRouter = {
      route: async () => ({ ok: false, error: { code: 'INTERNAL', message: 'unused' } }),
      generate: async (policy) => {
        sawPolicy = policy;
        return {
          ok: true,
          value: {
            model: 'm' as never, provider: 'p' as never,
            content: [{ type: 'text', text: 'Seals appear to be recovering, though sources conflict.' }],
            stopReason: 'stop', usage: { inputTokens: 10, outputTokens: 12 },
          },
        };
      },
    };
    const out = await synthesize({ ...input, models: working });
    expect(out.fromModel).toBe(true);
    expect(out.text).toContain('recovering');
    // A capability policy, never a vendor name (ADR 0004).
    expect(JSON.stringify(sawPolicy)).toContain('requiredCapabilities');
    expect(JSON.stringify(sawPolicy)).not.toContain('groq');
    expect(JSON.stringify(sawPolicy)).not.toContain('google');
  });

  test('an empty model response falls back rather than returning nothing', async () => {
    const empty: ModelRouter = {
      route: async () => ({ ok: false, error: { code: 'INTERNAL', message: 'unused' } }),
      generate: async () => ({
        ok: true,
        value: {
          model: 'm' as never, provider: 'p' as never,
          content: [{ type: 'text', text: '   ' }],
          stopReason: 'stop', usage: { inputTokens: 1, outputTokens: 0 },
        },
      }),
    };
    const out = await synthesize({ ...input, models: empty });
    expect(out.fromModel).toBe(false);
    expect(out.text).toContain('Sources state');
  });
});
