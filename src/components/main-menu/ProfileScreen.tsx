import React, { useEffect, useId, useRef, useState } from 'react';
import SpartanIdentityAccount from '../SpartanIdentityAccount';
import { MAX_PLAYER_NAME_LENGTH } from '../../network/onlineClients';
import type { MainMenuBroadcastRail } from './MainMenuBroadcastRail';
import { GameModelStage } from './GameModelStage';

export type ProfileScreenProps = React.ComponentProps<typeof MainMenuBroadcastRail> & {
  onOpenArmory?: () => void;
  onOpenCareer?: () => void;
  onOpenSaves?: () => void;
  onOpenSocial?: () => void;
  active?: boolean;
};

export function ProfileScreen({
  account, playerName, playerHue, onPlayerNameChange, onRegistered, onLoggedIn,
  onLoggedOut, onAccountChanged, onOpenArmory, onOpenCareer, onOpenSaves,
  onOpenSocial, active = true,
}: ProfileScreenProps) {
  const [tab, setTab] = useState<'identity' | 'account'>('identity');
  const [draftName, setDraftName] = useState(playerName);
  const [nameSaved, setNameSaved] = useState(false);
  const identityTab = useRef<HTMLButtonElement>(null);
  const accountTab = useRef<HTMLButtonElement>(null);
  const id = useId();

  useEffect(() => { setDraftName(playerName); }, [playerName]);

  const handleTabKey = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const next = event.key === 'Home' ? 'identity' : event.key === 'End' ? 'account' : tab === 'identity' ? 'account' : 'identity';
    setTab(next);
    (next === 'identity' ? identityTab : accountTab).current?.focus();
  };

  return (
    <div className="menu-profile-screen">
      <section className="menu-profile-content" aria-label="Profile details">
        <div className="menu-profile-identity">
          <div><span className="menu-ps-eyebrow">Your callsign</span><h2>{playerName.trim() || 'Spartan'}</h2></div>
          <span className="menu-profile-badge" data-guest={!account}>{account ? 'Signed in' : 'Local profile'}</span>
        </div>
        <div className="menu-profile-tabs" role="tablist" aria-label="Profile categories" onKeyDown={handleTabKey}>
          <button ref={identityTab} id={`${id}-identity-tab`} type="button" role="tab" aria-controls={`${id}-identity`} aria-selected={tab === 'identity'} tabIndex={tab === 'identity' ? 0 : -1} onClick={() => setTab('identity')}>Identity</button>
          <button ref={accountTab} id={`${id}-account-tab`} type="button" role="tab" aria-controls={`${id}-account`} aria-selected={tab === 'account'} tabIndex={tab === 'account' ? 0 : -1} onClick={() => setTab('account')}>Account &amp; security</button>
        </div>
        <section id={`${id}-identity`} className="menu-profile-panel" role="tabpanel" aria-labelledby={`${id}-identity-tab`} hidden={tab !== 'identity'}>
          <div className="menu-ps-section-title"><h3>Seen by every challenger.</h3><p>Your display name appears in matches and chat.</p></div>
          <form className="menu-profile-name" onSubmit={event => { event.preventDefault(); onPlayerNameChange(draftName); setNameSaved(true); }}>
            <label htmlFor={`${id}-name`}>Display name <span>{draftName.length} / {MAX_PLAYER_NAME_LENGTH}</span></label>
            <div><input id={`${id}-name`} maxLength={MAX_PLAYER_NAME_LENGTH} value={draftName} onChange={event => { setDraftName(event.target.value); setNameSaved(false); }} autoComplete="off" spellCheck={false} aria-describedby={`${id}-name-help`} /><button type="submit" className="menu-ps-button">Save name</button></div>
            <p id={`${id}-name-help`}>Up to {MAX_PLAYER_NAME_LENGTH} characters. Your account username stays separate.</p>
            {nameSaved && <p role="status">Name submitted. Availability checks apply online.</p>}
          </form>
          <div className="menu-profile-links">
            {onOpenCareer && <button type="button" onClick={onOpenCareer}><span><strong>Your career</strong><small>Match records, stats, and medals</small></span><span aria-hidden="true">→</span></button>}
            {onOpenSaves && <button type="button" onClick={onOpenSaves}><span><strong>Saves &amp; backups</strong><small>Export, import, or reset in Settings</small></span><span aria-hidden="true">→</span></button>}
            {onOpenSocial && <button type="button" onClick={onOpenSocial}><span><strong>Find your next match</strong><small>Open Social and global chat</small></span><span aria-hidden="true">→</span></button>}
          </div>
          <div className="menu-profile-sync"><span aria-hidden="true" /><div><strong>{account ? 'Settings follow your account.' : 'Your brawler starts here.'}</strong><p>{account ? 'Appearance, controls, and layouts sync with your account.' : 'Play as a guest, or sign in to sync settings and your service record across devices.'}</p><button className="menu-ps-text-button" type="button" onClick={() => { setTab('account'); accountTab.current?.focus(); }}>Manage account →</button></div></div>
        </section>
        <section id={`${id}-account`} className="menu-profile-panel" role="tabpanel" aria-labelledby={`${id}-account-tab`} hidden={tab !== 'account'}>
          <div className="menu-ps-section-title"><h3>{account ? 'Account details' : 'Take your brawler with you.'}</h3><p>{account ? 'Private details are only visible to you.' : 'An account is optional. Sign in to carry settings and your service record across devices.'}</p></div>
          <SpartanIdentityAccount presentation="screen" account={account} playerName={playerName} onRegistered={onRegistered} onLoggedIn={onLoggedIn} onLoggedOut={onLoggedOut} onAccountChanged={onAccountChanged} />
        </section>
      </section>
      <aside className="menu-profile-model" aria-label="Your brawler">
        <div className="menu-profile-stage"><div className="menu-profile-stage-heading"><span className="menu-ps-eyebrow">Your brawler</span><strong>Iron Vanguard</strong><span>Version 3</span></div><GameModelStage hue={playerHue} heldWeapon="sword" active={active} label="Your V3 Iron Vanguard" /></div>
        {onOpenArmory && <button className="menu-profile-customize" type="button" onClick={onOpenArmory}><span><span className="menu-ps-eyebrow">Personalize your look</span><strong>Customize in Armory</strong></span><span aria-hidden="true">→</span></button>}
        <p className="menu-profile-model-note">Your colors. Your presence.<br />Team colors apply during team matches.</p>
      </aside>
    </div>
  );
}
