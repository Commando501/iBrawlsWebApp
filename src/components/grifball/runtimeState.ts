import * as THREE from 'three';
import { createAIMatchContext, type AIMatchContext } from '../../game/aiMatchContext';
import { createEmptyTeamScores, localPlayerTeamFromRole, type TeamId, type TeamScoresState } from '../../game/teamScoring';
import { createInitialGrifballMatchState, type GrifballMatchState } from '../../game/grifballMatch';
import { type Combatant, type DeathEvent, type MedalInfo, type ReplayHeatmapEvent, type UniversalSettings, type WeaponState } from '../../types';
import { getInwardSpawnYaw } from './combatGeometry';

export interface GrifballRuntimeState {
  playerPos: THREE.Vector3;
  playerVel: THREE.Vector3;
  yaw: number;
  pitch: number;
  crouchAmount: number;
  isCrouching: boolean;
  isJumping: boolean;

  playerDashRemaining: number;
  playerDashDir: THREE.Vector3;
  playerDashCooldownTimer: number;

  playerSlideActive: boolean;
  playerSlideDistanceTraveled: number;
  playerSlideCooldownTimer: number;
  playerSlideLastPos: THREE.Vector3;

  pWeaponState: WeaponState;
  pWeaponTimer: number;
  pWeaponCooldown?: number;
  pWeaponReady: boolean;

  activeWeapon: 'hammer' | 'sword' | 'pistol' | 'ball';
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

  pPistolState: 'ready' | 'firing' | 'recovering';
  pPistolTimer: number;
  pPistolReady: boolean;
  pPistolCooldown: number;
  lastPlayerSwordAttackTime: number;
  lastPlayerHammerAttackTime: number;
  swapCooldownTimer: number;
  swapCooldownDuration: number;
  swapLockoutTimer: number;

  playerHP: number;
  playerMaxHP: number;
  teamScores: TeamScoresState;
  localPlayerTeam: TeamId;
  /** Grifball round/ball/match state (only ticked when settings.gameMode === 'grifball'). */
  grifball: GrifballMatchState;
  /** Local player's Pass charge level (0–1) while holding alt-attack with the ball. */
  grifballPassCharge: number;
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
  playerSpawnTime: number;
  playerLastKillTime: number;
  playerMultikillCount: number;
  playerSpreeCount: number;
  activeMedalPopup: { medal: MedalInfo; key: number } | null;
  replayHeatmapRecordingActive: boolean;
  replayHeatmapElapsedTime: number;
  pendingReplayHeatmapEvents: ReplayHeatmapEvent[];

  gameTime: number;

  debugMode: boolean;
  lastStrikePos: THREE.Vector3 | null;
  lastStrikeTick: number;
  lastAIStrikePos: THREE.Vector3 | null;
  lastAIStrikeTick: number;

  pHammerJumpWindowTimer: number;
  pHammerJumpsInAir: number;

  arenaRadius: number;
  settings: UniversalSettings;
  lastDeaths: DeathEvent[];

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
  otherPlayers: Map<string, Combatant>;
  isMultiplayer: boolean;
  multiplayerRole: 'host' | 'client' | 'observer' | null | undefined;
  multiplayerSpawnSlot: number;
  aiMatchContext: AIMatchContext;
  hostClientId?: string;
  clientClientId?: string;

  // Legacy main-AI fields retained for compatibility with older inline call sites.
  aiHP?: number;
  aiInvulnerabilityTimer?: number;
}

interface CreateGrifballRuntimeStateOptions {
  debugMode: boolean;
  adminSettings: UniversalSettings;
  multiplayerRole: 'host' | 'client' | null | undefined;
  isMultiplayer: boolean;
  multiplayerSpawnSlot?: number;
}

export function createInitialGrifballRuntimeState({
  debugMode,
  adminSettings,
  multiplayerRole,
  isMultiplayer,
  multiplayerSpawnSlot = 0,
}: CreateGrifballRuntimeStateOptions): GrifballRuntimeState {
  return {
    playerPos: new THREE.Vector3(0, 0, 12),
    playerVel: new THREE.Vector3(0, 0, 0),
    yaw: getInwardSpawnYaw(new THREE.Vector3(0, 0, 12)),
    pitch: 0,
    crouchAmount: 0,
    isCrouching: false,
    isJumping: false,
    otherPlayers: new Map<string, Combatant>(),

    playerDashRemaining: 0,
    playerDashDir: new THREE.Vector3(0, 0, 0),
    playerDashCooldownTimer: 0,

    playerSlideActive: false,
    playerSlideDistanceTraveled: 0,
    playerSlideCooldownTimer: 0,
    playerSlideLastPos: new THREE.Vector3(0, 0, 0),

    pWeaponState: 'ready',
    pWeaponTimer: 0,
    pWeaponReady: true,

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

    pPistolState: 'ready',
    pPistolTimer: 0,
    pPistolReady: true,
    pPistolCooldown: 1.0,
    lastPlayerSwordAttackTime: 0,
    lastPlayerHammerAttackTime: 0,
    swapCooldownTimer: 0,
    swapCooldownDuration: 0,
    swapLockoutTimer: 0,

    playerHP: 1,
    playerMaxHP: 1,
    teamScores: createEmptyTeamScores(),
    localPlayerTeam: localPlayerTeamFromRole(multiplayerRole),
    grifball: createInitialGrifballMatchState(adminSettings),
    grifballPassCharge: 0,
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
    playerSpawnTime: Date.now(),
    playerLastKillTime: 0,
    playerMultikillCount: 0,
    playerSpreeCount: 0,
    activeMedalPopup: null,
    replayHeatmapRecordingActive: false,
    replayHeatmapElapsedTime: 0,
    pendingReplayHeatmapEvents: [],

    gameTime: adminSettings.matchTimerSeconds ?? 522,

    debugMode,
    lastStrikePos: null,
    lastStrikeTick: 0,
    lastAIStrikePos: null,
    lastAIStrikeTick: 0,

    pHammerJumpWindowTimer: 0,
    pHammerJumpsInAir: 0,

    arenaRadius: 20,
    settings: adminSettings,
    lastDeaths: [],

    isObserverMode: false,
    observerCamMode: 'free',
    observerTarget: 'host',
    observerOrbitDistance: 5.0,
    hostPos: new THREE.Vector3(0, 0, 12),
    hostVel: new THREE.Vector3(0, 0, 0),
    hostYaw: getInwardSpawnYaw(new THREE.Vector3(0, 0, 12)),
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
    clientYaw: getInwardSpawnYaw(new THREE.Vector3(0, 0, -12)),
    clientPitch: 0,
    clientHP: 1,
    clientMaxHP: 1,
    clientIsCrouching: false,
    clientActiveWeapon: 'hammer',
    clientRespawnTimer: 0,
    clientPlayerName: 'Red (Guest)',
    clientHue: 200,
    isMultiplayer,
    multiplayerRole,
    multiplayerSpawnSlot,
    aiMatchContext: createAIMatchContext(),
    hostClientId: undefined,
    clientClientId: undefined,
  };
}
