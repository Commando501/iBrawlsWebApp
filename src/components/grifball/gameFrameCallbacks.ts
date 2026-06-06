import * as THREE from 'three';
import { type Combatant, type Keybindings } from '../../types';
import { updateAIRosterTick } from './aiRosterTick';
import { type SwordLungeCurrentTrailStyle } from './combatGeometry';
import { updateObserverCombatantVisualsForState } from './observerVisualSync';
import { updateRosterCombatantVisualsForState } from './rosterVisualSync';
import { type GrifballRuntimeState } from './runtimeState';
import { type SpectateTargetData, type SpectateTargetRole } from './spectateTargets';
import { type GrifballThreeRefs } from './threeRefs';

type MultiplayerRole = 'host' | 'client' | 'observer' | null | undefined;

export function createGameFrameCallbacksForState({
  getState,
  getRefs,
  getRosterAI,
  getMainAI,
  getReplayActive,
  getKeysPressed,
  getKeybindings,
  isMultiplayer,
  multiplayerRole,
  respawnCombatant,
  updateSingleAIEntity,
  getSpectateTargetData,
  renderSwordLungeTrailVfx,
  applyBotMeleeImpact,
}: {
  getState: () => GrifballRuntimeState;
  getRefs: () => GrifballThreeRefs;
  getRosterAI: () => Combatant[];
  getMainAI: () => Combatant | undefined;
  getReplayActive: () => boolean;
  getKeysPressed: () => Record<string, boolean>;
  getKeybindings: () => Keybindings;
  isMultiplayer: boolean;
  multiplayerRole: MultiplayerRole;
  respawnCombatant: (combatant: Combatant, mesh: THREE.Object3D) => void;
  updateSingleAIEntity: (combatantId: string, dt: number) => void;
  getSpectateTargetData: (target: SpectateTargetRole) => SpectateTargetData;
  renderSwordLungeTrailVfx: (
    pos: THREE.Vector3,
    color: string,
    dir: THREE.Vector3,
    style?: SwordLungeCurrentTrailStyle
  ) => void;
  applyBotMeleeImpact: (botId: string) => void;
}) {
  const updateAI = (dt: number) => {
    if (isMultiplayer) return;
    updateAIRosterTick({
      refs: getRefs(),
      rosterAI: getRosterAI(),
      dt,
      respawnCombatant,
      updateSingleAIEntity,
    });
  };

  const updateCharacterSkeletalAnimations = (dt: number) => {
    const state = getState();

    if (!getReplayActive()) {
      updateObserverCombatantVisualsForState({
        refs: getRefs(),
        state,
        dt,
        multiplayerRole,
        keysPressed: getKeysPressed(),
        keybindings: getKeybindings(),
        mainAI: getMainAI(),
        getSpectateTargetData,
      });
    }

    updateRosterCombatantVisualsForState({
      refs: getRefs(),
      state,
      dt,
      renderSwordLungeTrailVfx,
      applyBotMeleeImpact,
    });
  };

  return {
    updateAI,
    updateCharacterSkeletalAnimations,
  };
}
