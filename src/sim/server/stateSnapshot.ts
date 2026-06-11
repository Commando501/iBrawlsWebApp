/**
 * Render-ready snapshot of one world's SimState — the payload behind the protocol's
 * STATE opcode and the dashboard's Watch tab. Plain JSON-serializable data only:
 * positions, vitals, weapon, ball, and score, plus the arena bounds so a top-down
 * viewer can scale without knowing map internals. Intentionally NOT the full
 * SimState (settings/map/rng stay server-side).
 */

import { type SimState } from '../simState';
import { GRIFBALL_HALF_X, GRIFBALL_HALF_Z } from '../../game/grifballMaps';

export interface CombatantSnapshot {
  id: string;
  team: string;
  x: number;
  y: number;
  z: number;
  yaw: number;
  hp: number;
  maxHp: number;
  alive: boolean;
  weapon: string;
  hasBall: boolean;
  respawnTimer: number;
}

export interface StateSnapshot {
  tick: number;
  mode: string;
  phase: string;
  phaseTimer: number;
  /** Goals in grifball; the kill target in combat (goalTarget is reused). */
  killTarget: number;
  winningTeam: string | null;
  scores: Record<string, { kills: number; goals: number }>;
  arena: { halfX: number; halfZ: number };
  ball: { x: number; z: number; state: string; holderId: string | null } | null;
  combatants: CombatantSnapshot[];
}

export function buildStateSnapshot(state: SimState): StateSnapshot {
  const scores: StateSnapshot['scores'] = {};
  for (const [team, tally] of Object.entries(state.scores)) {
    scores[team] = { kills: tally.kills ?? 0, goals: tally.goals ?? 0 };
  }
  const ball = state.mode === 'grifball'
    ? {
        x: state.match.ball.pos.x,
        z: state.match.ball.pos.z,
        state: state.match.ball.state,
        holderId: state.match.ball.holderId ?? null,
      }
    : null;
  return {
    tick: state.tick,
    mode: state.mode,
    phase: state.match.phase,
    phaseTimer: state.match.phaseTimer,
    killTarget: state.match.goalTarget,
    winningTeam: state.match.winningTeam ?? null,
    scores,
    arena: { halfX: GRIFBALL_HALF_X, halfZ: GRIFBALL_HALF_Z },
    ball,
    combatants: state.combatants.map((c) => ({
      id: c.id,
      team: c.team,
      x: c.pos.x,
      y: c.pos.y,
      z: c.pos.z,
      yaw: c.yaw,
      hp: c.hp,
      maxHp: c.maxHp,
      alive: c.alive,
      weapon: c.weapon,
      hasBall: c.hasBall,
      respawnTimer: c.respawnTimer,
    })),
  };
}
