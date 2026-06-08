import React from 'react';
import AdminDashboard from '../AdminDashboard';
import { MechanicsSettingsGrid } from '../settings/MechanicsSettingsGrid';
import { AI_CUSTOM_KNOB_SECTIONS } from './aiMenuContent';
import { MainMenuBroadcastRail } from './MainMenuBroadcastRail';
import { MainMenuHeader } from './MainMenuHeader';
import { MainMenuPrimaryPanel } from './MainMenuPrimaryPanel';
import { MainMenuReferencePanel } from './MainMenuReferencePanel';

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
  layoutRef: React.RefObject<HTMLDivElement | null>;
  contentGridRef: React.RefObject<HTMLDivElement | null>;
  layoutStyle: React.CSSProperties;
  contentGridStyle: React.CSSProperties;
  chatStyle: React.CSSProperties;
  isPainting: boolean;
  shouldRenderCustomizationFrame: boolean;
  onCustomizationSplitterPointerDown: React.PointerEventHandler<HTMLButtonElement>;
  onChatSplitterPointerDown: React.PointerEventHandler<HTMLButtonElement>;
  primaryPanel: React.ComponentProps<typeof MainMenuPrimaryPanel>;
  referencePanel: React.ComponentProps<typeof MainMenuReferencePanel>;
  broadcastRail: Omit<React.ComponentProps<typeof MainMenuBroadcastRail>, 'style'>;
}

export function MainMenuOverlay({
  isVisible,
  showAdminDashboard,
  adminDashboard,
  header,
  layoutRef,
  contentGridRef,
  layoutStyle,
  contentGridStyle,
  chatStyle,
  isPainting,
  shouldRenderCustomizationFrame,
  onCustomizationSplitterPointerDown,
  onChatSplitterPointerDown,
  primaryPanel,
  referencePanel,
  broadcastRail,
}: MainMenuOverlayProps) {
  const adminAccount = adminDashboard.account;

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

      <div className="mobile-start-overlay absolute inset-0 z-50 flex items-stretch justify-center bg-slate-950/85 backdrop-blur-xl p-6 transition-all duration-300">
        <div className="mobile-menu-card w-full bg-slate-900/40 border border-white/10 rounded-3xl p-8 backdrop-blur-md flex flex-col gap-7 shadow-2xl select-none overflow-hidden">
          <MainMenuHeader {...header} />

          <div
            ref={layoutRef}
            className="mobile-menu-layout main-menu-dock-layout flex flex-1 min-h-0 overflow-hidden"
            style={layoutStyle}
          >
            <div
              ref={contentGridRef}
              className="mobile-content-grid main-menu-content-grid flex-1 grid min-h-0"
              style={contentGridStyle}
            >
              {!isPainting && <MainMenuPrimaryPanel {...primaryPanel} />}

              {shouldRenderCustomizationFrame && !isPainting && (
                <button
                  type="button"
                  className="main-menu-frame-splitter main-menu-frame-splitter-grid"
                  aria-label="Resize setup and customization frames"
                  title="Resize setup and customization frames"
                  onPointerDown={onCustomizationSplitterPointerDown}
                >
                  <span />
                </button>
              )}

              {shouldRenderCustomizationFrame && (
                <MainMenuReferencePanel {...referencePanel} />
              )}
            </div>

            <button
              type="button"
              className="main-menu-frame-splitter main-menu-frame-splitter-chat"
              aria-label="Resize content and chat frames"
              title="Resize content and chat frames"
              onPointerDown={onChatSplitterPointerDown}
            >
              <span />
            </button>

            <MainMenuBroadcastRail
              style={chatStyle}
              account={broadcastRail.account}
              playerName={broadcastRail.playerName}
              playerHue={broadcastRail.playerHue}
              onlineClients={broadcastRail.onlineClients}
              clientId={broadcastRail.clientId}
              connectionStatus={broadcastRail.connectionStatus}
              connectionMode={broadcastRail.connectionMode}
              menuSocket={broadcastRail.menuSocket}
              hostIdCode={broadcastRail.hostIdCode}
              lobbyChatMessages={broadcastRail.lobbyChatMessages}
              onPlayerNameChange={broadcastRail.onPlayerNameChange}
              onRegistered={broadcastRail.onRegistered}
              onLoggedIn={broadcastRail.onLoggedIn}
              onLoggedOut={broadcastRail.onLoggedOut}
              onAccountChanged={broadcastRail.onAccountChanged}
              onJoinGame={broadcastRail.onJoinGame}
              setInviteNotifications={broadcastRail.setInviteNotifications}
              onSendLobbyChatMessage={broadcastRail.onSendLobbyChatMessage}
            />
          </div>
        </div>
      </div>
    </>
  );
}
