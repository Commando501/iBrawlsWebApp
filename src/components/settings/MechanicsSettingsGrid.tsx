import React from 'react';
import type { UniversalSettings } from '../../types';
import {
  SETTING_DEFINITIONS,
  SETTING_SECTIONS,
  type SettingDefinition,
  type SettingSection,
} from '../../settings/settingsSchema';

interface MechanicsSettingsGridProps {
  settings: UniversalSettings;
  setSettings: React.Dispatch<React.SetStateAction<UniversalSettings>>;
  collapsedSections: Record<string, boolean>;
  onToggleSection: (sectionId: string) => void;
  className?: string;
}

const MECHANICS_EXCLUDED_SECTIONS = new Set(['ai', 'aitune']);

const getSectionAccentClass = (sectionId: string) => {
  if (sectionId === 'hammer') return 'accent-amber-400';
  if (sectionId === 'launch') return 'accent-yellow-400';
  if (sectionId === 'trades') return 'accent-red-500';
  if (sectionId === 'sword') return 'accent-[#22d3ee]';
  return 'accent-[#38bdf8]';
};

const getSectionTextClass = (sectionId: string) => {
  if (sectionId === 'hammer') return 'text-amber-400';
  if (sectionId === 'launch') return 'text-yellow-400';
  if (sectionId === 'trades') return 'text-red-400';
  if (sectionId === 'sword') return 'text-[#22d3ee]';
  return 'text-[#38bdf8]';
};

const getSectionSelectTextClass = (sectionId: string) => {
  if (sectionId === 'hammer') return 'text-amber-300';
  if (sectionId === 'launch') return 'text-yellow-300';
  if (sectionId === 'sword') return 'text-[#22d3ee]';
  return 'text-[#38bdf8]';
};

const getSectionFocusClass = (sectionId: string) => {
  if (sectionId === 'hammer') return 'focus:border-amber-400';
  if (sectionId === 'launch') return 'focus:border-yellow-400';
  if (sectionId === 'sword') return 'focus:border-[#22d3ee]';
  return 'focus:border-[#38bdf8]';
};

const getSectionToggleClass = (sectionId: string) => {
  if (sectionId === 'hammer') return 'bg-amber-400';
  if (sectionId === 'launch') return 'bg-yellow-400';
  if (sectionId === 'trades') return 'bg-red-500';
  if (sectionId === 'sword') return 'bg-[#22d3ee]';
  return 'bg-[#38bdf8]';
};

