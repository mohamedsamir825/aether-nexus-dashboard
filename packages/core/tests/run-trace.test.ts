/**
 * Reconstructing the run tree, and refusing to reconstruct more than there is.
 *
 * These tests are mostly about the second half. Building a tree from
 * well-formed events is easy; the failures that matter are the ones where a
 * trace comes out looking tidier than the trail it was built from.
 */
import { test, expect, describe } from 'bun:test';
import { buildRunTree, type RunNode } from '../src/runtime/run-trace.ts';
import type { NexusEvent } from '../src/contracts/events.ts';
import { runId as toRunId } from '../src/ids.ts';

const supervisor = { kind: 'supervisor' as const, id: 'core' };
let seq = 0;

function evt(
  type: string,
  runId: string,
  payload: Record<string, unknown>,
): NexusEvent {
  seq += 1;
  return {
    id: `evt_${seq}`,
    type,
    occurredAt: '2026-01-01T00:00:00.000Z',
    source: supervisor,
    runId: toRunId(runId),
    payload,
  };
}

/** started + completed for one run. */
const ran = (
  runId: string,
  agentId: string,
  over: Record<string, unknown> = {},
): NexusEvent[] => [
  evt('agent.task.started', runId, { agentId, depth: 0, taskId: 't', ...over }),
  evt('agent.task.completed', runId, { agentId, depth: 0, taskId: 't', durationMs: 5, ...over }),
];

const chain = (): NexusEvent[] => [
  ...ran('run_top', 'business.strategy', { division: 'business', role: 'strategy', depth: 0 }),
  ...ran('run_mid', 'finance.fpa', {
    division: 'finance',
    role: 'fpa',
    depth: 1,
    parentRunId: 'run_top',
  }),
  ...ran('run_leaf', 'research.analyst', {
    division: 'research',
    role: 'analyst',
    depth: 2,
    parentRunId: 'run_mid',
  }),
];

const idsOf = (nodes: readonly RunNode[]): string[] => nodes.map((n) => String(n.runId));

describe('a well-formed trail reconstructs exactly', () => {
  test('three levels, in the right shape', () => {
    const tree = buildRunTree(chain());

    expect(tree.total).toBe(3);
    expect(tree.unreadable).toBe(0);
    expect(idsOf(tree.roots)).toEqual(['run_top']);

    const top = tree.roots[0] as RunNode;
    expect(top.division).toBe('business');
    expect(top.role).toBe('strategy');
    expect(top.status).toBe('completed');
    expect(top.durationMs).toBe(5);

    const mid = top.children[0] as RunNode;
    expect(String(mid.runId)).toBe('run_mid');
    expect(String(mid.parentRunId)).toBe('run_top');
    expect(mid.depth).toBe(1);

    const leaf = mid.children[0] as RunNode;
    expect(String(leaf.runId)).toBe('run_leaf');
    expect(leaf.agentId).toBe('research.analyst');
    // Nested under mid, not flattened onto the root.
    expect(top.children).toHaveLength(1);
  });

  test('a run with no completion is `running`, not assumed finished', () => {
    const events = [
      evt('agent.task.started', 'run_a', { agentId: 'a', depth: 0 }),
    ];
    const node = buildRunTree(events).roots[0] as RunNode;
    expect(node.status).toBe('running');
    expect(node.durationMs).toBeUndefined();
  });

  test('a failed run carries its error code, and only a failed one does', () => {
    const failed = [
      evt('agent.task.started', 'run_f', { agentId: 'f', depth: 0 }),
      evt('agent.task.failed', 'run_f', { agentId: 'f', depth: 0, errorCode: 'BUDGET_EXCEEDED' }),
    ];
    const node = buildRunTree(failed).roots[0] as RunNode;
    expect(node.status).toBe('failed');
    expect(node.errorCode).toBe('BUDGET_EXCEEDED');

    const okNode = buildRunTree(ran('run_ok', 'ok')).roots[0] as RunNode;
    expect(okNode.errorCode).toBeUndefined();
  });

  test('a terminal event alone still places the run', () => {
    // A trail that lost its `started` is incomplete, but the run demonstrably
    // happened. Dropping it would make the trace smaller than reality.
    const events = [
      evt('agent.task.completed', 'run_x', { agentId: 'x', depth: 1, parentRunId: 'run_p' }),
      ...ran('run_p', 'p'),
    ];
    const tree = buildRunTree(events);
    expect(tree.total).toBe(2);
    expect(idsOf(tree.roots)).toEqual(['run_p']);
    expect(idsOf((tree.roots[0] as RunNode).children)).toEqual(['run_x']);
  });
});

