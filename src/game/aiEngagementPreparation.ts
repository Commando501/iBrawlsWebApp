import { resolveAICombatRangeFrame } from '../components/grifball/aiCombatRangeRuntime';
import { resolveCombatantCrouchPose } from '../components/grifball/aiEngagementFrameRuntime';
import { accumulateStandoffTimer, isInStandoffBand } from './aiPsychologicalPressure';
import type { AIBehaviorState } from '../types';

export interface AIEngagementPreparationInput {
  range: Omit<Parameters<typeof resolveAICombatRangeFrame>[0], 'botIsCrouching'>;
  aiState: AIBehaviorState | undefined;
  swayTimer: number | undefined;
  slideActive: boolean;
  movementComplexity: number;
  weaponState: string | undefined;
  coordCommitTimer: number;
  psychEnabled: boolean;
  standoffTimer: number;
  resolvedDangerZone: number;
  standoffRangeMinOffset: number;
  standoffRangeMaxOffset: number;
  dt: number;
}

/** After prediction/calibration and before model sampling, feints and combos.
 * Choose the current posture before measuring body distance. Do not spend the
 * later AI state/sway clock here; disabled psychology retains its existing timer. */
export function resolveAIEngagementPreparation(input: AIEngagementPreparationInput) {
  const isCrouching = resolveCombatantCrouchPose(input);
  const range = resolveAICombatRangeFrame({ ...input.range, botIsCrouching: isCrouching });
  const inCoordCommitBand = range.attackDistanceToTarget <= input.range.resolvedAiReach + .5 &&
    input.weaponState === 'ready' && !input.range.targetProtected && input.range.targetHp > 0;
  return { isCrouching, range,
    coordCommitTimer: inCoordCommitBand ? input.coordCommitTimer + input.dt : 0,
    standoffTimer: input.psychEnabled ? accumulateStandoffTimer(input.standoffTimer,
      isInStandoffBand(input.range.distanceToTarget, input.resolvedDangerZone,
        input.standoffRangeMinOffset, input.standoffRangeMaxOffset), input.dt) : input.standoffTimer };
}
