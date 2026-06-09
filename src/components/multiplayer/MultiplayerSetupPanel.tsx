import { useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent, type KeyboardEvent } from 'react';
import { MessageSquare, Send } from 'lucide-react';
import type { CustomMapData, UniversalSettings } from '../../types';
import { PREMADE_MAPS } from '../../game/premadeMaps';
import {
  DEFAULT_GRIFBALL_GOAL_TARGET,
  DEFAULT_IBRAWLS_KILL_TARGET,
  DEFAULT_MATCH_TIMER_SECONDS,
  MAX_MATCH_LOBBY_PLAYERS,
  formatMatchTimerLabel,
  getDefaultWinTargetForMode,
  getMatchLobbyModeLabel,
  getMatchLobbyTargetLabel,
  normalizeMatchLobbyConfig,
} from '../../network/matchLobbyConfig';
import type {
  MatchLobbyAccess,
  MatchLobbyConfig,
  MatchLobbyGameMode,
} from '../../network/protocol';
import type { ChatMessage } from '../ChatOverlay';
import type { MultiplayerLoadingSlotPayload } from '../loading/loadingTypes';
import type { GameplayConnectionMode, GameplayConnectionStatus, GameplayMultiplayerRole } from './multiplayerConnectionConstants';

type QuickPlayStatus = 'idle' | 'searching' | 'matching';

interface MultiplayerSetupPanelProps {
  connectionMode: GameplayConnectionMode;
  onConnectionModeChange: (mode: GameplayConnectionMode) => void;
  isOnline: boolean;
  userIp: string;
  lanIp: string;
  hostIdCode: string;
  connectionStatus: GameplayConnectionStatus;
  connectionError: string;
  quickPlayStatus: QuickPlayStatus;
  adminSettings: UniversalSettings;
  selectedMap: string;
  onSelectedMapChange: (value: string) => void;
  lobbyCustomMapData: CustomMapData | null;
  onCustomMapDataChange: (value: CustomMapData | null) => void;
  matchLobbyConfig: MatchLobbyConfig | null;
  multiplayerRole: GameplayMultiplayerRole;
  multiplayerSocket: WebSocket | null;
  multiplayerPlayerCount: number;
  lobbyParticipants: MultiplayerLoadingSlotPayload[];
  chatMessages: ChatMessage[];
  joinIpOrId: string;
  onJoinIpOrIdChange: (value: string) => void;
  customUrlInput: string;
  onCustomUrlInputChange: (value: string) => void;
  onCancelHostOrJoin: () => void;
  onCancelQuickPlay: () => void;
  onQuickPlay: () => void;
  onHostGame: (config: MatchLobbyConfig, password?: string) => void;
  onStartHostedMatch: () => void;
  onSendChatMessage: (text: string) => void;
  onJoinGame: (target: string, isObserver?: boolean, password?: string, inviteToken?: string) => void;
  onApplyMatchmakerUrl: () => void;
  onResetMatchmakerUrl: () => void;
}

const toMinutes = (seconds: number): number => Math.max(1, Math.round(seconds / 60));

