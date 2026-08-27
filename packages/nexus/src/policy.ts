/**
 * The policy half of §23's "registration and policy".
 *
 * Until now every test built its own grants inline. Three harnesses, three
 * slightly different policies, and none of them the one a real deployment would
 * run -- so the tests proved each division works under *a* policy rather than
 * under *the* policy. This file is the one a deployment runs, and the tests now
 * run it too.
 *
 * ## Grants are per division, not global
 *
 * A single "agent" grant covering every capability would let Business execute
 * Finance's tool and Research read Finance's memory. Deny-by-default means
 * nothing, in practice, if the default grant is generous -- so each division's
 * agents get exactly what that division declared and nothing else.
 *
 * `installDivision` already refuses a division whose agents need more than the
 * descriptor declares, so these lists cannot silently drift below what the code
 * actually requires: if they do, installation fails.
 */
import {
  DISPATCH_CAPABILITY,
  agentId,
  allowListPolicy,
  type PermissionPolicy,
} from '@nexus/core';

/**
 * Grants scoped to one agent id.
 *
 * `allowListPolicy` matches on subject kind and, when given, id -- so naming
 * the agent is what keeps one division's grant from becoming every division's.
 */
function forAgent(name: string, id: string, capabilities: readonly string[]): PermissionPolicy {
  return allowListPolicy(name, [
    { subject: { kind: 'agent', id: agentId(id) }, capabilities: [...capabilities] },
  ]);
}

/** The user may ask the Supervisor to dispatch. Nothing else. */
export const systemPolicy: PermissionPolicy = allowListPolicy('nexus.system', [
  { subject: { kind: 'system' }, capabilities: [DISPATCH_CAPABILITY] },
  // The Supervisor acts as itself when an agent delegates (ADR 0007).
  { subject: { kind: 'supervisor' }, capabilities: [DISPATCH_CAPABILITY] },
]);

/** Retrieval, and its own memory scope. No finance capability of any kind. */
export const researchPolicy: PermissionPolicy = forAgent(
  'nexus.research',
  'research.analyst',
  [DISPATCH_CAPABILITY, 'tool:execute', 'research:retrieve', 'memory:read', 'memory:write'],
);

/**
 * Actuals, its own memory scope, and dispatch so it can delegate to Research.
 *
 * Note what is absent: `research:retrieve`. Finance cannot read a corpus
 * itself. Market inputs reach it only through a delegated Research run, which
 * is §4.3's requirement expressed as a missing grant rather than as a comment.
 */
export const financePolicy: PermissionPolicy = forAgent(
  'nexus.finance',
  'finance.fpa',
  [DISPATCH_CAPABILITY, 'tool:execute', 'finance:actuals', 'memory:read', 'memory:write'],
);

/**
 * Delegation and nothing else.
 *
 * Business holds no tool capability, no memory scope and no retrieval. Every
 * input it has comes from another division's run, which is §5's boundary as a
 * permission set: it *cannot* price or retrieve, rather than being asked not to.
 */
export const businessPolicy: PermissionPolicy = forAgent('nexus.business', 'business.strategy', [
  DISPATCH_CAPABILITY,
]);

/**
 * The standard policy set, in evaluation order.
 *
 * Order matters only for abstention: these are all allow-lists that abstain on
 * subjects they do not name, so the effective rule is the union -- and a
 * capability nobody grants stays denied.
 */
export const NEXUS_POLICIES: readonly PermissionPolicy[] = [
  systemPolicy,
  researchPolicy,
  financePolicy,
  businessPolicy,
];
