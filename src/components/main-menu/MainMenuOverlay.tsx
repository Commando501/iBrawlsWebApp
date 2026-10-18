import React, { useEffect, useRef, useState } from 'react';
import AdminDashboard from '../AdminDashboard';
import { MechanicsSettingsGrid } from '../settings/MechanicsSettingsGrid';
import { AI_CUSTOM_KNOB_SECTIONS } from './aiMenuContent';
import { MainMenuBroadcastRail } from './MainMenuBroadcastRail';
import { MainMenuChildNav } from './MainMenuChildNav';
import { MainMenuHeader } from './MainMenuHeader';
import { MainMenuPrimaryPanel } from './MainMenuPrimaryPanel';
import type { BotSetupOverlay } from './BotSetupOverlay';
import { PlayHub } from './PlayHub';
import { CreateScreen } from './CreateScreen';
import { MenuSettingsScreen } from './MenuSettingsScreen';
import { ProfileScreen } from './ProfileScreen';
import { SocialScreen } from './SocialScreen';
import { MenuSocialPane } from './MenuSocialPane';
import { PlayerListSubframe } from './GlobalBroadcastPanel';
import { TrainingScreen } from './TrainingScreen';
import { TournamentScreen } from './TournamentScreen';
import { menuBackTarget, type MenuLocation, type MenuScreen, type MenuSettingsSection } from './menuNavigation';

type AdminDashboardProps = React.ComponentProps<typeof AdminDashboard>;
type MechanicsSettingsGridProps = React.ComponentProps<typeof MechanicsSettingsGrid>;

interface MainMenuOverlayProps {
  isVisible: boolean;
  showAdminDashboard: boolean;
  adminDashboard: {
    account: AdminDashboardProps['account'] | null;
    settings: AdminDashboardProps['settings'];
    onSettingChange: AdminDashboardProps['onSettingChange'];
    mechanicsSettings: MechanicsSettingsGridProps['settings'];
    setMechanicsSettings: MechanicsSettingsGridProps['setSettings'];
    collapsedSections: MechanicsSettingsGridProps['collapsedSections'];
    onToggleSection: MechanicsSettingsGridProps['onToggleSection'];
    multiplayerPreset: AdminDashboardProps['multiplayerPreset'];
    onPublish: AdminDashboardProps['onPublish'];
    isPublishing: AdminDashboardProps['isPublishing'];
    publishStatus: AdminDashboardProps['publishStatus'];
    botConfig: AdminDashboardProps['botConfig'];
    onBotConfigChange: AdminDashboardProps['onBotConfigChange'];
    onClose: AdminDashboardProps['onClose'];
  };
  header: React.ComponentProps<typeof MainMenuHeader>;
  childNav: React.ComponentProps<typeof MainMenuChildNav>;
  primaryPanel: React.ComponentProps<typeof MainMenuPrimaryPanel>;
  broadcastRail: React.ComponentProps<typeof MainMenuBroadcastRail>;
  navigation: {
    location: MenuLocation;
    onNavigate: (screen: MenuScreen, section?: MenuSettingsSection) => void;
    onBack: () => void;
  };
  trainingSetup: React.ComponentProps<typeof BotSetupOverlay>;
  settingsOptions: Pick<React.ComponentProps<typeof MenuSettingsScreen>, 'forceMobileControls' | 'onForceMobileControlsChange'>;
}

const PRIMARY: [MenuScreen, string][] = [['play','Play'],['armory','Armory'],['theater','Theater'],['career','Career'],['create','Create']];
const UTILITIES: [MenuScreen, string][] = [['settings','Settings'],['profile','Profile'],['social','Social']];
const SCREEN_COPY: Record<MenuScreen, [string,string]> = {
  play: ['Choose your arena.', 'Train, compete, or bring your squad.'],
  training: ['Training', 'Your arena. Your rules.'],
  tournament: ['Tournament', 'Build the bracket. Earn your place.'],
  online: ['Online Play', 'Find your next match.'],
  armory: ['Armory', 'Make your mark in the arena.'],
  theater: ['Theater', 'Every match tells a story.'],
  career: ['Career', 'Your time in the arena, recorded.'],
  create: ['Create', 'Build what comes next.'],
  'ai-editor': ['AI Lab', 'Build and refine your competition.'],
  settings: ['Settings', 'Make the game feel right.'],
  profile: ['Profile', 'Your identity in the arena.'],
  social: ['Social', 'Find the people behind the armor.'],
};
const RETAINED: MenuScreen[] = ['training','tournament','online','theater','career','create','profile','social'];

