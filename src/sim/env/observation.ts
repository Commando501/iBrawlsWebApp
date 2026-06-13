/**
 * Ego-centric, fixed-width observation encoding. `encodeObservation` writes one agent's
 * view directly into a caller-owned `Float32Array` at `offset` (no per-step allocation),
 * so the vec-env can fill a big `[numEnvs × numAgents × OBS_DIM]` buffer in place.
 *
 * Everything spatial is expressed in the agent's **ego frame** (forward / right axes from
 * its yaw) and normalized, so the policy is translation- and rotation-invariant; the two
 * goal vectors anchor absolute field position. Teammate / opponent slots are fixed-size
 * with presence masks so a single shared policy handles <4v4 rosters.
 *
 * `OBS_DIM` and `OBS_LAYOUT` are the single source of truth for the observation shape and
 * are mirrored on the Python side via the handshake header (see plan §D / `spaces.py`).
 */

import { type SimState, type SimCombatant } from '../simState';
import { forwardDir, rightDir } from '../physics';
import { enemyGoalForTeam, ownGoalForTeam } from '../../game/aiGrifballRoles';
import { GRIFBALL_HALF_X, GRIFBALL_HALF_Z } from '../../game/grifballMaps';
import { DOMAIN_RANDOMIZABLE_KEYS } from './randomize';
import { DEFAULT_ADMIN_SETTINGS } from '../../settings/gameplaySettings';

/**
 * Mechanics-aware block: the live-tunable dynamics keys the policy should condition on, so
 * one brain adapts to the current balance (and to per-episode domain randomization). Encoded
 * as a deviation from nominal: `value / default - 1` (0 = nominal, +0.15 = +15%).
 */
export const MECHANICS_OBS_KEYS = DOMAIN_RANDOMIZABLE_KEYS;
const MECHANICS_REF: number[] = MECHANICS_OBS_KEYS.map((k) => {
  const v = DEFAULT_ADMIN_SETTINGS[k];
  return typeof v === 'number' && v !== 0 ? v : 1;
});

/** Max combatants per team the observation reserves slots for. */
export const MAX_TEAM_SIZE = 4;
export const MAX_TEAMMATES = MAX_TEAM_SIZE - 1; // excludes self
export const MAX_OPPONENTS = MAX_TEAM_SIZE;

/** Spatial / kinematic normalizers (roughly map raw units into [-1, 1]). */
const POS_SCALE = Math.hypot(GRIFBALL_HALF_X, GRIFBALL_HALF_Z); // arena half-diagonal
const VEL_SCALE = 24; // ~dash speed (dashDistance/dashDuration)

/** Per-other-combatant slot width (rel pos, rel vel, hp, weapon one-hot, has-ball, mask). */
const OTHER_SLOT = 2 + 2 + 1 + 3 + 1 + 1; // = 10

interface FieldSpec {
  name: string;
  size: number;
}

/** Declarative layout — also exported (as offsets) for cross-language parity tests. */
export const OBS_FIELDS: FieldSpec[] = [
  { name: 'self_to_own_goal', size: 2 },
  { name: 'self_to_enemy_goal', size: 2 },
  { name: 'self_vel', size: 2 },
  { name: 'self_yaw_sincos', size: 2 },
  { name: 'self_hp_frac', size: 1 },
  { name: 'self_weapon_onehot', size: 3 },
  { name: 'self_attack_cooldown', size: 1 },
  { name: 'self_has_ball', size: 1 },
  { name: 'self_dash_ready', size: 1 },
  { name: 'self_is_jumping', size: 1 },
  { name: 'self_is_crouching', size: 1 },
  { name: 'self_invuln', size: 1 },
  { name: 'self_pass_charge', size: 1 },       // grifball: throw charge wound up
  { name: 'self_hammerjump_window', size: 1 }, // 1 while a hammer-jump can be triggered
  { name: 'self_weapon_ready_lockout', size: 1 }, // post-swap/spawn attack lockout
  { name: 'ball_rel_pos', size: 2 },
  { name: 'ball_rel_vel', size: 2 },
  { name: 'ball_state_onehot', size: 4 },
  { name: 'ball_holder_rel', size: 4 }, // self / team / enemy / none
  { name: 'teammates', size: MAX_TEAMMATES * OTHER_SLOT },
  { name: 'opponents', size: MAX_OPPONENTS * OTHER_SLOT },
  { name: 'ctx_score_diff', size: 1 },
  { name: 'ctx_phase_onehot', size: 4 },
  { name: 'ctx_phase_timer', size: 1 },
  { name: 'ctx_clock', size: 1 },
  { name: 'mechanics', size: MECHANICS_OBS_KEYS.length },
];

