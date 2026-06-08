import React from 'react';
import type { CustomMapData, ReplayFile } from '../../types';
import type { CharacterLoadout } from '../VoxelModels';
import { TopDownMapPreview } from './TopDownMapPreview';
import { PlayerModelPreview } from './PlayerModelPreview';
import {
  type GameLoadingState,
  type MatchLoadingMode,
  type MultiplayerLoadingParticipant,
} from './loadingTypes';

interface MatchLoadingOverlayProps {
  mode: MatchLoadingMode;
  loadingState: GameLoadingState;
  selectedMap: string;
  customMap?: CustomMapData | null;
  replayData?: ReplayFile | null;
  playerName: string;
  playerHue: number;
  playerLoadout?: CharacterLoadout;
  participants?: MultiplayerLoadingParticipant[];
  waitingCount?: number;
}

const roleLabel: Record<string, string> = {
  host: 'Host',
  client: 'Player',
  observer: 'Observer',
};

function DashedProgressBar({ progress, timedOut }: { progress: number; timedOut?: boolean }) {
  const pct = Math.max(0, Math.min(100, Math.round(progress)));
  const fillColor = timedOut ? '#f59e0b' : '#22d3ee';
  return (
    <div className="relative h-3 overflow-hidden rounded border border-white/10 bg-black/55">
      <div
        className="absolute inset-y-0 left-0 transition-[width] duration-300"
        style={{
          width: `${pct}%`,
          backgroundImage: `repeating-linear-gradient(90deg, ${fillColor} 0 10px, transparent 10px 15px)`,
          filter: `drop-shadow(0 0 8px ${fillColor})`,
        }}
      />
      <div className="absolute inset-0 bg-gradient-to-b from-white/20 to-transparent opacity-50" />
    </div>
  );
}

