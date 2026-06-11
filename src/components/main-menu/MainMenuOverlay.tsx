import React from 'react';
import AdminDashboard from '../AdminDashboard';
import { MechanicsSettingsGrid } from '../settings/MechanicsSettingsGrid';
import { AI_CUSTOM_KNOB_SECTIONS } from './aiMenuContent';
import { MainMenuBroadcastRail } from './MainMenuBroadcastRail';
import { MainMenuChildNav } from './MainMenuChildNav';
import { MainMenuHeader } from './MainMenuHeader';
import { MainMenuPrimaryPanel } from './MainMenuPrimaryPanel';

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
}

export function MainMenuOverlay({
  isVisible,
  showAdminDashboard,
  adminDashboard,
  header,
  childNav,
  primaryPanel,
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
        <div className="mobile-menu-card w-full bg-slate-900/40 border border-white/10 rounded-3xl p-8 backdrop-blur-md flex flex-col gap-5 shadow-2xl select-none overflow-hidden">
          <MainMenuHeader
            {...header}
            childNav={<MainMenuChildNav {...childNav} />}
          />

          <div className="mobile-menu-layout main-menu-dock-layout flex flex-1 min-h-0 overflow-hidden gap-6">
            <div className="mobile-content-grid main-menu-content-frame flex-1 min-w-0 min-h-0 flex">
              <MainMenuPrimaryPanel {...primaryPanel} />
            </div>

            <MainMenuBroadcastRail {...broadcastRail} />
          </div>
        </div>
      </div>
    </>
  );
}
