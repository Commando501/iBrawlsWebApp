/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type * as THREE from 'three';

export interface UniversalSettings {
  maxHP: number;        // Health (whole number adjustment, e.g. 1 to 10)
  speedForward: number; // Forward movement speed percentage adjustment (e.g. 20% to 300%)
  speedSide: number;    // Side movement speed percentage adjustment (e.g. 20% to 300%)
  speedBackward: number;// Backward movement speed percentage adjustment (e.g. 20% to 300%)
  attackRange: number;  // Attack range distance (controls forward offset of sphere, e.g. 1.0m to 10.0m)
  attackRadius: number; // Attack sphere size (controls size of damage sphere, e.g. 1.0m to 10.0m)
  dashDistance: number; // Dash distance in meters (e.g. 2.0m to 15.0m)
  dashDuration: number; // Dash duration / speed (e.g. 0.1s to 1.0s)
  dashCooldown: number; // Dash cooldown in seconds (e.g. 0.5s to 10.0s)
  respawnInvulnerabilityDuration: number; // Invulnerability window in seconds (e.g. 0.5s to 5.0s)
  hammerReloadTime: number;               // Recovery/reload duration for Gravity Hammer in seconds (e.g. 0.1s to 3.0s)
  hammerMeleeSpeed: number;               // Speed of the hammer melee side-swipe animation in seconds (e.g. 0.05s to 1.0s)
  hammerMeleeReload: number;              // Recovery reload duration for Hammer Melee in seconds (e.g. 0.1s to 3.0s)
  hammerSplashVfx: 'current' | 'neonBlueFlash'; // Gravity Hammer impact visual style
  swordLungeVfx: 'current' | 'speedLineTrail'; // Energy Sword lunge visual style
  swordLungeDistance: number;             // Lunge range distance mapping reticule lock on (e.g. 1.0m to 25.0m)
  swordLungeSpeed: number;                // Lunge glide movement speed (e.g. 5.0m/s to 50.0m/s)
  swordSlashSpeed: number;                // Slash duration sweep phase time (e.g. 0.05s to 1.0s)
  swordSlashReload: number;               // Recovery reload duration for Sword Slash (e.g. 0.1s to 3.0s)
  swordLungeReload: number;               // Recovery reload duration for Sword Lunge (e.g. 0.1s to 5.0s)
  hammerJumpPower: number;                // The additional height / upward velocity added when hammer jumping (e.g. 2.0 to 15.0)
  hammerJumpTriggerRadius: number;        // The radius underneath the model for triggering a hammer jump (e.g. 1.0m to 10.0m)
  hammerJumpWindow: number;               // Time window to jump after swinging in seconds (e.g. 0.1s to 2.0s)
  hammerJumpInputGate: number;            // Input gate timing window in seconds (e.g. 0.0s to 1.0s, 0.0 = disabled/automatic)
  hammerJumpAirLimit: number;             // Maximum consecutive hammer jumps in the air before landing (0 to 10)
  visualizeJumpZone: boolean;             // Whether to draw the zone beneath the player to visualize it
  directLightIntensity: number;           // Intensity of the direct light (e.g. 0.1 to 4.0)
  ambientLightIntensity: number;          // Intensity of the ambient light (e.g. 0.1 to 3.5)
  skyboxBrightness: number;               // Brightness of the skybox / background (e.g. 0 to 100)
  skyboxHue: number;                      // Color hue of the skybox / background (e.g. 0 to 360)
  showSkybox: boolean;                    // Whether the skybox is visible or disabled
  enableSwordTrade: boolean;              // Toggle for Sword vs Sword trades
  enableHammerSwordTrade: boolean;         // Toggle for Hammer vs Sword trades
  swordTradeWindow: number;               // Timing window for Sword vs Sword in ms (e.g. 50ms to 800ms)
  hammerSwordTradeWindow: number;         // Timing window for Hammer vs Sword in ms (e.g. 50ms to 800ms)
  playerHue?: number;                     // Color hue of the player's character / armor (0 to 360)
  nameVisibilityDistance?: number;        // How close the player needs to be to other player for name to appear
  nameVisibilityColor?: string;           // Color of the floating name
  nameVisibilityOpacity?: number;         // Opacity of the floating name
  nameVisibilityFontSize?: number;        // Font size of the floating name
  playerName?: string;                    // Persistent customized player name / handle
  aiDifficulty?: 'easy' | 'normal' | 'hard' | 'nightmare' | 'custom' | string;
  aiReactionLatency?: number;             // Reaction latency in seconds (0.0 to 1.5)
  aiAnticipationFactor?: number;          // How aggressively it predicts player action (0.0 to 1.0)
  aiMovementComplexity?: number;          // 0 to 100%
  aiWeaponSwapIQ?: number;                // 0 to 100%
  aiPlaystyle?: number;                   // Custom AI playstyle slider: 0 = Passive, 50 = Defensive, 100 = Aggressive
  aiWeaponPrioritization?: number;        // Weapon prioritization weight: 0 = 100% Hammer, 100 = 100% Sword, 50 = Balanced
  /** Custom override for derived spatial IQ (0–100); unset uses deriveAIParams(). */
  aiSpatialIQ?: number;
  /** Custom override for derived feint chance (0–100); unset uses deriveAIParams(). */
  aiFeintChance?: number;
  /** Custom override for derived pressure aggression (0–100); unset uses deriveAIParams(). */
  aiPressureAggression?: number;
  /** Custom override for combat spacing multiplier (e.g. 0.7–1.4×); unset uses archetype/neutral flag. */
  aiSpacingBand?: number;
  /** Custom override: when true the AI never chains post-hit PRESSURING; unset uses archetype/neutral flag. */
  aiSkipPressure?: boolean;
  /** Combat personality archetype overlay; 'none' uses difficulty knobs only. */
  aiArchetype?: 'none' | 'berserker' | 'counter_fighter' | 'zoner' | 'mixup_artist' | 'assassin' | 'brawler' | string;
  enableBurnDecals?: boolean;
  weaponReadyTime: number;
  weaponSwapLockout: number;
  enableSlide: boolean;
  enableSprint: boolean;
  speedSprint: number;
  speedSlide: number;
  slideDistance: number;
  slideCooldown: number;

