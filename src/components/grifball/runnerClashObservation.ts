import type { UniversalSettings, CharacterModelType } from '../../types';
import type { RunnerSwordThreat } from '../../game/aiGrifballRunnerClash';
import { getModelTargetRadiusBonus } from './modelHitbox';

/** Live animations store elapsed time. Read these every decision frame, not
 * from the slower team-plan snapshot. No remote/neural action is issued here. */
export function observeLiveRunnerSwordThreat(id: string, actor: {
  pos: { x: number; y: number; z: number }; vel?: { x: number; z: number };
  activeWeapon?: string; weaponState?: string; weaponTimer?: number;
  isLunging?: boolean; lungeTimer?: number; isCrouching?: boolean;
  modelType?: CharacterModelType; invulnerabilityTimer?: number;
}, settings: UniversalSettings): RunnerSwordThreat | null {
  if (actor.activeWeapon !== 'sword') return null;
  const age = actor.isLunging ? actor.lungeTimer ?? 0 : actor.weaponTimer ?? 0;
  const impactIn = actor.isLunging ? 0 : (settings.swordSlashSpeed ?? .22) * .5 - age;
  if (!actor.isLunging && (!['swing_up', 'slashing'].includes(actor.weaponState ?? '') || impactIn <= 0)) return null;
  return { id, pos: { x: actor.pos.x, y: actor.pos.y, z: actor.pos.z },
    vel: { x: actor.vel?.x ?? 0, z: actor.vel?.z ?? 0 }, kind: actor.isLunging ? 'lunge' : 'slash',
    age, impactIn, bodyHeight: actor.isCrouching ? .52 : .825,
    radiusBonus: getModelTargetRadiusBonus(actor.modelType), invulnerabilityTimer: actor.invulnerabilityTimer };
}
