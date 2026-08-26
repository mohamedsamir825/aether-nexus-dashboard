/**
 * Runs the shared conformance suite against the in-repo stub provider.
 *
 * Two purposes: it proves the suite itself works before any real adapter
 * exists, and it holds the stub to the same contract as a real provider — a
 * double that behaves better than production code hides bugs rather than
 * finding them.
 */
import { describeProviderConformance } from '../testing/provider-conformance.ts';
import { stubProvider } from './support/doubles.ts';

const models = [
  { id: 'stub-small', capabilities: ['text'] as const, contextWindow: 32_000, inputCostPer1k: 0 },
  { id: 'stub-large', capabilities: ['text', 'tool_use'] as const, contextWindow: 200_000 },
];

describeProviderConformance({
  name: 'stub',
  createConfigured: () => stubProvider({ id: 'stub', models }),
  createUnconfigured: () => stubProvider({ id: 'stub', models, configured: false }),
});
