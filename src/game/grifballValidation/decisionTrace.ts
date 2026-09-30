import type { TrialFrame } from './runner';

/** Diagnostic samples, never substitutes for all-tick invariants or deterministic hashes. */
export interface DecisionFrame {
  frame: TrialFrame;
  revision: number;
  ball: number[];
  actors: {
    id: string; team: string; position: number[]; velocity: number[]; hp: number;
    weapon: string; weaponState: string | null; aiState: string | null;
    plannedTargetId: string | null; pressureTargetId: string | null; lungeTargetId: string | null;
    role: string | null; reason: string | null; destination: number[] | null;
    route: string | null; runner: string | null; defense: string | null; tanking: string | null;
    pickup: boolean;
  }[];
}
export interface DecisionTrace { version: 1; intervalTicks: 120; droppedFrames: number; frames: DecisionFrame[] }
export const DECISION_FRAME_LIMIT = 64;
const OPENING_FRAMES = 8;

/** Keep the opening and most recent context; removal counts are never reset. */
export function retainDecisionTrace(trace: DecisionTrace, count = DECISION_FRAME_LIMIT): DecisionTrace {
  const keep = Math.max(0, Math.min(count, trace.frames.length));
  const opening = Math.min(OPENING_FRAMES, Math.floor(keep / 2));
  return { ...trace, frames: keep === trace.frames.length ? trace.frames
    : [...trace.frames.slice(0, opening), ...(keep > opening ? trace.frames.slice(-(keep - opening)) : [])],
    droppedFrames: trace.droppedFrames + trace.frames.length - keep };
}

export function assertDecisionTrace(value: DecisionTrace, endTick: number): void {
  const fail = () => { throw new Error('Malformed decision trace'); };
  const text = (v: unknown, nullable = true) => nullable && v === null || typeof v === 'string' && v.length <= 500;
  const vector = (v: unknown, size: number) => Array.isArray(v) && v.length === size && v.every(Number.isFinite);
  if (!value || value.version !== 1 || value.intervalTicks !== 120 || !Number.isInteger(value.droppedFrames) ||
    value.droppedFrames < 0 || !Array.isArray(value.frames) || value.frames.length > DECISION_FRAME_LIMIT) fail();
  let previous = -1;
  for (const sample of value.frames) {
    if (!sample || !sample.frame || !Number.isInteger(sample.frame.tick) || sample.frame.tick <= previous || sample.frame.tick > endTick ||
      !Number.isInteger(sample.revision) || sample.revision < 0 || !vector(sample.ball, 3) ||
      !Array.isArray(sample.actors) || sample.actors.length > 32) fail();
    previous = sample.frame.tick;
    const ids = new Set<string>();
    for (const actor of sample.actors) {
      if (!actor || !text(actor.id, false) || ids.has(actor.id) || !['blue', 'red'].includes(actor.team) ||
        !vector(actor.position, 3) || !vector(actor.velocity, 3) || !Number.isFinite(actor.hp) ||
        !(actor.destination === null || vector(actor.destination, 2)) || typeof actor.pickup !== 'boolean' ||
        !text(actor.weapon, false) || [actor.weaponState, actor.aiState, actor.plannedTargetId, actor.pressureTargetId, actor.lungeTargetId, actor.role, actor.reason,
          actor.route, actor.runner, actor.defense, actor.tanking].some(v => !text(v))) fail();
      ids.add(actor.id);
    }
  }
}
