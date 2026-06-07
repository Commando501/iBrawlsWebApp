import * as THREE from 'three';
import { type AILungeOutcome } from '../../game/aiCombatDecision';
import { MAIN_AI_ID } from '../../game/roster';
import { type Combatant, type CustomMapData, type DeathEvent } from '../../types';
import { isVectorXZAtArenaBoundary } from './arenaBounds';
import {
  getCombatBodyCenter,
  type SwordLungeCurrentTrailStyle,
  type TacticalTargetCandidate,
} from './combatGeometry';
import { applyAISwordLungeHitForState } from './aiSwordLungeHitRuntime';
import { type ReplayHeatmapCombatantSource } from './replayHeatmapRuntime';
import { type GrifballRuntimeState } from './runtimeState';
import { type CombatTradeReason, resolveSwordLungeTradeReasonForState } from './tradeRuntime';

export type AISwordLungeFlightResult = 'continue' | 'trade_return';

export function resolveAISwordLungeFlightForCombatant({
  state,
  self,
  target,
  mainAi,
  botId,
  botMesh,
  pos,
  vel,
  dt,
  cooldownMult,
  activeCustomMap,
  gravityAcceleration,
  recoverCombatantAltitude,
  constrainCombatantToArena,
  areCombatantsHostile,
  finishSwordLunge,
  executeCustomBotTrade,
  renderSwordLungeTrailVfx,
  recordPlayerDamageTaken,
  playExplosion,
  playDeath,
  spawnVoxelShockwaveParticles,
  recordDeathEvent,
  recordBotPsychKill,
  recordBotCalibrationDeath,
  pushStatsUpdate,
}: {
  state: GrifballRuntimeState;
  self: Combatant;
  target: TacticalTargetCandidate;
  mainAi: Combatant | undefined;
  botId: string;
  botMesh: THREE.Object3D;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  dt: number;
  cooldownMult: number;
  activeCustomMap: CustomMapData | null;
  gravityAcceleration: number;
  recoverCombatantAltitude: (self: Combatant, pos: THREE.Vector3, vel: THREE.Vector3) => boolean;
  constrainCombatantToArena: (pos: THREE.Vector3, vel: THREE.Vector3) => void;
  areCombatantsHostile: (attackerId: string, victimId: string) => boolean;
  finishSwordLunge: (cooldownMultiplier: number, outcome: AILungeOutcome, targetId?: string) => void;
  executeCustomBotTrade: (
    attackerBot: Combatant,
    target: { id: string },
    reason: CombatTradeReason
  ) => void;
  renderSwordLungeTrailVfx: (
    trailPos: THREE.Vector3,
    color: string,
    direction?: THREE.Vector3,
    currentStyle?: SwordLungeCurrentTrailStyle
  ) => void;
  recordPlayerDamageTaken: () => void;
  playExplosion: () => void;
  playDeath: () => void;
  spawnVoxelShockwaveParticles: (impactCenter: THREE.Vector3, color: string) => void;
  recordDeathEvent: (
    attacker: string,
    victim: string,
    medals?: undefined,
    weapon?: DeathEvent['weapon'],
    heatmap?: {
      attacker: ReplayHeatmapCombatantSource;
      victim: ReplayHeatmapCombatantSource;
    }
  ) => DeathEvent;
  recordBotPsychKill: (botId: string, victimId: string, wasLungeKill: boolean) => void;
  recordBotCalibrationDeath: (botId: string) => void;
  pushStatsUpdate: () => void;
}): AISwordLungeFlightResult {
  self.lungeTimer = (self.lungeTimer || 0) + dt;
  const lungeSpeed = state.settings.swordLungeSpeed ?? 24.0;
  const targetDir = new THREE.Vector3(self.lungeTargetDir!.x, self.lungeTargetDir!.y, self.lungeTargetDir!.z);

  vel.x = targetDir.x * lungeSpeed;
  vel.z = targetDir.z * lungeSpeed;
  vel.y -= gravityAcceleration * dt;
  pos.addScaledVector(vel, dt);
  recoverCombatantAltitude(self, pos, vel);
  if (pos.y <= 0) {
    pos.y = 0;
    vel.y = 0;
  }
  constrainCombatantToArena(pos, vel);
  self.pos.copy(pos);
  self.vel.copy(vel);
  botMesh.position.copy(pos);

  const trailPos = pos.clone();
  trailPos.y += 0.825;
  renderSwordLungeTrailVfx(trailPos, '#ef4444', targetDir, 'enemyCube');

  const dist = getCombatBodyCenter(pos, self.isCrouching).distanceTo(getCombatBodyCenter(target.pos, target.isCrouching));
  if (target.hp <= 0 || !areCombatantsHostile(botId, target.id)) {
    finishSwordLunge(cooldownMult, 'target_dead', target.id);
  } else if (dist <= 1.5) {
    const tradeReason = resolveSwordLungeTradeReasonForState({
      state,
      target,
      mainAi: target.id === MAIN_AI_ID ? mainAi : undefined,
    });

    if (tradeReason) {
      executeCustomBotTrade(self, target, tradeReason);
      return 'trade_return';
    }

    applyAISwordLungeHitForState({
      state,
      attackerBot: self,
      target,
      mainAi: target.id === MAIN_AI_ID ? mainAi : undefined,
      cooldownMult,
      finishSwordLunge: (cooldownMultiplier, outcome, targetId) => {
        finishSwordLunge(cooldownMultiplier, outcome, targetId);
      },
      recordPlayerDamageTaken,
      playExplosion,
      playDeath,
      spawnVoxelShockwaveParticles,
      recordDeathEvent,
      recordBotPsychKill,
      recordBotCalibrationDeath,
    });
    pushStatsUpdate();
  }

  const startDist = pos.distanceTo(new THREE.Vector3(self.lungeStartPos!.x, self.lungeStartPos!.y, self.lungeStartPos!.z));
  const hitsBoundary = isVectorXZAtArenaBoundary({
    pos,
    activeCustomMap,
    arenaRadius: state.arenaRadius,
    inset: 0.65,
  });

  if (hitsBoundary) {
    finishSwordLunge(cooldownMult, 'miss_arena', target.id);
  } else if (startDist > 16.0 || self.lungeTimer > 0.8) {
    finishSwordLunge(cooldownMult, 'miss_timeout', target.id);
  }

  return 'continue';
}
