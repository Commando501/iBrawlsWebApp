/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useRef, useEffect, useState } from 'react';
import * as THREE from 'three';
import { sfx } from './AudioEngine';
import { buildGravityHammerModel, buildVoxelSpartanModel, buildKatarSwordModel } from './VoxelModels';
import { GameStats, Stance, WeaponState, AIBehaviorState, UniversalSettings, DeathEvent } from '../types';

const whiteBlinkMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff });

interface GrifballGameProps {
  isPlaying: boolean;
  isPaused: boolean;
  debugMode: boolean;
  adminSettings: UniversalSettings;
  onStatsUpdate: (stats: GameStats) => void;
  onPauseToggle: () => void;
  isMultiplayer?: boolean;
  multiplayerRole?: 'host' | 'client' | null;
  multiplayerSocket?: WebSocket | null;
  opponentClientId?: string;
}

export const GrifballGame: React.FC<GrifballGameProps> = ({
  isPlaying,
  isPaused,
  debugMode,
  adminSettings,
  onStatsUpdate,
  onPauseToggle,
  isMultiplayer = false,
  multiplayerRole = null,
  multiplayerSocket = null,
  opponentClientId = '',
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const nameplateRef = useRef<HTMLDivElement>(null);
  const requestRef = useRef<number | null>(null);

  // Core Game State refs to avoid state-delay in the animation/render loop
  const stateRef = useRef<{
    playerPos: THREE.Vector3;
    playerVel: THREE.Vector3;
    yaw: number;
    pitch: number;
    crouchAmount: number;
    isCrouching: boolean;
    isJumping: boolean;

    // Dash states
    playerDashRemaining: number;
    playerDashDir: THREE.Vector3;
    playerDashCooldownTimer: number;

    aiDashRemaining: number;
    aiDashDir: THREE.Vector3;
    aiDashCooldownTimer: number;

    // Hammer states
    pWeaponState: WeaponState;
    pWeaponTimer: number; // current phase time
    pWeaponCooldown?: number; // define optional cooldown tracking
    pWeaponReady: boolean;

    // Sword & Combat states
    activeWeapon: 'hammer' | 'sword';
    crosshairColor: 'white' | 'red';
    isLunging: boolean;
    lungeTimer: number;
    lungeStartPos: THREE.Vector3;
    lungeTargetDir: THREE.Vector3;
    pSwordState: 'ready' | 'slashing' | 'recovering';
    pSwordTimer: number;
    pSwordReady: boolean;
    pSwordCooldown: number;
    pSwordRecoverDuration: number;
    lastPlayerSwordAttackTime: number;
    lastAISwordAttackTime: number;
    lastPlayerHammerAttackTime: number;
    lastAIHammerAttackTime: number;

    // AI states
    aiPos: THREE.Vector3;
    aiVel: THREE.Vector3;
    aiYaw: number;
    aiHP: number;
    aiMaxHP: number;
    aiState: AIBehaviorState;
    aiTimer: number; // for fencing actions
    aiSwayTimer: number;
    aiWeaponState: WeaponState;
    aiWeaponTimer: number;
    aiIsCrouching: boolean;
    aiActiveWeapon: 'hammer' | 'sword';
    aiSwordState: 'ready' | 'slashing' | 'recovering';
    aiSwordTimer: number;
    aiSwordReady: boolean;
    aiIsLunging: boolean;
    aiLungeTimer: number;
    aiLungeStartPos: THREE.Vector3;
    aiLungeTargetDir: THREE.Vector3;

    // Player stats
    playerHP: number;
    playerMaxHP: number;
    scorePlayer: number;
    scoreEnemy: number;
    playerKills: number;
    playerDeaths: number;
    enemyKills: number;
    enemyDeaths: number;
    showScoreboard: boolean;
    playerRespawnTimer: number;
    enemyRespawnTimer: number;
    playerInvulnerabilityTimer: number;
    aiInvulnerabilityTimer: number;

    // Match timers
    gameTime: number;

    // Checking/Debug UI
    debugMode: boolean;
    lastStrikePos: THREE.Vector3 | null;
    lastStrikeTick: number; // visual timer
    lastAIStrikePos: THREE.Vector3 | null;
    lastAIStrikeTick: number;

    // Hammer Jumping States
    pHammerJumpWindowTimer: number;
    aiHammerJumpWindowTimer: number;
    aiIsJumping: boolean;
    aiHammerJumpPlanned: boolean;
    aiHammerJumpType?: 'offensive' | 'defensive';

    // Arena configs
    arenaRadius: number;
    settings: UniversalSettings;
    lastDeaths: DeathEvent[];

    // Spectator properties
    isObserverMode: boolean;
    observerCamMode: 'free' | 'third' | 'first';
    observerTarget: 'host' | 'client';
    observerOrbitDistance: number;
    hostPos: THREE.Vector3;
    hostVel: THREE.Vector3;
    hostYaw: number;
    hostPitch: number;
    hostHP: number;
    hostMaxHP: number;
    hostIsCrouching: boolean;
    hostActiveWeapon: 'hammer' | 'sword';
    hostRespawnTimer: number;
    hostPlayerName: string;
    hostHue: number;
    clientPos: THREE.Vector3;
    clientVel: THREE.Vector3;
    clientYaw: number;
    clientPitch: number;
    clientHP: number;
    clientMaxHP: number;
    clientIsCrouching: boolean;
    clientActiveWeapon: 'hammer' | 'sword';
    clientRespawnTimer: number;
    clientPlayerName: string;
    clientHue: number;
    otherPlayers: Map<string, any>;
  }>({
    playerPos: new THREE.Vector3(0, 0, 12), // Start at z=12
    playerVel: new THREE.Vector3(0, 0, 0),
    yaw: Math.PI, // Looking towards center (z=12 means look at -z, which is pi)
    pitch: 0,
    crouchAmount: 0,
    isCrouching: false,
    isJumping: false,
    otherPlayers: new Map<string, any>(),

    // Dash states
    playerDashRemaining: 0,

    playerDashDir: new THREE.Vector3(0, 0, 0),
    playerDashCooldownTimer: 0,

    aiDashRemaining: 0,
    aiDashDir: new THREE.Vector3(0, 0, 0),
    aiDashCooldownTimer: 0,

    pWeaponState: 'ready',
    pWeaponTimer: 0,
    pWeaponReady: true,

    // Sword & Combat setups
    activeWeapon: 'hammer',
    crosshairColor: 'white',
    isLunging: false,
    lungeTimer: 0,
    lungeStartPos: new THREE.Vector3(),
    lungeTargetDir: new THREE.Vector3(),
    pSwordState: 'ready',
    pSwordTimer: 0,
    pSwordReady: true,
    pSwordCooldown: 1.0,
    pSwordRecoverDuration: 0.6,
    lastPlayerSwordAttackTime: 0,
    lastAISwordAttackTime: 0,
    lastPlayerHammerAttackTime: 0,
    lastAIHammerAttackTime: 0,

    aiPos: new THREE.Vector3(0, 0, -12), // Start opposite side
    aiVel: new THREE.Vector3(0, 0, 0),
    aiYaw: 0, // Look at player
    aiHP: 1,
    aiMaxHP: 1,
    aiState: 'APPROACHING',
    aiTimer: 0,
    aiSwayTimer: 0,
    aiWeaponState: 'ready',
    aiWeaponTimer: 0,
    aiIsCrouching: false,
    aiActiveWeapon: 'hammer',
    aiSwordState: 'ready',
    aiSwordTimer: 0,
    aiSwordReady: true,
    aiIsLunging: false,
    aiLungeTimer: 0,
    aiLungeStartPos: new THREE.Vector3(),
    aiLungeTargetDir: new THREE.Vector3(),

    playerHP: 1,
    playerMaxHP: 1,
    scorePlayer: 0,
    scoreEnemy: 0,
    playerKills: 0,
    playerDeaths: 0,
    enemyKills: 0,
    enemyDeaths: 0,
    showScoreboard: false,
    playerRespawnTimer: 0,
    enemyRespawnTimer: 0,
    playerInvulnerabilityTimer: 0,
    aiInvulnerabilityTimer: 0,

    gameTime: 522, // 8:42 standard starting count (in seconds)

    debugMode: debugMode,
    lastStrikePos: null,
    lastStrikeTick: 0,
    lastAIStrikePos: null,
    lastAIStrikeTick: 0,

    pHammerJumpWindowTimer: 0,
    aiHammerJumpWindowTimer: 0,
    aiIsJumping: false,
    aiHammerJumpPlanned: false,

    arenaRadius: 20, // 20m circle
    settings: adminSettings,
    lastDeaths: [],

    isObserverMode: false,
    observerCamMode: 'free',
    observerTarget: 'host',
    observerOrbitDistance: 5.0,
    hostPos: new THREE.Vector3(0, 0, 12),
    hostVel: new THREE.Vector3(0, 0, 0),
    hostYaw: Math.PI,
    hostPitch: 0,
    hostHP: 1,
    hostMaxHP: 1,
    hostIsCrouching: false,
    hostActiveWeapon: 'hammer',
    hostRespawnTimer: 0,
    hostPlayerName: 'Blue (Host)',
    hostHue: 200,
    clientPos: new THREE.Vector3(0, 0, -12),
    clientVel: new THREE.Vector3(0, 0, 0),
    clientYaw: 0,
    clientPitch: 0,
    clientHP: 1,
    clientMaxHP: 1,
    clientIsCrouching: false,
    clientActiveWeapon: 'hammer',
    clientRespawnTimer: 0,
    clientPlayerName: 'Red (Guest)',
    clientHue: 200,
  });

  // Keep debug mode ref in sync
  useEffect(() => {
    stateRef.current.debugMode = debugMode;
  }, [debugMode]);

  // Handle multiplayer game synchronization logic
  useEffect(() => {
    const s = stateRef.current;
    s.isObserverMode = (multiplayerRole === 'observer');

    // Clean up or configure first person weapons
    if (s.isObserverMode) {
      if (threeRef.current.playerHammer) threeRef.current.playerHammer.visible = false;
      if (threeRef.current.playerSword) threeRef.current.playerSword.visible = false;
      
      // Default observer vantage point overlooking the center of the arena
      s.playerPos.set(0, 6, 17);
      s.yaw = Math.PI;
      s.pitch = -0.3;
    } else {
      if (threeRef.current.playerHammer) threeRef.current.playerHammer.visible = s.activeWeapon === 'hammer';
      if (threeRef.current.playerSword) threeRef.current.playerSword.visible = s.activeWeapon === 'sword';
      
      // Remove hostGroup if transitioning back to active player
      const scene = threeRef.current.scene;
      if (scene && threeRef.current.hostGroup) {
        scene.remove(threeRef.current.hostGroup);
        threeRef.current.hostGroup = null;
      }
    }

    if (isMultiplayer) {
      if (multiplayerRole === 'client') {
        s.playerPos.set(0, 0, -12);
        s.yaw = 0;
        s.aiPos.set(0, 0, 12);
        s.aiYaw = Math.PI;
      } else if (multiplayerRole === 'host') {
        s.playerPos.set(0, 0, 12);
        s.yaw = Math.PI;
        s.aiPos.set(0, 0, -12);
        s.aiYaw = 0;
      }
    }

    if (isMultiplayer && multiplayerSocket) {
      const handleWsMessage = (event: MessageEvent) => {
        try {
          const data = JSON.parse(event.data);
          const s = stateRef.current;

          if (data.type === 'connected') {
            if (data.otherPlayerIds && Array.isArray(data.otherPlayerIds)) {
              data.otherPlayerIds.forEach((id: string) => {
                if (id !== data.clientClientId) {
                  createOrUpdateRemotePlayer(id, { hp: 1 });
                }
              });
              resizeArena(1 + s.otherPlayers.size);
              pushStatsUpdate();
            }
          } else if (data.type === 'player_joined') {
            createOrUpdateRemotePlayer(data.clientId, data);
            resizeArena(1 + s.otherPlayers.size);
            pushStatsUpdate();
          } else if (data.type === 'player_left') {
            const scene = threeRef.current.scene;
            const clientId = data.leftPlayerId;
            if (s.otherPlayers.has(clientId)) {
              s.otherPlayers.delete(clientId);
            }
            const meshes = threeRef.current.otherPlayerMeshes.get(clientId);
            if (meshes) {
              if (scene && meshes.group) {
                scene.remove(meshes.group);
              }
              threeRef.current.otherPlayerMeshes.delete(clientId);
            }
            resizeArena(1 + s.otherPlayers.size);
            pushStatsUpdate();
          } else if (data.type === 'sync') {
            if (data.action === 'swing_hammer') {
              if (data.senderId) {
                const player = s.otherPlayers.get(data.senderId);
                if (player) {
                  player.weaponState = 'swing_up';
                  player.weaponTimer = 0;
                  sfx.playSwing();
                }
              } else {
                triggerEnemyHammerSwing();
              }
            } else if (data.action === 'slash_sword') {
              if (data.senderId) {
                const player = s.otherPlayers.get(data.senderId);
                if (player) {
                  player.weaponState = 'swing_up';
                  player.weaponTimer = 0;
                  sfx.playSwing();
                }
              } else {
                triggerEnemySwordSlash();
              }
            } else if (data.action === 'lunge_sword') {
              if (data.senderId) {
                const player = s.otherPlayers.get(data.senderId);
                if (player) {
                  player.weaponState = 'ready';
                  player.weaponTimer = 0;
                  sfx.playDash();
                }
              } else {
                const lungeDir = data.dir ? new THREE.Vector3(data.dir.x, data.dir.y, data.dir.z) : undefined;
                triggerEnemySwordLunge(lungeDir);
              }
            } else if (data.action === 'hit_taken') {
              // Differentiate target
              if (data.targetId && s.otherPlayers.has(data.targetId)) {
                const targetPlayer = s.otherPlayers.get(data.targetId);
                if (targetPlayer) {
                  targetPlayer.hp = Math.max(0, targetPlayer.hp - (data.damage || 1));
                  if (targetPlayer.hp <= 0) {
                    targetPlayer.hp = 0;
                    targetPlayer.respawnTimer = 3.0;
                    targetPlayer.deaths += 1;
                    if (data.senderId) {
                      const attacker = s.otherPlayers.get(data.senderId);
                      if (attacker) {
                        attacker.score = (attacker.score || 0) + 1;
                        attacker.kills = (attacker.kills || 0) + 1;
                      }
                    }
                    sfx.playDeath();
                    const newDeath: DeathEvent = {
                      id: Math.random().toString(36).substring(2, 9),
                      attacker: data.senderId ? (s.otherPlayers.get(data.senderId)?.playerName || 'Player') : 'Player',
                      victim: targetPlayer.playerName,
                    };
                    s.lastDeaths = [newDeath, ...s.lastDeaths].slice(0, 3);
                    spawnVoxelShockwaveParticles(new THREE.Vector3(targetPlayer.pos.x, targetPlayer.pos.y, targetPlayer.pos.z), '#ef4444');
                  } else {
                    sfx.playSwing();
                    spawnVoxelShockwaveParticles(new THREE.Vector3(targetPlayer.pos.x, targetPlayer.pos.y, targetPlayer.pos.z), '#e2e8f0');
                  }
                }
              } else {
                // Otherwise targeted at the local player!
                if (s.playerHP > 0 && s.playerInvulnerabilityTimer <= 0) {
                  s.playerHP -= data.damage || 1;
                  if (s.playerHP <= 0) {
                    s.playerHP = 0;
                    s.playerRespawnTimer = 3.0;
                    s.playerDeaths += 1;
                    if (data.senderId) {
                      const attacker = s.otherPlayers.get(data.senderId);
                      if (attacker) {
                        attacker.score = (attacker.score || 0) + 1;
                        attacker.kills = (attacker.kills || 0) + 1;
                      }
                    }
                    sfx.playDeath();
                    const newDeath: DeathEvent = {
                      id: Math.random().toString(36).substring(2, 9),
                      attacker: data.senderId ? (s.otherPlayers.get(data.senderId)?.playerName || 'Player') : 'Player',
                      victim: s.settings.playerName || 'Blue (You)',
                    };
                    s.lastDeaths = [newDeath, ...s.lastDeaths].slice(0, 3);
                    spawnVoxelShockwaveParticles(s.playerPos, '#ef4444');
                  } else {
                    sfx.playSwing();
                    spawnVoxelShockwaveParticles(s.playerPos, '#e2e8f0');
                  }
                }
              }
              pushStatsUpdate();
            } else {
              if (multiplayerRole === 'observer') {
                if (data.senderRole === 'host') {
                  if (data.pos) s.hostPos.set(data.pos.x, data.pos.y, data.pos.z);
                  if (data.vel) s.hostVel.set(data.vel.x, data.vel.y, data.vel.z);
                  if (data.yaw !== undefined) s.hostYaw = data.yaw;
                  if (data.pitch !== undefined) s.hostPitch = data.pitch;
                  if (data.hp !== undefined) s.hostHP = data.hp;
                  if (data.maxHp !== undefined) s.hostMaxHP = data.maxHp;
                  if (data.isCrouching !== undefined) s.hostIsCrouching = data.isCrouching;
                  if (data.activeWeapon !== undefined) s.hostActiveWeapon = data.activeWeapon;
                  if (data.respawnTimer !== undefined) s.hostRespawnTimer = data.respawnTimer;
                  if (data.playerName !== undefined) s.hostPlayerName = data.playerName;
                  if (data.hue !== undefined && data.hue !== s.hostHue) {
                    s.hostHue = data.hue;
                    rebuildHostModel(data.hue);
                  }

                  // Scoreboard syncing from authoritative Host to Spectator
                  if (data.scoreHost !== undefined) s.scorePlayer = data.scoreHost;
                  if (data.scoreClient !== undefined) s.scoreEnemy = data.scoreClient;
                  if (data.killsHost !== undefined) s.playerKills = data.killsHost;
                  if (data.deathsHost !== undefined) s.playerDeaths = data.deathsHost;
                  if (data.killsClient !== undefined) s.enemyKills = data.killsClient;
                  if (data.deathsClient !== undefined) s.playerDeaths = data.deathsClient;
                  if (data.gameTime !== undefined) s.gameTime = data.gameTime;
                } else if (data.senderRole === 'client') {
                  if (data.pos) s.clientPos.set(data.pos.x, data.pos.y, data.pos.z);
                  if (data.vel) s.clientVel.set(data.vel.x, data.vel.y, data.vel.z);
                  if (data.yaw !== undefined) s.clientYaw = data.yaw;
                  if (data.pitch !== undefined) s.clientPitch = data.pitch;
                  if (data.hp !== undefined) s.clientHP = data.hp;
                  if (data.maxHp !== undefined) s.clientMaxHP = data.maxHp;
                  if (data.isCrouching !== undefined) s.clientIsCrouching = data.isCrouching;
                  if (data.activeWeapon !== undefined) s.clientActiveWeapon = data.activeWeapon;
                  if (data.respawnTimer !== undefined) s.clientRespawnTimer = data.respawnTimer;
                  if (data.playerName !== undefined) s.clientPlayerName = data.playerName;
                  if (data.hue !== undefined && data.hue !== s.clientHue) {
                    s.clientHue = data.hue;
                    rebuildEnemyModel(data.hue); // Client is Red (EnemyGroup)
                  }
                }
              } else {
                // Gameplay coordinates synchronization packet
                if (data.senderId) {
                  createOrUpdateRemotePlayer(data.senderId, data);
                }

                // Override local scores from Host (single authoritative master index)
                if (multiplayerRole === 'client') {
                  if (data.scoreHost !== undefined) s.scoreEnemy = data.scoreHost;
                  if (data.scoreClient !== undefined) s.scorePlayer = data.scoreClient;
                  if (data.killsHost !== undefined) s.enemyKills = data.killsHost;
                  if (data.deathsHost !== undefined) s.enemyDeaths = data.deathsHost;
                  if (data.killsClient !== undefined) s.playerKills = data.killsClient;
                  if (data.deathsClient !== undefined) s.playerDeaths = data.deathsClient;
                  if (data.gameTime !== undefined) s.gameTime = data.gameTime;
                }
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

      multiplayerSocket.addEventListener('message', handleWsMessage);
      return () => {
        multiplayerSocket.removeEventListener('message', handleWsMessage);
      };
    }
  }, [isMultiplayer, multiplayerRole, multiplayerSocket]);

  // Keep admin settings in sync with real-time reactive sliding parameters
  useEffect(() => {
    const s = stateRef.current;
    
    // Scale current player/enemy HP if they were at full status
    const prevMax = s.playerMaxHP;
    s.playerMaxHP = adminSettings.maxHP;
    if (s.playerHP === prevMax) {
      s.playerHP = adminSettings.maxHP;
    } else {
      s.playerHP = Math.min(s.playerHP, adminSettings.maxHP);
    }

    s.aiMaxHP = adminSettings.maxHP;
    if (s.aiHP === prevMax) {
      s.aiHP = adminSettings.maxHP;
    } else {
      s.aiHP = Math.min(s.aiHP, adminSettings.maxHP);
    }

    s.settings = adminSettings;

    if (threeRef.current.ambientLight) {
      threeRef.current.ambientLight.intensity = adminSettings.ambientLightIntensity !== undefined ? adminSettings.ambientLightIntensity : 0.82;
    }
    if (threeRef.current.dirLight) {
      threeRef.current.dirLight.intensity = adminSettings.directLightIntensity !== undefined ? adminSettings.directLightIntensity : 1.6;
    }
    if (threeRef.current.scene) {
      const hue = adminSettings.skyboxHue !== undefined ? adminSettings.skyboxHue : 224;
      const brightness = adminSettings.skyboxBrightness !== undefined ? adminSettings.skyboxBrightness : 4;
      const colorString = `hsl(${hue}, 70%, ${brightness}%)`;
      const finalColor = new THREE.Color(colorString);
      threeRef.current.scene.background = finalColor;
      if (threeRef.current.scene.fog) {
        threeRef.current.scene.fog.color.copy(finalColor);
      }
    }
  }, [adminSettings]);

  const onStatsUpdateRef = useRef(onStatsUpdate);
  useEffect(() => {
    onStatsUpdateRef.current = onStatsUpdate;
  }, [onStatsUpdate]);

  // Keys active dictionary
  const keysPressed = useRef<{ [key: string]: boolean }>({});
  
  // Custom Fallback Mouse support (Drag to view if Pointer Lock fails or is denied)
  const isPointerLocked = useRef<boolean>(false);
  const isMouseDown = useRef<boolean>(false);
  const lastMousePos = useRef<{ x: number; y: number }>({ x: 0, y: 0 });

  // References to THREE objects needed inside loop
  const threeRef = useRef<{
    scene: THREE.Scene | null;
    camera: THREE.PerspectiveCamera | null;
    renderer: THREE.WebGLRenderer | null;
    playerHammer: THREE.Group | null;
    playerSword: THREE.Group | null;
    enemyGroup: THREE.Group | null;
    enemyHammer: THREE.Group | null;
    enemySword: THREE.Group | null;
    hostGroup: THREE.Group | null;
    hostHammer: THREE.Group | null;
    hostSword: THREE.Group | null;
    debugPlayerSphere: THREE.Mesh | null;
    debugEnemySphere: THREE.Mesh | null;
    playerJumpZoneMesh: THREE.Mesh | null;
    ambientLight: THREE.AmbientLight | null;
    dirLight: THREE.DirectionalLight | null;
    damageExplosionParticles: {
      mesh: THREE.Mesh;
      velocity: THREE.Vector3;
      life: number;
      maxLife: number;
    }[];
    otherPlayerMeshes: Map<string, {
      group: THREE.Group;
      hammer: THREE.Group;
      sword: THREE.Group;
    }>;
  }>({
    scene: null,
    camera: null,
    renderer: null,
    playerHammer: null,
    playerSword: null,
    enemyGroup: null,
    enemyHammer: null,
    enemySword: null,
    hostGroup: null,
    hostHammer: null,
    hostSword: null,
    otherPlayerMeshes: new Map(),

    debugPlayerSphere: null,
    debugEnemySphere: null,
    playerJumpZoneMesh: null,
    ambientLight: null,
    dirLight: null,
    damageExplosionParticles: [],
  });

  // Track if mouse/pointer lock instructions should be displayed
  const [showPointerLockAlert, setShowPointerLockAlert] = useState(true);

  // Track opponent's custom hue for rebuilding their Spartan model dynamically
  const lastOpponentHue = useRef<number | null>(null);
  const opponentNameRef = useRef<string>('');

  const getSpectateTargetData = (target: 'host' | 'client') => {
    const s = stateRef.current;
    if (isMultiplayer) {
      if (multiplayerRole === 'observer') {
        // Connected as observer from title screen
        if (target === 'host') {
          return {
            pos: s.hostPos,
            yaw: s.hostYaw,
            pitch: s.hostPitch,
            name: s.hostPlayerName || 'Blue (Host)',
            hp: s.hostHP,
            hue: s.hostHue,
            isCrouching: s.hostIsCrouching,
            activeWeapon: s.hostActiveWeapon
          };
        } else {
          return {
            pos: s.clientPos,
            yaw: s.clientYaw,
            pitch: s.clientPitch,
            name: s.clientPlayerName || 'Red (Guest)',
            hp: s.clientHP,
            hue: s.clientHue,
            isCrouching: s.clientIsCrouching,
            activeWeapon: s.clientActiveWeapon
          };
        }
      } else if (multiplayerRole === 'host') {
        // Host playing or spectating
        if (target === 'host') {
          return {
            pos: s.playerPos,
            yaw: s.yaw,
            pitch: s.pitch,
            name: s.settings.playerName || 'Blue (You - Host)',
            hp: s.playerHP,
            hue: s.settings.playerHue ?? 200,
            isCrouching: s.isCrouching,
            activeWeapon: s.activeWeapon
          };
        } else {
          return {
            pos: s.aiPos,
            yaw: s.aiYaw,
            pitch: s.aiPitch || 0,
            name: opponentNameRef.current || opponentClientId || 'Red (Guest)',
            hp: s.aiHP,
            hue: lastOpponentHue.current ?? 200,
            isCrouching: s.aiIsCrouching,
            activeWeapon: s.aiActiveWeapon
          };
        }
      } else if (multiplayerRole === 'client') {
        // Client playing or spectating
        if (target === 'host') {
          return {
            pos: s.aiPos,
            yaw: s.aiYaw,
            pitch: s.aiPitch || 0,
            name: opponentNameRef.current || opponentClientId || 'Blue (Host)',
            hp: s.aiHP,
            hue: lastOpponentHue.current ?? 200,
            isCrouching: s.aiIsCrouching,
            activeWeapon: s.aiActiveWeapon
          };
        } else {
          return {
            pos: s.playerPos,
            yaw: s.yaw,
            pitch: s.pitch,
            name: s.settings.playerName || 'Red (You - Guest)',
            hp: s.playerHP,
            hue: s.settings.playerHue ?? 200,
            isCrouching: s.isCrouching,
            activeWeapon: s.activeWeapon
          };
        }
      }
    } else {
      // Singleplayer
      if (target === 'host') {
        return {
          pos: s.playerPos,
          yaw: s.yaw,
          pitch: s.pitch,
          name: s.settings.playerName || 'Spartan (You)',
          hp: s.playerHP,
          hue: s.settings.playerHue ?? 200,
          isCrouching: s.isCrouching,
          activeWeapon: s.activeWeapon
        };
      } else {
        return {
          pos: s.aiPos,
          yaw: s.aiYaw,
          pitch: 0,
          name: 'AI Bot',
          hp: s.aiHP,
          hue: 0,
          isCrouching: s.aiIsCrouching,
          activeWeapon: s.aiActiveWeapon
        };
      }
    }
    
    // Fallback
    return {
      pos: new THREE.Vector3(),
      yaw: 0,
      pitch: 0,
      name: 'Unknown',
      hp: 1,
      hue: 200,
      isCrouching: false,
      activeWeapon: 'hammer' as const
    };
  };

  const rebuildEnemyModel = (hue: number) => {
    const s = stateRef.current;
    const scene = threeRef.current.scene;
    if (!scene || !threeRef.current.enemyGroup) return;

    // Remove old group
    scene.remove(threeRef.current.enemyGroup);

    // Build new spartan with custom hue.
    const isEnemyBot = !isMultiplayer;
    const enemyGroup = buildVoxelSpartanModel(isEnemyBot, hue);
    enemyGroup.position.copy(multiplayerRole === 'observer' ? s.clientPos : s.aiPos);
    scene.add(enemyGroup);
    threeRef.current.enemyGroup = enemyGroup;

    // Rebuild & attach hammer
    const enemyHammer = buildGravityHammerModel(isEnemyBot ? undefined : hue);
    enemyHammer.scale.set(0.6, 0.6, 0.6);
    enemyHammer.position.set(0.5, 1.0 - 0.64, -0.4);
    enemyHammer.rotation.set(Math.PI / 2, 0, 0);
    if (enemyGroup.userData.upperTorso) {
      enemyGroup.userData.upperTorso.add(enemyHammer);
    } else {
      enemyGroup.add(enemyHammer);
    }
    threeRef.current.enemyHammer = enemyHammer;

    // Rebuild & attach sword
    const enemySword = buildKatarSwordModel(isEnemyBot ? undefined : hue);
    enemySword.scale.set(0.6, 0.6, 0.6);
    enemySword.position.set(0.5, 1.0 - 0.64, -0.32);
    enemySword.rotation.set(Math.PI / 2, 0, -Math.PI / 8);
    
    const activeWeapon = (multiplayerRole === 'observer') ? s.clientActiveWeapon : s.aiActiveWeapon;
    enemySword.visible = activeWeapon === 'sword';
    enemyHammer.visible = activeWeapon === 'hammer';
    
    if (enemyGroup.userData.upperTorso) {
      enemyGroup.userData.upperTorso.add(enemySword);
    } else {
      enemyGroup.add(enemySword);
    }
    threeRef.current.enemySword = enemySword;
  };

  const rebuildHostModel = (hue: number) => {
    const s = stateRef.current;
    const scene = threeRef.current.scene;
    if (!scene) return;

    if (threeRef.current.hostGroup) {
      scene.remove(threeRef.current.hostGroup);
    }

    // Build Blue team spartan model for Host
    const hostGroup = buildVoxelSpartanModel(false, hue);
    hostGroup.position.copy(multiplayerRole === 'observer' ? s.hostPos : s.playerPos);
    scene.add(hostGroup);
    threeRef.current.hostGroup = hostGroup;

    // Rebuild & attach hammer
    const hostHammer = buildGravityHammerModel(hue);
    hostHammer.scale.set(0.6, 0.6, 0.6);
    hostHammer.position.set(0.5, 1.0 - 0.64, -0.4);
    hostHammer.rotation.set(Math.PI / 2, 0, 0);
    if (hostGroup.userData.upperTorso) {
      hostGroup.userData.upperTorso.add(hostHammer);
    } else {
      hostGroup.add(hostHammer);
    }
    threeRef.current.hostHammer = hostHammer;

    // Rebuild & attach sword
    const hostSword = buildKatarSwordModel(hue);
    hostSword.scale.set(0.6, 0.6, 0.6);
    hostSword.position.set(0.5, 1.0 - 0.64, -0.32);
    hostSword.rotation.set(Math.PI / 2, 0, -Math.PI / 8);
    
    const activeWeapon = (multiplayerRole === 'observer') ? s.hostActiveWeapon : s.activeWeapon;
    hostSword.visible = activeWeapon === 'sword';
    hostHammer.visible = activeWeapon === 'hammer';
    
    if (hostGroup.userData.upperTorso) {
      hostGroup.userData.upperTorso.add(hostSword);
    } else {
      hostGroup.add(hostSword);
    }
    threeRef.current.hostSword = hostSword;
  };

  // Define 8 circular spawn points inside the 20m arena (base radius 13m)
  const SPAWN_POINTS = useRef<THREE.Vector3[]>(
    Array.from({ length: 8 }).map((_, i) => {
      const angle = (i * 2 * Math.PI) / 8;
      return new THREE.Vector3(13 * Math.cos(angle), 0, 13 * Math.sin(angle));
    })
  ).current;

  // Minimax proximity spawning algorithm to select spawn point farthest from threat
  const getOptimalSpawnPoint = (excludePositions: THREE.Vector3[]): THREE.Vector3 => {
    if (excludePositions.length === 0) {
      return SPAWN_POINTS[0].clone();
    }
    let bestPoint = SPAWN_POINTS[0];
    let bestMinDist = -1;
    for (const point of SPAWN_POINTS) {
      let minDist = Infinity;
      for (const entityPos of excludePositions) {
        const d = point.distanceTo(entityPos);
        if (d < minDist) minDist = d;
      }
      if (minDist > bestMinDist) {
        bestMinDist = minDist;
        bestPoint = point;
      }
    }
    return bestPoint.clone();
  };

  // Dynamic arena resizing based on player count (12.5% for every 2 players, up to 50% max)
  const resizeArena = (playerCount: number) => {
    const s = stateRef.current;
    const scene = threeRef.current.scene;
    if (!scene) return;

    const scale = 1.0 + Math.min(0.50, Math.floor((playerCount - 1) / 2) * 0.125);
    s.arenaRadius = 20 * scale;

    // Scale floor cylinder mesh
    scene.traverse((child) => {
      if (child instanceof THREE.Mesh && child.geometry instanceof THREE.CylinderGeometry) {
        if (child.geometry.parameters.radialSegments === 64 && child.geometry.parameters.height === 0.2) {
          child.scale.set(scale, 1, scale);
        }
      }
    });

    // Relocate outer pillars
    scene.traverse((child) => {
      if (child instanceof THREE.Group && child.children.length === 2 && child.parent === scene) {
        const pos = child.position;
        const angle = Math.atan2(pos.z, pos.x);
        const targetRadius = 20.3 * scale;
        child.position.set(Math.cos(angle) * targetRadius, 2, Math.sin(angle) * targetRadius);
      }
    });

    // Recalculate spawn points
    const baseSpawnRadius = 13.0;
    const spawnRadius = baseSpawnRadius * scale;
    SPAWN_POINTS.forEach((p, i) => {
      const angle = (i * 2 * Math.PI) / 8;
      p.set(spawnRadius * Math.cos(angle), 0, spawnRadius * Math.sin(angle));
    });

    console.log(`Arena dynamically scaled for ${playerCount} players. Factor: ${scale}, Radius: ${s.arenaRadius}`);
  };

  // Dynamically maintain multiple opponent Spartan models keyed by clientId/senderId
  const createOrUpdateRemotePlayer = (clientId: string, data: any) => {
    const s = stateRef.current;
    const scene = threeRef.current.scene;
    if (!scene) return;

    let playerState = s.otherPlayers.get(clientId);
    if (!playerState) {
      playerState = {
        id: clientId,
        playerName: data.playerName || `Player ${clientId.substring(0, 4)}`,
        pos: new THREE.Vector3(0, 0, -12),
        vel: new THREE.Vector3(0, 0, 0),
        yaw: 0,
        pitch: 0,
        hp: data.hp !== undefined ? data.hp : 1,
        maxHp: data.maxHp !== undefined ? data.maxHp : 1,
        isCrouching: data.isCrouching || false,
        activeWeapon: data.activeWeapon || 'hammer',
        respawnTimer: data.respawnTimer || 0,
        hue: data.hue !== undefined ? data.hue : Math.floor(Math.random() * 360),
        score: 0,
        kills: 0,
        deaths: 0
      };
      s.otherPlayers.set(clientId, playerState);
    }

    if (data.pos) playerState.pos.set(data.pos.x, data.pos.y, data.pos.z);
    if (data.vel) playerState.vel.set(data.vel.x, data.vel.y, data.vel.z);
    if (data.yaw !== undefined) playerState.yaw = data.yaw;
    if (data.pitch !== undefined) playerState.pitch = data.pitch;
    if (data.hp !== undefined) playerState.hp = data.hp;
    if (data.maxHp !== undefined) playerState.maxHp = data.maxHp;
    if (data.isCrouching !== undefined) playerState.isCrouching = data.isCrouching;
    if (data.activeWeapon !== undefined) playerState.activeWeapon = data.activeWeapon;
    if (data.respawnTimer !== undefined) playerState.respawnTimer = data.respawnTimer;
    if (data.hue !== undefined) playerState.hue = data.hue;
    if (data.playerName) playerState.playerName = data.playerName;

    let meshes = threeRef.current.otherPlayerMeshes.get(clientId);
    if (!meshes) {
      const group = buildVoxelSpartanModel(false, playerState.hue);
      scene.add(group);

      const hammer = buildGravityHammerModel(playerState.hue);
      hammer.scale.set(0.6, 0.6, 0.6);
      hammer.position.set(0.5, 1.0 - 0.64, -0.4);
      hammer.rotation.set(Math.PI / 2, 0, 0);
      if (group.userData.upperTorso) {
        group.userData.upperTorso.add(hammer);
      } else {
        group.add(hammer);
      }

      const sword = buildKatarSwordModel(playerState.hue);
      sword.scale.set(0.6, 0.6, 0.6);
      sword.position.set(0.5, 1.0 - 0.64, -0.32);
      sword.rotation.set(Math.PI / 2, 0, -Math.PI / 8);
      sword.visible = false;
      if (group.userData.upperTorso) {
        group.userData.upperTorso.add(sword);
      } else {
        group.add(sword);
      }

      meshes = { group, hammer, sword };
      threeRef.current.otherPlayerMeshes.set(clientId, meshes);
    }

    const { group, hammer, sword } = meshes;
    group.position.copy(playerState.pos);
    group.rotation.y = playerState.yaw;
    
    if (playerState.isCrouching) {
      group.scale.set(1, 0.65, 1);
    } else {
      group.scale.set(1, 1, 1);
    }

    hammer.visible = playerState.hp > 0 && playerState.respawnTimer <= 0 && playerState.activeWeapon === 'hammer';
    sword.visible = playerState.hp > 0 && playerState.respawnTimer <= 0 && playerState.activeWeapon === 'sword';
    group.visible = playerState.hp > 0 && playerState.respawnTimer <= 0;
  };

  useEffect(() => {
    if (!containerRef.current) return;

    // 1. INITIALIZE THREE.JS
    const scene = new THREE.Scene();
    threeRef.current.scene = scene;

    // Dark slate space background configured via skybox settings
    const initialHue = adminSettings.skyboxHue !== undefined ? adminSettings.skyboxHue : 224;
    const initialBrightness = adminSettings.skyboxBrightness !== undefined ? adminSettings.skyboxBrightness : 4;
    const skyColorString = `hsl(${initialHue}, 70%, ${initialBrightness}%)`;
    scene.background = new THREE.Color(skyColorString); 
    scene.fog = new THREE.FogExp2(skyColorString, 0.025);

    const aspect = containerRef.current.clientWidth / containerRef.current.clientHeight;
    const camera = new THREE.PerspectiveCamera(75, aspect, 0.1, 100);
    threeRef.current.camera = camera;
    scene.add(camera);

    // Renderer
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setSize(containerRef.current.clientWidth, containerRef.current.clientHeight);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    
    // Add canvas to container
    containerRef.current.innerHTML = '';
    containerRef.current.appendChild(renderer.domElement);
    threeRef.current.renderer = renderer;

    // 2. SCENE LIGHTS
    const ambientLight = new THREE.AmbientLight('#1e293b', adminSettings.ambientLightIntensity !== undefined ? adminSettings.ambientLightIntensity : 0.82); // soft slate ambient fill
    scene.add(ambientLight);
    threeRef.current.ambientLight = ambientLight;

    const dirLight = new THREE.DirectionalLight('#ffffff', adminSettings.directLightIntensity !== undefined ? adminSettings.directLightIntensity : 1.6);
    dirLight.position.set(5, 20, 5);
    dirLight.castShadow = true;
    dirLight.shadow.mapSize.width = 1024;
    dirLight.shadow.mapSize.height = 1024;
    dirLight.shadow.camera.near = 0.5;
    dirLight.shadow.camera.far = 40;
    dirLight.shadow.camera.left = -22;
    dirLight.shadow.camera.right = 22;
    dirLight.shadow.camera.top = 22;
    dirLight.shadow.camera.bottom = -22;
    dirLight.shadow.bias = -0.0005;
    scene.add(dirLight);
    threeRef.current.dirLight = dirLight;

    // Primary energy pole or central bright node
    const pointLight = new THREE.PointLight('#38bdf8', 2.0, 30);
    pointLight.position.set(0, 10, 0);
    scene.add(pointLight);

    // 3. ARENA CREATION
    // Let's create an elegant textured circle arena on the fly using standard HTML Canvas
    const gridCanvas = document.createElement('canvas');
    gridCanvas.width = 512;
    gridCanvas.height = 512;
    const gCtx = gridCanvas.getContext('2d')!;
    
    // Fill background deep dark metal blue
    gCtx.fillStyle = '#050b1a';
    gCtx.fillRect(0, 0, 512, 512);

    // Radial grids with cyan/blue accents
    gCtx.strokeStyle = 'rgba(56, 189, 248, 0.4)'; // glowing sky blue
    gCtx.lineWidth = 4;
    const center = 256;
    
    // Draw concentric circles representing high-tech boundary lines
    for (let r = 50; r <= 250; r += 50) {
      gCtx.beginPath();
      gCtx.arc(center, center, r, 0, Math.PI * 2);
      gCtx.stroke();
    }

    // Radial fangs/directions
    gCtx.strokeStyle = 'rgba(56, 189, 248, 0.15)';
    gCtx.lineWidth = 2;
    for (let angle = 0; angle < Math.PI * 2; angle += Math.PI / 8) {
      gCtx.beginPath();
      gCtx.moveTo(center, center);
      gCtx.lineTo(
        center + Math.cos(angle) * 250,
        center + Math.sin(angle) * 250
      );
      gCtx.stroke();
    }

    // Outer boundary rim glow
    gCtx.strokeStyle = '#1d4ed8'; // blue border
    gCtx.lineWidth = 14;
    gCtx.beginPath();
    gCtx.arc(center, center, 248, 0, Math.PI * 2);
    gCtx.stroke();

    const gridTexture = new THREE.CanvasTexture(gridCanvas);
    gridTexture.wrapS = THREE.RepeatWrapping;
    gridTexture.wrapT = THREE.RepeatWrapping;

    // Floor Mesh
    const floorGeo = new THREE.CylinderGeometry(20, 20, 0.2, 64);
    const floorMat = new THREE.MeshStandardMaterial({
      map: gridTexture,
      roughness: 0.4,
      metalness: 0.85,
    });
    const floor = new THREE.Mesh(floorGeo, floorMat);
    floor.position.y = -0.1;
    floor.receiveShadow = true;
    scene.add(floor);

    // Simple vertical wall border or columns to make it look like a physical arena room
    const wallGroup = new THREE.Group();
    scene.add(wallGroup);

    // Make an outer particle glow system around the ring
    const columnGeo = new THREE.BoxGeometry(0.5, 4, 0.5);
    const columnMat = new THREE.MeshStandardMaterial({
      color: '#1e293b',
      emissive: '#1e1b4b',
      roughness: 0.9,
    });

    const pillarLightMat = new THREE.MeshStandardMaterial({
      color: '#0284c7',
      emissive: '#38bdf8',
      emissiveIntensity: 1.0,
    });

    for (let angle = 0; angle < Math.PI * 2; angle += Math.PI / 6) {
      const x = Math.cos(angle) * 20.3;
      const z = Math.sin(angle) * 20.3;
      
      const column = new THREE.Group();
      column.position.set(x, 2, z);
      column.userData.angle = angle; // Store angle for dynamic scaling!
      
      // Main pillar body
      const body = new THREE.Mesh(columnGeo, columnMat);
      body.castShadow = true;
      body.receiveShadow = true;
      column.add(body);

      // Programmatic Voxel energy detail on pillars
      const energyDet = new THREE.Mesh(new THREE.BoxGeometry(0.12, 3.2, 0.6), pillarLightMat);
      energyDet.position.set(0, 0, -0.1);
      column.add(energyDet);

      column.lookAt(0, 2, 0); // Outward facing
      wallGroup.add(column);
    }

    // 4. PROGRAMMATIC VOXEL CHARACTER ENEMY
    const enemyGroup = buildVoxelSpartanModel(true); // Red team AI enemy
    enemyGroup.position.copy(stateRef.current.aiPos);
    scene.add(enemyGroup);
    threeRef.current.enemyGroup = enemyGroup;

    if (isMultiplayer) {
      enemyGroup.visible = false; // Hide main singleplayer bot mesh in multiplayer
    } else {
      // In singleplayer, initialize 3 additional custom AI bots and set positions
      const s = stateRef.current;
      const botHues = [120, 280, 45]; // Green, Purple, Orange
      const botNames = ["DoomBot Green", "DoomBot Purple", "DoomBot Orange"];
      s.otherPlayers.clear();
      
      for (let i = 0; i < 3; i++) {
        const botId = `bot_${i+2}`;
        s.otherPlayers.set(botId, {
          id: botId,
          playerName: botNames[i],
          pos: new THREE.Vector3(0, 0, 0),
          vel: new THREE.Vector3(0, 0, 0),
          yaw: 0,
          pitch: 0,
          hp: 1,
          maxHp: 1,
          isCrouching: false,
          activeWeapon: 'hammer',
          respawnTimer: 0,
          hue: botHues[i],
          score: 0,
          kills: 0,
          deaths: 0
        });
      }

      // Safe minimax dynamic spawning at mount time
      s.playerPos.copy(getOptimalSpawnPoint([]));
      
      const exclude: THREE.Vector3[] = [s.playerPos];
      s.aiPos.copy(getOptimalSpawnPoint(exclude));
      exclude.push(s.aiPos);
      
      s.otherPlayers.forEach((bot) => {
        const spawnPos = getOptimalSpawnPoint(exclude);
        bot.pos.copy(spawnPos);
        exclude.push(spawnPos);
      });

      // Resize arena dynamically for 5 players (1 local + 1 main bot + 3 custom bots)
      resizeArena(5);
    }


    // Enemy Weapon: Smaller gravity hammer held by Spartan
    const enemyHammer = buildGravityHammerModel();
    enemyHammer.scale.set(0.6, 0.6, 0.6); // Slightly smaller scale for ease
    enemyHammer.position.set(0.5, 1.0 - 0.64, -0.4); // Hold positioned (adjusted for upper body pivot)
    enemyHammer.rotation.set(Math.PI / 2, 0, 0); // forward weapon pose
    
    // Attach gravity hammer to the upper torso group so it rotates with chest aiming & swings
    if (enemyGroup.userData.upperTorso) {
      enemyGroup.userData.upperTorso.add(enemyHammer);
    } else {
      enemyGroup.add(enemyHammer);
    }
    threeRef.current.enemyHammer = enemyHammer;

    // Enemy Weapon: Smaller katar energy sword held by Spartan
    const enemySword = buildKatarSwordModel();
    enemySword.scale.set(0.6, 0.6, 0.6);
    enemySword.position.set(0.5, 1.0 - 0.64, -0.32);
    enemySword.rotation.set(Math.PI / 2, 0, -Math.PI / 8);
    enemySword.visible = false; // Starts with hammer
    if (enemyGroup.userData.upperTorso) {
      enemyGroup.userData.upperTorso.add(enemySword);
    } else {
      enemyGroup.add(enemySword);
    }
    threeRef.current.enemySword = enemySword;

    // 5. FIRST-PERSON WEAPON CONTAINER
    const fpWeaponContainer = new THREE.Group();
    camera.add(fpWeaponContainer); // Anchored as camera child
    
    // Build the gravity hammer model
    const playerHammer = buildGravityHammerModel(adminSettings.playerHue);
    // Neutral positioning (placed on right of screen, angled neatly forward)
    playerHammer.position.set(0.35, -0.38, -0.65);
    playerHammer.rotation.set(0.15, -0.3, -0.15); // standard idle poise
    fpWeaponContainer.add(playerHammer);
    threeRef.current.playerHammer = playerHammer;

    // Build the katar sword model
    const playerSword = buildKatarSwordModel(adminSettings.playerHue);
    // Neutral positioning (placed on right side, angled forward)
    playerSword.position.set(0.35, -0.38, -0.5);
    playerSword.rotation.set(Math.PI / 2, 0, -Math.PI / 8); // Points forward, tilted slightly inwards
    playerSword.visible = false; // Initially inactive (starts with hammer)
    fpWeaponContainer.add(playerSword);
    threeRef.current.playerSword = playerSword;

    // 6. DEBUG TRACE SHIELD/SPHERE MESH
    const debugGeo = new THREE.SphereGeometry(4.5, 32, 16);
    const debugPlayerMat = new THREE.MeshBasicMaterial({
      color: 0xef4444,
      wireframe: true,
      transparent: true,
      opacity: 0,
      depthWrite: false,
    });
    const debugPlayerSphere = new THREE.Mesh(debugGeo, debugPlayerMat);
    scene.add(debugPlayerSphere);
    threeRef.current.debugPlayerSphere = debugPlayerSphere;

    const debugEnemyMat = new THREE.MeshBasicMaterial({
      color: 0xef4444, // red for damage check
      wireframe: true,
      transparent: true,
      opacity: 0,
      depthWrite: false,
    });
    const debugEnemySphere = new THREE.Mesh(debugGeo, debugEnemyMat);
    scene.add(debugEnemySphere);
    threeRef.current.debugEnemySphere = debugEnemySphere;

    // 7. HAMMER JUMP ZONE VISUALIZER (Amber flat glowing ring on the ground)
    const jumpZoneGeo = new THREE.RingGeometry(0.96, 1.0, 64);
    // Orient it flat on ground plane
    jumpZoneGeo.rotateX(-Math.PI / 2);
    const jumpZoneMat = new THREE.MeshBasicMaterial({
      color: 0xf59e0b, // beautiful golden amber
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0, // updated in render loop
      depthWrite: false,
    });
    const playerJumpZoneMesh = new THREE.Mesh(jumpZoneGeo, jumpZoneMat);
    scene.add(playerJumpZoneMesh);
    threeRef.current.playerJumpZoneMesh = playerJumpZoneMesh;

    // Setup input listeners
    const handleKeyDown = (e: KeyboardEvent) => {
      // Handle Enter key for multiplayer chat activation
      if (e.key === 'Enter') {
        const chatInput = document.getElementById('chat-input-field') as HTMLInputElement | null;
        if (chatInput) {
          if (document.activeElement === chatInput) {
            // Already active, click the send button to broadcast
            const sendBtn = document.getElementById('chat-send-btn');
            if (sendBtn) sendBtn.click();
          } else {
            // Remove pointer-lock with backward-compatibility safety
            if (document.exitPointerLock) {
              document.exitPointerLock();
            }
            chatInput.focus();
            e.preventDefault();
            e.stopPropagation();
          }
          return;
        }
      }

      // Block any further action if they are focused in the input element typing
      if (document.activeElement?.tagName === 'INPUT' || document.activeElement?.tagName === 'TEXTAREA') {
        return;
      }

      const key = e.key.toLowerCase();
      keysPressed.current[key] = true;

      const s = stateRef.current;
      if (s.isObserverMode) {
        if (key === 'v') {
          const modes: ('free' | 'third' | 'first')[] = ['free', 'third', 'first'];
          const currentIdx = modes.indexOf(s.observerCamMode);
          const nextMode = modes[(currentIdx + 1) % modes.length];
          s.observerCamMode = nextMode;
          console.log('Spectator Camera mode cycled to:', nextMode);
          s.yaw = Math.PI;
          s.pitch = -0.2;
          pushStatsUpdate();
          return;
        }

        if (key === 'arrowleft' || key === 'arrowright' || key === '1' || key === '2') {
          if (key === '1') {
            s.observerTarget = 'host';
          } else if (key === '2') {
            s.observerTarget = 'client';
          } else {
            s.observerTarget = s.observerTarget === 'host' ? 'client' : 'host';
          }
          console.log('Spectator Target toggled to:', s.observerTarget);
          pushStatsUpdate();
          return;
        }

        // Allow ESC to fall through for pausing
        if (e.key === 'Escape') {
          onPauseToggle();
        }

        // Allow Space and C to fall through to keysPressed for flying rises/descends
        if (key === 'c' || e.key === ' ' || key === 'spacebar' || key === 'w' || key === 'a' || key === 's' || key === 'd' || key === 'shift') {
          // let flyer keys pass
        } else {
          return; // Ignore other standard hotkeys
        }
      }

      // Handle Escape toggle directly
      if (e.key === 'Escape') {
        onPauseToggle();
      }

      // Crouch toggles
      if (key === 'c') {
        stateRef.current.isCrouching = true;
        sfx.playCrouch();
      }

      // Scoreboard toggles (holding U)
      if (key === 'u') {
        stateRef.current.showScoreboard = true;
        pushStatsUpdate();
      }

      // Weapon swapping hotkeys
      if (key === '1') {
        swapPlayerWeapon('hammer');
      }
      if (key === '2') {
        swapPlayerWeapon('sword');
      }

      // Jump initiates
      if (e.key === ' ' || key === 'spacebar') {
        const s = stateRef.current;
        if (s.playerHP > 0 && !isPaused && isPlaying) {
          if (s.pHammerJumpWindowTimer > 0) {
            // Hammer jump boost!
            s.isJumping = true;
            s.playerVel.y = 7.2 + (s.settings.hammerJumpPower ?? 6.5);
            s.pHammerJumpWindowTimer = 0; // Consume the window
            sfx.playJump();
            // Spawn beautiful fire/wind blast shockwave particles under feet
            spawnVoxelShockwaveParticles(s.playerPos, '#f59e0b');
          } else if (!s.isJumping) {
            // Standard jump
            s.isJumping = true;
            s.playerVel.y = 7.2;
            sfx.playJump();
          }
        }
      }

      // Dash initiates
      if (key === 'q') {
        const s = stateRef.current;
        if (s.playerHP > 0 && !isPaused && isPlaying && s.playerDashCooldownTimer <= 0 && s.playerDashRemaining <= 0) {
          let fMove = 0;
          let rMove = 0;
          if (keysPressed.current['w'] || keysPressed.current['arrowup']) fMove += 1;
          if (keysPressed.current['s'] || keysPressed.current['arrowdown']) fMove -= 1;
          if (keysPressed.current['d'] || keysPressed.current['arrowright']) rMove += 1;
          if (keysPressed.current['a'] || keysPressed.current['arrowleft']) rMove -= 1;

          const forwardDir = new THREE.Vector3(0, 0, -1).applyAxisAngle(new THREE.Vector3(0, 1, 0), s.yaw);
          const rightDir = new THREE.Vector3(1, 0, 0).applyAxisAngle(new THREE.Vector3(0, 1, 0), s.yaw);

          const dDir = new THREE.Vector3(0, 0, 0);
          if (fMove !== 0 || rMove !== 0) {
            dDir.addScaledVector(forwardDir, fMove).addScaledVector(rightDir, rMove).normalize();
          } else {
            dDir.copy(forwardDir).normalize();
          }

          s.playerDashDir.copy(dDir);
          s.playerDashRemaining = s.settings.dashDuration || 0.25;
          s.playerDashCooldownTimer = s.settings.dashCooldown || 2.0;
          sfx.playDash();
        }
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (document.activeElement?.tagName === 'INPUT' || document.activeElement?.tagName === 'TEXTAREA') {
        return;
      }
      const key = e.key.toLowerCase();
      keysPressed.current[key] = false;

      if (key === 'c') {
        stateRef.current.isCrouching = false;
      }

      if (key === 'u') {
        stateRef.current.showScoreboard = false;
        pushStatsUpdate();
      }
    };

    // Pointer Lock Handlers
    const handleCanvasMouseDown = (e: MouseEvent) => {
      if (!isPlaying || isPaused) return;

      // Request pointer lock on container
      if (renderer.domElement.requestPointerLock) {
        renderer.domElement.requestPointerLock();
      }

      const s = stateRef.current;
      if (s.isObserverMode) {
        if (e.button === 0) {
          s.observerTarget = s.observerTarget === 'host' ? 'client' : 'host';
          console.log('Spectator Target cycled to:', s.observerTarget);
          pushStatsUpdate();
        }
        return;
      }

      if (s.playerHP <= 0) return;

      if (e.button === 0) {
        // LEFT CLICK: Hammer Slam or Sword Lunge
        if (s.activeWeapon === 'hammer') {
          if (s.pWeaponReady && s.pWeaponState === 'ready' && s.playerDashRemaining <= 0) {
            triggerPlayerHammerSwing();
          }
        } else {
          // SWORD LUNGE
          if (s.crosshairColor === 'red' && s.pSwordReady && s.pSwordState === 'ready' && !s.isLunging) {
            triggerPlayerSwordLunge();
          }
        }
      } else if (e.button === 2) {
        // RIGHT CLICK: Sword Slash
        if (s.activeWeapon === 'sword') {
          if (s.pSwordReady && s.pSwordState === 'ready' && !s.isLunging) {
            triggerPlayerSwordSlash();
          }
        }
      }
    };

    const handleWheel = (e: WheelEvent) => {
      if (!isPlaying || isPaused) return;

      const s = stateRef.current;
      if (s.isObserverMode) {
        if (s.observerCamMode === 'third') {
          // Adjust orbital camera distance
          const zoomSpeed = 0.55;
          s.observerOrbitDistance = Math.max(2.0, Math.min(22.0, s.observerOrbitDistance + (e.deltaY > 0 ? zoomSpeed : -zoomSpeed)));
          pushStatsUpdate();
        }
        return;
      }

      if (s.playerHP <= 0 || s.isLunging) return;

      const current = s.activeWeapon;
      const next = current === 'hammer' ? 'sword' : 'hammer';
      swapPlayerWeapon(next);
    };

    const handleContextMenu = (e: MouseEvent) => {
      e.preventDefault();
    };

    const handlePointerLockChange = () => {
      const doc = document as any;
      if (doc.pointerLockElement === renderer.domElement) {
        isPointerLocked.current = true;
        setShowPointerLockAlert(false);
      } else {
        isPointerLocked.current = false;
        setShowPointerLockAlert(true);
      }
    };

    const handleMouseMove = (e: MouseEvent) => {
      if (!isPlaying || isPaused) return;

      if (isPointerLocked.current) {
        // Pointer Lock movement (standard FPS mouse feel)
        const mouseSensitivity = 0.0022;
        stateRef.current.yaw -= e.movementX * mouseSensitivity;
        stateRef.current.pitch -= e.movementY * mouseSensitivity;

        // Constraint pitch (cannot look fully upside down or inside floor)
        stateRef.current.pitch = Math.max(-Math.PI / 2.3, Math.min(Math.PI / 2.3, stateRef.current.pitch));
      } else if (isMouseDown.current) {
        // Fallback: Drag to look around
        const dx = e.clientX - lastMousePos.current.x;
        const dy = e.clientY - lastMousePos.current.y;
        
        const dragSensitivity = 0.005;
        stateRef.current.yaw -= dx * dragSensitivity;
        stateRef.current.pitch -= dy * dragSensitivity;
        stateRef.current.pitch = Math.max(-Math.PI / 2.3, Math.min(Math.PI / 2.3, stateRef.current.pitch));

        lastMousePos.current = { x: e.clientX, y: e.clientY };
      }
    };

    const handleMouseDownFallback = (e: MouseEvent) => {
      if (!isPointerLocked.current) {
        isMouseDown.current = true;
        lastMousePos.current = { x: e.clientX, y: e.clientY };
      }
    };

    const handleMouseUpFallback = () => {
      isMouseDown.current = false;
    };

    // Window events setup
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    renderer.domElement.addEventListener('mousedown', handleCanvasMouseDown);
    renderer.domElement.addEventListener('wheel', handleWheel);
    renderer.domElement.addEventListener('contextmenu', handleContextMenu);
    document.addEventListener('pointerlockchange', handlePointerLockChange);
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mousedown', handleMouseDownFallback);
    window.addEventListener('mouseup', handleMouseUpFallback);

    const handleResize = () => {
      if (!containerRef.current || !renderer || !camera) return;
      const w = containerRef.current.clientWidth;
      const h = containerRef.current.clientHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    window.addEventListener('resize', handleResize);

    const handleCycleObserverMode = () => {
      const s = stateRef.current;
      if (!s || !s.isObserverMode) return;
      const modes: ('free' | 'third' | 'first')[] = ['free', 'third', 'first'];
      const currentIdx = modes.indexOf(s.observerCamMode);
      const nextMode = modes[(currentIdx + 1) % modes.length];
      s.observerCamMode = nextMode;
      s.yaw = Math.PI;
      s.pitch = -0.2;
      console.log('Spectator Camera mode cycled to:', nextMode);
      pushStatsUpdate();
    };

    const handleCycleObserverTarget = () => {
      const s = stateRef.current;
      if (!s || !s.isObserverMode) return;
      s.observerTarget = s.observerTarget === 'host' ? 'client' : 'host';
      console.log('Spectator Target toggled to:', s.observerTarget);
      pushStatsUpdate();
    };

    window.addEventListener('cycle-observer-mode', handleCycleObserverMode);
    window.addEventListener('cycle-observer-target', handleCycleObserverTarget);

    // Trigger initial score stats update quickly
    pushStatsUpdate();

    // 7. INITIAL WORKSPACE DESTROY/CLEANUP SCOPING
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      if (renderer?.domElement) {
        renderer.domElement.removeEventListener('mousedown', handleCanvasMouseDown);
        renderer.domElement.removeEventListener('wheel', handleWheel);
        renderer.domElement.removeEventListener('contextmenu', handleContextMenu);
      }
      document.removeEventListener('pointerlockchange', handlePointerLockChange);
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mousedown', handleMouseDownFallback);
      window.removeEventListener('mouseup', handleMouseUpFallback);
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('cycle-observer-mode', handleCycleObserverMode);
      window.removeEventListener('cycle-observer-target', handleCycleObserverTarget);

      if (requestRef.current) {
        cancelAnimationFrame(requestRef.current);
      }
    };
  }, [isPlaying, isPaused]);

  // Handle active game cycles
  useEffect(() => {
    if (!isPlaying || isPaused) return;

    let lastTime = performance.now();

    const loop = (time: number) => {
      const s = stateRef.current;
      // Calculate delta time
      let dt = (time - lastTime) / 1000;
      lastTime = time;

      // Anti-jump lag spike limit
      if (dt > 0.1) dt = 0.1;

      // Lazy build Host Spartan model when entering spectator mode
      if (s.isObserverMode && !threeRef.current.hostGroup) {
        rebuildHostModel(s.hostHue);
      }

      // Execute game logics
      updatePhysics(dt);
      updateHammerAnimations(dt);
      updateAI(dt);
      updateCharacterSkeletalAnimations(dt);
      updateExplosionParticles(dt);
      updateMatchTimers(dt);

      // Render loop
      renderGame();

      // Update floating nameplate positioning and appearance
      updateFloatingNameplate();

      // Trigger stats sync
      pushStatsUpdate();

      // Synchronously update HUD Radar elements directly at 60fps 
      updateRadarDOM();

      // Emit multiplayer synchronization payload
      if (isMultiplayer && multiplayerRole !== 'observer' && multiplayerSocket && multiplayerSocket.readyState === WebSocket.OPEN) {
        const s = stateRef.current;
        multiplayerSocket.send(JSON.stringify({
          type: 'sync',
          pos: { x: s.playerPos.x, y: s.playerPos.y, z: s.playerPos.z },
          vel: { x: s.playerVel.x, y: s.playerVel.y, z: s.playerVel.z },
          yaw: s.yaw,
          pitch: s.pitch,
          hp: s.playerHP,
          maxHp: s.playerMaxHP,
          isCrouching: s.isCrouching,
          activeWeapon: s.activeWeapon,
          respawnTimer: s.playerRespawnTimer,
          hue: s.settings.playerHue,
          playerName: s.settings.playerName, // Send custom name!
          
          ...(multiplayerRole === 'host' ? {
            scoreHost: s.scorePlayer,
            scoreClient: s.scoreEnemy,
            killsHost: s.playerKills,
            deathsHost: s.playerDeaths,
            killsClient: s.enemyKills,
            deathsClient: s.enemyDeaths,
            gameTime: s.gameTime
          } : {
            clientHP: s.playerHP
          })
        }));
      }

      requestRef.current = requestAnimationFrame(loop);
    };

    requestRef.current = requestAnimationFrame(loop);

    return () => {
      if (requestRef.current) {
        cancelAnimationFrame(requestRef.current);
      }
    };
  }, [isPlaying, isPaused, isMultiplayer, multiplayerRole, multiplayerSocket]);

  // TRIGGERS PLAYER SWING
  const triggerPlayerHammerSwing = () => {
    const s = stateRef.current;
    if (s.playerDashRemaining > 0) return; // Attacks cannot take place during the dash movement
    s.pWeaponState = 'swing_up';
    s.pWeaponTimer = 0;
    s.pWeaponReady = false;
    s.lastPlayerHammerAttackTime = Date.now();
    
    // Play sci-fi mechanical swing whoosh sound!
    sfx.playSwing();

    if (isMultiplayer && multiplayerSocket && multiplayerSocket.readyState === WebSocket.OPEN) {
      multiplayerSocket.send(JSON.stringify({ type: 'sync', action: 'swing_hammer' }));
    }
  };

  // SWAPS PLAYER WEAPON
  const swapPlayerWeapon = (type: 'hammer' | 'sword') => {
    const s = stateRef.current;
    if (s.playerHP <= 0 || isPaused || !isPlaying) return;
    if (s.isLunging) return; // cannot switch weapon during lunge

    s.activeWeapon = type;

    const hammer = threeRef.current.playerHammer;
    const sword = threeRef.current.playerSword;
    if (hammer && sword) {
      if (type === 'hammer') {
        hammer.visible = true;
        sword.visible = false;
      } else {
        hammer.visible = false;
        sword.visible = true;
      }
    }
    // Update stats immediately on swap
    pushStatsUpdate();
  };

  // TRIGGERS PLAYER SWORD SLASH
  const triggerPlayerSwordSlash = () => {
    const s = stateRef.current;
    if (s.playerDashRemaining > 0) return;
    s.pSwordState = 'slashing';
    s.pSwordTimer = 0;
    s.pSwordReady = false;
    s.lastPlayerSwordAttackTime = Date.now();
    sfx.playSwing();

    if (isMultiplayer && multiplayerSocket && multiplayerSocket.readyState === WebSocket.OPEN) {
      multiplayerSocket.send(JSON.stringify({ type: 'sync', action: 'slash_sword' }));
    }
  };

  // TRIGGERS PLAYER SWORD LUNGE
  const triggerPlayerSwordLunge = () => {
    const s = stateRef.current;
    if (s.playerDashRemaining > 0) return;
    s.isLunging = true;
    s.lungeTimer = 0;
    s.lungeStartPos.copy(s.playerPos);
    s.lungeTargetDir.copy(s.aiPos).sub(s.playerPos);
    s.lungeTargetDir.y = 0;
    s.lungeTargetDir.normalize();
    s.pSwordState = 'ready'; // reset weapon timing states during lunge glide
    s.lastPlayerSwordAttackTime = Date.now();
    sfx.playDash(); // play speed dash trail sound

    if (isMultiplayer && multiplayerSocket && multiplayerSocket.readyState === WebSocket.OPEN) {
      multiplayerSocket.send(JSON.stringify({ type: 'sync', action: 'lunge_sword', dir: { x: s.lungeTargetDir.x, y: s.lungeTargetDir.y, z: s.lungeTargetDir.z } }));
    }
  };

  // TRIGGERS ENEMY AI SWING
  const triggerEnemyHammerSwing = () => {
    const s = stateRef.current;
    if (s.aiDashRemaining > 0) return; // Attacks cannot take place during the dash movement
    s.aiWeaponState = 'swing_up';
    s.aiWeaponTimer = 0;
    s.lastAIHammerAttackTime = Date.now();
  };

  // TRIGGERS ENEMY AI SWORD SLASH
  const triggerEnemySwordSlash = () => {
    const s = stateRef.current;
    if (s.aiDashRemaining > 0) return;
    s.aiWeaponState = 'swing_up';
    s.aiWeaponTimer = 0;
    s.lastAISwordAttackTime = Date.now();
    sfx.playSwing();
  };

  // TRIGGERS ENEMY AI SWORD LUNGE
  const triggerEnemySwordLunge = (customDir?: THREE.Vector3) => {
    const s = stateRef.current;
    if (s.aiDashRemaining > 0) return;
    s.aiState = 'LUNGING';
    s.aiLungeTimer = 0;
    s.aiLungeStartPos.copy(s.aiPos);
    if (customDir) {
      s.aiLungeTargetDir.copy(customDir);
    } else {
      s.aiLungeTargetDir.copy(s.playerPos).sub(s.aiPos);
    }
    s.aiLungeTargetDir.y = 0;
    s.aiLungeTargetDir.normalize();
    s.aiWeaponState = 'ready';
    s.lastAISwordAttackTime = Date.now();
    sfx.playDash();
  };

  // SWAPS ENEMY WEAPON
  const swapEnemyWeapon = (type: 'hammer' | 'sword') => {
    const s = stateRef.current;
    if (s.aiHP <= 0 || isPaused || !isPlaying) return;
    if (s.aiState === 'LUNGING') return;

    s.aiActiveWeapon = type;

    const hammer = threeRef.current.enemyHammer;
    const sword = threeRef.current.enemySword;
    if (hammer && sword) {
      if (type === 'hammer') {
        hammer.visible = true;
        sword.visible = false;
      } else {
        hammer.visible = false;
        sword.visible = true;
      }
    }
  };

  // MUTUAL TRADING FUNCTIONALITY
  const executeTrade = (reason: 'sword_vs_sword' | 'sword_lunge_vs_hammer') => {
    const s = stateRef.current;

    // Reset both of their positions/movement states and inflict 1 damage
    s.playerHP = Math.max(0, s.playerHP - 1);
    s.aiHP = Math.max(0, s.aiHP - 1);

    // Audio cues
    sfx.playExplosion();
    sfx.playDeath();

    // Spawns beautiful particle visual feedback for both characters
    spawnVoxelShockwaveParticles(s.playerPos, '#3b82f6'); // Blue player shockwave
    spawnVoxelShockwaveParticles(s.aiPos, '#ef4444');    // Red AI shockwave

    // Render debug positions
    s.lastStrikePos = s.aiPos.clone();
    s.lastStrikeTick = 1.2;
    s.lastAIStrikePos = s.playerPos.clone();
    s.lastAIStrikeTick = 1.2;

    // Handle Player death state
    if (s.playerHP <= 0) {
      s.playerHP = 0;
      s.playerRespawnTimer = 3.0;
      s.scoreEnemy += 1;
      s.playerDeaths += 1;
      s.enemyKills += 1;
    }
    s.pWeaponState = 'ready';
    s.pWeaponTimer = 0;
    s.pWeaponReady = true;
    s.pSwordState = 'ready';
    s.pSwordTimer = 0;
    s.pSwordReady = true;
    s.isLunging = false;
    s.lungeTimer = 0;

    // Handle AI death state
    if (s.aiHP <= 0) {
      s.aiHP = 0;
      s.aiState = 'RESPAWNING';
      s.enemyRespawnTimer = 3.0;
      s.scorePlayer += 1;
      s.playerKills += 1;
      s.enemyDeaths += 1;
    }
    s.aiWeaponState = 'ready';
    s.aiWeaponTimer = 0;

    // Record death events for the kill feed (last 3 entries)
    const attackerText = reason === 'sword_vs_sword' ? 'Sword Trade' : 'Lunge/Hammer Trade';
    const newDeath1 = {
      id: Math.random().toString(36).substring(2, 9),
      attacker: `Blue (You) [${attackerText}]`,
      victim: 'Red (AI)',
    };
    const newDeath2 = {
      id: Math.random().toString(36).substring(2, 9),
      attacker: `Red (AI) [${attackerText}]`,
      victim: 'Blue (You)',
    };

    s.lastDeaths = [newDeath1, newDeath2, ...s.lastDeaths].slice(0, 3);

    pushStatsUpdate();
  };

  // TRIGGER PROGRAMMATIC EXPLOSION (Voxel shockwave particles)
  const spawnVoxelShockwaveParticles = (impactCenter: THREE.Vector3, color: string) => {
    const scene = threeRef.current.scene;
    if (!scene) return;

    const count = 35; // particle count
    const voxelGeo = new THREE.BoxGeometry(0.12, 0.12, 0.12);
    const voxelMatCache = new Map<string, THREE.Material>();

    for (let i = 0; i < count; i++) {
      // Random shades matching the blast theme (e.g. glowing solar cyan for player, glowing orange for AI)
      const isGlow = Math.random() > 0.35;
      const shadeHex = color;
      
      let mat = voxelMatCache.get(shadeHex);
      if (!mat) {
        mat = new THREE.MeshStandardMaterial({
          color: new THREE.Color(shadeHex),
          emissive: isGlow ? new THREE.Color(shadeHex) : undefined,
          emissiveIntensity: isGlow ? 1.5 : 0.0,
          roughness: 0.5,
          metalness: 0.1
        });
        voxelMatCache.set(shadeHex, mat);
      }

      const cube = new THREE.Mesh(voxelGeo, mat);
      
      // Position slightly offset around the floor impact point
      cube.position.copy(impactCenter);
      cube.position.x += (Math.random() - 0.5) * 0.4;
      cube.position.y += Math.random() * 0.3; // start close to surface
      cube.position.z += (Math.random() - 0.5) * 0.4;

      // Rapid vector velocities flying upwards and outwards
      const angle = Math.random() * Math.PI * 2;
      const speedHorizon = Math.random() * 5.5 + 2.5; 
      const vx = Math.cos(angle) * speedHorizon;
      const vz = Math.sin(angle) * speedHorizon;
      const vy = Math.random() * 5.0 + 3.2; // explosive jump speed

      const particleData = {
        mesh: cube,
        velocity: new THREE.Vector3(vx, vy, vz),
        life: 0.0,
        maxLife: Math.random() * 0.5 + 0.45, // lifespan around 0.5-1s
      };

      scene.add(cube);
      threeRef.current.damageExplosionParticles.push(particleData);
    }
  };

  // PHYSICS UPDATE (Player relative to WASD & Crouch heights)
  const updatePhysics = (dt: number) => {
    const s = stateRef.current;

    // Handle Observer Spectator movement controls
    if (s.isObserverMode) {
      if (s.observerCamMode === 'free') {
        const forwardDir = new THREE.Vector3(0, 0, -1)
          .applyAxisAngle(new THREE.Vector3(1, 0, 0), s.pitch)
          .applyAxisAngle(new THREE.Vector3(0, 1, 0), s.yaw)
          .normalize();
        const rightDir = new THREE.Vector3(1, 0, 0)
          .applyAxisAngle(new THREE.Vector3(0, 1, 0), s.yaw)
          .normalize();
        const upDir = new THREE.Vector3(0, 1, 0);

        let moveForward = 0;
        let moveRight = 0;
        let moveUp = 0;
        if (keysPressed.current['w'] || keysPressed.current['arrowup']) moveForward += 1;
        if (keysPressed.current['s'] || keysPressed.current['arrowdown']) moveForward -= 1;
        if (keysPressed.current['d'] || keysPressed.current['arrowright']) moveRight += 1;
        if (keysPressed.current['a'] || keysPressed.current['arrowleft']) moveRight -= 1;
        
        // Rise and Lower controls
        if (keysPressed.current[' '] || keysPressed.current['spacebar']) moveUp += 1;
        if (keysPressed.current['c']) moveUp -= 1;

        const speedMultiplier = keysPressed.current['shift'] ? 2.8 : 1.0;
        const flySpeed = 11.0 * speedMultiplier * dt;

        s.playerPos.addScaledVector(forwardDir, moveForward * flySpeed);
        s.playerPos.addScaledVector(rightDir, moveRight * flySpeed);
        s.playerPos.addScaledVector(upDir, moveUp * flySpeed);
      }
      return; // Skip normal player physics entirely
    }
    
    // Check if player is alive. If dead, countdown respawn timer
    if (s.playerHP <= 0) {
      s.playerRespawnTimer -= dt;
      if (s.playerRespawnTimer <= 0) {
        s.playerHP = s.playerMaxHP;
        const exclude: THREE.Vector3[] = [];
        if (s.otherPlayers) {
          s.otherPlayers.forEach((other) => {
            if (other.hp > 0 && other.respawnTimer <= 0) {
              exclude.push(new THREE.Vector3(other.pos.x, other.pos.y, other.pos.z));
            }
          });
        }
        if (!isMultiplayer && s.aiHP > 0 && s.aiState !== 'RESPAWNING') {
          exclude.push(s.aiPos);
        }
        
        const spawnPos = getOptimalSpawnPoint(exclude);
        s.playerPos.copy(spawnPos);
        s.yaw = Math.atan2(-spawnPos.x, -spawnPos.z);
        s.playerVel.set(0, 0, 0);
        s.pitch = 0;
        s.playerInvulnerabilityTimer = s.settings.respawnInvulnerabilityDuration;
        sfx.playRespawn();

      }
      return;
    }

    // If player is currently lunging, glide directly towards the enemy on a locked linear path
    if (s.isLunging) {
      s.lungeTimer += dt;
      const lungeSpeed = s.settings.swordLungeSpeed ?? 24.0;
      s.playerVel.copy(s.lungeTargetDir).multiplyScalar(lungeSpeed);
      
      s.playerPos.x += s.playerVel.x * dt;
      s.playerPos.z += s.playerVel.z * dt;
      s.playerPos.y = 0;
      s.playerVel.y = 0;
      s.isJumping = false;
      s.isCrouching = false;

      // Spawn beautiful energy trail particles
      const scene = threeRef.current.scene;
      if (scene && Math.random() > 0.1) {
        const trailPos = s.playerPos.clone();
        trailPos.y += 0.5;
        const geo = new THREE.BoxGeometry(0.08, 0.08, 0.08);
        const mat = new THREE.MeshBasicMaterial({
          color: new THREE.Color('#22d3ee'),
          transparent: true,
          opacity: 0.8,
        });
        const mesh = new THREE.Mesh(geo, mat);
        mesh.position.copy(trailPos);
        scene.add(mesh);
        threeRef.current.damageExplosionParticles.push({
          mesh,
          velocity: new THREE.Vector3((Math.random() - 0.5) * 0.1, Math.random() * 0.15, (Math.random() - 0.5) * 0.1),
          life: 0.0,
          maxLife: 0.18,
        });
      }

      // Check distance to enemy torso center
      let closestTarget: any = null;
      let dist = Infinity;

      if (!isMultiplayer && s.aiHP > 0 && s.aiState !== 'RESPAWNING') {
        closestTarget = { id: 'main_ai', pos: s.aiPos, hp: s.aiHP, name: 'Red (AI)' };
        dist = s.playerPos.distanceTo(s.aiPos);
      }
      
      if (s.otherPlayers) {
        s.otherPlayers.forEach((other) => {
          if (other.hp > 0 && !other.isObserver && other.respawnTimer <= 0) {
            const d = s.playerPos.distanceTo(new THREE.Vector3(other.pos.x, other.pos.y, other.pos.z));
            if (d < dist) {
              dist = d;
              closestTarget = { id: other.id, pos: new THREE.Vector3(other.pos.x, other.pos.y, other.pos.z), hp: other.hp, name: other.playerName };
            }
          }
        });
      }

      if (!closestTarget) {
        s.isLunging = false;
        s.pSwordState = 'recovering';
        s.pSwordTimer = 0;
        s.pSwordReady = false;
        s.pSwordRecoverDuration = s.settings.swordLungeReload ?? 1.2;
      } else if (dist <= 1.5) {
        s.isLunging = false;
        sfx.playExplosion();
        spawnVoxelShockwaveParticles(closestTarget.pos, '#22d3ee');
        s.lastStrikePos = closestTarget.pos.clone();
        s.lastStrikeTick = 1.2;

        if (isMultiplayer) {
          if (multiplayerSocket && multiplayerSocket.readyState === WebSocket.OPEN) {
            multiplayerSocket.send(JSON.stringify({ type: 'sync', action: 'hit_taken', damage: 1, targetId: closestTarget.id }));
          }
        } else {
          if (closestTarget.id === 'main_ai') {
            const swordThreshold = s.settings.swordTradeWindow ?? 350;
            const hammerThreshold = s.settings.hammerSwordTradeWindow ?? 350;
            const isAISwordActiveAttack = s.settings.enableSwordTrade && s.aiActiveWeapon === 'sword' && (
              s.aiState === 'LUNGING' || 
              s.aiWeaponState === 'swing_up' || 
              s.aiWeaponState === 'swing_down' || 
              (Date.now() - s.lastAISwordAttackTime <= swordThreshold)
            );
            const isAIHammerActiveAttack = s.settings.enableHammerSwordTrade && s.aiActiveWeapon === 'hammer' && (
              s.aiWeaponState === 'swing_up' || 
              s.aiWeaponState === 'swing_down' ||
              (Date.now() - s.lastAIHammerAttackTime <= hammerThreshold)
            );

            if (isAISwordActiveAttack) {
              executeTrade('sword_vs_sword');
              return;
            } else if (isAIHammerActiveAttack) {
              executeTrade('sword_lunge_vs_hammer');
              return;
            }

            s.aiHP -= 1;
            if (s.aiHP <= 0) {
              s.aiHP = 0;
              s.aiState = 'RESPAWNING';
              s.enemyRespawnTimer = 3.0;
              s.scorePlayer += 1;
              s.playerKills += 1;
              s.enemyDeaths += 1;
              sfx.playDeath();
              s.aiWeaponState = 'ready';
              s.aiWeaponTimer = 0;

              const newDeath = {
                id: Math.random().toString(36).substring(2, 9),
                attacker: s.settings.playerName || 'Blue (You)',
                victim: 'Red (AI)',
              };
              s.lastDeaths = [newDeath, ...s.lastDeaths].slice(0, 3);
              spawnVoxelShockwaveParticles(s.aiPos, '#ef4444');
            } else {
              sfx.playSwing();
            }
          } else {
            const other = s.otherPlayers.get(closestTarget.id);
            if (other) {
              other.hp -= 1;
              if (other.hp <= 0) {
                other.hp = 0;
                other.respawnTimer = 3.0;
                s.scorePlayer += 1;
                s.playerKills += 1;
                other.deaths += 1;
                sfx.playDeath();

                const newDeath = {
                  id: Math.random().toString(36).substring(2, 9),
                  attacker: s.settings.playerName || 'Blue (You)',
                  victim: other.playerName
                };
                s.lastDeaths = [newDeath, ...s.lastDeaths].slice(0, 3);
                spawnVoxelShockwaveParticles(closestTarget.pos, '#ef4444');
              } else {
                sfx.playSwing();
              }
            }
          }
        }

        s.pSwordState = 'recovering';
        s.pSwordTimer = 0;
        s.pSwordReady = false;
        s.pSwordRecoverDuration = s.settings.swordLungeReload ?? 1.2;
        pushStatsUpdate();
      }

      // Safeguard limits to break out of lunge
      const startDist = s.playerPos.distanceTo(s.lungeStartPos);
      if (startDist > 16.0 || s.lungeTimer > 0.8) {
        s.isLunging = false;
        s.pSwordState = 'recovering';
        s.pSwordTimer = 0;
        s.pSwordReady = false;
        s.pSwordRecoverDuration = s.settings.swordLungeReload ?? 1.2;
      }

      // Arena constraints
      const distFromCenter = Math.sqrt(s.playerPos.x * s.playerPos.x + s.playerPos.z * s.playerPos.z);
      if (distFromCenter > s.arenaRadius - 0.6) {
        const angle = Math.atan2(s.playerPos.z, s.playerPos.x);
        s.playerPos.x = Math.cos(angle) * (s.arenaRadius - 0.6);
        s.playerPos.z = Math.sin(angle) * (s.arenaRadius - 0.6);
        s.isLunging = false;
        s.pSwordState = 'recovering';
        s.pSwordTimer = 0;
        s.pSwordReady = false;
        s.pSwordRecoverDuration = s.settings.swordLungeReload ?? 1.2;
      }

      return; // Skip standard movement input calculations
    }

    // Tick down player invulnerability timer
    if (s.playerInvulnerabilityTimer > 0) {
      s.playerInvulnerabilityTimer = Math.max(0, s.playerInvulnerabilityTimer - dt);
    }

    // Process dash timers
    if (s.playerDashCooldownTimer > 0) {
      s.playerDashCooldownTimer = Math.max(0, s.playerDashCooldownTimer - dt);
    }

    const isPlayerDashing = s.playerDashRemaining > 0;
    if (isPlayerDashing) {
      s.playerDashRemaining = Math.max(0, s.playerDashRemaining - dt);
      
      const speed = s.settings.dashDistance / (s.settings.dashDuration || 0.25);
      s.playerVel.x = s.playerDashDir.x * speed;
      s.playerVel.z = s.playerDashDir.z * speed;

      // Spawn beautiful cyber cyan tail particles
      if (Math.random() > 0.15) {
        const trailPos = s.playerPos.clone();
        trailPos.y += 0.5; // midway
        const scene = threeRef.current.scene;
        if (scene) {
          const geo = new THREE.BoxGeometry(0.12, 0.12, 0.12);
          const mat = new THREE.MeshBasicMaterial({
            color: new THREE.Color('#38bdf8'),
            transparent: true,
            opacity: 0.75,
          });
          const mesh = new THREE.Mesh(geo, mat);
          mesh.position.copy(trailPos);
          mesh.position.x += (Math.random() - 0.5) * 0.3;
          mesh.position.y += (Math.random() - 0.5) * 0.5;
          mesh.position.z += (Math.random() - 0.5) * 0.3;
          scene.add(mesh);
          threeRef.current.damageExplosionParticles.push({
            mesh,
            velocity: new THREE.Vector3((Math.random() - 0.5) * 0.4, Math.random() * 0.2, (Math.random() - 0.5) * 0.4),
            life: 0.0,
            maxLife: 0.25 + Math.random() * 0.15,
          });
        }
      }
    } else {
      // Crouch height interpolation
      const targetCrouch = s.isCrouching ? 0.72 : 0.0;
      s.crouchAmount += (targetCrouch - s.crouchAmount) * 12.0 * dt;

      // Movement speed coefficients
      const baseSpeed = s.isCrouching ? 2.5 : 5.8; // Standard Halo speed vs crouch crawl
      
      const forwardDir = new THREE.Vector3(0, 0, -1).applyAxisAngle(new THREE.Vector3(0, 1, 0), s.yaw);
      const rightDir = new THREE.Vector3(1, 0, 0).applyAxisAngle(new THREE.Vector3(0, 1, 0), s.yaw);

      const moveDirection = new THREE.Vector3(0, 0, 0);
      
      let moveForward = 0;
      let moveRight = 0;
      if (keysPressed.current['w'] || keysPressed.current['arrowup']) moveForward += 1;
      if (keysPressed.current['s'] || keysPressed.current['arrowdown']) moveForward -= 1;
      if (keysPressed.current['d'] || keysPressed.current['arrowright']) moveRight += 1;
      if (keysPressed.current['a'] || keysPressed.current['arrowleft']) moveRight -= 1;

      // Normalise movement input first so diagonals aren't faster
      let inputLength = Math.sqrt(moveForward * moveForward + moveRight * moveRight);
      if (inputLength > 0) {
        const normForward = moveForward / inputLength;
        const normRight = moveRight / inputLength;

        // Apply modifiers specific to each component
        const fMultiplier = normForward > 0 
          ? s.settings.speedForward / 100 
          : (normForward < 0 ? s.settings.speedBackward / 100 : 1.0);
        
        const sMultiplier = s.settings.speedSide / 100;

        // Combine vectors with their respective multipliers
        moveDirection.addScaledVector(forwardDir, normForward * fMultiplier * baseSpeed);
        moveDirection.addScaledVector(rightDir, normRight * sMultiplier * baseSpeed);
      }

      // Set horizontal velocities with dynamic response friction
      s.playerVel.x = moveDirection.x;
      s.playerVel.z = moveDirection.z;
    }

    // Handle Gravity Physics if jumping
    if (s.isJumping) {
      s.playerVel.y -= 18.0 * dt; // gravity deceleration rate
      s.playerPos.y += s.playerVel.y * dt;

      // Ground collision
      if (s.playerPos.y <= 0) {
        s.playerPos.y = 0;
        s.playerVel.y = 0;
        s.isJumping = false;
      }
    } else {
      s.playerPos.y = 0;
      s.playerVel.y = 0;
    }

    // Handle AI Gravity Physics
    if (s.aiIsJumping) {
      s.aiVel.y -= 18.0 * dt; // gravity deceleration rate
      s.aiPos.y += s.aiVel.y * dt;
      
      // Integrate airborne horizontal velocities
      s.aiPos.x += s.aiVel.x * dt;
      s.aiPos.z += s.aiVel.z * dt;

      // Ground collision
      if (s.aiPos.y <= 0) {
        s.aiPos.y = 0;
        s.aiVel.set(0, 0, 0); // clear airborne velocities
        s.aiIsJumping = false;
      }
    } else {
      s.aiPos.y = 0;
      s.aiVel.y = 0;
    }

    // Integrate absolute positions
    s.playerPos.x += s.playerVel.x * dt;
    s.playerPos.z += s.playerVel.z * dt;

    // Circular arena boundary restraint (Snap inside radius)
    const distFromCenter = Math.sqrt(s.playerPos.x * s.playerPos.x + s.playerPos.z * s.playerPos.z);
    if (distFromCenter > s.arenaRadius - 0.6) {
      const angle = Math.atan2(s.playerPos.z, s.playerPos.x);
      s.playerPos.x = Math.cos(angle) * (s.arenaRadius - 0.6);
      s.playerPos.z = Math.sin(angle) * (s.arenaRadius - 0.6);
    }
  };

  // HAMMER & SWORD ANIMATIONS & DAMAGE APPLICATION
  const updateHammerAnimations = (dt: number) => {
    const s = stateRef.current;
    const playerHammer = threeRef.current.playerHammer;
    const playerSword = threeRef.current.playerSword;
    const camera = threeRef.current.camera;

    if (!playerHammer || !camera) return;

    // Bobbing/Sway configurations
    const isMoving = Math.sqrt(s.playerVel.x * s.playerVel.x + s.playerVel.z * s.playerVel.z) > 0.5;
    const speedCoeff = s.isCrouching ? 0.5 : 1.0;
    const timeScale = performance.now() * 0.005 * speedCoeff;
    
    let idleXBob = 0;
    let idleYBob = 0;
    let idleZRotBob = 0;

    if (isMoving && !s.isJumping) {
      // Gentle walk sway
      idleXBob = Math.sin(timeScale * 2.5) * 0.04;
      idleYBob = Math.cos(timeScale * 5) * 0.03;
      idleZRotBob = Math.sin(timeScale * 2.5) * 0.05;
    } else {
      // Breathe idle bob
      idleYBob = Math.sin(timeScale * 1.5) * 0.008;
    }

    // 1. DYNAMIC WEAPON TARGET HOVER DETECTION (White to Red Lock-on)
    if (s.playerHP > 0 && s.aiHP > 0 && s.aiState !== 'RESPAWNING') {
      const eyePos = new THREE.Vector3(
        s.playerPos.x,
        1.65 - s.crouchAmount + s.playerPos.y,
        s.playerPos.z
      );
      const enemyCenter = new THREE.Vector3(s.aiPos.x, s.aiPos.y + 0.825, s.aiPos.z);
      const toEnemy = enemyCenter.clone().sub(eyePos);
      const dist = toEnemy.length();
      
      if (dist <= (s.settings.swordLungeDistance ?? 14.5)) {
        const toEnemyDir = toEnemy.clone().normalize();
        
        const cameraLookDir = new THREE.Vector3(0, 0, -1)
          .applyAxisAngle(new THREE.Vector3(1, 0, 0), s.pitch)
          .applyAxisAngle(new THREE.Vector3(0, 1, 0), s.yaw)
          .normalize();
          
        const dot = cameraLookDir.dot(toEnemyDir);
        const angle = Math.acos(Math.max(-1.0, Math.min(1.0, dot)));
        
        if (angle < 0.12) {
          s.crosshairColor = 'red';
        } else {
          s.crosshairColor = 'white';
        }
      } else {
        s.crosshairColor = 'white';
      }
    } else {
      s.crosshairColor = 'white';
    }

    // 2. KATAR SWORD MULTI-ATTACK & GRAVITY HAMMER ANIMATION STATE MACHINE
    if (s.playerHP <= 0) {
      s.pWeaponState = 'ready';
      s.pWeaponTimer = 0;
      s.pWeaponReady = true;
      s.pSwordState = 'ready';
      s.pSwordTimer = 0;
      s.pSwordReady = true;
      s.isLunging = false;
      s.lungeTimer = 0;

      if (playerHammer) {
        playerHammer.position.set(0.35, -0.38 + idleYBob, -0.65 + idleXBob);
        playerHammer.rotation.set(0.15, -0.3, -0.15 + idleZRotBob);
        playerHammer.visible = false;
      }
      if (playerSword) {
        playerSword.position.set(0.35, -0.38 + idleYBob, -0.5 + idleXBob);
        playerSword.rotation.set(Math.PI / 2, 0, -Math.PI / 8 + idleZRotBob);
        playerSword.visible = false;
      }
    } else {
      // 2. KATAR SWORD MULTI-ATTACK ANIMATION STATE MACHINE
      if (playerSword) {
        if (s.activeWeapon === 'sword') {
          playerSword.visible = true;
          playerHammer.visible = false;
          
          if (s.isLunging) {
            // Pointed straight forward, centered
            playerSword.position.set(0.0, -0.22 + idleYBob, -0.7 + idleXBob);
            playerSword.rotation.set(Math.PI / 2 + 0.15, 0, 0);
            
            s.pSwordReady = false;
            s.pSwordCooldown = 0.5;
          } 
          else if (s.pSwordState === 'ready') {
            // Neutral stance
            playerSword.position.set(0.35, -0.38 + idleYBob, -0.5 + idleXBob);
            playerSword.rotation.set(Math.PI / 2, 0, -Math.PI / 8 + idleZRotBob);
            
            s.pSwordReady = true;
            s.pSwordCooldown = 1.0;
          }
          else if (s.pSwordState === 'slashing') {
            s.pSwordTimer += dt;
            const duration = s.settings.swordSlashSpeed ?? 0.22;
            const pct = Math.min(1.0, s.pSwordTimer / duration);
            
            // Sweep horizontally left to right
            playerSword.position.x = THREE.MathUtils.lerp(-0.45, 0.45, pct);
            playerSword.position.y = THREE.MathUtils.lerp(-0.35, -0.28, pct) + idleYBob;
            playerSword.position.z = THREE.MathUtils.lerp(-0.4, -0.75, pct) + (pct < 0.5 ? -0.15 : 0.15);
            
            playerSword.rotation.x = Math.PI / 2;
            playerSword.rotation.y = THREE.MathUtils.lerp(-1.2, 1.2, pct);
            playerSword.rotation.z = THREE.MathUtils.lerp(0.6, -1.5, pct);
            
            s.pSwordCooldown = 1.0 - pct * 0.4;
            
            // Apply horizontal slash swing damage trace precisely at midpoint
            if (pct >= 0.5 && (s.pSwordTimer - dt) < duration * 0.5) {
              const eyePos = new THREE.Vector3(s.playerPos.x, 1.65 - s.crouchAmount + s.playerPos.y, s.playerPos.z);
              const cameraLookDir = new THREE.Vector3(0, 0, -1)
                .applyAxisAngle(new THREE.Vector3(1, 0, 0), s.pitch)
                .applyAxisAngle(new THREE.Vector3(0, 1, 0), s.yaw)
                .normalize();

              // Check main AI bot in single player
              if (!isMultiplayer && s.aiHP > 0 && s.aiState !== 'RESPAWNING' && s.aiInvulnerabilityTimer <= 0) {
                const enemyCenter = new THREE.Vector3(s.aiPos.x, s.aiPos.y + 0.825, s.aiPos.z);
                const toEnemy = enemyCenter.clone().sub(eyePos);
                const dist = toEnemy.length();
                if (dist <= 2.8) {
                  const toEnemyDir = toEnemy.clone().normalize();
                  const dot = cameraLookDir.dot(toEnemyDir);
                  const angle = Math.acos(Math.max(-1.0, Math.min(1.0, dot)));
                  
                  if (angle <= 1.0) {
                    const swordThreshold = s.settings.swordTradeWindow ?? 350;
                    const isAISwordActiveAttack = s.settings.enableSwordTrade && s.aiActiveWeapon === 'sword' && (
                      s.aiState === 'LUNGING' || 
                      s.aiWeaponState === 'swing_up' || 
                      s.aiWeaponState === 'swing_down' || 
                      (Date.now() - s.lastAISwordAttackTime <= swordThreshold)
                    );
                    if (isAISwordActiveAttack) {
                      executeTrade('sword_vs_sword');
                      return;
                    }

                    s.aiHP -= 1;
                    sfx.playSwing();
                    spawnVoxelShockwaveParticles(s.aiPos, '#22d3ee');
                    s.lastStrikePos = s.aiPos.clone();
                    s.lastStrikeTick = 1.0;
                    
                    if (s.aiHP <= 0) {
                      s.aiHP = 0;
                      s.aiState = 'RESPAWNING';
                      s.enemyRespawnTimer = 3.0;
                      s.scorePlayer += 1;
                      s.playerKills += 1;
                      s.enemyDeaths += 1;
                      sfx.playDeath();
                      s.aiWeaponState = 'ready';
                      s.aiWeaponTimer = 0;
                      
                      const newDeath = {
                        id: Math.random().toString(36).substring(2, 9),
                        attacker: s.settings.playerName || 'Blue (You)',
                        victim: 'Red (AI)'
                      };
                      s.lastDeaths = [newDeath, ...s.lastDeaths].slice(0, 3);
                      spawnVoxelShockwaveParticles(s.aiPos, '#ef4444');
                    }
                  }
                }
              }

              // Check other players/bots
              if (s.otherPlayers) {
                s.otherPlayers.forEach((other) => {
                  if (other.hp > 0 && !other.isObserver && other.respawnTimer <= 0) {
                    const otherCenter = new THREE.Vector3(other.pos.x, other.pos.y + 0.825, other.pos.z);
                    const toOther = otherCenter.clone().sub(eyePos);
                    const dist = toOther.length();
                    
                    if (dist <= 2.8) {
                      const toOtherDir = toOther.clone().normalize();
                      const dot = cameraLookDir.dot(toOtherDir);
                      const angle = Math.acos(Math.max(-1.0, Math.min(1.0, dot)));
                      
                      if (angle <= 1.0) {
                        if (isMultiplayer) {
                          sfx.playSwing();
                          spawnVoxelShockwaveParticles(new THREE.Vector3(other.pos.x, other.pos.y, other.pos.z), '#22d3ee');
                          s.lastStrikePos = new THREE.Vector3(other.pos.x, other.pos.y, other.pos.z);
                          s.lastStrikeTick = 1.0;
                          
                          if (multiplayerSocket && multiplayerSocket.readyState === WebSocket.OPEN) {
                            multiplayerSocket.send(JSON.stringify({ type: 'sync', action: 'hit_taken', damage: 1, targetId: other.id }));
                          }
                        } else {
                          other.hp -= 1;
                          sfx.playSwing();
                          spawnVoxelShockwaveParticles(new THREE.Vector3(other.pos.x, other.pos.y, other.pos.z), '#22d3ee');
                          s.lastStrikePos = new THREE.Vector3(other.pos.x, other.pos.y, other.pos.z);
                          s.lastStrikeTick = 1.0;
                          
                          if (other.hp <= 0) {
                            other.hp = 0;
                            other.respawnTimer = 3.0;
                            s.scorePlayer += 1;
                            s.playerKills += 1;
                            other.deaths += 1;
                            sfx.playDeath();
                            
                            const newDeath = {
                              id: Math.random().toString(36).substring(2, 9),
                              attacker: s.settings.playerName || 'Blue (You)',
                              victim: other.playerName
                            };
                            s.lastDeaths = [newDeath, ...s.lastDeaths].slice(0, 3);
                            spawnVoxelShockwaveParticles(new THREE.Vector3(other.pos.x, other.pos.y, other.pos.z), '#ef4444');
                          }
                        }
                      }
                    }
                  }
                });
              }
            }
            
            if (pct >= 1.0) {
              s.pSwordState = 'recovering';
              s.pSwordTimer = 0;
              s.pSwordRecoverDuration = s.settings.swordSlashReload ?? 0.6;
            }
          }
          else if (s.pSwordState === 'recovering') {
            s.pSwordTimer += dt;
            const recover = s.pSwordRecoverDuration ?? 0.6;
            const pct = Math.min(1.0, s.pSwordTimer / recover);
            
            playerSword.position.x = THREE.MathUtils.lerp(0.45, 0.35, pct);
            playerSword.position.y = THREE.MathUtils.lerp(-0.28, -0.38, pct) + idleYBob;
            playerSword.position.z = THREE.MathUtils.lerp(-0.75, -0.5, pct);
            
            playerSword.rotation.x = Math.PI / 2;
            playerSword.rotation.y = THREE.MathUtils.lerp(1.2, 0, pct);
            playerSword.rotation.z = THREE.MathUtils.lerp(-1.5, -Math.PI / 8, pct);
            
            s.pSwordCooldown = 0.2 + pct * 0.8;
            
            if (pct >= 1.0) {
              s.pSwordState = 'ready';
              s.pSwordReady = true;
              s.pSwordCooldown = 1.0;
            }
          }
        } else {
          playerSword.visible = false;
        }
      }

      // 3. GRAVITY HAMMER MOTION STATE MACHINE
      if (s.activeWeapon === 'hammer') {
        playerHammer.visible = true;

        if (s.pWeaponState === 'ready') {
          // Place at neutral pose
          playerHammer.position.set(0.35, -0.38 + idleYBob, -0.65 + idleXBob);
          playerHammer.rotation.set(0.15, -0.3, -0.15 + idleZRotBob);
          s.pWeaponReady = true;
          s.pWeaponCooldown = 1.0;
        } 
        else if (s.pWeaponState === 'swing_up') {
          s.pWeaponTimer += dt;
          const windupDuration = 0.28; // 0.28 seconds windup
          const pct = Math.min(1.0, s.pWeaponTimer / windupDuration);
          
          // Pull hammer back and raise it high over head
          const targetY = -0.1;
          const targetZ = -0.4;
          const targetXRot = -1.13; // pull way back
          const targetYRot = -0.5;

          playerHammer.position.y = THREE.MathUtils.lerp(-0.38, targetY, pct);
          playerHammer.position.z = THREE.MathUtils.lerp(-0.65, targetZ, pct);
          playerHammer.rotation.x = THREE.MathUtils.lerp(0.15, targetXRot, pct);
          playerHammer.rotation.y = THREE.MathUtils.lerp(-0.3, targetYRot, pct);

          s.pWeaponCooldown = 1.0 - (pct * 0.3); // cooldown gauge goes down during swing preparation

          if (pct >= 1.0) {
            s.pWeaponState = 'swing_down';
            s.pWeaponTimer = 0;
          }
        } 
        else if (s.pWeaponState === 'swing_down') {
          s.pWeaponTimer += dt;
          const strikeDuration = 0.12; // massive rapid 0.12s slam down
          const pct = Math.min(1.0, s.pWeaponTimer / strikeDuration);

          // Rapidly slam forward
          const startXRot = -1.13;
          const targetXRot = 0.95; // Fully smashed down
          const targetY = -0.48;
          const targetZ = -0.85; // extended slam forward

          playerHammer.position.y = THREE.MathUtils.lerp(-0.1, targetY, pct);
          playerHammer.position.z = THREE.MathUtils.lerp(-0.4, targetZ, pct);
          playerHammer.rotation.x = THREE.MathUtils.lerp(startXRot, targetXRot, pct);

          s.pWeaponCooldown = 0.7 - (pct * 0.5);

          if (pct >= 1.0) {
            // HAMMER SLAMS THE GROUND AT PEAK DOWNWARD SWING
            s.pWeaponState = 'recovering';
            s.pWeaponTimer = 0;

            // Perform combat shockwave triggers
            applyHammerStrikeImpact(true);
          }
        } 
        else if (s.pWeaponState === 'recovering') {
          s.pWeaponTimer += dt;
          const recoveryDuration = s.settings.hammerReloadTime ?? 0.6; // recovery time back to idle poise
          const pct = Math.min(1.0, s.pWeaponTimer / recoveryDuration);

          // Return gracefully to neutral pose
          const startXRot = 0.95;
          const targetXRot = 0.15;
          const startY = -0.48;
          const targetY = -0.38;
          const startZ = -0.85;
          const targetZ = -0.65;

          playerHammer.position.y = THREE.MathUtils.lerp(startY, targetY, pct);
          playerHammer.position.z = THREE.MathUtils.lerp(startXRot === 0.95 ? startZ : playerHammer.position.z, targetZ, pct);
          playerHammer.rotation.x = THREE.MathUtils.lerp(startXRot, targetXRot, pct);
          playerHammer.rotation.y = THREE.MathUtils.lerp(-0.5, -0.3, pct);

          s.pWeaponCooldown = 0.2 + (pct * 0.8);

          if (pct >= 1.0) {
            s.pWeaponState = 'ready';
            s.pWeaponCooldown = 1.0;
            s.pWeaponReady = true;
          }
        }
      } else {
        playerHammer.visible = false;
      }
    }

    // ENEMY AI WEAPON ANIMATION AND VISIBILITY
    const enemyHammerModel = threeRef.current.enemyHammer;
    const enemySwordModel = threeRef.current.enemySword;

    if (enemyHammerModel) {
      enemyHammerModel.visible = s.aiHP > 0 && s.aiState !== 'RESPAWNING' && s.aiActiveWeapon === 'hammer';
    }
    if (enemySwordModel) {
      enemySwordModel.visible = s.aiHP > 0 && s.aiState !== 'RESPAWNING' && s.aiActiveWeapon === 'sword';
    }

    if (s.aiHP <= 0 || s.aiState === 'RESPAWNING') {
      s.aiWeaponState = 'ready';
      s.aiWeaponTimer = 0;
      if (enemyHammerModel) {
        enemyHammerModel.position.set(0.48, 1.08 - 0.64, -0.48);
        enemyHammerModel.rotation.set(0.2, 0.1, -0.15);
      }
      if (enemySwordModel) {
        enemySwordModel.position.set(0.48, 1.08 - 0.64, -0.32);
        enemySwordModel.rotation.set(Math.PI / 2, 0, -Math.PI / 8);
      }
    } else {
      if (s.aiActiveWeapon === 'hammer' && enemyHammerModel) {
        if (s.aiWeaponState === 'ready') {
          enemyHammerModel.position.set(0.48, 1.08 - 0.64, -0.48);
          enemyHammerModel.rotation.set(0.2, 0.1, -0.15);
        } 
        else if (s.aiWeaponState === 'swing_up') {
          s.aiWeaponTimer += dt;
          const windup = 0.32;
          const pct = Math.min(1.0, s.aiWeaponTimer / windup);
          
          enemyHammerModel.position.set(
            THREE.MathUtils.lerp(0.48, 0.4, pct),
            THREE.MathUtils.lerp(1.08, 1.8, pct) - 0.64, // high over head
            THREE.MathUtils.lerp(-0.48, -0.15, pct)
          );
          enemyHammerModel.rotation.x = THREE.MathUtils.lerp(0.2, -1.3, pct); // swing back

          if (pct >= 1.0) {
            s.aiWeaponState = 'swing_down';
            s.aiWeaponTimer = 0;
          }
        } 
        else if (s.aiWeaponState === 'swing_down') {
          s.aiWeaponTimer += dt;
          const strike = 0.13;
          const pct = Math.min(1.0, s.aiWeaponTimer / strike);

          enemyHammerModel.position.set(
            THREE.MathUtils.lerp(0.4, 0.2, pct),
            THREE.MathUtils.lerp(1.8, 0.6, pct) - 0.64, // smash hard down
            THREE.MathUtils.lerp(-0.15, -0.9, pct) // reach forward
          );
          enemyHammerModel.rotation.x = THREE.MathUtils.lerp(-1.3, 1.1, pct);

          if (pct >= 1.0) {
            s.aiWeaponState = 'recovering';
            s.aiWeaponTimer = 0;

            // Perform Enemy damage check
            applyHammerStrikeImpact(false);
          }
        } 
        else if (s.aiWeaponState === 'recovering') {
          s.aiWeaponTimer += dt;
          const recover = s.settings.hammerReloadTime ?? 0.6;
          const pct = Math.min(1.0, s.aiWeaponTimer / recover);

          enemyHammerModel.position.set(
            THREE.MathUtils.lerp(0.2, 0.48, pct),
            THREE.MathUtils.lerp(0.6, 1.08, pct) - 0.64,
            THREE.MathUtils.lerp(-0.9, -0.48, pct)
          );
          enemyHammerModel.rotation.x = THREE.MathUtils.lerp(1.1, 0.2, pct);

          if (pct >= 1.0) {
            s.aiWeaponState = 'ready';
            s.aiWeaponTimer = 0;
          }
        }
      } else if (s.aiActiveWeapon === 'sword' && enemySwordModel) {
        // ENEMY KATAR SWORD WALK / STRIKE ANIMATION
        if (s.aiState === 'LUNGING') {
          // Lunge forward poise: points straight forward, aligned centered
          enemySwordModel.position.set(0.0, 1.2 - 0.64, -0.75);
          enemySwordModel.rotation.set(Math.PI / 2 + 0.15, 0, 0);
        } else if (s.aiWeaponState === 'ready') {
          enemySwordModel.position.set(0.48, 1.08 - 0.64, -0.32);
          enemySwordModel.rotation.set(Math.PI / 2, 0, -Math.PI / 8);
        } 
        else if (s.aiWeaponState === 'swing_up') {
          s.aiWeaponTimer += dt;
          const windup = s.settings.swordSlashSpeed ? s.settings.swordSlashSpeed * 0.4 : 0.1;
          const pct = Math.min(1.0, s.aiWeaponTimer / windup);
          
          enemySwordModel.position.set(
            THREE.MathUtils.lerp(0.48, 0.62, pct),
            THREE.MathUtils.lerp(1.08, 1.2, pct) - 0.64,
            THREE.MathUtils.lerp(-0.32, -0.15, pct)
          );
          enemySwordModel.rotation.set(
            Math.PI / 2,
            THREE.MathUtils.lerp(0, 0.6, pct),
            THREE.MathUtils.lerp(-Math.PI / 8, Math.PI / 4, pct)
          );

          if (pct >= 1.0) {
            s.aiWeaponState = 'swing_down';
            s.aiWeaponTimer = 0;
          }
        } 
        else if (s.aiWeaponState === 'swing_down') {
          s.aiWeaponTimer += dt;
          const strike = s.settings.swordSlashSpeed ? s.settings.swordSlashSpeed * 0.6 : 0.12;
          const pct = Math.min(1.0, s.aiWeaponTimer / strike);

          enemySwordModel.position.set(
            THREE.MathUtils.lerp(0.62, 0.2, pct),
            THREE.MathUtils.lerp(1.2, 0.9, pct) - 0.64,
            THREE.MathUtils.lerp(-0.15, -0.75, pct)
          );
          enemySwordModel.rotation.set(
            Math.PI / 2,
            THREE.MathUtils.lerp(0.6, -0.8, pct),
            THREE.MathUtils.lerp(Math.PI / 4, -Math.PI / 3, pct)
          );

          if (pct >= 1.0) {
            s.aiWeaponState = 'recovering';
            s.aiWeaponTimer = 0;

            // Perform Enemy Sword Slash hit check
            applyEnemySwordSlashImpact();
          }
        } 
        else if (s.aiWeaponState === 'recovering') {
          s.aiWeaponTimer += dt;
          const recover = s.settings.swordSlashReload ?? 0.6;
          const pct = Math.min(1.0, s.aiWeaponTimer / recover);

          enemySwordModel.position.set(
            THREE.MathUtils.lerp(0.2, 0.48, pct),
            THREE.MathUtils.lerp(0.9, 1.08, pct) - 0.64,
            THREE.MathUtils.lerp(-0.75, -0.32, pct)
          );
          enemySwordModel.rotation.set(
            Math.PI / 2,
            THREE.MathUtils.lerp(-0.8, 0, pct),
            THREE.MathUtils.lerp(-Math.PI / 3, -Math.PI / 8, pct)
          );

          if (pct >= 1.0) {
            s.aiWeaponState = 'ready';
            s.aiWeaponTimer = 0;
          }
        }
      }
    }
  };

  // COMBAT IMPACT: Spawns particle blast, plays heavy explosion audio, and inflicts damage in custom sphere check
  const applyHammerStrikeImpact = (isPlayerStriking: boolean) => {
    const s = stateRef.current;
    
    // Play colossal explosion thump & sparks sound
    sfx.playExplosion();

    if (isPlayerStriking) {
      if (s.playerHP <= 0) return; // Prevent dead players' attacks from executing
      // 1. Calculate impact center point at the 3D location of the cursor (using yaw and pitch from eye height)
      const eyePos = new THREE.Vector3(
        s.playerPos.x,
        1.65 - s.crouchAmount + s.playerPos.y,
        s.playerPos.z
      );
      
      const lookHeading = new THREE.Vector3(0, 0, -1)
        .applyAxisAngle(new THREE.Vector3(1, 0, 0), s.pitch)
        .applyAxisAngle(new THREE.Vector3(0, 1, 0), s.yaw)
        .normalize();
      
      const impactPos = eyePos.clone().addScaledVector(lookHeading, s.settings.attackRange);

      s.lastStrikePos = impactPos;
      s.lastStrikeTick = 1.5; // linger visual debugger for 1.5s

      // Check for Hammer Jump eligibility (ground distance check within settings.hammerJumpTriggerRadius)
      if (s.activeWeapon === 'hammer') {
        const distToBase = impactPos.distanceTo(s.playerPos);
        if (distToBase <= (s.settings.hammerJumpTriggerRadius ?? 3.5)) {
          s.pHammerJumpWindowTimer = s.settings.hammerJumpWindow ?? 0.6;
        }
      }

      // Spawn glorious voxel particles (Glowing Cyan for cyber theme)
      spawnVoxelShockwaveParticles(impactPos, '#38bdf8');

      // 2. Damage Application Check: Check main AI bot in singleplayer
      if (!isMultiplayer && s.aiHP > 0 && s.aiState !== 'RESPAWNING' && s.aiInvulnerabilityTimer <= 0) {
        const enemyBodyCenter = new THREE.Vector3(s.aiPos.x, s.aiPos.y + 0.825, s.aiPos.z);
        const dist = impactPos.distanceTo(enemyBodyCenter);
        
        if (dist <= s.settings.attackRadius) {
          s.aiHP -= 1;
          sfx.playSwing();
          spawnVoxelShockwaveParticles(s.aiPos, '#22d3ee');
          s.lastStrikePos = s.aiPos.clone();
          s.lastStrikeTick = 1.0;
          
          if (s.aiHP <= 0) {
            s.aiHP = 0;
            s.aiState = 'RESPAWNING';
            s.enemyRespawnTimer = 3.0;
            s.scorePlayer += 1;
            s.playerKills += 1;
            s.enemyDeaths += 1;
            sfx.playDeath();
            s.aiWeaponState = 'ready';
            s.aiWeaponTimer = 0;
            
            const newDeath = {
              id: Math.random().toString(36).substring(2, 9),
              attacker: s.settings.playerName || 'Blue (You)',
              victim: 'Red (AI)',
            };
            s.lastDeaths = [newDeath, ...s.lastDeaths].slice(0, 3);
            spawnVoxelShockwaveParticles(s.aiPos, '#ef4444');
          }
        }
      }

      // Check other players/bots in room
      if (s.otherPlayers) {
        s.otherPlayers.forEach((other) => {
          if (other.hp > 0 && !other.isObserver && other.respawnTimer <= 0) {
            const otherBodyCenter = new THREE.Vector3(other.pos.x, other.pos.y + 0.825, other.pos.z);
            const dist = impactPos.distanceTo(otherBodyCenter);
            
            if (dist <= s.settings.attackRadius) {
              if (isMultiplayer) {
                sfx.playSwing();
                spawnVoxelShockwaveParticles(new THREE.Vector3(other.pos.x, other.pos.y, other.pos.z), '#e2e8f0');
                s.lastStrikePos = new THREE.Vector3(other.pos.x, other.pos.y, other.pos.z);
                s.lastStrikeTick = 1.0;
                
                if (multiplayerSocket && multiplayerSocket.readyState === WebSocket.OPEN) {
                  multiplayerSocket.send(JSON.stringify({ type: 'sync', action: 'hit_taken', damage: 1, targetId: other.id }));
                }
              } else {
                other.hp -= 1;
                sfx.playSwing();
                spawnVoxelShockwaveParticles(new THREE.Vector3(other.pos.x, other.pos.y, other.pos.z), '#22d3ee');
                s.lastStrikePos = new THREE.Vector3(other.pos.x, other.pos.y, other.pos.z);
                s.lastStrikeTick = 1.0;
                
                if (other.hp <= 0) {
                  other.hp = 0;
                  other.respawnTimer = 3.0;
                  s.scorePlayer += 1;
                  s.playerKills += 1;
                  other.deaths += 1;
                  sfx.playDeath();
                  
                  const newDeath = {
                    id: Math.random().toString(36).substring(2, 9),
                    attacker: s.settings.playerName || 'Blue (You)',
                    victim: other.playerName
                  };
                  s.lastDeaths = [newDeath, ...s.lastDeaths].slice(0, 3);
                  spawnVoxelShockwaveParticles(new THREE.Vector3(other.pos.x, other.pos.y, other.pos.z), '#ef4444');
                }
              }
            }
          }
        });
      }
    } else {
      if (isMultiplayer) return; // In multiplayer, we do not run AI strike simulations!
      if (s.aiHP <= 0 || s.aiState === 'RESPAWNING') return; // Prevent dead enemies' attacks from executing
      // ENEMY AI IS STRIKING
      // The AI tracks the player with its "cursor" in 3D, OR aims beneath itself for a hammer jump!
      const aiEyePos = new THREE.Vector3(s.aiPos.x, s.aiPos.y + 1.2, s.aiPos.z);
      const playerBodyCenter = new THREE.Vector3(
        s.playerPos.x,
        s.playerPos.y + (1.65 - s.crouchAmount) / 2 + 0.4,
        s.playerPos.z
      );
      
      let aiHeading3D: THREE.Vector3;
      if (s.aiHammerJumpPlanned) {
        aiHeading3D = new THREE.Vector3(0, -1, 0);
      } else {
        aiHeading3D = playerBodyCenter.clone().sub(aiEyePos).normalize();
      }
      
      const impactPos = aiEyePos.clone().addScaledVector(aiHeading3D, s.settings.attackRange * 0.875);

      s.lastAIStrikePos = impactPos;
      s.lastAIStrikeTick = 1.5;

      // Check for Hammer Jump eligibility for AI (distance check)
      const distToBase = impactPos.distanceTo(s.aiPos);
      if (distToBase <= (s.settings.hammerJumpTriggerRadius ?? 3.5)) {
        s.aiHammerJumpWindowTimer = s.settings.hammerJumpWindow ?? 0.6;
      }

      // Spawn Solar Orange explosion particles
      spawnVoxelShockwaveParticles(impactPos, '#f97316');

      // Damage player check: Compare strike sphere coordinate with player's 3D body center
      if (s.playerHP > 0 && s.playerInvulnerabilityTimer <= 0) {
        const dist = impactPos.distanceTo(playerBodyCenter);

        if (dist <= s.settings.attackRadius) {
          // Reduce player health
          s.playerHP -= 1;
          if (s.playerHP <= 0) {
            s.playerHP = 0;
            s.playerRespawnTimer = 3.0;
            s.scoreEnemy += 1;
            s.playerDeaths += 1;
            s.enemyKills += 1;
            sfx.playDeath();
            s.pWeaponState = 'ready';
            s.pWeaponTimer = 0;
            s.pWeaponReady = true;
            s.pSwordState = 'ready';
            s.pSwordTimer = 0;
            s.pSwordReady = true;
            s.isLunging = false;
            s.lungeTimer = 0;

            // Record death event (last 3 entries)
            const newDeath: DeathEvent = {
              id: Math.random().toString(36).substring(2, 9),
              attacker: 'Red (AI)',
              victim: 'Blue (You)',
            };
            s.lastDeaths = [newDeath, ...s.lastDeaths].slice(0, 3);

            // Spawn death particles on player
            spawnVoxelShockwaveParticles(s.playerPos, '#3b82f6');
          } else {
            // Non-lethal player hit
            sfx.playSwing();
            spawnVoxelShockwaveParticles(s.playerPos, '#e2e8f0');
          }
        }
      }
    }
  };

  const applyEnemySwordSlashImpact = () => {
    const s = stateRef.current;
    if (s.aiHP <= 0 || s.aiState === 'RESPAWNING') return;
    
    // Slash trace centering forward in front of the AI
    const lookHeading = s.playerPos.clone().sub(s.aiPos).normalize();
    const impactPos = s.aiPos.clone().addScaledVector(lookHeading, 2.2); // sweet spot distance
    
    s.lastAIStrikePos = impactPos;
    s.lastAIStrikeTick = 1.0;
    
    sfx.playSwing();
    spawnVoxelShockwaveParticles(impactPos, '#ef4444');
    
    if (isMultiplayer) return; // In multiplayer, we do not run AI damage checks against local player!
    
    if (s.playerHP > 0 && s.playerInvulnerabilityTimer <= 0) {
      const playerBodyCenter = new THREE.Vector3(
        s.playerPos.x,
        s.playerPos.y + (1.65 - s.crouchAmount) / 2 + 0.4,
        s.playerPos.z
      );
      const dist = impactPos.distanceTo(playerBodyCenter);
      
      if (dist <= 2.8) {
        // Evaluate trades FIRST
        const swordThreshold = s.settings.swordTradeWindow ?? 350;
        const isPlayerSwordActiveAttack = s.settings.enableSwordTrade && s.activeWeapon === 'sword' && (
          s.isLunging ||
          s.pSwordState === 'slashing' ||
          (Date.now() - s.lastPlayerSwordAttackTime <= swordThreshold)
        );

        if (isPlayerSwordActiveAttack) {
          executeTrade('sword_vs_sword');
          return;
        }

        // Red team AI hits the player with sword slash!
        s.playerHP -= 1;
        if (s.playerHP <= 0) {
          s.playerHP = 0;
          s.playerRespawnTimer = 3.0;
          s.scoreEnemy += 1;
          s.playerDeaths += 1;
          s.enemyKills += 1;
          sfx.playDeath();
          s.pWeaponState = 'ready';
          s.pWeaponTimer = 0;
          s.pWeaponReady = true;
          s.pSwordState = 'ready';
          s.pSwordTimer = 0;
          s.pSwordReady = true;
          s.isLunging = false;
          s.lungeTimer = 0;
          
          const newDeath = {
            id: Math.random().toString(36).substring(2, 9),
            attacker: 'Red (AI) [Slash]',
            victim: 'Blue (You)',
          };
          s.lastDeaths = [newDeath, ...s.lastDeaths].slice(0, 3);
          spawnVoxelShockwaveParticles(s.playerPos, '#3b82f6');
        } else {
          sfx.playSwing();
          spawnVoxelShockwaveParticles(s.playerPos, '#e2e8f0');
        }
      }
    }
  };

  // ENEMY AI PATHFINDING & FENCING STRATEGY
  const updateAI = (dt: number) => {
    const s = stateRef.current;
    const enemyMesh = threeRef.current.enemyGroup;

    if (!enemyMesh) return;

    if (isMultiplayer) {
      // In multiplayer, the remote Spartan coordinates and actions guide the render state
      if (s.aiHP <= 0) {
        enemyMesh.visible = false;
        s.enemyRespawnTimer = Math.max(0, s.enemyRespawnTimer - dt);
        return;
      }

      enemyMesh.visible = true;

      if (s.aiInvulnerabilityTimer > 0) {
        s.aiInvulnerabilityTimer = Math.max(0, s.aiInvulnerabilityTimer - dt);
      }

      enemyMesh.rotation.y = s.aiYaw;

      if (s.aiIsCrouching) {
        enemyMesh.scale.set(1, 0.65, 1);
      } else {
        enemyMesh.scale.set(1, 1, 1);
      }

      enemyMesh.position.copy(s.aiPos);

      // Support rendering custom sword trail particles if the opponent is in active lunge state
      if (s.aiState === 'LUNGING') {
        s.aiLungeTimer += dt;
        const lungeSpeed = s.settings.swordLungeSpeed ?? 24.0;
        s.aiVel.copy(s.aiLungeTargetDir).multiplyScalar(lungeSpeed);
        
        s.aiPos.x += s.aiVel.x * dt;
        s.aiPos.z += s.aiVel.z * dt;
        enemyMesh.position.copy(s.aiPos);

        if (Math.random() > 0.1) {
          const trailPos = s.aiPos.clone();
          trailPos.y += 0.825;
          spawnVoxelShockwaveParticles(trailPos, '#ef4444');
        }

        if (s.aiLungeTimer > 0.8) {
          s.aiState = 'APPROACHING';
        }
      }
      return;
    }

    // Is the enemy currently dead and counting down respawn?
    if (s.aiHP <= 0 || s.aiState === 'RESPAWNING') {
      // Hide model
      enemyMesh.visible = false;
      
      s.enemyRespawnTimer -= dt;
      if (s.enemyRespawnTimer <= 0) {
        s.aiHP = s.aiMaxHP;
        s.aiState = 'APPROACHING';
        
        const exclude: THREE.Vector3[] = [s.playerPos];
        if (s.otherPlayers) {
          s.otherPlayers.forEach((other) => {
            if (other.hp > 0 && other.respawnTimer <= 0) {
              exclude.push(new THREE.Vector3(other.pos.x, other.pos.y, other.pos.z));
            }
          });
        }
        
        const spawnPos = getOptimalSpawnPoint(exclude);
        s.aiPos.copy(spawnPos);
        s.aiVel.set(0, 0, 0);
        s.aiYaw = Math.atan2(-spawnPos.x, -spawnPos.z);
        enemyMesh.visible = true;
        s.aiWeaponState = 'ready';
        s.aiInvulnerabilityTimer = s.settings.respawnInvulnerabilityDuration;
        sfx.playRespawn();

      }
      return;
    }

    // Tick down ai invulnerability timer
    if (s.aiInvulnerabilityTimer > 0) {
      s.aiInvulnerabilityTimer = Math.max(0, s.aiInvulnerabilityTimer - dt);
    }

    enemyMesh.visible = true;

    // 1. Resolve AI Settings & Parameters based on difficulty presets or custom parameters
    const difficultyPreset = s.settings.aiDifficulty || 'normal';
    let reactionLatency = s.settings.aiReactionLatency ?? 0.25;
    let anticipationFactor = s.settings.aiAnticipationFactor ?? 0.40;
    let movementComplexity = s.settings.aiMovementComplexity ?? 50; // 0 to 100
    let weaponSwapIQ = s.settings.aiWeaponSwapIQ ?? 50; // 0 to 100

    if (difficultyPreset === 'easy') {
      reactionLatency = 0.55;
      anticipationFactor = 0.08;
      movementComplexity = 20;
      weaponSwapIQ = 15;
    } else if (difficultyPreset === 'normal') {
      reactionLatency = 0.25;
      anticipationFactor = 0.40;
      movementComplexity = 50;
      weaponSwapIQ = 50;
    } else if (difficultyPreset === 'hard') {
      reactionLatency = 0.08;
      anticipationFactor = 0.78;
      movementComplexity = 80;
      weaponSwapIQ = 88;
    } else if (difficultyPreset === 'nightmare') {
      reactionLatency = 0.01;
      anticipationFactor = 0.98;
      movementComplexity = 98;
      weaponSwapIQ = 98;
    }

    // 2. Trajectory Prediction Engine (Anticipate Player Movements)
    // Higher anticipation factor means the AI projects further ahead, while reaction latency introduces a lag.
    const anticipationBonus = anticipationFactor * 0.42; // scale prediction projection
    const predictedPlayerPos = s.playerPos.clone();
    if (s.playerVel && s.playerVel.length() > 0.15 && anticipationFactor > 0.1) {
      predictedPlayerPos.addScaledVector(s.playerVel, reactionLatency + anticipationBonus);
    }
    
    // Maintain arena boundaries for prediction so AI doesn't lunge outside arena
    const predDistFromCenter = Math.sqrt(predictedPlayerPos.x * predictedPlayerPos.x + predictedPlayerPos.z * predictedPlayerPos.z);
    if (predDistFromCenter > s.arenaRadius - 0.6) {
      const angle = Math.atan2(predictedPlayerPos.z, predictedPlayerPos.x);
      predictedPlayerPos.x = Math.cos(angle) * (s.arenaRadius - 0.6);
      predictedPlayerPos.z = Math.sin(angle) * (s.arenaRadius - 0.6);
    }

    // Vector to predicted player position
    const toPlayer = predictedPlayerPos.clone().sub(s.aiPos);
    toPlayer.y = 0; // maintain horizon plane
    const distanceToPlayer = toPlayer.length();
    
    // Look and face at predicted trajectory heading (leading the player!)
    s.aiYaw = Math.atan2(toPlayer.x, toPlayer.z);
    enemyMesh.rotation.y = s.aiYaw;

    // 3. Dynamic Mechanics Understanding & Admin Settings Coupling
    const playerAttackRange = s.settings.attackRange;
    const playerAttackRadius = s.settings.attackRadius;
    const playerDangerZone = playerAttackRange + playerAttackRadius * 0.85;

    const aiAttackRange = s.settings.attackRange;
    const aiAttackRadius = s.settings.attackRadius;
    const aiReach = aiAttackRange + aiAttackRadius * 0.75;

    const playerIsProtected = s.playerInvulnerabilityTimer > 0;
    const playerAimedAtAI = s.crosshairColor === 'red';

    // AI Crouching state tracking & visual Y scale contraction
    const isTacticalState = s.aiState === 'SIDE_STEPPING' || s.aiState === 'COOLDOWN';
    const crouchCycle = (s.aiSwayTimer % 4.0) < 1.5;
    s.aiIsCrouching = isTacticalState && crouchCycle && (movementComplexity > 30);

    // Hyper-strafe & Crouch Dodge when player is aiming directly at the AI
    if (playerAimedAtAI && (movementComplexity >= 70) && Math.random() < 0.18) {
      s.aiIsCrouching = !s.aiIsCrouching; // Toggle crouch dodge
      s.aiSwayTimer += Math.PI; // Instantly invert strafe sway direction
      
      // Evasive dash if off cooldown
      if (s.aiDashCooldownTimer <= 0 && Math.random() < 0.4) {
        const sideDir = Math.random() > 0.5 ? 1 : -1;
        const lookHeading = toPlayer.clone().normalize();
        const sidewayHeading = new THREE.Vector3(-lookHeading.z, 0, lookHeading.x);
        s.aiDashDir.copy(sidewayHeading).multiplyScalar(sideDir).normalize();
        s.aiDashRemaining = s.settings.dashDuration || 0.25;
        s.aiDashCooldownTimer = s.settings.dashCooldown || 2.0;
        sfx.playDash();
      }
    }

    if (s.aiIsCrouching) {
      enemyMesh.scale.set(1, 0.65, 1);
    } else {
      enemyMesh.scale.set(1, 1, 1);
    }

    // Sync AI vertical jump positions
    enemyMesh.position.copy(s.aiPos);

    if (s.aiState === 'LUNGING') {
      s.aiLungeTimer += dt;
      const lungeSpeed = s.settings.swordLungeSpeed ?? 24.0;
      s.aiVel.copy(s.aiLungeTargetDir).multiplyScalar(lungeSpeed);
      
      s.aiPos.x += s.aiVel.x * dt;
      s.aiPos.z += s.aiVel.z * dt;
      s.aiPos.y = 0;
      s.aiVel.y = 0;
      s.aiIsJumping = false;
      enemyMesh.position.copy(s.aiPos);
      
      // Spawn beautiful cyber sword trail particles for AI (Glowing crimson red/rust)
      if (Math.random() > 0.1) {
        const trailPos = s.aiPos.clone();
        trailPos.y += 0.825; // center torso
        const scene = threeRef.current.scene;
        if (scene) {
          const geo = new THREE.BoxGeometry(0.12, 0.12, 0.12);
          const mat = new THREE.MeshBasicMaterial({
            color: new THREE.Color('#ef4444'), // Red
            transparent: true,
            opacity: 0.75,
          });
          const mesh = new THREE.Mesh(geo, mat);
          mesh.position.copy(trailPos);
          scene.add(mesh);
          threeRef.current.damageExplosionParticles.push({
            mesh,
            velocity: new THREE.Vector3((Math.random() - 0.5) * 0.1, Math.random() * 0.15, (Math.random() - 0.5) * 0.1),
            life: 0.0,
            maxLife: 0.18,
          });
        }
      }
      
      // Check distance to player body center
      const dist = s.aiPos.distanceTo(s.playerPos);
      if (s.playerHP <= 0) {
        s.aiState = 'COOLDOWN';
        s.aiTimer = s.settings.swordLungeReload ?? 1.2;
        s.aiWeaponState = 'ready';
      } else if (dist <= 1.5) {
        // Evaluate trades FIRST
        const swordThreshold = s.settings.swordTradeWindow ?? 350;
        const hammerThreshold = s.settings.hammerSwordTradeWindow ?? 350;
        const isPlayerSwordActiveAttack = s.settings.enableSwordTrade && s.activeWeapon === 'sword' && (
          s.isLunging ||
          s.pSwordState === 'slashing' ||
          (Date.now() - s.lastPlayerSwordAttackTime <= swordThreshold)
        );
        const isPlayerHammerActiveAttack = s.settings.enableHammerSwordTrade && s.activeWeapon === 'hammer' && (
          s.pWeaponState === 'swing_up' ||
          s.pWeaponState === 'swing_down' ||
          (Date.now() - s.lastPlayerHammerAttackTime <= hammerThreshold)
        );

        if (isPlayerSwordActiveAttack) {
          executeTrade('sword_vs_sword');
          return;
        } else if (isPlayerHammerActiveAttack) {
          executeTrade('sword_lunge_vs_hammer');
          return;
        }

        // Deal 1 damage to player on lunge connect!
        s.playerHP -= 1;
        s.aiState = 'COOLDOWN';
        s.aiTimer = s.settings.swordLungeReload ?? 1.2;
        s.aiWeaponState = 'ready';
        
        sfx.playExplosion();
        spawnVoxelShockwaveParticles(s.playerPos, '#ef4444');
        
        s.lastAIStrikePos = s.playerPos.clone();
        s.lastAIStrikeTick = 1.2;
        
        if (s.playerHP <= 0) {
          s.playerHP = 0;
          s.playerRespawnTimer = 3.0;
          s.scoreEnemy += 1;
          s.playerDeaths += 1;
          s.enemyKills += 1;
          sfx.playDeath();
          s.pWeaponState = 'ready';
          s.pWeaponTimer = 0;
          s.pWeaponReady = true;
          s.pSwordState = 'ready';
          s.pSwordTimer = 0;
          s.pSwordReady = true;
          s.isLunging = false;
          s.lungeTimer = 0;
          
          const newDeath = {
            id: Math.random().toString(36).substring(2, 9),
            attacker: 'Red (AI) [Lunge]',
            victim: 'Blue (You)',
          };
          s.lastDeaths = [newDeath, ...s.lastDeaths].slice(0, 3);
          spawnVoxelShockwaveParticles(s.playerPos, '#3b82f6');
        } else {
          // Play swift hit sound
          sfx.playSwing();
          spawnVoxelShockwaveParticles(s.playerPos, '#e2e8f0');
        }
      }
      
      // Safeguard limits to break out of lunge
      const startDist = s.aiPos.distanceTo(s.aiLungeStartPos);
      if (startDist > 16.0 || s.aiLungeTimer > 0.8) {
        s.aiState = 'COOLDOWN';
        s.aiTimer = s.settings.swordLungeReload ?? 1.2;
        s.aiWeaponState = 'ready';
      }
      
      // Keep inside arena check
      const distFromCenter = Math.sqrt(s.aiPos.x * s.aiPos.x + s.aiPos.z * s.aiPos.z);
      if (distFromCenter > s.arenaRadius - 0.6) {
        const angle = Math.atan2(s.aiPos.z, s.aiPos.x);
        s.aiPos.x = Math.cos(angle) * (s.arenaRadius - 0.6);
        s.aiPos.z = Math.sin(angle) * (s.arenaRadius - 0.6);
        s.aiState = 'COOLDOWN';
        s.aiTimer = s.settings.swordLungeReload ?? 1.2;
        s.aiWeaponState = 'ready';
      }
      
      return; // Skip normal movement behavior while lunging!
    }

    // AI combat decision-making ticker
    s.aiTimer -= dt;
    s.aiSwayTimer += dt;

    const lookHeading = toPlayer.clone().normalize();
    const sidewayHeading = new THREE.Vector3(-lookHeading.z, 0, lookHeading.x); // perpendicular relative path

    // 4. Air Strafing & Jump Physics Mechanics
    if (s.aiIsJumping && s.aiHP > 0) {
      // Air strafing dynamic controls
      if (movementComplexity >= 45) {
        const sideDir = Math.sin(s.aiSwayTimer * 3.0) > 0 ? 1 : -1;
        s.aiVel.x += (sidewayHeading.x * 2.0 * sideDir + lookHeading.x * 0.4) * dt;
        s.aiVel.z += (sidewayHeading.z * 2.0 * sideDir + lookHeading.z * 0.4) * dt;
      }
    }

    // AI Hammer jump trigger!
    if (s.aiHammerJumpWindowTimer > 0) {
      s.aiIsJumping = true;
      s.aiVel.y = 7.2 + (s.settings.hammerJumpPower ?? 6.5);
      
      if (s.aiHammerJumpType === 'offensive') {
        // Boost forward to slam or close distance with momentum
        s.aiVel.x = lookHeading.x * (7.2 + (s.settings.speedForward / 120) * 1.5);
        s.aiVel.z = lookHeading.z * (7.2 + (s.settings.speedForward / 120) * 1.5);
      } else if (s.aiHammerJumpType === 'defensive') {
        // Boost backwards or sidewards away from the player
        s.aiVel.x = -lookHeading.x * (6.2 + (s.settings.speedBackward / 120) * 1.2);
        s.aiVel.z = -lookHeading.z * (6.2 + (s.settings.speedBackward / 120) * 1.2);
      }
      
      s.aiHammerJumpWindowTimer = 0; // Consume the window
      s.aiHammerJumpPlanned = false;
      s.aiHammerJumpType = undefined;
      sfx.playJump();
      // Spawn glorious golden shockwave particles under AI feet
      spawnVoxelShockwaveParticles(s.aiPos, '#f59e0b');
    }

    // Process AI dash timers
    if (s.aiDashCooldownTimer > 0) {
      s.aiDashCooldownTimer = Math.max(0, s.aiDashCooldownTimer - dt);
    }

    const isAIDashing = s.aiDashRemaining > 0;
    if (isAIDashing) {
      s.aiDashRemaining = Math.max(0, s.aiDashRemaining - dt);
      
      const speed = s.settings.dashDistance / (s.settings.dashDuration || 0.25);
      s.aiVel.copy(s.aiDashDir).multiplyScalar(speed);
      s.aiPos.addScaledVector(s.aiVel, dt);

      // Spawn beautiful solar orange tail particles
      if (Math.random() > 0.15) {
        const trailPos = s.aiPos.clone();
        trailPos.y += 0.5;
        const scene = threeRef.current.scene;
        if (scene) {
          const geo = new THREE.BoxGeometry(0.12, 0.12, 0.12);
          const mat = new THREE.MeshBasicMaterial({
            color: new THREE.Color('#f97316'), // Orange
            transparent: true,
            opacity: 0.75,
          });
          const mesh = new THREE.Mesh(geo, mat);
          mesh.position.copy(trailPos);
          mesh.position.x += (Math.random() - 0.5) * 0.3;
          mesh.position.y += (Math.random() - 0.5) * 0.5;
          mesh.position.z += (Math.random() - 0.5) * 0.3;
          scene.add(mesh);
          threeRef.current.damageExplosionParticles.push({
            mesh,
            velocity: new THREE.Vector3((Math.random() - 0.5) * 0.4, Math.random() * 0.2, (Math.random() - 0.5) * 0.4),
            life: 0.0,
            maxLife: 0.25 + Math.random() * 0.15,
          });
        }
      }
    } else {
      // 5. STRATEGIC WEAPON SWAPPING ENGINE (Guided by Weapon Swap IQ and Player states)
      const evaluateAIWeaponChoice = () => {
        if (s.aiHP <= 0 || s.aiState === 'RESPAWNING') return;
        if (s.aiState === 'LUNGING') return;

        // Swapping decisions can fail or delay if weaponSwapIQ is low
        if (Math.random() * 100 > weaponSwapIQ + 10) return;

        const dist = distanceToPlayer;

        // ESCENARIO A: Player spawn shield is active!
        // Swap to Hammer so we have defensive blast jump readiness
        if (playerIsProtected) {
          if (s.aiActiveWeapon !== 'hammer') {
            swapEnemyWeapon('hammer');
          }
          return;
        }

        // ESCENARIO B: Player is low HP (One-hit execute!)
        // Swap to sword to engage rapid execute lunges
        if (s.playerHP <= 1 && dist <= Math.min(18.0, s.settings.swordLungeDistance) && s.playerHP > 0) {
          if (s.aiActiveWeapon !== 'sword') {
            swapEnemyWeapon('sword');
          }
          return;
        }

        // ESCENARIO C: Player is lunging towards AI with sword!
        // Switch to hammer to prepare a counter-trade or a defensive jump
        if (s.isLunging) {
          if (s.aiActiveWeapon !== 'hammer') {
            swapEnemyWeapon('hammer');
          }
          return;
        }

        // ESCENARIO D: Player missed swing (vulnerable during recovering phase)
        // Swap to sword and prepare to execute a punishing lunge
        const minLunge = playerDangerZone * 0.85;
        const maxLunge = Math.min(18.0, s.settings.swordLungeDistance ?? 14.5);
        if (s.pWeaponState === 'recovering' && dist >= minLunge && dist <= maxLunge) {
          if (s.aiActiveWeapon !== 'sword') {
            swapEnemyWeapon('sword');
          }
          return;
        }

        // ESCENARIO E: Player is in sword-lunge range
        if (dist >= minLunge && dist <= maxLunge && s.aiWeaponState === 'ready') {
          if (s.aiActiveWeapon !== 'sword' && Math.random() < 0.22) {
            swapEnemyWeapon('sword');
          }
          return;
        }

        // ESCENARIO F: Extremely close quarters
        // Sword slash is faster than hammer swing, so swap to sword
        if (dist < playerDangerZone * 0.7 && s.aiHP >= s.aiMaxHP * 0.35 && Math.random() < 0.15) {
          if (s.aiActiveWeapon !== 'sword') {
            swapEnemyWeapon('sword');
          }
          return;
        }

        // DEFAULT: Switch back to hammer at longer range or while recovering
        if (dist > maxLunge || s.aiState === 'COOLDOWN') {
          if (s.aiActiveWeapon !== 'hammer' && Math.random() < 0.20) {
            swapEnemyWeapon('hammer');
          }
        }
      };
      evaluateAIWeaponChoice();

      // Fencing combat state machine
      if (s.aiIsJumping) {
        // While airborne, AI targets player with high-altitude overhead strike!
        if (distanceToPlayer <= aiReach && s.aiWeaponState === 'ready' && s.playerHP > 0) {
          if (s.aiActiveWeapon === 'sword') {
            triggerEnemySwordSlash();
          } else {
            triggerEnemyHammerSwing();
          }
        }
      } else {
        // AI Sword Lunge Opportunity:
        const minLungeRange = playerDangerZone * 0.85;
        const maxLungeRange = Math.min(18.0, s.settings.swordLungeDistance ?? 14.5);
        if (s.aiActiveWeapon === 'sword' && s.aiWeaponState === 'ready' && distanceToPlayer >= minLungeRange && distanceToPlayer <= maxLungeRange && s.playerHP > 0 && !playerIsProtected) {
          // Lunge probability scales with difficulty/reflexes
          const lungeChance = 0.04 + (anticipationFactor * 0.08);
          if (Math.random() < lungeChance) {
            triggerEnemySwordLunge();
            return;
          }
        }

        // Decide to execute an offensive hammer jump!
        if (s.aiWeaponState === 'ready' && !s.aiHammerJumpPlanned && distanceToPlayer > (playerDangerZone + 1.5) && distanceToPlayer <= (playerDangerZone + 5.5) && Math.random() < 0.015 && (movementComplexity >= 40) && !playerIsProtected) {
          swapEnemyWeapon('hammer');
          s.aiHammerJumpPlanned = true;
          s.aiHammerJumpType = 'offensive';
          triggerEnemyHammerSwing();
        }

        // Decide to execute a defensive hammer jump when low on health and player gets too close!
        if (s.aiWeaponState === 'ready' && !s.aiHammerJumpPlanned && s.aiHP <= s.aiMaxHP * 0.55 && distanceToPlayer < (playerDangerZone + 0.8) && Math.random() < 0.038 && (movementComplexity >= 50)) {
          swapEnemyWeapon('hammer');
          s.aiHammerJumpPlanned = true;
          s.aiHammerJumpType = 'defensive';
          triggerEnemyHammerSwing();
        }

        if (s.aiState === 'APPROACHING') {
          // Walk towards player (using Forward multiplier)
          s.aiVel.copy(lookHeading).multiplyScalar(4.0 * (s.settings.speedForward / 100)); // full move speed
          s.aiPos.addScaledVector(s.aiVel, dt);

          // Transition to fencing dance posture once inside combat range
          if (distanceToPlayer <= (playerDangerZone + 3.2)) {
            s.aiState = 'SIDE_STEPPING';
            s.aiTimer = Math.random() * 0.7 + 0.3; // set dynamic duration
          }
        } 
        else if (s.aiState === 'SIDE_STEPPING') {
          // Dynamic Strafe Spacing Coupling (Back away if player has high attack reach)
          const dir = Math.sin(s.aiSwayTimer * 2.2) > 0 ? 1 : -1;
          s.aiVel.copy(sidewayHeading).multiplyScalar(3.2 * (s.settings.speedSide / 100) * dir);
          
          // Also slight step back or forward
          const spaceThreshold = playerDangerZone + 1.2;
          const approachBias = distanceToPlayer > spaceThreshold ? 0.35 : -0.45;
          const approachSpeed = approachBias * 1.5 * (approachBias > 0 ? (s.settings.speedForward / 100) : (s.settings.speedBackward / 100));
          s.aiVel.addScaledVector(lookHeading, approachSpeed);
          
          if (s.aiIsCrouching) {
            s.aiVel.multiplyScalar(0.45);
          }
          
          s.aiPos.addScaledVector(s.aiVel, dt);

          // Occasional sideways dodge/strafing dash
          if (s.aiDashCooldownTimer <= 0 && distanceToPlayer < (playerDangerZone + 2.0) && Math.random() < 0.015 && (movementComplexity >= 40)) {
            const sideDir = Math.random() > 0.5 ? 1 : -1;
            s.aiDashDir.copy(sidewayHeading).multiplyScalar(sideDir).normalize();
            s.aiDashRemaining = s.settings.dashDuration || 0.25;
            s.aiDashCooldownTimer = s.settings.dashCooldown || 2.0;
            sfx.playDash();
          }

          // AI reacts to player swinging!
          // If player is swinging-up or holding forward attack, AI attempts to QUICK BAIT/RETREAT or HAMMER JUMP DEFENSIVELY!
          if (s.pWeaponState === 'swing_up' && !playerIsProtected) {
            // Reaction check based on reactionLatency
            const reactChance = 0.45 + (anticipationFactor * 0.4);
            if (s.aiWeaponState === 'ready' && !s.aiIsJumping && !s.aiHammerJumpPlanned && Math.random() < reactChance * 0.8 && distanceToPlayer <= (playerDangerZone + 1.5) && (movementComplexity >= 50)) {
              s.aiState = 'DANCING_BACKWARD';
              swapEnemyWeapon('hammer');
              s.aiHammerJumpPlanned = true;
              s.aiHammerJumpType = 'defensive';
              triggerEnemyHammerSwing();
            } else {
              s.aiState = 'DANCING_BACKWARD';
              s.aiTimer = reactionLatency + 0.35; // retreat safety window

              // Active evade dash backward!
              if (s.aiDashCooldownTimer <= 0 && Math.random() < reactChance) {
                s.aiDashDir.copy(lookHeading).multiplyScalar(-1).normalize();
                s.aiDashRemaining = s.settings.dashDuration || 0.25;
                s.aiDashCooldownTimer = s.settings.dashCooldown || 2.0;
                sfx.playDash();
              }
            }
          }

          if (playerIsProtected) {
            // Forced retreating when player is invulnerable
            s.aiState = 'DANCING_BACKWARD';
            s.aiTimer = 0.5;
          }

          if (s.aiTimer <= 0) {
            // Decide to approach again or attack directly
            if (distanceToPlayer <= (aiReach + 0.5) && s.aiWeaponState === 'ready' && s.playerHP > 0 && !playerIsProtected) {
              s.aiState = 'CHARGE_ATTACK';
            } else {
              s.aiState = 'DANCING_FORWARD';
              s.aiTimer = Math.random() * 0.5 + 0.25;
            }
          }
        } 
        else if (s.aiState === 'DANCING_FORWARD') {
          // Move forward slightly inside player's danger range to bait them to miss-time swing (using Forward multiplier)
          s.aiVel.copy(lookHeading).multiplyScalar(5.0 * (s.settings.speedForward / 100)); // fast lurch
          s.aiPos.addScaledVector(s.aiVel, dt);

          // React to player whiff swing immediately!
          if (s.pWeaponState === 'swing_up' && !playerIsProtected) {
            if (s.aiWeaponState === 'ready' && !s.aiIsJumping && !s.aiHammerJumpPlanned && Math.random() < 0.6 && distanceToPlayer <= (playerDangerZone + 1.5)) {
              s.aiState = 'DANCING_BACKWARD';
              swapEnemyWeapon('hammer');
              s.aiHammerJumpPlanned = true;
              s.aiHammerJumpType = 'defensive';
              triggerEnemyHammerSwing();
            } else {
              s.aiState = 'DANCING_BACKWARD';
              s.aiTimer = 0.65;
              
              if (s.aiDashCooldownTimer <= 0 && Math.random() < 0.7) {
                s.aiDashDir.copy(lookHeading).multiplyScalar(-1).normalize();
                s.aiDashRemaining = s.settings.dashDuration || 0.25;
                s.aiDashCooldownTimer = s.settings.dashCooldown || 2.0;
                sfx.playDash();
              }
            }
          } else if (distanceToPlayer <= aiReach && s.aiWeaponState === 'ready' && s.playerHP > 0 && !playerIsProtected) {
            // Close enough! Launch our own overhand slam
            s.aiState = 'CHARGE_ATTACK';
          }

          if (playerIsProtected) {
            s.aiState = 'DANCING_BACKWARD';
            s.aiTimer = 0.5;
          }

          if (s.aiTimer <= 0) {
            s.aiState = 'SIDE_STEPPING';
            s.aiTimer = Math.random() * 0.7 + 0.3;
          }
        } 
        else if (s.aiState === 'DANCING_BACKWARD') {
          // Retreat quickly (using Backward multiplier)
          s.aiVel.copy(lookHeading).multiplyScalar(-6.2 * (s.settings.speedBackward / 100)); // high back-pedal speed
          s.aiPos.addScaledVector(s.aiVel, dt);

          // If player's weapon is recovering (the swing impact completed and player is vulnerable!), AI PUNISH RUSHES in
          if (s.pWeaponState === 'recovering' && distanceToPlayer <= (aiReach + 2.5) && !playerIsProtected) {
            s.aiState = 'CHARGE_ATTACK';
          }

          if (s.aiTimer <= 0) {
            s.aiState = 'SIDE_STEPPING';
            s.aiTimer = 0.4;
          }
        } 
        else if (s.aiState === 'CHARGE_ATTACK') {
          // Check for closing gap using a rapid forward-dash thrust
          if (s.aiDashCooldownTimer <= 0 && (movementComplexity >= 40) && !playerIsProtected) {
            s.aiDashDir.copy(lookHeading).normalize();
            s.aiDashRemaining = s.settings.dashDuration || 0.25;
            s.aiDashCooldownTimer = s.settings.dashCooldown || 2.0;
            sfx.playDash();
          }

          // Lunge in at high speed to deliver attack (using Forward multiplier)
          s.aiVel.copy(lookHeading).multiplyScalar(6.5 * (s.settings.speedForward / 100));
          s.aiPos.addScaledVector(s.aiVel, dt);

          if (distanceToPlayer <= aiReach && s.aiWeaponState === 'ready' && s.playerHP > 0 && !playerIsProtected) {
            s.aiState = 'COOLDOWN';
            s.aiTimer = s.aiActiveWeapon === 'sword' ? (s.settings.swordSlashReload ?? 0.6) : 1.1; // attack lock duration
            if (s.aiActiveWeapon === 'sword') {
              triggerEnemySwordSlash();
            } else {
              triggerEnemyHammerSwing();
            }
          } else if (distanceToPlayer > (aiReach + 2.0) || playerIsProtected) {
            // Player backed up too fast or is protected, retreat to strafe
            s.aiState = 'SIDE_STEPPING';
            s.aiTimer = 0.4;
          }
        } 
        else if (s.aiState === 'COOLDOWN') {
          // While AI hammer animation resolves, AI moves sluggishly backpedaling (using Backward multiplier)
          s.aiVel.copy(lookHeading).multiplyScalar(-1.5 * (s.settings.speedBackward / 100));
          if (s.aiIsCrouching) {
            s.aiVel.multiplyScalar(0.45);
          }
          s.aiPos.addScaledVector(s.aiVel, dt);

          if (s.aiTimer <= 0) {
            s.aiState = 'SIDE_STEPPING';
            s.aiTimer = 0.7;
          }
        }
      }
    }

    // Dynamic chaser-attacker AI logic for additional offline bots
    if (!isMultiplayer && s.otherPlayers) {
      s.otherPlayers.forEach((bot) => {
        if (bot.id.startsWith('bot_')) {
          const botMesh = threeRef.current.otherPlayerMeshes?.get(bot.id)?.group;
          if (!botMesh) return;

          if (bot.hp <= 0) {
            botMesh.visible = false;
            bot.respawnTimer = Math.max(0, bot.respawnTimer - dt);
            if (bot.respawnTimer <= 0) {
              // Respawn!
              bot.hp = bot.maxHp;
              
              const exclude: THREE.Vector3[] = [s.playerPos, s.aiPos];
              s.otherPlayers.forEach(o => {
                if (o.id !== bot.id && o.hp > 0 && o.respawnTimer <= 0) {
                  exclude.push(new THREE.Vector3(o.pos.x, o.pos.y, o.pos.z));
                }
              });
              const spawnPos = getOptimalSpawnPoint(exclude);
              bot.pos.copy(spawnPos);
              bot.vel.set(0, 0, 0);
              bot.yaw = Math.random() * Math.PI * 2;
              botMesh.visible = true;
              sfx.playRespawn();
            }
            return;
          }

          botMesh.visible = true;

          // Find closest target (either local player or other bots or main AI)
          let closestTargetPos = s.playerPos;
          let closestDist = bot.pos.distanceTo(s.playerPos);

          if (s.aiHP > 0 && s.aiState !== 'RESPAWNING') {
            const distToMainAI = bot.pos.distanceTo(s.aiPos);
            if (distToMainAI < closestDist) {
              closestDist = distToMainAI;
              closestTargetPos = s.aiPos;
            }
          }

          s.otherPlayers.forEach((other) => {
            if (other.id !== bot.id && other.hp > 0 && other.respawnTimer <= 0) {
              const distToOther = bot.pos.distanceTo(new THREE.Vector3(other.pos.x, other.pos.y, other.pos.z));
              if (distToOther < closestDist) {
                closestDist = distToOther;
                closestTargetPos = new THREE.Vector3(other.pos.x, other.pos.y, other.pos.z);
              }
            }
          });

          // Look at closest target
          const toTarget = closestTargetPos.clone().sub(bot.pos);
          toTarget.y = 0;
          bot.yaw = Math.atan2(toTarget.x, toTarget.z);
          botMesh.rotation.y = bot.yaw;

          // Move towards closest target
          const moveDir = toTarget.clone().normalize();
          const baseSpeed = bot.isCrouching ? 2.5 : 5.8;
          bot.vel.copy(moveDir).multiplyScalar(baseSpeed);
          bot.pos.addScaledVector(bot.vel, dt);
          botMesh.position.copy(bot.pos);

          // Boundaries
          const distFromCenter = Math.sqrt(bot.pos.x * bot.pos.x + bot.pos.z * bot.pos.z);
          if (distFromCenter > s.arenaRadius - 0.6) {
            const angle = Math.atan2(bot.pos.z, bot.pos.x);
            bot.pos.x = Math.cos(angle) * (s.arenaRadius - 0.6);
            bot.pos.z = Math.sin(angle) * (s.arenaRadius - 0.6);
            botMesh.position.copy(bot.pos);
          }

          // Attack logic
          if (closestDist <= 3.5 && Math.random() < 0.05) {
            // Swing hammer or sword!
            bot.activeWeapon = Math.random() > 0.5 ? 'hammer' : 'sword';
            bot.weaponState = 'swing_up';
            bot.weaponTimer = 0;
            const hammerMesh = threeRef.current.otherPlayerMeshes?.get(bot.id)?.hammer;
            const swordMesh = threeRef.current.otherPlayerMeshes?.get(bot.id)?.sword;
            
            if (hammerMesh && swordMesh) {
              hammerMesh.visible = bot.activeWeapon === 'hammer';
              swordMesh.visible = bot.activeWeapon === 'sword';
            }

            sfx.playSwing();
            const impactPos = bot.pos.clone().addScaledVector(moveDir, 1.8);
            spawnVoxelShockwaveParticles(impactPos, bot.activeWeapon === 'hammer' ? '#f97316' : '#ef4444');

            // Apply damage to player
            if (s.playerHP > 0 && s.playerInvulnerabilityTimer <= 0) {
              const playerBody = new THREE.Vector3(s.playerPos.x, s.playerPos.y + 0.825, s.playerPos.z);
              if (impactPos.distanceTo(playerBody) <= s.settings.attackRadius) {
                s.playerHP -= 1;
                if (s.playerHP <= 0) {
                  s.playerHP = 0;
                  s.playerRespawnTimer = 3.0;
                  s.scoreEnemy += 1;
                  s.playerDeaths += 1;
                  bot.kills += 1;
                  sfx.playDeath();
                  const newDeath = {
                    id: Math.random().toString(36).substring(2, 9),
                    attacker: bot.playerName,
                    victim: s.settings.playerName || 'Blue (You)'
                  };
                  s.lastDeaths = [newDeath, ...s.lastDeaths].slice(0, 3);
                }
              }
            }

            // Apply damage to main AI
            if (s.aiHP > 0 && s.aiState !== 'RESPAWNING' && s.aiInvulnerabilityTimer <= 0) {
              const aiBody = new THREE.Vector3(s.aiPos.x, s.aiPos.y + 0.825, s.aiPos.z);
              if (impactPos.distanceTo(aiBody) <= s.settings.attackRadius) {
                s.aiHP -= 1;
                if (s.aiHP <= 0) {
                  s.aiHP = 0;
                  s.aiState = 'RESPAWNING';
                  s.enemyRespawnTimer = 3.0;
                  bot.kills += 1;
                  sfx.playDeath();
                  const newDeath = {
                    id: Math.random().toString(36).substring(2, 9),
                    attacker: bot.playerName,
                    victim: 'Red (AI)'
                  };
                  s.lastDeaths = [newDeath, ...s.lastDeaths].slice(0, 3);
                }
              }
            }

            // Apply damage to other bots
            s.otherPlayers.forEach((other) => {
              if (other.id !== bot.id && other.hp > 0 && other.respawnTimer <= 0) {
                const otherBody = new THREE.Vector3(other.pos.x, other.pos.y + 0.825, other.pos.z);
                if (impactPos.distanceTo(otherBody) <= s.settings.attackRadius) {
                  other.hp -= 1;
                  if (other.hp <= 0) {
                    other.hp = 0;
                    other.respawnTimer = 3.0;
                    bot.kills += 1;
                    other.deaths += 1;
                    sfx.playDeath();
                    const newDeath = {
                      id: Math.random().toString(36).substring(2, 9),
                      attacker: bot.playerName,
                      victim: other.playerName
                    };
                    s.lastDeaths = [newDeath, ...s.lastDeaths].slice(0, 3);
                  }
                }
              }
            });

            pushStatsUpdate();
          }
        }
      });
    }

    // Keep enemy inside arena radius boundary

    const distFromCenter = Math.sqrt(s.aiPos.x * s.aiPos.x + s.aiPos.z * s.aiPos.z);
    if (distFromCenter > s.arenaRadius - 0.6) {
      const angle = Math.atan2(s.aiPos.z, s.aiPos.x);
      s.aiPos.x = Math.cos(angle) * (s.arenaRadius - 0.6);
      s.aiPos.z = Math.sin(angle) * (s.arenaRadius - 0.6);
    }
  };

  const animateSpartanModel = (
    mesh: THREE.Group | null,
    vel: THREE.Vector3,
    yaw: number,
    hp: number,
    weaponState: string,
    weaponTimer: number,
    dt: number
  ) => {
    if (!mesh) return;

    const lowerTorso = mesh.userData.lowerTorso as THREE.Group | undefined;
    const upperTorso = mesh.userData.upperTorso as THREE.Group | undefined;
    const leftLeg = mesh.userData.leftLeg as THREE.Group | undefined;
    const rightLeg = mesh.userData.rightLeg as THREE.Group | undefined;

    if (!lowerTorso || !upperTorso || !leftLeg || !rightLeg) return;

    // 1. Dynamic Feet & Leg Walk-Sprint Cycles
    const speed = Math.sqrt(vel.x * vel.x + vel.z * vel.z);

    if (hp > 0) {
      if (speed > 0.15) {
        if (mesh.userData.walkPhase === undefined) {
          mesh.userData.walkPhase = 0;
        }

        const frequency = 5.2 * (speed / 4.0);
        mesh.userData.walkPhase += dt * frequency * Math.PI * 2;

        const phase = mesh.userData.walkPhase;
        const maxSwing = 0.52; // max leg angle (~30 degrees)

        leftLeg.rotation.x = Math.sin(phase) * maxSwing;
        rightLeg.rotation.x = -Math.sin(phase) * maxSwing;
        leftLeg.rotation.z = Math.cos(phase) * 0.05;
        rightLeg.rotation.z = -Math.cos(phase) * 0.05;

        const bobAmount = Math.abs(Math.sin(phase)) * 0.04;
        lowerTorso.position.y = -bobAmount;
      } else {
        leftLeg.rotation.x = THREE.MathUtils.lerp(leftLeg.rotation.x, 0, dt * 10.0);
        leftLeg.rotation.z = THREE.MathUtils.lerp(leftLeg.rotation.z, 0, dt * 10.0);
        rightLeg.rotation.x = THREE.MathUtils.lerp(rightLeg.rotation.x, 0, dt * 10.0);
        rightLeg.rotation.z = THREE.MathUtils.lerp(rightLeg.rotation.z, 0, dt * 10.0);
        lowerTorso.position.y = THREE.MathUtils.lerp(lowerTorso.position.y, 0, dt * 10.0);
        mesh.userData.walkPhase = 0;
      }
    } else {
      leftLeg.rotation.x = 0;
      leftLeg.rotation.z = 0;
      rightLeg.rotation.x = 0;
      rightLeg.rotation.z = 0;
      lowerTorso.position.y = 0;
    }

    // 2. Cohesion Lower Torso Directional Rotation
    let targetLowerTorsoYaw = 0;
    if (speed > 0.15 && hp > 0) {
      const moveYaw = Math.atan2(vel.x, vel.z);
      let diff = moveYaw - yaw;
      diff = Math.atan2(Math.sin(diff), Math.cos(diff));

      const maxTwist = Math.PI / 3;
      if (Math.abs(diff) > maxTwist) {
        targetLowerTorsoYaw = Math.sign(diff) * maxTwist;
      } else {
        targetLowerTorsoYaw = diff;
      }
    }

    lowerTorso.rotation.y = THREE.MathUtils.lerp(
      lowerTorso.rotation.y,
      targetLowerTorsoYaw,
      dt * 9.0
    );

    // 3. Cohesion Upper Torso (Aiming & Shoulder weapon swing twists)
    let targetUpperTorsoYaw = 0;
    let targetUpperTorsoPitch = 0;
    let targetUpperTorsoRoll = 0;

    if (hp > 0) {
      if (weaponState === 'swing_up') {
        targetUpperTorsoYaw = -0.32;
        targetUpperTorsoPitch = -0.12;
      } else if (weaponState === 'swing_down') {
        targetUpperTorsoYaw = 0.42;
        targetUpperTorsoPitch = 0.22;
        targetUpperTorsoRoll = -0.08;
      } else if (weaponState === 'recovering') {
        const recoveryDuration = stateRef.current.settings.hammerReloadTime ?? 0.6;
        const recoveredPct = Math.min(1.0, weaponTimer / recoveryDuration);
        targetUpperTorsoYaw = THREE.MathUtils.lerp(0.42, 0, recoveredPct);
        targetUpperTorsoPitch = THREE.MathUtils.lerp(0.22, 0, recoveredPct);
      }
    }

    upperTorso.rotation.y = THREE.MathUtils.lerp(upperTorso.rotation.y, targetUpperTorsoYaw, dt * 10.0);
    upperTorso.rotation.x = THREE.MathUtils.lerp(upperTorso.rotation.x, targetUpperTorsoPitch, dt * 10.0);
    upperTorso.rotation.z = THREE.MathUtils.lerp(upperTorso.rotation.z, targetUpperTorsoRoll, dt * 10.0);
  };

  // PROCEDURAL SKELETAL JOINTS ANIMATIONS (Torso Twist, Walk Jog Leg/Foot Swing, Spine Bend)
  const updateCharacterSkeletalAnimations = (dt: number) => {
    const s = stateRef.current;

    if (s.isObserverMode) {
      // Animate Host Group (Blue Spartan)
      if (threeRef.current.hostGroup) {
        const hostData = getSpectateTargetData('host');
        animateSpartanModel(
          threeRef.current.hostGroup,
          multiplayerRole === 'observer' ? s.hostVel : s.playerVel,
          hostData.yaw,
          hostData.hp,
          (multiplayerRole === 'observer' && s.hostActiveWeapon === 'sword') ? 'ready' : s.pWeaponState,
          (multiplayerRole === 'observer') ? 0 : s.pWeaponTimer,
          dt
        );
      }

      // Animate Client Group (Red Spartan)
      if (threeRef.current.enemyGroup) {
        const clientData = getSpectateTargetData('client');
        animateSpartanModel(
          threeRef.current.enemyGroup,
          multiplayerRole === 'observer' ? s.clientVel : s.aiVel,
          clientData.yaw,
          clientData.hp,
          (multiplayerRole === 'observer' && s.clientActiveWeapon === 'sword') ? 'ready' : s.aiWeaponState,
          (multiplayerRole === 'observer') ? 0 : s.aiWeaponTimer,
          dt
        );
      }
    } else {
      // Standard Player vs Bot animation
      animateSpartanModel(
        threeRef.current.enemyGroup,
        s.aiVel,
        s.aiYaw,
        s.aiHP,
        s.aiWeaponState,
        s.aiWeaponTimer,
        dt
      );
    }

    // Animate custom other players / bots
    if (threeRef.current.otherPlayerMeshes && s.otherPlayers) {
      s.otherPlayers.forEach((player, clientId) => {
        const meshes = threeRef.current.otherPlayerMeshes.get(clientId);
        if (meshes && meshes.group) {
          let wState = player.weaponState || 'ready';
          let wTimer = player.weaponTimer || 0;

          if (wState === 'swing_up') {
            wTimer += dt;
            if (wTimer >= 0.15) {
              wState = 'swing_down';
              wTimer = 0;
            }
          } else if (wState === 'swing_down') {
            wTimer += dt;
            if (wTimer >= 0.15) {
              wState = 'recovering';
              wTimer = 0;
            }
          } else if (wState === 'recovering') {
            wTimer += dt;
            if (wTimer >= 0.3) {
              wState = 'ready';
              wTimer = 0;
            }
          }
          player.weaponState = wState;
          player.weaponTimer = wTimer;

          animateSpartanModel(
            meshes.group,
            new THREE.Vector3(player.vel.x, player.vel.y, player.vel.z),
            player.yaw,
            player.hp,
            wState,
            wTimer,
            dt
          );
        }
      });
    }
  };

  // TICK EXPLOSION VOXEL PARTICLES (Gravity, Physics translation and sizing decay)
  const updateExplosionParticles = (dt: number) => {
    const list = threeRef.current.damageExplosionParticles;
    const scene = threeRef.current.scene;

    if (!scene) return;

    for (let i = list.length - 1; i >= 0; i--) {
      const p = list[i];
      p.life += dt;

      if (p.life >= p.maxLife) {
        // Clean from screen
        scene.remove(p.mesh);
        p.mesh.geometry.dispose();
        list.splice(i, 1);
      } else {
        // Accelerate downwards (Gravity pulling voxel chunks back to arena)
        p.velocity.y -= 15 * dt;

        // Apply translations
        p.mesh.position.addScaledVector(p.velocity, dt);

        // Voxel shrink size decay
        const ratio = 1.0 - p.life / p.maxLife;
        p.mesh.scale.set(ratio, ratio, ratio);
      }
    }
  };

  // TICK GAME CLOCK TIMERS
  const updateMatchTimers = (dt: number) => {
    const s = stateRef.current;
    
    // Decrement remaining game timer count (08:42 to start)
    s.gameTime -= dt;
    if (s.gameTime < 0) s.gameTime = 0;

    // Decrement trace visuals linger
    if (s.lastStrikeTick > 0) s.lastStrikeTick -= dt * 1.5;
    if (s.lastAIStrikeTick > 0) s.lastAIStrikeTick -= dt * 1.5;

    // Decrement hammer jump windows
    if (s.pHammerJumpWindowTimer > 0) s.pHammerJumpWindowTimer = Math.max(0, s.pHammerJumpWindowTimer - dt);
    if (s.aiHammerJumpWindowTimer > 0) s.aiHammerJumpWindowTimer = Math.max(0, s.aiHammerJumpWindowTimer - dt);
  };

  // RENDER STEP
  const renderGame = () => {
    const s = stateRef.current;
    const camera = threeRef.current.camera;
    const renderer = threeRef.current.renderer;
    const scene = threeRef.current.scene;

    if (!camera || !renderer || !scene) return;

    // Update blinking transitions during invulnerability windows
    const blinkCycle = Math.floor(performance.now() / 120) % 2 === 0;

    const updateBlinking = (group: THREE.Group | null, active: boolean) => {
      if (!group) return;
      
      const isAlreadyBlinking = group.userData.isBlinking === true;
      const shouldShowBlink = active && blinkCycle;
      
      if (!active && !isAlreadyBlinking) {
        return;
      }
      
      group.userData.isBlinking = active;
      
      group.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          // Skip general helper meshes
          if (child === threeRef.current.debugPlayerSphere || child === threeRef.current.debugEnemySphere) {
            return;
          }
          
          if (!child.userData.originalMaterial) {
            child.userData.originalMaterial = child.material;
          }
          
          if (shouldShowBlink) {
            child.material = whiteBlinkMaterial;
          } else {
            child.material = child.userData.originalMaterial;
          }
        }
      });
    };

    updateBlinking(threeRef.current.enemyGroup, s.aiInvulnerabilityTimer > 0);
    updateBlinking(threeRef.current.playerHammer, s.playerInvulnerabilityTimer > 0);

    // Manage spectator model visibility to prevent camera head clipping
    if (s.isObserverMode) {
      const hostData = getSpectateTargetData('host');
      const clientData = getSpectateTargetData('client');
      
      if (threeRef.current.hostGroup) {
        threeRef.current.hostGroup.visible = (s.observerCamMode !== 'first' || s.observerTarget !== 'host') && (hostData.hp > 0);
        
        // Update host weapons visibility
        const hammer = threeRef.current.hostHammer;
        const sword = threeRef.current.hostSword;
        if (hammer && sword) {
          hammer.visible = hostData.activeWeapon === 'hammer';
          sword.visible = hostData.activeWeapon === 'sword';
        }
      }
      
      if (threeRef.current.enemyGroup) {
        threeRef.current.enemyGroup.visible = (s.observerCamMode !== 'first' || s.observerTarget !== 'client') && (clientData.hp > 0);
        
        // Update client weapons visibility
        const hammer = threeRef.current.enemyHammer;
        const sword = threeRef.current.enemySword;
        if (hammer && sword) {
          hammer.visible = clientData.activeWeapon === 'hammer';
          sword.visible = clientData.activeWeapon === 'sword';
        }
      }
    } else {
      if (threeRef.current.enemyGroup) {
        threeRef.current.enemyGroup.visible = s.aiHP > 0 && s.aiState !== 'RESPAWNING';
      }
    }

    // Apply Camera transforms based on Observer Mode and Camera Mode settings
    if (s.isObserverMode) {
      if (s.observerCamMode === 'free') {
        // Free Camera spectator mode
        const lookTarget = new THREE.Vector3(0, 0, -1);
        lookTarget.applyAxisAngle(new THREE.Vector3(1, 0, 0), s.pitch);
        lookTarget.applyAxisAngle(new THREE.Vector3(0, 1, 0), s.yaw);
        
        camera.position.copy(s.playerPos);
        const centerLookAt = camera.position.clone().add(lookTarget);
        camera.lookAt(centerLookAt);
      } else if (s.observerCamMode === 'third') {
        // Third Person orbital spectator mode
        const targetData = getSpectateTargetData(s.observerTarget);
        const targetEyePos = targetData.pos.clone();
        targetEyePos.y += 1.65 - (targetData.isCrouching ? 0.72 : 0); // Eye height level

        // Compute orbit offset using s.yaw and s.pitch as orbit angles
        const offset = new THREE.Vector3(0, 0, s.observerOrbitDistance);
        offset.applyAxisAngle(new THREE.Vector3(1, 0, 0), s.pitch);
        offset.applyAxisAngle(new THREE.Vector3(0, 1, 0), s.yaw);

        const cameraPos = targetEyePos.clone().add(offset);
        camera.position.copy(cameraPos);
        camera.lookAt(targetEyePos);
      } else if (s.observerCamMode === 'first') {
        // First Person spectator mode in sync with player being spectated
        const targetData = getSpectateTargetData(s.observerTarget);
        const currentCameraY = 1.65 - (targetData.isCrouching ? 0.72 : 0) + targetData.pos.y;
        camera.position.set(targetData.pos.x, currentCameraY, targetData.pos.z);

        const lookTarget = new THREE.Vector3(0, 0, -1);
        lookTarget.applyAxisAngle(new THREE.Vector3(1, 0, 0), targetData.pitch);
        lookTarget.applyAxisAngle(new THREE.Vector3(0, 1, 0), targetData.yaw);

        const centerLookAt = camera.position.clone().add(lookTarget);
        camera.lookAt(centerLookAt);
      }
    } else {
      // Standard local Player First Person view
      const lookTarget = new THREE.Vector3(0, 0, -1);
      lookTarget.applyAxisAngle(new THREE.Vector3(1, 0, 0), s.pitch);
      lookTarget.applyAxisAngle(new THREE.Vector3(0, 1, 0), s.yaw);
      
      const currentCameraY = 1.65 - s.crouchAmount + s.playerPos.y;
      camera.position.set(s.playerPos.x, currentCameraY, s.playerPos.z);
      
      const centerLookAt = camera.position.clone().add(lookTarget);
      camera.lookAt(centerLookAt);
    }

    // Sync Debug Mode Traces (wireframe red impact zone circles)
    const playerSphere = threeRef.current.debugPlayerSphere;
    if (playerSphere) {
      if (s.debugMode && s.lastStrikePos && s.lastStrikeTick > 0) {
        playerSphere.visible = true;
        playerSphere.position.copy(s.lastStrikePos);
        
        // Pulse ring scale & opacity fading
        const fade = Math.max(0, s.lastStrikeTick);
        const mat = playerSphere.material as THREE.MeshBasicMaterial;
        mat.opacity = fade * 0.45;
        
        // Scale the sphere mesh based on our custom attackRadius versus default radius
        const scaleFactor = s.settings.attackRadius / 4.5;
        playerSphere.scale.setScalar(scaleFactor);
      } else {
        playerSphere.visible = false;
      }
    }

    const enemySphere = threeRef.current.debugEnemySphere;
    if (enemySphere) {
      if (s.debugMode && s.lastAIStrikePos && s.lastAIStrikeTick > 0) {
        enemySphere.visible = true;
        enemySphere.position.copy(s.lastAIStrikePos);
        const fade = Math.max(0, s.lastAIStrikeTick);
        const mat = enemySphere.material as THREE.MeshBasicMaterial;
        mat.opacity = fade * 0.45;
        
        const scaleFactor = s.settings.attackRadius / 4.5;
        enemySphere.scale.setScalar(scaleFactor);
      } else {
        enemySphere.visible = false;
      }
    }

    // Sync Hammer Jump Zone Visualizer
    const jumpZoneMesh = threeRef.current.playerJumpZoneMesh;
    if (jumpZoneMesh) {
      if (s.settings.visualizeJumpZone && s.playerHP > 0) {
        jumpZoneMesh.visible = true;
        // Position flatly on the ground floor beneath player
        jumpZoneMesh.position.set(s.playerPos.x, 0.02, s.playerPos.z);
        // Scale matched perfectly to the trigger radius slider
        const triggerRad = s.settings.hammerJumpTriggerRadius ?? 3.5;
        jumpZoneMesh.scale.set(triggerRad, 1, triggerRad);

        const mat = jumpZoneMesh.material as THREE.MeshBasicMaterial;
        if (s.pHammerJumpWindowTimer > 0) {
          // Inside jump window! Fast bright flashing glow alert
          const flash = 0.6 + Math.sin(performance.now() * 0.016) * 0.25;
          mat.opacity = flash;
          mat.color.setHex(0xfca5a5); // glow warm pinkish/gold for alert highlight
        } else {
          // Neutral state: soft warm aesthetic glow
          const pulse = 0.22 + Math.sin(performance.now() * 0.003) * 0.07;
          mat.opacity = pulse;
          mat.color.setHex(0xf59e0b); // warm amber
        }
      } else {
        jumpZoneMesh.visible = false;
      }
    }

    renderer.render(scene, camera);
  };

  // PROPAGATE STATS UPDATE BACK TO CENTRAL HUD CORES
  const pushStatsUpdate = () => {
    const s = stateRef.current;

    // Translate stance string for HUD feedback
    let computedStance: Stance = 'STANDING';
    if (s.isJumping) computedStance = 'JUMPING';
    else if (s.isCrouching) computedStance = 'CROUCHING';

    onStatsUpdateRef.current({
      playerHP: s.playerHP,
      playerMaxHP: s.playerMaxHP,
      enemyHP: s.aiHP,
      enemyMaxHP: s.aiMaxHP,
      scorePlayer: s.scorePlayer,
      scoreEnemy: s.scoreEnemy,
      otherPlayers: s.otherPlayers ? Array.from(s.otherPlayers.values()).map(p => ({
        id: p.id,
        playerName: p.playerName,
        pos: { x: p.pos.x, y: p.pos.y, z: p.pos.z },
        vel: { x: p.vel.x, y: p.vel.y, z: p.vel.z },
        yaw: p.yaw,
        pitch: p.pitch,
        hp: p.hp,
        maxHp: p.maxHp,
        isCrouching: p.isCrouching,
        activeWeapon: p.activeWeapon,
        respawnTimer: p.respawnTimer,
        hue: p.hue,
        score: p.score ?? 0,
        kills: p.kills ?? 0,
        deaths: p.deaths ?? 0,
        isObserver: p.isObserver
      })) : undefined,
      gameTime: s.gameTime,
      debugMode: s.debugMode,
      debugDamageRadius: s.settings.attackRadius, // Show actual damage radius
      weaponReady: s.activeWeapon === 'hammer' ? s.pWeaponReady : s.pSwordReady,
      weaponCooldown: s.activeWeapon === 'hammer' ? (s.pWeaponCooldown ?? 1.0) : s.pSwordCooldown,
      activeWeapon: s.activeWeapon,
      crosshairColor: s.crosshairColor,
      lastStrikePos: s.lastStrikePos ? [s.lastStrikePos.x, s.lastStrikePos.y, s.lastStrikePos.z] : null,
      lastStrikeTick: s.lastStrikeTick,
      isCrouching: s.isCrouching,
      isJumping: s.isJumping,
      playerRespawnTimer: s.playerHP <= 0 ? s.playerRespawnTimer : 0,
      enemyRespawnTimer: s.aiHP <= 0 ? s.enemyRespawnTimer : 0,
      playerDashCooldownTimer: s.playerDashCooldownTimer,
      playerDashReady: s.playerDashCooldownTimer <= 0 && s.playerDashRemaining <= 0,
      settings: s.settings, // Propagate the current admin settings to HUD
      lastDeaths: s.lastDeaths,
      playerX: s.playerPos.x,
      playerZ: s.playerPos.z,
      playerYaw: s.yaw,
      enemyX: s.aiPos.x,
      enemyZ: s.aiPos.z,
      enemyYaw: s.aiYaw,
      enemyIsCrouching: s.aiIsCrouching,
      playerIsCrouchMoving: s.isCrouching && s.playerVel.length() > 0.15,
      enemyIsCrouchMoving: s.aiIsCrouching && s.aiVel.length() > 0.15,
      isMultiplayer: isMultiplayer,
      multiplayerRole: multiplayerRole,
      opponentConnected: isMultiplayer && multiplayerSocket?.readyState === WebSocket.OPEN,
      showScoreboard: s.showScoreboard,
      isObserverMode: s.isObserverMode,
      observerCamMode: s.observerCamMode,
      observerTargetName: getSpectateTargetData(s.observerTarget).name,
      observerTargetRole: s.observerTarget,
      playerKills: s.playerKills,
      playerDeaths: s.playerDeaths,
      enemyKills: s.enemyKills,
      enemyDeaths: s.enemyDeaths,
      opponentPlayerName: opponentNameRef.current || undefined,
    });
  };

  const updateFloatingNameplate = () => {
    const s = stateRef.current;
    const camera = threeRef.current.camera;
    const container = containerRef.current;
    const nameplate = nameplateRef.current;

    if (!s || !camera || !container || !nameplate) return;

    let showNameplate = false;
    const nameplateScreenPos = { x: 0, y: 0 };

    if (s.playerHP > 0 && s.aiHP > 0 && s.aiState !== 'RESPAWNING') {
      const eyePos = new THREE.Vector3(
        s.playerPos.x,
        1.65 - s.crouchAmount + s.playerPos.y,
        s.playerPos.z
      );
      const enemyCenter = new THREE.Vector3(s.aiPos.x, s.aiPos.y + 0.825, s.aiPos.z);
      const toEnemy = enemyCenter.clone().sub(eyePos);
      const dist = toEnemy.length();
      
      const appDist = s.settings.nameVisibilityDistance !== undefined ? s.settings.nameVisibilityDistance : 15.0;
      if (dist <= appDist) {
        const toEnemyDir = toEnemy.clone().normalize();
        
        const cameraLookDir = new THREE.Vector3(0, 0, -1)
          .applyAxisAngle(new THREE.Vector3(1, 0, 0), s.pitch)
          .applyAxisAngle(new THREE.Vector3(0, 1, 0), s.yaw)
          .normalize();
          
        const dot = cameraLookDir.dot(toEnemyDir);
        const angle = Math.acos(Math.max(-1.0, Math.min(1.0, dot)));
        
        // Holding crosshair over them
        if (angle < 0.12) {
          showNameplate = true;
          
          // Calculate projected 2D coordinates
          const headPos = new THREE.Vector3(s.aiPos.x, s.aiPos.y + 1.75, s.aiPos.z);
          headPos.project(camera);
          
          // Check if in front of camera
          if (headPos.z <= 1) {
            const widthHalf = container.clientWidth / 2;
            const heightHalf = container.clientHeight / 2;
            nameplateScreenPos.x = (headPos.x * widthHalf) + widthHalf;
            nameplateScreenPos.y = -(headPos.y * heightHalf) + heightHalf;
          } else {
            showNameplate = false;
          }
        }
      }
    }

    if (showNameplate) {
      nameplate.style.display = 'block';
      nameplate.style.left = `${nameplateScreenPos.x}px`;
      nameplate.style.top = `${nameplateScreenPos.y}px`;
      nameplate.style.color = s.settings.nameVisibilityColor || '#00ffff';
      nameplate.style.opacity = (s.settings.nameVisibilityOpacity !== undefined ? s.settings.nameVisibilityOpacity : 0.8).toString();
      nameplate.style.fontSize = `${s.settings.nameVisibilityFontSize || 16}px`;
      nameplate.textContent = isMultiplayer ? (opponentNameRef.current || opponentClientId || 'Opponent') : 'AI Bot';
    } else {
      nameplate.style.display = 'none';
    }
  };

  // Direct high-performance HUD Radar Syncing method
  const updateRadarDOM = () => {
    const s = stateRef.current;
    if (!s) return;

    const isPlayerAlive = s.playerHP > 0;
    
    // 1. Compass Rotation HUD Coordinates mapping
    const nElem = document.getElementById('radar-compass-n');
    const eElem = document.getElementById('radar-compass-e');
    const sElem = document.getElementById('radar-compass-s');
    const wElem = document.getElementById('radar-compass-w');

    if (nElem || eElem || sElem || wElem) {
      const cosYaw = Math.cos(s.yaw);
      const sinYaw = Math.sin(s.yaw);
      const r = 58; // compass offset radius from center (72px)
      const center = 72; // half of 144px diameter

      if (nElem) {
        nElem.style.left = `${center + r * sinYaw - 3.5}px`;
        nElem.style.top = `${center - r * cosYaw - 5}px`;
      }
      if (eElem) {
        eElem.style.left = `${center + r * cosYaw - 3.5}px`;
        eElem.style.top = `${center + r * sinYaw - 5}px`;
      }
      if (sElem) {
        sElem.style.left = `${center - r * sinYaw - 3.5}px`;
        sElem.style.top = `${center + r * cosYaw - 5}px`;
      }
      if (wElem) {
        wElem.style.left = `${center - r * cosYaw - 3.5}px`;
        wElem.style.top = `${center - r * sinYaw - 5}px`;
      }
    }

    // 2. Math calculations & positioning of the enemy dot on the client's radar HUD
    const dotContainer = document.getElementById('radar-enemy-dot-container');
    if (dotContainer) {
      if (!isPlayerAlive || s.aiHP <= 0) {
        dotContainer.style.display = 'none';
      } else {
        const maxRange = 25; 
        const radarRadius = 72; 
        const scale = radarRadius / maxRange;

        const dx = s.aiPos.x - s.playerPos.x;
        const dz = s.aiPos.z - s.playerPos.z;
        const dist = Math.sqrt(dx * dx + dz * dz);

        const forward_x = -Math.sin(s.yaw);
        const forward_z = -Math.cos(s.yaw);
        const right_x = Math.cos(s.yaw);
        const right_z = -Math.sin(s.yaw);

        const local_y = dx * forward_x + dz * forward_z;
        const local_x = dx * right_x + dz * right_z;

        const ex = local_x * scale;
        const ey = -local_y * scale;

        const eLeft = radarRadius + ex - 6;
        const eTop = radarRadius + ey - 6;

        const aiVelLength = s.aiVel ? s.aiVel.length() : 0;
        const enemyIsCrouchMoving = s.aiIsCrouching && aiVelLength > 0.15;
        const showEnemy = !enemyIsCrouchMoving && dist <= maxRange;

        if (showEnemy) {
          dotContainer.style.display = 'flex';
          dotContainer.style.left = `${eLeft}px`;
          dotContainer.style.top = `${eTop}px`;
        } else {
          dotContainer.style.display = 'none';
        }
      }
    }

    // 3. Update center player arrow visibility and crouch-cloaking styles
    const playerArrow = document.getElementById('radar-player-arrow');
    if (playerArrow) {
      if (!isPlayerAlive) {
        playerArrow.style.display = 'none';
      } else {
        playerArrow.style.display = 'block';
        const playerVelLength = s.playerVel ? s.playerVel.length() : 0;
        const playerIsCrouchMoving = s.isCrouching && playerVelLength > 0.15;

        if (playerIsCrouchMoving) {
          playerArrow.setAttribute('class', 'absolute w-3.5 h-3.5 text-white/20 z-20');
          playerArrow.setAttribute('fill', 'none');
          playerArrow.setAttribute('stroke', 'currentColor');
          playerArrow.setAttribute('stroke-width', '2');
        } else {
          playerArrow.setAttribute('class', 'absolute w-3.5 h-3.5 text-[#22d3ee] drop-shadow-[0_0_4px_rgba(34,211,238,0.7)] z-20');
          playerArrow.setAttribute('fill', 'currentColor');
          playerArrow.removeAttribute('stroke');
          playerArrow.removeAttribute('stroke-width');
        }
      }
    }

    // 4. Update status indicator badges and text node names
    const badgeText = document.getElementById('radar-status-text');
    const badgeContainer = document.getElementById('radar-status-badge');
    if (badgeText && badgeContainer) {
      const playerVelLength = s.playerVel ? s.playerVel.length() : 0;
      const playerIsCrouchMoving = s.isCrouching && playerVelLength > 0.15;

      if (!isPlayerAlive) {
        badgeText.textContent = 'OFFLINE';
        badgeContainer.className = 'text-[8px] font-mono font-bold px-1.5 py-0.5 rounded border bg-slate-900/40 text-slate-500 border-slate-500/20';
      } else if (playerIsCrouchMoving) {
        badgeText.textContent = 'SIGNAL STEALTH';
        badgeContainer.className = 'text-[8px] font-mono font-bold px-1.5 py-0.5 rounded border bg-amber-950/40 text-amber-400 border-amber-500/20';
      } else {
        badgeText.textContent = 'ACTIVE';
        badgeContainer.className = 'text-[8px] font-mono font-bold px-1.5 py-0.5 rounded border bg-cyan-950/40 text-cyan-400 border-cyan-500/20';
      }
    }
  };

  return (
    <div className="absolute inset-0 z-0 w-full h-full" style={{ outline: 'none' }}>
      {/* Floating Nameplate Overlay (New!) */}
      <div 
        ref={nameplateRef}
        style={{
          position: 'absolute',
          display: 'none',
          transform: 'translate(-50%, -100%)',
          fontWeight: 'black',
          fontFamily: 'monospace',
          pointerEvents: 'none',
          textShadow: '0 0 4px rgba(0,0,0,0.85), 0 0 10px rgba(0,0,0,0.5)',
          zIndex: 10,
          whiteSpace: 'nowrap',
          transition: 'color 0.15s, font-size 0.15s, opacity 0.15s'
        }}
      />

      {/* 3D Render Canvas container */}
      <div 
        ref={containerRef} 
        id="canvas-viewport" 
        className="w-full h-full cursor-crosshair selection:bg-transparent"
        style={{ outline: 'none' }}
      />

      {/* Dynamic Instruction Overlay when Pointer Lock is not active */}
      {showPointerLockAlert && isPlaying && !isPaused && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/60 backdrop-blur-xs select-none pointer-events-none transition-all duration-300">
          <div className="bg-slate-950/80 backdrop-blur-md border border-white/10 px-8 py-5 rounded-2xl text-center max-w-sm shadow-2xl">
            <h4 className="text-xl font-display font-black tracking-widest text-blue-400 uppercase mb-2">
              CLICK TO LOCK CURSOR
            </h4>
            <p className="text-sm font-sans text-white/70 leading-relaxed mb-4 leading-relaxed">
              Ensure you lock your pointer to look around in first-person like standard Grifball!
            </p>
            <div className="inline-flex gap-2 text-[10px] font-mono text-white/50 uppercase border border-white/10 px-3 py-1 rounded bg-white/5">
              <span>LMB to Attack</span>
              <span>•</span>
              <span>Mouse Look</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
