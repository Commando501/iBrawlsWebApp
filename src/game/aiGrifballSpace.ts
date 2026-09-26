import type { UniversalSettings } from '../types';
import type { FieldPoint, GrifballAssignment, GrifballTacticalPlayer, GrifballTacticalSnapshot } from './aiGrifballTeamPlan';
import { resolveHammerSlamTiming } from './hammerSlamTiming';
import { resolveDirectionalSpeedMultiplier, resolvePunchLungeDistance } from './runnerBallSettings';
import { createSpaceRouter, fieldDistance, isSpaceSegmentOpen, type GrifballSpaceGeometry, type SpaceRoute } from './grifballSpaceGeometry';

export interface SpaceObservation {
  weapon: string; phase: string; attackIn: number; reach: number; blastRadius: number;
  speed: number; lungeReach: number; lungeSpeed: number; mobileIn: number;
}
export interface SpaceCandidate {
  point: FieldPoint; score: number; enemyETA: number; supportETA: number;
  sharedExposure: number; escape: number; goalProgress: number; route: SpaceRoute['status'];
}
export interface GrifballSpaceDecision {
  desired: FieldPoint; route: SpaceRoute; selected: SpaceCandidate | null;
  candidates: SpaceCandidate[]; retained: boolean;
}

/** Estimates from visible weapon phases and elapsed animation time, not AI intentions. */
export function observeGrifballSpace(settings: UniversalSettings, weapon: string, phase: string = 'ready', elapsed = 0, cooldown = 0, height = 0, verticalSpeed = 0, gravity = 18, swordReach = 2.8): SpaceObservation {
  const timing = resolveHammerSlamTiming(settings);
  const windup = weapon === 'sword' ? settings.swordSlashSpeed * 0.5 : weapon === 'ball' ? (settings.hammerMeleeSpeed ?? 0.24) : timing.windupTime;
  const strike = weapon === 'hammer' ? timing.attackTime : weapon === 'ball' ? Math.max(0.03, (settings.hammerMeleeSpeed ?? 0.24) * 0.5) : 0;
  const recovery = weapon === 'sword' ? settings.swordSlashReload : weapon === 'ball' ? (settings.grifballPunchCooldown ?? 0.5) : settings.hammerReloadTime;
  let attackIn = windup + strike;
  if (phase === 'swing_up') attackIn = Math.max(0, windup - elapsed) + strike;
  else if (phase === 'swing_down' || phase === 'slashing') attackIn = Math.max(0, (phase === 'slashing' ? windup : strike) - elapsed);
  else if (phase.includes('recover')) attackIn += Math.max(0, recovery - elapsed);
  else if (phase.startsWith('melee')) attackIn = Math.max(0, settings.hammerMeleeSpeed - elapsed);
  attackIn = Math.max(attackIn, cooldown);
  return {
    weapon, phase, attackIn,
    reach: weapon === 'ball' ? resolvePunchLungeDistance(settings) : weapon === 'sword' ? swordReach : settings.attackRange + settings.attackRadius,
    blastRadius: weapon === 'hammer' ? settings.attackRadius : 0,
    speed: (weapon === 'ball' ? 5.8 : 5.2) * resolveDirectionalSpeedMultiplier(settings, 'forward', weapon === 'ball'),
    lungeReach: weapon === 'sword' ? settings.swordLungeDistance : 0,
    lungeSpeed: settings.swordLungeSpeed,
    mobileIn: height > 0.05 ? Math.max(0, (verticalSpeed + Math.sqrt(verticalSpeed * verticalSpeed + 2 * gravity * height)) / gravity) : 0,
  };
}

export function estimateSpaceAttackTime(player: GrifballTacticalPlayer, point: FieldPoint, routeLength: number): number {
  const o = player.space; if (!o || !Number.isFinite(routeLength)) return Infinity;
  const distance = fieldDistance(player.pos, point);
  const closing = distance > 0.01 ? ((point.x - player.pos.x) * player.vel.x + (point.z - player.pos.z) * player.vel.z) / distance : 0;
  // Observe momentum briefly; do not assume a retreating opponent stays on that heading forever.
  const travel = Math.max(0, routeLength - o.reach - closing * 0.25) / Math.max(0.1, o.speed);
  let eta = Math.max(o.mobileIn, travel) + o.attackIn;
  if (o.lungeReach > 0 && routeLength <= distance + 0.01 && distance <= o.lungeReach) {
    eta = Math.min(eta, Math.max(o.mobileIn, o.attackIn) + Math.max(0, distance - o.reach) / Math.max(0.1, o.lungeSpeed));
  }
  return eta;
}