  // --- Expert AI Tuning overrides (Group A exposed; Group B reserved). ---
  // Each key overrides a field in AIBehaviorTuning; unset = engine default.
  // See src/game/aiBehaviorTuning.ts (AI_TUNE_SETTING_KEYS).
  aiTuneMechanicAwareIq?: number;
  aiTuneHighIqOverride?: number;
  aiTuneHammerWindupSeconds?: number;
  aiTuneScoreAheadThreshold?: number;
  aiTuneScoreCloseThreshold?: number;
  aiTuneFeintIqGate?: number;
  aiTuneFeintCooldownMin?: number;
  aiTuneFeintCooldownMax?: number;
  aiTuneWeaponSwapFeintDelay?: number;
  aiTuneApproachFeintBackTimer?: number;
  aiTuneLungeFakeoutForwardTimer?: number;
  aiTuneChargeAbortSidestepTimer?: number;
  aiTuneBaseGroundSpeed?: number;
  aiTuneSprintEngageGap?: number;
  aiTuneSprintChaseTargetSpeed?: number;
  aiTuneSlideMinGap?: number;
  aiTuneSlideMaxGap?: number;
  aiTuneSlideMinComplexity?: number;
  aiTuneSlideTriggerChance?: number;
  aiTuneBaseEvasionDetectRange?: number;
  aiTuneBaitDodgeDistance?: number;
  aiTuneBaitDodgeBand?: number;
  aiTuneEvasionTriggerJitter?: number;
  aiTuneArenaEdgeInset?: number;
  aiTuneComboMinWeaponSwapIq?: number;
  aiTuneComboAdvancedWeaponSwapIq?: number;
  aiTuneTempoCycleDuration?: number;
  aiTunePostKillPressureDuration?: number;
  aiTuneTempoSlowMult?: number;
  aiTuneTempoFastMult?: number;
  aiTuneStandoffRangeMinOffset?: number;
  aiTuneStandoffRangeMaxOffset?: number;
  aiTuneCalibrationWindowSize?: number;
  aiTuneMaxCalibrationDrift?: number;
  aiTuneDodgeResolveDelay?: number;
  aiTuneCounterResolveDelay?: number;
  aiTunePlayerModelEmaAlpha?: number;
  aiTuneDefaultLungeDistance?: number;
  aiTuneDefaultReactionTime?: number;
  aiTunePriorityTargetTtl?: number;
  aiTuneDamageTagTtl?: number;
  aiTuneAttackStaggerStep?: number;
  aiTuneMaxAirborneHeight?: number;
  aiTuneForcedDescentSpeed?: number;
  // Group B (centralized, no UI yet):
  aiTunePredictionAnticipationBonus?: number;
  aiTunePredictionLandingWeight?: number;
  aiTuneLungeChanceGroundBase?: number;
  aiTuneLungeChanceGroundAnticipation?: number;
  aiTuneLungeChanceAirborneBase?: number;
  aiTuneLungeChanceAirborneAnticipation?: number;
  aiTuneReactChanceBase?: number;
  aiTuneReactChanceAnticipation?: number;
  aiTuneHammerJumpReachBase?: number;
  aiTuneHammerJumpReachAnticipation?: number;
  aiTuneHammerJumpVerticalBase?: number;
  aiTuneHammerJumpVerticalAnticipation?: number;
}

