import * as THREE from 'three';
import type { Combatant, UniversalSettings } from '../types';
import {
  type BotCoordinatorState,
  clearBotEngagements,
  tickBotCoordinator,
} from './aiBotCoordinator';
import {
  countOfflineBotSlots,
  createMainAICombatant,
  createOfflineBotCombatant,
  ensureMainAIInRoster,
  getAICombatants,
  getMainAI,
  isAIControlled,
  MAIN_AI_ID,
  type CreateMainAIParams,
} from './roster';
import {
  type LegacyRosterProps,
  resolveRosterSlotForCombatant,
} from './rosterSlotConfig';
import { resolveCombatantTeam } from './teamScoring';

/** Default hues for offline bot_* slots (bot_2 … bot_7). */
export const OFFLINE_BOT_HUES = [120, 280, 45, 60, 320, 180];

export const OFFLINE_BOT_NAMES = [
  'DoomBot Green',
  'DoomBot Purple',
  'DoomBot Orange',
  'DoomBot Yellow',
  'DoomBot Magenta',
  'DoomBot Cyan',
];

export interface AIOrchestratorInput {
  roster: Map<string, Combatant>;
  settings: UniversalSettings;
  legacy: LegacyRosterProps;
  /** Total offline combatants including main_ai. */
  offlineBotCount: number;
  playerPos: THREE.Vector3;
  isPlaying: boolean;
  coordinator: BotCoordinatorState;
}

export interface AIOrchestratorSpawnCallbacks {
  getOptimalSpawnPoint: (exclude: THREE.Vector3[]) => THREE.Vector3;
  getInwardSpawnYaw: (pos: THREE.Vector3) => number;
}

export interface AIOrchestratorEvents {
  onBotSpawned?: (botId: string, bot: Combatant) => void;
  onBotDespawned?: (botId: string) => void;
  onMainAICreated?: (mainAi: Combatant) => void;
  onHueChanged?: (combatantId: string, combatant: Combatant) => void;
  onRosterLayoutChanged?: (totalCombatants: number) => void;
  /** Called after local player spawn position is chosen at roster seed. */
  onPlayerPositioned?: (yaw: number) => void;
}

export interface AIOrchestratorTickResult {
  rosterChanged: boolean;
  totalCombatants: number;
}

export function offlineCustomBotTarget(offlineBotCount: number): number {
  return Math.max(0, offlineBotCount - 1);
}

export function offlineBotSlotId(slotIndex: number): string {
  return `bot_${slotIndex + 2}`;
}

/** Apply resolved roster-slot config onto live AI combatants (team, difficulty, hue, name). */
export function applyRosterSlotConfigToCombatants(
  roster: Map<string, Combatant>,
  settings: UniversalSettings,
  legacy: LegacyRosterProps,
  events?: Pick<AIOrchestratorEvents, 'onHueChanged'>
): boolean {
  let changed = false;

  for (const combatant of getAICombatants(roster)) {
    const slot = resolveRosterSlotForCombatant(combatant.id, settings, legacy);
    const team = resolveCombatantTeam(combatant.id, settings, legacy);

    if (combatant.team !== team) {
      combatant.team = team;
      changed = true;
    }

    const difficulty = slot.difficulty || 'normal';
    if (combatant.difficulty !== difficulty) {
      combatant.difficulty = difficulty;
      changed = true;
    }

    if (slot.hue !== undefined && combatant.hue !== slot.hue) {
      combatant.hue = slot.hue;
      events?.onHueChanged?.(combatant.id, combatant);
      changed = true;
    }

    if (combatant.id !== MAIN_AI_ID && slot.name && combatant.playerName !== slot.name) {
      combatant.playerName = slot.name;
      changed = true;
    }
  }

  return changed;
}

/** Spawn/despawn bot_* slots to match configured count — AI entries only, never remotes. */
export function syncOfflineBotSlots(
  input: Pick<AIOrchestratorInput, 'roster' | 'settings' | 'legacy' | 'offlineBotCount' | 'playerPos'>,
  spawnCallbacks: AIOrchestratorSpawnCallbacks,
  events?: Pick<AIOrchestratorEvents, 'onBotSpawned' | 'onBotDespawned'>
): boolean {
  const targetCustomBotCount = offlineCustomBotTarget(input.offlineBotCount);
  const currentCustomBotCount = countOfflineBotSlots(input.roster);
  let rosterChanged = false;

  if (targetCustomBotCount > currentCustomBotCount) {
    const exclude: THREE.Vector3[] = [input.playerPos.clone()];
    const mainAi = getMainAI(input.roster);
    if (mainAi) exclude.push(mainAi.pos.clone());

    input.roster.forEach((bot) => {
      if (isAIControlled(bot) && bot.hp > 0 && bot.respawnTimer <= 0) {
        exclude.push(new THREE.Vector3(bot.pos.x, bot.pos.y, bot.pos.z));
      }
    });

    for (let i = currentCustomBotCount; i < targetCustomBotCount; i++) {
      const botId = offlineBotSlotId(i);
      const hue = input.legacy.botColors?.[botId] ?? OFFLINE_BOT_HUES[i % OFFLINE_BOT_HUES.length];
      const name = OFFLINE_BOT_NAMES[i % OFFLINE_BOT_NAMES.length];
      const diff = input.legacy.botDifficulties?.[botId] || 'normal';
      const team = resolveCombatantTeam(botId, input.settings, input.legacy);

      const spawnPos = spawnCallbacks.getOptimalSpawnPoint(exclude);
      exclude.push(spawnPos.clone());

      const newBot = createOfflineBotCombatant({
        id: botId,
        playerName: name,
        team,
        spawnPos,
        yaw: spawnCallbacks.getInwardSpawnYaw(spawnPos),
        hue,
        difficulty: diff,
        settings: input.settings,
      });

      input.roster.set(botId, newBot);
      events?.onBotSpawned?.(botId, newBot);
      rosterChanged = true;
    }
  } else if (targetCustomBotCount < currentCustomBotCount) {
    for (let i = currentCustomBotCount - 1; i >= targetCustomBotCount; i--) {
      const botId = offlineBotSlotId(i);
      if (input.roster.has(botId)) {
        input.roster.delete(botId);
        events?.onBotDespawned?.(botId);
        rosterChanged = true;
      }
    }
  }

  return rosterChanged;
}

