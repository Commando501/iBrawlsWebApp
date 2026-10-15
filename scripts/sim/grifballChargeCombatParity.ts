import { runFrameObjectiveTrace, type FrameObjectiveCase, type ChargeCombatCase } from './grifballFrameObjectiveParity';

export interface ChargeCombatSpec { frame: FrameObjectiveCase; charge: ChargeCombatCase }
export const CHARGE_COMBAT_CASES: ChargeCombatSpec[] = [false, true].flatMap(lunge => [1, 2].flatMap(hp =>
  [false, true].flatMap(reverse => [false, true].flatMap(mirror => [1, 2, null].flatMap(releaseAt =>
    [false, true].flatMap(shield => [false, true].map(moving => ({ frame: { player: true, goal: false, lunge, hp, reverse, mirror },
      charge: { releaseAt, shield, moving } }))))))));
for (const lunge of [false, true]) for (const mirror of [false, true]) for (const moving of [false, true]) for (const recovery of ['hold', 'repress'] as const)
  CHARGE_COMBAT_CASES.push({ frame: { player: true, goal: false, lunge, hp: 1, reverse: true, mirror },
    charge: { releaseAt: null, shield: false, moving, recovery } });
export const runChargeCombatTrace = (spec: ChargeCombatSpec, snapshotAt?: number) => runFrameObjectiveTrace(spec.frame, snapshotAt, spec.charge);
export const runChargeCombatParity = () => CHARGE_COMBAT_CASES.map(c => runChargeCombatTrace(c));