function MechanicsSettingControl({
  definition,
  settings,
  setSettings,
}: {
  definition: SettingDefinition;
  settings: UniversalSettings;
  setSettings: React.Dispatch<React.SetStateAction<UniversalSettings>>;
}) {
  const value = settings[definition.key];

  switch (definition.type) {
    case 'slider': {
      const displayValue = definition.formatValue ? definition.formatValue(value) : `${value}${definition.unit || ''}`;
      const accentClass = getSectionAccentClass(definition.sectionId);
      const colorClass = getSectionTextClass(definition.sectionId);

      return (
        <div key={definition.key} className="flex flex-col gap-1">
          <div className="flex justify-between text-[11px] font-bold uppercase tracking-wider text-white/80">
            <span>{definition.label}</span>
            <span className={`${colorClass} font-mono`}>{displayValue}</span>
          </div>
          <input
            type="range"
            min={definition.min}
            max={definition.max}
            step={definition.step}
            value={(value as number) ?? 0}
            onChange={(event) => setSettings((prev) => ({ ...prev, [definition.key]: parseFloat(event.target.value) }))}
            className={`w-full ${accentClass} h-1 bg-white/10 rounded-lg appearance-none cursor-pointer`}
          />
        </div>
      );
    }

    case 'toggle': {
      const activeColorClass = getSectionToggleClass(definition.sectionId);

      return (
        <div key={definition.key} className="flex justify-between items-center text-xs pt-1.5 border-t border-white/5">
          <div className="flex flex-col text-left">
            <span className="font-bold text-white/90 font-mono text-[10px]">{definition.label}</span>
            {definition.description && <span className="text-[9px] text-white/40 font-mono">{definition.description}</span>}
          </div>
          <button
            onClick={() => setSettings((prev) => ({ ...prev, [definition.key]: !prev[definition.key] }))}
            className={`relative inline-flex h-4 w-8 shrink-0 cursor-pointer rounded-full border border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
              value ? activeColorClass : 'bg-white/10'
            }`}
          >
            <span className={`pointer-events-none inline-block h-3.5 w-3.5 transform rounded-full bg-slate-900 shadow transition duration-200 ease-in-out ${
              value ? 'translate-x-4' : 'translate-x-0'
            }`} />
          </button>
        </div>
      );
    }

    case 'stepper': {
      const step = definition.step ?? 1;
      const displayValue = definition.formatValue ? definition.formatValue(value) : `${value}${definition.unit || ''}`;

      return (
        <div key={definition.key} className="flex items-center justify-between text-xs py-0.5 border-t border-white/5 first:border-t-0">
          <div className="flex flex-col text-left">
            <span className="font-bold text-white/90">{definition.label}</span>
            {definition.description && <span className="text-[9px] text-white/40">{definition.description}</span>}
          </div>
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => setSettings((prev) => {
                const currentVal = (prev[definition.key] as number) ?? definition.min ?? 0;
                const newVal = Math.max(definition.min ?? currentVal, parseFloat((currentVal - step).toFixed(2)));
                return { ...prev, [definition.key]: newVal };
              })}
              className="w-7 h-7 rounded bg-white/10 hover:bg-white/20 active:scale-90 flex items-center justify-center font-bold text-sm transition-all cursor-pointer select-none"
            >
              -
            </button>
            <span className="font-mono text-xs font-bold text-[#38bdf8] w-12 text-center bg-black/40 py-0.5 rounded border border-white/5">
              {displayValue}
            </span>
            <button
              onClick={() => setSettings((prev) => {
                const currentVal = (prev[definition.key] as number) ?? definition.min ?? 0;
                const newVal = Math.min(definition.max ?? currentVal, parseFloat((currentVal + step).toFixed(2)));
                return { ...prev, [definition.key]: newVal };
              })}
              className="w-7 h-7 rounded bg-white/10 hover:bg-white/20 active:scale-90 flex items-center justify-center font-bold text-sm transition-all cursor-pointer select-none"
            >
              +
            </button>
          </div>
        </div>
      );
    }

    case 'select': {
      const colorClass = getSectionSelectTextClass(definition.sectionId);
      const focusClass = getSectionFocusClass(definition.sectionId);

      return (
        <div key={definition.key} className="flex flex-col gap-1">
          <div className="flex justify-between text-[11px] font-bold uppercase tracking-wider text-white/80">
            <span>{definition.label}</span>
            <span className={`${colorClass} font-mono`}>
              {definition.formatValue ? definition.formatValue(value) : value}
            </span>
          </div>
          <select
            value={value as string}
            onChange={(event) => setSettings((prev) => ({ ...prev, [definition.key]: event.target.value }))}
            className={`w-full h-8 bg-black/60 border border-white/10 rounded px-2 text-[11px] ${colorClass} font-bold uppercase outline-none ${focusClass} cursor-pointer transition-all font-sans`}
          >
            {definition.options?.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </div>
      );
    }

    case 'color': {
      const colorVal = (value as string) || '#00ffff';

      return (
        <div key={definition.key} className="flex justify-between items-center text-xs pt-1.5 border-t border-white/5 gap-2">
          <div className="flex flex-col text-left">
            <span className="font-bold text-white/90">{definition.label}</span>
            {definition.description && <span className="text-[9px] text-white/40">{definition.description}</span>}
          </div>
          <div className="flex items-center gap-2">
            <input
              type="color"
              value={colorVal}
              onChange={(event) => setSettings((prev) => ({ ...prev, [definition.key]: event.target.value }))}
              className="w-8 h-8 rounded border border-white/20 bg-transparent cursor-pointer p-0 animate-fade-in"
              title="Choose Color"
            />
            <input
              type="text"
              value={colorVal}
              onChange={(event) => setSettings((prev) => ({ ...prev, [definition.key]: event.target.value }))}
              className="w-20 h-7 bg-black/40 border border-white/10 rounded px-2 font-mono text-[10px] tracking-wide text-white focus:border-[#38bdf8] outline-none text-center"
            />
          </div>
        </div>
      );
    }

    default:
      return null;
  }
}

