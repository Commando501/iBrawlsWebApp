import { getCharacterModelCollisionProfile } from '../characterModelTypes';
import type { CharacterModelType, UniversalSettings } from '../types';
import type { Vec3 } from './grifballBall';
import type { BallContactCollider } from './grifballBallContacts';
import { resolveHammerSlamTiming } from './hammerSlamTiming';

export interface BallColliderActor {
  id: string;
  pos: Vec3;
  vel: Vec3;
  /** Live/model convention: zero faces -Z. */
  yaw: number;
  isCrouching: boolean;
  modelType?: CharacterModelType;
  activeWeapon: string;
  weaponState: string;
  /** Elapsed animation phase seconds, not a remaining cooldown. */
  weaponTimer: number;
  isLunging?: boolean;
}

const clamp = (v: number) => Math.max(0, Math.min(1, v));

/** Stable gameplay bounds, independent of render LOD, camera, and cosmetic models. */
export function createBallCombatantColliders(
  actors: readonly BallColliderActor[],
  dt: number,
  settings: Partial<UniversalSettings>,
): BallContactCollider[] {
  const result: BallContactCollider[] = [];
  // Contact ties must not depend on roster insertion order.
  for (const actor of [...actors].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)) {
    const profile = getCharacterModelCollisionProfile(actor.modelType, 'v2');
    const height = actor.isCrouching ? profile.crouchingHeight : profile.standingHeight;
    const radius = Math.min(profile.radius, height / 2);
    const cos = Math.cos(actor.yaw), sin = Math.sin(actor.yaw);
    const world = (p: Vec3, previous: boolean): Vec3 => ({
      x: actor.pos.x + p.x * cos - p.z * sin - (previous ? actor.vel.x * dt : 0),
      y: actor.pos.y + p.y - (previous ? actor.vel.y * dt : 0),
      z: actor.pos.z - p.x * sin - p.z * cos - (previous ? actor.vel.z * dt : 0),
    });
    const add = (kind: BallContactCollider['kind'], a: Vec3, b: Vec3, r: number, previousA = a, previousB = b) =>
      result.push({ ownerId: actor.id, kind, radius: r,
        startA: world(previousA, true), startB: world(previousB, true), endA: world(a, false), endB: world(b, false) });
    add('body', { x: 0, y: radius, z: 0 }, { x: 0, y: height - radius, z: 0 }, radius);
    if (!['hammer', 'sword', 'pistol'].includes(actor.activeWeapon) || actor.weaponState === 'swapping') continue;
    const scale = profile.standingHeight / 1.8;
    const grip = { x: 0.44 * scale, y: height * 0.61, z: 0.38 * scale };
    const timing = resolveHammerSlamTiming(settings);
    const phase = actor.weaponState;
    const swipe = phase.startsWith('melee') || actor.activeWeapon === 'sword';
    const recovery = phase === 'melee_recover' ? settings.hammerMeleeReload ?? .5
      : actor.activeWeapon === 'sword' ? settings.swordSlashReload ?? .6 : settings.hammerReloadTime ?? .6;
    const pose = (p: Vec3, elapsed: number): Vec3 => {
      let angle = 0;
      if (actor.isLunging) angle = 0;
      else if (phase === 'swing_up') angle = -1.1 * clamp(elapsed / (swipe ? (settings.swordSlashSpeed ?? .22) / 2 : timing.windupTime));
      else if (phase === 'swing_down') angle = -1.1 + 2.2 * clamp(elapsed / (swipe ? (settings.swordSlashSpeed ?? .22) / 2 : timing.attackTime));
      else if (phase === 'slashing' || phase === 'melee_swing') angle = -1.1 + 2.2 * clamp(elapsed / (phase === 'slashing' ? settings.swordSlashSpeed ?? .22 : settings.hammerMeleeSpeed ?? .24));
      else if (phase === 'melee_up') angle = -1.1 * clamp(elapsed / ((settings.hammerMeleeSpeed ?? .24) * .4));
      else if (phase === 'melee_down') angle = -1.1 + 2.2 * clamp(elapsed / ((settings.hammerMeleeSpeed ?? .24) * .6));
      else if (phase === 'recovering' || phase === 'melee_recover') angle = 1.1 * (1 - clamp(elapsed / Math.max(.001, recovery)));
      const c = Math.cos(angle), s = Math.sin(angle);
      return {
        x: grip.x + scale * (swipe ? p.x * c + p.z * s : p.x),
        y: grip.y + scale * (swipe ? p.y : p.y * c - p.z * s),
        z: grip.z + scale * (swipe ? p.z * c - p.x * s : p.z * c + p.y * s),
      };
    };
    const weapon = (a: Vec3, b: Vec3, r: number) =>
      add('weapon', pose(a, actor.weaponTimer), pose(b, actor.weaponTimer), r * scale,
        pose(a, Math.max(0, actor.weaponTimer - dt)), pose(b, Math.max(0, actor.weaponTimer - dt)));
    if (actor.activeWeapon === 'hammer') {
      weapon({ x: 0, y: -.35, z: 0 }, { x: 0, y: .55, z: .18 }, .08);
      weapon({ x: -.28, y: .55, z: .18 }, { x: .28, y: .55, z: .18 }, .23);
    } else {
      weapon({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: actor.activeWeapon === 'sword' ? 1.05 : .35 }, .12);
    }
  }
  return result;
}
