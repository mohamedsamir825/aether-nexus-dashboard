/**
 * Permissions (core principle 4: explicit permissions).
 *
 * The engine is deny-by-default. A policy may return `null` to mean "no
 * opinion"; if every policy abstains, the request is denied. Nothing in NEXUS
 * gains access by omission.
 */
import type { Result } from '../result.ts';
import type { AgentId, SkillId, ToolId, DivisionId } from '../ids.ts';

/**
 * A capability is a coarse, declarable grant, e.g.
 *   'tool:execute', 'memory:read', 'memory:write', 'model:generate', 'net:fetch'
 * Descriptors declare what they require; policies decide who holds them.
 */
export type Capability = string;

export type SubjectKind = 'agent' | 'skill' | 'tool' | 'supervisor' | 'system';

export interface Subject {
  readonly kind: SubjectKind;
  readonly id: AgentId | SkillId | ToolId | string;
  readonly division?: DivisionId;
}

export interface PermissionRequest {
  readonly subject: Subject;
  /** The capability being exercised. */
  readonly capability: Capability;
  /** What it is being exercised against, e.g. a ToolId or a memory scope key. */
  readonly resource?: string;
  readonly context?: Readonly<Record<string, unknown>>;
}

export interface PermissionDecision {
  readonly allowed: boolean;
  /** Always populated: a denial that cannot explain itself is a bug. */
  readonly reason: string;
  readonly policyId?: string;
}

/** Returns null to abstain. Policies are evaluated in registration order. */
export interface PermissionPolicy {
  readonly id: string;
  evaluate(request: PermissionRequest): PermissionDecision | null;
}

export interface PermissionEngine {
  check(request: PermissionRequest): PermissionDecision;
  /** Same as check(), shaped for guard clauses. */
  require(request: PermissionRequest): Result<void>;
}
