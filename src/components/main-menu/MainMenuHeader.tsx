import type { DeviceInfo } from '../../types';
import type { MainMenuParent } from './useMainMenuNav';
import type { ReactNode } from 'react';

interface MainMenuHeaderProps {
  appVersion: string;
  deviceInfo: DeviceInfo;
  activeParent: MainMenuParent;
  isOnline: boolean;
  onlineCount: number;
  childNav?: ReactNode;
  onSelectParent: (parent: MainMenuParent) => void;
}

const PARENT_TABS: { id: MainMenuParent; label: string }[] = [
  { id: 'play', label: 'Play' },
  { id: 'customization', label: 'Customization' },
  { id: 'tools', label: 'Creative Tools' },
  { id: 'system', label: 'System' },
];

export const MainMenuHeader = ({
  appVersion,
  deviceInfo,
  activeParent,
  isOnline,
  onlineCount,
  childNav,
  onSelectParent,
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

    <div className="mobile-nav-cluster flex flex-col items-center gap-2 shrink-0">
      <div className="mobile-tabs flex bg-black/40 p-1.5 rounded-full border border-white/10 gap-2 select-none shrink-0 shadow-[inset_0_2px_4px_rgba(0,0,0,0.4)]">
        {PARENT_TABS.map((tab) => {
          const isTabActive = activeParent === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => onSelectParent(tab.id)}
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
      </div>

      {childNav}
    </div>

    <div className="mobile-online-pill" style={{ display: 'inline-flex', alignItems: 'center', gap: 8, background: 'rgba(16,185,129,0.10)', border: '1px solid rgba(16,185,129,0.30)', color: '#10b981', padding: '8px 16px', borderRadius: 9999, fontFamily: "'JetBrains Mono', monospace", fontWeight: 800, fontSize: 11, letterSpacing: '0.15em', textTransform: 'uppercase' }}>
      <span style={{ width: 8, height: 8, borderRadius: 9999, background: '#34d399', animation: 'pulse 1.4s infinite' }} />
      {isOnline ? `Online Players: ${onlineCount || 1}` : 'Offline Mode'}
    </div>
  </div>
);
