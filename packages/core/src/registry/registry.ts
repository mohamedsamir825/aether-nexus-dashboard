/**
 * One generic registry backs every catalogue in NEXUS. Registration is
 * explicit and duplicate ids are rejected -- silently overwriting an agent or
 * tool would make the running system differ from the declared one.
 */
import { type Result, ok, err } from '../result.ts';
import { nexusError } from '../errors.ts';

export interface Registry<T> {
  register(entry: T): Result<T>;
  get(id: string): Result<T>;
  find(id: string): T | undefined;
  has(id: string): boolean;
  list(): readonly T[];
  unregister(id: string): Result<void>;
  readonly size: number;
}

export function createRegistry<T>(
  label: string,
  identify: (entry: T) => string,
): Registry<T> {
  const entries = new Map<string, T>();

  return {
    register(entry) {
      const id = identify(entry);
      if (!id) {
        return err(nexusError('INVALID_INPUT', `${label} entry has an empty id`));
      }
      if (entries.has(id)) {
        return err(
          nexusError('ALREADY_EXISTS', `${label} '${id}' is already registered`, {
            details: { id, label },
          }),
        );
      }
      entries.set(id, entry);
      return ok(entry);
    },
    get(id) {
      const found = entries.get(id);
      if (!found) {
        return err(
          nexusError('NOT_FOUND', `${label} '${id}' is not registered`, {
            details: { id, label, available: [...entries.keys()] },
          }),
        );
      }
      return ok(found);
    },
    find: (id) => entries.get(id),
    has: (id) => entries.has(id),
    list: () => [...entries.values()],
    unregister(id) {
      if (!entries.delete(id)) {
        return err(nexusError('NOT_FOUND', `${label} '${id}' is not registered`, { details: { id } }));
      }
      return ok(undefined);
    },
    get size() {
      return entries.size;
    },
  };
}
