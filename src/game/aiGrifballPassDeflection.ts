import type { BallRecovery } from './aiGrifballPassing';
import type { GrifballTacticalPlayer, GrifballTacticalSnapshot } from './aiGrifballTeamPlan';
import type { SpaceRouters } from './aiGrifballRunner';
import { estimateSpaceAttackTime } from './aiGrifballSpace';
import { GRIFBALL_BALL_RADIUS } from './grifballBall';

export interface PassDeflectionThreat { botId: string; ballIn: number; attackIn: number }

/** Conservative opportunity estimate, not a prediction that an opponent will swing.
 * Check the moving ball, not just its landing. Observed readiness and navigable
 * travel constrain possible hostile blasts; no knowledge of AI intentions is used. */
export function findPassDeflectionThreat(snapshot: GrifballTacticalSnapshot, carrier: GrifballTacticalPlayer,
  recovery: BallRecovery, chargeSeconds: number, routers: SpaceRouters): PassDeflectionThreat | undefined {
  if (!snapshot.passing?.hammerDeflection) return;
  const enemies = snapshot.players.filter(p => p.team !== carrier.team && p.space?.weapon === 'hammer')
    .sort((a, b) => a.id.localeCompare(b.id));
  for (let i = 1; i < recovery.path.length; i++) {
    const from = recovery.path[i - 1], to = recovery.path[i];
    const start = (i - 1) * .1, end = Math.min(i * .1, recovery.seconds);
    // The terminal sample may already be a loose ball; only the thrown interval counts.
    if (start >= recovery.seconds) break;
    for (const enemy of enemies) {
      const dx = to.x - from.x, dz = to.z - from.z;
      const closest = Math.max(0, Math.min(1, ((enemy.pos.x - from.x) * dx + (enemy.pos.z - from.z) * dz) / Math.max(1e-9, dx * dx + dz * dz)));
      for (const fraction of [...new Set([0, closest, 1])]) {
        const flightTime = start + (end - start) * fraction;
        if (flightTime >= recovery.seconds) continue;
        const point = { x: from.x + dx * fraction, z: from.z + dz * fraction };
        const ballIn = chargeSeconds + flightTime, space = enemy.space!;
        // A grounded blast cannot reach a high arc. Use the full possible reach
        // as a conservative vertical bound; exact 3D aim remains combat-owned.
        const y = from.y + (to.y - from.y) * fraction;
        if (y > (enemy.height ?? 0) + 1.65 + space.reach + GRIFBALL_BALL_RADIUS) continue;
        const reach = space.reach + GRIFBALL_BALL_RADIUS;
        const direct = Math.hypot(point.x - enemy.pos.x, point.z - enemy.pos.z);
        const observed = { ...enemy, space: { ...space, reach } };
        // The cheap lower bound must retain the same observed closing momentum
        // as the routed estimate, or a moving hammer can slip through this check.
        if (estimateSpaceAttackTime(observed, point, direct) > ballIn) continue;
        const route = routers.get(enemy.id)!(point, true);
        if (route.status === 'blocked') continue;
        const attackIn = estimateSpaceAttackTime(observed, point, route.length);
        if (attackIn <= ballIn) return { botId: enemy.id, ballIn, attackIn };
      }
    }
  }
}
