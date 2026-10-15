import { ROUND_FRAME_CASES, runRoundFrameTrace, type RoundCombatCase } from './grifballRoundFrameParity';

// One human plus seven bots, four per team. Combat spans the goal, reset and
// post-reset frame while other actors move and a downed teammate revives.
export const FULL_ROSTER_FRAME_CASES = ROUND_FRAME_CASES.flatMap(round =>
  (['slash', 'slam', 'swipe'] as const).map(attack => ({ round: { ...round, fullRoster: true },
    combat: { attack, impactTick: { slash: 5, slam: 16, swipe: 17 }[attack], hp: 1 } as RoundCombatCase })));
export const runFullRosterFrameTrace = (spec: typeof FULL_ROSTER_FRAME_CASES[number], snapshotAt?: number) =>
  runRoundFrameTrace(spec.round, snapshotAt, spec.combat, undefined, 200);
export const runFullRosterFrameParity = () => FULL_ROSTER_FRAME_CASES.map(c => runFullRosterFrameTrace(c));
