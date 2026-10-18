import React from 'react';
import type { MainMenuBroadcastRail } from './MainMenuBroadcastRail';
import { PlayerListSubframe } from './GlobalBroadcastPanel';

export type SocialScreenProps = React.ComponentProps<typeof MainMenuBroadcastRail> & {
  onBrowseLobbies?: () => void;
  onOpenProfile?: () => void;
};

export function SocialScreen({
  onlineClients, clientId, connectionStatus, connectionMode, menuSocket, hostIdCode,
  onJoinGame, setInviteNotifications,
  playerName, onBrowseLobbies, onOpenProfile,
}: SocialScreenProps) {
  return (
    <div className="menu-social-screen">
      <section className="menu-social-directory" aria-labelledby="menu-social-players-title">
        <div className="menu-social-directory-heading"><div><span className="menu-ps-eyebrow">In the game</span><h2 id="menu-social-players-title">Online players <span>{onlineClients.length}</span></h2></div>{onBrowseLobbies && <button className="menu-ps-text-button" type="button" onClick={onBrowseLobbies}>Browse lobbies ↗</button>}</div>
        <PlayerListSubframe presentation="screen" onlineClients={onlineClients} clientId={clientId} connectionStatus={connectionStatus} connectionMode={connectionMode} menuSocket={menuSocket} hostIdCode={hostIdCode} onJoinGame={onJoinGame} setInviteNotifications={setInviteNotifications} />
        <div className="menu-social-directory-foot"><span>{playerName || 'Spartan'}{clientId ? ` · ID: ${clientId}` : ''}</span>{onOpenProfile && <button className="menu-ps-text-button" type="button" onClick={onOpenProfile}>Your profile →</button>}</div>
      </section>

    </div>
  );
}
