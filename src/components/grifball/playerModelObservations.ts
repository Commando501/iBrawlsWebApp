import {
  getOrCreatePlayerModel,
  getPlayerModelSnapshot,
  hydratePlayerModel,
  LOCAL_PLAYER_ID,
  observePlayerCounter,
  observePlayerApproachSpeed,
  observePlayerDamageDealt,
  observePlayerDamageReceived,
  observePlayerLungeEnd,
  observePlayerPosition,
  type PlayerModel,
} from '../../game/aiPlayerModel';
import { resetAIMatchContext } from '../../game/aiMatchContext';
import { resolveBehaviorTuning } from '../../game/aiBehaviorTuning';
import { loadPlayerFingerprint } from '../../game/theaterDatabase';
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

export const createPlayerModelObservationCallbacksForState = ({
  getState,
}: {
  getState: () => GrifballRuntimeState;
}) => {
  const recordLocalPlayerObservation = (observe: PlayerModelObserver) => {
    recordLocalPlayerModelObservation(getState(), observe);
  };

  const recordCombatantObservation = (botId: string, observe: PlayerModelObserver) => {
    recordCombatantModelObservation(getState(), botId, observe);
  };

  const recordPlayerLungeEndObservation = (hit: boolean) => {
    recordLocalPlayerLungeEndObservation(getState(), hit);
  };

  const recordPlayerDamageTaken = () => {
    recordLocalPlayerDamageTakenObservation(getState());
  };

  const recordPlayerDamageDealt = (targetWasCountering: boolean) => {
    recordLocalPlayerDamageDealtObservation(getState(), targetWasCountering);
  };

  const getTargetPlayerModel = (targetId: string) =>
    getTargetPlayerModelSnapshot(getState(), targetId);

  return {
    recordLocalPlayerObservation,
    recordCombatantObservation,
    recordPlayerLungeEndObservation,
    recordPlayerDamageTaken,
    recordPlayerDamageDealt,
    getTargetPlayerModel,
  };
};

export const resetAndWarmStartLocalPlayerModelForState = ({
  state,
  replayActive,
}: {
  state: GrifballRuntimeState;
  replayActive: boolean;
}): () => void => {
  const ctx = state.aiMatchContext;
  resetAIMatchContext(ctx);
  if (replayActive) return () => {};

  let cancelled = false;
  loadPlayerFingerprint(LOCAL_PLAYER_ID)
    .then((snapshot) => {
      if (cancelled || !snapshot) return;
      hydratePlayerModel(
        getOrCreatePlayerModel(ctx, LOCAL_PLAYER_ID, getObservationModelOptions(state)),
        snapshot
      );
    })
    .catch(() => { /* warm-start is best-effort; ignore storage failures */ });

  return () => {
    cancelled = true;
  };
};

export const recordAIEngagementApproachObservations = ({
  state,
  botId,
  botPos,
  botVel,
  targetId,
  distanceToTarget,
  nowSeconds,
  mapShape,
}: {
  state: GrifballRuntimeState;
  botId: string;
  botPos: { x: number; z: number };
  botVel: { x: number; z: number };
  targetId: string;
  distanceToTarget: number;
  nowSeconds: number;
  mapShape?: string;
}): void => {
  if (targetId === LOCAL_PLAYER_ID) {
    recordLocalPlayerModelObservation(state, (model) => {
      observePlayerPosition(model, state.playerPos.x, state.playerPos.z, state.arenaRadius, nowSeconds, mapShape);
      if (distanceToTarget < 15) {
        const speed = Math.hypot(state.playerVel.x, state.playerVel.z);
        const maxSpeed = (state.settings.speedForward / 100) * 5.0;
        observePlayerApproachSpeed(model, speed, maxSpeed);
      }
    });
  }

  recordCombatantModelObservation(state, botId, (model) => {
    observePlayerPosition(model, botPos.x, botPos.z, state.arenaRadius, nowSeconds, mapShape);
    if (distanceToTarget < 15) {
      const speed = Math.hypot(botVel.x, botVel.z);
      const maxSpeed = (state.settings.speedForward / 100) * 5.0;
      observePlayerApproachSpeed(model, speed, maxSpeed);
    }
  });
};
