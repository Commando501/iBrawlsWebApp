import React, { useEffect, useMemo, useRef, useState } from 'react';
import SpartanIdentityAccount from '../SpartanIdentityAccount';
import type { AccountInfo } from '../../services/account';
import type { ChatMessage } from '../ChatOverlay';
import {
  MAX_MULTIPLAYER_PLAYERS,
  MAX_PLAYER_NAME_LENGTH,
  buildActiveLobbies,
  formatLobbyDuration,
  getLobbyMemberStatusLabel,
  getOnlineClientDisplayName,
  normalizePlayerName,
  type OnlineClient,
} from '../../network/onlineClients';

interface GlobalChatPanelProps {
  messages: ChatMessage[];
  onSendMessage: (text: string) => void;
}

export const GlobalChatPanel = ({ messages, onSendMessage }: GlobalChatPanelProps) => {
  const [inputText, setInputText] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputText.trim()) return;
    onSendMessage(inputText);
    setInputText('');
  };

  return (
    <div className="flex-1 flex flex-col justify-between min-h-0 gap-3">
      {/* Message history container */}
      <div
        ref={scrollRef}
        className="flex-1 min-h-0 overflow-y-auto bg-black/45 border border-white/10 rounded-xl p-3.5 flex flex-col gap-2.5 scrollbar-thin scrollbar-thumb-white/10 pr-1.5"
      >
        {messages.length === 0 ? (
          <p className="text-xs font-mono text-white/35 uppercase tracking-widest text-center my-auto italic select-none">
            📡 No active broadcast logs. Type below to transmit message.
          </p>
        ) : (
          messages.map((msg) => (
            <div
              key={msg.id}
              className={`flex flex-col gap-1 max-w-[90%] animate-fade-in ${
                msg.isLocal ? 'self-end bg-[#38bdf8]/10 p-2.5 rounded-lg border border-[#38bdf8]/20' : 'self-start'
              }`}
            >
              <div className="flex items-center gap-2 select-none">
                <span className={`text-[11px] font-mono font-black ${
                  msg.isLocal ? 'text-[#38bdf8]' : 'text-slate-400'
                }`}>
                  {msg.sender} {msg.isLocal ? '(You)' : ''}
                </span>
                <span className="text-[10px] font-mono text-white/20">
                  {msg.timestamp}
                </span>
              </div>
              <p className="text-sm font-sans text-slate-100 break-words leading-relaxed select-text font-medium leading-[1.3] pl-0.5">
                {msg.text}
              </p>
            </div>
          ))
        )}
      </div>

      {/* Message input form */}
      <form
        onSubmit={handleSubmit}
        className="flex items-center gap-2.5 bg-black/40 border border-white/10 rounded-lg p-2.5 shrink-0 pointer-events-auto"
      >
        <input
          type="text"
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          placeholder="Type global message... [Press Enter]"
          className="flex-grow h-11 bg-black/50 border border-white/5 rounded px-3.5 text-sm text-white placeholder:text-white/30 focus:border-[#38bdf8]/40 outline-none transition-all font-sans"
          maxLength={120}
          autoComplete="off"
        />
        <button
          type="submit"
          disabled={!inputText.trim()}
          className={`h-11 px-5 rounded text-sm font-sans font-bold uppercase tracking-wider transition-all flex items-center justify-center shrink-0 ${
            inputText.trim()
              ? 'bg-[#38bdf8] hover:bg-[#38bdf8]/80 text-slate-950 font-black cursor-pointer shadow-[0_0_12px_rgba(56,189,248,0.25)] hover:shadow-[0_0_18px_rgba(56,189,248,0.4)] active:scale-95'
              : 'bg-white/5 text-white/20 border border-white/5 cursor-not-allowed'
          }`}
        >
          Send
        </button>
      </form>
    </div>
  );
};

type LoggedOutAccountRequestMode = 'login' | 'register';

interface PilotIdentitySubframeProps {
  account: AccountInfo | null;
  playerName: string;
  playerHue: number | undefined;
  onPlayerNameChange: (name: string) => void;
  onRegistered: (account: AccountInfo) => void;
  onLoggedIn: (account: AccountInfo) => void;
  onLoggedOut: () => void;
  onAccountChanged: (account: AccountInfo) => void;
}

