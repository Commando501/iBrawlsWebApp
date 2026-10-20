import type { UniversalSettings } from '../types';
import type { FieldPoint } from './aiGrifballTeamPlan';
import type { TeamTactics } from './grifballTacticsConfig';
import { isSpaceSegmentOpen, type GrifballSpaceGeometry } from './grifballSpaceGeometry';
import { resolvePunchLungeDistance, GRIFBALL_PUNCH_RADIUS } from './runnerBallSettings';
import { GRIFBALL_CLASH_PREFERENCES, type GrifballPlayerStyle } from './grifballPlayerStyles';

/** Fresh, public animation observations. Hosts normalize elapsed/remaining clocks. */
export interface RunnerSwordThreat {
  id: string;
  pos: FieldPoint & { y: number };
  vel: FieldPoint;
  kind: 'slash' | 'lunge';
  age: number;
  impactIn: number;
  bodyHeight: number;
  radiusBonus: number;
  invulnerabilityTimer?: number;
}
export interface RunnerClashDecision {
  action: 'punch' | 'track' | 'unavailable' | 'finish' | 'none';
  targetId: string | null;
  reason: string;
  impactIn?: number;
  attackAge?: number;
  reaction: number;
  window: number;
  heading?: FieldPoint;
  individuality?: { style: GrifballPlayerStyle; strength: number; reason: string;
    teamReaction: number; teamWindow: number; preferredWindow: number };
}

/** Timing selects an ordinary punch; the combat owners still decide contact,
 * damage and victory. No unseen attack, extra reach, cooldown reset or RNG. */
export function chooseRunnerPunchClash(input: {
  pos: FieldPoint & { y: number }; threats: readonly RunnerSwordThreat[];
  geometry: GrifballSpaceGeometry; tuning: TeamTactics; settings: UniversalSettings;
  canPunch: boolean; finishIn?: number; runnerRadiusBonus?: number; runnerBodyHeight?: number; dt: number;
  playerStyle?: GrifballPlayerStyle;
}): RunnerClashDecision {
  const { pos, threats, geometry, tuning, settings } = input;
  const active = (settings.hammerMeleeSpeed ?? .24) + Math.max(.03, (settings.hammerMeleeSpeed ?? .24) * .5);
  const strength = tuning.runnerClashAgencyStrength ?? 0, style = input.playerStyle ?? 'balanced';
  const preference = GRIFBALL_CLASH_PREFERENCES[style];
  const reaction = strength > 0 ? Math.max(0, Math.min(.3, tuning.runnerClashReaction + preference.reaction * strength)) : tuning.runnerClashReaction;
  const preferredWindow = strength > 0 ? Math.max(.02, Math.min(.3, tuning.runnerClashLead + preference.window * strength)) : tuning.runnerClashLead;
  const window = Math.max(0, Math.min(preferredWindow, active - Math.max(1 / 60, input.dt)));
  const base = { reaction, window, ...(strength > 0 ? { individuality: { style, strength, reason: preference.reason,
    teamReaction: tuning.runnerClashReaction, teamWindow: tuning.runnerClashLead, preferredWindow } } : {}) };
  const candidates: { threat: RunnerSwordThreat; impactIn: number; heading: FieldPoint }[] = [];
  for (const threat of threats) {
    if ((threat.invulnerabilityTimer ?? 0) > 0 ||
      ![threat.pos.x, threat.pos.y, threat.pos.z, threat.vel.x, threat.vel.z, threat.age, threat.impactIn].every(Number.isFinite) ||
      threat.age < 0 || threat.impactIn < 0 || !isSpaceSegmentOpen(geometry, pos, threat.pos)) continue;
    const dx = threat.pos.x - pos.x, dz = threat.pos.z - pos.z;
    let impactIn = threat.impactIn;
    if (threat.kind === 'lunge') {
      // The live lunge contacts body centers at 1.5m plus the runner's model
      // radius. Solve first contact along current travel, including grazing paths.
      const vertical = threat.pos.y + threat.bodyHeight - pos.y - (input.runnerBodyHeight ?? .825);
      const radius = 1.5 + (input.runnerRadiusBonus ?? 0);
      if (Math.abs(vertical) > radius) continue;
      const c = dx * dx + dz * dz + vertical * vertical - radius * radius;
      const speedSq = threat.vel.x * threat.vel.x + threat.vel.z * threat.vel.z;
      const approach = dx * threat.vel.x + dz * threat.vel.z;
      const discriminant = approach * approach - speedSq * c;
      if (c <= 0) impactIn = 0;
      else {
        if (speedSq <= .000001 || approach >= 0 || discriminant < 0) continue;
        impactIn = (-approach - Math.sqrt(discriminant)) / speedSq;
      }
    }
    // Only project a short visible commitment. Long windups continue ordinary movement.
    if (impactIn > active) continue;
    const predicted = { x: threat.pos.x + threat.vel.x * impactIn, z: threat.pos.z + threat.vel.z * impactIn };
    const x = predicted.x - pos.x, z = predicted.z - pos.z, horizontal = Math.hypot(x, z);
    if (horizontal < .001 || !isSpaceSegmentOpen(geometry, pos, predicted)) continue;
    if (threat.kind === 'slash' &&
      Math.hypot(horizontal, threat.pos.y + 1.65 - (pos.y + (input.runnerBodyHeight ?? .825))) > 2.8 + (input.runnerRadiusBonus ?? 0)) continue;
    const punchReach = resolvePunchLungeDistance(settings);
    if (Math.hypot(horizontal - punchReach, threat.pos.y + threat.bodyHeight - pos.y - 1.2) >
      GRIFBALL_PUNCH_RADIUS + threat.radiusBonus) continue;
    candidates.push({ threat, impactIn, heading: { x: x / horizontal, z: z / horizontal } });
  }
  candidates.sort((a, b) => a.impactIn - b.impactIn || a.threat.id.localeCompare(b.threat.id));
  const candidate = candidates[0];
  if (!candidate) return { ...base, action: 'none', targetId: null, reason: 'No reachable committed sword attack' };
  const { threat, impactIn, heading } = candidate;
  const observed = { ...base, targetId: threat.id, impactIn, attackAge: threat.age, heading };
  if (input.finishIn !== undefined && input.finishIn + Math.max(input.dt, 1 / 60) < impactIn)
    return { ...observed, action: 'finish', reason: 'Goal is reachable before the observed sword contact' };
  if (!input.canPunch) return { ...observed, action: 'unavailable', reason: 'Punch is committed or weapon readiness is unavailable' };
  if (threat.age + 1e-9 < base.reaction)
    return { ...observed, action: 'track', reason: 'Observed sword attack has not reached the reaction delay' };
  if (impactIn > window)
    return { ...observed, action: 'track', reason: 'Keep moving until the sword enters the counter window' };
  return { ...observed, action: 'punch', reason: `Counter the visible ${threat.kind} with an ordinary punch` };
}
