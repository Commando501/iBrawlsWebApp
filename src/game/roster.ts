import * as THREE from 'three';
import type { AIBehaviorState, Combatant, UniversalSettings, WeaponState } from '../types';
import { DEFAULT_AI_TEAM, resolveCombatantTeam } from './teamScoring';
import { type LegacyRosterProps } from './rosterSlotConfig';

/** Who drives a roster combatant — AI tick vs network remote. */
export type CombatantController = 'ai' | 'remote';

export const MAIN_AI_ID = 'main_ai';

export function isAIControlled(c: Combatant): boolean {
  return c.controller === 'ai';
}

export function isRemoteControlled(c: Combatant): boolean {
  return c.controller === 'remote';
}

/** All locally ticked AI combatants (main_ai + offline bots). */
export function getAICombatants(roster: Map<string, Combatant>): Combatant[] {
  return Array.from(roster.values()).filter(isAIControlled);
}

/** Lookup a roster entry by id. */
export function getRosterCombatant(
  roster: Map<string, Combatant>,
  id: string
): Combatant | undefined {
  return roster.get(id);
}

/** Whether an AI combatant can receive damage / be targeted this frame. */
export function isAICombatReady(c: Combatant): boolean {
  if (!isAIControlled(c)) return false;
  return (
    c.hp > 0 &&
    (c.respawnTimer ?? 0) <= 0 &&
    (c.invulnerabilityTimer ?? 0) <= 0 &&
    c.aiState !== 'RESPAWNING'
  );
}

/** Network-driven human opponents. */
export function getRemoteCombatants(roster: Map<string, Combatant>): Combatant[] {
  return Array.from(roster.values()).filter(isRemoteControlled);
}

export function getMainAI(roster: Map<string, Combatant>): Combatant | undefined {
  const c = roster.get(MAIN_AI_ID);
  return c && isAIControlled(c) ? c : undefined;
}

/** Count bot_* slots excluding main_ai. */
export function countOfflineBotSlots(roster: Map<string, Combatant>): number {
  let n = 0;
  roster.forEach((_, id) => {
    if (id.startsWith('bot_')) n++;
  });
  return n;
}

/** Primary remote opponent for 1v1 HUD / legacy enemyGroup paths. */
export function getPrimaryRemoteOpponent(
  roster: Map<string, Combatant>,
  preferredId?: string
): Combatant | undefined {
  if (preferredId) {
    const preferred = roster.get(preferredId);
    if (preferred && isRemoteControlled(preferred)) return preferred;
  }
  for (const c of roster.values()) {
    if (isRemoteControlled(c)) return c;
  }
  return undefined;
}

/** Offline display opponent: main_ai. Online: preferred/first remote. */
export function getDisplayOpponent(
  roster: Map<string, Combatant>,
  isMultiplayer: boolean,
  preferredRemoteId?: string
): Combatant | undefined {
  if (!isMultiplayer) return getMainAI(roster);
  return getPrimaryRemoteOpponent(roster, preferredRemoteId);
}

export interface CreateMainAIParams {
  settings: UniversalSettings;
  legacy: LegacyRosterProps;
  spawnPos: THREE.Vector3;
  yaw: number;
  hue?: number;
  difficulty?: string;
}

/** Factory for roster slot 0 — canonical offline main AI combatant. */
export function createMainAICombatant(params: CreateMainAIParams): Combatant {
  const { settings, legacy, spawnPos, yaw, hue = 0, difficulty } = params;
  const maxHp = settings.maxHP ?? 1;
  return {
    id: MAIN_AI_ID,
    controller: 'ai',
    playerName: 'Red (AI)',
    team: resolveCombatantTeam(MAIN_AI_ID, settings, legacy),
    pos: spawnPos.clone(),
    vel: new THREE.Vector3(0, 0, 0),
    yaw,
    pitch: 0,
    hp: maxHp,
    maxHp,
    isCrouching: false,
    isJumping: false,
    activeWeapon: 'hammer',
    weaponState: 'ready' as WeaponState,
    weaponTimer: 0,
    aiState: 'APPROACHING' as AIBehaviorState,
    aiTimer: 0,
    aiSwayTimer: 0,
    aiDashCooldownTimer: 0,
    aiDashRemaining: 0,
    aiDashDir: { x: 0, y: 0, z: 0 },
    aiSlideActive: false,
    aiSlideDistanceTraveled: 0,
    aiSlideCooldownTimer: 0,
    aiIsSprinting: false,
    aiHammerJumpCooldownTimer: 0,
    aiCoordCommitTimer: 0,
    aiPostLungeDecisionTimer: 0,
    aiPendingPostEvasionCharge: false,
    aiPressureTargetId: undefined,
    swapLockoutTimer: 0,
    swapCooldownTimer: 0,
    invulnerabilityTimer: settings.respawnInvulnerabilityDuration,
    spawnTime: Date.now(),
    lungeTimer: 0,
    lungeStartPos: new THREE.Vector3(),
    lungeTargetDir: new THREE.Vector3(),
    lastSwordAttackTime: 0,
    lastHammerAttackTime: 0,
    hammerJumpPlanned: false,
    hammerJumpWindowTimer: 0,
    aiHammerJumpsInAir: 0,
    hue,
    difficulty: difficulty ?? legacy.botDifficulties?.[MAIN_AI_ID] ?? settings.aiDifficulty ?? 'normal',
    score: 0,
    kills: 0,
    deaths: 0,
    respawnTimer: 0,
  };
}