/** Map of field name -> { offset, size } within a single agent observation. */
export const OBS_LAYOUT: Record<string, { offset: number; size: number }> = (() => {
  const layout: Record<string, { offset: number; size: number }> = {};
  let off = 0;
  for (const f of OBS_FIELDS) {
    layout[f.name] = { offset: off, size: f.size };
    off += f.size;
  }
  return layout;
})();

/** Total observation width per agent. */
export const OBS_DIM = OBS_FIELDS.reduce((n, f) => n + f.size, 0);
export const OBS_DIM_V1 = OBS_DIM;
export const COMBAT_PRESSURE_SIZE = 12;
export const OBS_FIELDS_V2: FieldSpec[] = [
  ...OBS_FIELDS,
  { name: 'combat_pressure', size: COMBAT_PRESSURE_SIZE },
];
export const OBS_LAYOUT_V2: Record<string, { offset: number; size: number }> = (() => {
  const layout: Record<string, { offset: number; size: number }> = {};
  let off = 0;
  for (const f of OBS_FIELDS_V2) {
    layout[f.name] = { offset: off, size: f.size };
    off += f.size;
  }
  return layout;
})();
export const OBS_DIM_V2 = OBS_FIELDS_V2.reduce((n, f) => n + f.size, 0);

export function obsFieldsForVersion(version = 1): FieldSpec[] {
  return version >= 2 ? OBS_FIELDS_V2 : OBS_FIELDS;
}

export function obsLayoutForVersion(version = 1): Record<string, { offset: number; size: number }> {
  return version >= 2 ? OBS_LAYOUT_V2 : OBS_LAYOUT;
}

export function obsDimForVersion(version = 1): number {
  return version >= 2 ? OBS_DIM_V2 : OBS_DIM;
}

function weaponOneHot(c: SimCombatant, out: Float32Array, at: number): void {
  out[at] = c.weapon === 'hammer' ? 1 : 0;
  out[at + 1] = c.weapon === 'sword' ? 1 : 0;
  out[at + 2] = c.weapon === 'ball' ? 1 : 0;
}

/** Rotate a world (dx,dz) into the agent ego frame; returns [forwardComp, rightComp]. */
function toEgo(dx: number, dz: number, fx: number, fz: number, rx: number, rz: number): [number, number] {
  return [dx * fx + dz * fz, dx * rx + dz * rz];
}

/**
 * Encode `agentId`'s observation into `out` starting at `offset`. Writes exactly
 * `OBS_DIM` floats. Absent combatants / missing landmarks encode as zeros (masked).
 */