export interface SeedOfflineRosterParams extends AIOrchestratorInput {
  mainAiParams?: Partial<Omit<CreateMainAIParams, 'settings' | 'legacy'>>;
}

/** Initial offline roster at scene mount — main_ai + bot_* with spread spawn positions. */
export function seedOfflineRoster(
  params: SeedOfflineRosterParams,
  spawnCallbacks: AIOrchestratorSpawnCallbacks,
  events?: AIOrchestratorEvents
): void {
  const { roster, settings, legacy, offlineBotCount, playerPos } = params;

  roster.clear();

  const mainSpawn = new THREE.Vector3(0, 0, -12);
  const mainAi = ensureMainAIInRoster(roster, {
    settings,
    legacy,
    spawnPos: mainSpawn,
    yaw: spawnCallbacks.getInwardSpawnYaw(mainSpawn),
    hue: legacy.botColors?.[MAIN_AI_ID] ?? 0,
    difficulty: legacy.botDifficulties?.[MAIN_AI_ID] || 'normal',
    ...params.mainAiParams,
  });
  events?.onMainAICreated?.(mainAi);

  const customBotCount = offlineCustomBotTarget(offlineBotCount);
  for (let i = 0; i < customBotCount; i++) {
    const botId = offlineBotSlotId(i);
    roster.set(
      botId,
      createOfflineBotCombatant({
        id: botId,
        playerName: OFFLINE_BOT_NAMES[i % OFFLINE_BOT_NAMES.length],
        team: resolveCombatantTeam(botId, settings, legacy),
        spawnPos: new THREE.Vector3(0, 0, 0),
        yaw: 0,
        hue: legacy.botColors?.[botId] ?? OFFLINE_BOT_HUES[i % OFFLINE_BOT_HUES.length],
        difficulty: legacy.botDifficulties?.[botId] || 'normal',
        settings,
      })
    );
  }

  playerPos.copy(spawnCallbacks.getOptimalSpawnPoint([]));
  events?.onPlayerPositioned?.(spawnCallbacks.getInwardSpawnYaw(playerPos));

  const exclude: THREE.Vector3[] = [playerPos.clone()];
  mainAi.pos.copy(spawnCallbacks.getOptimalSpawnPoint(exclude));
  mainAi.yaw = spawnCallbacks.getInwardSpawnYaw(mainAi.pos);
  exclude.push(mainAi.pos.clone());

  roster.forEach((bot, id) => {
    if (id === MAIN_AI_ID) return;
    const spawnPos = spawnCallbacks.getOptimalSpawnPoint(exclude);
    bot.pos.copy(spawnPos);
    bot.yaw = spawnCallbacks.getInwardSpawnYaw(spawnPos);
    exclude.push(spawnPos.clone());
    events?.onBotSpawned?.(id, bot);
  });

  applyRosterSlotConfigToCombatants(roster, settings, legacy, events);
  events?.onRosterLayoutChanged?.(1 + offlineBotCount);
}

/**
 * Per-frame offline orchestrator: roster lifecycle, config distribution, bot coordination tick.
 * Never mutates remote-human entries.
 */
export function tickAIOrchestrator(
  input: AIOrchestratorInput,
  dt: number,
  spawnCallbacks: AIOrchestratorSpawnCallbacks,
  events?: AIOrchestratorEvents
): AIOrchestratorTickResult {
  const { roster, settings, legacy, offlineBotCount, playerPos, isPlaying, coordinator } = input;

  if (!isPlaying) {
    return { rosterChanged: false, totalCombatants: 1 + offlineBotCount };
  }

  let rosterChanged = false;

  const mainAiBefore = getMainAI(roster);
  const mainAi = ensureMainAIInRoster(roster, {
    settings,
    legacy,
    spawnPos: mainAiBefore?.pos ?? new THREE.Vector3(0, 0, -12),
    yaw: mainAiBefore?.yaw ?? 0,
    hue: legacy.botColors?.[MAIN_AI_ID] ?? mainAiBefore?.hue ?? 0,
    difficulty: legacy.botDifficulties?.[MAIN_AI_ID] || mainAiBefore?.difficulty || 'normal',
  });
  if (!mainAiBefore) {
    events?.onMainAICreated?.(mainAi);
    rosterChanged = true;
  }

  const layoutChanged = syncOfflineBotSlots(
    { roster, settings, legacy, offlineBotCount, playerPos },
    spawnCallbacks,
    events
  );
  if (layoutChanged) {
    rosterChanged = true;
    events?.onRosterLayoutChanged?.(1 + offlineBotCount);
  }

  if (applyRosterSlotConfigToCombatants(roster, settings, legacy, events)) {
    rosterChanged = true;
  }

  tickBotCoordinator(coordinator, dt);
  clearBotEngagements(coordinator);

  return { rosterChanged, totalCombatants: 1 + offlineBotCount };
}