export function MultiplayerSetupPanel({
  connectionMode,
  onConnectionModeChange,
  isOnline,
  userIp,
  lanIp,
  hostIdCode,
  connectionStatus,
  connectionError,
  quickPlayStatus,
  adminSettings,
  selectedMap,
  onSelectedMapChange,
  lobbyCustomMapData,
  onCustomMapDataChange,
  matchLobbyConfig,
  multiplayerRole,
  multiplayerSocket,
  multiplayerPlayerCount,
  lobbyParticipants,
  chatMessages,
  joinIpOrId,
  onJoinIpOrIdChange,
  customUrlInput,
  onCustomUrlInputChange,
  onCancelHostOrJoin,
  onCancelQuickPlay,
  onQuickPlay,
  onHostGame,
  onStartHostedMatch,
  onSendChatMessage,
  onJoinGame,
  onApplyMatchmakerUrl,
  onResetMatchmakerUrl,
}: MultiplayerSetupPanelProps) {
  const [access, setAccess] = useState<MatchLobbyAccess>('open');
  const [password, setPassword] = useState('');
  const [gameMode, setGameMode] = useState<MatchLobbyGameMode>(adminSettings.gameMode ?? 'sandbox');
  const [maxPlayers, setMaxPlayers] = useState(MAX_MATCH_LOBBY_PLAYERS);
  const [allowObservers, setAllowObservers] = useState(true);
  const [matchTimerMinutes, setMatchTimerMinutes] = useState(toMinutes(adminSettings.matchTimerSeconds ?? DEFAULT_MATCH_TIMER_SECONDS));
  const [winTarget, setWinTarget] = useState(
    gameMode === 'grifball'
      ? adminSettings.grifballGoalTarget ?? DEFAULT_GRIFBALL_GOAL_TARGET
      : adminSettings.iBrawlsKillTarget ?? DEFAULT_IBRAWLS_KILL_TARGET
  );
  const [joinPasswordInput, setJoinPasswordInput] = useState('');

  useEffect(() => {
    setWinTarget(getDefaultWinTargetForMode(gameMode));
  }, [gameMode]);

  const selectedPremadeMap = PREMADE_MAPS.find(map => map.id === selectedMap);
  const activeConfig = useMemo(() => normalizeMatchLobbyConfig({
    access,
    gameMode,
    selectedMap,
    customMap: selectedMap === 'custom_file' ? lobbyCustomMapData : null,
    maxPlayers,
    allowObservers,
    matchTimerSeconds: matchTimerMinutes * 60,
    winTarget,
  }), [
    access,
    gameMode,
    selectedMap,
    lobbyCustomMapData,
    maxPlayers,
    allowObservers,
    matchTimerMinutes,
    winTarget,
  ]);
  const stagedConfig = matchLobbyConfig ?? activeConfig;
  const isStaging = Boolean(multiplayerSocket && matchLobbyConfig && (connectionStatus === 'hosting' || connectionStatus === 'connected'));
  const canCreateLobby = access !== 'password' || password.trim().length > 0;
  const canStartMatch = multiplayerRole === 'host' && multiplayerSocket?.readyState === WebSocket.OPEN;

  const handleJoinKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      onJoinGame(joinIpOrId, false, joinPasswordInput || undefined);
    }
  };

  const handleCustomMapFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text()) as CustomMapData;
      onCustomMapDataChange(parsed);
      onSelectedMapChange('custom_file');
    } catch {
      onCustomMapDataChange(null);
    }
  };

  const participantRows = lobbyParticipants.length > 0
    ? lobbyParticipants
    : [{
        clientId: 'host',
        role: multiplayerRole || 'host',
        spawnSlot: 0,
      } satisfies MultiplayerLoadingSlotPayload];

  if (isStaging) {
    return (
      <div className="flex flex-col h-full min-h-0 gap-4">
        <PanelTitle title="Lobby Staging" />

        <div className="bg-emerald-500/10 border border-emerald-500/25 rounded-lg p-3.5 flex flex-col gap-3">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[10px] text-emerald-300 font-black uppercase tracking-widest">Room Code</p>
              <p className="font-mono text-xl text-white font-black tracking-widest">{hostIdCode}</p>
            </div>
            <span className="shrink-0 text-[10px] text-white/45 uppercase tracking-wider">
              {multiplayerPlayerCount}/{stagedConfig.maxPlayers} players
            </span>
          </div>

          <div className="grid grid-cols-2 gap-2 text-[10px] font-mono">
            <LobbyStat label="Mode" value={getMatchLobbyModeLabel(stagedConfig.gameMode)} />
            <LobbyStat label="Access" value={stagedConfig.access === 'password' ? 'Password' : stagedConfig.access} />
            <LobbyStat label="Map" value={stagedConfig.customMap?.name || selectedPremadeMap?.name || stagedConfig.selectedMap} />
            <LobbyStat label="Timer" value={formatMatchTimerLabel(stagedConfig.matchTimerSeconds)} />
            <LobbyStat label="Target" value={getMatchLobbyTargetLabel(stagedConfig)} />
            <LobbyStat label="Observers" value={stagedConfig.allowObservers ? 'Allowed' : 'Off'} />
          </div>
        </div>

        <div className="bg-black/35 border border-white/5 rounded-lg p-3 min-h-0 flex flex-col gap-2">
          <p className="text-[10px] text-[#38bdf8] font-black uppercase tracking-widest">Participants</p>
          <div className="min-h-0 max-h-44 overflow-y-auto flex flex-col gap-1.5 pr-1">
            {participantRows.map((participant) => (
              <div key={`${participant.clientId}-${participant.role}`} className="flex items-center justify-between gap-2 bg-white/[0.04] border border-white/5 rounded px-2.5 py-2">
                <span className="text-xs text-white/80 truncate">
                  {participant.playerName || participant.clientId}
                </span>
                <span className="text-[9px] text-white/40 uppercase tracking-widest">
                  {participant.role}{participant.spawnSlot !== undefined ? ` ${participant.spawnSlot + 1}` : ''}
                </span>
              </div>
            ))}
          </div>
        </div>

        <MatchLobbyChatBox
          messages={chatMessages}
          onSendMessage={onSendChatMessage}
          canSend={multiplayerSocket?.readyState === WebSocket.OPEN}
        />

        <div className="flex gap-2 mt-auto">
          <button
            type="button"
            onClick={onStartHostedMatch}
            disabled={!canStartMatch}
            className={`flex-1 h-12 rounded font-black text-xs uppercase tracking-widest border transition-all ${
              canStartMatch
                ? 'bg-emerald-500 hover:bg-emerald-400 border-emerald-300/40 text-slate-950 cursor-pointer'
                : 'bg-white/5 border-white/5 text-white/25 cursor-not-allowed'
            }`}
          >
            Start Match
          </button>
          <button
            type="button"
            onClick={onCancelHostOrJoin}
            className="h-12 px-4 rounded border border-white/10 bg-white/5 hover:bg-white/10 text-white/70 font-black text-xs uppercase tracking-widest cursor-pointer"
          >
            Leave
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full min-h-0 justify-between gap-4">
      <div className="flex flex-col gap-3 shrink-0">
        <PanelTitle title="Multiplayer Setup" />

        <div className="flex bg-black/40 p-1.5 rounded-lg border border-white/5 gap-2 select-none shadow-[inset_0_1px_3px_rgba(0,0,0,0.3)]">
          <button
            type="button"
            onClick={() => onConnectionModeChange('relay')}
            className={`flex-1 py-2 text-xs font-black uppercase tracking-wider rounded transition-all cursor-pointer text-center ${
              connectionMode === 'relay'
                ? 'bg-gradient-to-r from-sky-600 to-indigo-600 text-white shadow-md'
                : 'text-white/40 hover:text-white/70'
            }`}
          >
            Cloud Relay
          </button>
          <button
            type="button"
            onClick={() => onConnectionModeChange('local')}
            className={`flex-1 py-2 text-xs font-black uppercase tracking-wider rounded transition-all cursor-pointer text-center ${
              connectionMode === 'local'
                ? 'bg-gradient-to-r from-emerald-600 to-teal-600 text-white shadow-md'
                : 'text-white/40 hover:text-white/70'
            }`}
          >
            Local LAN IP
          </button>
        </div>

        {!isOnline && (
          <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-3 text-left">
            <p className="text-xs font-black uppercase tracking-widest text-amber-300">Offline Mode</p>
            <p className="mt-1 text-xs text-white/60 leading-relaxed">
              Multiplayer, matchmaker chat, invites, and public IP discovery will reconnect when the network is back.
            </p>
          </div>
        )}

        <div className={`p-3 rounded-lg border text-xs ${connectionMode === 'relay' ? 'bg-sky-500/5 border-sky-500/20' : 'bg-white/5 border-white/10'}`}>
          <p className="text-[11px] text-[#38bdf8] font-bold uppercase tracking-wider mb-2">Connection Coordinates</p>
          <div className="flex flex-col gap-1.5 font-mono text-xs font-semibold">
            <CoordinateRow label={connectionMode === 'relay' ? 'Relay' : 'Web/Host IP'} value={connectionMode === 'relay' ? 'ONLINE' : userIp} />
            {connectionMode === 'local' && lanIp && lanIp !== '127.0.0.1' && (
              <CoordinateRow label="LAN IP" value={lanIp} />
            )}
            <CoordinateRow label="Room Code" value={hostIdCode} />
          </div>
        </div>

        {(connectionStatus === 'idle' || connectionStatus === 'error' || connectionStatus === 'fetching_ip') && quickPlayStatus === 'idle' && (
          <div className="flex flex-col gap-3">
            <button
              type="button"
              onClick={onQuickPlay}
              className="w-full h-12 bg-gradient-to-r from-sky-400 via-indigo-400 to-purple-500 hover:from-sky-500 hover:to-purple-600 text-slate-950 hover:text-white font-sans font-black text-xs uppercase tracking-[0.18em] transition-all rounded shadow-lg shadow-sky-500/25 border border-sky-300/30 cursor-pointer"
            >
              Quick Play Matchmaking
            </button>

            <div className="bg-white/5 border border-white/5 rounded-lg p-3 flex flex-col gap-3">
              <div className="grid grid-cols-3 gap-1.5">
                {(['open', 'private', 'password'] as const).map((option) => (
                  <button
                    key={option}
                    type="button"
                    onClick={() => setAccess(option)}
                    className={`h-9 rounded text-[10px] font-black uppercase tracking-wider border transition-all ${
                      access === option
                        ? 'bg-emerald-500/20 border-emerald-400/45 text-emerald-300'
                        : 'bg-black/30 border-white/10 text-white/45 hover:text-white/70'
                    }`}
                  >
                    {option}
                  </button>
                ))}
              </div>

              {access === 'password' && (
                <input
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="Lobby password"
                  className="w-full h-10 bg-black/60 border border-white/10 rounded px-3 text-xs text-white placeholder:text-white/25 focus:border-emerald-400 outline-none"
                />
              )}

              <div className="grid grid-cols-2 gap-2">
                {(['sandbox', 'grifball'] as const).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => setGameMode(mode)}
                    className={`h-10 rounded text-xs font-black uppercase tracking-wider border transition-all ${
                      gameMode === mode
                        ? 'bg-[#38bdf8]/20 border-[#38bdf8]/45 text-[#7dd3fc]'
                        : 'bg-black/30 border-white/10 text-white/45 hover:text-white/70'
                    }`}
                  >
                    {getMatchLobbyModeLabel(mode)}
                  </button>
                ))}
              </div>

              <label className="flex flex-col gap-1.5">
                <span className="text-[10px] text-white/45 uppercase tracking-widest font-mono">Map</span>
                <select
                  value={selectedMap}
                  onChange={(event) => onSelectedMapChange(event.target.value)}
                  className="h-10 bg-black/60 border border-white/10 rounded px-3 text-xs text-cyan-300 font-bold uppercase outline-none focus:border-cyan-400"
                >
                  <option value="hangar">Industrial Hangar</option>
                  <option value="circle">Circle Arena</option>
                  {PREMADE_MAPS.map((map) => (
                    <option key={map.id} value={map.id}>{map.name}</option>
                  ))}
                  <option value="custom_file">Custom Map JSON</option>
                </select>
              </label>

              {selectedMap === 'custom_file' && (
                <label className="h-9 bg-cyan-500/10 hover:bg-cyan-500/20 border border-cyan-500/30 text-cyan-400 font-mono text-[10px] font-bold uppercase tracking-wider rounded flex items-center justify-center cursor-pointer transition-all">
                  {lobbyCustomMapData?.name || 'Select Map JSON'}
                  <input type="file" accept=".json" className="hidden" onChange={handleCustomMapFileChange} />
                </label>
              )}

              <div className="grid grid-cols-2 gap-2">
                <NumberField label="Players" min={1} max={MAX_MATCH_LOBBY_PLAYERS} value={maxPlayers} onChange={setMaxPlayers} />
                <NumberField label="Timer Min" min={1} max={60} value={matchTimerMinutes} onChange={setMatchTimerMinutes} />
                <NumberField label={gameMode === 'grifball' ? 'Goals To Win' : 'Kills To Win'} min={1} max={100} value={winTarget} onChange={setWinTarget} />
                <label className="flex items-center justify-between gap-2 bg-black/35 border border-white/10 rounded px-3">
                  <span className="text-[10px] text-white/45 uppercase tracking-widest font-mono">Observers</span>
                  <input
                    type="checkbox"
                    checked={allowObservers}
                    onChange={(event) => setAllowObservers(event.target.checked)}
                    className="accent-emerald-400"
                  />
                </label>
              </div>

              <button
                type="button"
                onClick={() => onHostGame(activeConfig, password.trim() || undefined)}
                disabled={!canCreateLobby}
                className={`w-full h-12 rounded font-black text-xs uppercase tracking-widest border transition-all ${
                  canCreateLobby
                    ? 'bg-white hover:bg-emerald-500 text-slate-900 hover:text-white border-white/10 cursor-pointer'
                    : 'bg-white/5 text-white/25 border-white/5 cursor-not-allowed'
                }`}
              >
                Create Lobby
              </button>
            </div>

            <div className="flex gap-2">
              <input
                type="text"
                value={joinIpOrId}
                onChange={(event) => onJoinIpOrIdChange(event.target.value)}
                onKeyDown={handleJoinKeyDown}
                placeholder="Room Code or IP..."
                className="flex-1 h-11 bg-black/60 border border-white/10 rounded px-3 text-center font-mono text-xs tracking-wide text-[#38bdf8] placeholder:text-white/20 focus:border-[#38bdf8] outline-none"
              />
              <input
                type="password"
                value={joinPasswordInput}
                onChange={(event) => setJoinPasswordInput(event.target.value)}
                placeholder="Password"
                className="w-24 h-11 bg-black/60 border border-white/10 rounded px-2 text-center font-mono text-xs text-white placeholder:text-white/20 focus:border-[#38bdf8] outline-none"
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => onJoinGame(joinIpOrId, false, joinPasswordInput || undefined)}
                disabled={!joinIpOrId}
                className={`h-10 font-black text-xs uppercase tracking-widest rounded border ${
                  joinIpOrId
                    ? 'bg-[#38bdf8]/15 hover:bg-[#38bdf8]/35 border-[#38bdf8]/50 text-[#38bdf8] cursor-pointer'
                    : 'bg-white/5 border-white/5 text-white/20 cursor-not-allowed'
                }`}
              >
                Join
              </button>
              <button
                type="button"
                onClick={() => onJoinGame(joinIpOrId, true, joinPasswordInput || undefined)}
                disabled={!joinIpOrId}
                className={`h-10 font-black text-xs uppercase tracking-widest rounded border ${
                  joinIpOrId
                    ? 'bg-amber-500/10 hover:bg-amber-500/30 border-amber-500/50 text-amber-400 cursor-pointer'
                    : 'bg-white/5 border-white/5 text-white/20 cursor-not-allowed'
                }`}
              >
                Observe
              </button>
            </div>
          </div>
        )}

        {connectionStatus === 'connecting' && <StatusCard title="Connecting Protocol" body="Attaching to host lobby..." onCancel={onCancelHostOrJoin} />}
        {quickPlayStatus === 'searching' && <StatusCard title="Searching for Match" body="Scanning open public lobbies." onCancel={onCancelQuickPlay} />}
        {quickPlayStatus === 'matching' && <StatusCard title="Match Found" body="Configuring arena host credentials..." />}
        {connectionStatus === 'error' && (
          <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-2.5 text-center">
            <p className="text-xs text-red-400 font-black uppercase tracking-wider mb-0.5">Sync Timeout</p>
            <p className="text-xs text-white/70">{connectionError || 'Connection failed.'}</p>
          </div>
        )}
      </div>

      <details className="group mt-auto border-t border-white/5 pt-3">
        <summary className="flex justify-between items-center text-xs text-[#38bdf8] font-bold uppercase tracking-wider cursor-pointer select-none hover:text-white transition-colors">
          <span>Advanced Settings</span>
          <span className="text-[10px] transition-transform group-open:rotate-180 font-sans">v</span>
        </summary>

        <div className="flex flex-col gap-2.5 mt-2.5 bg-black/30 p-3 rounded border border-white/5">
          <label className="text-[10px] text-white/50 uppercase tracking-widest font-mono">Matchmaker Server URL</label>
          <input
            type="text"
            value={customUrlInput}
            onChange={(event) => onCustomUrlInputChange(event.target.value)}
            placeholder="wss://..."
            className="w-full h-10 bg-black/60 border border-white/10 rounded px-2.5 font-mono text-xs tracking-wide text-white focus:border-[#38bdf8] outline-none"
          />
          <div className="flex gap-2.5">
            <button type="button" onClick={onApplyMatchmakerUrl} className="flex-1 h-9 bg-[#38bdf8] hover:bg-[#38bdf8]/80 text-slate-950 font-black text-xs uppercase tracking-wider rounded cursor-pointer">
              Apply
            </button>
            <button type="button" onClick={onResetMatchmakerUrl} className="h-9 px-3 bg-white/5 hover:bg-white/10 text-white/60 hover:text-white border border-white/10 rounded text-xs font-bold uppercase tracking-wider cursor-pointer">
              Reset
            </button>
          </div>
        </div>
      </details>
    </div>
  );
}

