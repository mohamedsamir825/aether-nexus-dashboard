/**
 * A closed set of error codes. Callers branch on `code`, never on message text.
 * New codes are added deliberately; this list is part of the Core contract.
 */
export type NexusErrorCode =
  | 'INVALID_INPUT'
  | 'NOT_FOUND'
  | 'ALREADY_EXISTS'
  | 'PERMISSION_DENIED'
  | 'NOT_CONFIGURED'
  | 'PROVIDER_UNAVAILABLE'
  | 'UNSUPPORTED'
  | 'TIMEOUT'
  | 'CANCELLED'
  | 'INTERNAL';

export interface NexusError {
  readonly code: NexusErrorCode;
  readonly message: string;
  /** Structured, non-secret context for logs and tests. */
  readonly details?: Readonly<Record<string, unknown>>;
  readonly cause?: unknown;
}

export function nexusError(
  code: NexusErrorCode,
  message: string,
  options?: { details?: Record<string, unknown>; cause?: unknown },
): NexusError {
  return {
    code,
    message,
    ...(options?.details ? { details: options.details } : {}),
    ...(options?.cause !== undefined ? { cause: options.cause } : {}),
  };
}

/** Normalises a thrown value into a NexusError without losing the original. */
export function fromUnknown(cause: unknown, code: NexusErrorCode = 'INTERNAL'): NexusError {
  const message = cause instanceof Error ? cause.message : String(cause);
  return nexusError(code, message, { cause });
}
