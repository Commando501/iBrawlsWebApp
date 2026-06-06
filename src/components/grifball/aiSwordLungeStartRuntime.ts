import * as THREE from 'three';
import { type Combatant } from '../../types';
import { type TacticalTargetCandidate } from './combatGeometry';
import {
  applyLungeAimBias,
  observePlayerLungeStart,
  type PlayerModelObserver,
  type PlayerModelSnapshot,
} from './playerModelObservations';

export function tryStartAISwordLungeForCombatant({
  self,
  target,
  pos,
  vel,
  targetAirborne,
  playerModel,
  botId,
  lungeDistanceToTarget,
  triggerCombatantLunge,
  recordCombatantObservation,
}: {
  self: Combatant;
  target: TacticalTargetCandidate;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  targetAirborne: boolean;
  playerModel: PlayerModelSnapshot | null;
  botId: string;
  lungeDistanceToTarget: number;
  triggerCombatantLunge: (
    self: Combatant,
    lungeDir: THREE.Vector3,
    pos: THREE.Vector3,
    vel: THREE.Vector3
  ) => void;
  recordCombatantObservation: (botId: string, observe: PlayerModelObserver) => void;
}): boolean {
  const lungeDir = target.pos.clone().sub(pos);
  if (!targetAirborne) lungeDir.y = 0;
  if (lungeDir.lengthSq() <= 0.0001) return false;

  if (playerModel) {
    const biased = applyLungeAimBias(lungeDir.x, lungeDir.z, playerModel);
    lungeDir.x = biased.x;
    lungeDir.z = biased.z;
    if (!targetAirborne) lungeDir.y = 0;
  }
  lungeDir.normalize();

  triggerCombatantLunge(self, lungeDir, pos, vel);
  recordCombatantObservation(botId, (model) => observePlayerLungeStart(model, lungeDistanceToTarget));
  return true;
}
