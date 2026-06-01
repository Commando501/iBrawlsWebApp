import {
  getOrCreatePlayerModel,
  getPlayerModelSnapshot,
  LOCAL_PLAYER_ID,
  observePlayerCounter,
  observePlayerDamageDealt,
  observePlayerDamageReceived,
  observePlayerLungeEnd,
  type PlayerModel,
} from '../../game/aiPlayerModel';
import { resolveBehaviorTuning } from '../../game/aiBehaviorTuning';
import { type GrifballRuntimeState } from './runtimeState';

export {
  applyLungeAimBias,
  getApproachLateralOffset,
  LOCAL_PLAYER_ID,
  observePlayerCounter,
  observePlayerDamageDealt,
  observePlayerDamageReceived,
  observePlayerDash,
  observePlayerHammerAttack,
  observePlayerLungeEnd,
  observePlayerLungeStart,
  observePlayerApproachSpeed,
  observePlayerPosition,
  observePlayerReaction,
  observePlayerWeaponSwap,
} from '../../game/aiPlayerModel';
export type { PlayerModelSnapshot } from '../../game/aiPlayerModel';

export type PlayerModelObserver = (model: PlayerModel) => void;

const getObservationModelOptions = (state: GrifballRuntimeState) => {
  const tuning = resolveBehaviorTuning(state.settings);
  return {
    emaAlpha: tuning.playerModelEmaAlpha,
    defaultLungeDistance: tuning.defaultLungeDistance,
    defaultReactionTime: tuning.defaultReactionTime,
  };
};

export const recordLocalPlayerModelObservation = (
  state: GrifballRuntimeState,
  observe: PlayerModelObserver
) => {
  if (state.isObserverMode) return;
  observe(getOrCreatePlayerModel(state.aiMatchContext, LOCAL_PLAYER_ID, getObservationModelOptions(state)));
};

export const recordCombatantModelObservation = (
  state: GrifballRuntimeState,
  botId: string,
  observe: PlayerModelObserver
) => {
  observe(getOrCreatePlayerModel(state.aiMatchContext, botId, getObservationModelOptions(state)));
};

export const recordLocalPlayerLungeEndObservation = (
  state: GrifballRuntimeState,
  hit: boolean
) => {
  const distanceTraveled = state.playerPos.distanceTo(state.lungeStartPos);
  recordLocalPlayerModelObservation(state, (model) => observePlayerLungeEnd(model, distanceTraveled, hit));
};

export const recordLocalPlayerDamageTakenObservation = (state: GrifballRuntimeState) => {
  recordLocalPlayerModelObservation(state, (model) => observePlayerDamageReceived(model));
};

export const recordLocalPlayerDamageDealtObservation = (
  state: GrifballRuntimeState,
  targetWasCountering: boolean
) => {
  recordLocalPlayerModelObservation(state, (model) => {
    observePlayerDamageDealt(model);
    if (targetWasCountering) {
      observePlayerCounter(model, true);
    }
  });
};

export const getTargetPlayerModelSnapshot = (
  state: GrifballRuntimeState,
  targetId: string
) => getPlayerModelSnapshot(state.aiMatchContext, targetId);