export const PilotIdentitySubframe = ({
  account,
  playerName,
  playerHue,
  onPlayerNameChange,
  onRegistered,
  onLoggedIn,
  onLoggedOut,
  onAccountChanged,
}: PilotIdentitySubframeProps) => {
  const [isOpen, setIsOpen] = useState(true);
  const [modeRequest, setModeRequest] = useState<{
    mode: LoggedOutAccountRequestMode;
    token: number;
  }>({ mode: 'login', token: 0 });

  const resolvedHue = typeof playerHue === 'number' && Number.isFinite(playerHue) ? playerHue : 200;
  const displayName = (playerName.trim() || 'SPARTAN').toUpperCase();

  const requestLoggedOutMode = (
    mode: LoggedOutAccountRequestMode,
    event: React.MouseEvent<HTMLButtonElement>
  ) => {
    event.preventDefault();
    event.stopPropagation();
    setIsOpen(true);
    setModeRequest((prev) => ({ mode, token: prev.token + 1 }));
  };

  return (
    <details
      className="group/pilot-identity bg-slate-950/45 border border-white/10 rounded-lg p-3 shrink-0"
      open={isOpen}
      onToggle={(event) => setIsOpen(event.currentTarget.open)}
    >
      <summary className="flex flex-col gap-2 cursor-pointer select-none list-none">
        <span className="flex justify-between items-center gap-2">
          <span className="text-xs text-[#38bdf8] font-black uppercase tracking-wider flex items-center gap-1.5 min-w-0">
            <span className="w-1 px-0.5 h-2.5 bg-[#38bdf8] inline-block rounded-sm shrink-0" />
            <span className="truncate">Spartan Pilot Identity</span>
          </span>
          <span className="flex items-center gap-2 shrink-0">
            <span className="text-[10px] font-mono text-cyan-400 bg-cyan-950/40 border border-cyan-500/20 px-2 py-0.5 rounded">
              MAX_10_CHARS
            </span>
            <span className="text-[10px] text-white/35 transition-transform group-open/pilot-identity:rotate-180 font-sans">
              v
            </span>
          </span>
        </span>

        <span className="flex flex-wrap items-center gap-2 min-w-0">
          <span
            className="w-7 h-7 rounded border border-white/20 shadow-inner shrink-0"
            style={{ backgroundColor: `hsl(${resolvedHue}, 80%, 35%)` }}
          />
          <span className="min-w-0 flex-1 text-sm font-black text-[#38bdf8] uppercase tracking-wide truncate">
            {displayName}
          </span>
          {!isOpen && account && (
            <span className="flex items-center gap-1.5 shrink-0">
              <span className="text-[9px] font-black text-emerald-300 bg-emerald-500/15 border border-emerald-500/35 px-2 py-1 rounded uppercase tracking-widest font-mono">
                Signed In
              </span>
              {account.isAdmin && (
                <span className="text-[9px] font-black text-amber-300 bg-amber-500/15 border border-amber-500/40 px-2 py-1 rounded uppercase tracking-widest font-mono">
                  Admin
                </span>
              )}
            </span>
          )}
          {!isOpen && !account && (
            <span className="flex gap-1.5 shrink-0">
              <button
                type="button"
                onClick={(event) => requestLoggedOutMode('login', event)}
                className="px-2.5 py-1 rounded border border-[#38bdf8]/35 bg-[#38bdf8]/10 text-[#38bdf8] text-[9px] font-black uppercase tracking-widest hover:bg-[#38bdf8]/20 transition-colors"
              >
                Log In
              </button>
              <button
                type="button"
                onClick={(event) => requestLoggedOutMode('register', event)}
                className="px-2.5 py-1 rounded border border-white/10 bg-white/5 text-white/70 text-[9px] font-black uppercase tracking-widest hover:bg-white/10 transition-colors"
              >
                Register
              </button>
            </span>
          )}
        </span>
      </summary>

      <div className="pt-2.5 mt-2.5 border-t border-white/5">
        <div className="flex flex-col gap-1.5 text-left">
          <span className="text-[10.5px] text-white/40 uppercase tracking-widest font-mono">
            Customize Nameplate Callout:
          </span>
          <div className="relative">
            <input
              type="text"
              maxLength={MAX_PLAYER_NAME_LENGTH}
              value={playerName}
              onChange={(event) => onPlayerNameChange(event.target.value)}
              placeholder="Spartan Tag..."
              className="w-full h-11 bg-black/60 border border-white/10 rounded px-3.5 text-sm tracking-wide text-[#38bdf8] placeholder:text-white/20 focus:border-[#38bdf8] outline-none transition-all font-semibold uppercase pr-8 font-sans"
            />
            <div className="absolute right-3.5 top-3.5 w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse" />
          </div>
        </div>

        <SpartanIdentityAccount
          account={account}
          requestedLoggedOutMode={modeRequest.token > 0 ? modeRequest.mode : undefined}
          loggedOutModeRequestToken={modeRequest.token}
          onRegistered={onRegistered}
          onLoggedIn={onLoggedIn}
          onLoggedOut={onLoggedOut}
          onAccountChanged={onAccountChanged}
        />
      </div>
    </details>
  );
};

