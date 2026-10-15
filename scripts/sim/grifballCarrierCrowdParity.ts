import { runFrameObjectiveTrace, type FrameObjectiveCase, type CarrierCrowdCase } from './grifballFrameObjectiveParity';

export interface CarrierCrowdSpec { frame: FrameObjectiveCase; crowd: CarrierCrowdCase }
export const CARRIER_CROWD_CASES: CarrierCrowdSpec[] = [false, true].flatMap(player =>
  [[false, false], [true, true], [false, true]].flatMap(([lunge, secondLunge]) => [1, 2, 3, 4].flatMap(hp =>
    [false, true].flatMap(reverse => [false, true].flatMap(mirror => [false, true].flatMap(shield => (['tie', 'nearer-escort'] as const).map(pickup => ({
      frame: { player, lunge, hp, reverse, mirror, goal: false }, crowd: { secondLunge, shield, pickup },
    }))))))));
export const runCarrierCrowdTrace = (spec: CarrierCrowdSpec, snapshotAt?: number) => runFrameObjectiveTrace(spec.frame, snapshotAt, undefined, spec.crowd);
export const runCarrierCrowdParity = () => CARRIER_CROWD_CASES.map(c => runCarrierCrowdTrace(c));