describe('it refuses to invent structure', () => {
  test('a run naming an absent parent is a MARKED root, not reparented', () => {
    // The failure this exists to prevent: quietly hanging an orphan off
    // whatever root happens to be nearby produces a tree that reads as
    // complete and is wrong about who called whom.
    const events = [
      ...ran('run_root', 'root'),
      ...ran('run_lost', 'lost', { depth: 3, parentRunId: 'run_never_published' }),
    ];
    const tree = buildRunTree(events);

    expect(idsOf(tree.orphans)).toEqual(['run_lost']);
    expect(idsOf(tree.roots)).toEqual(['run_root', 'run_lost']);
    expect((tree.roots[0] as RunNode).children).toHaveLength(0);

    const lost = tree.orphans[0] as RunNode;
    expect(lost.orphaned).toBe(true);
    // It still says who it thought its parent was — that is the lead a reader
    // needs, and erasing it would hide the gap rather than report it.
    expect(String(lost.parentRunId)).toBe('run_never_published');
    // And it is not dropped.
    expect(tree.total).toBe(2);
  });

  test('two unrelated dispatches stay two roots', () => {
    // Sharing a list is not evidence of a relationship.
    const tree = buildRunTree([...ran('run_1', 'a'), ...ran('run_2', 'b')]);
    expect(idsOf(tree.roots)).toEqual(['run_1', 'run_2']);
    expect(tree.orphans).toHaveLength(0);
    expect(tree.roots.every((r) => r.children.length === 0)).toBe(true);
  });

  test('an unreadable lifecycle event is COUNTED, never silently dropped', () => {
    const events = [
      ...ran('run_ok', 'ok'),
      // No agentId: nothing places this run, and pretending otherwise would
      // invent an agent.
      evt('agent.task.started', 'run_blank', { depth: 0 }),
      { ...evt('agent.task.started', 'run_null', {}), payload: null } as unknown as NexusEvent,
    ];
    const tree = buildRunTree(events);

    expect(tree.total).toBe(1);
    expect(tree.unreadable).toBe(2);
    // A caller reading only `total` would see a clean single-run trace; the
    // unreadable count is what stops that being the whole story.
    expect(tree.unreadable).toBeGreaterThan(0);
  });

  test('an event with no runId cannot be placed and is counted', () => {
    const orphanEvent: NexusEvent = {
      id: 'evt_x',
      type: 'agent.task.started',
      occurredAt: '2026-01-01T00:00:00.000Z',
      source: supervisor,
      payload: { agentId: 'a', depth: 0 },
    };
    const tree = buildRunTree([orphanEvent]);
    expect(tree.total).toBe(0);
    expect(tree.unreadable).toBe(1);
  });
});

describe('it reads only what it should', () => {
  test('non-lifecycle events change nothing', () => {
    const noise = [
      evt('tool.execution.started', 'run_top', { toolId: 'x' }),
      evt('tool.execution.completed', 'run_top', { toolId: 'x' }),
      evt('memory.written', 'run_top', { agentId: 'business.strategy' }),
    ];
    const withNoise = buildRunTree([...chain(), ...noise]);
    const without = buildRunTree(chain());

    expect(withNoise.total).toBe(without.total);
    expect(withNoise.unreadable).toBe(0);
    expect(idsOf(withNoise.roots)).toEqual(idsOf(without.roots));
  });

  test('a denied dispatch is not a run', () => {
    // It carries lineage so the permission trail is legible, but it never
    // executed. A tree showing it would report work that did not happen.
    const events = [
      ...ran('run_top', 'top'),
      evt('agent.dispatch.denied', 'run_top', {
        agentId: 'forbidden',
        division: 'finance',
        depth: 1,
        parentRunId: 'run_top',
      }),
    ];
    const tree = buildRunTree(events);
    expect(tree.total).toBe(1);
    expect(tree.unreadable).toBe(0);
    expect((tree.roots[0] as RunNode).children).toHaveLength(0);
  });

  test('an empty trail is an empty tree, not an error', () => {
    const tree = buildRunTree([]);
    expect(tree).toEqual({ roots: [], orphans: [], total: 0, unreadable: 0 });
  });
});