export interface Keybindings {
  moveForward: string;
  moveLeft: string;
  moveBackward: string;
  moveRight: string;
  jump: string;
  dash: string;
  crouch: string;
  scoreboard: string;
  weapon1: string;
  weapon2: string;
  attack: string;
  altAttack: string;
  sprint: string;
  holdToSprint?: boolean;     // true = hold sprint button to sprint (default); false = tap once to toggle sprint
  mouseSensitivity?: number;  // multiplier applied to base sensitivity (0.1 – 5.0, default 1.0)
  mouseAcceleration?: number; // power-curve exponent offset (0.0 – 2.0, default 0.0 = linear)
  gamepadSensitivity?: number; // aim sensitivity scale for controller (0.5 – 10.0, default 3.0)
  gamepadAcceleration?: number; // aim acceleration exponent offset (0.0 – 2.0, default 0.0 = linear)
  gamepadCursorSpeed?: number;  // speed modifier for menu navigation cursor (0.2 – 4.0, default 1.0)
  gamepadJump?: number;       // A button (index 0)
  gamepadCrouch?: number;     // B button (index 1)
  gamepadDash?: number;       // X button (index 2)
  gamepadSwapWeapon?: number; // Y button (index 3)
  gamepadAttack?: number;     // RT (index 7)
  gamepadAltAttack?: number;  // RB (index 5)
  gamepadSprint?: number;     // LS Click (index 10)
  gamepadScoreboard?: number; // Back (index 8)
  gamepadPause?: number;      // Start (index 9)
}

export const DEFAULT_KEYBINDINGS: Keybindings = {
  moveForward: 'w',
  moveLeft: 'a',
  moveBackward: 's',
  moveRight: 'd',
  jump: ' ',
  dash: 'q',
  crouch: 'c',
  scoreboard: 'u',
  weapon1: '1',
  weapon2: '2',
  attack: 'lmb',
  altAttack: 'rmb',
  sprint: 'shift',
  holdToSprint: true,
  mouseSensitivity: 1.0,
  mouseAcceleration: 0.0,
  gamepadSensitivity: 3.0,
  gamepadAcceleration: 0.0,
  gamepadCursorSpeed: 1.0,
  gamepadJump: 0,
  gamepadCrouch: 1,
  gamepadDash: 2,
  gamepadSwapWeapon: 3,
  gamepadAttack: 7,
  gamepadAltAttack: 5,
  gamepadSprint: 10,
  gamepadScoreboard: 8,
  gamepadPause: 9,
};

export type GameState = 'menu' | 'playing' | 'paused';

export type Stance = 'STANDING' | 'CROUCHING' | 'JUMPING';

export type WeaponState = 'ready' | 'swing_up' | 'swing_down' | 'recovering' | 'melee_swing' | 'melee_recover' | 'melee_up' | 'melee_down';