function MatchLobbyChatBox({
  messages,
  onSendMessage,
  canSend,
}: {
  messages: ChatMessage[];
  onSendMessage: (text: string) => void;
  canSend: boolean;
}) {
  const [inputText, setInputText] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    const text = inputText.trim();
    if (!text || !canSend) return;
    onSendMessage(text);
    setInputText('');
  };

  return (
    <div className="bg-black/35 border border-white/5 rounded-lg p-3 min-h-[13rem] flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <MessageSquare className="w-3.5 h-3.5 text-cyan-300 shrink-0" />
          <p className="text-[10px] text-[#38bdf8] font-black uppercase tracking-widest truncate">Match Lobby Chat</p>
        </div>
        <span className={`text-[9px] font-black uppercase tracking-widest ${canSend ? 'text-emerald-300' : 'text-white/30'}`}>
          {canSend ? 'Live' : 'Offline'}
        </span>
      </div>

      <div
        ref={scrollRef}
        className="flex-1 min-h-0 max-h-36 overflow-y-auto rounded border border-white/5 bg-black/35 p-2.5 flex flex-col gap-2 scrollbar-thin scrollbar-thumb-white/10"
      >
        {messages.length === 0 ? (
          <p className="m-auto text-center text-[10px] font-mono text-white/30 uppercase tracking-widest italic">
            No lobby messages yet.
          </p>
        ) : (
          messages.map((message) => (
            <div
              key={message.id}
              className={`max-w-[92%] rounded px-2.5 py-2 ${
                message.isLocal
                  ? 'self-end bg-cyan-500/10 border border-cyan-400/15'
                  : 'self-start bg-white/[0.04] border border-white/5'
              }`}
            >
              <div className="flex items-center gap-2 min-w-0">
                <span className={`text-[10px] font-mono font-black truncate ${message.isLocal ? 'text-cyan-300' : 'text-white/55'}`}>
                  {message.sender}
                </span>
                <span className="shrink-0 text-[9px] font-mono text-white/25">{message.timestamp}</span>
              </div>
              <p className="mt-1 text-xs text-white/85 leading-snug break-words">{message.text}</p>
            </div>
          ))
        )}
      </div>

      <form onSubmit={handleSubmit} className="flex items-center gap-2">
        <input
          type="text"
          value={inputText}
          onChange={(event) => setInputText(event.target.value)}
          placeholder={canSend ? 'Message this lobby...' : 'Lobby socket offline'}
          disabled={!canSend}
          maxLength={120}
          autoComplete="off"
          className="min-w-0 flex-1 h-10 bg-black/60 border border-white/10 rounded px-3 text-xs text-white placeholder:text-white/25 focus:border-cyan-400 outline-none disabled:cursor-not-allowed disabled:text-white/25"
        />
        <button
          type="submit"
          disabled={!canSend || !inputText.trim()}
          className={`h-10 w-10 rounded border flex items-center justify-center transition-all ${
            canSend && inputText.trim()
              ? 'bg-cyan-400/15 border-cyan-300/40 text-cyan-200 hover:bg-cyan-400/25 cursor-pointer'
              : 'bg-white/5 border-white/5 text-white/20 cursor-not-allowed'
          }`}
          title="Send lobby message"
        >
          <Send className="w-4 h-4" />
        </button>
      </form>
    </div>
  );
}

