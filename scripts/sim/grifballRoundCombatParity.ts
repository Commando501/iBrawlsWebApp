import { ROUND_FRAME_CASES, runRoundFrameTrace, type RoundCombatCase } from './grifballRoundFrameParity';

// Ordinary-roster scorer plus an independent duel; both team/order and winner/reset outcomes on every goal-capable map.
export const ROUND_COMBAT_CASES = ROUND_FRAME_CASES.filter(c => !c.player).flatMap(round =>
  (['slash', 'slam', 'swipe'] as const).flatMap(attack => ([5, 16, 17] as const).flatMap(impactTick =>
    ([1, 3] as const).map(hp => ({ round, combat: { attack, impactTick, hp } satisfies RoundCombatCase })))));
export const runRoundCombatParity = () => ROUND_COMBAT_CASES.map(c => runRoundFrameTrace(c.round, undefined, c.combat));
