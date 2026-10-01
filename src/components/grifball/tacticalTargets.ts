import * as THREE from 'three';
import { selectBestTacticalTarget } from '../../game/aiTacticalTargetSelection';
import { resolveBehaviorTuning } from '../../game/aiBehaviorTuning';
import { MAIN_AI_ID } from '../../game/roster';
import { type AIResolvedKnobs, type DerivedAIParams } from '../../game/aiTuning';
import { type Combatant } from '../../types';
import { type TacticalTargetCandidate } from './combatGeometry';
import { type GrifballRuntimeState } from './runtimeState';

type TacticalTargetBotKnobs = Pick<AIResolvedKnobs, 'aiPlaystyle'>;
type TacticalTargetBotDerived = Pick<DerivedAIParams, 'spatialIQ'>;

export const isTacticalTargetOnCooldown = (
  state: GrifballRuntimeState,
  mainAI: Combatant | undefined,
  target: Pick<TacticalTargetCandidate, 'id'>
): boolean => {
  const s = state;
  if (target.id === 'player') {
    if (s.activeWeapon === 'hammer' || s.activeWeapon === 'ball') {
      return s.pWeaponState === 'recovering' || s.pWeaponState === 'swing_up' || s.pWeaponState === 'swing_down' ||
        (s.activeWeapon === 'ball' && s.isLunging);
    }
    return s.pSwordState === 'recovering' || s.pSwordState === 'slashing' || s.isLunging;
  }

  if (target.id === MAIN_AI_ID) {
    return mainAI ? (
      mainAI.weaponState === 'recovering' ||
      mainAI.weaponState === 'swing_up' ||
      mainAI.weaponState === 'swing_down' ||
      mainAI.aiState === 'LUNGING' ||
      (mainAI.aiState === 'COOLDOWN' && (mainAI.aiTimer ?? 0) > 0)
    ) : false;
  }

  const other = s.otherPlayers.get(target.id);
  if (other) {
    return other.weaponState === 'recovering' ||
      other.weaponState === 'swing_up' ||
      other.weaponState === 'swing_down' ||
      other.isLunging ||
      (other.aiState === 'COOLDOWN' && (other.aiTimer || 0) > 0);
  }
  return false;
};

export const buildPotentialTacticalTargets = (
  state: GrifballRuntimeState,
  botId: string,
  rosterAI: Combatant[]
): TacticalTargetCandidate[] => {
  const s = state;
  const potentialTargets: TacticalTargetCandidate[] = [];

  // Team combat (Grifball): a bot only treats the *enemy* team as targets.
  const teamCombat = s.settings.gameMode === 'grifball';
  const botTeam = botId === 'player' ? s.localPlayerTeam : s.otherPlayers.get(botId)?.team;
  const isEnemy = (otherTeam: string | undefined): boolean =>
    !teamCombat || !botTeam || !otherTeam || otherTeam !== botTeam;

  if (s.playerHP > 0 && s.playerRespawnTimer <= 0 && !s.isObserverMode && isEnemy(s.localPlayerTeam)) {
    potentialTargets.push({
      id: 'player',
      pos: s.playerPos,
      hp: s.playerHP,
      maxHp: s.playerMaxHP,
      invulnerabilityTimer: s.playerInvulnerabilityTimer,
      activeWeapon: s.activeWeapon,
      weaponState: s.activeWeapon === 'hammer' || s.activeWeapon === 'ball' ? s.pWeaponState : s.pSwordState,
      isLunging: s.isLunging,
      dashCooldownRemaining: s.playerDashCooldownTimer,
      swapLockoutRemaining: s.swapLockoutTimer,
      vel: s.playerVel,
      isCrouching: s.isCrouching,
      playerName: s.settings.playerName || 'Blue (You)',
      modelType: s.playerModelType,
    });
  }

  rosterAI.forEach((other) => {
    if (other.id !== botId && other.hp > 0 && (other.respawnTimer ?? 0) <= 0 && isEnemy(other.team)) {
      potentialTargets.push({
        id: other.id,
        pos: new THREE.Vector3(other.pos.x, other.pos.y, other.pos.z),
        hp: other.hp,
        maxHp: other.maxHp,
        invulnerabilityTimer: other.invulnerabilityTimer || 0,
        activeWeapon: other.activeWeapon ?? 'hammer',
        // Decision backoff starts when an attack is committed, before its
        // windup/impact. Keep that mechanical phase visible to opponents.
        weaponState: other.weaponState && other.weaponState !== 'ready'
          ? other.weaponState
          : other.aiState === 'COOLDOWN' && (other.aiTimer || 0) > 0 ? 'recovering' : 'ready',
        // Punch animation shares hammer phase names but is not a lunge. Keep
        // an actual lunge visible if possession changed during its movement.
        isLunging: other.isLunging || (other.activeWeapon !== 'ball' &&
          (other.weaponState === 'swing_up' || other.weaponState === 'swing_down')),
        dashCooldownRemaining: other.aiDashCooldownTimer || 0,
        swapLockoutRemaining: other.swapLockoutTimer || 0,
        vel: new THREE.Vector3(other.vel.x, other.vel.y, other.vel.z),
        isCrouching: other.isCrouching || false,
        playerName: other.playerName,
        modelType: other.modelType,
      });
    }
  });

  return potentialTargets;
};

export const getTacticalTargetByIdFromState = (
  state: GrifballRuntimeState,
  botId: string,
  targetId: string,
  rosterAI: Combatant[]
): TacticalTargetCandidate | null => {
  return buildPotentialTacticalTargets(state, botId, rosterAI).find((candidate) => candidate.id === targetId) ?? null;
};

export const getBestTacticalTargetFromState = ({
  state,
  botId,
  botPos,
  difficulty,
  mainAI,
  rosterAI,
  resolveBotKnobs,
  resolveBotDerived,
}: {
  state: GrifballRuntimeState;
  botId: string;
  botPos: THREE.Vector3;
  difficulty: string;
  mainAI: Combatant | undefined;
  rosterAI: Combatant[];
  resolveBotKnobs: (botId: string) => TacticalTargetBotKnobs;
  resolveBotDerived: (botId: string) => TacticalTargetBotDerived;
}): TacticalTargetCandidate | null => {
  const s = state;
  const tuning = resolveBehaviorTuning(s.settings);
  const playstyleVal = resolveBotKnobs(botId).aiPlaystyle;
  const targetSelectionSpatialIQ = resolveBotDerived(botId).spatialIQ;
  const potentialTargets = buildPotentialTacticalTargets(s, botId, rosterAI);
  return selectBestTacticalTarget({ botId, botPos, difficulty,
    myActiveWeapon: botId === MAIN_AI_ID ? mainAI?.activeWeapon : s.otherPlayers.get(botId)?.activeWeapon,
    aiPlaystyle: playstyleVal, targetSelectionSpatialIQ, arenaRadius: s.arenaRadius,
    edgeInset: tuning.arenaEdgeInset, coordinator: s.aiMatchContext.coordinator, potentialTargets });
};
