import * as THREE from 'three';
import { getOrCreateBotPsychState } from '../../game/aiMatchContext';
import { resolveBehaviorTuning } from '../../game/aiBehaviorTuning';
import { MAIN_AI_ID } from '../../game/roster';
import { isPsychPressureEnabled, notifyBotKill } from '../../game/aiPsychologicalPressure';
import { isSkillCalibrationEnabled, recordCalibrationKill } from '../../game/aiSkillCalibration';
import { type Combatant } from '../../types';
import { type GrifballRuntimeState } from './runtimeState';

export const computeVictimSpawnPoint = ({
  state,
  victimId,
  rosterAI,
  getOptimalSpawnPoint,
}: {
  state: GrifballRuntimeState;
  victimId: string;
  rosterAI: Combatant[];
  getOptimalSpawnPoint: (excludePositions: THREE.Vector3[]) => THREE.Vector3;
}): THREE.Vector3 => {
  const exclude: THREE.Vector3[] = [];
  if (state.playerHP > 0 && state.playerRespawnTimer <= 0 && victimId !== 'player' && !state.isObserverMode) {
    exclude.push(state.playerPos);
  }

  rosterAI.forEach((combatant) => {
    if (combatant.id !== victimId && combatant.hp > 0 && (combatant.respawnTimer ?? 0) <= 0) {
      exclude.push(new THREE.Vector3(combatant.pos.x, combatant.pos.y, combatant.pos.z));
    }
  });

  state.otherPlayers?.forEach((other) => {
    if (other.controller === 'remote' && other.id !== victimId && other.hp > 0 && other.respawnTimer <= 0) {
      exclude.push(new THREE.Vector3(other.pos.x, other.pos.y, other.pos.z));
    }
  });

  return getOptimalSpawnPoint(exclude);
};

export const recordBotPostKillPressure = ({
  state,
  bot,
  botId,
  victimId,
  difficulty,
  pressureAggression,
  wasLungeKill,
  rosterAI,
  getOptimalSpawnPoint,
  nowSeconds,
}: {
  state: GrifballRuntimeState;
  bot: Combatant | undefined;
  botId: string;
  victimId: string;
  difficulty: string;
  pressureAggression: number;
  wasLungeKill: boolean;
  rosterAI: Combatant[];
  getOptimalSpawnPoint: (excludePositions: THREE.Vector3[]) => THREE.Vector3;
  nowSeconds: number;
}): void => {
  const psychTuning = resolveBehaviorTuning(state.settings);

  if (isSkillCalibrationEnabled(difficulty)) {
    recordCalibrationKill(state.aiMatchContext, botId, nowSeconds, psychTuning.calibrationWindowSize);
  }

  if (!isPsychPressureEnabled(difficulty, pressureAggression)) {
    return;
  }

  const spawnPos = computeVictimSpawnPoint({
    state,
    victimId,
    rosterAI,
    getOptimalSpawnPoint,
  });

  notifyBotKill(getOrCreateBotPsychState(state.aiMatchContext, botId, psychTuning.tempoCycleDuration), {
    victimId,
    spawnX: spawnPos.x,
    spawnZ: spawnPos.z,
    lungeKill: wasLungeKill,
    duration: psychTuning.postKillPressureDuration,
  });

  if (bot?.controller === 'ai') {
    bot.aiPressureTargetId = undefined;
    if (bot.id !== MAIN_AI_ID) {
      bot.aiState = 'APPROACHING';
    }
  }
};
