/** Emergency evasion runs after engagement gravity. An existing airborne actor
 * changes lateral velocity without receiving another vertical impulse or step. */
export function applyAIEmergencyHopMotion(
  self: { isJumping?: boolean },
  pos: { x: number; y: number; z: number },
  vel: { x: number; y: number; z: number },
  direction: { x: number; z: number },
  dt: number,
): boolean {
  vel.x = direction.x * 7.5;
  vel.z = direction.z * 7.5;
  const launched = !self.isJumping;
  if (launched) {
    self.isJumping = true;
    vel.y = 5.5;
    pos.y += vel.y * dt;
  }
  pos.x += vel.x * dt;
  pos.z += vel.z * dt;
  return launched;
}