export type AIBehaviorPreset = 'passive' | 'defensive' | 'aggressive';

export type AIBehaviorState =
  | 'APPROACHING' // AI moves toward the player
  | 'DANCING_FORWARD' // AI moves forward slightly to bait
  | 'DANCING_BACKWARD' // AI fast-retreats to evade counter attack
  | 'SIDE_STEPPING' // AI circles player
  | 'CHARGE_ATTACK' // AI rushes in for swing
  | 'PRESSURING' // AI chains follow-up attacks after landing a non-lethal hit
  | 'LUNGING' // AI is executing a high velocity sword lunge
  | 'COOLDOWN' // AI retreats or stands still while recovering
  | 'RESPAWNING' // AI is dead and respawning
  | 'SPAWN_GUARDING'; // AI is guarding and spacing an anticipated spawn

export interface Particle {
  position: [number, number, number];
  velocity: [number, number, number];
  color: string;
  size: number;
  life: number;
  maxLife: number;
}

export interface MedalInfo {
  id: string;
  name: string;
  icon: string; // Identifier for the SVG icon component
  color: string; // Custom glow color (hex or rgb)
  description: string;
}

export interface DeathEvent {
  id: string;
  attacker: string;
  victim: string;
  medals?: MedalInfo[];
  weapon?: 'sword' | 'hammer' | 'sword_vs_sword' | 'sword_vs_hammer' | 'hammer_vs_hammer';
}

export interface RemotePlayerState {
  id: string;
  playerName: string;
  pos: { x: number; y: number; z: number };
  vel: { x: number; y: number; z: number };
  yaw: number;
  pitch: number;
  hp: number;
  maxHp: number;
  isCrouching: boolean;
  activeWeapon: 'hammer' | 'sword' | 'pistol';
  respawnTimer: number;
  hue: number;
  score: number;
  kills: number;
  deaths: number;
  isObserver?: boolean;
  invulnerabilityTimer?: number;
  aiState?: AIBehaviorState;
  aiTimer?: number;
  aiSwayTimer?: number;
  aiDashRemaining?: number;
  aiDashCooldownTimer?: number;
  aiDashDir?: { x: number; y: number; z: number };
  aiSlideActive?: boolean;
  aiSlideDistanceTraveled?: number;
  aiSlideCooldownTimer?: number;
  aiIsSprinting?: boolean;
  swapLockoutTimer?: number;
  weaponState?: WeaponState | 'slashing' | 'recovering';
  isLunging?: boolean;
  lungeTimer?: number;
  lungeTargetDir?: { x: number; y: number; z: number };
  lungeStartPos?: { x: number; y: number; z: number };
  aiLastLungeOutcome?: 'hit' | 'miss_timeout' | 'miss_arena' | 'target_dead';
  aiLastLungeTargetId?: string;
  aiPostLungeDecisionTimer?: number;
  aiPendingPostEvasionCharge?: boolean;
  aiPressureTargetId?: string;
}

/**
 * In-memory combatant state shared by every AI-driven entity — the main AI and
 * all additional bots — plus remote multiplayer players. This is the single
 * structure the unified AI runs on; `pos`/`vel` are live THREE.Vector3 instances
 * (unlike the serialized RemotePlayerState DTO, which uses plain {x,y,z}).
 *
 * Identity, physics and scoring are always present. The AI behavioral sub-state
 * and remote-only fields are optional because a freshly spawned combatant (or a
 * remote player that never runs the local AI) may not have them until the AI
 * tick initializes them.
 */
/** Team assignment for roster combatants; extensible for N teams later. */
export type TeamId = 'blue' | 'red' | (string & {});

/** Who drives a roster entry — local AI tick vs network remote human. */
export type CombatantController = 'ai' | 'remote';

export interface Combatant {
  // Identity
  id: string;
  playerName: string;
  hue: number;
  /** Local AI vs remote human — orchestrator ticks `ai` entries only. */
  controller: CombatantController;
  difficulty?: string;
  /** Roster team; defaults to red for AI combatants in sandbox. */
  team?: TeamId;

