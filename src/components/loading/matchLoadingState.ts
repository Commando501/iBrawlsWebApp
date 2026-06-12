import {
  type GameLoadingState,
  INITIAL_GAME_LOADING_STATE,
  type MatchLoadingRole,
  type MultiplayerLoadingParticipant,
  type MultiplayerLoadingSlotPayload,
  type MultiplayerLoadingSnapshot,
  type MultiplayerLoadingStatusPayload,
} from './loadingTypes';
import type { CharacterLoadout } from '../VoxelModels';
import { normalizeVisualModelPolicy, type VisualModelPolicy } from '../../model/modelSystem';
import { sanitizeCharacterLoadoutForNetwork } from '../customArmor';

export const MATCH_LOADING_TIMEOUT_MS = 45_000;

export function clampLoadingProgress(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

export function createInitialGameLoadingState(stage = 'Preparing match'): GameLoadingState {
  return {
    ...INITIAL_GAME_LOADING_STATE,
    visible: true,
    progress: 0,
    stage,
    ready: false,
  };
}

export function normalizeLoadingRole(role: unknown): MatchLoadingRole {
  if (role === 'host' || role === 'client' || role === 'observer') return role;
  return 'client';
}

export function getParticipantDisplayName(value: unknown, fallbackId: string): string {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed.length > 0) return trimmed;
  }
  return fallbackId ? `Client ${fallbackId}` : 'Player';
}

function normalizeLoadout(loadout: unknown): CharacterLoadout | undefined {
  return sanitizeCharacterLoadoutForNetwork(loadout) as CharacterLoadout | undefined;
}

function normalizeParticipantPolicy(value: unknown): VisualModelPolicy | undefined {
  if (value === undefined || value === null) return undefined;
  return normalizeVisualModelPolicy(value);
}

export function upsertLoadingSlot(
  roster: Record<string, MultiplayerLoadingParticipant>,
  slot: MultiplayerLoadingSlotPayload,
  now: number
): Record<string, MultiplayerLoadingParticipant> {
  if (!slot.clientId) return roster;
  const existing = roster[slot.clientId];
  return {
    ...roster,
    [slot.clientId]: {
      clientId: slot.clientId,
      role: normalizeLoadingRole(slot.role),
      spawnSlot: slot.spawnSlot,
      playerName: getParticipantDisplayName(slot.playerName, slot.clientId),
      hue: typeof slot.hue === 'number' && Number.isFinite(slot.hue) ? slot.hue : existing?.hue ?? 200,
      loadout: normalizeLoadout(slot.loadout) ?? existing?.loadout,
      visualModelPolicy: normalizeParticipantPolicy(slot.visualModelPolicy) ?? existing?.visualModelPolicy,
      progress: existing?.progress ?? 0,
      stage: existing?.stage ?? 'Waiting',
      ready: existing?.ready ?? false,
      timedOut: existing?.timedOut ?? false,
      lastUpdatedAt: existing?.lastUpdatedAt ?? now,
    },
  };
}

export function upsertLoadingSlots(
  roster: Record<string, MultiplayerLoadingParticipant>,
  slots: MultiplayerLoadingSlotPayload[] | undefined,
  now: number
): Record<string, MultiplayerLoadingParticipant> {
  if (!Array.isArray(slots)) return roster;
  return slots.reduce((next, slot) => upsertLoadingSlot(next, slot, now), roster);
}

export function upsertLoadingStatus(
  roster: Record<string, MultiplayerLoadingParticipant>,
  status: MultiplayerLoadingStatusPayload,
  fallbackClientId: string | undefined,
  now: number
): Record<string, MultiplayerLoadingParticipant> {
  const clientId = status.clientId || fallbackClientId;
  if (!clientId) return roster;
  const existing = roster[clientId];
  const progress = clampLoadingProgress(status.progress ?? existing?.progress ?? 0);
  return {
    ...roster,
    [clientId]: {
      clientId,
      role: normalizeLoadingRole(status.role ?? existing?.role),
      spawnSlot: status.spawnSlot ?? existing?.spawnSlot,
      playerName: getParticipantDisplayName(status.playerName ?? existing?.playerName, clientId),
      hue: typeof status.hue === 'number' && Number.isFinite(status.hue) ? status.hue : existing?.hue ?? 200,
      loadout: normalizeLoadout(status.loadout) ?? existing?.loadout,
      visualModelPolicy: normalizeParticipantPolicy(status.visualModelPolicy) ?? existing?.visualModelPolicy,
      progress,
      stage: status.stage || existing?.stage || 'Loading',
      ready: Boolean(status.ready) || progress >= 100,
      timedOut: false,
      lastUpdatedAt: now,
    },
  };
}

export function removeLoadingParticipant(
  roster: Record<string, MultiplayerLoadingParticipant>,
  clientId: string | undefined
): Record<string, MultiplayerLoadingParticipant> {
  if (!clientId || !roster[clientId]) return roster;
  const next = { ...roster };
  delete next[clientId];
  return next;
}

export function deriveMultiplayerLoadingSnapshot(
  roster: Record<string, MultiplayerLoadingParticipant>,
  now: number,
  timeoutMs = MATCH_LOADING_TIMEOUT_MS
): MultiplayerLoadingSnapshot {
  const participants = Object.values(roster)
    .map((participant) => ({
      ...participant,
      timedOut: participant.timedOut || (!participant.ready && now - participant.lastUpdatedAt > timeoutMs),
    }))
    .sort((a, b) => {
      const roleOrder = { host: 0, client: 1, observer: 2 };
      const roleDelta = roleOrder[a.role] - roleOrder[b.role];
      if (roleDelta !== 0) return roleDelta;
      const spawnDelta = (a.spawnSlot ?? 999) - (b.spawnSlot ?? 999);
      if (spawnDelta !== 0) return spawnDelta;
      return a.playerName.localeCompare(b.playerName);
    });
  const waitingCount = participants.filter((participant) => !participant.ready && !participant.timedOut).length;
  return {
    participants,
    waitingCount,
    gateReleased: participants.length > 0 && waitingCount === 0,
  };
}
