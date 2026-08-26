/**
 * Result is the single failure convention across NEXUS.
 *
 * Core principle 8 ("fail safely when a dependency is unavailable") is only
 * enforceable if failure is part of the type, not an exception that unwinds an
 * agent run. Every boundary that can fail for an expected reason -- a provider
 * being unreachable, a permission being denied, a tool input being invalid --
 * returns a Result. Exceptions remain reserved for genuine programming errors.
 */
import type { NexusError } from './errors.ts';

export type Ok<T> = { readonly ok: true; readonly value: T };
export type Err<E> = { readonly ok: false; readonly error: E };
export type Result<T, E = NexusError> = Ok<T> | Err<E>;

export function ok<T>(value: T): Ok<T> {
  return { ok: true, value };
}

export function err<E>(error: E): Err<E> {
  return { ok: false, error };
}

export function isOk<T, E>(result: Result<T, E>): result is Ok<T> {
  return result.ok;
}

export function isErr<T, E>(result: Result<T, E>): result is Err<E> {
  return !result.ok;
}

/** Unwrap or throw. Use only in tests and at process boundaries. */
export function unwrap<T, E>(result: Result<T, E>): T {
  if (result.ok) return result.value;
  throw new Error(`unwrap() on Err: ${JSON.stringify(result.error)}`);
}