export function encodeObservation(
  state: SimState,
  agentId: string,
  out: Float32Array,
  offset = 0
): void {
  // Zero the slice first so unused slots / masks are clean.
  out.fill(0, offset, offset + OBS_DIM);

  const self = state.combatants.find((c) => c.id === agentId);
  if (!self) return;

  const f = forwardDir(self.yaw);
  const r = rightDir(self.yaw);
  const fx = f.x, fz = f.z, rx = r.x, rz = r.z;

  let p = offset;
  const put = (v: number) => {
    out[p++] = v;
  };
  const putEgo = (dx: number, dz: number, scale: number) => {
    const [ef, er] = toEgo(dx, dz, fx, fz, rx, rz);
    out[p++] = ef / scale;
    out[p++] = er / scale;
  };

  const ownGoal = ownGoalForTeam(self.team, state.goalPlates);
  const enemyGoal = enemyGoalForTeam(self.team, state.goalPlates);

  // --- Self ---
  if (ownGoal) putEgo(ownGoal.position.x - self.pos.x, ownGoal.position.z - self.pos.z, POS_SCALE);
  else { put(0); put(0); }
  if (enemyGoal) putEgo(enemyGoal.position.x - self.pos.x, enemyGoal.position.z - self.pos.z, POS_SCALE);
  else { put(0); put(0); }
  putEgo(self.vel.x, self.vel.z, VEL_SCALE);
  put(Math.sin(self.yaw));
  put(Math.cos(self.yaw));
  put(self.maxHp > 0 ? self.hp / self.maxHp : 0);
  weaponOneHot(self, out, p); p += 3;
  put(Math.min(1, self.attackCooldown));
  put(self.hasBall ? 1 : 0);
  put(self.dashCooldownTimer <= 0 ? 1 : 0);
  put(self.isJumping ? 1 : 0);
  put(self.isCrouching ? 1 : 0);
  put(Math.min(1, self.invulnerabilityTimer));
  put(Math.min(1, self.passChargeTimer / 1.2));       // ~chargeMax-normalized
  put(self.hammerJumpWindowTimer > 0 ? 1 : 0);
  put(Math.min(1, self.weaponReadyTimer));

  // --- Ball ---
  const ball = state.match.ball;
  putEgo(ball.pos.x - self.pos.x, ball.pos.z - self.pos.z, POS_SCALE);
  putEgo(ball.vel.x, ball.vel.z, VEL_SCALE);
  out[p++] = ball.state === 'idle' ? 1 : 0;
  out[p++] = ball.state === 'held' ? 1 : 0;
  out[p++] = ball.state === 'loose' ? 1 : 0;
  out[p++] = ball.state === 'thrown' ? 1 : 0;
  // holder relation: self / team / enemy / none
  if (ball.holderId === self.id) out[p] = 1;
  else if (ball.holderId) {
    const holder = state.combatants.find((c) => c.id === ball.holderId);
    if (holder && holder.team === self.team) out[p + 1] = 1;
    else if (holder) out[p + 2] = 1;
    else out[p + 3] = 1;
  } else out[p + 3] = 1;
  p += 4;

  // --- Teammates then opponents (stable order = roster order) ---
  const teammates = state.combatants.filter((c) => c.id !== self.id && c.team === self.team);
  const opponents = state.combatants.filter((c) => c.team !== self.team);
  const opponentSlots = state.mode === 'combat' ? sortCombatThreats(opponents, self) : opponents;
  p = encodeOthers(teammates, MAX_TEAMMATES, self, fx, fz, rx, rz, out, p);
  p = encodeOthers(opponentSlots, MAX_OPPONENTS, self, fx, fz, rx, rz, out, p);

  // --- Match context ---
  // Score is goals in grifball, kills in combat (goalTarget doubles as the kill target).
  const useKills = state.mode === 'combat';
  const ownScore = useKills
    ? (state.scores[self.team]?.kills ?? 0)
    : (state.scores[self.team]?.goals ?? 0);
  const enemyScore = bestEnemyScore(state, self.team, useKills);
  const target = state.match.goalTarget || 1;
  out[p++] = (ownScore - enemyScore) / target;
  out[p++] = state.match.phase === 'countdown' ? 1 : 0;
  out[p++] = state.match.phase === 'playing' ? 1 : 0;
  out[p++] = state.match.phase === 'scored' ? 1 : 0;
  out[p++] = state.match.phase === 'matchEnd' ? 1 : 0;
  out[p++] = Math.min(1, state.match.phaseTimer / 5);
  out[p++] = Math.min(1, state.tick / 36000); // ~10 min cap

  // --- Mechanics-aware block: current balance as deviation-from-nominal ---
  const s = state.settings as unknown as Record<string, number>;
  for (let i = 0; i < MECHANICS_OBS_KEYS.length; i++) {
    const v = s[MECHANICS_OBS_KEYS[i] as string];
    const dev = typeof v === 'number' ? v / MECHANICS_REF[i] - 1 : 0;
    out[p++] = dev < -1 ? -1 : dev > 1 ? 1 : dev; // clamp ±100%
  }
}

export function encodeObservationForVersion(
  state: SimState,
  agentId: string,
  out: Float32Array,
  offset = 0,
  version = 1
): void {
  encodeObservation(state, agentId, out, offset);
  if (version < 2) return;
  out.fill(0, offset + OBS_DIM, offset + OBS_DIM_V2);
  encodeCombatPressure(state, agentId, out, offset + OBS_DIM);
}

