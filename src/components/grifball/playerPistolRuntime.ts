import * as THREE from 'three';
import { MAIN_AI_ID } from '../../game/roster';
import { type DeathEvent, type MedalInfo } from '../../types';
import { createReplayHeatmapCombatantSource, queueReplayHeatmapDeathEventsForState } from './replayHeatmapRuntime';
import { type GrifballRuntimeState } from './runtimeState';
import { type GrifballThreeRefs } from './threeRefs';
import { playPistolFireSound } from './weaponAudio';

type PistolHitSyncPayload = {
  type: 'sync';
  action: 'hit_taken';
  damage: 1;
  targetId: string;
  weapon: 'sword';
};

export function triggerPlayerPistolFireForState({
  state,
  refs,
  isPaused,
  isPlaying,
  sendSync,
  spawnVoxelShockwaveParticles,
  playImpact,
  playDeath,
  evaluatePlayerKillMedals,
  recordBotCalibrationDeath,
}: {
  state: GrifballRuntimeState;
  refs: GrifballThreeRefs;
  isPaused: boolean;
  isPlaying: boolean;
  sendSync: (payload: PistolHitSyncPayload) => boolean;
  spawnVoxelShockwaveParticles: (impactCenter: THREE.Vector3, color: string) => void;
  playImpact: () => void;
  playDeath: () => void;
  evaluatePlayerKillMedals: (victimId: string) => MedalInfo[];
  recordBotCalibrationDeath: (botId: string) => void;
}): void {
  if (state.playerHP <= 0 || isPaused || !isPlaying) return;
  if (!state.pPistolReady || state.pPistolState !== 'ready') return;

  state.pPistolState = 'firing';
  state.pPistolTimer = 0;
  state.pPistolReady = false;

  playPistolFireSound();

  const camera = refs.camera;
  const scene = refs.scene;
  if (!camera || !scene) return;

  const eyePos = new THREE.Vector3(state.playerPos.x, 1.65 - state.crouchAmount + state.playerPos.y, state.playerPos.z);

  const cameraLookDir = new THREE.Vector3(0, 0, -1)
    .applyAxisAngle(new THREE.Vector3(1, 0, 0), state.pitch)
    .applyAxisAngle(new THREE.Vector3(0, 1, 0), state.yaw)
    .normalize();

  const camRight = new THREE.Vector3(1, 0, 0)
    .applyAxisAngle(new THREE.Vector3(1, 0, 0), state.pitch)
    .applyAxisAngle(new THREE.Vector3(0, 1, 0), state.yaw)
    .normalize();
  const camUp = new THREE.Vector3(0, 1, 0)
    .applyAxisAngle(new THREE.Vector3(1, 0, 0), state.pitch)
    .applyAxisAngle(new THREE.Vector3(0, 1, 0), state.yaw)
    .normalize();
  const muzzlePos = eyePos.clone()
    .addScaledVector(camRight, 0.15)
    .addScaledVector(camUp, -0.15)
    .addScaledVector(cameraLookDir, 0.35);

  let closestTarget: {
    type: 'other';
    id: string;
    data: GrifballRuntimeState['otherPlayers'] extends Map<string, infer T> ? T : never;
    pos: THREE.Vector3;
  } | null = null;
  let closestDist = Infinity;
  const closestHitPoint = new THREE.Vector3();

  state.otherPlayers.forEach((other, otherId) => {
    if (other.hp > 0 && other.respawnTimer <= 0 && (!other.invulnerabilityTimer || other.invulnerabilityTimer <= 0)) {
      const center = new THREE.Vector3(other.pos.x, other.pos.y + 0.825, other.pos.z);
      const toEnemy = center.clone().sub(eyePos);
      const proj = toEnemy.dot(cameraLookDir);
      if (proj > 0) {
        const closestPointOnRay = eyePos.clone().addScaledVector(cameraLookDir, proj);
        const distToRay = closestPointOnRay.distanceTo(center);
        if (distToRay <= 0.65) {
          const hitDist = eyePos.distanceTo(center);
          if (hitDist < closestDist) {
            closestDist = hitDist;
            closestTarget = {
              type: 'other',
              id: otherId,
              data: other,
              pos: new THREE.Vector3(other.pos.x, other.pos.y, other.pos.z),
            };
            closestHitPoint.copy(closestPointOnRay);
          }
        }
      }
    }
  });

  const hasHit = closestTarget !== null;
  const finalHitPos = hasHit ? closestHitPoint : eyePos.clone().addScaledVector(cameraLookDir, 100);

  if (closestTarget) {
    spawnVoxelShockwaveParticles(finalHitPos, '#fffa00');
    spawnVoxelShockwaveParticles(finalHitPos, '#ef4444');
    playImpact();

    const sent = sendSync({
      type: 'sync',
      action: 'hit_taken',
      damage: 1,
      targetId: closestTarget.id,
      weapon: 'sword',
    });

    if (!sent) {
      const bot = closestTarget.data;
      bot.hp = Math.max(0, bot.hp - 1);
      state.lastStrikePos = bot.pos.clone ? bot.pos.clone() : new THREE.Vector3(bot.pos.x, bot.pos.y, bot.pos.z);
      state.lastStrikeTick = 1.0;
      if (bot.hp <= 0) {
        bot.hp = 0;
        bot.respawnTimer = 3.0;
        if (bot.controller === 'ai') {
          bot.aiState = 'RESPAWNING';
          bot.weaponState = 'ready';
          bot.weaponTimer = 0;
          if (bot.id === MAIN_AI_ID) {
            state.scorePlayer += 1;
            state.playerKills += 1;
            state.enemyDeaths += 1;
            recordBotCalibrationDeath(bot.id);
          } else {
            bot.deaths += 1;
            state.scorePlayer += 1;
            state.playerKills += 1;
          }
        } else {
          bot.deaths += 1;
          state.scorePlayer += 1;
          state.playerKills += 1;
        }
        playDeath();
        const medals = evaluatePlayerKillMedals(bot.id);
        const newDeath: DeathEvent = {
          id: Math.random().toString(36).substring(2, 9),
          attacker: state.settings.playerName || 'Blue (You)',
          victim: bot.playerName || (bot.id === MAIN_AI_ID ? 'Red (AI)' : 'AI Bot'),
          medals,
          weapon: 'sword',
        };
        state.lastDeaths = [newDeath, ...state.lastDeaths].slice(0, 3);
        queueReplayHeatmapDeathEventsForState({
          state,
          attacker: createReplayHeatmapCombatantSource('player', undefined, {
            team: state.localPlayerTeam,
            pos: state.playerPos,
          }),
          victim: createReplayHeatmapCombatantSource(bot.id, bot),
          weapon: 'sword',
        });
        spawnVoxelShockwaveParticles(closestTarget.pos, '#ef4444');
      }
    }
  }

  const traceGeo = new THREE.BufferGeometry().setFromPoints([muzzlePos, finalHitPos]);
  const tracerColor = state.settings.playerHue !== undefined
    ? `hsl(${state.settings.playerHue}, 95%, 65%)`
    : '#ffea00';
  const traceMat = new THREE.LineBasicMaterial({
    color: new THREE.Color(tracerColor),
    transparent: true,
    opacity: 1.0,
  });
  const traceLine = new THREE.Line(traceGeo, traceMat);
  scene.add(traceLine);

  refs.tracers.push({
    mesh: traceLine,
    life: 0,
    maxLife: 0.15,
    material: traceMat,
  });

  const flashGeo = new THREE.SphereGeometry(0.04, 8, 8);
  const flashMat = new THREE.MeshBasicMaterial({
    color: new THREE.Color(tracerColor),
    transparent: true,
    opacity: 0.85,
  });
  const flashMesh = new THREE.Mesh(flashGeo, flashMat);
  flashMesh.position.copy(muzzlePos);
  scene.add(flashMesh);

  refs.tracers.push({
    mesh: flashMesh,
    life: 0,
    maxLife: 0.05,
    material: flashMat,
  });
}
