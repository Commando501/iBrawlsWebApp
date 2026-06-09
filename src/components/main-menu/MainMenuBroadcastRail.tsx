import React from 'react';
import type { AccountInfo } from '../../services/account';
import type { ChatMessage } from '../ChatOverlay';
import type { OnlineClient } from '../../network/onlineClients';
import {
  GlobalChatPanel,
  PilotIdentitySubframe,
  PlayerListSubframe,
} from './GlobalBroadcastPanel';

type ConnectionStatus = 'idle' | 'fetching_ip' | 'hosting' | 'connecting' | 'connected' | 'error';
type ConnectionMode = 'relay' | 'local';

interface MainMenuBroadcastRailProps {
  style: React.CSSProperties;
  account: AccountInfo | null;
  playerName: string;
  playerHue?: number;
  onlineClients: OnlineClient[];
  clientId: string;
  connectionStatus: ConnectionStatus;
  connectionMode: ConnectionMode;
  menuSocket: WebSocket | null;
  hostIdCode: string;
  lobbyChatMessages: ChatMessage[];
  onPlayerNameChange: (name: string) => void;
  onRegistered: (account: AccountInfo) => void;
  onLoggedIn: (account: AccountInfo) => void;
  onLoggedOut: () => void;
  onAccountChanged: (account: AccountInfo) => void;
  onJoinGame: (target: string, isObserver?: boolean, password?: string, inviteToken?: string) => void;
  setInviteNotifications: React.Dispatch<React.SetStateAction<string[]>>;
  onSendLobbyChatMessage: (text: string) => void;
}

export function MainMenuBroadcastRail({
  style,
  account,
  playerName,
  playerHue,
  onlineClients,
  clientId,
  connectionStatus,
  connectionMode,
  menuSocket,
  hostIdCode,
  lobbyChatMessages,
  onPlayerNameChange,
  onRegistered,
  onLoggedIn,
  onLoggedOut,
  onAccountChanged,
  onJoinGame,
  setInviteNotifications,
  onSendLobbyChatMessage,
}: MainMenuBroadcastRailProps) {
  return (
    <aside className="mobile-lobby-chat" style={style}>
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'rgba(2,6,23,0.45)', border: '1px solid rgba(255,255,255,0.10)', borderRadius: 12, padding: 16, gap: 12, boxShadow: 'inset 0 1px 3px rgba(0,0,0,0.30)', overflow: 'hidden' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingBottom: 10, borderBottom: '1px solid rgba(255,255,255,0.05)', gap: 8, flexShrink: 0 }}>
          <span style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 12, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#38bdf8', whiteSpace: 'nowrap' }}>
            Global Broadcast
          </span>
          <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, fontWeight: 800, color: '#34d399', display: 'inline-flex', alignItems: 'center', gap: 6, letterSpacing: '0.15em', textTransform: 'uppercase' }}>
            <span style={{ width: 6, height: 6, borderRadius: 9999, background: '#34d399', boxShadow: '0 0 6px #34d399', animation: 'pulse 1.4s infinite' }} />
            LIVE
          </span>
        </div>
        <PilotIdentitySubframe
          account={account}
          playerName={playerName}
          playerHue={playerHue}
          onPlayerNameChange={onPlayerNameChange}
          onRegistered={onRegistered}
          onLoggedIn={onLoggedIn}
          onLoggedOut={onLoggedOut}
          onAccountChanged={onAccountChanged}
        />
        <PlayerListSubframe
          onlineClients={onlineClients}
          clientId={clientId}
          connectionStatus={connectionStatus}
          connectionMode={connectionMode}
          menuSocket={menuSocket}
          hostIdCode={hostIdCode}
          onJoinGame={onJoinGame}
          setInviteNotifications={setInviteNotifications}
        />
        <GlobalChatPanel
          messages={lobbyChatMessages}
          onSendMessage={onSendLobbyChatMessage}
        />
      </div>
    </aside>
  );
}