function sortCombatThreats(opponents: SimCombatant[], self: SimCombatant): SimCombatant[] {
  return [...opponents].sort((a, b) => {
    const aliveA = a.alive ? 0 : 1;
    const aliveB = b.alive ? 0 : 1;
    if (aliveA !== aliveB) return aliveA - aliveB;
    const da = Math.hypot(a.pos.x - self.pos.x, a.pos.z - self.pos.z);
    const db = Math.hypot(b.pos.x - self.pos.x, b.pos.z - self.pos.z);
    return da - db;
  });
}

function encodeCombatPressure(
  state: SimState,
  agentId: string,
  out: Float32Array,
  offset: number
): void {
  if (state.mode !== 'combat') return;
  const self = state.combatants.find((c) => c.id === agentId);
  if (!self) return;
  const hostiles = sortCombatThreats(
    state.combatants.filter((c) => c.team !== self.team && c.alive),
    self
  );
  const f = forwardDir(self.yaw);
  const r = rightDir(self.yaw);
  const fx = f.x, fz = f.z, rx = r.x, rz = r.z;
  const putEgoAt = (at: number, dx: number, dz: number, scale: number) => {
    const [ef, er] = toEgo(dx, dz, fx, fz, rx, rz);
    out[offset + at] = ef / scale;
    out[offset + at + 1] = er / scale;
  };

  const nearest = hostiles[0];
  if (nearest) {
    putEgoAt(0, nearest.pos.x - self.pos.x, nearest.pos.z - self.pos.z, POS_SCALE);
    putEgoAt(2, nearest.vel.x, nearest.vel.z, VEL_SCALE);
    out[offset + 4] = nearest.maxHp > 0 ? nearest.hp / nearest.maxHp : 0;
  }

  let sx = 0, sz = 0;
  for (const hostile of hostiles) {
    const dx = hostile.pos.x - self.pos.x;
    const dz = hostile.pos.z - self.pos.z;
    const d = Math.hypot(dx, dz);
    if (d <= 4) out[offset + 5] += 1;
    if (d <= 8) out[offset + 6] += 1;
    if (d <= 12) out[offset + 7] += 1;
    if (d > 0 && d <= 8) {
      sx -= dx / d;
      sz -= dz / d;
    }
  }

  const leader = scoreLeaderHostile(state, self.team, hostiles);
  if (leader) putEgoAt(8, leader.pos.x - self.pos.x, leader.pos.z - self.pos.z, POS_SCALE);
  const escapeLen = Math.hypot(sx, sz);
  if (escapeLen > 0) putEgoAt(10, sx / escapeLen, sz / escapeLen, 1);
}

function scoreLeaderHostile(
  state: SimState,
  selfTeam: string,
  hostiles: SimCombatant[]
): SimCombatant | null {
  let leader: SimCombatant | null = null;
  let bestKills = -1;
  for (const hostile of hostiles) {
    const kills = state.scores[hostile.team]?.kills ?? 0;
    if (hostile.team !== selfTeam && kills > bestKills) {
      bestKills = kills;
      leader = hostile;
    }
  }
  return leader;
}

function encodeOthers(
  others: SimCombatant[],
  slots: number,
  self: SimCombatant,
  fx: number, fz: number, rx: number, rz: number,
  out: Float32Array,
  start: number
): number {
  let p = start;
  for (let i = 0; i < slots; i++) {
    const o = others[i];
    if (!o) { p += OTHER_SLOT; continue; } // already zeroed (presence mask stays 0)
    const [ef, er] = toEgo(o.pos.x - self.pos.x, o.pos.z - self.pos.z, fx, fz, rx, rz);
    out[p++] = ef / POS_SCALE;
    out[p++] = er / POS_SCALE;
    const [vf, vr] = toEgo(o.vel.x, o.vel.z, fx, fz, rx, rz);
    out[p++] = vf / VEL_SCALE;
    out[p++] = vr / VEL_SCALE;
    out[p++] = o.maxHp > 0 ? o.hp / o.maxHp : 0;
    weaponOneHot(o, out, p); p += 3;
    out[p++] = o.hasBall ? 1 : 0;
    out[p++] = 1; // presence mask
  }
  return p;
}

/** Best (max) score among enemy teams — goals for grifball, kills for combat. */
function bestEnemyScore(state: SimState, team: string, useKills: boolean): number {
  let max = 0;
  for (const [t, tally] of Object.entries(state.scores)) {
    if (t !== team) max = Math.max(max, useKills ? tally.kills : tally.goals);
  }
  return max;
}