function PanelTitle({ title }: { title: string }) {
  return (
    <div className="flex items-center gap-2.5 mb-1">
      <span className="w-2 h-4 bg-[#38bdf8]" />
      <h2 className="text-sm uppercase font-bold tracking-[0.25em] text-white">{title}</h2>
    </div>
  );
}

function CoordinateRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between items-center bg-black/40 px-3 py-1.5 rounded border border-white/5">
      <span className="text-white/45 uppercase text-[10px] font-bold">{label}:</span>
      <span className="text-[#38bdf8] font-black truncate max-w-[9rem]">{value}</span>
    </div>
  );
}

function LobbyStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-black/35 border border-white/5 rounded p-2 min-w-0">
      <p className="text-white/35 uppercase tracking-wider">{label}</p>
      <p className="text-white/85 font-black truncate">{value}</p>
    </div>
  );
}

function NumberField({
  label,
  min,
  max,
  value,
  onChange,
}: {
  label: string;
  min: number;
  max: number;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[10px] text-white/45 uppercase tracking-widest font-mono">{label}</span>
      <input
        type="number"
        min={min}
        max={max}
        value={value}
        onChange={(event) => onChange(Math.max(min, Math.min(max, Number(event.target.value) || min)))}
        className="h-10 bg-black/60 border border-white/10 rounded px-3 text-xs text-white font-bold outline-none focus:border-cyan-400"
      />
    </label>
  );
}

function StatusCard({
  title,
  body,
  onCancel,
}: {
  title: string;
  body: string;
  onCancel?: () => void;
}) {
  return (
    <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-3.5 flex flex-col items-center justify-center text-center gap-1.5">
      <span className="w-2 h-2 rounded-full bg-blue-500 shadow-[0_0_10px_#3b82f6] animate-pulse" />
      <p className="text-xs font-bold text-blue-400 uppercase tracking-widest">{title}</p>
      <p className="text-[10px] text-white/60">{body}</p>
      {onCancel && (
        <button
          type="button"
          onClick={onCancel}
          className="mt-2 px-4 py-1.5 bg-white/10 hover:bg-white/20 text-xs font-bold uppercase tracking-widest text-white border border-white/10 rounded cursor-pointer"
        >
          Cancel
        </button>
      )}
    </div>
  );
}
