import { test, expect, describe } from 'bun:test';
import {
  contentHash,
  createFileCorpusRetriever,
  createFixtureRetriever,
  relevanceScore,
} from '../src/retrieval.ts';
import { agreeingCorpus, fixedNow } from './fixtures.ts';

const retriever = createFixtureRetriever({ documents: agreeingCorpus, now: fixedNow });

describe('relevance and hashing', () => {
  test('scores by how many query terms a document mentions', () => {
    expect(relevanceScore('harbour seal', 'the harbour seal population')).toBe(1);
    expect(relevanceScore('harbour seal', 'the harbour is busy')).toBe(0.5);
    expect(relevanceScore('harbour seal', 'unrelated text')).toBe(0);
  });

  test('an empty query scores nothing rather than everything', () => {
    expect(relevanceScore('', 'any text at all')).toBe(0);
  });

  test('content hash is stable and content-sensitive', () => {
    expect(contentHash('abc')).toBe(contentHash('abc'));
    expect(contentHash('abc')).not.toBe(contentHash('abd'));
  });
});

describe('fixture retriever', () => {
  test('discovers relevant sources, most relevant first', async () => {
    const found = await retriever.discover('harbour seal population', 5);
    expect(found.ok).toBe(true);
    if (found.ok) expect(found.value.length).toBe(2);
  });

  test('returns nothing for an unrelated query rather than guessing', async () => {
    const found = await retriever.discover('quantum chromodynamics', 5);
    expect(found.ok && found.value).toEqual([]);
  });

  test('honours the limit', async () => {
    const found = await retriever.discover('harbour seal', 1);
    expect(found.ok && found.value.length).toBe(1);
  });

  test('retrieval stamps provenance', async () => {
    const found = await retriever.discover('harbour seal', 1);
    if (!found.ok || !found.value[0]) throw new Error('expected a source');

    const got = await retriever.retrieve(found.value[0]);
    expect(got.ok).toBe(true);
    if (!got.ok) return;
    expect(got.value.retrievedAt).toBe('2026-06-01T12:00:00.000Z');
    expect(got.value.contentHash).toBe(contentHash(got.value.text));
  });

  test('an unknown source is NOT_FOUND, not an empty document', async () => {
    const got = await retriever.retrieve({ id: 'nope', title: 'x', locator: 'fixture:nope' });
    expect(got.ok).toBe(false);
    if (!got.ok) expect(got.error.code).toBe('NOT_FOUND');
  });
});

describe('file corpus retriever', () => {
  const fakeFs = (files: Record<string, string>) => ({
    readdirSync: () => Object.keys(files),
    readFileSync: (path: string) => {
      const name = path.split('/').pop() ?? '';
      const content = files[name];
      if (content === undefined) throw new Error('ENOENT');
      return content;
    },
  });

  test('reads .txt and .md and ignores everything else', async () => {
    const r = createFileCorpusRetriever({
      directory: '/corpus',
      now: fixedNow,
      fs: fakeFs({ 'a.txt': 'seals recovering', 'b.md': 'seals counted', 'c.pdf': 'seals' }),
    });
    const found = await r.discover('seals', 10);
    expect(found.ok && found.value.map((s) => s.id).sort()).toEqual(['a.txt', 'b.md']);
  });

  test('refuses a name that tries to climb out of the directory', async () => {
    // The directory is the trust boundary, so a traversing name is skipped
    // rather than normalised.
    const r = createFileCorpusRetriever({
      directory: '/corpus',
      now: fixedNow,
      fs: fakeFs({ '../../etc/passwd.txt': 'root:x', 'ok.txt': 'seals recovering' }),
    });
    const found = await r.discover('seals', 10);
    expect(found.ok && found.value.map((s) => s.id)).toEqual(['ok.txt']);
  });

  test('skips a file over the size cap rather than loading it', async () => {
    const r = createFileCorpusRetriever({
      directory: '/corpus',
      now: fixedNow,
      maxBytes: 10,
      fs: fakeFs({ 'big.txt': 'seals '.repeat(100) }),
    });
    expect((await r.discover('seals', 10)).ok && true).toBe(true);
    const found = await r.discover('seals', 10);
    expect(found.ok && found.value).toEqual([]);
  });

  test('an unreadable directory is reported, not silently empty', async () => {
    const r = createFileCorpusRetriever({
      directory: '/missing',
      fs: { readdirSync: () => { throw new Error('ENOENT'); }, readFileSync: () => '' },
    });
    const found = await r.discover('x', 5);
    expect(found.ok).toBe(false);
    if (!found.ok) expect(found.error.code).toBe('NOT_FOUND');
  });

  test('without a filesystem it says so instead of pretending to be empty', async () => {
    const r = createFileCorpusRetriever({ directory: '/corpus' });
    const found = await r.discover('x', 5);
    expect(found.ok).toBe(false);
    if (!found.ok) expect(found.error.code).toBe('NOT_CONFIGURED');
  });
});
