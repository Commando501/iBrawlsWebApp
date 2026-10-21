import type { UniversalSettings } from '../types';
import { GRIFBALL_BALL_RADIUS, type GrifballBall, type Vec3 } from './grifballBall';

type DeflectionSettings = Pick<UniversalSettings, 'hammerBallDeflectionEnabled' | 'hammerBallDeflectionStrength'>;

/** Redirect a thrown ball away from the attacker when the blast touches it. */
export function deflectBallWithHammer(
  ball: GrifballBall,
  attackerPos: Vec3,
  impactPos: Vec3,
  blastRadius: number,
  settings: DeflectionSettings,
): boolean {
  if (!(settings.hammerBallDeflectionEnabled ?? true) || ball.state !== 'thrown') return false;
  const strength = settings.hammerBallDeflectionStrength ?? 1;
  if (!Number.isFinite(strength) || strength <= 0 || !Number.isFinite(blastRadius) || blastRadius < 0) return false;
  if (Math.hypot(ball.pos.x - impactPos.x, ball.pos.y - impactPos.y, ball.pos.z - impactPos.z) >
      blastRadius + GRIFBALL_BALL_RADIUS) return false;
  const speed = Math.hypot(ball.vel.x, ball.vel.y, ball.vel.z);
  if (!Number.isFinite(speed) || speed < 1e-6) return false;
  let x = ball.pos.x - attackerPos.x, y = ball.pos.y - attackerPos.y, z = ball.pos.z - attackerPos.z;
  let distance = Math.hypot(x, y, z);
  // Coincident centers have no outward direction: send the pass back along its incoming path.
  if (distance < 1e-6) { x = -ball.vel.x; y = -ball.vel.y; z = -ball.vel.z; distance = speed; }
  const scale = speed * Math.min(3, strength) / distance;
  ball.vel = { x: x * scale, y: y * scale, z: z * scale };
  ball.state = 'thrown';
  ball.looseTimer = 0;
  delete ball.releaseOwnerId;
  return true;
}
