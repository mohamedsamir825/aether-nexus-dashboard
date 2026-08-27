/**
 * Reconstructing a run tree from the event trail (spec §18.1, ADR 0018).
 *
 * NEXUS delegates by name through the Supervisor, so a single question can
 * become a dozen runs across three divisions. The event stream is the only
 * record of that, and until the Supervisor started stamping lineage into its
 * own payloads the stream was flat: you could see that eleven runs happened and
 * not which called which.
 *
 * This turns those events back into the shape they came from. It is a reader,
 * not a source of truth -- it asserts nothing the Supervisor did not publish.
 *
 * ## It refuses to guess
 *
 * Three things could each make a trace quietly smaller or tidier than reality,
 * and none of them is allowed:
 *
 *   - a run naming a parent that is not in the events becomes a root marked
 *     `orphaned`, never silently reparented and never dropped;
 *   - two unrelated dispatches stay two roots, because sharing a list is not
 *     evidence of a relationship;
 *   - an `agent.task.*` event carrying no readable lineage is counted in
 *     `unreadable` rather than discarded in silence.
 *
 * A trace that looks complete when it is not is worse than an obviously partial
 * one, because it will be believed.
 */
import type { RunId } from '../ids.ts';
import type { NexusEvent } from '../contracts/events.ts';

export type RunStatus =
  /** Started, with no completion in these events. Not "hung" -- just unfinished here. */
  | 'running'
  | 'completed'
  | 'failed';

export interface RunNode {
  readonly runId: RunId;
  readonly agentId: string;
  readonly division?: string;
  readonly role?: string;
  /** Depth as the Supervisor derived it, not as anyone reported it. */
  readonly depth?: number;
  readonly parentRunId?: RunId;
  readonly taskId?: string;
  readonly status: RunStatus;
  readonly durationMs?: number;
  /** Present only on a failed run. */
  readonly errorCode?: string;
  /** Its parent was not among the events supplied. It is shown as a root. */
  readonly orphaned: boolean;
  readonly children: readonly RunNode[];
}

export interface RunTree {
  /** Top-level runs, plus any orphan, in the order they were first seen. */
  readonly roots: readonly RunNode[];
  /** The orphans, also reachable through `roots`. Empty on a complete trail. */
  readonly orphans: readonly RunNode[];
  /** Every run in the tree. */
  readonly total: number;
  /**
   * `agent.task.*` events that carried no readable agent id.
   *
   * Counted rather than dropped: a trail with unreadable rows is a different
   * finding from a trail with none, and only one of them is a clean record.
   */
  readonly unreadable: number;
}

interface Mutable {
  runId: RunId;
  agentId: string;
  division?: string;
  role?: string;
  depth?: number;
  parentRunId?: RunId;
  taskId?: string;
  status: RunStatus;
  durationMs?: number;
  errorCode?: string;
  orphaned: boolean;
  children: Mutable[];
}

const LIFECYCLE = new Set(['agent.task.started', 'agent.task.completed', 'agent.task.failed']);

function str(payload: Record<string, unknown>, key: string): string | undefined {
  const value = payload[key];
  return typeof value === 'string' && value !== '' ? value : undefined;
}

function num(payload: Record<string, unknown>, key: string): number | undefined {
  const value = payload[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

export function buildRunTree(events: readonly NexusEvent[]): RunTree {
  const byRun = new Map<RunId, Mutable>();
  const order: RunId[] = [];
  let unreadable = 0;

  for (const event of events) {
    // A denied dispatch never became a run, so it is deliberately not a node:
    // the tree shows what executed, and an attempt that was refused belongs to
    // the permission trail instead.
    if (!LIFECYCLE.has(event.type)) continue;

    const payload = event.payload;
    if (typeof payload !== 'object' || payload === null) {
      unreadable += 1;
      continue;
    }
    const fields = payload as Record<string, unknown>;
    const agentId = str(fields, 'agentId');
    if (event.runId === undefined || agentId === undefined) {
      unreadable += 1;
      continue;
    }

    // Built from whichever event arrives first. `started` and the terminal
    // events carry the same lineage, so nothing has to be inferred from one
    // half of a pair -- a trail missing its `started` still places the run.
    let node = byRun.get(event.runId);
    if (node === undefined) {
      node = { runId: event.runId, agentId, status: 'running', orphaned: false, children: [] };
      byRun.set(event.runId, node);
      order.push(event.runId);
    }

    const division = str(fields, 'division');
    const role = str(fields, 'role');
    const taskId = str(fields, 'taskId');
    const depth = num(fields, 'depth');
    const parentRunId = str(fields, 'parentRunId');
    if (division !== undefined) node.division = division;
    if (role !== undefined) node.role = role;
    if (taskId !== undefined) node.taskId = taskId;
    if (depth !== undefined) node.depth = depth;
    if (parentRunId !== undefined) node.parentRunId = parentRunId as RunId;

    if (event.type === 'agent.task.completed' || event.type === 'agent.task.failed') {
      node.status = event.type === 'agent.task.failed' ? 'failed' : 'completed';
      const durationMs = num(fields, 'durationMs');
      if (durationMs !== undefined) node.durationMs = durationMs;
      const errorCode = str(fields, 'errorCode');
      // Only a failure carries one, and a missing code stays missing rather
      // than becoming an empty string that reads like a real value.
      if (errorCode !== undefined) node.errorCode = errorCode;
    }
  }

  const roots: Mutable[] = [];
  const orphans: Mutable[] = [];

  for (const runId of order) {
    const node = byRun.get(runId) as Mutable;
    if (node.parentRunId === undefined) {
      roots.push(node);
      continue;
    }
    const parent = byRun.get(node.parentRunId);
    if (parent === undefined) {
      // Named a parent nobody published. Shown, and shown as incomplete.
      node.orphaned = true;
      roots.push(node);
      orphans.push(node);
      continue;
    }
    parent.children.push(node);
  }

  const freeze = (node: Mutable): RunNode => ({
    ...node,
    children: node.children.map(freeze),
  });

  return {
    roots: roots.map(freeze),
    orphans: orphans.map(freeze),
    total: byRun.size,
    unreadable,
  };
}
