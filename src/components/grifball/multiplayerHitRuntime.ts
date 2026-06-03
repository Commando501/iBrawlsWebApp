import * as THREE from 'three';
import { type DeathEvent, type MedalInfo } from '../../types';
import { type GrifballRuntimeState } from './runtimeState';

export function applyOutgoingMultiplayerHitForState({
  state,
  targetId,
  damage = 1,
  evaluatePlayerKillMedals,
  recordDeathEvent,
  getLocalPlayerFeedName,
  playDeath,
  spawnVoxelShockwaveParticles,
}: {
  state: GrifballRuntimeState;
  targetId: string;
  damage?: number;
  evaluatePlayerKillMedals: (victimId: string) => MedalInfo[];
  recordDeathEvent: (
    attacker: string,
    victim: string,
    medals?: MedalInfo[],
    weapon?: DeathEvent['weapon']
  ) => DeathEvent;
  getLocalPlayerFeedName: () => string;
  playDeath: () => void;
  spawnVoxelShockwaveParticles: (impactCenter: THREE.Vector3, color: string) => void;
}): void {
  const target = state.otherPlayers.get(targetId);
  if (!target || target.hp <= 0 || target.respawnTimer > 0) return;

  target.hp = Math.max(0, target.hp - damage);
  if (target.hp > 0) return;

  target.hp = 0;
  target.respawnTimer = 3.0;
  target.deaths = (target.deaths || 0) + 1;
  state.scorePlayer += 1;
  state.playerKills += 1;
  playDeath();
  const medals = evaluatePlayerKillMedals(targetId);
  recordDeathEvent(
    getLocalPlayerFeedName(),
    target.playerName,
    medals,
    state.activeWeapon as DeathEvent['weapon']
  );
  spawnVoxelShockwaveParticles(new THREE.Vector3(target.pos.x, target.pos.y, target.pos.z), '#ef4444');
}
