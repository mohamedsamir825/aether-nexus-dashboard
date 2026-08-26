/**
 * Deny-by-default permission engine.
 *
 * Policies are consulted in registration order. The first policy to return a
 * decision wins; a policy returning null abstains. If all abstain, access is
 * denied. There is no implicit allow anywhere in this file.
 */
import { type Result, ok, err } from '../result.ts';
import { nexusError } from '../errors.ts';
import type {
  Capability,
  PermissionDecision,
  PermissionEngine,
  PermissionPolicy,
  PermissionRequest,
  Subject,
} from '../contracts/permissions.ts';

export function createPermissionEngine(policies: readonly PermissionPolicy[]): PermissionEngine {
  const check = (request: PermissionRequest): PermissionDecision => {
    for (const policy of policies) {
      const decision = policy.evaluate(request);
      if (decision) return { ...decision, policyId: decision.policyId ?? policy.id };
    }
    return {
      allowed: false,
      reason: 'denied by default: no policy granted this capability',
      policyId: 'default-deny',
    };
  };

  return {
    check,
    require(request) {
      const decision = check(request);
      if (decision.allowed) return ok(undefined);
      return err(
        nexusError('PERMISSION_DENIED', decision.reason, {
          details: {
            subject: `${request.subject.kind}:${request.subject.id}`,
            capability: request.capability,
            ...(request.resource !== undefined ? { resource: request.resource } : {}),
            policyId: decision.policyId,
          },
        }),
      );
    },
  };
}

/** Matches a subject by kind+id, or by kind alone when id is omitted. */
export interface Grant {
  readonly subject: { readonly kind: Subject['kind']; readonly id?: string };
  readonly capabilities: readonly Capability[];
  /** When present, the grant applies only to these resources. */
  readonly resources?: readonly string[];
}

/**
 * The ordinary way to grant access: an explicit allow-list. Abstains rather
 * than denying, so a later policy can still speak.
 */
export function allowListPolicy(id: string, grants: readonly Grant[]): PermissionPolicy {
  return {
    id,
    evaluate(request) {
      for (const grant of grants) {
        if (grant.subject.kind !== request.subject.kind) continue;
        if (grant.subject.id !== undefined && grant.subject.id !== request.subject.id) continue;
        if (!grant.capabilities.includes(request.capability)) continue;
        if (grant.resources && (request.resource === undefined || !grant.resources.includes(request.resource))) {
          continue;
        }
        return {
          allowed: true,
          reason: `granted by '${id}'`,
          policyId: id,
        };
      }
      return null;
    },
  };
}

/** A hard stop that no later policy can override. Evaluated first by convention. */
export function denyListPolicy(id: string, denied: readonly Capability[]): PermissionPolicy {
  return {
    id,
    evaluate(request) {
      if (!denied.includes(request.capability)) return null;
      return {
        allowed: false,
        reason: `capability '${request.capability}' is denied by '${id}'`,
        policyId: id,
      };
    },
  };
}

/** Convenience for guard clauses that already hold a Subject. */
export function requireCapability(
  engine: PermissionEngine,
  subject: Subject,
  capability: Capability,
  resource?: string,
): Result<void> {
  return engine.require({
    subject,
    capability,
    ...(resource !== undefined ? { resource } : {}),
  });
}
