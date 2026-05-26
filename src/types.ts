/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

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
  swordLungeDistance: number;             // Lunge range distance mapping reticule lock on (e.g. 1.0m to 25.0m)
  swordLungeSpeed: number;                // Lunge glide movement speed (e.g. 5.0m/s to 50.0m/s)
  swordSlashSpeed: number;                // Slash duration sweep phase time (e.g. 0.05s to 1.0s)
  swordSlashReload: number;               // Recovery reload duration for Sword Slash (e.g. 0.1s to 3.0s)
  swordLungeReload: number;               // Recovery reload duration for Sword Lunge (e.g. 0.1s to 5.0s)
  hammerJumpPower: number;                // The additional height / upward velocity added when hammer jumping (e.g. 2.0 to 15.0)
  hammerJumpTriggerRadius: number;        // The radius underneath the model for triggering a hammer jump (e.g. 1.0m to 10.0m)
  hammerJumpWindow: number;               // Time window to jump after swinging in seconds (e.g. 0.1s to 2.0s)
  visualizeJumpZone: boolean;             // Whether to draw the zone beneath the player to visualize it
  directLightIntensity: number;           // Intensity of the direct light (e.g. 0.1 to 4.0)
  ambientLightIntensity: number;          // Intensity of the ambient light (e.g. 0.1 to 3.5)
  skyboxBrightness: number;               // Brightness of the skybox / background (e.g. 0 to 100)
  skyboxHue: number;                      // Color hue of the skybox / background (e.g. 0 to 360)
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
  aiDifficulty?: 'easy' | 'normal' | 'hard' | 'nightmare' | 'custom';
  aiReactionLatency?: number;             // Reaction latency in seconds (0.0 to 1.5)
  aiAnticipationFactor?: number;          // How aggressively it predicts player action (0.0 to 1.0)
  aiMovementComplexity?: number;          // 0 to 100%
  aiWeaponSwapIQ?: number;                // 0 to 100%
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
};

export type GameState = 'menu' | 'playing' | 'paused';

export type Stance = 'STANDING' | 'CROUCHING' | 'JUMPING';

export type WeaponState = 'ready' | 'swing_up' | 'swing_down' | 'recovering';

export type AIBehaviorState =
  | 'APPROACHING' // AI moves toward the player
  | 'DANCING_FORWARD' // AI moves forward slightly to bait
  | 'DANCING_BACKWARD' // AI fast-retreats to evade counter attack
  | 'SIDE_STEPPING' // AI circles player
  | 'CHARGE_ATTACK' // AI rushes in for swing
  | 'LUNGING' // AI is executing a high velocity sword lunge
  | 'COOLDOWN' // AI retreats or stands still while recovering
  | 'RESPAWNING'; // AI is dead and respawning

export interface Particle {
  position: [number, number, number];
  velocity: [number, number, number];
  color: string;
  size: number;
  life: number;
  maxLife: number;
}

export interface DeathEvent {
  id: string;
  attacker: string;
  victim: string;
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
  activeWeapon: 'hammer' | 'sword';
  respawnTimer: number;
  hue: number;
  score: number;
  kills: number;
  deaths: number;
  isObserver?: boolean;
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
  activeWeapon: 'hammer' | 'sword';
  crosshairColor: 'white' | 'red';
  isMultiplayer?: boolean;
  multiplayerRole?: 'host' | 'client' | 'observer' | null;
  opponentConnected?: boolean;
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
}

export interface UiElementPos {
  id: string;
  name: string;
  x: number; // percentage of screen width (0-100)
  y: number; // percentage of screen height (0-100)
  locked: boolean;
}