type ConnectionStatus = 'idle' | 'fetching_ip' | 'hosting' | 'connecting' | 'connected' | 'error';
type ConnectionMode = 'relay' | 'local';
type PlayerListTab = 'players' | 'lobbies';

interface PlayerListSubframeProps {
  onlineClients: OnlineClient[];
  clientId: string;
  connectionStatus: ConnectionStatus;
  connectionMode: ConnectionMode;
  menuSocket: WebSocket | null;
  hostIdCode: string;
  onJoinGame: (target: string, isObserver?: boolean) => void;
  setInviteNotifications: React.Dispatch<React.SetStateAction<string[]>>;
}

export const PlayerListSubframe = ({
  onlineClients,
  clientId,
  connectionStatus,
  connectionMode,
  menuSocket,
  hostIdCode,
  onJoinGame,
  setInviteNotifications,
}: PlayerListSubframeProps) => {
  const [activeTab, setActiveTab] = useState<PlayerListTab>('players');
  const [selectedLobbyCode, setSelectedLobbyCode] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const activeLobbies = useMemo(() => buildActiveLobbies(onlineClients), [onlineClients]);

  useEffect(() => {
    if (activeTab !== 'lobbies') return;

    setNow(Date.now());
    const intervalId = window.setInterval(() => setNow(Date.now()), 30000);
    return () => window.clearInterval(intervalId);
  }, [activeTab]);

  useEffect(() => {
    if (!selectedLobbyCode) return;
    if (!activeLobbies.some(lobby => lobby.roomCode === selectedLobbyCode)) {
      setSelectedLobbyCode(null);
    }
  }, [activeLobbies, selectedLobbyCode]);

  return (
    <details className="group/player-list bg-slate-950/45 border border-white/10 rounded-lg p-3 shrink-0" open>
      <summary className="flex justify-between items-center gap-2 cursor-pointer select-none list-none">
        <span className="text-xs text-[#38bdf8] font-black uppercase tracking-wider flex items-center gap-1.5 min-w-0">
          <span className="w-1 px-0.5 h-2.5 bg-[#38bdf8] inline-block rounded-sm shrink-0" />
          <span className="truncate">Player List ({onlineClients.length})</span>
        </span>
        <span className="flex items-center gap-2 shrink-0">
          {clientId && (
            <span className="text-[10px] font-mono text-white/45 bg-white/5 px-2 py-0.5 rounded border border-white/5">
              ID: {clientId}
            </span>
          )}
          <span className="text-[10px] text-white/35 transition-transform group-open/player-list:rotate-180 font-sans">
            v
          </span>
        </span>
      </summary>

      <div className="pt-2.5 mt-2.5 border-t border-white/5">
        <div className="grid grid-cols-2 gap-1 bg-black/35 border border-white/5 rounded-md p-1 mb-2">
          <button
            type="button"
            onClick={() => setActiveTab('players')}
            aria-pressed={activeTab === 'players'}
            className={`min-w-0 h-7 rounded text-[10px] font-black uppercase tracking-wider transition-all ${
              activeTab === 'players'
                ? 'bg-[#38bdf8]/20 text-[#7dd3fc] border border-[#38bdf8]/35'
                : 'text-white/45 hover:text-white/75 border border-transparent'
            }`}
          >
            <span className="truncate block">Players {onlineClients.length}</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('lobbies')}
            aria-pressed={activeTab === 'lobbies'}
            className={`min-w-0 h-7 rounded text-[10px] font-black uppercase tracking-wider transition-all ${
              activeTab === 'lobbies'
                ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/35'
                : 'text-white/45 hover:text-white/75 border border-transparent'
            }`}
          >
            <span className="truncate block">Lobbies {activeLobbies.length}</span>
          </button>
        </div>

        <div className="player-list-scroll flex flex-col gap-2 pr-1 min-h-[5rem]">
          {activeTab === 'players' && (
            onlineClients.length === 0 ? (
              <p className="text-xs text-white/45 italic font-medium m-auto text-center py-4">No other players online yet.</p>
            ) : (
              onlineClients.map(client => {
                const displayName = getOnlineClientDisplayName(client);
                const customName = normalizePlayerName(client.name);
                const maxPlayers = client.maxPlayers ?? MAX_MULTIPLAYER_PLAYERS;
                const playerCount = typeof client.playerCount === 'number' ? client.playerCount : undefined;
                const slotLabel = playerCount !== undefined ? `${Math.min(playerCount, maxPlayers)}/${maxPlayers}` : undefined;
                return (
                  <div key={client.id} className="flex justify-between items-center bg-black/45 px-3 py-2.5 rounded border border-white/5 text-xs font-mono shrink-0">
                    <div className="flex flex-col gap-1 min-w-0">
                      <span className="text-white/80 font-semibold truncate max-w-[130px]" title={customName ? `${displayName} (${client.id})` : displayName}>
                        {displayName}
                      </span>
                      <div className="flex items-center gap-1.5">
                        {client.state === 'menu' && (
                          <span className="text-[10px] text-slate-400/80 font-bold uppercase tracking-wider flex items-center gap-1">
                            <span className="w-1.5 h-1.5 rounded-full bg-slate-500" />
                            In Menu
                          </span>
                        )}
                        {client.state === 'solo' && (
                          <span className="text-[10px] text-amber-400 font-bold uppercase tracking-wider flex items-center gap-1">
                            <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
                            Solo Training
                          </span>
                        )}
                        {client.state === 'multi' && (
                          client.spaceAvailable ? (
                            <button
                              type="button"
                              onClick={() => {
                                if (client.roomCode) {
                                  onJoinGame(client.roomCode);
                                }
                              }}
                              className="text-[10px] bg-emerald-500/20 hover:bg-emerald-500/35 border border-emerald-500/40 text-emerald-400 font-bold uppercase tracking-wider px-2 py-0.5 rounded cursor-pointer transition-all flex items-center gap-1"
                            >
                              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 inline-block animate-ping" />
                              {slotLabel ? `Join ${slotLabel}` : 'Join'}
                            </button>
                          ) : (
                            <span className="text-[10px] text-blue-400 font-bold uppercase tracking-wider flex items-center gap-1">
                              <span className="w-1.5 h-1.5 rounded-full bg-blue-500" />
                              {slotLabel ? `In Match ${slotLabel}` : 'In Match'}
                            </span>
                          )
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-1 shrink-0">
                      {connectionStatus === 'hosting' && connectionMode === 'relay' && (
                        <button
                          type="button"
                          onClick={() => {
                            if (menuSocket && menuSocket.readyState === WebSocket.OPEN) {
                              menuSocket.send(JSON.stringify({
                                type: 'send_invite',
                                targetId: client.id,
                                roomCode: hostIdCode
                              }));
                              setInviteNotifications(prev => [
                                ...prev,
                                `Lobby invite dispatched to Client ${client.id}.`
                              ]);
                              setTimeout(() => {
                                setInviteNotifications(prev => prev.filter(n => !n.includes(client.id)));
                              }, 5000);
                            }
                          }}
                          className="px-2.5 py-1 bg-gradient-to-r from-sky-600 to-indigo-600 hover:from-sky-500 hover:to-indigo-500 text-[9px] font-sans font-black uppercase tracking-wider text-white rounded cursor-pointer transition-all border border-sky-400/20 active:scale-95"
                        >
                          Invite
                        </button>
                      )}
                    </div>
                  </div>
                );
              })
            )
          )}

          {activeTab === 'lobbies' && (
            activeLobbies.length === 0 ? (
              <p className="text-xs text-white/45 italic font-medium m-auto text-center py-4">No active lobbies broadcasting right now.</p>
            ) : (
              activeLobbies.map(lobby => {
                const isSelected = lobby.roomCode === selectedLobbyCode;
                const lobbyLabel = `Lobby ${lobby.roomCode}`;
                const firstMember = lobby.members[0];
                const firstMemberName = firstMember ? getOnlineClientDisplayName(firstMember) : 'Unknown pilot';
                const remainingPlayerCount = Math.max(0, lobby.playerCount - 1);
                const memberSummary = remainingPlayerCount > 0
                  ? `${firstMemberName} and ${remainingPlayerCount} more`
                  : firstMemberName;

                return (
                  <div
                    key={lobby.roomCode}
                    className={`bg-black/45 rounded border text-xs font-mono shrink-0 transition-colors ${
                      isSelected ? 'border-emerald-400/45' : 'border-white/5'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => setSelectedLobbyCode(isSelected ? null : lobby.roomCode)}
                      className="w-full text-left px-3 py-2.5 flex justify-between items-start gap-2 cursor-pointer"
                      aria-expanded={isSelected}
                    >
                      <span className="flex flex-col gap-1 min-w-0">
                        <span className="text-white/85 font-semibold truncate" title={lobbyLabel}>
                          {lobbyLabel}
                        </span>
                        <span className="text-[10px] text-white/45 truncate">
                          {memberSummary}
                        </span>
                      </span>
                      <span className="flex flex-col items-end gap-1 shrink-0">
                        <span className={`text-[10px] font-black uppercase tracking-wider ${lobby.isOpen ? 'text-emerald-300' : 'text-blue-300'}`}>
                          {Math.min(lobby.playerCount, lobby.maxPlayers)}/{lobby.maxPlayers}
                        </span>
                        <span className={`text-[9px] font-black uppercase tracking-wider ${lobby.isOpen ? 'text-emerald-400' : 'text-white/35'}`}>
                          {lobby.isOpen ? 'Open' : 'Closed'}
                        </span>
                      </span>
                    </button>

                    {isSelected && (
                      <div className="px-3 pb-3 pt-2 border-t border-white/5 flex flex-col gap-2">
                        <div className="flex items-center justify-between gap-2 text-[10px]">
                          <span className="text-white/45 uppercase tracking-wider">Live for</span>
                          <span className="text-cyan-300 font-black">{formatLobbyDuration(lobby.startedAt, now)}</span>
                        </div>

                        <div className="flex flex-col gap-1.5">
                          {lobby.members.map(member => {
                            const memberName = getOnlineClientDisplayName(member);
                            return (
                              <div key={member.id} className="flex items-center justify-between gap-2 bg-white/[0.03] border border-white/5 rounded px-2 py-1.5">
                                <span className="text-white/75 truncate" title={`${memberName} (${member.id})`}>
                                  {memberName}
                                </span>
                                <span className="text-[9px] text-white/35 uppercase tracking-wider shrink-0">
                                  {getLobbyMemberStatusLabel(member)}
                                </span>
                              </div>
                            );
                          })}
                        </div>

                        {lobby.isOpen ? (
                          <button
                            type="button"
                            onClick={() => onJoinGame(lobby.roomCode)}
                            className="w-full min-h-8 bg-emerald-500/20 hover:bg-emerald-500/35 border border-emerald-500/40 text-emerald-300 font-black uppercase tracking-wider rounded transition-all"
                          >
                            Join Lobby
                          </button>
                        ) : (
                          <div className="w-full min-h-8 flex items-center justify-center rounded border border-white/5 bg-white/[0.03] text-[10px] text-white/35 font-black uppercase tracking-wider">
                            Lobby is not open
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })
            )
          )}
        </div>
      </div>
    </details>
  );
};