export function MainMenuOverlay({
  isVisible,
  showAdminDashboard,
  adminDashboard,
  header,
  childNav,
  primaryPanel,
  broadcastRail,
  navigation,
  trainingSetup,
  settingsOptions,
}: MainMenuOverlayProps) {
  const adminAccount = adminDashboard.account;
  const { screen, settingsSection } = navigation.location;
  const [visited, setVisited] = useState<Set<MenuScreen>>(() => new Set([screen]));
  const [onlineRequest, setOnlineRequest] = useState<{view: 'home'|'browse'; token: number}>({view:'home',token:0});
  const heading = useRef<HTMLHeadingElement>(null);
  const previousScreen = useRef(screen);
  useEffect(() => {
    setVisited(previous => previous.has(screen) ? previous : new Set([...previous,screen]));
    if (previousScreen.current !== screen) heading.current?.focus({preventScroll:true});
    previousScreen.current = screen;
  }, [screen]);
  // Each visit starts a fresh training setup in iBrawls, including restored routes.
  useEffect(() => {
    if (isVisible && screen === 'training' && !trainingSetup.isPlaying) {
      trainingSetup.setAdminSettings(previous => ({ ...previous, gameMode: 'sandbox' }));
    }
  }, [isVisible, screen, trainingSetup.isPlaying, trainingSetup.setAdminSettings]);
  const navigate = (destination: MenuScreen, section?: MenuSettingsSection) => {
    if (destination === 'training') primaryPanel.setSinglePlayerMode('sandbox');
    if (destination === 'tournament') primaryPanel.setSinglePlayerMode('tournament');
    if (destination === 'ai-editor') {
      primaryPanel.setSinglePlayerMode('ai-editor');
      primaryPanel.onSelectAIPreset('custom');
    }
    navigation.onNavigate(destination, section);
  };
  const selectedPrimary = ['training','tournament','online'].includes(screen) ? 'play' : screen === 'ai-editor' ? 'create' : screen;
  const browser = <PlayerListSubframe presentation="screen" initialTab="lobbies" {...broadcastRail} />;
  const panel = (destination: MenuScreen) => {
    const active = isVisible && screen === destination;
    switch (destination) {
      case 'play': return <PlayHub game={primaryPanel} onNavigate={navigate} />;
      case 'training': return <TrainingScreen {...trainingSetup} isOpen active={active} onClose={navigation.onBack} onOpenSettings={() => navigate('settings','mechanics')} onOpenAI={() => navigate('ai-editor')} />;
      case 'tournament': return <TournamentScreen game={primaryPanel} />;
      case 'online': return <MainMenuPrimaryPanel {...primaryPanel} parent="play" playChild="multi" lobbyBrowser={browser} requestedOnlineView={onlineRequest.view} onlineViewRequestToken={onlineRequest.token} />;
      case 'armory': return <MainMenuPrimaryPanel {...primaryPanel} parent="customization" customizationChild="armory" />;
      case 'theater': return <MainMenuPrimaryPanel {...primaryPanel} parent="play" playChild="theater" active={active} />;
      case 'career': return <MainMenuPrimaryPanel {...primaryPanel} parent="system" systemChild="service" active={active} onOpenArmory={() => navigate('armory')} onOpenProfile={() => navigate('profile')} onFindMatch={() => navigate('online')} />;
      case 'create': return <CreateScreen onOpenAI={() => navigate('ai-editor')} />;
      case 'ai-editor': return <MainMenuPrimaryPanel {...primaryPanel} parent="play" playChild="single" singlePlayerMode="ai-editor" focusedSinglePlayer />;
      case 'settings': return <MenuSettingsScreen {...settingsOptions} game={primaryPanel} section={settingsSection} appVersion={header.appVersion} onSection={section => navigate('settings',section)} onNavigate={navigate} />;
      case 'profile': return <ProfileScreen {...broadcastRail} active={active} onOpenArmory={() => navigate('armory')} onOpenCareer={() => navigate('career')} onOpenSaves={() => navigate('settings','saves')} onOpenSocial={() => navigate('social')} />;
      case 'social': return <SocialScreen {...broadcastRail} onOpenProfile={() => navigate('profile')} onBrowseLobbies={() => { setOnlineRequest(previous => ({view:'browse',token:previous.token+1})); navigate('online'); }} />;
    }
  };

  if (!isVisible) {
    return null;
  }

  return (
    <>
      {showAdminDashboard && adminAccount?.isAdmin && (
        <AdminDashboard
          account={adminAccount}
          settings={adminDashboard.settings}
          onSettingChange={adminDashboard.onSettingChange}
          aiSections={AI_CUSTOM_KNOB_SECTIONS}
          mechanicsContent={
            <MechanicsSettingsGrid
              settings={adminDashboard.mechanicsSettings}
              setSettings={adminDashboard.setMechanicsSettings}
              collapsedSections={adminDashboard.collapsedSections}
              onToggleSection={adminDashboard.onToggleSection}
            />
          }
          multiplayerPreset={adminDashboard.multiplayerPreset}
          onPublish={adminDashboard.onPublish}
          isPublishing={adminDashboard.isPublishing}
          publishStatus={adminDashboard.publishStatus}
          botConfig={adminDashboard.botConfig}
          onBotConfigChange={adminDashboard.onBotConfigChange}
          onClose={adminDashboard.onClose}
        />
      )}

      <div className="match-menu" onKeyDown={event => {
        if (event.key !== 'Escape' || event.defaultPrevented || screen === 'play' || showAdminDashboard || primaryPanel.rebindingAction) return;
        const target = event.target as HTMLElement;
        if (target.closest('input,textarea,select,[role="dialog"],[contenteditable="true"]')) return;
        event.preventDefault(); navigation.onBack();
      }}>
        <header className="menu-header">
          <button className="menu-brand" onClick={() => navigate('play')} aria-label="iBrawls home">iBrawls<span>ARENA</span></button>
          <nav className="menu-primary-nav" aria-label="Main menu">{PRIMARY.map(([id,label]) => <button key={id} aria-current={selectedPrimary === id ? 'page' : undefined} onClick={() => navigate(id)}>{label}</button>)}</nav>
          <nav className="menu-utility-nav" aria-label="Player and settings">{UTILITIES.map(([id,label]) => <button key={id} aria-current={screen === id ? 'page' : undefined} onClick={() => navigate(id)}>{label}</button>)}</nav>
        </header>
        <div className="menu-body">
        <main className="menu-main">
          <div className="menu-page-heading"><div><span className="menu-eyebrow">{['training','tournament','online'].includes(screen) ? 'PLAY / ' : ''}{screen === 'play' ? 'READY WHEN YOU ARE' : screen === 'ai-editor' ? 'CREATE / AI LAB' : screen.toUpperCase()}</span><h1 ref={heading} tabIndex={-1}>{SCREEN_COPY[screen][0]}</h1><p>{SCREEN_COPY[screen][1]}</p></div><div className="menu-heading-actions">{childNav.isAdmin && screen === 'settings' && <button className="menu-secondary" onClick={childNav.onOpenAdminDashboard}>Admin dashboard</button>}{screen !== 'play' && <button className="menu-back" onClick={navigation.onBack}>← Back to {SCREEN_COPY[menuBackTarget(navigation.location)][0].replace('Choose your arena.','Play')}</button>}</div></div>
          <div className="menu-screen-stack">{RETAINED.filter(destination => visited.has(destination) || destination === screen).map(destination => <div className="menu-screen" key={destination} hidden={destination !== screen}>{panel(destination)}</div>)}{!RETAINED.includes(screen) && <div className="menu-screen" key={screen}>{panel(screen)}</div>}</div>
        </main>
        <MenuSocialPane {...broadcastRail} onOpenProfile={() => navigate('profile')} onOpenSocial={() => navigate('social')} />
        </div>
        <footer className="menu-footer"><span><i className="menu-status-dot" data-connected={broadcastRail.menuSocket?.readyState === 1} />{broadcastRail.menuSocket?.readyState === 1 ? `${header.onlineCount} online` : 'Local play available'}</span><span>Tab to navigate · Enter to select{screen !== 'play' ? ' · Esc to go back' : ''}</span><button onClick={() => navigate('settings','about')}>iBrawls / v{header.appVersion}</button></footer>
      </div>
    </>
  );
}
