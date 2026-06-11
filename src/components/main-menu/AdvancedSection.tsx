import { useCallback, useState, type ReactNode } from 'react';

const ADVANCED_OPEN_STORAGE_KEY = 'ibrawls_menu_advanced_open_v1';

function loadOpenSections(): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(ADVANCED_OPEN_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === 'object' ? parsed as Record<string, boolean> : {};
  } catch {
    return {};
  }
}

function persistOpenSection(sectionId: string, open: boolean) {
  try {
    const next = { ...loadOpenSections(), [sectionId]: open };
    localStorage.setItem(ADVANCED_OPEN_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Persistence is best-effort; the in-memory toggle still works.
  }
}

interface AdvancedSectionProps {
  sectionId: string;
  title: string;
  /** Small hint rendered right-aligned in the summary row. */
  badge?: string;
  /** Keeps the section expanded regardless of the user's stored preference. */
  forceOpen?: boolean;
  children: ReactNode;
}

export function AdvancedSection({
  sectionId,
  title,
  badge,
  forceOpen = false,
  children,
}: AdvancedSectionProps) {
  const [isOpen, setIsOpen] = useState<boolean>(() => !!loadOpenSections()[sectionId]);
  const open = forceOpen || isOpen;

  const toggle = useCallback(() => {
    setIsOpen((previous) => {
      const next = !(forceOpen || previous);
      persistOpenSection(sectionId, next);
      return next;
    });
  }, [forceOpen, sectionId]);

  return (
    <div className="bg-white/[0.03] border border-white/5 rounded-lg">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        className="w-full flex justify-between items-center px-3.5 py-3 text-xs text-[#38bdf8] font-bold uppercase tracking-wider cursor-pointer select-none hover:text-white transition-colors"
      >
        <span>{title}</span>
        <span className="ml-auto flex items-center gap-2 pl-3">
          {badge && <span className="text-[9px] font-mono text-white/30 normal-case tracking-widest">{badge}</span>}
          <span className={`text-[10px] transition-transform font-sans ${open ? 'rotate-180' : ''}`}>v</span>
        </span>
      </button>
      {open && (
        <div className="flex flex-col gap-3 px-3.5 pb-3.5">
          {children}
        </div>
      )}
    </div>
  );
}