function MechanicsSettingsSection({
  section,
  settings,
  setSettings,
  collapsedSections,
  onToggleSection,
}: {
  section: SettingSection;
  settings: UniversalSettings;
  setSettings: React.Dispatch<React.SetStateAction<UniversalSettings>>;
  collapsedSections: Record<string, boolean>;
  onToggleSection: (sectionId: string) => void;
}) {
  const sectionSettings = SETTING_DEFINITIONS.filter((definition) => definition.sectionId === section.id);
  const visibleSettings = sectionSettings.filter((definition) => !definition.showIf || definition.showIf(settings));

  if (visibleSettings.length === 0) return null;

  const isCollapsed = !!collapsedSections[section.id];
  const baseClass = section.bgClass || 'border border-white/5 rounded-xl p-2.5 bg-white/1 flex flex-col gap-2.5';

  return (
    <div key={section.id} className={baseClass}>
      <button
        type="button"
        onClick={() => onToggleSection(section.id)}
        className={`w-full text-[10px] ${section.colorClass} font-bold uppercase tracking-widest border-b border-white/5 pb-1 font-mono flex items-center justify-between cursor-pointer bg-transparent border-x-0 border-t-0 p-0 outline-none select-none transition-colors hover:brightness-125`}
      >
        <span className="flex items-center gap-1.5">
          <svg
            className="w-3 h-3 transition-transform duration-200 shrink-0"
            style={{ transform: isCollapsed ? 'rotate(-90deg)' : 'rotate(0deg)' }}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M19 9l-7 7-7-7" />
          </svg>
          {section.title}
        </span>
        <span className="flex items-center gap-1.5">
          {section.badge && (
            <span className={`text-[8px] ${section.badgeClass} px-1.5 py-0.2 rounded font-sans tracking-normal uppercase border`}>
              {section.badge}
            </span>
          )}
          <span className={`text-[8px] font-mono transition-opacity duration-200 ${isCollapsed ? 'opacity-50 text-white/40' : 'opacity-0'}`}>
            {visibleSettings.length}
          </span>
        </span>
      </button>

      <div
        className="overflow-hidden transition-all duration-250 ease-in-out"
        style={{
          maxHeight: isCollapsed ? 0 : '2000px',
          opacity: isCollapsed ? 0 : 1,
          marginTop: isCollapsed ? 0 : undefined,
        }}
      >
        <div className="flex flex-col gap-2.5">
          {visibleSettings.map((definition) => (
            <React.Fragment key={definition.key}>
              <MechanicsSettingControl
                definition={definition}
                settings={settings}
                setSettings={setSettings}
              />
            </React.Fragment>
          ))}
        </div>
      </div>
    </div>
  );
}

export function MechanicsSettingsGrid({
  settings,
  setSettings,
  collapsedSections,
  onToggleSection,
  className = 'grid grid-cols-1 md:grid-cols-3 gap-3 text-left',
}: MechanicsSettingsGridProps) {
  const renderColumn = (column: SettingSection['column']) => (
    <div className="flex flex-col gap-3">
      {SETTING_SECTIONS
        .filter((section) => section.column === column && !MECHANICS_EXCLUDED_SECTIONS.has(section.id))
        .map((section) => (
          <React.Fragment key={section.id}>
            <MechanicsSettingsSection
              section={section}
              settings={settings}
              setSettings={setSettings}
              collapsedSections={collapsedSections}
              onToggleSection={onToggleSection}
            />
          </React.Fragment>
        ))}
    </div>
  );

  return (
    <div className={className}>
      {renderColumn(1)}
      {renderColumn(2)}
      {renderColumn(3)}
    </div>
  );
}
