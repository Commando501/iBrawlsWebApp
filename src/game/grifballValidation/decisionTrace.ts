import type { TrialFrame } from './runner';
import type { GrifballTeamPlanState } from '../aiGrifballTeamPlan';
import { TACTICS_FIELDS } from '../grifballTacticsConfig';

export interface DecisionTeam {
  team: 'blue' | 'red';
  style: { pressure: number; width: number; confidence: number; observations: number; adapting: boolean;
    aggression: number; patience: number; supportDistance: number; reason: string } | null;
  defense: { pressure: number; lookahead: number; safetyDepth: number } | null;
}

/** Copy the resolved public-observation diagnostics, never the mutable planner memory. */
export function captureDecisionTeams(plan: Pick<GrifballTeamPlanState, 'stylePlans' | 'assignments'>): DecisionTeam[] {
  const assignments = [...plan.assignments.values()];
  return (['blue', 'red'] as const).map(team => {
    const style = plan.stylePlans[team], tuning = assignments.find(a => a.team === team)?.tuning;
    return { team, style: style ? { pressure: style.pressure, width: style.opponentWidth, confidence: style.confidence,
      observations: style.observations, adapting: style.adapting, aggression: style.preferences.aggression,
      patience: style.preferences.patience, supportDistance: style.preferences.supportDistance, reason: style.reason.slice(0, 500) } : null,
      defense: tuning ? { pressure: tuning.defensePressure, lookahead: tuning.defenseLookahead, safetyDepth: tuning.defenseSafetyDepth } : null };
  });
}

/** Diagnostic samples, never substitutes for all-tick invariants or deterministic hashes. */
export interface DecisionFrame {
  frame: TrialFrame;
  revision: number;
  ball: number[];
  /** Absent in older v1 reports; null fields mean the current sample has no resolved plan. */
  teams?: DecisionTeam[];
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
    if (sample.teams !== undefined) {
      if (!Array.isArray(sample.teams) || sample.teams.length > 2) fail();
      const teams = new Set<string>();
      const unit = (n: number) => Number.isFinite(n) && n >= 0 && n <= 1;
      for (const team of sample.teams) {
        if (!team || !['blue', 'red'].includes(team.team) || teams.has(team.team)) fail();
        teams.add(team.team);
        const style = team.style, defense = team.defense;
        if (style !== null && (!style || ![style.pressure, style.width, style.confidence, style.aggression, style.patience, style.supportDistance].every(unit) ||
          !Number.isInteger(style.observations) || style.observations < 0 || style.observations > 24 ||
          typeof style.adapting !== 'boolean' || !text(style.reason, false))) fail();
        if (defense !== null) {
          if (!defense) fail();
          for (const [value, key] of [[defense.pressure, 'defensePressure'], [defense.lookahead, 'defenseLookahead'],
            [defense.safetyDepth, 'defenseSafetyDepth']] as const) {
            const bounds = TACTICS_FIELDS[key];
            if (!Number.isFinite(value) || value < bounds.min || value > bounds.max) fail();
          }
        }
      }
    }
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
