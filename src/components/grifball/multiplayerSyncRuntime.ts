import * as THREE from 'three';
import { type DeathEvent } from '../../types';
import { createReplayHeatmapCombatantSource, queueReplayHeatmapDeathEventsForState } from './replayHeatmapRuntime';
import { type GrifballRuntimeState } from './runtimeState';
import { type GrifballThreeRefs } from './threeRefs';

type MutableRef<T> = { current: T };
type MultiplayerRole = GrifballRuntimeState['multiplayerRole'];

export function createMultiplayerSyncMessageHandler({
  stateRef,
  refs,
  multiplayerRole,
  secretAudioRef,
  createOrUpdateRemotePlayer,
  resizeArena,
  pushStatsUpdate,
  rebuildHostModel,
  rebuildEnemyModel,
  spawnVoxelShockwaveParticles,
  renderHammerSplashVfx,
  triggerEnemyHammerSwing,
  triggerEnemyHammerMelee,
  triggerEnemySwordSlash,
  triggerEnemySwordLunge,
  recordPlayerDamageTaken,
  playSwing,
  playDash,
  playDeath,
  onPauseToggle,
}: {
  stateRef: MutableRef<GrifballRuntimeState>;
  refs: GrifballThreeRefs;
  multiplayerRole: MultiplayerRole;
  secretAudioRef: MutableRef<HTMLAudioElement | null>;
  createOrUpdateRemotePlayer: (clientId: string, data: any) => void;
  resizeArena: (playerCount: number) => void;
  pushStatsUpdate: () => void;
  rebuildHostModel: (hue: number) => void;
  rebuildEnemyModel: (hue: number) => void;
  spawnVoxelShockwaveParticles: (impactCenter: THREE.Vector3, color: string) => void;
  renderHammerSplashVfx: (impactCenter: THREE.Vector3, color: string, radius: number) => void;
  triggerEnemyHammerSwing: () => void;
  triggerEnemyHammerMelee: () => void;
  triggerEnemySwordSlash: () => void;
  triggerEnemySwordLunge: (customDir?: THREE.Vector3) => void;
  recordPlayerDamageTaken: () => void;
  playSwing: () => void;
  playDash: () => void;
  playDeath: () => void;
  onPauseToggle: () => void;
}): (event: MessageEvent) => void {
  return (event: MessageEvent) => {
    try {
      const data = JSON.parse(event.data);
      const state = stateRef.current;

      if (data.type === 'connected') {
        if (data.hostClientId) {
          state.hostClientId = data.hostClientId;
        }
        if (data.clientClientId) {
          state.clientClientId = data.clientClientId;
        }
        if (Array.isArray(data.otherPlayers)) {
          data.otherPlayers.forEach((player: any) => {
            if (typeof player?.clientId === 'string') {
              createOrUpdateRemotePlayer(player.clientId, {
                hp: 1,
                role: player.role,
                spawnSlot: player.spawnSlot,
                playerName: player.playerName,
              });
            }
          });
          resizeArena(1 + state.otherPlayers.size);
          pushStatsUpdate();
        } else if (data.otherPlayerIds && Array.isArray(data.otherPlayerIds)) {
          data.otherPlayerIds.forEach((id: string, index: number) => {
            if (id !== data.clientClientId) {
              createOrUpdateRemotePlayer(id, { hp: 1, spawnSlot: index + 1 });
            }
          });
          resizeArena(1 + state.otherPlayers.size);
          pushStatsUpdate();
        }
      } else if (data.type === 'player_joined') {
        createOrUpdateRemotePlayer(data.clientId, data);
        resizeArena(1 + state.otherPlayers.size);
        pushStatsUpdate();
      } else if (data.type === 'player_left') {
        const scene = refs.scene;
        const clientId = data.leftPlayerId;
        if (state.otherPlayers.has(clientId)) {
          state.otherPlayers.delete(clientId);
        }
        const meshes = refs.otherPlayerMeshes.get(clientId);
        if (meshes) {
          if (scene && meshes.group) {
            scene.remove(meshes.group);
          }
          refs.otherPlayerMeshes.delete(clientId);
        }
        resizeArena(1 + state.otherPlayers.size);
        pushStatsUpdate();
      } else if (data.type === 'sync') {
        if (data.action === 'unlock_secret') {
          if (secretAudioRef.current) {
            secretAudioRef.current.pause();
          }
          const audio = new Audio('/Saudi Smurf Allah.mp3');
          audio.volume = 0.55;
          audio.play().catch((e) => console.error('Error playing secret song:', e));
          secretAudioRef.current = audio;

          if (data.senderId && state.otherPlayers.has(data.senderId)) {
            const player = state.otherPlayers.get(data.senderId);
            if (player) {
              (player as any).activeWeapon = 'pistol';
              const meshes = refs.otherPlayerMeshes.get(data.senderId);
              if (meshes) {
                meshes.hammer.visible = false;
                meshes.sword.visible = false;
              }
              const announcement: DeathEvent = {
                id: Math.random().toString(36).substring(2, 9),
                attacker: 'SECRET UNLOCKED',
                victim: `${player.playerName || 'Blue'} equipped GRIFB Pistol!`,
                weapon: 'sword',
              };
              state.lastDeaths = [announcement, ...state.lastDeaths].slice(0, 3);
              spawnVoxelShockwaveParticles(new THREE.Vector3(player.pos.x, player.pos.y, player.pos.z), '#38bdf8');
              spawnVoxelShockwaveParticles(new THREE.Vector3(player.pos.x, player.pos.y, player.pos.z), '#fffa00');
            }
          }
          pushStatsUpdate();
        } else if (data.action === 'swing_hammer') {
          if (data.senderId) {
            const player = state.otherPlayers.get(data.senderId);
            if (player) {
              player.weaponState = 'swing_up';
              player.weaponTimer = 0;
              player.lastHammerAttackTime = Date.now();
              playSwing();
            }
          } else {
            triggerEnemyHammerSwing();
          }
        } else if (data.action === 'melee_hammer') {
          if (data.senderId) {
            const player = state.otherPlayers.get(data.senderId);
            if (player) {
              player.weaponState = 'melee_swing';
              player.weaponTimer = 0;
              player.lastHammerAttackTime = Date.now();
              playSwing();

              const lookHeading = new THREE.Vector3(0, 0, -1)
                .applyAxisAngle(new THREE.Vector3(0, 1, 0), player.yaw)
                .normalize();
              const eyePos = new THREE.Vector3(player.pos.x, player.pos.y + 1.2, player.pos.z);
              const meleePos = eyePos.clone().addScaledVector(lookHeading, 1.8);
              spawnVoxelShockwaveParticles(meleePos, '#38bdf8');
            }
          } else {
            triggerEnemyHammerMelee();
          }
        } else if (data.action === 'hammer_impact') {
          if (data.pos) {
            const impactPos = new THREE.Vector3(
              Number(data.pos.x) || 0,
              Number(data.pos.y) || 0,
              Number(data.pos.z) || 0
            );
            const radius = typeof data.radius === 'number' ? data.radius : (state.settings.attackRadius ?? 4.5);
            renderHammerSplashVfx(impactPos, '#f97316', radius);
          }
        } else if (data.action === 'slash_sword') {
          if (data.senderId) {
            const player = state.otherPlayers.get(data.senderId);
            if (player) {
              player.weaponState = 'swing_up';
              player.weaponTimer = 0;
              player.lastSwordAttackTime = Date.now();
              playSwing();

              const lookHeading = new THREE.Vector3(0, 0, -1)
                .applyAxisAngle(new THREE.Vector3(0, 1, 0), player.yaw)
                .normalize();
              const eyePos = new THREE.Vector3(player.pos.x, player.pos.y + 1.2, player.pos.z);
              const slashPos = eyePos.clone().addScaledVector(lookHeading, 1.8);

              spawnVoxelShockwaveParticles(slashPos, '#ef4444');
            }
          } else {
            triggerEnemySwordSlash();
          }
        } else if (data.action === 'lunge_sword') {
          if (data.senderId) {
            const player = state.otherPlayers.get(data.senderId);
            if (player) {
              player.weaponState = 'ready';
              player.weaponTimer = 0;
              player.isLunging = true;
              player.lungeTimer = 0;
              player.lastSwordAttackTime = Date.now();
              playDash();
            }
          } else {
            const lungeDir = data.dir ? new THREE.Vector3(data.dir.x, data.dir.y, data.dir.z) : undefined;
            triggerEnemySwordLunge(lungeDir);
          }
        } else if (data.action === 'hit_taken') {
          if (data.targetId && state.otherPlayers.has(data.targetId)) {
            const targetPlayer = state.otherPlayers.get(data.targetId);
            if (targetPlayer) {
              targetPlayer.hp = Math.max(0, targetPlayer.hp - (data.damage || 1));
              if (targetPlayer.hp <= 0) {
                targetPlayer.hp = 0;
                targetPlayer.respawnTimer = 3.0;
                targetPlayer.deaths += 1;
                if (data.senderId) {
                  const attacker = state.otherPlayers.get(data.senderId);
                  if (attacker) {
                    attacker.score = (attacker.score || 0) + 1;
                    attacker.kills = (attacker.kills || 0) + 1;
                  } else {
                    state.scorePlayer += 1;
                    state.playerKills += 1;
                  }
                }
                playDeath();
                const newDeath: DeathEvent = {
                  id: Math.random().toString(36).substring(2, 9),
                  attacker: data.senderId
                    ? (state.otherPlayers.get(data.senderId)?.playerName || state.settings.playerName || 'Blue (You)')
                    : 'Player',
                  victim: targetPlayer.playerName,
                  weapon: data.weapon || 'sword',
                };
                state.lastDeaths = [newDeath, ...state.lastDeaths].slice(0, 3);
                const attacker = data.senderId ? state.otherPlayers.get(data.senderId) : undefined;
                queueReplayHeatmapDeathEventsForState({
                  state,
                  attacker: attacker
                    ? createReplayHeatmapCombatantSource(data.senderId, attacker)
                    : createReplayHeatmapCombatantSource('player', undefined, {
                        team: state.localPlayerTeam,
                        pos: state.playerPos,
                      }),
                  victim: createReplayHeatmapCombatantSource(data.targetId, targetPlayer),
                  weapon: data.weapon || 'sword',
                });
                spawnVoxelShockwaveParticles(
                  new THREE.Vector3(targetPlayer.pos.x, targetPlayer.pos.y, targetPlayer.pos.z),
                  '#ef4444'
                );
              } else {
                playSwing();
                spawnVoxelShockwaveParticles(
                  new THREE.Vector3(targetPlayer.pos.x, targetPlayer.pos.y, targetPlayer.pos.z),
                  '#e2e8f0'
                );
              }
            }
          } else if (state.playerHP > 0 && state.playerInvulnerabilityTimer <= 0) {
            recordPlayerDamageTaken();
            state.playerHP -= data.damage || 1;
            if (state.playerHP <= 0) {
              state.playerHP = 0;
              state.playerRespawnTimer = 3.0;
              state.playerDeaths += 1;
              state.scoreEnemy += 1;
              state.enemyKills += 1;
              if (data.senderId) {
                const attacker = state.otherPlayers.get(data.senderId);
                if (attacker) {
                  attacker.score = (attacker.score || 0) + 1;
                  attacker.kills = (attacker.kills || 0) + 1;
                }
              }
              playDeath();
              const newDeath: DeathEvent = {
                id: Math.random().toString(36).substring(2, 9),
                attacker: data.senderId ? (state.otherPlayers.get(data.senderId)?.playerName || 'Player') : 'Player',
                victim: state.settings.playerName || 'Blue (You)',
                weapon: data.weapon || 'sword',
              };
              state.lastDeaths = [newDeath, ...state.lastDeaths].slice(0, 3);
              const attacker = data.senderId ? state.otherPlayers.get(data.senderId) : undefined;
              queueReplayHeatmapDeathEventsForState({
                state,
                attacker: createReplayHeatmapCombatantSource(data.senderId || 'remote', attacker),
                victim: createReplayHeatmapCombatantSource('player', undefined, {
                  team: state.localPlayerTeam,
                  pos: state.playerPos,
                }),
                weapon: data.weapon || 'sword',
              });
              spawnVoxelShockwaveParticles(state.playerPos, '#ef4444');
            } else {
              playSwing();
              spawnVoxelShockwaveParticles(state.playerPos, '#e2e8f0');
            }
          }
          pushStatsUpdate();
        } else if (multiplayerRole === 'observer') {
          if (data.senderRole === 'host') {
            if (data.pos) state.hostPos.set(data.pos.x, data.pos.y, data.pos.z);
            if (data.vel) state.hostVel.set(data.vel.x, data.vel.y, data.vel.z);
            if (data.yaw !== undefined) state.hostYaw = data.yaw;
            if (data.pitch !== undefined) state.hostPitch = data.pitch;
            if (data.hp !== undefined) state.hostHP = data.hp;
            if (data.maxHp !== undefined) state.hostMaxHP = data.maxHp;
            if (data.isCrouching !== undefined) state.hostIsCrouching = data.isCrouching;
            if (data.activeWeapon !== undefined) state.hostActiveWeapon = data.activeWeapon;
            if (data.respawnTimer !== undefined) state.hostRespawnTimer = data.respawnTimer;
            if (data.playerName !== undefined) state.hostPlayerName = data.playerName;
            if (data.hue !== undefined && data.hue !== state.hostHue) {
              state.hostHue = data.hue;
              rebuildHostModel(data.hue);
            }

            if (data.scoreHost !== undefined) state.scorePlayer = data.scoreHost;
            if (data.scoreClient !== undefined) state.scoreEnemy = data.scoreClient;
            if (data.killsHost !== undefined) state.playerKills = data.killsHost;
            if (data.deathsHost !== undefined) state.playerDeaths = data.deathsHost;
            if (data.killsClient !== undefined) state.enemyKills = data.killsClient;
            if (data.deathsClient !== undefined) state.enemyDeaths = data.deathsClient;
            if (data.gameTime !== undefined) state.gameTime = data.gameTime;
          } else if (data.senderRole === 'client') {
            if (data.pos) state.clientPos.set(data.pos.x, data.pos.y, data.pos.z);
            if (data.vel) state.clientVel.set(data.vel.x, data.vel.y, data.vel.z);
            if (data.yaw !== undefined) state.clientYaw = data.yaw;
            if (data.pitch !== undefined) state.clientPitch = data.pitch;
            if (data.hp !== undefined) state.clientHP = data.hp;
            if (data.maxHp !== undefined) state.clientMaxHP = data.maxHp;
            if (data.isCrouching !== undefined) state.clientIsCrouching = data.isCrouching;
            if (data.activeWeapon !== undefined) state.clientActiveWeapon = data.activeWeapon;
            if (data.respawnTimer !== undefined) state.clientRespawnTimer = data.respawnTimer;
            if (data.playerName !== undefined) state.clientPlayerName = data.playerName;
            if (data.hue !== undefined && data.hue !== state.clientHue) {
              state.clientHue = data.hue;
              rebuildEnemyModel(data.hue);
            }
          }
        } else {
          if (data.senderId) {
            createOrUpdateRemotePlayer(data.senderId, data);
          }

          if (multiplayerRole === 'client') {
            if (data.scoreHost !== undefined) state.scoreEnemy = data.scoreHost;
            if (data.scoreClient !== undefined) state.scorePlayer = data.scoreClient;
            if (data.killsHost !== undefined) state.enemyKills = data.killsHost;
            if (data.deathsHost !== undefined) state.enemyDeaths = data.deathsHost;
            if (data.killsClient !== undefined) state.playerKills = data.killsClient;
            if (data.deathsClient !== undefined) state.playerDeaths = data.deathsClient;
            if (data.gameTime !== undefined) state.gameTime = data.gameTime;
          }
        }
      } else if (data.type === 'disconnected') {
        alert(data.reason || 'Opponent disconnected from match.');
        onPauseToggle();
      }
    } catch (err) {
      console.error('Error handling WebSocket synchronization logic:', err);
    }
  };
}