  // Physics / pose (live references, mutated in place each tick)
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  yaw: number;
  pitch?: number;
  isCrouching: boolean;
  isJumping?: boolean;

  // Vitals / scoring
  hp: number;
  maxHp: number;
  respawnTimer: number;
  invulnerabilityTimer?: number;
  spawnTime?: number;
  score: number;
  kills: number;
  deaths: number;
  isObserver?: boolean;

  // Weapon
  activeWeapon: 'hammer' | 'sword';
  weaponState?: WeaponState | 'slashing' | 'recovering';
  weaponTimer?: number;
  lastSwordAttackTime?: number;
  lastHammerAttackTime?: number;
  swapLockoutTimer?: number;

  // AI behavioral sub-state
  aiState?: AIBehaviorState;
  aiTimer?: number;
  aiSwayTimer?: number;
  aiDashCooldownTimer?: number;
  aiDashRemaining?: number;
  aiDashDir?: { x: number; y: number; z: number };
  aiSlideActive?: boolean;
  aiSlideDistanceTraveled?: number;
  aiSlideCooldownTimer?: number;
  aiIsSprinting?: boolean;
  aiHammerJumpCooldownTimer?: number;
  aiHammerJumpsInAir?: number;
  aiCoordCommitTimer?: number;
  aiPostLungeDecisionTimer?: number;
  aiPendingPostEvasionCharge?: boolean;
  aiPressureTargetId?: string;
  aiLastLungeOutcome?: 'hit' | 'miss_timeout' | 'miss_arena' | 'target_dead';
  aiLastLungeTargetId?: string;

  // Sword-lunge flight
  isLunging?: boolean;
  lungeTimer?: number;
  lungeStartPos?: { x: number; y: number; z: number } | THREE.Vector3;
  lungeTargetDir?: { x: number; y: number; z: number } | THREE.Vector3;

  /** Hammer-jump planning (main AI offensive jump path). */
  hammerJumpPlanned?: boolean;
  hammerJumpType?: 'offensive' | 'defensive';
  hammerJumpWindowTimer?: number;
  /** Legacy swap cooldown separate from swapLockoutTimer (network replay). */
  swapCooldownTimer?: number;
}

export interface GameStats {
  playerHP: number;
  playerMaxHP: number;
  enemyHP: number;
  enemyMaxHP: number;
  scorePlayer: number;
  scoreEnemy: number;
  otherPlayers?: RemotePlayerState[];

  gameTime: number; // in seconds
  debugMode: boolean;
  debugDamageRadius: number; // constant viz size (4.5m / current attackRadius)
  weaponReady: boolean;
  weaponCooldown: number; // 0.0 to 1.0 (1.0 is full)
  lastStrikePos: [number, number, number] | null;
  lastStrikeTick: number; // to fade out the visualizer
  isCrouching: boolean;
  isJumping: boolean;
  playerRespawnTimer: number; // seconds left
  enemyRespawnTimer: number; // seconds left
  playerDashCooldownTimer: number; // remaining dash cooldown in seconds (0 means ready)
  playerDashReady: boolean; // whether player can currently dash
  settings: UniversalSettings; // Current admin configurations
  lastDeaths: DeathEvent[];
  playerX: number;
  playerZ: number;
  playerYaw: number;
  enemyX: number;
  enemyZ: number;
  enemyYaw: number;
  enemyIsCrouching: boolean;
  playerIsCrouchMoving: boolean;
  enemyIsCrouchMoving: boolean;
  activeWeapon: 'hammer' | 'sword' | 'pistol';
  crosshairColor: 'white' | 'red';
  isMultiplayer?: boolean;
  multiplayerRole?: 'host' | 'client' | 'observer' | null;
  opponentConnected?: boolean;
  fps?: number;
  ping?: number;
  showScoreboard?: boolean;
  playerKills?: number;
  playerDeaths?: number;
  enemyKills?: number;
  enemyDeaths?: number;
  playerClientId?: string;
  opponentClientId?: string;
  opponentPlayerName?: string;            // Retained in-game synchronized opponent player name
  isObserverMode?: boolean;
  observerCamMode?: 'free' | 'third' | 'first';
  observerTargetName?: string;
  observerTargetRole?: 'host' | 'client';
  activeMedalPopup?: { medal: MedalInfo; key: number } | null;
  isReplayMode?: boolean;
  replayElapsedTime?: number;
  replayDuration?: number;
  replayIsPlaying?: boolean;
  replaySpeedMultiplier?: number;
  replayPlayerList?: { id: string; name: string; hue: number }[];
  replayCurrentTargetId?: string;
}

