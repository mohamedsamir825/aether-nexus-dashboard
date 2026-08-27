/**
 * The retrieval boundary.
 *
 * Everything the division learns about the outside world comes through here,
 * which makes this the one place worth being strict about. Two implementations
 * ship: an in-memory one for tests, and one that reads a local directory.
 *
 * Deliberately NOT here: web crawling, browser automation, or any network call.
 * A fragile scraper would prove nothing about the architecture and would make
 * the test suite depend on live pages. A real HTTP retriever is future work
 * behind this same interface.
 */
import { type Result, ok, err, nexusError } from '@nexus/core';
import type { RetrievedContent, SourceRef } from './types.ts';

export interface SourceRetriever {
  /** Which sources look relevant to this query. */
  discover(query: string, limit: number): Promise<Result<readonly SourceRef[]>>;
  /** Fetch one source's content. */
  retrieve(ref: SourceRef): Promise<Result<RetrievedContent>>;
}

/** Stable, dependency-free content hash (FNV-1a, 32-bit, hex). */
export function contentHash(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

/** Lowercased words of 3+ characters. Used for relevance, nothing else. */
export function terms(text: string): string[] {
  return (text.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? []);
}

/** How many of the query's terms a document mentions. Crude and honest. */
export function relevanceScore(query: string, text: string): number {
  const wanted = new Set(terms(query));
  if (wanted.size === 0) return 0;
  const present = new Set(terms(text));
  let hits = 0;
  for (const term of wanted) if (present.has(term)) hits += 1;
  return hits / wanted.size;
}

export interface CorpusDocument {
  readonly source: SourceRef;
  readonly text: string;
}

export interface FixtureRetrieverOptions {
  readonly documents: readonly CorpusDocument[];
  /** Injectable so retrievedAt is deterministic in tests. */
  readonly now?: () => Date;
}

/**
 * In-memory corpus. The retriever the tests use, and the reference for what a
 * retriever must do: score, cap, and stamp provenance.
 */
export function createFixtureRetriever(options: FixtureRetrieverOptions): SourceRetriever {
  const now = options.now ?? (() => new Date());

  return {
    async discover(query, limit) {
      const ranked = options.documents
        .map((doc) => ({ doc, score: relevanceScore(query, `${doc.source.title} ${doc.text}`) }))
        .filter((entry) => entry.score > 0)
        .sort((a, b) => b.score - a.score || a.doc.source.id.localeCompare(b.doc.source.id))
        .slice(0, limit)
        .map((entry) => entry.doc.source);
      return ok(ranked);
    },

    async retrieve(ref) {
      const found = options.documents.find((doc) => doc.source.id === ref.id);
      if (!found) {
        return err(
          nexusError('NOT_FOUND', `source '${ref.id}' is not in the corpus`, {
            details: { sourceId: ref.id },
          }),
        );
      }
      return ok({
        source: found.source,
        text: found.text,
        retrievedAt: now().toISOString(),
        contentHash: contentHash(found.text),
      });
    },
  };
}

export interface FileCorpusOptions {
  /** Directory of .txt / .md files. Read-only; nothing is written. */
  readonly directory: string;
  readonly now?: () => Date;
  /** Injectable filesystem, so this is testable without touching disk. */
  readonly fs?: {
    readdirSync(dir: string): string[];
    readFileSync(path: string, encoding: 'utf8'): string;
  };
  /** Refuse to read anything larger, so one huge file cannot exhaust memory. */
  readonly maxBytes?: number;
}

const DEFAULT_MAX_BYTES = 2_000_000;

/**
 * Reads a local directory as a corpus. Lets the owner point Research at their
 * own documents with no network involved.
 *
 * Filenames are the source ids, and only files directly in the directory are
 * read -- no recursion, no symlink following, no path traversal, because the
 * directory is the trust boundary.
 */
export function createFileCorpusRetriever(options: FileCorpusOptions): SourceRetriever {
  const now = options.now ?? (() => new Date());
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;

  const load = (): Result<CorpusDocument[]> => {
    const fs = options.fs;
    if (!fs) {
      return err(
        nexusError('NOT_CONFIGURED', 'no filesystem was provided to the file corpus retriever'),
      );
    }
    let names: string[];
    try {
      names = fs.readdirSync(options.directory);
    } catch (cause) {
      return err(
        nexusError('NOT_FOUND', `corpus directory is unreadable: ${options.directory}`, { cause }),
      );
    }

    const documents: CorpusDocument[] = [];
    for (const name of names.sort()) {
      if (!/\.(txt|md)$/i.test(name)) continue;
      // A name that tries to climb out of the directory is refused rather than
      // normalised: the directory is the trust boundary.
      if (name.includes('/') || name.includes('..')) continue;
      let text: string;
      try {
        text = fs.readFileSync(`${options.directory}/${name}`, 'utf8');
      } catch {
        continue; // an unreadable file is skipped, never guessed at
      }
      if (text.length > maxBytes) continue;
      documents.push({
        source: { id: name, title: name.replace(/\.(txt|md)$/i, ''), locator: `file:${name}` },
        text,
      });
    }
    return ok(documents);
  };

  return {
    async discover(query, limit) {
      const loaded = load();
      if (!loaded.ok) return loaded;
      return createFixtureRetriever({ documents: loaded.value, now }).discover(query, limit);
    },
    async retrieve(ref) {
      const loaded = load();
      if (!loaded.ok) return loaded;
      return createFixtureRetriever({ documents: loaded.value, now }).retrieve(ref);
    },
  };
}
