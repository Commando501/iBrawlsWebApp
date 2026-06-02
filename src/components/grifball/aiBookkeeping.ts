import { notifyBotDamageTag } from '../../game/aiBotCoordinator';
import { resolveBehaviorTuning } from '../../game/aiBehaviorTuning';
import {
  isSkillCalibrationEnabled,
  recordCalibrationCounterSuccess,
  recordCalibrationDeath,
} from '../../game/aiSkillCalibration';
import { type GrifballRuntimeState } from './runtimeState';

export const recordBotCalibrationDeathForState = ({
  state,
  botId,
  difficulty,
  nowSeconds,
}: {
  state: GrifballRuntimeState;
  botId: string;
  difficulty: string;
  nowSeconds: number;
}): void => {
  if (!isSkillCalibrationEnabled(difficulty)) {
    return;
  }

  recordCalibrationDeath(
    state.aiMatchContext,
    botId,
    nowSeconds,
    resolveBehaviorTuning(state.settings).calibrationWindowSize
  );
};

export const recordBotCalibrationCounterSuccessForState = ({
  state,
  botId,
  difficulty,
}: {
  state: GrifballRuntimeState;
  botId: string;
  difficulty: string;
}): void => {
  if (!isSkillCalibrationEnabled(difficulty)) {
    return;
  }

  recordCalibrationCounterSuccess(
    state.aiMatchContext,
    botId,
    resolveBehaviorTuning(state.settings).calibrationWindowSize
  );
};

export const recordBotDamageTagForState = ({
  state,
  botId,
  targetId,
  isMultiplayer,
}: {
  state: GrifballRuntimeState;
  botId: string;
  targetId: string;
  isMultiplayer: boolean;
}): void => {
  if (isMultiplayer) return;

  notifyBotDamageTag(
    state.aiMatchContext.coordinator,
    botId,
    targetId,
    resolveBehaviorTuning(state.settings).damageTagTtl
  );
};
