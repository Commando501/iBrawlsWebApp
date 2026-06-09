import { Film, RotateCcw, Shield } from 'lucide-react';
import type { AccountInfo } from '../../services/account';
import type { DeviceInfo } from '../../types';
import type { MainMenuTab } from './useMainMenuFrameLayout';

interface MainMenuHeaderProps {
  appVersion: string;
  deviceInfo: DeviceInfo;
  account: AccountInfo | null;
  activeMenuTab: MainMenuTab;
  isPainting: boolean;
  showCustomizationFrame: boolean;
  isOnline: boolean;
  onlineCount: number;
  onMenuTabChange: (tab: MainMenuTab) => void;
  onToggleCustomizationFrame: () => void;
  onOpenAdminDashboard: () => void;
  onResetFrameLayout: () => void;
}

const MENU_TABS: { id: MainMenuTab; label: string }[] = [
  { id: 'single', label: 'Single Player' },
  { id: 'multi', label: 'Multiplayer' },
  { id: 'spec', label: 'Spectator' },
  { id: 'theater', label: 'Theater' },
];

export const MainMenuHeader = ({
  appVersion,
  deviceInfo,
  account,
  activeMenuTab,
  isPainting,
  showCustomizationFrame,
  isOnline,
  onlineCount,
  onMenuTabChange,
  onToggleCustomizationFrame,
  onOpenAdminDashboard,
  onResetFrameLayout,
}: MainMenuHeaderProps) => (
  <div className="mobile-menu-header flex flex-wrap justify-between items-center gap-6 border-b border-white/10 pb-5 shrink-0">
    <div className="mobile-brand flex items-center gap-4">
      <h1 style={{ fontFamily: 'Inter, sans-serif', fontSize: 36, fontWeight: 900, fontStyle: 'italic', letterSpacing: '-0.03em', background: 'linear-gradient(180deg, #fff, #94a3b8)', WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent', margin: 0, lineHeight: 1, paddingRight: 16 }}>
        iBrawls
      </h1>
      <span style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 11, fontWeight: 700, letterSpacing: '0.2em', textTransform: 'uppercase', color: '#38bdf8', background: 'rgba(56,189,248,0.05)', border: '1px solid rgba(56,189,248,0.30)', padding: '6px 12px', borderRadius: 4 }}>
        Voxel Grifball Tech Demo
      </span>
      <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, fontWeight: 700, letterSpacing: '0.15em', color: 'rgba(255,255,255,0.35)', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.10)', padding: '5px 10px', borderRadius: 4 }}>
        v{appVersion}
      </span>
      {deviceInfo.isMobile && (
        <span style={{
          fontFamily: "'Space Grotesk', sans-serif",
          fontSize: 10,
          fontWeight: 700,
          letterSpacing: '0.1em',
          textTransform: 'uppercase',
          color: deviceInfo.os === 'ios' ? '#ff4d4d' : '#34d399',
          background: deviceInfo.os === 'ios' ? 'rgba(255,77,77,0.08)' : 'rgba(52,211,153,0.08)',
          border: deviceInfo.os === 'ios' ? '1px solid rgba(255,77,77,0.30)' : '1px solid rgba(52,211,153,0.30)',
          padding: '5px 10px',
          borderRadius: 4,
          boxShadow: deviceInfo.os === 'ios' ? '0 0 10px rgba(255,77,77,0.15)' : '0 0 10px rgba(52,211,153,0.15)',
          display: 'inline-flex',
          alignItems: 'center',
          gap: '4px',
        }}>
          {deviceInfo.os === 'ios' ? '🍏 iOS Web Client' : deviceInfo.os === 'android' ? '🤖 Android Web Client' : '📱 Mobile Client'}
        </span>
      )}
    </div>

    <div className="mobile-tabs flex bg-black/40 p-1.5 rounded-full border border-white/10 gap-2 select-none shrink-0 shadow-[inset_0_2px_4px_rgba(0,0,0,0.4)]">
      {MENU_TABS.map((tab) => {
        const isTabActive = !isPainting && activeMenuTab === tab.id;
        return (
          <button
            key={tab.id}
            onClick={() => onMenuTabChange(tab.id)}
            className={`px-5 py-2 rounded-full text-xs font-bold font-display uppercase tracking-wider transition-all duration-200 cursor-pointer ${
              isTabActive
                ? 'bg-gradient-to-b from-[#22d3ee] to-[#0891b2] text-white shadow-[0_0_12px_rgba(34,211,238,0.60)] font-black'
                : 'text-white/50 hover:text-white/80'
            }`}
          >
            {tab.label}
          </button>
        );
      })}

      <button
        type="button"
        id="customization-frame-toggle"
        onClick={onToggleCustomizationFrame}
        className={`px-5 py-2 rounded-full text-xs font-bold font-display uppercase tracking-wider transition-all duration-200 cursor-pointer border flex items-center gap-1.5 ${
          showCustomizationFrame
            ? 'bg-gradient-to-b from-[#22d3ee] to-[#0891b2] text-white shadow-[0_0_12px_rgba(34,211,238,0.60)] border-cyan-300/30 font-black'
            : 'text-white/50 hover:text-white/80 border-white/10 hover:border-cyan-500/30'
        }`}
        aria-pressed={showCustomizationFrame}
      >
        Customization
      </button>

      <a
        href="/mapmaker.html"
        target="_blank"
        rel="noopener noreferrer"
        className="px-5 py-2 rounded-full text-xs font-bold font-display uppercase tracking-wider transition-all duration-200 cursor-pointer text-[#38bdf8] hover:text-cyan-200 hover:bg-cyan-950/20 flex items-center gap-1.5 border border-cyan-500/20 hover:border-cyan-500/40"
      >
        🛠️ Map Maker
      </a>

      <a
        href="/animation-editor.html"
        target="_blank"
        rel="noopener noreferrer"
        className="px-5 py-2 rounded-full text-xs font-bold font-display uppercase tracking-wider transition-all duration-200 cursor-pointer text-[#38bdf8] hover:text-cyan-200 hover:bg-cyan-950/20 flex items-center gap-1.5 border border-cyan-500/20 hover:border-cyan-500/40"
      >
        <Film className="w-3.5 h-3.5" />
        Animation Editor
      </a>

      <a
        href="/armor-model-editor.html"
        target="_blank"
        rel="noopener noreferrer"
        className="px-5 py-2 rounded-full text-xs font-bold font-display uppercase tracking-wider transition-all duration-200 cursor-pointer text-purple-200 hover:text-purple-100 hover:bg-purple-950/20 flex items-center gap-1.5 border border-purple-500/25 hover:border-purple-400/50"
      >
        <Shield className="w-3.5 h-3.5" />
        Armor Editor
      </a>

      {account?.isAdmin && (
        <button
          onClick={onOpenAdminDashboard}
          className="px-5 py-2 rounded-full text-xs font-bold font-display uppercase tracking-wider transition-all duration-200 cursor-pointer text-amber-300 hover:text-amber-100 hover:bg-amber-950/20 flex items-center gap-1.5 border border-amber-500/30 hover:border-amber-500/50"
        >
          ⚙️ Admin Dashboard
        </button>
      )}
    </div>

    <button
      type="button"
      id="reset-main-menu-frame-layout"
      onClick={onResetFrameLayout}
      className="mobile-frame-reset inline-flex items-center justify-center gap-2 px-3.5 py-2 rounded-full border border-white/10 bg-white/[0.04] text-white/55 hover:text-cyan-200 hover:border-cyan-500/35 hover:bg-cyan-950/20 text-[10px] font-black uppercase tracking-widest transition-all cursor-pointer shrink-0"
      title="Reset main menu frame sizes"
    >
      <RotateCcw className="w-3.5 h-3.5" />
      Reset Frame Layout
    </button>

    <div className="mobile-online-pill" style={{ display: 'inline-flex', alignItems: 'center', gap: 8, background: 'rgba(16,185,129,0.10)', border: '1px solid rgba(16,185,129,0.30)', color: '#10b981', padding: '8px 16px', borderRadius: 9999, fontFamily: "'JetBrains Mono', monospace", fontWeight: 800, fontSize: 11, letterSpacing: '0.15em', textTransform: 'uppercase' }}>
      <span style={{ width: 8, height: 8, borderRadius: 9999, background: '#34d399', animation: 'pulse 1.4s infinite' }} />
      {isOnline ? `Online Players: ${onlineCount || 1}` : 'Offline Mode'}
    </div>
  </div>
);
