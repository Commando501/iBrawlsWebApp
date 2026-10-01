import { resolveBehaviorTuning } from './aiBehaviorTuning';
import { evaluateAICombatDecision, type AILungeMemory, type AITacticalTarget, type PlayerModelSnapshot } from './aiCombatDecision';
import { deriveMatchStateMultipliers, type AIMatchScoreContext } from './aiTuning';
import type { UniversalSettings } from '../types';

type Position = { x: number; y: number; z: number };
export interface TacticalWeaponActor {
  id: string;
  team?: string;
  pos: Position;
  hp: number;
  maxHp: number;
  activeWeapon?: AITacticalTarget['activeWeapon'];
  respawnTimer?: number;
  isObserver?: boolean;
}
export interface TacticalWeaponChoiceContext {
  distanceToTarget?: number;
  combatDistanceToTarget?: number;
  canStartWeaponAction?: boolean;
  weaponState?: string;
  weaponSwapIQ?: number;
  recentLungeMemory?: AILungeMemory | null;
  weaponPrioritization?: number;
  playerModel?: PlayerModelSnapshot | null;
}
const distance = (a: Position, b: Position) => Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2);

/** Count physical opposing bodies once, regardless of main/roster aliases. */
export function countNearbyCombatEnemies(self: TacticalWeaponActor, actors: readonly TacticalWeaponActor[], teamCombat: boolean) {
  const seen = new Set<string>();
  let count = 0;
  for (const actor of actors) {
    // The first observation is authoritative; a stale alias must not revive or
    // move the same identity into the crowd after it failed the filters.
    if (seen.has(actor.id)) continue;
    seen.add(actor.id);
    if (actor.id === self.id || actor.hp <= 0 || (actor.respawnTimer ?? 0) > 0 || actor.isObserver ||
      teamCombat && self.team && actor.team && actor.team === self.team) continue;
    if (distance(self.pos, actor.pos) < 6) count++;
  }
  return count;
}

/** Engine-independent tactical weapon policy; observations and RNG stay owned
 * by the calling host. This evaluates intent; combo/feint/swap gates apply later. */
export function evaluateTacticalWeaponChoice({ settings, self, actors, target, difficulty, context = {},
  pressureAggression, scoreContext, random }: {
  settings: UniversalSettings;
  self: TacticalWeaponActor;
  actors: readonly TacticalWeaponActor[];
  target: AITacticalTarget & { pos: Position };
  difficulty: string;
  context?: TacticalWeaponChoiceContext;
  pressureAggression: number;
  scoreContext: AIMatchScoreContext;
  random?: () => number;
}) {
  const tuning = resolveBehaviorTuning(settings), easy = difficulty === 'easy';
  const matchMultipliers = deriveMatchStateMultipliers(scoreContext, pressureAggression / 100, {
    aheadThreshold: tuning.scoreAheadThreshold, closeThreshold: tuning.scoreCloseThreshold,
  });
  return evaluateAICombatDecision({ difficulty,
    weaponSwapIQ: context.weaponSwapIQ ?? settings.aiWeaponSwapIQ ?? 50,
    currentWeapon: (easy ? 'hammer' : self.activeWeapon ?? 'hammer') as 'hammer' | 'sword',
    botHP: easy ? 1 : self.hp || 1, botMaxHP: easy ? 1 : self.maxHp || 1,
    distanceToTarget: easy ? Infinity : context.distanceToTarget ?? distance(self.pos, target.pos),
    combatDistanceToTarget: easy ? undefined : context.combatDistanceToTarget,
    nearbyEnemiesCount: easy ? 0 : countNearbyCombatEnemies(self, actors, settings.gameMode === 'grifball'),
    target, attackRange: settings.attackRange, attackRadius: settings.attackRadius,
    grifballPunchLungeDistance: settings.grifballPunchLungeDistance,
    swordLungeDistance: settings.swordLungeDistance ?? 14.5, swordLungeSpeed: settings.swordLungeSpeed ?? 24,
    swordTradeWindowMs: settings.swordTradeWindow ?? 350,
    canStartWeaponAction: easy ? false : context.canStartWeaponAction ?? true,
    weaponState: easy ? 'ready' : context.weaponState ?? 'ready',
    recentLungeMemory: easy ? undefined : context.recentLungeMemory,
    weaponPrioritization: context.weaponPrioritization ?? 50, playerModel: context.playerModel,
    matchMultipliers, mechanicAwareIq: tuning.mechanicAwareIq, highIqOverride: tuning.highIqOverride,
    hammerWindupSeconds: tuning.hammerWindupSeconds, random,
  });
}