function LoadingRoster({
  participants,
  waitingCount,
}: {
  participants: MultiplayerLoadingParticipant[];
  waitingCount?: number;
}) {
  return (
    <div className="min-h-0 rounded border border-cyan-400/20 bg-slate-950/80 shadow-[0_16px_50px_rgba(0,0,0,0.35)]">
      <div className="flex items-center justify-between gap-3 border-b border-white/10 px-4 py-3">
        <div>
          <p className="text-[10px] font-black uppercase tracking-[0.24em] text-cyan-300">Fireteam Load Sync</p>
          <p className="text-[10px] font-mono text-white/45">
            {waitingCount && waitingCount > 0 ? `${waitingCount} waiting` : 'Ready gate clear'}
          </p>
        </div>
        <span className="rounded border border-white/10 bg-white/5 px-2.5 py-1 text-[10px] font-mono font-black text-white/70">
          {participants.length}
        </span>
      </div>
      <div className="grid max-h-[42dvh] gap-2 overflow-y-auto p-3 sm:max-h-[54dvh]">
        {participants.map((participant) => (
          <div
            key={participant.clientId}
            className="grid grid-cols-[64px_minmax(0,1fr)] items-center gap-3 rounded border border-white/10 bg-white/[0.035] p-2"
          >
            <PlayerModelPreview
              hue={participant.hue}
              loadout={participant.loadout}
              className="h-16 w-16"
            />
            <div className="min-w-0">
              <div className="mb-1.5 flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-xs font-black uppercase tracking-[0.12em] text-white">
                    {participant.playerName}
                  </p>
                  <p className="text-[9px] font-mono uppercase tracking-[0.18em] text-white/45">
                    {roleLabel[participant.role] ?? participant.role}
                    {participant.spawnSlot !== undefined ? ` / Slot ${participant.spawnSlot}` : ''}
                  </p>
                </div>
                <span className={`shrink-0 text-xs font-mono font-black ${participant.timedOut ? 'text-amber-300' : participant.ready ? 'text-emerald-300' : 'text-cyan-200'}`}>
                  {participant.timedOut ? 'TIMEOUT' : `${Math.round(participant.progress)}%`}
                </span>
              </div>
              <DashedProgressBar progress={participant.timedOut ? 100 : participant.progress} timedOut={participant.timedOut} />
              <p className="mt-1 truncate text-[10px] font-mono text-white/45">{participant.timedOut ? 'Proceeding with fallback readiness' : participant.stage}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export const MatchLoadingOverlay: React.FC<MatchLoadingOverlayProps> = ({
  mode,
  loadingState,
  selectedMap,
  customMap,
  replayData,
  playerName,
  playerHue,
  playerLoadout,
  participants = [],
  waitingCount,
}) => {
  const progress = Math.max(0, Math.min(100, Math.round(loadingState.progress)));
  const isMultiplayer = mode === 'multiplayer';
  const title = mode === 'replay' ? 'Loading Theater Replay' : isMultiplayer ? 'Synchronizing Match Load' : 'Loading Match';

  return (
    <div className="fixed inset-0 z-[1400] flex items-center justify-center bg-slate-950/95 px-4 py-5 text-white backdrop-blur-xl">
      <div className="absolute inset-0 opacity-25" style={{
        backgroundImage: `
          radial-gradient(circle at 50% 45%, rgba(34,211,238,0.16), transparent 34%),
          repeating-linear-gradient(0deg, rgba(148,163,184,0.18) 0 1px, transparent 1px 44px),
          repeating-linear-gradient(90deg, rgba(148,163,184,0.12) 0 1px, transparent 1px 44px)
        `,
      }} />

      <div className="relative grid h-full max-h-[900px] w-full max-w-6xl grid-rows-[auto_minmax(0,1fr)_auto] gap-4">
        <header className="flex flex-wrap items-end justify-between gap-3 border-b border-white/10 pb-3">
          <div>
            <p className="text-[10px] font-black uppercase tracking-[0.32em] text-cyan-300">iBrawls Deployment</p>
            <h2 className="text-2xl font-black uppercase tracking-[0.08em] text-white sm:text-4xl">{title}</h2>
          </div>
          <div className="text-right font-mono">
            <p className="text-4xl font-black tabular-nums text-cyan-200">{progress}%</p>
            <p className="text-[10px] uppercase tracking-[0.2em] text-white/45">{loadingState.ready ? 'Local ready' : 'Local load'}</p>
          </div>
        </header>

        <main className={`grid min-h-0 gap-4 ${isMultiplayer ? 'lg:grid-cols-[minmax(280px,0.9fr)_minmax(420px,1.25fr)]' : 'lg:grid-cols-[minmax(320px,1fr)_minmax(320px,0.75fr)]'}`}>
          <section className="grid min-h-0 grid-rows-[minmax(0,1fr)_auto] gap-3">
            <TopDownMapPreview
              selectedMap={selectedMap}
              customMap={customMap}
              replayData={replayData}
              className="min-h-[220px] w-full"
            />
            <div className="rounded border border-white/10 bg-slate-950/80 p-3">
              <div className="mb-2 flex items-center justify-between gap-3">
                <p className="truncate text-xs font-black uppercase tracking-[0.18em] text-white">{loadingState.stage}</p>
                <p className="font-mono text-xs font-black text-cyan-200 tabular-nums">{progress}%</p>
              </div>
              <DashedProgressBar progress={progress} />
              {loadingState.detail && (
                <p className="mt-2 truncate text-[10px] font-mono text-white/45">{loadingState.detail}</p>
              )}
            </div>
          </section>

          {isMultiplayer ? (
            <LoadingRoster participants={participants} waitingCount={waitingCount} />
          ) : (
            <section className="grid min-h-0 grid-rows-[minmax(0,1fr)_auto] gap-3">
              <PlayerModelPreview hue={playerHue} loadout={playerLoadout} className="min-h-[260px] w-full" />
              <div className="rounded border border-white/10 bg-slate-950/80 p-3">
                <p className="text-[10px] font-mono uppercase tracking-[0.2em] text-white/45">Pilot</p>
                <p className="truncate text-lg font-black uppercase tracking-[0.12em] text-white">{playerName || 'Spartan'}</p>
              </div>
            </section>
          )}
        </main>

        <footer className="flex items-center justify-between gap-3 border-t border-white/10 pt-3 text-[10px] font-mono uppercase tracking-[0.2em] text-white/40">
          <span>{isMultiplayer ? 'Waiting for synchronized readiness' : 'Preparing render pipeline'}</span>
          <span>{selectedMap}</span>
        </footer>
      </div>
    </div>
  );
};