export interface UiElementPos {
  id: string;
  name: string;
  x: number; // percentage of screen width (0-100)
  y: number; // percentage of screen height (0-100)
  locked: boolean;
  scale?: number; // multiplier for the rendered HUD element, default 1
}

export const UI_ELEMENT_SCALE_MIN = 0.5;
export const UI_ELEMENT_SCALE_MAX = 1.6;
export const UI_ELEMENT_SCALE_STEP = 0.05;

export type DeviceOS = 'ios' | 'android' | 'desktop' | 'unknown';

export interface DeviceInfo {
  isMobile: boolean;
  os: DeviceOS;
}

export interface AITuning {
  aiReactionLatency?: number;
  aiAnticipationFactor?: number;
  aiMovementComplexity?: number;
  aiWeaponSwapIQ?: number;
  aiPlaystyle?: number;
  aiWeaponPrioritization?: number;
  // Advanced behavior overrides (unset = derived / neutral).
  aiSpatialIQ?: number;
  aiFeintChance?: number;
  aiPressureAggression?: number;
  aiSpacingBand?: number;
  aiSkipPressure?: boolean;
}

export interface AIPreset {
  id: string;
  name: string;
  tuning: AITuning;
}

export interface TournamentOpponent {
  id: string;
  name: string;
  hue: number;
  difficulty: 'easy' | 'normal' | 'hard' | 'nightmare' | 'custom';
  reactionLatency: number;
  anticipationFactor: number;
  movementComplexity: number;
  weaponSwapIQ: number;
  playstyle: number; // 0 = passive, 50 = defensive, 100 = aggressive
  behavior: 'passive' | 'defensive' | 'aggressive';
  /** Optional combat personality for distinct bracket opponents. */
  archetype?: 'berserker' | 'counter_fighter' | 'zoner' | 'mixup_artist' | 'assassin' | 'brawler' | string;
}

export interface TournamentMatch {
  opponent1: string; // "player" or bot ID
  opponent2: string; // bot ID
  winner?: string; // "player" or bot ID
  score1?: number; // kills of opponent1
  score2?: number; // kills of opponent2
  isCompleted: boolean;
}

export interface TournamentState {
  difficulty: 'easy' | 'normal' | 'hard' | 'nightmare' | 'custom';
  killsToWin: number;
  roundCount: number; // Total elimination rounds in this bracket
  currentRound: number;
  currentMatchIndex: number; // Index of the player's match in the current round
  opponents: Record<string, TournamentOpponent>; // bot ID -> bot details
  rounds: TournamentMatch[][];
  status: 'idle' | 'bracket' | 'playing' | 'gameover' | 'victory';
}

export interface ReplayFrame {
  time: number; // match elapsed time in seconds
  player?: {
    pos: { x: number; y: number; z: number };
    vel: { x: number; y: number; z: number };
    yaw: number;
    pitch: number;
    hp: number;
    isCrouching: boolean;
    isJumping: boolean;
    isLunging: boolean;
    isDashing?: boolean;
    isSprinting?: boolean;
    isSliding?: boolean;
    weaponTimer?: number;
    activeWeapon: 'hammer' | 'sword' | 'pistol';
    weaponState: string;
    score: number;
    kills: number;
    deaths: number;
    respawnTimer: number;
    invulnerabilityTimer: number;
  };
  ai?: {
    pos: { x: number; y: number; z: number };
    vel: { x: number; y: number; z: number };
    yaw: number;
    pitch?: number;
    hp: number;
    isCrouching: boolean;
    isLunging?: boolean;
    isDashing?: boolean;
    isSprinting?: boolean;
    isSliding?: boolean;
    weaponTimer?: number;
    activeWeapon: 'hammer' | 'sword';
    weaponState: string;
    score: number;
    kills: number;
    deaths: number;
    respawnTimer: number;
    invulnerabilityTimer: number;
  };
  otherPlayers?: {
    id: string;
    playerName: string;
    hue: number;
    pos: { x: number; y: number; z: number };
    vel: { x: number; y: number; z: number };
    yaw: number;
    pitch?: number;
    hp: number;
    isCrouching: boolean;
    isLunging?: boolean;
    isDashing?: boolean;
    isSprinting?: boolean;
    isSliding?: boolean;
    weaponTimer?: number;
    activeWeapon: 'hammer' | 'sword';
    weaponState: string;
    score: number;
    kills: number;
    deaths: number;
    respawnTimer: number;
    invulnerabilityTimer: number;
  }[];
}

