import { isTeamAimAttackPending, planTeamSafeAim, teamAimImpactDelay, type TeamAimBody } from '../../game/aiTeamSafeAim';
import type { Combatant, CustomMapData } from '../../types';
import type { GrifballRuntimeState } from './runtimeState';

export function planLiveTeamSafeAim(state: GrifballRuntimeState, self: Combatant, yaw: number,
  wasLunging: boolean, map: CustomMapData | null, targetId?: string) {
  if (self.isLunging && wasLunging || state.settings.gameMode !== 'grifball' || state.grifball.phase !== 'playing') return { kind: 'unchanged' } as const;
  const bodies: TeamAimBody[] = [...state.otherPlayers.values()].filter(c =>
    !c.isObserver && c.hp > 0 && c.respawnTimer <= 0 && c.aiState !== 'RESPAWNING');
  if (!state.isObserverMode && state.playerHP > 0 && state.playerRespawnTimer <= 0) bodies.push({
    id: 'player', team: state.localPlayerTeam, pos: state.playerPos, vel: state.playerVel,
    modelType: state.playerModelType, isCrouching: state.isCrouching, invulnerabilityTimer: state.playerInvulnerabilityTimer,
  });
  const weapon = self.activeWeapon === 'ball' ? 'ball' : self.activeWeapon === 'sword' ? 'sword' : 'hammer';
  const attacking = isTeamAimAttackPending(weapon, self.weaponState ?? '');
  return planTeamSafeAim({ self, bodies, settings: state.settings, weapon,
    heading: self.isLunging ? self.lungeTargetDir! : { x: -Math.sin(yaw), y: 0, z: -Math.cos(yaw) },
    targetId, attacking, lunge: !!self.isLunging, downward: !!self.hammerJumpPlanned, punchAttack: self.punchAttack,
    impactIn: teamAimImpactDelay(state.settings, weapon, self.weaponState ?? 'ready', self.weaponTimer ?? 0),
    map, arenaRadius: state.arenaRadius });
}
