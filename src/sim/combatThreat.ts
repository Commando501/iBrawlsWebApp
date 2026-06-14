import { type UniversalSettings } from '../types';
import {
  MELEE_HAMMER_SWIPE_REACH,
  MELEE_SWORD_SLASH_REACH,
} from '../components/grifball/combatGeometry';
import { type SimCombatant, type SimState } from './simState';
import { forwardDir } from './physics';

const FACING_DOT = Math.cos(Math.PI * 0.42); // ~75 degrees
const PASSIVE_SPEED = 2.0;
const RISK_BUFFER = 1.5;
const CLOSING_SPEED_SCALE = 24;

export interface CombatThreatAnalysis {
  threat: SimCombatant | null;
  threatId: string | null;
  distance: number | null;
  meleeRange: number;
  lungeRange: number;
  threatRange: number;
  targetFacingSelf: boolean;
  targetCanAttack: boolean;
  selfInsideMeleeRange: boolean;
  selfInsideLungeRange: boolean;
  closingSpeed: number;
  normalizedClosingSpeed: number;
  rangeMargin: number;
  normalizedRangeMargin: number;
  passiveBaitRisk: number;
}

export interface CombatThreatMemory {
  threatId: string | null;
  distance: number | null;
  rangeMargin: number;
  targetCanAttack: boolean;
  passiveBaitRisk: number;
}

export function analyzeCombatThreat(
  state: SimState,
  self: SimCombatant
): CombatThreatAnalysis {
  if (state.mode !== 'combat' || !self.alive) return emptyThreat();
  const threat = nearestHostile(state, self);
  if (!threat) return emptyThreat();

  const dx = threat.pos.x - self.pos.x;
  const dz = threat.pos.z - self.pos.z;
  const distance = Math.hypot(dx, dz);
  const invDistance = distance > 1e-6 ? 1 / distance : 0;
  const dirToThreatX = dx * invDistance;
  const dirToThreatZ = dz * invDistance;
  const dirToSelfX = -dirToThreatX;
  const dirToSelfZ = -dirToThreatZ;
  const facing = forwardDir(threat.yaw);
  const targetFacingSelf = distance <= 1e-6 || facing.x * dirToSelfX + facing.z * dirToSelfZ >= FACING_DOT;
  const targetCanAttack = canStartCombatThreatAttack(threat);
  const meleeRange = combatMeleeThreatRange(threat, state.settings);
  const lungeRange = combatLungeThreatRange(threat, state.settings);
  const selfInsideMeleeRange = distance <= meleeRange;
  const selfInsideLungeRange = targetFacingSelf && distance <= lungeRange;
  const threatRange = Math.max(meleeRange, targetFacingSelf ? lungeRange : 0);
  const closingSpeed =
    (self.vel.x - threat.vel.x) * dirToThreatX +
    (self.vel.z - threat.vel.z) * dirToThreatZ;
  const rangeMargin = threatRange - distance;
  const speed = Math.hypot(threat.vel.x, threat.vel.z);
  const passiveFactor = clamp01(1 - speed / PASSIVE_SPEED);
  const rangeFactor = targetCanAttack && targetFacingSelf
    ? clamp01((rangeMargin + RISK_BUFFER) / RISK_BUFFER)
    : 0;
  const passiveBaitRisk = rangeFactor * (0.4 + 0.6 * passiveFactor);

  return {
    threat,
    threatId: threat.id,
    distance,
    meleeRange,
    lungeRange,
    threatRange,
    targetFacingSelf,
    targetCanAttack,
    selfInsideMeleeRange,
    selfInsideLungeRange,
    closingSpeed,
    normalizedClosingSpeed: clampSigned(closingSpeed / CLOSING_SPEED_SCALE),
    rangeMargin,
    normalizedRangeMargin: clampSigned(rangeMargin / Math.max(1, threatRange || 1)),
    passiveBaitRisk,
  };
}

export function combatThreatMemoryFor(
  state: SimState,
  self: SimCombatant
): CombatThreatMemory {
  const threat = analyzeCombatThreat(state, self);
  return {
    threatId: threat.threatId,
    distance: threat.distance,
    rangeMargin: threat.rangeMargin,
    targetCanAttack: threat.targetCanAttack,
    passiveBaitRisk: threat.passiveBaitRisk,
  };
}

export function canStartCombatThreatAttack(c: SimCombatant): boolean {
  return c.alive &&
    c.attackCooldown <= 0 &&
    c.weaponReadyTimer <= 0 &&
    c.weaponState === 'idle' &&
    !c.isLunging;
}

function combatMeleeThreatRange(c: SimCombatant, settings: UniversalSettings): number {
  if (c.weapon === 'sword') return MELEE_SWORD_SLASH_REACH;
  if (c.weapon === 'hammer') {
    return Math.max(
      MELEE_HAMMER_SWIPE_REACH,
      (settings.attackRange ?? 3.2) + (settings.attackRadius ?? 4.5) * 0.85
    );
  }
  return MELEE_HAMMER_SWIPE_REACH;
}

function combatLungeThreatRange(c: SimCombatant, settings: UniversalSettings): number {
  if (c.weapon !== 'sword') return 0;
  return Math.min(18, settings.swordLungeDistance ?? 14.5);
}

function nearestHostile(state: SimState, self: SimCombatant): SimCombatant | null {
  let best: SimCombatant | null = null;
  let bestDistance = Infinity;
  for (const c of state.combatants) {
    if (!c.alive || c.team === self.team) continue;
    const d = Math.hypot(c.pos.x - self.pos.x, c.pos.z - self.pos.z);
    if (d < bestDistance) {
      best = c;
      bestDistance = d;
    }
  }
  return best;
}

function emptyThreat(): CombatThreatAnalysis {
  return {
    threat: null,
    threatId: null,
    distance: null,
    meleeRange: 0,
    lungeRange: 0,
    threatRange: 0,
    targetFacingSelf: false,
    targetCanAttack: false,
    selfInsideMeleeRange: false,
    selfInsideLungeRange: false,
    closingSpeed: 0,
    normalizedClosingSpeed: 0,
    rangeMargin: 0,
    normalizedRangeMargin: 0,
    passiveBaitRisk: 0,
  };
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function clampSigned(v: number): number {
  return v < -1 ? -1 : v > 1 ? 1 : v;
}