export interface ReplayFile {
  id: string;
  name: string;
  description: string;
  date: string; // ISO string
  duration: number; // total game time in seconds
  playerHue: number;
  playerName: string;
  opponentName: string;
  mapType: 'rectangular' | 'circle';
  mode: 'sandbox' | 'tournament';
  maxScore: number;
  frames: ReplayFrame[];
  isAutoSaved?: boolean;
  recordedAsObserver?: boolean;
}

export interface CustomMapObject {
  id: string;
  name: string;
  type: 'box' | 'cylinder' | 'sphere';
  position: { x: number; y: number; z: number };
  rotation: { x: number; y: number; z: number };
  scale: { x: number; y: number; z: number };
  color: string;
  metalness: number;
  roughness: number;
  opacity: number;
  transparent: boolean;
  emissive: string;
  emissiveIntensity: number;
  isCollidable: boolean;
  texture: 
    | 'none'
    | 'nature_grass' | 'nature_mossy_stone' | 'nature_wood'
    | 'space_alloy' | 'space_meteorite' | 'space_lunar_dust'
    | 'futuristic_carbon' | 'futuristic_hex' | 'futuristic_shield'
    | 'city_asphalt' | 'city_brick' | 'city_concrete'
    | 'fantasy_runed_stone' | 'fantasy_cobble' | 'fantasy_gold'
    | 'forerunner_panel' | 'forerunner_gold'
    | 'synthwave_grid' | 'synthwave_neon_laser' | 'synthwave_chrome'
    | 'rainy_streets_asphalt' | 'rainy_streets_neon_glow' | 'rainy_streets_dog_billboard'
    | 'winter_ice' | 'winter_snow' | 'winter_glacier_glass'
    | 'stadium_steel_grid' | 'stadium_scoreboard_screen' | 'stadium_advertisement_sapphire' | 'stadium_advertisement_gauss';
  locked?: boolean;
  hidden?: boolean;
  folderId?: string | null;
}

export interface CustomMapPointLight {
  id: string;
  color: string;
  intensity: number;
  distance: number;
  decay: number;
  position: { x: number; y: number; z: number };
}

export interface CustomMapLighting {
  ambientColor: string;
  ambientIntensity: number;
  directColor: string;
  directIntensity: number;
  directPosition: { x: number; y: number; z: number };
  pointLights: CustomMapPointLight[];
}

export interface CustomMapFolder {
  id: string;
  name: string;
  locked: boolean;
  hidden: boolean;
  collapsed: boolean;
}

export interface CustomMapData {
  id: string;
  name: string;
  description: string;
  author: string;
  theme: 'hangar' | 'holodeck' | 'cyberpunk' | 'rust' | 'nature' | 'space' | 'fantasy' | 'forerunner' | 'synthwave' | 'rainy_streets' | 'winter_rink' | 'grifball_stadium';
  mapShape?: 'circle' | 'rectangular';
  arenaRadius: number;
  skyboxHue?: number;
  skyboxBrightness?: number;
  skyboxTexture?: string;
  fogColor?: string;
  fogDensity?: number;
  spawnPoints: { x: number; y: number; z: number }[];
  objects: CustomMapObject[];
  lighting: CustomMapLighting;
  folders?: CustomMapFolder[];
}


