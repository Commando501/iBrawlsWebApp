import * as THREE from 'three';
import { type Combatant, type CustomMapData } from '../../types';
import {
  getGrifballTeamSpawn,
  resolveActiveSpawnPoints,
} from './arenaSpawns';
import {
  canStartAIHammerJumpForCombatant,
  startAIHammerJumpForCombatant,
  swapCombatantWeaponAction,
  triggerCombatantAttackAction,
  triggerCombatantLungeAction,
  type AIHammerJumpType,
  type CombatantWeapon,
} from './combatantActions';
import { getCombatantWeaponMeshes } from './combatantMeshLookup';
import { respawnAICombatant } from './combatantRespawn';
import {
  observePlayerHammerAttack,
  observePlayerWeaponSwap,
  type PlayerModelObserver,
} from './playerModelObservations';
import { type GrifballRuntimeState } from './runtimeState';
import { type GrifballThreeRefs } from './threeRefs';

type CombatantModelRecorder = (combatantId: string, observe: PlayerModelObserver) => void;

export function createCombatantActionCallbacksForState({
  getState,
  getRefs,
  spawnPoints,
  getRosterAI,
  getActiveCustomMap,
  getOptimalSpawnPoint,
  recordCombatantObservation,
  onMainAIHammerSwing,
  playSwing,
  playJump,
  playDash,
  playRespawn,
}: {
  getState: () => GrifballRuntimeState;
  getRefs: () => GrifballThreeRefs;
  spawnPoints: THREE.Vector3[];
  getRosterAI: () => Combatant[];
  getActiveCustomMap: () => CustomMapData | null;
  getOptimalSpawnPoint: (excludePositions: THREE.Vector3[]) => THREE.Vector3;
  recordCombatantObservation: CombatantModelRecorder;
  onMainAIHammerSwing: () => void;
  playSwing: () => void;
  playJump: () => void;
  playDash: () => void;
  playRespawn: () => void;
}) {
  const canStartAIHammerJump = (
    self: Combatant,
    _pos: THREE.Vector3,
    _vel: THREE.Vector3
  ): boolean => canStartAIHammerJumpForCombatant(self, getState().settings);

  const startAIHammerJump = (
    self: Combatant,
    _pos: THREE.Vector3,
    vel: THREE.Vector3,
    horizontalHeading?: THREE.Vector3,
    jumpType: AIHammerJumpType = 'offensive'
  ): boolean => startAIHammerJumpForCombatant({
    self,
    settings: getState().settings,
    vel,
    horizontalHeading,
    jumpType,
    onMainAIHammerSwing,
    playSwing,
    playJump,
  });

  const triggerCombatantAttack = (
    self: Combatant,
    weapon: CombatantWeapon,
    melee = false
  ) => {
    triggerCombatantAttackAction({
      self,
      weapon,
      melee,
      recordHammerAttack: (combatantId) => {
        recordCombatantObservation(combatantId, (model) => observePlayerHammerAttack(model));
      },
      playSwing,
    });
  };

  const triggerCombatantLunge = (
    self: Combatant,
    lungeDir: THREE.Vector3,
    pos: THREE.Vector3,
    vel: THREE.Vector3
  ) => {
    triggerCombatantLungeAction({
      self,
      settings: getState().settings,
      lungeDir,
      pos,
      vel,
      playDash,
    });
  };

  const swapCombatantWeapon = (
    self: Combatant,
    type: CombatantWeapon,
    setLockout = false
  ) => {
    swapCombatantWeaponAction({
      self,
      settings: getState().settings,
      type,
      setLockout,
      weaponMeshes: getCombatantWeaponMeshes(getRefs(), self.id),
      recordWeaponSwap: (combatantId, weaponType) => {
        recordCombatantObservation(combatantId, (model) => observePlayerWeaponSwap(model, weaponType));
      },
    });
  };

  const respawnCombatant = (combatant: Combatant, mesh: THREE.Object3D) => {
    const state = getState();
    respawnAICombatant({
      combatant,
      mesh,
      settings: state.settings,
      aiMatchContext: state.aiMatchContext,
      playerPos: state.playerPos,
      rosterAI: getRosterAI(),
      getOptimalSpawnPoint: (excludePositions) => {
        if (state.settings.gameMode === 'grifball') {
          const activeCustomMap = getActiveCustomMap();
          const fallback = resolveActiveSpawnPoints(activeCustomMap, spawnPoints);
          return getGrifballTeamSpawn(activeCustomMap, combatant.team || 'red', fallback, excludePositions);
        }
        return getOptimalSpawnPoint(excludePositions);
      },
      playRespawn,
    });
  };

  return {
    canStartAIHammerJump,
    startAIHammerJump,
    triggerCombatantAttack,
    triggerCombatantLunge,
    swapCombatantWeapon,
    respawnCombatant,
  };
}
