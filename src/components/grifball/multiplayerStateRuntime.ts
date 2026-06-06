import { removeMainAIFromRoster } from '../../game/roster';
import { getInwardSpawnYaw } from './combatGeometry';
import { type GrifballRuntimeState } from './runtimeState';
import { type GrifballThreeRefs } from './threeRefs';

type MultiplayerRole = GrifballRuntimeState['multiplayerRole'];

export function syncMultiplayerRuntimeModeForState({
  state,
  refs,
  isMultiplayer,
  multiplayerRole,
  replayActive,
}: {
  state: GrifballRuntimeState;
  refs: GrifballThreeRefs;
  isMultiplayer: boolean;
  multiplayerRole: MultiplayerRole;
  replayActive: boolean;
}): void {
  state.isObserverMode = multiplayerRole === 'observer' || replayActive;

  if (state.isObserverMode) {
    if (refs.playerHammer) refs.playerHammer.visible = false;
    if (refs.playerSword) refs.playerSword.visible = false;

    state.playerPos.set(0, 6, 17);
    state.yaw = getInwardSpawnYaw(state.playerPos);
    state.pitch = -0.3;
  } else {
    if (refs.playerHammer) refs.playerHammer.visible = state.activeWeapon === 'hammer';
    if (refs.playerSword) refs.playerSword.visible = state.activeWeapon === 'sword';

    const scene = refs.scene;
    if (scene && refs.hostGroup) {
      scene.remove(refs.hostGroup);
      refs.hostGroup = null;
    }
  }

  if (!isMultiplayer) return;

  removeMainAIFromRoster(state.otherPlayers);
  if (multiplayerRole === 'client') {
    state.playerPos.set(0, 0, -12);
    state.yaw = getInwardSpawnYaw(state.playerPos);
  } else if (multiplayerRole === 'host') {
    state.playerPos.set(0, 0, 12);
    state.yaw = getInwardSpawnYaw(state.playerPos);
  }
}

export function syncMultiplayerPropsForState({
  state,
  isMultiplayer,
  multiplayerRole,
}: {
  state: GrifballRuntimeState;
  isMultiplayer: boolean;
  multiplayerRole: MultiplayerRole;
}): void {
  state.isMultiplayer = isMultiplayer;
  state.multiplayerRole = multiplayerRole;
  if (isMultiplayer) {
    removeMainAIFromRoster(state.otherPlayers);
  }
}