export function createGrifballSpaceEvaluator(snapshot: GrifballTacticalSnapshot, sharedRouters?: Map<string, ReturnType<typeof createSpaceRouter>>) {
  const geometry = snapshot.geometry!;
  const routers = sharedRouters ?? new Map(snapshot.players.map(p => [p.id, createSpaceRouter(geometry, p.pos)]));
  const ordered = [...snapshot.players].sort((a, b) => a.id.localeCompare(b.id));
  return (assignment: GrifballAssignment, player: GrifballTacticalPlayer, previous?: GrifballAssignment, fixedDestination = false): void => {
    const tuning = assignment.tuning!;
    if (!tuning.spaceEnabled || !player.space) return;
    const desired = { ...assignment.destination };
    const router = routers.get(player.id)!;
    const objective = ['runner', 'retriever', 'chaser'].includes(assignment.role);
    const goal = snapshot.goals[assignment.team === 'blue' ? 'red' : 'blue']!;
    const radius = Math.max(1, player.space.blastRadius + 0.6);
    const positions = [desired];
    if (!objective && !fixedDestination) {
      for (const scale of [1, 2]) for (let i = 0; i < 8; i++) positions.push({ x: desired.x + Math.cos(i * Math.PI / 4) * radius * scale, z: desired.z + Math.sin(i * Math.PI / 4) * radius * scale });
      if (previous?.space && previous.role === assignment.role && fieldDistance(previous.destination, desired) <= radius * 2.5) positions.push(previous.destination);
    }
    const candidates: SpaceCandidate[] = [];
    const routes: SpaceRoute[] = [];
    for (const point of positions) {
      const route = router(point); routes.push(route);
      if (route.status === 'blocked') { candidates.push({ point, score: Infinity, enemyETA: Infinity, supportETA: Infinity, sharedExposure: 0, escape: 0, goalProgress: 0, route: 'blocked' }); continue; }
      let enemyETA = Infinity, supportETA = Infinity, sharedExposure = 0;
      for (const other of ordered) {
        if (other.id === player.id || !other.space) continue;
        const eta = estimateSpaceAttackTime(other, point, routers.get(other.id)!(point, true).length);
        if (other.team === player.team) supportETA = Math.min(supportETA, eta);
        else {
          enemyETA = Math.min(enemyETA, eta);
          if (other.space.blastRadius > 0 && eta < tuning.threatHorizon) {
            // A single enemy hammer must plausibly cover both this position and a teammate.
            for (const ally of ordered) if (ally.id !== player.id && ally.team === player.team &&
              fieldDistance(ally.pos, point) < other.space.blastRadius * 2 &&
              fieldDistance(ally.pos, other.pos) < other.space.reach + other.space.speed * tuning.threatHorizon &&
              isSpaceSegmentOpen(geometry, ally.pos, point)) sharedExposure++;
          }
        }
      }
      let escape = 0;
      for (let i = 0; i < 8; i++) if (isSpaceSegmentOpen(geometry, point, { x: point.x + Math.cos(i * Math.PI / 4) * radius, z: point.z + Math.sin(i * Math.PI / 4) * radius })) escape++;
      const goalProgress = fieldDistance(desired, goal) - fieldDistance(point, goal);
      const danger = Math.max(0, 1 - enemyETA / tuning.threatHorizon);
      const support = Number.isFinite(supportETA) ? Math.max(0, supportETA - tuning.supportSeconds) : (ordered.some(p => p.team === player.team && p.id !== player.id) ? tuning.threatHorizon : 0);
      const score = fieldDistance(point, desired) * 0.7 + route.length * 0.04 + danger * tuning.threatWeight + sharedExposure * tuning.sharedExposureWeight + support * tuning.supportWeight + (8 - escape) * 0.4 - goalProgress * 0.15;
      candidates.push({ point: { ...point }, score, enemyETA, supportETA, sharedExposure, escape, goalProgress, route: route.status });
    }
    let selected = -1;
    for (let i = 0; i < candidates.length; i++) if (Number.isFinite(candidates[i].score) && (selected < 0 || candidates[i].score < candidates[selected].score)) selected = i;
    let retained = false;
    if (selected >= 0 && previous?.space) {
      const incumbent = candidates.findIndex(c => fieldDistance(c.point, previous.destination) < 0.01);
      if (incumbent >= 0 && candidates[incumbent].score <= candidates[selected].score + tuning.positionHysteresis) { selected = incumbent; retained = true; }
    }
    assignment.space = { desired, route: selected < 0 ? { status: 'blocked', points: [], length: Infinity } : routes[selected], selected: candidates[selected] ?? null, candidates, retained };
    assignment.destination = selected < 0 ? { ...player.pos } : { ...candidates[selected].point };
    assignment.reason += selected < 0 ? '; no reachable ground route' : `; ${routes[selected].status} route${retained ? ', position retained' : ''}`;
  };
}

/** Reconnect to the furthest visible waypoint each frame; displacement cannot create a wall shortcut. */
export function getGrifballSpaceWaypoint(geometry: GrifballSpaceGeometry, start: FieldPoint, decision: GrifballSpaceDecision): FieldPoint | null {
  if (decision.route.status === 'blocked') return null;
  for (let i = decision.route.points.length - 1; i >= 0; i--) if (isSpaceSegmentOpen(geometry, start, decision.route.points[i])) return decision.route.points[i];
  return null;
}
