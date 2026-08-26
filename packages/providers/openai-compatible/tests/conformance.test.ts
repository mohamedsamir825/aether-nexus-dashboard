/** The shared Core suite, run against this adapter. */
import { describeProviderConformance } from '@nexus/core/testing';
import { createOpenAICompatibleProvider } from '../src/provider.ts';
import { okResponse, stubFetch, testModels } from './support.ts';

const base = {
  id: 'testcorp',
  displayName: 'TestCorp',
  baseUrl: 'https://example.invalid/v1',
  models: testModels,
};

describeProviderConformance({
  name: 'openai-compatible',
  createConfigured: () =>
    createOpenAICompatibleProvider({
      ...base,
      apiKey: 'test-key-value',
      fetch: stubFetch(() => ({ body: okResponse })),
    }),
  createUnconfigured: () =>
    createOpenAICompatibleProvider({
      ...base,
      fetch: stubFetch(() => ({ body: okResponse })),
    }),
});
