import {
  type Combatant,
  type DeathEvent,
  type MedalInfo,
  type ReplayFile,
  type ReplayHeatmapEvent,
  type ReplayHeatmapTeam,
  type TeamId,
} from '../../types';
import { type GrifballRuntimeState } from './runtimeState';

type MutableRef<T> = { current: T };

type PositionXZSource = {
  x?: number;
  z?: number;
};

export interface ReplayHeatmapCombatantSource {
  id: string;
  team?: TeamId | null;
  pos?: PositionXZSource | null;
}

export interface QueueReplayHeatmapDeathOptions {
  state: GrifballRuntimeState;
  attacker: ReplayHeatmapCombatantSource;
  victim: ReplayHeatmapCombatantSource;
  weapon?: DeathEvent['weapon'];
}

export interface QueueReplayHeatmapMedalOptions {
  state: GrifballRuntimeState;
  actor?: ReplayHeatmapCombatantSource | null;
  medals: MedalInfo[];
}

export function getReplayHeatmapTeam(team?: TeamId | null): ReplayHeatmapTeam {
  return typeof team === 'string' && team.trim().length > 0 ? team : 'unknown';
}

export function getReplayHeatmapPosition(pos?: PositionXZSource | null): { x: number; z: number } | null {
  const x = pos?.x;
  const z = pos?.z;
  if (!Number.isFinite(x) || !Number.isFinite(z)) return null;
  return { x: x as number, z: z as number };
}

export function ensureReplayHeatmapData(replay: ReplayFile): NonNullable<ReplayFile['heatmap']> {
  if (!replay.heatmap) {
    replay.heatmap = { version: 1, events: [] };
  }
  return replay.heatmap;
}

export function createReplayHeatmapCombatantSource(
  id: string,
  combatant: Combatant | undefined,
  fallback?: { team?: TeamId | null; pos?: PositionXZSource | null }
): ReplayHeatmapCombatantSource {
  return {
    id,
    team: combatant?.team ?? fallback?.team ?? null,
    pos: combatant?.pos ?? fallback?.pos ?? null,
  };
}

function nextHeatmapEventId(): string {
  return Math.random().toString(36).substring(2, 10);
}

export function queueReplayHeatmapDeathEventsForState({
  state,
  attacker,
  victim,
  weapon,
}: QueueReplayHeatmapDeathOptions): ReplayHeatmapEvent[] {
  if (!state.replayHeatmapRecordingActive) return [];

  const attackerPos = getReplayHeatmapPosition(attacker.pos);
  const victimPos = getReplayHeatmapPosition(victim.pos);
  const events: ReplayHeatmapEvent[] = [];

  if (attackerPos) {
    events.push({
      id: nextHeatmapEventId(),
      kind: 'kill',
      time: state.replayHeatmapElapsedTime,
      actorId: attacker.id,
      victimId: victim.id,
      team: getReplayHeatmapTeam(attacker.team),
      position: attackerPos,
      weapon,
    });
  }

  if (victimPos) {
    events.push({
      id: nextHeatmapEventId(),
      kind: 'death',
      time: state.replayHeatmapElapsedTime,
      actorId: victim.id,
      victimId: attacker.id,
      team: getReplayHeatmapTeam(victim.team),
      position: victimPos,
      weapon,
    });
  }

  state.pendingReplayHeatmapEvents.push(...events);
  return events;
}

export function queueReplayHeatmapMedalEventsForState({
  state,
  actor,
  medals,
}: QueueReplayHeatmapMedalOptions): ReplayHeatmapEvent[] {
  if (!state.replayHeatmapRecordingActive || medals.length === 0) return [];

  const position = getReplayHeatmapPosition(actor?.pos ?? state.playerPos);
  if (!position) return [];

  const actorId = actor?.id ?? 'player';
  const team = getReplayHeatmapTeam(actor?.team ?? state.localPlayerTeam);
  const events = medals.map((medal): ReplayHeatmapEvent => ({
    id: nextHeatmapEventId(),
    kind: 'medal',
    time: state.replayHeatmapElapsedTime,
    actorId,
    team,
    position,
    medalId: medal.id,
    medalName: medal.name,
    medalColor: medal.color,
  }));

  state.pendingReplayHeatmapEvents.push(...events);
  return events;
}

export function flushReplayHeatmapEventsForState({
  state,
  replayRecordingRef,
}: {
  state: GrifballRuntimeState;
  replayRecordingRef: MutableRef<ReplayFile | null>;
}): void {
  const replay = replayRecordingRef.current;
  if (!replay || state.pendingReplayHeatmapEvents.length === 0) return;

  const heatmap = ensureReplayHeatmapData(replay);
  heatmap.events.push(...state.pendingReplayHeatmapEvents);
  state.pendingReplayHeatmapEvents = [];
}
