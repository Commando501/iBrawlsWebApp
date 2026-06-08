import type { KeyboardEvent } from 'react';

type ConnectionMode = 'relay' | 'local';
type ConnectionStatus = 'idle' | 'fetching_ip' | 'hosting' | 'connecting' | 'connected' | 'error';
type QuickPlayStatus = 'idle' | 'searching' | 'matching';

interface MultiplayerSetupPanelProps {
  connectionMode: ConnectionMode;
  onConnectionModeChange: (mode: ConnectionMode) => void;
  isOnline: boolean;
  userIp: string;
  lanIp: string;
  hostIdCode: string;
  connectionStatus: ConnectionStatus;
  connectionError: string;
  quickPlayStatus: QuickPlayStatus;
  joinIpOrId: string;
  onJoinIpOrIdChange: (value: string) => void;
  customUrlInput: string;
  onCustomUrlInputChange: (value: string) => void;
  onCancelHostOrJoin: () => void;
  onCancelQuickPlay: () => void;
  onQuickPlay: () => void;
  onHostGame: () => void;
  onJoinGame: (target: string, isObserver?: boolean) => void;
  onApplyMatchmakerUrl: () => void;
  onResetMatchmakerUrl: () => void;
}

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
  joinIpOrId,
  onJoinIpOrIdChange,
  customUrlInput,
  onCustomUrlInputChange,
  onCancelHostOrJoin,
  onCancelQuickPlay,
  onQuickPlay,
  onHostGame,
  onJoinGame,
  onApplyMatchmakerUrl,
  onResetMatchmakerUrl,
}: MultiplayerSetupPanelProps) {
  const handleJoinKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      onJoinGame(joinIpOrId);
    }
  };

  return (
    <div className="flex flex-col h-full min-h-0 justify-between gap-5">
      <div className="flex flex-col gap-4 shrink-0">
        <div className="flex items-center gap-2.5 mb-1">
          <span className="w-2 h-4 bg-[#38bdf8]" />
          <h2 className="text-sm uppercase font-bold tracking-[0.25em] text-white">
            Multiplayer Setup
          </h2>
        </div>

        <div className="flex bg-black/40 p-1.5 rounded-lg border border-white/5 gap-2 select-none shadow-[inset_0_1px_3px_rgba(0,0,0,0.3)]">
          <button
            onClick={() => onConnectionModeChange('relay')}
            className={`flex-1 py-2 text-xs font-black uppercase tracking-wider rounded transition-all cursor-pointer text-center ${
              connectionMode === 'relay'
                ? 'bg-gradient-to-r from-sky-600 to-indigo-600 text-white shadow-md'
                : 'text-white/40 hover:text-white/70'
            }`}
          >
            ðŸŒ Cloud Relay
          </button>
          <button
            onClick={() => onConnectionModeChange('local')}
            className={`flex-1 py-2 text-xs font-black uppercase tracking-wider rounded transition-all cursor-pointer text-center ${
              connectionMode === 'local'
                ? 'bg-gradient-to-r from-emerald-600 to-teal-600 text-white shadow-md'
                : 'text-white/40 hover:text-white/70'
            }`}
          >
            ðŸ“¶ Local LAN IP
          </button>
        </div>

        {!isOnline && (
          <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-3 text-left">
            <p className="text-xs font-black uppercase tracking-widest text-amber-300">Offline Mode</p>
            <p className="mt-1 text-xs text-white/60 leading-relaxed">
              Solo training remains available from the installed app cache. Multiplayer, matchmaker chat, invites, and public IP discovery will reconnect when the network is back.
            </p>
          </div>
        )}

        <div className={`p-3.5 rounded-lg border text-xs ${connectionMode === 'relay' ? 'bg-sky-500/5 border-sky-500/20' : 'bg-white/5 border-white/10'}`}>
          <p className="text-[11px] text-[#38bdf8] font-bold uppercase tracking-wider mb-2">Your Connection Coordinates</p>
          <div className="flex flex-col gap-1.5 font-mono text-xs font-semibold">
            {connectionMode === 'relay' ? (
              <div className="flex justify-between items-center bg-black/40 px-3 py-1.5 rounded border border-white/5">
                <span className="text-white/45 uppercase text-[10px] font-bold">Relay Status:</span>
                <span className="text-sky-400 font-extrabold flex items-center gap-1.5">
                  <span className="w-2 h-2 bg-emerald-400 rounded-full animate-pulse inline-block" /> ONLINE
                </span>
              </div>
            ) : (
              <div className="flex justify-between items-center bg-black/40 px-3 py-1.5 rounded border border-white/5">
                <span className="text-white/45 uppercase text-[10px] font-bold">Web/Host IP:</span>
                <span className="text-[#38bdf8] font-black">{userIp === '127.0.0.1' ? '127.0.0.1' : userIp}</span>
              </div>
            )}
            {connectionMode === 'local' && lanIp && lanIp !== '127.0.0.1' && (
              <div className="flex justify-between items-center bg-emerald-500/10 px-3 py-1.5 rounded border border-emerald-500/10">
                <span className="text-emerald-400 uppercase text-[10px] font-bold">LAN Network IP:</span>
                <span className="text-emerald-400 font-extrabold">{lanIp}</span>
              </div>
            )}
            <div className="flex justify-between items-center bg-black/40 px-3 py-1.5 rounded border border-white/5">
              <span className="text-white/45 uppercase text-[10px] font-bold">Room Code:</span>
              <span className="text-amber-400 font-black tracking-widest">{hostIdCode}</span>
            </div>
          </div>
        </div>

        {connectionStatus === 'hosting' && (
          <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-lg p-3.5 flex flex-col items-center justify-center text-center gap-1.5 animate-pulse">
            <span className="w-2 h-2 rounded-full bg-emerald-500 shadow-[0_0_10px_#10b981]" />
            <p className="text-xs font-bold text-emerald-400 uppercase tracking-widest">Lobby Live & Broadcasting</p>
            <p className="text-[10px] text-white/60">Awaiting player to join...</p>
            <button
              onClick={onCancelHostOrJoin}
              className="mt-2 px-4 py-1.5 bg-white/10 hover:bg-white/20 text-xs font-bold uppercase tracking-widest text-white border border-white/10 rounded cursor-pointer transition-all"
            >
              Cancel
            </button>
          </div>
        )}

        {connectionStatus === 'connecting' && (
          <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-3.5 flex flex-col items-center justify-center text-center gap-1.5 animate-pulse">
            <span className="w-2 h-2 rounded-full bg-blue-500 shadow-[0_0_10px_#3b82f6]" />
            <p className="text-xs font-bold text-blue-400 uppercase tracking-widest">Connecting Protocol</p>
            <p className="text-[10px] text-white/60">Attaching to host session...</p>
            <button
              onClick={onCancelHostOrJoin}
              className="mt-2 px-4 py-1.5 bg-white/10 hover:bg-white/20 text-xs font-bold uppercase tracking-widest text-white border border-white/10 rounded cursor-pointer transition-all"
            >
              Cancel
            </button>
          </div>
        )}

        {quickPlayStatus === 'searching' && (
          <div className="bg-sky-500/10 border border-sky-500/30 rounded-lg p-6 flex flex-col items-center justify-center text-center gap-4 relative overflow-hidden">
            <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
              <div className="w-32 h-32 border border-sky-500/20 rounded-full animate-ping absolute" />
              <div className="w-20 h-20 border border-sky-500/30 rounded-full animate-pulse absolute" />
            </div>

            <span className="text-3xl animate-spin inline-block">ðŸ“¡</span>
            <p className="text-sm font-black text-sky-400 uppercase tracking-widest">Searching for Match...</p>
            <p className="text-xs text-white/60">Scanning open rooms and queuing players</p>

            <button
              onClick={onCancelQuickPlay}
              className="z-10 px-5 py-2 bg-red-500/25 hover:bg-red-500/40 text-xs font-bold uppercase tracking-widest text-red-400 border border-red-500/30 rounded cursor-pointer transition-all active:scale-[0.97]"
            >
              Cancel Search
            </button>
          </div>
        )}

        {quickPlayStatus === 'matching' && (
          <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-6 flex flex-col items-center justify-center text-center gap-2 animate-pulse">
            <span className="text-2xl">âš¡</span>
            <p className="text-sm font-black text-amber-400 uppercase tracking-widest font-bold">Match Found!</p>
            <p className="text-xs text-white/60">Configuring arena host credentials...</p>
          </div>
        )}

        {(connectionStatus === 'idle' || connectionStatus === 'error' || connectionStatus === 'fetching_ip') && quickPlayStatus === 'idle' && (
          <div className="flex flex-col gap-2.5">
            <button
              onClick={onQuickPlay}
              className="w-full h-14 bg-gradient-to-r from-sky-400 via-indigo-400 to-purple-500 hover:from-sky-500 hover:to-purple-600 text-slate-950 hover:text-white font-sans font-black text-xs uppercase tracking-[0.2em] transition-all rounded shadow-lg shadow-sky-500/25 border border-sky-300/30 cursor-pointer flex items-center justify-center gap-2 hover:shadow-indigo-500/40 active:scale-[0.98] select-none"
            >
              âš¡ Quick Play Matchmaking
            </button>

            <div className="flex items-center gap-2 py-0.5">
              <hr className="flex-grow border-white/5" />
              <span className="text-[10px] text-white/20 uppercase tracking-widest font-mono">OR DIRECT PLAY</span>
              <hr className="flex-grow border-white/5" />
            </div>

            <button
              onClick={onHostGame}
              className="w-full h-12 bg-white hover:bg-emerald-500 text-slate-900 hover:text-white hover:border-emerald-400 font-sans font-black text-xs uppercase tracking-widest transition-all rounded shadow border border-white/10 cursor-pointer flex items-center justify-center gap-1.5"
            >
              ðŸŽ™ï¸ Host New Match
            </button>

            <div className="flex items-center gap-2 py-0.5">
              <hr className="flex-grow border-white/10" />
              <span className="text-[10px] text-white/30 uppercase tracking-widest font-mono">OR JOIN ROOM</span>
              <hr className="flex-grow border-white/10" />
            </div>

            <div className="flex gap-2">
              <input
                type="text"
                value={joinIpOrId}
                onChange={(event) => onJoinIpOrIdChange(event.target.value)}
                onKeyDown={handleJoinKeyDown}
                placeholder="Room Code or IP..."
                className="flex-1 h-12 bg-black/60 border border-white/10 rounded px-3.5 text-center font-mono text-sm tracking-wide text-[#38bdf8] placeholder:text-white/20 focus:border-[#38bdf8] outline-none transition-all"
              />
              <button
                onClick={() => onJoinGame(joinIpOrId)}
                disabled={!joinIpOrId}
                className={`px-4.5 h-12 font-sans font-black text-xs uppercase tracking-widest rounded transition-all border outline-none ${
                  joinIpOrId
                    ? 'bg-[#38bdf8]/15 hover:bg-[#38bdf8]/35 border-[#38bdf8]/50 text-[#38bdf8] cursor-pointer'
                    : 'bg-white/5 border-white/5 text-white/20 cursor-not-allowed'
                }`}
              >
                Connect
              </button>
              <button
                onClick={() => onJoinGame(joinIpOrId, true)}
                disabled={!joinIpOrId}
                className={`px-4.5 h-12 font-sans font-black text-xs uppercase tracking-widest rounded transition-all border outline-none ${
                  joinIpOrId
                    ? 'bg-amber-500/10 hover:bg-amber-500/30 border-amber-500/50 text-amber-400 cursor-pointer shadow-[0_0_12px_rgba(245,158,11,0.1)]'
                    : 'bg-white/5 border-white/5 text-white/20 cursor-not-allowed'
                }`}
              >
                Spectate
              </button>
            </div>
          </div>
        )}

        {connectionStatus === 'error' && (
          <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-2.5 text-center animate-pulse">
            <p className="text-xs text-red-400 font-black uppercase tracking-wider mb-0.5">âš ï¸ Sync Timeout</p>
            <p className="text-xs text-white/70">{connectionError || 'Connection failed.'}</p>
          </div>
        )}

        <div className="mt-3.5 border-t border-white/5 pt-3.5">
          <details className="group">
            <summary className="flex justify-between items-center text-xs text-[#38bdf8] font-bold uppercase tracking-wider cursor-pointer select-none hover:text-white transition-colors">
              <span>âš™ï¸ Advanced Settings</span>
              <span className="text-[10px] transition-transform group-open:rotate-180 font-sans">â–¼</span>
            </summary>

            <div className="flex flex-col gap-2.5 mt-2.5 bg-black/30 p-3 rounded border border-white/5">
              <label className="text-[10px] text-white/50 uppercase tracking-widest font-mono">Matchmaker Server URL:</label>
              <input
                type="text"
                value={customUrlInput}
                onChange={(event) => onCustomUrlInputChange(event.target.value)}
                placeholder="wss://..."
                className="w-full h-10 bg-black/60 border border-white/10 rounded px-2.5 font-mono text-xs tracking-wide text-white focus:border-[#38bdf8] outline-none transition-all"
              />
              <div className="flex gap-2.5">
                <button
                  onClick={onApplyMatchmakerUrl}
                  className="flex-1 h-9 bg-[#38bdf8] hover:bg-[#38bdf8]/80 text-slate-950 font-sans font-black text-xs uppercase tracking-wider rounded cursor-pointer transition-all active:scale-[0.97]"
                >
                  Apply
                </button>
                <button
                  onClick={onResetMatchmakerUrl}
                  className="h-9 px-3 bg-white/5 hover:bg-white/10 text-white/60 hover:text-white border border-white/10 rounded text-xs font-bold uppercase tracking-wider cursor-pointer transition-all"
                >
                  Reset
                </button>
              </div>

              <div className="flex items-start gap-2.5 mt-1.5 pt-2.5 border-t border-white/5">
                <span className="text-sm mt-0.5">ðŸ“Š</span>
                <span className="flex flex-col gap-0.5">
                  <span className="text-[10px] text-white/70 uppercase tracking-widest font-mono">
                    Data collection (tech demo)
                  </span>
                  <span className="text-[10px] text-white/40 font-medium leading-snug normal-case tracking-normal">
                    This demo collects anonymized gameplay stats and a sampled subset of match replays (player names removed) to train and improve the AI. No accounts or personal info are stored.
                  </span>
                </span>
              </div>
            </div>
          </details>
        </div>
      </div>
    </div>
  );
}