export interface CreateOfflineBotParams {
  id: string;
  playerName: string;
  team: Combatant['team'];
  spawnPos: THREE.Vector3;
  yaw: number;
  hue: number;
  difficulty: string;
  settings: UniversalSettings;
}

export function createOfflineBotCombatant(params: CreateOfflineBotParams): Combatant {
  const { settings } = params;
  const maxHp = settings.maxHP ?? 1;
  return {
    id: params.id,
    controller: 'ai',
    playerName: params.playerName,
    team: params.team,
    pos: params.spawnPos.clone(),
    vel: new THREE.Vector3(0, 0, 0),
    yaw: params.yaw,
    pitch: 0,
    hp: maxHp,
    maxHp,
    isCrouching: false,
    activeWeapon: 'hammer',
    respawnTimer: 0,
    hue: params.hue,
    difficulty: params.difficulty,
    score: 0,
    kills: 0,
    deaths: 0,
    invulnerabilityTimer: settings.respawnInvulnerabilityDuration,
    aiHammerJumpCooldownTimer: 0,
    aiHammerJumpsInAir: 0,
    spawnTime: Date.now(),
  };
}

export interface CreateRemoteCombatantParams {
  id: string;
  playerName: string;
  spawnZ: number;
  settings: UniversalSettings;
  data?: {
    hp?: number;
    maxHp?: number;
    hue?: number;
    isCrouching?: boolean;
    activeWeapon?: 'hammer' | 'sword' | 'pistol';
    respawnTimer?: number;
    invulnerabilityTimer?: number;
  };
}

export function createRemoteCombatant(params: CreateRemoteCombatantParams): Combatant {
  const { id, playerName, spawnZ, settings, data = {} } = params;
  const maxHp = data.maxHp ?? settings.maxHP ?? 1;
  return {
    id,
    controller: 'remote',
    playerName,
    team: DEFAULT_AI_TEAM,
    pos: new THREE.Vector3(0, 0, spawnZ),
    vel: new THREE.Vector3(0, 0, 0),
    yaw: 0,
    pitch: 0,
    hp: data.hp ?? maxHp,
    maxHp,
    isCrouching: data.isCrouching ?? false,
    activeWeapon: (data.activeWeapon === 'pistol' ? 'hammer' : data.activeWeapon) ?? 'hammer',
    respawnTimer: data.respawnTimer ?? 0,
    hue: data.hue ?? Math.floor(Math.random() * 360),
    score: 0,
    kills: 0,
    deaths: 0,
    invulnerabilityTimer: data.invulnerabilityTimer ?? settings.respawnInvulnerabilityDuration,
    lastSwordAttackTime: 0,
    lastHammerAttackTime: 0,
    spawnTime: Date.now(),
  };
}

/** Ensure main_ai exists in the offline roster (idempotent). */
export function ensureMainAIInRoster(
  roster: Map<string, Combatant>,
  params: CreateMainAIParams
): Combatant {
  const existing = getMainAI(roster);
  if (existing) return existing;
  const c = createMainAICombatant(params);
  roster.set(MAIN_AI_ID, c);
  return c;
}

/** Remove main_ai when entering multiplayer — remote entries only in the map. */
export function removeMainAIFromRoster(roster: Map<string, Combatant>): void {
  roster.delete(MAIN_AI_ID);
}
