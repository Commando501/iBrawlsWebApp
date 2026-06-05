import React from 'react';
import { LiveConfig } from '../services/liveConfig';
import { AccountInfo } from '../services/account';

/**
 * Admin Dashboard — an admin-only, full-screen control surface for governing
 * multiplayer. It is reachable from the header "Admin Dashboard" button, which
 * only renders for accounts with `isAdmin`. Three areas:
 *   1. Multiplayer Game Mechanics — publish the current ruleset as the Official
 *      Multiplayer Preset (live tuning), now gated by the admin's session.
 *   2. Multiplayer AI Tuning — the same AI "feel" knobs used in single player,
 *      bound to `settings`; whatever is set here is baked into the published preset.
 *   3. Multiplayer Bots — placeholder config (not yet wired to gameplay).
 *
 * The component is presentational: App owns `settings`/publish state and passes
 * the AI knob section metadata so we reuse the single source of truth rather than
 * re-declaring sliders.
 */

export interface MultiplayerBotConfig {
  enabled: boolean;
  count: number;
  difficulty: number;
}

export const DEFAULT_BOT_CONFIG: MultiplayerBotConfig = { enabled: false, count: 2, difficulty: 50 };

interface KnobEntry {
  key: string;
  label: string;
  min: number;
  max: number;
  step: number;
  def: number;
  fmt: (v: number | undefined) => string;
  desc: string;
}

interface KnobSection {
  title: string;
  expert?: boolean;
  entries: KnobEntry[];
}

interface Props {
  account: AccountInfo;
  /** Current adminSettings (live multiplayer ruleset source). */
  settings: Record<string, unknown>;
  /** Update one numeric mechanic/AI knob. */
  onSettingChange: (key: string, value: number) => void;
  /** AI knob section metadata (App's AI_CUSTOM_KNOB_SECTIONS). */
  aiSections: KnobSection[];
  /** Currently-published Official Multiplayer Preset, if any. */
  multiplayerPreset: LiveConfig | null;
  onPublish: () => void;
  isPublishing: boolean;
  publishStatus: { ok: boolean; msg: string } | null;
  botConfig: MultiplayerBotConfig;
  onBotConfigChange: (next: MultiplayerBotConfig) => void;
  onClose: () => void;
}

const cardCls =
  'flex flex-col gap-4 bg-slate-950/60 border border-white/10 rounded-2xl p-5 shadow-[inset_0_1px_3px_rgba(0,0,0,0.4)]';
const sectionTitleCls =
  'text-xs font-black uppercase tracking-widest font-mono flex items-center gap-2';

