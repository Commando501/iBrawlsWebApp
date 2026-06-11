import { Film, Map, Shield } from 'lucide-react';
import type { CustomizationChild, MainMenuParent, MainMenuTab } from './useMainMenuNav';

interface MainMenuChildNavProps {
  parent: MainMenuParent;
  playChild: MainMenuTab;
  customizationChild: CustomizationChild;
  isAdmin: boolean;
  onSelectPlayChild: (child: MainMenuTab) => void;
  onSelectCustomizationChild: (child: CustomizationChild) => void;
  onOpenAdminDashboard: () => void;
}

const PLAY_CHILDREN: { id: MainMenuTab; label: string }[] = [
  { id: 'single', label: 'Single Player' },
  { id: 'multi', label: 'Multiplayer' },
  { id: 'theater', label: 'Theater' },
];

const CUSTOMIZATION_CHILDREN: { id: CustomizationChild; label: string }[] = [
  { id: 'armory', label: 'Armory' },
  { id: 'hotkeys', label: 'Hotkeys' },
  { id: 'gamepad', label: 'Gamepad' },
];

const childButtonClass = (isActive: boolean) =>
  `px-5 py-2 rounded-full text-xs font-bold font-display uppercase tracking-wider transition-all duration-200 cursor-pointer ${
    isActive
      ? 'bg-gradient-to-b from-[#22d3ee] to-[#0891b2] text-white shadow-[0_0_12px_rgba(34,211,238,0.60)] font-black'
      : 'text-white/50 hover:text-white/80'
  }`;

const childLinkClass = 'px-5 py-2 rounded-full text-xs font-bold font-display uppercase tracking-wider transition-all duration-200 cursor-pointer flex items-center justify-center gap-1.5 border';

export function MainMenuChildNav({
  parent,
  playChild,
  customizationChild,
  isAdmin,
  onSelectPlayChild,
  onSelectCustomizationChild,
  onOpenAdminDashboard,
}: MainMenuChildNavProps) {
  return (
    <div className="main-menu-child-nav flex bg-black/30 p-1.5 rounded-full border border-white/5 gap-2 select-none shrink-0 shadow-[inset_0_1px_3px_rgba(0,0,0,0.3)]">
      {parent === 'play' && PLAY_CHILDREN.map((child) => (
        <button
          key={child.id}
          type="button"
          onClick={() => onSelectPlayChild(child.id)}
          className={childButtonClass(playChild === child.id)}
        >
          {child.label}
        </button>
      ))}

      {parent === 'customization' && CUSTOMIZATION_CHILDREN.map((child) => (
        <button
          key={child.id}
          type="button"
          onClick={() => onSelectCustomizationChild(child.id)}
          className={childButtonClass(customizationChild === child.id)}
        >
          {child.label}
        </button>
      ))}

      {parent === 'tools' && (
        <>
          <a
            href="/mapmaker.html"
            target="_blank"
            rel="noopener noreferrer"
            className={`${childLinkClass} text-[#38bdf8] hover:text-cyan-200 hover:bg-cyan-950/20 border-cyan-500/20 hover:border-cyan-500/40`}
          >
            <Map className="w-3.5 h-3.5" />
            Map Maker
          </a>
          <a
            href="/animation-editor.html"
            target="_blank"
            rel="noopener noreferrer"
            className={`${childLinkClass} text-[#38bdf8] hover:text-cyan-200 hover:bg-cyan-950/20 border-cyan-500/20 hover:border-cyan-500/40`}
          >
            <Film className="w-3.5 h-3.5" />
            Animation Editor
          </a>
          <a
            href="/armor-model-editor.html"
            target="_blank"
            rel="noopener noreferrer"
            className={`${childLinkClass} text-purple-200 hover:text-purple-100 hover:bg-purple-950/20 border-purple-500/25 hover:border-purple-400/50`}
          >
            <Shield className="w-3.5 h-3.5" />
            Armor Editor
          </a>
        </>
      )}

      {parent === 'system' && (
        <>
          <button type="button" className={childButtonClass(true)}>
            Save Codes
          </button>
          {isAdmin && (
            <button
              type="button"
              onClick={onOpenAdminDashboard}
              className={`${childLinkClass} text-amber-300 hover:text-amber-100 hover:bg-amber-950/20 border-amber-500/30 hover:border-amber-500/50`}
            >
              ⚙️ Admin Dashboard
            </button>
          )}
        </>
      )}
    </div>
  );
}
