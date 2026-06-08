import { useCallback, useState } from 'react';

export const COLLAPSED_SECTIONS_STORAGE_KEY = 'grifball_collapsed_sections';

interface CollapsedSectionsStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export type CollapsedSections = Record<string, boolean>;

export function loadCollapsedSections(storage: Pick<CollapsedSectionsStorage, 'getItem'> = localStorage): CollapsedSections {
  try {
    const saved = storage.getItem(COLLAPSED_SECTIONS_STORAGE_KEY);
    return saved ? JSON.parse(saved) : {};
  } catch {
    return {};
  }
}

export function persistCollapsedSections(
  sections: CollapsedSections,
  storage: Pick<CollapsedSectionsStorage, 'setItem'> = localStorage
): void {
  try {
    storage.setItem(COLLAPSED_SECTIONS_STORAGE_KEY, JSON.stringify(sections));
  } catch {
    /* best effort */
  }
}

export function toggleCollapsedSection(sections: CollapsedSections, sectionId: string): CollapsedSections {
  return {
    ...sections,
    [sectionId]: !sections[sectionId],
  };
}

export function useMainMenuAdminState() {
  const [showAdminDashboard, setShowAdminDashboard] = useState(false);
  const [collapsedSections, setCollapsedSections] = useState<CollapsedSections>(() => loadCollapsedSections());

  const closeAdminDashboard = useCallback(() => {
    setShowAdminDashboard(false);
  }, []);

  const toggleSectionCollapse = useCallback((sectionId: string) => {
    setCollapsedSections((prev) => {
      const next = toggleCollapsedSection(prev, sectionId);
      persistCollapsedSections(next);
      return next;
    });
  }, []);

  return {
    showAdminDashboard,
    setShowAdminDashboard,
    closeAdminDashboard,
    collapsedSections,
    setCollapsedSections,
    toggleSectionCollapse,
  };
}