const AdminDashboard: React.FC<Props> = ({
  account,
  settings,
  onSettingChange,
  aiSections,
  multiplayerPreset,
  onPublish,
  isPublishing,
  publishStatus,
  botConfig,
  onBotConfigChange,
  onClose,
}) => {
  // Only the curated, player-facing AI knobs — expert tuning groups stay out of
  // the admin multiplayer surface to keep it focused.
  const curatedAiSections = aiSections.filter((s) => !s.expert);

  return (
    <div className="fixed inset-0 z-[60] overflow-y-auto bg-gradient-to-b from-[#0a0f1c] to-[#05080f] text-left">
      <div className="max-w-6xl mx-auto px-6 py-8 flex flex-col gap-6">
        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-white/10 pb-5">
          <div className="flex items-center gap-3">
            <h1
              style={{ fontFamily: 'Inter, sans-serif', fontWeight: 900, fontStyle: 'italic', letterSpacing: '-0.03em' }}
              className="text-3xl text-white"
            >
              Admin Dashboard
            </h1>
            <span className="text-[9px] font-black text-amber-300 bg-amber-500/15 border border-amber-500/40 px-2 py-1 rounded uppercase tracking-widest font-mono">
              ★ {account.username}
            </span>
          </div>
          <button
            onClick={onClose}
            className="h-10 px-5 bg-white/5 hover:bg-white/10 border border-white/10 hover:border-white/25 text-white/70 text-xs font-bold uppercase tracking-wider rounded-lg cursor-pointer transition-all"
          >
            ✕ Back to Menu
          </button>
        </div>

        <p className="text-[11px] text-white/40 leading-snug -mt-2">
          Govern the multiplayer experience. Mechanics and AI tuning set here are published as the
          Official Multiplayer Preset and pushed to every peer-to-peer match (live tuning). Player
          identity (name/hue) is never included.
        </p>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* 1. Multiplayer Game Mechanics — publish */}
          <div className={cardCls}>
            <span className={`${sectionTitleCls} text-[#38bdf8]`}>🛰️ Multiplayer Game Mechanics</span>
            <p className="text-[11px] text-white/45 leading-snug">
              Publish the current gameplay ruleset (configured in the Sandbox settings panel) as the
              live Official Multiplayer Preset. Every connected match adopts it.
            </p>
            <div className="flex items-center justify-between bg-black/40 border border-white/10 rounded-lg px-3 py-2">
              <span className="text-[10px] uppercase tracking-widest font-mono text-white/40">
                Currently Published
              </span>
              <span className="text-xs font-mono text-cyan-400 font-bold">
                {multiplayerPreset
                  ? `v${multiplayerPreset.version}${multiplayerPreset.label ? ` · ${multiplayerPreset.label}` : ''}`
                  : 'None yet'}
              </span>
            </div>
            <button
              onClick={onPublish}
              disabled={isPublishing}
              className={`h-11 rounded-lg text-xs font-black uppercase tracking-widest transition-all flex items-center justify-center gap-2 ${
                isPublishing
                  ? 'bg-white/5 border border-white/5 text-white/20 cursor-not-allowed'
                  : 'bg-amber-500/20 hover:bg-amber-500/40 border border-amber-500/40 text-amber-300 cursor-pointer active:scale-[0.98]'
              }`}
            >
              {isPublishing ? 'Publishing…' : 'Publish Current Ruleset as Official Preset'}
            </button>
            {publishStatus && (
              <span className={`text-[10px] font-mono ${publishStatus.ok ? 'text-emerald-400' : 'text-red-400'}`}>
                {publishStatus.msg}
              </span>
            )}
          </div>

          {/* 3. Multiplayer Bots — placeholder */}
          <div className={cardCls}>
            <span className={`${sectionTitleCls} text-fuchsia-300`}>
              🤖 Multiplayer Bots
              <span className="text-[9px] font-bold text-white/30 bg-white/5 border border-white/10 px-1.5 py-0.5 rounded normal-case tracking-normal">
                Coming soon
              </span>
            </span>
            <p className="text-[11px] text-white/45 leading-snug">
              Let players add AI bots to their multiplayer games. These controls are saved but not
              yet wired into matches — bot spawning ships in a follow-up.
            </p>
            <label className="flex items-center justify-between bg-black/40 border border-white/10 rounded-lg px-3 py-2.5">
              <span className="text-xs font-mono uppercase tracking-wider text-white/60">Enable Bots</span>
              <button
                onClick={() => onBotConfigChange({ ...botConfig, enabled: !botConfig.enabled })}
                className={`px-4 h-7 text-[10px] font-bold uppercase rounded cursor-pointer transition-all border ${
                  botConfig.enabled
                    ? 'bg-fuchsia-500/20 border-fuchsia-500/50 text-fuchsia-300'
                    : 'bg-black/40 border-white/10 text-white/50 hover:text-white/80'
                }`}
              >
                {botConfig.enabled ? 'On' : 'Off'}
              </button>
            </label>
            <div className={`flex flex-col gap-4 transition-opacity ${botConfig.enabled ? '' : 'opacity-40 pointer-events-none'}`}>
              <div className="flex flex-col gap-1.5">
                <div className="flex justify-between text-xs font-mono uppercase tracking-wider text-white/60">
                  <span>Bots Per Match</span>
                  <span className="text-fuchsia-300 font-bold">{botConfig.count}</span>
                </div>
                <input
                  type="range"
                  min={1}
                  max={8}
                  step={1}
                  value={botConfig.count}
                  onChange={(e) => onBotConfigChange({ ...botConfig, count: parseInt(e.target.value, 10) })}
                  className="w-full accent-fuchsia-400 h-1 bg-white/10 rounded-lg appearance-none cursor-pointer"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <div className="flex justify-between text-xs font-mono uppercase tracking-wider text-white/60">
                  <span>Bot Difficulty</span>
                  <span className="text-fuchsia-300 font-bold">{botConfig.difficulty}%</span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={100}
                  step={5}
                  value={botConfig.difficulty}
                  onChange={(e) => onBotConfigChange({ ...botConfig, difficulty: parseInt(e.target.value, 10) })}
                  className="w-full accent-fuchsia-400 h-1 bg-white/10 rounded-lg appearance-none cursor-pointer"
                />
              </div>
            </div>
          </div>
        </div>

        {/* 2. Multiplayer AI Tuning */}
        <div className={cardCls}>
          <span className={`${sectionTitleCls} text-[#38bdf8]`}>🧠 Multiplayer AI Tuning</span>
          <p className="text-[11px] text-white/45 leading-snug">
            Shape the AI fighters used in multiplayer. These are the same behavior dials as single
            player; whatever you set is baked into the published preset.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {curatedAiSections.map((section) => (
              <div key={section.title} className="flex flex-col gap-3">
                <span className="text-[10px] uppercase tracking-widest font-mono text-[#38bdf8]/70 border-b border-white/5 pb-1">
                  {section.title}
                </span>
                {section.entries.map((entry) => {
                  const raw = settings[entry.key] as number | undefined;
                  return (
                    <div key={entry.key} className="flex flex-col gap-1.5">
                      <div className="flex justify-between text-xs font-mono uppercase tracking-wider text-white/60">
                        <span>{entry.label}</span>
                        <span className="text-cyan-400 font-bold">{entry.fmt(raw)}</span>
                      </div>
                      <input
                        type="range"
                        min={entry.min}
                        max={entry.max}
                        step={entry.step}
                        value={raw ?? entry.def}
                        onChange={(e) => onSettingChange(entry.key, parseFloat(e.target.value))}
                        className="w-full accent-cyan-400 h-1 bg-white/10 rounded-lg appearance-none cursor-pointer"
                      />
                      <p className="text-[10px] text-white/35 leading-snug">{entry.desc}</p>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

export default AdminDashboard;
