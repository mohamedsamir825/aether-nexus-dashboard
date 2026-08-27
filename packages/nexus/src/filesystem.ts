/**
 * The real filesystem, behind the narrow interface the memory store asks for.
 *
 * Every persistence test so far injected an in-memory fake. That is a good
 * default -- the tests stay fast and hermetic -- but it proves the store's
 * logic, not that it works against a disk. A fake `appendFileSync` cannot
 * fail the way a real one does, cannot be interrupted, and cannot disagree with
 * `existsSync` about whether a file is there.
 *
 * So this exists, and so does a test that uses it on a real temporary
 * directory. Without one, "durable" was a claim about a Map.
 *
 * `node:fs` is a builtin: no dependency is added.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { MemoryFileSystem } from '@nexus/core';

/**
 * A filesystem rooted at one directory.
 *
 * The directory is created on first write rather than at construction: a
 * process that opens a store and never writes should not leave a directory
 * behind, and a read-only caller should not need write permission.
 */
export function createNodeFileSystem(): MemoryFileSystem {
  return {
    existsSync: (path: string) => existsSync(path),

    readFileSync: (path: string, encoding: 'utf8') => readFileSync(path, encoding),

    appendFileSync: (path: string, data: string, encoding: 'utf8') => {
      // Created here, not in a constructor, so opening a store is not a write.
      const directory = dirname(path);
      if (!existsSync(directory)) mkdirSync(directory, { recursive: true });
      appendFileSync(path, data, encoding);
    },
  };
}
