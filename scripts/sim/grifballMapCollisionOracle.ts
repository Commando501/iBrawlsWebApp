import type { CustomMapData } from '../../src/types';

/** Independent final cylinder/obstacle overlap check. Contact tolerance matches
 * the live body's skin; this does not claim swept collision between updates. */
export function isMapBodyClear(map: CustomMapData, p: { x: number; y: number; z: number }): boolean {
  const radius = .55, height = 2, epsilon = 1e-8;
  return map.objects.every(o => {
    if (!o.isCollidable) return true;
    const dx = p.x - o.position.x, dz = p.z - o.position.z;
    if (o.type === 'sphere') {
      const dy = Math.max(p.y - o.position.y, o.position.y - p.y - height, 0);
      return Math.hypot(dx, dy, dz) >= o.scale.x / 2 + radius - epsilon;
    }
    const top = o.position.y + o.scale.y / 2, bottom = o.position.y - o.scale.y / 2;
    // The vertical skin boundary is inclusive in the live collision contract.
    // Adding epsilon here would turn a point just outside that boundary into
    // an overlap (for example, ascending feet at 1.9500000000000002 above a 2m box).
    if (p.y > top - .05 || p.y + height < bottom + .05) return true;
    if (o.type === 'cylinder') return Math.hypot(dx, dz) >= o.scale.x / 2 + radius - epsilon;
    if (o.type === 'box') return Math.hypot(Math.max(0, Math.abs(dx) - o.scale.x / 2),
      Math.max(0, Math.abs(dz) - o.scale.z / 2)) >= radius - epsilon;
    return true;
  });
}
