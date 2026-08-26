/** The shared Core suite, run against the Gemini adapter. */
import { describeProviderConformance } from '@nexus/core/testing';
import { createGoogleProvider } from '../src/provider.ts';
import { okResponse, stubFetch, testModels } from './support.ts';

describeProviderConformance({
  name: 'google-gemini',
  createConfigured: () =>
    createGoogleProvider({
      apiKey: 'test-key-value',
      models: testModels,
      fetch: stubFetch(() => ({ body: okResponse })),
    }),
  createUnconfigured: () =>
    createGoogleProvider({
      models: testModels,
      fetch: stubFetch(() => ({ body: okResponse })),
    }),
});
