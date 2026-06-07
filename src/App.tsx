/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  GameStats,
  UniversalSettings,
  UiElementPos,
  Keybindings,
  DEFAULT_KEYBINDINGS,
  DeviceOS,
  DeviceInfo,
  AIBehaviorPreset,
  TournamentMatch,
  TournamentState,
  AIPreset,
  AITuning,
  ReplayFile,
  CustomMapData,
  CustomMapObject,
} from './types';
import {
  DEFAULT_ADMIN_SETTINGS,
  createDefaultAdminSettings,
  gameplaySettingsAreEqual,
  stripPlayerIdentitySettings,
  withDefaultGameplaySettings,
} from './settings/gameplaySettings';
import { SETTING_SECTIONS, SETTING_DEFINITIONS } from './settings/settingsSchema';
import { SaveData, buildSaveData, decryptSaveCode, encryptSaveData } from './settings/saveCodec';
import {
  LiveConfig,
  fetchLiveConfig,
  getCachedLiveConfig,
  publishLiveConfig,
} from './services/liveConfig';
import {
  AccountInfo,
  getStoredToken,
  fetchMe,
  fetchCloudSave,
  pushCloudSave,
} from './services/account';
import { contributeReplay } from './services/replayUpload';
import SpartanIdentityAccount from './components/SpartanIdentityAccount';
import AdminDashboard, { MultiplayerBotConfig, DEFAULT_BOT_CONFIG } from './components/AdminDashboard';
import {
  DEFAULT_DESKTOP_UI_POSITIONS,
  DEFAULT_MOBILE_UI_POSITIONS,
  MOBILE_HUD_LAYOUT_VERSION,
  MOBILE_HUD_LAYOUT_VERSION_KEY,
  UiLayoutState,
  getDefaultUiLayouts,
  mergeUiPositions,
  normalizeUiLayouts,
} from './ui/hudLayouts';
import {
  TOURNAMENT_DEFAULT_KILLS_TO_WIN,
  TOURNAMENT_DEFAULT_ROUND_COUNT,
  TOURNAMENT_MAX_KILLS_TO_WIN,
  TOURNAMENT_MAX_ROUND_COUNT,
  TOURNAMENT_MIN_KILLS_TO_WIN,
  TOURNAMENT_MIN_ROUND_COUNT,
  TournamentDifficulty,
  buildInitialTournamentRounds,
  buildNextTournamentRoundMatches,
  generateTournamentOpponents,
  getTournamentBotCount,
  getTournamentRoundLabels,
  simulateBotMatch,
} from './features/tournament/tournament';
import { AI_ARCHETYPE_OPTIONS, applyArchetypeToSettings, getArchetypeDef, type AIArchetypeId } from './game/aiPersonalities';
import {
  getSavedReplays,
  getCachedReplays,
  deleteReplay,
  updateReplayMeta,
  saveCachedReplay,
  getReplayStorageSizeBytes,
  formatReplaySizeMB,
} from './game/theaterDatabase';
import { GrifballGame } from './components/GrifballGame';
import { ReplayHeatmapCanvas, replayHasHeatmapEvents } from './components/replay/ReplayHeatmapCanvas';
import { PREMADE_MAPS } from './game/premadeMaps';
import * as THREE from 'three';
import { HUD } from './components/HUD';
import { sfx } from './components/AudioEngine';
import { Move, RotateCcw, Check } from 'lucide-react';
import { ChatOverlay, ChatMessage } from './components/ChatOverlay';
import { CharacterPreview } from './components/CharacterPreview';
import { CharacterPainter } from './components/CharacterPainter';
import { CharacterLoadout, DEFAULT_LOADOUT, AVAILABLE_PRESETS, HelmetPreset, TorsoPreset, ArmPreset, LegPreset } from './components/VoxelModels';

const APP_VERSION = '0.636';
const MAX_PLAYER_NAME_LENGTH = 10;
const MAX_MULTIPLAYER_CLIENTS = 7;
const MAX_MULTIPLAYER_PLAYERS = 1 + MAX_MULTIPLAYER_CLIENTS;
const EDGE_LOW_FPS_THRESHOLD = 20;
const EDGE_LOW_FPS_SUSTAINED_MS = 5000;
const EDGE_LOW_FPS_STATE_UPDATE_STEP_MS = 500;
const MAIN_MENU_FRAME_LAYOUT_STORAGE_KEY = 'ibrawls_main_menu_frame_layout_v1';
const MAIN_MENU_SETUP_MIN_PX = 280;
const MAIN_MENU_CUSTOMIZATION_MIN_PX = 420;
const MAIN_MENU_CHAT_MIN_PX = 280;
const MAIN_MENU_CHAT_MAX_PX = 520;
const MAIN_MENU_SPLITTER_WIDTH_PX = 28;

interface MainMenuFrameLayout {
  setupFr: number;
  customizationFr: number;
  chatWidth: number;
}

const DEFAULT_MAIN_MENU_FRAME_LAYOUT: MainMenuFrameLayout = {
  setupFr: 1,
  customizationFr: 1.8,
  chatWidth: 360,
};

const clampNumber = (value: number, min: number, max: number) => {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
};

const clampMainMenuFrameLayout = (layout: Partial<MainMenuFrameLayout> | null | undefined): MainMenuFrameLayout => ({
  setupFr: clampNumber(layout?.setupFr ?? DEFAULT_MAIN_MENU_FRAME_LAYOUT.setupFr, 0.55, 3.5),
  customizationFr: clampNumber(layout?.customizationFr ?? DEFAULT_MAIN_MENU_FRAME_LAYOUT.customizationFr, 0.8, 4),
  chatWidth: clampNumber(layout?.chatWidth ?? DEFAULT_MAIN_MENU_FRAME_LAYOUT.chatWidth, MAIN_MENU_CHAT_MIN_PX, MAIN_MENU_CHAT_MAX_PX),
});

interface OnlineClient {
  id: string;
  name?: string;
  state: 'menu' | 'solo' | 'multi';
  roomCode?: string;
  spaceAvailable?: boolean;
  playerCount?: number;
  maxPlayers?: number;
}

const normalizePlayerName = (name: unknown): string | undefined => {
  if (typeof name !== 'string') return undefined;
  const normalized = name.trim().substring(0, MAX_PLAYER_NAME_LENGTH);
  return normalized.length > 0 ? normalized : undefined;
};

const getOnlineClientDisplayName = (client: OnlineClient): string => {
  return normalizePlayerName(client.name) || `Client ${client.id}`;
};

const getConnectedMatchPlayerCount = (message: any, localRole: 'host' | 'client' | 'observer' | null): number => {
  const remotePlayerIds = new Set<string>();
  if (Array.isArray(message?.otherPlayerIds)) {
    message.otherPlayerIds.forEach((id: unknown) => {
      if (typeof id === 'string' && id.length > 0) {
        remotePlayerIds.add(id);
      }
    });
  }
  const resolvedLocalRole = message?.role ?? localRole;
  return remotePlayerIds.size + (resolvedLocalRole === 'observer' ? 0 : 1);
};

const getMultiplayerSpawnSlotFromMessage = (
  message: any,
  localRole: 'host' | 'client' | 'observer' | null
): number => {
  if (typeof message?.spawnSlot === 'number' && Number.isFinite(message.spawnSlot)) {
    return Math.max(0, Math.floor(message.spawnSlot));
  }
  const resolvedLocalRole = message?.role ?? localRole;
  return resolvedLocalRole === 'client' ? 1 : 0;
};

const getPresetDescription = (val: string, customPresets: AIPreset[] = []): string => {
  if (val === 'easy') return "Sub-Normal combat reflex latency, simple spacing behavior.";
  if (val === 'normal') return "Standard combat matrix dials, average anticipation calculations.";
  if (val === 'hard') return "Calibrated prediction systems, fast pacing & evading.";
  if (val === 'nightmare') return "Hyper-responsive matrix overrides. Zero anticipation errors.";
  if (val === 'custom') return "Configure custom neural matrix parameters below.";
  const custom = customPresets.find(p => p.id === val);
  if (custom) {
    const rl = custom.tuning.aiReactionLatency !== undefined ? `${custom.tuning.aiReactionLatency.toFixed(2)}s` : 'default';
    const anti = custom.tuning.aiAnticipationFactor !== undefined ? `${Math.round(custom.tuning.aiAnticipationFactor * 100)}%` : 'default';
    const move = custom.tuning.aiMovementComplexity !== undefined ? `${custom.tuning.aiMovementComplexity}%` : 'default';
    const swap = custom.tuning.aiWeaponSwapIQ !== undefined ? `${custom.tuning.aiWeaponSwapIQ}%` : 'default';
    const advanced: string[] = [];
    if (custom.tuning.aiSpatialIQ !== undefined) advanced.push(`Spatial: ${custom.tuning.aiSpatialIQ}%`);
    if (custom.tuning.aiFeintChance !== undefined) advanced.push(`Feint: ${custom.tuning.aiFeintChance}%`);
    if (custom.tuning.aiPressureAggression !== undefined) advanced.push(`Pressure: ${custom.tuning.aiPressureAggression}%`);
    if (custom.tuning.aiSpacingBand !== undefined) advanced.push(`Spacing: ${custom.tuning.aiSpacingBand.toFixed(2)}×`);
    if (custom.tuning.aiSkipPressure) advanced.push('No-Pressure');
    const advancedStr = advanced.length ? `, ${advanced.join(', ')}` : '';
    return `Custom Preset: Latency: ${rl}, Anticipation: ${anti}, Movement: ${move}, Weapon Swap: ${swap}${advancedStr}`;
  }
  return "";
};

const getArchetypeDescription = (val: string): string => {
  if (!val || val === 'none') return "Neutral personality. Relies purely on difficulty matrix knobs.";
  const def = getArchetypeDef(val);
  return def ? def.description : "";
};

// Custom AI Behavior panel — every engine-wired dial, grouped for scannability.
// NOTE: any future AI-behavior knob must be added here (and to AITuning / RosterSlotConfig).
type AICustomKnobKey = keyof UniversalSettings;

interface AICustomKnobEntry {
  key: AICustomKnobKey;
  label: string;
  min: number;
  max: number;
  step: number;
  /** Slider fallback position when the stored value is undefined. */
  def: number;
  fmt: (v: number | undefined) => string;
  /** Plain-language explanation of what the dial does, shown under the slider. */
  desc: string;
}

interface AICustomKnobSection {
  title: string;
  entries: AICustomKnobEntry[];
  /** Expert (formerly-hardcoded) tuning groups start collapsed to avoid overwhelming. */
  expert?: boolean;
}

/**
 * Build the Expert AI Tuning groups for the main-menu Custom AI Behavior panel by
 * reusing the row metadata already declared in settingsSchema's `aitune` section —
 * single source of truth for label/range/format/description.
 */
const EXPERT_AI_TUNE_GROUPS: { title: string; keys: (keyof UniversalSettings)[] }[] = [
  { title: 'Combat Decision (Expert)', keys: ['aiTuneMechanicAwareIq', 'aiTuneHighIqOverride', 'aiTuneHammerWindupSeconds'] },
  { title: 'Match State (Expert)', keys: ['aiTuneScoreAheadThreshold', 'aiTuneScoreCloseThreshold', 'aiTuneFeintIqGate'] },
  { title: 'Feints (Expert)', keys: ['aiTuneFeintCooldownMin', 'aiTuneFeintCooldownMax', 'aiTuneWeaponSwapFeintDelay', 'aiTuneApproachFeintBackTimer', 'aiTuneLungeFakeoutForwardTimer', 'aiTuneChargeAbortSidestepTimer'] },
  { title: 'Movement (Expert)', keys: ['aiTuneBaseGroundSpeed', 'aiTuneSprintEngageGap', 'aiTuneSprintChaseTargetSpeed', 'aiTuneSlideMinGap', 'aiTuneSlideMaxGap', 'aiTuneSlideMinComplexity', 'aiTuneSlideTriggerChance'] },
  { title: 'Spatial Awareness (Expert)', keys: ['aiTuneBaseEvasionDetectRange', 'aiTuneBaitDodgeDistance', 'aiTuneBaitDodgeBand', 'aiTuneEvasionTriggerJitter', 'aiTuneArenaEdgeInset'] },
  { title: 'Combos (Expert)', keys: ['aiTuneComboMinWeaponSwapIq', 'aiTuneComboAdvancedWeaponSwapIq'] },
  { title: 'Tempo & Pressure (Expert)', keys: ['aiTuneTempoCycleDuration', 'aiTunePostKillPressureDuration', 'aiTuneTempoSlowMult', 'aiTuneTempoFastMult', 'aiTuneStandoffRangeMinOffset', 'aiTuneStandoffRangeMaxOffset'] },
  { title: 'Adaptation & Learning (Expert)', keys: ['aiTuneCalibrationWindowSize', 'aiTuneMaxCalibrationDrift', 'aiTuneDodgeResolveDelay', 'aiTuneCounterResolveDelay', 'aiTunePlayerModelEmaAlpha', 'aiTuneDefaultLungeDistance', 'aiTuneDefaultReactionTime'] },
  { title: 'Coordination (Expert)', keys: ['aiTunePriorityTargetTtl', 'aiTuneDamageTagTtl', 'aiTuneAttackStaggerStep'] },
  { title: 'Engine Limits (Expert)', keys: ['aiTuneMaxAirborneHeight', 'aiTuneForcedDescentSpeed'] },
];

const AI_TUNE_DEF_BY_KEY = new Map(
  SETTING_DEFINITIONS.filter((d) => d.sectionId === 'aitune').map((d) => [d.key, d])
);

const buildExpertEntries = (keys: (keyof UniversalSettings)[]): AICustomKnobEntry[] =>
  keys.map((key) => {
    const d = AI_TUNE_DEF_BY_KEY.get(key);
    const fallback = DEFAULT_ADMIN_SETTINGS[key];
    return {
      key,
      label: d?.label ?? String(key),
      min: d?.min ?? 0,
      max: d?.max ?? 100,
      step: d?.step ?? 1,
      def: typeof fallback === 'number' ? fallback : 0,
      fmt: d?.formatValue ?? ((v) => `${v ?? 0}`),
      desc: d?.description ?? '',
    };
  });

const AI_CUSTOM_KNOB_SECTIONS: AICustomKnobSection[] = [
  {
    title: 'Reflexes & Awareness',
    entries: [
      { key: 'aiReactionLatency', label: 'Reflex Latency', min: 0, max: 1.5, step: 0.05, def: 0.25, fmt: (v) => `${(v ?? 0.25).toFixed(2)}s`, desc: 'Delay before the AI reacts to your actions. Lower = snappier, near-instant responses; higher = sluggish and easier to bait.' },
      { key: 'aiAnticipationFactor', label: 'Anticipation Engine', min: 0, max: 1, step: 0.05, def: 0.4, fmt: (v) => `${Math.round((v ?? 0.4) * 100)}%`, desc: 'How much it predicts and leads your movement instead of reacting after the fact. Higher = harder to juke.' },
      { key: 'aiWeaponSwapIQ', label: 'Weapon Swapping IQ', min: 0, max: 100, step: 5, def: 50, fmt: (v) => `${v ?? 50}%`, desc: 'Smarts behind hammer↔sword swaps — countering lunges and punishing your cooldowns. High values also unlock feints and combo strings.' },
    ],
  },
  {
    title: 'Movement & Positioning',
    entries: [
      { key: 'aiMovementComplexity', label: 'Strafe & Evade', min: 0, max: 100, step: 5, def: 50, fmt: (v) => `${v ?? 50}%`, desc: 'Richness of its footwork — strafing, dodging and repositioning. Higher = slippery and less predictable to hit.' },
      { key: 'aiSpatialIQ', label: 'Spatial IQ', min: 0, max: 100, step: 5, def: 50, fmt: (v) => (v === undefined ? 'Auto (Derived)' : `${v}%`), desc: 'Arena awareness: dodge timing, cutting off your escape routes and avoiding getting pinned to walls. Auto blends Strafe & Anticipation.' },
      { key: 'aiSpacingBand', label: 'Combat Spacing', min: 0.7, max: 1.4, step: 0.05, def: 1.0, fmt: (v) => (v === undefined ? 'Auto' : `${v.toFixed(2)}×`), desc: 'Preferred standoff distance. Above 1× hangs back and zones with the sword; below 1× crowds you and brawls up close.' },
    ],
  },
  {
    title: 'Combat Style',
    entries: [
      {
        key: 'aiPlaystyle', label: 'Combat Playstyle', min: 0, max: 100, step: 5, def: 50,
        fmt: (v) => {
          const p = v ?? 50;
          if (p === 0) return 'Passive (0)';
          if (p < 50) return `Passive-Defensive (${p})`;
          if (p === 50) return 'Defensive (50)';
          if (p < 100) return `Defensive-Aggressive (${p})`;
          return 'Aggressive (100)';
        },
        desc: 'Overall temperament from passive (waits and reacts) through defensive to aggressive (constantly pushes and initiates).',
      },
      {
        key: 'aiWeaponPrioritization', label: 'Weapon Prioritization', min: 0, max: 100, step: 5, def: 50,
        fmt: (v) => {
          const p = v ?? 50;
          if (p === 50) return 'Balanced (50/50)';
          if (p > 50) return `Sword User (${p}/${100 - p})`;
          return `Hammer User (${100 - p}/${p})`;
        },
        desc: 'Hammer vs sword preference. 100 = sword only (lunges/range), 0 = hammer only (close burst), 50 = mixes both.',
      },
      { key: 'aiPressureAggression', label: 'Pressure Aggression', min: 0, max: 100, step: 5, def: 50, fmt: (v) => (v === undefined ? 'Auto (Derived)' : `${v}%`), desc: 'How relentlessly it chains follow-up attacks after landing a hit instead of backing off. Auto follows Playstyle.' },
      { key: 'aiFeintChance', label: 'Feint Chance', min: 0, max: 100, step: 5, def: 0, fmt: (v) => (v === undefined ? 'Auto (Derived)' : `${v}%`), desc: 'How often it fakes swings or approaches to bait your defense. Auto is derived and needs a decent Weapon Swap IQ to trigger.' },
    ],
  },
  // Expert tuning groups (formerly-hardcoded "feel" constants), collapsed by default.
  ...EXPERT_AI_TUNE_GROUPS.map((g): AICustomKnobSection => ({
    title: g.title,
    entries: buildExpertEntries(g.keys),
    expert: true,
  })),
];


interface GlobalChatPanelProps {
  messages: ChatMessage[];
  onSendMessage: (text: string) => void;
}

const GlobalChatPanel = ({ messages, onSendMessage }: GlobalChatPanelProps) => {
  const [inputText, setInputText] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputText.trim()) return;
    onSendMessage(inputText);
    setInputText('');
  };

  return (
    <div className="flex-1 flex flex-col justify-between min-h-0 gap-3">
      {/* Message history container */}
      <div
        ref={scrollRef}
        className="flex-1 min-h-0 overflow-y-auto bg-black/45 border border-white/10 rounded-xl p-3.5 flex flex-col gap-2.5 scrollbar-thin scrollbar-thumb-white/10 pr-1.5"
      >
        {messages.length === 0 ? (
          <p className="text-xs font-mono text-white/35 uppercase tracking-widest text-center my-auto italic select-none">
            📡 No active broadcast logs. Type below to transmit message.
          </p>
        ) : (
          messages.map((msg) => (
            <div 
              key={msg.id} 
              className={`flex flex-col gap-1 max-w-[90%] animate-fade-in ${
                msg.isLocal ? 'self-end bg-[#38bdf8]/10 p-2.5 rounded-lg border border-[#38bdf8]/20' : 'self-start'
              }`}
            >
              <div className="flex items-center gap-2 select-none">
                <span className={`text-[11px] font-mono font-black ${
                  msg.isLocal ? 'text-[#38bdf8]' : 'text-slate-400'
                }`}>
                  {msg.sender} {msg.isLocal ? '(You)' : ''}
                </span>
                <span className="text-[10px] font-mono text-white/20">
                  {msg.timestamp}
                </span>
              </div>
              <p className="text-sm font-sans text-slate-100 break-words leading-relaxed select-text font-medium leading-[1.3] pl-0.5">
                {msg.text}
              </p>
            </div>
          ))
        )}
      </div>

      {/* Message input form */}
      <form 
        onSubmit={handleSubmit}
        className="flex items-center gap-2.5 bg-black/40 border border-white/10 rounded-lg p-2.5 shrink-0 pointer-events-auto"
      >
        <input
          type="text"
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          placeholder="Type global message... [Press Enter]"
          className="flex-grow h-11 bg-black/50 border border-white/5 rounded px-3.5 text-sm text-white placeholder:text-white/30 focus:border-[#38bdf8]/40 outline-none transition-all font-sans"
          maxLength={120}
          autoComplete="off"
        />
        <button
          type="submit"
          disabled={!inputText.trim()}
          className={`h-11 px-5 rounded text-sm font-sans font-bold uppercase tracking-wider transition-all flex items-center justify-center shrink-0 ${
            inputText.trim()
              ? 'bg-[#38bdf8] hover:bg-[#38bdf8]/80 text-slate-950 font-black cursor-pointer shadow-[0_0_12px_rgba(56,189,248,0.25)] hover:shadow-[0_0_18px_rgba(56,189,248,0.4)] active:scale-95'
              : 'bg-white/5 text-white/20 border border-white/5 cursor-not-allowed'
          }`}
        >
          Send
        </button>
      </form>
    </div>
  );
};

type LoggedOutAccountRequestMode = 'login' | 'register';

interface PilotIdentitySubframeProps {
  account: AccountInfo | null;
  playerName: string;
  playerHue: number | undefined;
  onPlayerNameChange: (name: string) => void;
  onRegistered: (account: AccountInfo) => void;
  onLoggedIn: (account: AccountInfo) => void;
  onLoggedOut: () => void;
  onAccountChanged: (account: AccountInfo) => void;
}

const PilotIdentitySubframe = ({
  account,
  playerName,
  playerHue,
  onPlayerNameChange,
  onRegistered,
  onLoggedIn,
  onLoggedOut,
  onAccountChanged,
}: PilotIdentitySubframeProps) => {
  const [isOpen, setIsOpen] = useState(true);
  const [modeRequest, setModeRequest] = useState<{
    mode: LoggedOutAccountRequestMode;
    token: number;
  }>({ mode: 'login', token: 0 });

  const resolvedHue = typeof playerHue === 'number' && Number.isFinite(playerHue) ? playerHue : 200;
  const displayName = (playerName.trim() || 'SPARTAN').toUpperCase();

  const requestLoggedOutMode = (
    mode: LoggedOutAccountRequestMode,
    event: React.MouseEvent<HTMLButtonElement>
  ) => {
    event.preventDefault();
    event.stopPropagation();
    setIsOpen(true);
    setModeRequest((prev) => ({ mode, token: prev.token + 1 }));
  };

  return (
    <details
      className="group/pilot-identity bg-slate-950/45 border border-white/10 rounded-lg p-3 shrink-0"
      open={isOpen}
      onToggle={(event) => setIsOpen(event.currentTarget.open)}
    >
      <summary className="flex flex-col gap-2 cursor-pointer select-none list-none">
        <span className="flex justify-between items-center gap-2">
          <span className="text-xs text-[#38bdf8] font-black uppercase tracking-wider flex items-center gap-1.5 min-w-0">
            <span className="w-1 px-0.5 h-2.5 bg-[#38bdf8] inline-block rounded-sm shrink-0" />
            <span className="truncate">Spartan Pilot Identity</span>
          </span>
          <span className="flex items-center gap-2 shrink-0">
            <span className="text-[10px] font-mono text-cyan-400 bg-cyan-950/40 border border-cyan-500/20 px-2 py-0.5 rounded">
              MAX_10_CHARS
            </span>
            <span className="text-[10px] text-white/35 transition-transform group-open/pilot-identity:rotate-180 font-sans">
              v
            </span>
          </span>
        </span>

        <span className="flex flex-wrap items-center gap-2 min-w-0">
          <span
            className="w-7 h-7 rounded border border-white/20 shadow-inner shrink-0"
            style={{ backgroundColor: `hsl(${resolvedHue}, 80%, 35%)` }}
          />
          <span className="min-w-0 flex-1 text-sm font-black text-[#38bdf8] uppercase tracking-wide truncate">
            {displayName}
          </span>
          {!isOpen && account && (
            <span className="flex items-center gap-1.5 shrink-0">
              <span className="text-[9px] font-black text-emerald-300 bg-emerald-500/15 border border-emerald-500/35 px-2 py-1 rounded uppercase tracking-widest font-mono">
                Signed In
              </span>
              {account.isAdmin && (
                <span className="text-[9px] font-black text-amber-300 bg-amber-500/15 border border-amber-500/40 px-2 py-1 rounded uppercase tracking-widest font-mono">
                  Admin
                </span>
              )}
            </span>
          )}
          {!isOpen && !account && (
            <span className="flex gap-1.5 shrink-0">
              <button
                type="button"
                onClick={(event) => requestLoggedOutMode('login', event)}
                className="px-2.5 py-1 rounded border border-[#38bdf8]/35 bg-[#38bdf8]/10 text-[#38bdf8] text-[9px] font-black uppercase tracking-widest hover:bg-[#38bdf8]/20 transition-colors"
              >
                Log In
              </button>
              <button
                type="button"
                onClick={(event) => requestLoggedOutMode('register', event)}
                className="px-2.5 py-1 rounded border border-white/10 bg-white/5 text-white/70 text-[9px] font-black uppercase tracking-widest hover:bg-white/10 transition-colors"
              >
                Register
              </button>
            </span>
          )}
        </span>
      </summary>

      <div className="pt-2.5 mt-2.5 border-t border-white/5">
        <div className="flex flex-col gap-1.5 text-left">
          <span className="text-[10.5px] text-white/40 uppercase tracking-widest font-mono">
            Customize Nameplate Callout:
          </span>
          <div className="relative">
            <input
              type="text"
              maxLength={MAX_PLAYER_NAME_LENGTH}
              value={playerName}
              onChange={(event) => onPlayerNameChange(event.target.value)}
              placeholder="Spartan Tag..."
              className="w-full h-11 bg-black/60 border border-white/10 rounded px-3.5 text-sm tracking-wide text-[#38bdf8] placeholder:text-white/20 focus:border-[#38bdf8] outline-none transition-all font-semibold uppercase pr-8 font-sans"
            />
            <div className="absolute right-3.5 top-3.5 w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse" />
          </div>
        </div>

        <SpartanIdentityAccount
          account={account}
          requestedLoggedOutMode={modeRequest.token > 0 ? modeRequest.mode : undefined}
          loggedOutModeRequestToken={modeRequest.token}
          onRegistered={onRegistered}
          onLoggedIn={onLoggedIn}
          onLoggedOut={onLoggedOut}
          onAccountChanged={onAccountChanged}
        />
      </div>
    </details>
  );
};

type ConnectionStatus = 'idle' | 'fetching_ip' | 'hosting' | 'connecting' | 'connected' | 'error';
type ConnectionMode = 'relay' | 'local';

interface PlayerListSubframeProps {
  onlineClients: OnlineClient[];
  clientId: string;
  connectionStatus: ConnectionStatus;
  connectionMode: ConnectionMode;
  menuSocket: WebSocket | null;
  hostIdCode: string;
  onJoinGame: (target: string, isObserver?: boolean) => void;
  setInviteNotifications: React.Dispatch<React.SetStateAction<string[]>>;
}

const PlayerListSubframe = ({
  onlineClients,
  clientId,
  connectionStatus,
  connectionMode,
  menuSocket,
  hostIdCode,
  onJoinGame,
  setInviteNotifications,
}: PlayerListSubframeProps) => (
  <details className="group/player-list bg-slate-950/45 border border-white/10 rounded-lg p-3 shrink-0" open>
    <summary className="flex justify-between items-center gap-2 cursor-pointer select-none list-none">
      <span className="text-xs text-[#38bdf8] font-black uppercase tracking-wider flex items-center gap-1.5 min-w-0">
        <span className="w-1 px-0.5 h-2.5 bg-[#38bdf8] inline-block rounded-sm shrink-0" />
        <span className="truncate">Player List ({onlineClients.length})</span>
      </span>
      <span className="flex items-center gap-2 shrink-0">
        {clientId && (
          <span className="text-[10px] font-mono text-white/45 bg-white/5 px-2 py-0.5 rounded border border-white/5">
            ID: {clientId}
          </span>
        )}
        <span className="text-[10px] text-white/35 transition-transform group-open/player-list:rotate-180 font-sans">
          v
        </span>
      </span>
    </summary>

    <div className="pt-2.5 mt-2.5 border-t border-white/5">
      <div className="player-list-scroll flex flex-col gap-2 pr-1 min-h-[5rem]">
        {onlineClients.length === 0 ? (
          <p className="text-xs text-white/45 italic font-medium m-auto text-center py-4">No other players online yet.</p>
        ) : (
          onlineClients.map(client => {
            const displayName = getOnlineClientDisplayName(client);
            const customName = normalizePlayerName(client.name);
            const maxPlayers = client.maxPlayers ?? MAX_MULTIPLAYER_PLAYERS;
            const playerCount = typeof client.playerCount === 'number' ? client.playerCount : undefined;
            const slotLabel = playerCount !== undefined ? `${Math.min(playerCount, maxPlayers)}/${maxPlayers}` : undefined;
            return (
              <div key={client.id} className="flex justify-between items-center bg-black/45 px-3 py-2.5 rounded border border-white/5 text-xs font-mono shrink-0">
                <div className="flex flex-col gap-1 min-w-0">
                  <span className="text-white/80 font-semibold truncate max-w-[130px]" title={customName ? `${displayName} (${client.id})` : displayName}>
                    {displayName}
                  </span>
                  <div className="flex items-center gap-1.5">
                    {client.state === 'menu' && (
                      <span className="text-[10px] text-slate-400/80 font-bold uppercase tracking-wider flex items-center gap-1">
                        <span className="w-1.5 h-1.5 rounded-full bg-slate-500" />
                        In Menu
                      </span>
                    )}
                    {client.state === 'solo' && (
                      <span className="text-[10px] text-amber-400 font-bold uppercase tracking-wider flex items-center gap-1">
                        <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
                        Solo Training
                      </span>
                    )}
                    {client.state === 'multi' && (
                      client.spaceAvailable ? (
                        <button
                          onClick={() => {
                            if (client.roomCode) {
                              onJoinGame(client.roomCode);
                            }
                          }}
                          className="text-[10px] bg-emerald-500/20 hover:bg-emerald-500/35 border border-emerald-500/40 text-emerald-400 font-bold uppercase tracking-wider px-2 py-0.5 rounded cursor-pointer transition-all flex items-center gap-1"
                        >
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 inline-block animate-ping" />
                          {slotLabel ? `Join ${slotLabel}` : 'Join'}
                        </button>
                      ) : (
                        <span className="text-[10px] text-blue-400 font-bold uppercase tracking-wider flex items-center gap-1">
                          <span className="w-1.5 h-1.5 rounded-full bg-blue-500" />
                          {slotLabel ? `In Match ${slotLabel}` : 'In Match'}
                        </span>
                      )
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-1 shrink-0">
                  {connectionStatus === 'hosting' && connectionMode === 'relay' && (
                    <button
                      onClick={() => {
                        if (menuSocket && menuSocket.readyState === WebSocket.OPEN) {
                          menuSocket.send(JSON.stringify({
                            type: 'send_invite',
                            targetId: client.id,
                            roomCode: hostIdCode
                          }));
                          setInviteNotifications(prev => [
                            ...prev,
                            `Lobby invite dispatched to Client ${client.id}.`
                          ]);
                          setTimeout(() => {
                            setInviteNotifications(prev => prev.filter(n => !n.includes(client.id)));
                          }, 5000);
                        }
                      }}
                      className="px-2.5 py-1 bg-gradient-to-r from-sky-600 to-indigo-600 hover:from-sky-500 hover:to-indigo-500 text-[9px] font-sans font-black uppercase tracking-wider text-white rounded cursor-pointer transition-all border border-sky-400/20 active:scale-95"
                    >
                      Invite
                    </button>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  </details>
);


const getSavedMatchmakerUrl = () => {
  const saved = localStorage.getItem('ibrawls_matchmaker_url');
  if (saved) return saved;

  const envWsUrl = import.meta.env.VITE_WS_URL;
  if (envWsUrl) return envWsUrl;

  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  let host = window.location.host;
  if (host.includes('localhost') || host.includes('127.0.0.1')) {
    host = 'ais-pre-tjrfoohpldxg7i2a3ncqfn-194609500028.us-west2.run.app';
  } else if (host.includes('ibrawlswebapp.pages.dev')) {
    host = 'ibrawlswebapp.commando501.workers.dev';
  }
  return `${protocol}//${host}/ws`;
};

// Reserved display name for the read-only, server-published Official Multiplayer Preset.
const OFFICIAL_MP_PRESET_NAME = '★ Official Multiplayer';

const BOT_COLOR_PRESETS = [
  { label: 'Red',     hue: 0   },
  { label: 'Orange',  hue: 28  },
  { label: 'Yellow',  hue: 55  },
  { label: 'Lime',    hue: 85  },
  { label: 'Green',   hue: 120 },
  { label: 'Teal',    hue: 168 },
  { label: 'Cyan',    hue: 190 },
  { label: 'Blue',    hue: 215 },
  { label: 'Purple',  hue: 275 },
  { label: 'Magenta', hue: 310 },
] as const;

// ─── Visual Keyboard + Mouse keybind editor component ────────────────────────
interface KbVisualizerProps {
  bindings: Keybindings;
  rebinding: keyof Keybindings | null;
  onPick: (action: keyof Keybindings) => void;
}

const ACTION_LABELS: Record<string, string> = {
  moveForward: 'FWD', moveLeft: 'LEFT', moveBackward: 'BACK', moveRight: 'RIGHT',
  jump: 'JUMP', dash: 'THRUST', crouch: 'CROUCH', sprint: 'SPRINT', scoreboard: 'SCORE',
  weapon1: 'HAMMER', weapon2: 'SWORD', attack: 'ATTACK', altAttack: 'ALT-ATK',
};

function KbBindRow({ label, action, bindings, rebinding, onPick }: {
  label: string; action: keyof Keybindings; bindings: Keybindings; rebinding: keyof Keybindings | null; onPick: (a: keyof Keybindings) => void;
}) {
  const isActive = rebinding === action;
  const val = bindings[action];
  const display = (val === ' ' ? 'Space' : (val || '—')).toString().toUpperCase();
  return (
    <button onClick={() => onPick(action)} style={{
      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      padding: '6px 10px', borderRadius: 4, cursor: 'pointer', width: '100%',
      background: isActive ? 'rgba(245,158,11,0.15)' : 'rgba(0,0,0,0.35)',
      border: isActive ? '1px solid rgba(245,158,11,0.55)' : '1px solid rgba(255,255,255,0.05)',
    }}>
      <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: 'rgba(255,255,255,0.55)', letterSpacing: '0.1em', textTransform: 'uppercase' }}>
        {label}
      </span>
      <span style={{
        fontFamily: "'JetBrains Mono', monospace", fontSize: 10, fontWeight: 900,
        color: isActive ? '#fbbf24' : '#22d3ee',
        background: isActive ? 'rgba(245,158,11,0.10)' : 'rgba(34,211,238,0.10)',
        border: isActive ? '1px solid rgba(245,158,11,0.40)' : '1px solid rgba(34,211,238,0.30)',
        padding: '2px 8px', borderRadius: 3, letterSpacing: '0.05em', minWidth: 42, textAlign: 'center' as const,
      }}>
        {isActive ? '…' : `[${display}]`}
      </span>
    </button>
  );
}

const getGamepadButtonName = (idx: number | undefined): string => {
  if (idx === undefined) return 'UNBOUND';
  const names: Record<number, string> = {
    0: 'A',
    1: 'B',
    2: 'X',
    3: 'Y',
    4: 'LB',
    5: 'RB',
    6: 'LT',
    7: 'RT',
    8: 'Back',
    9: 'Start',
    10: 'LS Click',
    11: 'RS Click',
    12: 'D-Pad Up',
    13: 'D-Pad Down',
    14: 'D-Pad Left',
    15: 'D-Pad Right',
    16: 'Guide'
  };
  return names[idx] ?? `Btn ${idx}`;
};

function KeyboardVisualizer({ bindings, rebinding, onPick }: KbVisualizerProps) {
  const boundLookup: Record<string, keyof Keybindings> = {};
  for (const [action, key] of Object.entries(bindings)) {
    if (typeof key === 'string') boundLookup[key] = action as keyof Keybindings;
  }

  const KS = 32;
  const KG = 4;
  const FKH = 28;

  const mkKey = (val: string | null, label: string, w: number = KS, h: number = KS, locked: boolean = false) => {
    const action = val ? boundLookup[val] : undefined;
    const isActive = !!action && rebinding === action;
    const isBound = !!action && !locked;
    const subLbl = action ? ACTION_LABELS[action] : '';
    return (
      <button
        onClick={() => action && !locked && onPick(action)}
        disabled={!action || locked}
        style={{
          width: w, height: h, minWidth: w, minHeight: h, flexShrink: 0,
          borderRadius: 5, padding: 0, cursor: (action && !locked) ? 'pointer' : 'default',
          display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column' as const,
          fontFamily: "'JetBrains Mono', monospace", fontWeight: 800, fontSize: 10,
          lineHeight: 1, letterSpacing: '0.02em', transition: 'all 150ms',
          background: isActive ? 'rgba(245,158,11,0.30)' : isBound ? 'rgba(34,211,238,0.18)' : locked ? 'rgba(255,255,255,0.02)' : 'rgba(15,23,42,0.55)',
          border: isActive ? '1px solid rgba(245,158,11,0.7)' : isBound ? '1px solid rgba(34,211,238,0.55)' : locked ? '1px solid rgba(255,255,255,0.04)' : '1px solid rgba(255,255,255,0.08)',
          color: isActive ? '#fbbf24' : isBound ? '#22d3ee' : locked ? 'rgba(255,255,255,0.14)' : 'rgba(255,255,255,0.38)',
          boxShadow: isBound ? '0 0 5px rgba(34,211,238,0.18)' : 'none',
        }}
      >
        <span style={{ lineHeight: 1 }}>{label}</span>
        {subLbl && (
          <span style={{ fontSize: 8, fontWeight: 800, opacity: 0.95, letterSpacing: '0.03em', marginTop: 3, lineHeight: 1, color: isActive ? '#fde68a' : '#67e8f9' }}>
            {subLbl}
          </span>
        )}
      </button>
    );
  };

  const R = (children: React.ReactNode) => (
    <div style={{ display: 'flex', gap: KG }}>{children}</div>
  );

  const attackBoundToLmb = bindings.attack === 'lmb';
  const altAttackBoundToRmb = bindings.altAttack === 'rmb';

  return (
    <div style={{ background: 'rgba(2,6,23,0.45)', border: '1px solid rgba(255,255,255,0.10)', borderRadius: 12, padding: 18, boxShadow: 'inset 0 1px 3px rgba(0,0,0,0.30)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingBottom: 10, marginBottom: 14, borderBottom: '1px solid rgba(255,255,255,0.05)', gap: 8, flexWrap: 'wrap' as const }}>
        <span style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 12, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase' as const, color: '#38bdf8', whiteSpace: 'nowrap' as const }}>
          ⌨ Keyboard + Mouse Layout
        </span>
        <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 9, color: rebinding ? '#fbbf24' : 'rgba(255,255,255,0.40)', background: rebinding ? 'rgba(245,158,11,0.10)' : 'rgba(255,255,255,0.05)', border: rebinding ? '1px solid rgba(245,158,11,0.30)' : '1px solid rgba(255,255,255,0.10)', padding: '2px 8px', borderRadius: 4, letterSpacing: '0.15em', textTransform: 'uppercase' as const }}>
          {rebinding ? 'PRESS ANY KEY…' : 'CLICK A KEY TO REBIND'}
        </span>
      </div>

      <div style={{ display: 'flex', gap: 18, alignItems: 'flex-start', flexWrap: 'wrap' as const }}>

        {/* ── Main keyboard block ── */}
        <div style={{ display: 'flex', flexDirection: 'column' as const, gap: KG }}>

          {/* Function row */}
          {R(<>
            {mkKey(null, 'Esc', 42, KS, true)}
            <div style={{ width: 9 }} />
            {mkKey('f1', 'F1', KS, FKH)} {mkKey('f2', 'F2', KS, FKH)} {mkKey('f3', 'F3', KS, FKH)} {mkKey('f4', 'F4', KS, FKH)}
            <div style={{ width: 7 }} />
            {mkKey('f5', 'F5', KS, FKH)} {mkKey('f6', 'F6', KS, FKH)} {mkKey('f7', 'F7', KS, FKH)} {mkKey('f8', 'F8', KS, FKH)}
            <div style={{ width: 7 }} />
            {mkKey('f9', 'F9', KS, FKH)} {mkKey('f10', 'F10', KS, FKH)} {mkKey('f11', 'F11', KS, FKH)} {mkKey('f12', 'F12', KS, FKH)}
          </>)}

          {/* Number row */}
          {R(<>
            {mkKey('`', '`')} {mkKey('1', '1')} {mkKey('2', '2')} {mkKey('3', '3')} {mkKey('4', '4')}
            {mkKey('5', '5')} {mkKey('6', '6')} {mkKey('7', '7')} {mkKey('8', '8')} {mkKey('9', '9')}
            {mkKey('0', '0')} {mkKey('-', '-')} {mkKey('=', '=')}
            {mkKey('backspace', '⌫', KS * 2 + KG)}
          </>)}

          {/* QWERTY row */}
          {R(<>
            {mkKey(null, 'Tab', 50, KS, true)}
            {mkKey('q', 'Q')} {mkKey('w', 'W')} {mkKey('e', 'E')} {mkKey('r', 'R')} {mkKey('t', 'T')}
            {mkKey('y', 'Y')} {mkKey('u', 'U')} {mkKey('i', 'I')} {mkKey('o', 'O')} {mkKey('p', 'P')}
            {mkKey('[', '[')} {mkKey(']', ']')}
            {mkKey('\\', '\\', 50, KS)}
          </>)}

          {/* ASDF row */}
          {R(<>
            {mkKey(null, 'Caps', 59, KS, true)}
            {mkKey('a', 'A')} {mkKey('s', 'S')} {mkKey('d', 'D')} {mkKey('f', 'F')} {mkKey('g', 'G')}
            {mkKey('h', 'H')} {mkKey('j', 'J')} {mkKey('k', 'K')} {mkKey('l', 'L')}
            {mkKey(';', ';')} {mkKey("'", "'")}
            {mkKey('enter', '↵', 57, KS)}
          </>)}

          {/* ZXCV row */}
          {R(<>
            {mkKey('shift', '⇧', 57, KS)}
            {mkKey('z', 'Z')} {mkKey('x', 'X')} {mkKey('c', 'C')} {mkKey('v', 'V')} {mkKey('b', 'B')}
            {mkKey('n', 'N')} {mkKey('m', 'M')} {mkKey(',', ',')} {mkKey('.', '.')} {mkKey('/', '/')}
            {mkKey('shift', '⇧', 69, KS)}
          </>)}

          {/* Bottom row */}
          {R(<>
            {mkKey(null, 'Ctrl', 44, KS, true)}
            {mkKey(null, '❖', 28, KS, true)}
            {mkKey(null, 'Alt', 44, KS, true)}
            {mkKey(' ', 'Space', 214, KS)}
            {mkKey(null, 'Alt', 44, KS, true)}
            {mkKey(null, '☰', 28, KS, true)}
            {mkKey(null, 'Ctrl', 44, KS, true)}
          </>)}
        </div>

        {/* ── Nav cluster ── */}
        <div style={{ display: 'flex', flexDirection: 'column' as const, gap: KG }}>
          <div style={{ height: FKH + KG }} />
          {R(<>{mkKey('insert', 'Ins', KS)} {mkKey('home', 'Hm', KS)} {mkKey('pageup', 'PgU', KS)}</>)}
          {R(<>{mkKey('delete', 'Del', KS)} {mkKey('end', 'End', KS)} {mkKey('pagedown', 'PgD', KS)}</>)}
          <div style={{ height: KS + KG }} />
          <div style={{ display: 'flex', gap: KG }}><div style={{ width: KS + KG }} />{mkKey('arrowup', '↑', KS)}</div>
          {R(<>{mkKey('arrowleft', '←', KS)} {mkKey('arrowdown', '↓', KS)} {mkKey('arrowright', '→', KS)}</>)}
        </div>

        {/* ── Numpad (CSS grid for tall + and Enter) ── */}
        <div style={{ display: 'flex', flexDirection: 'column' as const, gap: KG }}>
          <div style={{ height: FKH + KG }} />
          <div style={{ display: 'grid', gridTemplateColumns: `repeat(4, ${KS}px)`, gridTemplateRows: `repeat(5, ${KS}px)`, gap: KG }}>
            {mkKey('numlock', 'NmLk')}
            {mkKey('/', '/')}
            {mkKey('*', '*')}
            {mkKey('-', '-')}
            {mkKey('7', '7')}
            {mkKey('8', '8')}
            {mkKey('9', '9')}
            <div style={{ gridRow: 'span 2', display: 'flex' }}>
              {mkKey('+', '+', KS, KS * 2 + KG)}
            </div>
            {mkKey('4', '4')}
            {mkKey('5', '5')}
            {mkKey('6', '6')}
            {mkKey('1', '1')}
            {mkKey('2', '2')}
            {mkKey('3', '3')}
            <div style={{ gridRow: 'span 2', display: 'flex' }}>
              {mkKey('enter', '↵', KS, KS * 2 + KG)}
            </div>
            <div style={{ gridColumn: 'span 2', display: 'flex' }}>
              {mkKey('0', '0', KS * 2 + KG, KS)}
            </div>
            {mkKey('.', '.')}
          </div>
        </div>

        {/* ── Mouse ── */}
        <div style={{ display: 'flex', flexDirection: 'column' as const, gap: 10, alignItems: 'center' }}>
          <div style={{ height: FKH + KG }} />
          <svg viewBox="0 0 80 110" style={{ width: 68, height: 94 }}>
            <path d="M 16 22 Q 16 8, 40 8 Q 64 8, 64 22 L 64 86 Q 64 102, 40 102 Q 16 102, 16 86 Z" fill="rgba(15,23,42,0.65)" stroke="rgba(255,255,255,0.20)" strokeWidth="1.5"/>
            <line x1="40" y1="8" x2="40" y2="44" stroke="rgba(255,255,255,0.15)" strokeWidth="1"/>
            <path d="M 16 22 Q 16 8, 40 8 L 40 44 L 16 44 Z"
              fill={rebinding === 'attack' ? 'rgba(245,158,11,0.35)' : attackBoundToLmb ? 'rgba(34,211,238,0.22)' : 'rgba(255,255,255,0.04)'}
              stroke={rebinding === 'attack' ? 'rgba(245,158,11,0.7)' : attackBoundToLmb ? 'rgba(34,211,238,0.55)' : 'rgba(255,255,255,0.12)'}
              strokeWidth="1" style={{ cursor: 'pointer' }} onClick={() => onPick('attack')} />
            <path d="M 40 8 Q 64 8, 64 22 L 64 44 L 40 44 Z"
              fill={rebinding === 'altAttack' ? 'rgba(245,158,11,0.35)' : altAttackBoundToRmb ? 'rgba(34,211,238,0.22)' : 'rgba(255,255,255,0.04)'}
              stroke={rebinding === 'altAttack' ? 'rgba(245,158,11,0.7)' : altAttackBoundToRmb ? 'rgba(34,211,238,0.55)' : 'rgba(255,255,255,0.12)'}
              strokeWidth="1" style={{ cursor: 'pointer' }} onClick={() => onPick('altAttack')} />
            <rect x="36" y="22" width="8" height="14" rx="3" fill="rgba(34,211,238,0.30)" stroke="rgba(34,211,238,0.7)" strokeWidth="1"/>
            <line x1="36" y1="28" x2="44" y2="28" stroke="rgba(255,255,255,0.3)" strokeWidth="0.5"/>
            <line x1="36" y1="31" x2="44" y2="31" stroke="rgba(255,255,255,0.3)" strokeWidth="0.5"/>
          </svg>
          <div style={{ display: 'flex', flexDirection: 'column' as const, gap: 4 }}>
            {([
              { label: 'LMB', sub: 'ATTACK',  bk: 'attack' as keyof Keybindings,    isBound: attackBoundToLmb },
              { label: 'RMB', sub: 'ALT-ATK', bk: 'altAttack' as keyof Keybindings, isBound: altAttackBoundToRmb },
            ] as const).map(({ label, sub, bk, isBound }) => (
              <div key={bk} onClick={() => onPick(bk)} style={{
                cursor: 'pointer', padding: '6px 10px', borderRadius: 5,
                display: 'flex', flexDirection: 'column' as const, gap: 2,
                background: rebinding === bk ? 'rgba(245,158,11,0.20)' : isBound ? 'rgba(34,211,238,0.10)' : 'rgba(15,23,42,0.55)',
                border: rebinding === bk ? '1px solid rgba(245,158,11,0.5)' : isBound ? '1px solid rgba(34,211,238,0.30)' : '1px solid rgba(255,255,255,0.08)',
                fontFamily: "'JetBrains Mono', monospace", fontSize: 11, fontWeight: 800,
                color: rebinding === bk ? '#fbbf24' : isBound ? '#22d3ee' : 'rgba(255,255,255,0.38)', letterSpacing: '0.06em', lineHeight: 1,
              }}>
                <span style={{ fontSize: 12 }}>{label}</span>
                <span style={{ fontSize: 9, opacity: 0.78 }}>{sub}</span>
              </div>
            ))}
            <div style={{ padding: '6px 10px', borderRadius: 5, background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)', fontFamily: "'JetBrains Mono', monospace", fontSize: 11, fontWeight: 800, color: 'rgba(255,255,255,0.25)', letterSpacing: '0.06em', lineHeight: 1 }}>
              <span style={{ fontSize: 12, display: 'block', color: 'rgba(255,255,255,0.35)' }}>WHEEL</span>
              <span style={{ fontSize: 9, opacity: 0.72, display: 'block', marginTop: 3 }}>SWAP WEAP</span>
            </div>
          </div>
        </div>
      </div>

      {/* Compact chip grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 6, marginTop: 14, paddingTop: 14, borderTop: '1px solid rgba(255,255,255,0.05)' }}>
        <KbBindRow label="FWD"     action="moveForward"  bindings={bindings} rebinding={rebinding} onPick={onPick} />
        <KbBindRow label="LEFT"    action="moveLeft"     bindings={bindings} rebinding={rebinding} onPick={onPick} />
        <KbBindRow label="BACK"    action="moveBackward" bindings={bindings} rebinding={rebinding} onPick={onPick} />
        <KbBindRow label="RIGHT"   action="moveRight"    bindings={bindings} rebinding={rebinding} onPick={onPick} />
        <KbBindRow label="JUMP"    action="jump"         bindings={bindings} rebinding={rebinding} onPick={onPick} />
        <KbBindRow label="THRUST"  action="dash"         bindings={bindings} rebinding={rebinding} onPick={onPick} />
        <KbBindRow label="CROUCH"  action="crouch"       bindings={bindings} rebinding={rebinding} onPick={onPick} />
        <KbBindRow label="SPRINT"  action="sprint"       bindings={bindings} rebinding={rebinding} onPick={onPick} />
        <KbBindRow label="SCORE"   action="scoreboard"   bindings={bindings} rebinding={rebinding} onPick={onPick} />
        <KbBindRow label="HAMMER"  action="weapon1"      bindings={bindings} rebinding={rebinding} onPick={onPick} />
        <KbBindRow label="SWORD"   action="weapon2"      bindings={bindings} rebinding={rebinding} onPick={onPick} />
        <KbBindRow label="ATTACK"  action="attack"       bindings={bindings} rebinding={rebinding} onPick={onPick} />
        <KbBindRow label="ALT-ATK" action="altAttack"   bindings={bindings} rebinding={rebinding} onPick={onPick} />
      </div>
    </div>
  );
}
// ─────────────────────────────────────────────────────────────────────────────
const COMPACT_KEYBIND_SECTIONS: Array<{
  title: string;
  actions: Array<{ action: keyof Keybindings; label: string }>;
}> = [
  {
    title: 'Movement',
    actions: [
      { action: 'moveForward', label: 'Move Forward' },
      { action: 'moveLeft', label: 'Move Left' },
      { action: 'moveBackward', label: 'Move Backward' },
      { action: 'moveRight', label: 'Move Right' },
      { action: 'jump', label: 'Jump / Boost' },
      { action: 'dash', label: 'Dash' },
      { action: 'crouch', label: 'Crouch / Slide' },
      { action: 'sprint', label: 'Sprint' },
    ],
  },
  {
    title: 'Combat',
    actions: [
      { action: 'weapon1', label: 'Hammer' },
      { action: 'weapon2', label: 'Sword' },
      { action: 'attack', label: 'Primary Attack' },
      { action: 'altAttack', label: 'Alt Attack' },
      { action: 'scoreboard', label: 'Scoreboard' },
    ],
  },
];

function CompactKeybindList({ bindings, rebinding, onPick }: KbVisualizerProps) {
  return (
    <div className="compact-keybind-list bg-slate-950/55 border border-white/10 rounded-xl p-3.5 flex-col gap-3">
      {COMPACT_KEYBIND_SECTIONS.map((section) => (
        <div key={section.title} className="flex flex-col gap-2">
          <p className="text-[10px] text-cyan-400 font-black uppercase tracking-widest border-b border-white/5 pb-1.5">
            {section.title}
          </p>
          <div className="grid grid-cols-1 min-[420px]:grid-cols-2 gap-2">
            {section.actions.map(({ action, label }) => (
              <div key={action}>
                <KbBindRow
                  label={label}
                  action={action}
                  bindings={bindings}
                  rebinding={rebinding}
                  onPick={onPick}
                />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// Shared "Hold to Sprint" toggle, used in both the Controls and Gamepad panels.
// When ON (default) the player must hold the sprint button to sprint; when OFF
// a single tap toggles sprint on/off.
function SprintModeToggle({ keybindings, setKeybindings }: {
  keybindings: Keybindings;
  setKeybindings: React.Dispatch<React.SetStateAction<Keybindings>>;
}) {
  const holdToSprint = keybindings.holdToSprint !== false;
  const toggle = () => {
    setKeybindings(prev => {
      const updated = { ...prev, holdToSprint: !(prev.holdToSprint !== false) };
      try { localStorage.setItem('grifball_keybindings', JSON.stringify(updated)); } catch (_) {}
      return updated;
    });
  };
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="flex flex-col">
        <span className="text-[11px] font-bold uppercase tracking-wider text-white/80">Hold to Sprint</span>
        <span className="text-[10px] text-white/40 leading-snug mt-0.5">
          {holdToSprint ? 'Hold the sprint button to sprint.' : 'Tap once to toggle sprint on / off.'}
        </span>
      </div>
      <button
        onClick={toggle}
        role="switch"
        aria-checked={holdToSprint}
        className={`relative shrink-0 w-11 h-6 rounded-full transition-colors cursor-pointer ${holdToSprint ? 'bg-cyan-500' : 'bg-slate-800'}`}
        style={{ backgroundColor: holdToSprint ? '#06b6d4' : '#1e293b' }}
      >
        <span
          className="absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform"
          style={{ transform: holdToSprint ? 'translateX(20px)' : 'translateX(0)' }}
        />
      </button>
    </div>
  );
}

const detectDeviceOS = (): DeviceInfo => {
  if (typeof window === 'undefined') return { isMobile: false, os: 'desktop' };
  const ua = navigator.userAgent || navigator.vendor || (window as any).opera;
  const navWithUaData = navigator as Navigator & { userAgentData?: { mobile?: boolean } };
  const coarsePointer = window.matchMedia?.('(pointer: coarse)').matches ?? false;
  const noHover = window.matchMedia?.('(hover: none)').matches ?? false;
  const compactViewport = Math.min(window.innerWidth, window.innerHeight) <= 520;
  const maxTouchPoints = navigator.maxTouchPoints || 0;
  const touchCapable = maxTouchPoints > 0 || 'ontouchstart' in window;
  const reportsMobile = navWithUaData.userAgentData?.mobile === true;
  const mobileUserAgent = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(ua);
  const iPadDesktopMode = /Macintosh/i.test(ua) && maxTouchPoints > 1;
  const isMobile = reportsMobile
    || mobileUserAgent
    || iPadDesktopMode
    || (touchCapable && coarsePointer)
    || (touchCapable && noHover)
    || compactViewport;
  let os: DeviceOS = 'desktop';

  if (/iPhone|iPad|iPod/i.test(ua) || iPadDesktopMode) {
    os = 'ios';
  } else if (/Android/i.test(ua)) {
    os = 'android';
  } else if (isMobile) {
    os = 'unknown';
  }

  return { isMobile, os };
};

const detectMicrosoftEdge = (): boolean => {
  if (typeof navigator === 'undefined') return false;
  return /\bEdg\//.test(navigator.userAgent || '');
};

interface GraphicsCheckResult {
  checked: boolean;
  supported: boolean;
  accelerated: boolean;
  details?: string;
}

const checkGraphicsAcceleration = (): GraphicsCheckResult => {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return { checked: true, supported: true, accelerated: true };
  }
  try {
    const canvas = document.createElement('canvas');
    if (!canvas) {
      return { checked: true, supported: false, accelerated: false, details: 'Cannot create canvas' };
    }
    
    // Check if basic WebGL is supported (software fallback permitted)
    const glBasic = canvas.getContext('webgl2') || canvas.getContext('webgl');
    if (!glBasic) {
      return { checked: true, supported: false, accelerated: false, details: 'WebGL not supported or disabled' };
    }
    
    // Check if WebGL is supported WITHOUT major performance caveats (means GPU hardware acceleration is active)
    const glAccelerated = canvas.getContext('webgl2', { failIfMajorPerformanceCaveat: true }) || 
                          canvas.getContext('webgl', { failIfMajorPerformanceCaveat: true });
    
    if (!glAccelerated) {
      // Software rendering fallback detected
      let renderer = 'Software Rasterizer';
      const ext = glBasic.getExtension('WEBGL_debug_renderer_info');
      if (ext) {
        renderer = glBasic.getParameter(ext.UNMASKED_RENDERER_WEBGL) || renderer;
      }
      return { checked: true, supported: true, accelerated: false, details: renderer };
    }
    
    // Hardware acceleration is active!
    let renderer = 'Hardware Accelerated GPU';
    const ext = glAccelerated.getExtension('WEBGL_debug_renderer_info');
    if (ext) {
      renderer = glAccelerated.getParameter(ext.UNMASKED_RENDERER_WEBGL) || renderer;
    }
    return { checked: true, supported: true, accelerated: true, details: renderer };
  } catch (e) {
    return { checked: true, supported: false, accelerated: false, details: `Check error: ${e}` };
  }
};

// --- HIGH-FIDELITY MAP ASSETS PROCEDURAL MODEL PIPELINE ---
export function createHighFidelityObjectMesh(
  obj: CustomMapObject,
  three: typeof THREE,
  generateCustomTexture?: (type: string, baseColorHex: string) => THREE.Texture,
  scaleMultiplier: number = 1.0
): THREE.Group {
  const group = new three.Group();
  group.name = obj.id;
  
  // Base scale dimensions
  const sx = obj.scale.x * scaleMultiplier;
  const sy = obj.scale.y * scaleMultiplier;
  const sz = obj.scale.z * scaleMultiplier;
  
  // Set up materials
  const hasTexture = obj.texture && obj.texture !== 'none';
  const texture = (hasTexture && generateCustomTexture) ? generateCustomTexture(obj.texture, obj.color) : null;
  if (texture) {
    texture.needsUpdate = true;
  }
  
  let bumpScale = 0.02;
  if (hasTexture) {
    if (['nature_mossy_stone', 'fantasy_cobble', 'city_brick'].includes(obj.texture)) {
      bumpScale = 0.035;
    } else if (['nature_grass', 'city_concrete', 'nature_wood'].includes(obj.texture)) {
      bumpScale = 0.025;
    } else if (['space_alloy', 'futuristic_carbon', 'forerunner_panel'].includes(obj.texture)) {
      bumpScale = 0.015;
    } else if (['futuristic_hex', 'synthwave_grid', 'winter_glacier_glass'].includes(obj.texture)) {
      bumpScale = 0.008;
    }
  }

  const mat = new three.MeshStandardMaterial({
    map: texture,
    bumpMap: texture || undefined,
    bumpScale: hasTexture ? bumpScale : 0,
    color: hasTexture ? new three.Color('#ffffff') : new three.Color(obj.color),
    metalness: obj.metalness ?? 0.5,
    roughness: obj.roughness ?? 0.5,
    opacity: obj.opacity ?? 1,
    transparent: obj.transparent || false,
  });

  if (obj.emissive && obj.emissive !== '#000000') {
    mat.emissive = new three.Color(obj.emissive);
    mat.emissiveIntensity = obj.emissiveIntensity ?? 1;
  }

  // Dark accent material for metallic trims
  const accentMat = new three.MeshStandardMaterial({
    color: new three.Color('#1e293b'),
    metalness: 0.9,
    roughness: 0.2,
  });

  // Glow material
  let glowMat: THREE.Material;
  if (obj.emissive && obj.emissive !== '#000000') {
    glowMat = new three.MeshBasicMaterial({
      color: new three.Color(obj.emissive),
      transparent: true,
      opacity: 0.8
    });
  } else {
    glowMat = new three.MeshBasicMaterial({
      color: new three.Color(obj.color || '#00ffff'),
      transparent: true,
      opacity: 0.6
    });
  }
  
  // Render based on geometry type and name clues
  const nameLower = (obj.name || '').toLowerCase();
  
  if (obj.type === 'box') {
    const isRock = ['nature_mossy_stone', 'space_meteorite'].includes(obj.texture) || 
                   nameLower.includes('rock') || nameLower.includes('boulder') || nameLower.includes('asteroid') || nameLower.includes('cluster');
    const isContainer = nameLower.includes('container') || nameLower.includes('barrier') || 
                        nameLower.includes('partition') || nameLower.includes('shield') || 
                        nameLower.includes('buffer') || nameLower.includes('freight') || nameLower.includes('wall');
    const isCrate = nameLower.includes('crate') || nameLower.includes('substation') || nameLower.includes('recharge');
    
    if (isRock) {
      // 1. HIGH-FIDELITY ASTEROID/BOULDER (LOW-POLY ORGANIC FACETED GEODESIC CLUSTER)
      const mainGeo = new three.DodecahedronGeometry(sx / 2, 1);
      
      // Distort vertices slightly to make it organic and non-spherical
      const posAttr = mainGeo.attributes.position as THREE.BufferAttribute;
      if (posAttr) {
        for (let i = 0; i < posAttr.count; i++) {
          const x = posAttr.getX(i);
          const y = posAttr.getY(i);
          const z = posAttr.getZ(i);
          posAttr.setXYZ(
            i,
            x * 1.0 + (Math.sin(y * 5) * 0.08),
            y * (sy / sx) + (Math.cos(z * 5) * 0.08),
            z * (sz / sx) + (Math.sin(x * 5) * 0.08)
          );
        }
        mainGeo.computeVertexNormals();
      }
      
      const mainMesh = new three.Mesh(mainGeo, mat);
      group.add(mainMesh);
      
      // Add 2 smaller debris boulders clustered at the base
      const d1Geo = new three.DodecahedronGeometry(sx * 0.15, 0);
      const debris1 = new three.Mesh(d1Geo, mat);
      debris1.position.set(-sx * 0.35, -sy * 0.35, sz * 0.2);
      debris1.rotation.set(Math.random(), Math.random(), Math.random());
      group.add(debris1);
      
      const d2Geo = new three.DodecahedronGeometry(sx * 0.12, 0);
      const debris2 = new three.Mesh(d2Geo, mat);
      debris2.position.set(sx * 0.3, -sy * 0.4, -sz * 0.3);
      debris2.rotation.set(Math.random(), Math.random(), Math.random());
      group.add(debris2);
      
      if (obj.texture === 'space_meteorite' && obj.emissive && obj.emissive !== '#000000') {
        const coreGeo = new three.SphereGeometry(sx * 0.2, 8, 8);
        const core = new three.Mesh(coreGeo, glowMat);
        core.position.set(0, 0, 0);
        group.add(core);
      }
      
    } else if (isContainer) {
      // 2. DETAILED HEAVY INDUSTRIAL SHIPPING CONTAINER / STRUCTURAL BARRIER
      const bodyGeo = new three.BoxGeometry(sx * 0.94, sy * 0.96, sz * 0.94);
      const body = new three.Mesh(bodyGeo, mat);
      group.add(body);
      
      const frameThickness = 0.04 * Math.min(sx, sz);
      
      // 4 Heavy vertical structural support corner pillars
      const colW = frameThickness;
      const colGeo = new three.BoxGeometry(colW, sy * 1.01, colW);
      
      const corners = [
        [-sx/2 + colW/2, -sz/2 + colW/2],
        [-sx/2 + colW/2, sz/2 - colW/2],
        [sx/2 - colW/2, -sz/2 + colW/2],
        [sx/2 - colW/2, sz/2 - colW/2]
      ];
      
      corners.forEach(([cx, cz]) => {
        const col = new three.Mesh(colGeo, accentMat);
        col.position.set(cx, 0, cz);
        group.add(col);
      });
      
      // Top and bottom protective edge rings (horizontal bars)
      const topBarGeo = new three.BoxGeometry(sx * 1.01, frameThickness, frameThickness);
      const botBarGeo = topBarGeo.clone();
      
      const barsZ = [-sz/2 + frameThickness/2, sz/2 - frameThickness/2];
      barsZ.forEach(bz => {
        const topBar = new three.Mesh(topBarGeo, accentMat);
        topBar.position.set(0, sy/2 - frameThickness/2, bz);
        group.add(topBar);
        
        const botBar = new three.Mesh(botBarGeo, accentMat);
        botBar.position.set(0, -sy/2 + frameThickness/2, bz);
        group.add(botBar);
      });
      
      // Corrugated panel ridges along the longer side
      const isXLonger = sx >= sz;
      if (isXLonger) {
        const numRibs = Math.max(3, Math.floor(sx * 1.5));
        const ribSpacing = (sx * 0.8) / (numRibs - 1 || 1);
        const ribW = 0.06;
        const ribD = 0.04;
        const ribGeo = new three.BoxGeometry(ribW, sy * 0.9, ribD);
        
        for (let i = 0; i < numRibs; i++) {
          const rx = -sx * 0.4 + i * ribSpacing;
          
          const fRib = new three.Mesh(ribGeo, accentMat);
          fRib.position.set(rx, 0, sz/2 - ribD/2);
          group.add(fRib);
          
          const bRib = new three.Mesh(ribGeo, accentMat);
          bRib.position.set(rx, 0, -sz/2 + ribD/2);
          group.add(bRib);
        }
      } else {
        const numRibs = Math.max(3, Math.floor(sz * 1.5));
        const ribSpacing = (sz * 0.8) / (numRibs - 1 || 1);
        const ribW = 0.04;
        const ribD = 0.06;
        const ribGeo = new three.BoxGeometry(ribW, sy * 0.9, ribD);
        
        for (let i = 0; i < numRibs; i++) {
          const rz = -sz * 0.4 + i * ribSpacing;
          
          const lRib = new three.Mesh(ribGeo, accentMat);
          lRib.position.set(-sx/2 + ribW/2, 0, rz);
          group.add(lRib);
          
          const rRib = new three.Mesh(ribGeo, accentMat);
          rRib.position.set(sx/2 - ribW/2, 0, rz);
          group.add(rRib);
        }
      }
      
    } else if (isCrate) {
      // 3. SCI-FI MECHANICAL TECH CRATE / RECHARGE STATION
      const coreGeo = new three.BoxGeometry(sx * 0.84, sy * 0.84, sz * 0.84);
      const core = new three.Mesh(coreGeo, mat);
      group.add(core);
      
      const frameW = 0.08 * sx;
      
      // Horizontal top/bottom structural rims
      const plateGeo = new three.BoxGeometry(sx * 0.94, frameW, sz * 0.94);
      const topPlate = new three.Mesh(plateGeo, accentMat);
      topPlate.position.set(0, sy/2 - frameW/2, 0);
      group.add(topPlate);
      
      const botPlate = new three.Mesh(plateGeo, accentMat);
      botPlate.position.set(0, -sy/2 + frameW/2, 0);
      group.add(botPlate);
      
      // Protective corner reinforcement cages
      const colGeo = new three.BoxGeometry(frameW, sy * 0.8, frameW);
      const offsets = [
        [-sx/2 + frameW/2, -sz/2 + frameW/2],
        [-sx/2 + frameW/2, sz/2 - frameW/2],
        [sx/2 - frameW/2, -sz/2 + frameW/2],
        [sx/2 - frameW/2, sz/2 - frameW/2]
      ];
      offsets.forEach(([cx, cz]) => {
        const col = new three.Mesh(colGeo, accentMat);
        col.position.set(cx, 0, cz);
        group.add(col);
      });
      
      if (obj.emissive && obj.emissive !== '#000000') {
        const glowGeo = new three.BoxGeometry(sx * 0.4, sy * 0.4, sz * 0.86);
        const glowP = new three.Mesh(glowGeo, glowMat);
        glowP.position.set(0, 0, 0);
        group.add(glowP);
      }
      
    } else {
      // 4. GENERAL BEVELED SCI-FI BOX WITH DETAILED OUTLINE PANELING
      const bodyGeo = new three.BoxGeometry(sx * 0.96, sy * 0.96, sz * 0.96);
      const body = new three.Mesh(bodyGeo, mat);
      group.add(body);
      
      const frameThickness = 0.04 * Math.min(sx, sy, sz);
      const frameGeoX = new three.BoxGeometry(sx * 1.01, frameThickness, frameThickness);
      const frameGeoY = new three.BoxGeometry(frameThickness, sy * 1.01, frameThickness);
      const frameGeoZ = new three.BoxGeometry(frameThickness, frameThickness, sz * 1.01);
      
      const edgeY = sy/2 - frameThickness/2;
      const edgeZ = sz/2 - frameThickness/2;
      const edgeX = sx/2 - frameThickness/2;
      
      [[-edgeY, -edgeZ], [-edgeY, edgeZ], [edgeY, -edgeZ], [edgeY, edgeZ]].forEach(([ey, ez]) => {
        const bar = new three.Mesh(frameGeoX, accentMat);
        bar.position.set(0, ey, ez);
        group.add(bar);
      });
      
      [[-edgeX, -edgeZ], [-edgeX, edgeZ], [edgeX, -edgeZ], [edgeX, edgeZ]].forEach(([ex, ez]) => {
        const bar = new three.Mesh(frameGeoY, accentMat);
        bar.position.set(ex, 0, ez);
        group.add(bar);
      });
    }
    
  } else if (obj.type === 'cylinder') {
    const isForerunner = ['forerunner_panel', 'forerunner_gold'].includes(obj.texture) ||
                        nameLower.includes('spire') || nameLower.includes('pylon') || nameLower.includes('beacon') || nameLower.includes('forerunner');
    const isTechColumn = nameLower.includes('pillar') || nameLower.includes('column') || 
                         nameLower.includes('anchor') || nameLower.includes('generator') ||
                         ['space_alloy', 'futuristic_hex', 'synthwave_neon_laser', 'rainy_streets_neon_glow'].includes(obj.texture);
    
    if (isForerunner) {
      // 1. ANCIENT FORERUNNER ANCHOR PYLON / TAPERING OCTAGONAL SPIRE
      const baseH = sy * 0.14;
      const baseGeo = new three.CylinderGeometry(sx * 0.72, sx * 0.72, baseH, 8);
      const base = new three.Mesh(baseGeo, mat);
      base.position.y = -sy/2 + baseH/2;
      group.add(base);
      
      const shaftH = sy * 0.76;
      const shaftGeo = new three.CylinderGeometry(sx * 0.32, sx * 0.58, shaftH, 8);
      const shaft = new three.Mesh(shaftGeo, mat);
      shaft.position.y = base.position.y + baseH/2 + shaftH/2;
      group.add(shaft);
      
      const ribW = 0.08 * sx;
      const ribD = 0.1 * sx;
      const ribGeo = new three.BoxGeometry(ribW, shaftH * 1.02, ribD);
      const offsets = [
        [0, -sx * 0.45],
        [0, sx * 0.45],
        [-sx * 0.45, 0],
        [sx * 0.45, 0]
      ];
      offsets.forEach(([rx, rz]) => {
        const rib = new three.Mesh(ribGeo, accentMat);
        rib.position.set(rx, shaft.position.y, rz);
        if (rx !== 0) rib.rotation.z = rx > 0 ? 0.07 : -0.07;
        if (rz !== 0) rib.rotation.x = rz > 0 ? -0.07 : 0.07;
        group.add(rib);
      });
      
      const capH = sy * 0.08;
      const capGeo = new three.CylinderGeometry(0, sx * 0.22, capH, 8);
      const cap = new three.Mesh(capGeo, glowMat);
      cap.position.y = shaft.position.y + shaftH/2 + capH * 0.7;
      group.add(cap);
      
    } else if (isTechColumn) {
      // 2. DETAILED SCI-FI CYLINDRICAL GENERATOR COLUMN / SEGMENTED GLOW PILLAR
      const collarH = sy * 0.08;
      const collarGeo = new three.CylinderGeometry(sx * 0.58, sx * 0.58, collarH, 32);
      const baseCollar = new three.Mesh(collarGeo, accentMat);
      baseCollar.position.y = -sy/2 + collarH/2;
      group.add(baseCollar);
      
      const topCollar = new three.Mesh(collarGeo, accentMat);
      topCollar.position.y = sy/2 - collarH/2;
      group.add(topCollar);
      
      const shaftH = sy * 0.8;
      const shaftGeo = new three.CylinderGeometry(sx * 0.48, sx * 0.48, shaftH, 32);
      const shaft = new three.Mesh(shaftGeo, mat);
      shaft.position.y = 0;
      group.add(shaft);
      
      const glowRingRadius = sx * 0.505;
      const ringGeo = new three.CylinderGeometry(glowRingRadius, glowRingRadius, sy * 0.04, 32);
      
      const ringPositions = [-sy * 0.22, 0, sy * 0.22];
      ringPositions.forEach(ry => {
        const ring = new three.Mesh(ringGeo, glowMat);
        ring.position.y = ry;
        group.add(ring);
      });
      
      const gasketGeo = new three.CylinderGeometry(sx * 0.495, sx * 0.495, sy * 0.02, 32);
      [-sy * 0.11, sy * 0.11].forEach(gy => {
        const gasket = new three.Mesh(gasketGeo, accentMat);
        gasket.position.y = gy;
        group.add(gasket);
      });
      
    } else {
      // 3. STYLIZED CORE CYLINDER
      const baseH = sy * 0.05;
      const baseGeo = new three.CylinderGeometry(sx * 0.52, sx * 0.52, baseH, 32);
      
      const base = new three.Mesh(baseGeo, accentMat);
      base.position.y = -sy/2 + baseH/2;
      group.add(base);
      
      const top = new three.Mesh(baseGeo, accentMat);
      top.position.y = sy/2 - baseH/2;
      group.add(top);
      
      const bodyGeo = new three.CylinderGeometry(sx * 0.48, sx * 0.48, sy * 0.9, 32);
      const body = new three.Mesh(bodyGeo, mat);
      group.add(body);
    }
    
  } else {
    const isReactor = nameLower.includes('core') || nameLower.includes('reactor') || 
                      nameLower.includes('plasma') || nameLower.includes('emitter') ||
                      ['futuristic_shield', 'synthwave_chrome'].includes(obj.texture);
    
    if (isReactor) {
      // 1. HIGH-TECH PLASMA CORE REACTOR / FLOAT EMITTER CORE (PLANETARY ORBITS)
      const coreRadius = sx * 0.35;
      const coreGeo = new three.SphereGeometry(coreRadius, 32, 32);
      const core = new three.Mesh(coreGeo, mat);
      group.add(core);
      
      const ringOuterR = sx * 0.52;
      const ringTubeR = 0.03 * sx;
      
      const ring1Geo = new three.TorusGeometry(ringOuterR, ringTubeR, 12, 48);
      const ring1 = new three.Mesh(ring1Geo, accentMat);
      ring1.rotation.y = Math.PI / 6;
      group.add(ring1);
      
      const ring2Geo = new three.TorusGeometry(ringOuterR * 1.05, ringTubeR, 12, 48);
      const ring2 = new three.Mesh(ring2Geo, accentMat);
      ring2.rotation.x = Math.PI / 2;
      ring2.rotation.y = -Math.PI / 6;
      group.add(ring2);
      
      const rodL = sx * 0.18;
      const rodGeo = new three.CylinderGeometry(0.02 * sx, 0.03 * sx, rodL, 8);
      const offsets = [
        [sx * 0.48, 0, 0, -Math.PI/2],
        [-sx * 0.48, 0, 0, Math.PI/2],
        [0, 0, sx * 0.48, 0],
        [0, 0, -sx * 0.48, Math.PI]
      ];
      
      offsets.forEach(([rx, ry, rz, rotZ]) => {
        const rodGroup = new three.Group();
        rodGroup.position.set(rx, ry, rz);
        
        const rod = new three.Mesh(rodGeo, accentMat);
        rod.rotation.z = rotZ;
        if (rz !== 0) rod.rotation.x = rz > 0 ? Math.PI/2 : -Math.PI/2;
        
        const tipGeo = new three.SphereGeometry(0.04 * sx, 8, 8);
        const tip = new three.Mesh(tipGeo, glowMat);
        tip.position.y = -rodL/2;
        rod.add(tip);
        
        rodGroup.add(rod);
        group.add(rodGroup);
      });
      
    } else {
      // 2. GEODESIC DOME WITH MULTI-FACETED GRID HIGHLIGHTS
      const bodyGeo = new three.IcosahedronGeometry(sx / 2, 2);
      const body = new three.Mesh(bodyGeo, mat);
      group.add(body);
      
      const wireGeo = new three.IcosahedronGeometry(sx * 0.505, 2);
      const wireMat = new three.MeshBasicMaterial({
        color: new three.Color(obj.color || '#00ffff'),
        wireframe: true,
        transparent: true,
        opacity: 0.18
      });
      const wire = new three.Mesh(wireGeo, wireMat);
      group.add(wire);
    }
  }

  // Traverse children to enable shadows, PBR rendering details, and link raycasting IDs
  group.traverse(child => {
    if (child instanceof three.Mesh) {
      child.castShadow = true;
      child.receiveShadow = true;
      child.userData = { id: obj.id }; // Store ID directly on meshes for raycast checks!
    }
  });

  return group;
}

const MapPreview: React.FC<{ selectedMap: string; customMap?: CustomMapData | null }> = ({ selectedMap, customMap }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!canvasRef.current) return;
    const canvas = canvasRef.current;
    
    // Create tiny three.js preview scene
    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#030712');

    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    renderer.setSize(180, 180);
    renderer.shadowMap.enabled = true;

    const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
    camera.position.set(0, 14, 18);
    camera.lookAt(0, 0, 0);

    const ambientLight = new THREE.AmbientLight('#111827', 1.2);
    scene.add(ambientLight);

    const dirLight = new THREE.DirectionalLight('#fffbeb', 1.5);
    dirLight.position.set(5, 15, 5);
    scene.add(dirLight);

    // Primary central light
    const pointLight = new THREE.PointLight(selectedMap === 'hangar' ? '#ea580c' : '#06b6d4', 3.0, 20);
    pointLight.position.set(0, 5, 0);
    scene.add(pointLight);

    // Floor cylinder
    const floorGeo = new THREE.CylinderGeometry(8, 8, 0.4, 32);
    let floorMat = new THREE.MeshStandardMaterial({
      color: '#0f172a',
      roughness: 0.4,
      metalness: 0.8
    });

    const floor = new THREE.Mesh(floorGeo, floorMat);
    floor.position.y = -0.2;
    scene.add(floor);

    // Dynamic map features
    const group = new THREE.Group();
    scene.add(group);

    // Resolve which map data to preview
    let mapData: CustomMapData | null = null;
    if (selectedMap !== 'hangar' && selectedMap !== 'circle') {
      const premade = PREMADE_MAPS.find(m => m.id === selectedMap);
      if (premade) {
        mapData = premade;
      } else if (selectedMap === 'custom_file' && customMap) {
        mapData = customMap;
      }
    }

    if (mapData) {
      // Custom / premade map preview
      const activeRadius = mapData.arenaRadius || 20;
      const previewScale = 8.0 / activeRadius; // Scale factor so it fits nicely
      
      let mainLightColor = '#06b6d4';
      if (mapData.lighting && mapData.lighting.pointLights && mapData.lighting.pointLights.length > 0) {
        mainLightColor = mapData.lighting.pointLights[0].color;
      }
      pointLight.color.set(mainLightColor);
      pointLight.position.set(0, 5, 0);

      let floorColor = '#0f172a';
      if (mapData.theme === 'nature') {
        floorColor = '#14532d';
      } else if (mapData.theme === 'space') {
        floorColor = '#1e1b4b';
      } else if (mapData.theme === 'fantasy') {
        floorColor = '#3b0764';
      } else if (mapData.theme === 'hangar') {
        floorColor = '#1e293b';
      } else if (mapData.theme === 'synthwave') {
        floorColor = '#0a0518';
      } else if (mapData.theme === 'rainy_streets') {
        floorColor = '#0f121a';
      } else if (mapData.theme === 'winter_rink') {
        floorColor = '#e0f2fe';
      } else if (mapData.theme === 'grifball_stadium') {
        floorColor = '#111318';
      }
      
      floor.geometry.dispose();
      floor.geometry = new THREE.CylinderGeometry(activeRadius * previewScale, activeRadius * previewScale, 0.4, 32);
      (floor.material as THREE.MeshStandardMaterial).color.set(floorColor);

      if (mapData.objects) {
        mapData.objects.forEach(obj => {
          const mesh = createHighFidelityObjectMesh(obj, THREE, undefined, previewScale);
          mesh.position.set(
            obj.position.x * previewScale,
            obj.position.y * previewScale,
            obj.position.z * previewScale
          );
          mesh.rotation.set(obj.rotation.x, obj.rotation.y, obj.rotation.z);
          group.add(mesh);
        });
      }
    } else if (selectedMap === 'hangar') {
      // Set Hangar color
      (floor.material as THREE.MeshStandardMaterial).color.set('#1e293b');
      (floor.material as THREE.MeshStandardMaterial).roughness = 0.8;
      (floor.material as THREE.MeshStandardMaterial).metalness = 0.5;

      pointLight.color.set('#ea580c');

      // Industrial hangar details: 12-sided walls (small scale)
      for (let i = 0; i < 12; i++) {
        const angle = (i * Math.PI) / 6;
        const wx = Math.cos(angle) * 8.2;
        const wz = Math.sin(angle) * 8.2;
        const wall = new THREE.Mesh(new THREE.BoxGeometry(4.2, 4.0, 0.1), new THREE.MeshStandardMaterial({ color: '#111827', roughness: 0.9 }));
        wall.position.set(wx, 2, wz);
        wall.lookAt(0, 2, 0);
        group.add(wall);

        // Small orange trim lines
        const trim = new THREE.Mesh(new THREE.BoxGeometry(4.2, 0.15, 0.15), new THREE.MeshStandardMaterial({ color: '#ca8a04', roughness: 0.8 }));
        trim.position.set(wx, 3.8, wz);
        trim.lookAt(0, 3.8, 0);
        group.add(trim);

        // Heavy pillars
        if (i % 2 === 0) {
          const pillar = new THREE.Mesh(new THREE.BoxGeometry(0.4, 4.0, 0.4), new THREE.MeshStandardMaterial({ color: '#8f4f1f', roughness: 0.8 }));
          pillar.position.set(wx, 2, wz);
          pillar.lookAt(0, 2, 0);
          group.add(pillar);
        }
      }
    } else {
      // Neon circle details
      // A glowing cyan ring at the boundary
      const ringGeo = new THREE.RingGeometry(7.8, 8.0, 32);
      ringGeo.rotateX(-Math.PI / 2);
      const ringMat = new THREE.MeshBasicMaterial({ color: '#06b6d4', side: THREE.DoubleSide });
      const ring = new THREE.Mesh(ringGeo, ringMat);
      ring.position.y = 0.02;
      group.add(ring);

      // Glowing concentric ring
      const innerRingGeo = new THREE.RingGeometry(3.8, 4.0, 32);
      innerRingGeo.rotateX(-Math.PI / 2);
      const innerRing = new THREE.Mesh(innerRingGeo, ringMat);
      innerRing.position.y = 0.02;
      group.add(innerRing);

      // Simple neat columns at four cardinal points
      for (let i = 0; i < 4; i++) {
        const angle = (i * Math.PI) / 2;
        const wx = Math.cos(angle) * 7.9;
        const wz = Math.sin(angle) * 7.9;
        const beam = new THREE.Mesh(new THREE.BoxGeometry(0.15, 2.5, 0.15), new THREE.MeshStandardMaterial({ color: '#06b6d4', roughness: 0.5, metalness: 0.8 }));
        beam.position.set(wx, 1.25, wz);
        group.add(beam);
      }
    }

    let animationFrameId: number;
    let rotation = 0;

    const animate = () => {
      rotation += 0.008;
      camera.position.x = Math.sin(rotation) * 16;
      camera.position.z = Math.cos(rotation) * 16;
      camera.lookAt(0, 1.5, 0);

      renderer.render(scene, camera);
      animationFrameId = requestAnimationFrame(animate);
    };

    animate();

    return () => {
      cancelAnimationFrame(animationFrameId);
      renderer.dispose();
      scene.clear();
    };
  }, [selectedMap, customMap]);

  return (
    <div className="w-[180px] h-[180px] rounded-xl border border-white/10 bg-black/60 overflow-hidden flex items-center justify-center shrink-0 aspect-square">
      <canvas ref={canvasRef} width={180} height={180} className="w-full h-full block" />
    </div>
  );
};

export default function App() {
  const [deviceInfo, setDeviceInfo] = useState<DeviceInfo>(() => detectDeviceOS());
  const [isOnline, setIsOnline] = useState<boolean>(() => typeof navigator === 'undefined' ? true : navigator.onLine);
  const [forceMobileControls, setForceMobileControls] = useState<boolean>(false);
  const [isEdgeBrowser] = useState<boolean>(() => detectMicrosoftEdge());
  const [graphicsCheck, setGraphicsCheck] = useState<GraphicsCheckResult>({
    checked: false,
    supported: true,
    accelerated: true,
  });
  const [showGraphicsWarning, setShowGraphicsWarning] = useState<boolean>(false);
  const [edgeLowFpsSampleDurationMs, setEdgeLowFpsSampleDurationMs] = useState<number>(0);
  const [showEdgePerformanceWarning, setShowEdgePerformanceWarning] = useState<boolean>(false);
  const [edgePerformanceWarningDismissed, setEdgePerformanceWarningDismissed] = useState<boolean>(false);
  const [hardwareTab, setHardwareTab] = useState<'chrome' | 'firefox' | 'safari'>('chrome');
  const edgeLowFpsSampleRef = useRef<{ lastSampleTime: number; durationMs: number }>({
    lastSampleTime: 0,
    durationMs: 0,
  });
  const edgeLowFpsStateUpdateRef = useRef<number>(0);

  // Mobile touch joysticks references for 60fps low-latency input
  const mobileJoystickRef = useRef<{ x: number, y: number }>({ x: 0, y: 0 });
  const mobileRightJoystickRef = useRef<{ x: number, y: number }>({ x: 0, y: 0 });
  const mobileRightJoystickActiveRef = useRef<boolean>(false);

  const getWsUrl = () => {
    return getSavedMatchmakerUrl();
  };

  const buildWsUrl = (baseUrl: string, type: 'lobby' | 'gameplay', name?: string) => {
    const separator = baseUrl.includes('?') ? '&' : '?';
    let url = `${baseUrl}${separator}type=${type}`;
    if (name) {
      url += `&name=${encodeURIComponent(name)}`;
    }
    return url;
  };

  const getApiUrl = () => {
    const wsUrl = getWsUrl();
    let apiUrl = wsUrl.replace(/^ws/, 'http');
    if (apiUrl.endsWith('/ws')) {
      apiUrl = apiUrl.slice(0, -3);
    }
    return apiUrl;
  };

  useEffect(() => {
    const refreshDeviceInfo = () => setDeviceInfo(detectDeviceOS());
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('resize', refreshDeviceInfo);
    window.addEventListener('orientationchange', refreshDeviceInfo);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    // Perform browser graphics acceleration check
    const checkResult = checkGraphicsAcceleration();
    setGraphicsCheck(checkResult);
    if (!checkResult.accelerated) {
      setShowGraphicsWarning(true);
    }

    return () => {
      window.removeEventListener('resize', refreshDeviceInfo);
      window.removeEventListener('orientationchange', refreshDeviceInfo);
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [singlePlayerMode, setSinglePlayerMode] = useState<'sandbox' | 'tournament'>('sandbox');
  const [tournamentState, setTournamentState] = useState<TournamentState | null>(() => {
    try {
      const saved = localStorage.getItem('ibrawls_tournament_state');
      return saved ? JSON.parse(saved) : null;
    } catch {
      return null;
    }
  });
  const [tournamentKillsToWin, setTournamentKillsToWin] = useState(TOURNAMENT_DEFAULT_KILLS_TO_WIN);
  const [tournamentRoundCount, setTournamentRoundCount] = useState(TOURNAMENT_DEFAULT_ROUND_COUNT);
  const [selectedTournamentPresets, setSelectedTournamentPresets] = useState<string[]>([]);

  const saveTournamentState = (state: TournamentState | null) => {
    setTournamentState(state);
    if (state) {
      localStorage.setItem('ibrawls_tournament_state', JSON.stringify(state));
    } else {
      localStorage.removeItem('ibrawls_tournament_state');
    }
  };

  interface MatchResult {
    winner: 'player' | 'bot';
    opponentName: string;
    playerScore: number;
    opponentScore: number;
  }
  const [matchResult, setMatchResult] = useState<MatchResult | null>(null);

  const [matchmakerUrl, setMatchmakerUrl] = useState<string>(getSavedMatchmakerUrl());
  const [customUrlInput, setCustomUrlInput] = useState<string>(matchmakerUrl);
  const [replayUploadStatus, setReplayUploadStatus] = useState<Record<string, 'uploading' | 'done' | 'error'>>({});
  // Always-on collection is disclosed via a one-time first-run notice (no opt-in gate).
  const [showDataNotice, setShowDataNotice] = useState<boolean>(() => {
    try {
      return localStorage.getItem('ibrawls_data_notice_seen') !== '1';
    } catch {
      return false;
    }
  });
  const dismissDataNotice = () => {
    try {
      localStorage.setItem('ibrawls_data_notice_seen', '1');
    } catch {
      /* ignore */
    }
    setShowDataNotice(false);
  };
  const [isPaused, setIsPaused] = useState<boolean>(false);
  const [debugMode, setDebugMode] = useState<boolean>(false);
  const [isTerminated, setIsTerminated] = useState<boolean>(false);
  const [showAdminPanel, setShowAdminPanel] = useState<boolean>(false);
  // Collapsed state per Custom AI Behavior group; Expert groups start collapsed.
  const [collapsedAiSections, setCollapsedAiSections] = useState<Record<string, boolean>>(() => {
    const init: Record<string, boolean> = {};
    AI_CUSTOM_KNOB_SECTIONS.forEach((s) => { if (s.expert) init[s.title] = true; });
    return init;
  });
  const toggleAiSection = (title: string) =>
    setCollapsedAiSections((prev) => ({ ...prev, [title]: !prev[title] }));
  const [showUiAdjustment, setShowUiAdjustment] = useState<boolean>(false);
  const [showLightingMenu, setShowLightingMenu] = useState<boolean>(false);
  const [offlineBotCount, setOfflineBotCount] = useState<number>(3); // Default to 3 bots (total 4 combatants)
  const [botDifficulties, setBotDifficulties] = useState<Record<string, string>>({
    main_ai: 'normal',
    bot_2: 'normal',
    bot_3: 'normal',
    bot_4: 'normal',
    bot_5: 'normal',
    bot_6: 'normal',
    bot_7: 'normal',
  });
  const [botBehaviors, setBotBehaviors] = useState<Record<string, AIBehaviorPreset>>({
    main_ai: 'defensive',
    bot_2: 'defensive',
    bot_3: 'defensive',
    bot_4: 'defensive',
    bot_5: 'defensive',
    bot_6: 'defensive',
    bot_7: 'defensive',
  });
  const [botWeaponBehaviors, setBotWeaponBehaviors] = useState<Record<string, string>>({
    main_ai: 'balanced',
    bot_2: 'balanced',
    bot_3: 'balanced',
    bot_4: 'balanced',
    bot_5: 'balanced',
    bot_6: 'balanced',
    bot_7: 'balanced',
  });
  const [botArchetypes, setBotArchetypes] = useState<Record<string, AIArchetypeId>>({
    main_ai: 'none',
    bot_2: 'none',
    bot_3: 'none',
    bot_4: 'none',
    bot_5: 'none',
    bot_6: 'none',
    bot_7: 'none',
  });
  const [botColors, setBotColors] = useState<Record<string, number>>({
    main_ai: 0,
    bot_2: 120,
    bot_3: 280,
    bot_4: 45,
    bot_5: 60,
    bot_6: 320,
    bot_7: 180,
  });
  const [showBotSetupMenu, setShowBotSetupMenu] = useState<boolean>(false);
  const [selectedMap, setSelectedMap] = useState<string>('hangar');
  const [lobbyCustomMapData, setLobbyCustomMapData] = useState<CustomMapData | null>(null);
  const [showKeybindsMenu, setShowKeybindsMenu] = useState<boolean>(false);

  // Chat message state
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [lobbyChatMessages, setLobbyChatMessages] = useState<ChatMessage[]>([]);
  const [rightPanelTab, setRightPanelTab] = useState<'manual' | 'gamepad' | 'customize'>('manual');
  const [gamepadConnected, setGamepadConnected] = useState<boolean>(false);
  const [gamepadName, setGamepadName] = useState<string>('');
  const [customizerWeapon, setCustomizerWeapon] = useState<'none' | 'hammer' | 'sword'>('none');
  const [isPainting, setIsPainting] = useState<boolean>(false);
  const [playerLoadout, setPlayerLoadout] = useState<CharacterLoadout>(() => {
    try {
      const saved = localStorage.getItem('grifball_player_loadout');
      return saved ? { ...DEFAULT_LOADOUT, ...JSON.parse(saved) } : DEFAULT_LOADOUT;
    } catch { return DEFAULT_LOADOUT; }
  });
  const [keybindings, setKeybindings] = useState<Keybindings>(() => {
    try {
      const saved = localStorage.getItem('grifball_keybindings');
      if (saved) return { ...DEFAULT_KEYBINDINGS, ...JSON.parse(saved) };
    } catch (e) {}
    return { ...DEFAULT_KEYBINDINGS };
  });
  const [rebindingAction, setRebindingAction] = useState<keyof Keybindings | null>(null);

  // Gamepad visual mapper states
  const [keybindsModalTab, setKeybindsModalTab] = useState<'keyboard' | 'gamepad'>('keyboard');
  const [holdingGpButton, setHoldingGpButton] = useState<{ buttonIndex: number; name: string; progress: number } | null>(null);
  const [unassignedButtonMap, setUnassignedButtonMap] = useState<number | null>(null);
  const [pressedGpButtons, setPressedGpButtons] = useState<boolean[]>([]);
  const [hoveredAction, setHoveredAction] = useState<string | null>(null);
  const [leftStickActive, setLeftStickActive] = useState<boolean>(false);
  const [rightStickActive, setRightStickActive] = useState<boolean>(false);

  const buttonHoldStart = useRef<number>(0);
  const buttonHoldIndex = useRef<number>(-1);

  // Gamepad Virtual Cursor Refs
  const controllerCursorRef = useRef<HTMLDivElement | null>(null);
  const cursorCoordsRef = useRef<{ x: number; y: number }>({ x: window.innerWidth / 2, y: window.innerHeight / 2 });
  const prevAButtonPressedRef = useRef<boolean>(false);
  const prevHoverElRef = useRef<HTMLElement | null>(null);

  const findInteractiveElement = (x: number, y: number): HTMLElement | null => {
    const el = document.elementFromPoint(x, y);
    if (!el) return null;
    return el.closest('button, input, select, textarea, [role="button"], a, .cursor-pointer') as HTMLElement | null;
  };

  const getActionKeyForButton = (idx: number): keyof Keybindings | null => {
    const keys: (keyof Keybindings)[] = [
      'gamepadJump', 'gamepadCrouch', 'gamepadDash', 'gamepadSwapWeapon',
      'gamepadAttack', 'gamepadAltAttack', 'gamepadSprint', 'gamepadScoreboard', 'gamepadPause'
    ];
    return keys.find(k => keybindings[k] === idx) || null;
  };

  const getButtonColor = (btnIndex: number, actionKey: string | null) => {
    const isHeld = holdingGpButton?.buttonIndex === btnIndex;
    const isPressed = pressedGpButtons[btnIndex];
    const isRebinding = actionKey && rebindingAction === actionKey;
    const isHovered = actionKey && hoveredAction === actionKey;

    if (isRebinding) return '#e0f2fe';
    if (isHeld) return '#f59e0b';
    if (isPressed || isHovered) return '#22d3ee';
    return 'rgba(255,255,255,0.1)';
  };

  const getLineColor = (btnIndex: number, actionKey: string | null) => {
    const isHeld = holdingGpButton?.buttonIndex === btnIndex;
    const isPressed = pressedGpButtons[btnIndex];
    const isRebinding = actionKey && rebindingAction === actionKey;
    const isHovered = actionKey && hoveredAction === actionKey;

    if (isRebinding) return '#e0f2fe';
    if (isHeld) return '#f59e0b';
    if (isPressed || isHovered) return '#22d3ee';
    return 'rgba(125, 211, 252, 0.55)';
  };

  const getLineOpacity = (btnIndex: number, actionKey: string | null) => {
    const isHeld = holdingGpButton?.buttonIndex === btnIndex;
    const isPressed = pressedGpButtons[btnIndex];
    const isRebinding = actionKey && rebindingAction === actionKey;
    const isHovered = actionKey && hoveredAction === actionKey;

     if (isRebinding || isHeld || isPressed || isHovered) return 1.0;
    return 0.6;
  };

  const findActionForButton = (btnIdx: number): keyof Keybindings | null => {
    const gamepadKeys: (keyof Keybindings)[] = [
      'gamepadJump',
      'gamepadCrouch',
      'gamepadDash',
      'gamepadSwapWeapon',
      'gamepadAttack',
      'gamepadAltAttack',
      'gamepadSprint',
      'gamepadScoreboard',
      'gamepadPause'
    ];
    for (const key of gamepadKeys) {
      if (keybindings[key] === btnIdx) {
        return key;
      }
    }
    return null;
  };

  const renderVisualGamepadMapper = () => {
    return (
      <div className="w-full relative overflow-hidden bg-slate-950/40 border border-white/10 rounded-xl p-4 flex flex-col items-center">
        {/* Connection & Look Sensitivity panel */}
        <div className={`p-2 mb-4 rounded-xl border flex flex-col sm:flex-row items-center justify-between text-left gap-3 transition-all w-full pointer-events-auto ${
          gamepadConnected
            ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400 shadow-[0_0_15px_rgba(16,185,129,0.06)]'
            : 'bg-amber-500/10 border-amber-500/30 text-amber-400'
        }`}>
          {gamepadConnected ? (
            <div className="flex items-center gap-2 truncate">
              <span className="text-sm">🎮</span>
              <div>
                <span className="text-[10px] font-black uppercase tracking-widest block leading-tight">Gamepad Connected</span>
                <span className="text-[8.5px] font-mono text-white/50 block truncate max-w-[280px]">
                  {gamepadName}
                </span>
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <span className="text-sm animate-pulse">⚠️</span>
              <div>
                <span className="text-[10px] font-black uppercase tracking-widest block leading-tight">No Gamepad Detected</span>
                <span className="text-[9px] text-white/50 leading-tight block">
                  Connect controller & press any button to link.
                </span>
              </div>
            </div>
          )}
          <div className="flex flex-wrap items-center gap-3 w-full sm:w-auto justify-end">
            <button
              onClick={() => {
                setKeybindings(prev => {
                  const updated = {
                    ...prev,
                    gamepadSensitivity: 3.0,
                    gamepadAcceleration: 0.0,
                    gamepadJump: 0,
                    gamepadCrouch: 1,
                    gamepadDash: 2,
                    gamepadSwapWeapon: 3,
                    gamepadAttack: 7,
                    gamepadAltAttack: 5,
                    gamepadSprint: 10,
                    gamepadScoreboard: 8,
                    gamepadPause: 9,
                  };
                  try { localStorage.setItem('grifball_keybindings', JSON.stringify(updated)); } catch (_) {}
                  return updated;
                });
                setRebindingAction(null);
              }}
              className="px-2.5 h-7 border border-amber-500/20 hover:border-amber-500/40 bg-amber-500/10 hover:bg-amber-500/20 text-amber-400 text-[9px] font-bold uppercase tracking-wider rounded-lg cursor-pointer transition-all duration-150 active:scale-95 flex items-center justify-center gap-1"
            >
              ↻ Reset
            </button>
          </div>
        </div>

        {/* Mapper Canvas */}
        <div className="relative w-full overflow-x-auto flex justify-center items-center py-2 select-none">
          <div className="relative min-w-[1000px] w-[1000px] h-[480px] overflow-visible">
            {/* SVG Elements (connecting lines, controller image, and buttons) */}
            <svg width="1000" height="480" viewBox="0 0 1000 480" className="absolute inset-0 pointer-events-none z-10 overflow-visible">
              <defs>
                <filter id="glow-cyan" x="-20%" y="-20%" width="140%" height="140%">
                  <feGaussianBlur stdDeviation="3" result="blur" />
                  <feComposite in="SourceGraphic" in2="blur" operator="over" />
                </filter>
              </defs>

              {/* Connecting Lines */}
              {/* Left Side Lines */}
              <path
                d="M 220,50 L 320,50 L 320,115 L 376,115"
                fill="none"
                stroke={getLineColor(6, getActionKeyForButton(6))}
                strokeWidth={hoveredAction === getActionKeyForButton(6) || rebindingAction === getActionKeyForButton(6) || pressedGpButtons[6] ? "2.5" : "1.5"}
                strokeOpacity={getLineOpacity(6, getActionKeyForButton(6))}
                filter={hoveredAction === getActionKeyForButton(6) || rebindingAction === getActionKeyForButton(6) || pressedGpButtons[6] ? "url(#glow-cyan)" : ""}
                className="transition-all duration-200"
              />

              <path
                d="M 220,110 L 340,110 L 340,139 L 389,139"
                fill="none"
                stroke={getLineColor(4, getActionKeyForButton(4))}
                strokeWidth={hoveredAction === getActionKeyForButton(4) || rebindingAction === getActionKeyForButton(4) || pressedGpButtons[4] ? "2.5" : "1.5"}
                strokeOpacity={getLineOpacity(4, getActionKeyForButton(4))}
                filter={hoveredAction === getActionKeyForButton(4) || rebindingAction === getActionKeyForButton(4) || pressedGpButtons[4] ? "url(#glow-cyan)" : ""}
                className="transition-all duration-200"
              />

              <path
                d="M 220,170 L 430,170 L 430,234 L 462,234"
                fill="none"
                stroke={getLineColor(8, 'gamepadScoreboard')}
                strokeWidth={hoveredAction === 'gamepadScoreboard' || rebindingAction === 'gamepadScoreboard' || pressedGpButtons[8] ? "2.5" : "1.5"}
                strokeOpacity={getLineOpacity(8, 'gamepadScoreboard')}
                filter={hoveredAction === 'gamepadScoreboard' || rebindingAction === 'gamepadScoreboard' || pressedGpButtons[8] ? "url(#glow-cyan)" : ""}
                className="transition-all duration-200"
              />

              <path
                d="M 220,230 L 330,230 L 330,243 L 395,243"
                fill="none"
                stroke={getLineColor(10, 'gamepadSprint')}
                strokeWidth={hoveredAction === 'gamepadSprint' || rebindingAction === 'gamepadSprint' || pressedGpButtons[10] ? "2.5" : "1.5"}
                strokeOpacity={getLineOpacity(10, 'gamepadSprint')}
                filter={hoveredAction === 'gamepadSprint' || rebindingAction === 'gamepadSprint' || pressedGpButtons[10] ? "url(#glow-cyan)" : ""}
                className="transition-all duration-200"
              />

              <path
                d="M 220,290 L 315,290 L 315,243 L 395,243"
                fill="none"
                stroke={leftStickActive || hoveredAction === 'moveCharacter' ? "#22d3ee" : "rgba(125,211,252,0.55)"}
                strokeWidth={leftStickActive || hoveredAction === 'moveCharacter' ? "2.5" : "1.5"}
                strokeOpacity={leftStickActive || hoveredAction === 'moveCharacter' ? 1.0 : 0.6}
                filter={leftStickActive || hoveredAction === 'moveCharacter' ? "url(#glow-cyan)" : ""}
                className="transition-all duration-200"
              />

              <path
                d="M 220,350 L 360,350 L 360,299 L 445,299"
                fill="none"
                stroke={pressedGpButtons[12] || pressedGpButtons[13] || pressedGpButtons[14] || pressedGpButtons[15] || hoveredAction === 'dpad' ? "#22d3ee" : "rgba(125,211,252,0.55)"}
                strokeWidth={pressedGpButtons[12] || pressedGpButtons[13] || pressedGpButtons[14] || pressedGpButtons[15] || hoveredAction === 'dpad' ? "2.5" : "1.5"}
                strokeOpacity={pressedGpButtons[12] || pressedGpButtons[13] || pressedGpButtons[14] || pressedGpButtons[15] || hoveredAction === 'dpad' ? 1.0 : 0.6}
                filter={pressedGpButtons[12] || pressedGpButtons[13] || pressedGpButtons[14] || pressedGpButtons[15] || hoveredAction === 'dpad' ? "url(#glow-cyan)" : ""}
                className="transition-all duration-200"
              />

              {/* Right Side Lines */}
              <path
                d="M 780,50 L 700,50 L 700,115 L 622,115"
                fill="none"
                stroke={getLineColor(7, 'gamepadAttack')}
                strokeWidth={hoveredAction === 'gamepadAttack' || rebindingAction === 'gamepadAttack' || pressedGpButtons[7] ? "2.5" : "1.5"}
                strokeOpacity={getLineOpacity(7, 'gamepadAttack')}
                filter={hoveredAction === 'gamepadAttack' || rebindingAction === 'gamepadAttack' || pressedGpButtons[7] ? "url(#glow-cyan)" : ""}
                className="transition-all duration-200"
              />

              <path
                d="M 780,105 L 690,105 L 690,139 L 611,139"
                fill="none"
                stroke={getLineColor(5, 'gamepadAltAttack')}
                strokeWidth={hoveredAction === 'gamepadAltAttack' || rebindingAction === 'gamepadAltAttack' || pressedGpButtons[5] ? "2.5" : "1.5"}
                strokeOpacity={getLineOpacity(5, 'gamepadAltAttack')}
                filter={hoveredAction === 'gamepadAltAttack' || rebindingAction === 'gamepadAltAttack' || pressedGpButtons[5] ? "url(#glow-cyan)" : ""}
                className="transition-all duration-200"
              />

              <path
                d="M 780,160 L 546,160 L 546,234"
                fill="none"
                stroke={getLineColor(9, 'gamepadPause')}
                strokeWidth={hoveredAction === 'gamepadPause' || rebindingAction === 'gamepadPause' || pressedGpButtons[9] ? "2.5" : "1.5"}
                strokeOpacity={getLineOpacity(9, 'gamepadPause')}
                filter={hoveredAction === 'gamepadPause' || rebindingAction === 'gamepadPause' || pressedGpButtons[9] ? "url(#glow-cyan)" : ""}
                className="transition-all duration-200"
              />

              <path
                d="M 780,215 L 690,215 L 690,190 L 616,190 L 616,208"
                fill="none"
                stroke={getLineColor(3, 'gamepadSwapWeapon')}
                strokeWidth={hoveredAction === 'gamepadSwapWeapon' || rebindingAction === 'gamepadSwapWeapon' || pressedGpButtons[3] ? "2.5" : "1.5"}
                strokeOpacity={getLineOpacity(3, 'gamepadSwapWeapon')}
                filter={hoveredAction === 'gamepadSwapWeapon' || rebindingAction === 'gamepadSwapWeapon' || pressedGpButtons[3] ? "url(#glow-cyan)" : ""}
                className="transition-all duration-200"
              />

              <path
                d="M 780,270 L 705,270 L 705,300 L 560,300 L 560,235 L 584,235"
                fill="none"
                stroke={getLineColor(2, 'gamepadDash')}
                strokeWidth={hoveredAction === 'gamepadDash' || rebindingAction === 'gamepadDash' || pressedGpButtons[2] ? "2.5" : "1.5"}
                strokeOpacity={getLineOpacity(2, 'gamepadDash')}
                filter={hoveredAction === 'gamepadDash' || rebindingAction === 'gamepadDash' || pressedGpButtons[2] ? "url(#glow-cyan)" : ""}
                className="transition-all duration-200"
              />

              <path
                d="M 780,325 L 700,325 L 700,232 L 646,232"
                fill="none"
                stroke={getLineColor(1, 'gamepadCrouch')}
                strokeWidth={hoveredAction === 'gamepadCrouch' || rebindingAction === 'gamepadCrouch' || pressedGpButtons[1] ? "2.5" : "1.5"}
                strokeOpacity={getLineOpacity(1, 'gamepadCrouch')}
                filter={hoveredAction === 'gamepadCrouch' || rebindingAction === 'gamepadCrouch' || pressedGpButtons[1] ? "url(#glow-cyan)" : ""}
                className="transition-all duration-200"
              />

              <path
                d="M 780,380 L 670,380 L 670,260 L 613,260"
                fill="none"
                stroke={getLineColor(0, 'gamepadJump')}
                strokeWidth={hoveredAction === 'gamepadJump' || rebindingAction === 'gamepadJump' || pressedGpButtons[0] ? "2.5" : "1.5"}
                strokeOpacity={getLineOpacity(0, 'gamepadJump')}
                filter={hoveredAction === 'gamepadJump' || rebindingAction === 'gamepadJump' || pressedGpButtons[0] ? "url(#glow-cyan)" : ""}
                className="transition-all duration-200"
              />

              <path
                d="M 780,435 L 690,435 L 690,296 L 550,296"
                fill="none"
                stroke={rightStickActive || hoveredAction === 'lookAim' ? "#22d3ee" : "rgba(125,211,252,0.55)"}
                strokeWidth={rightStickActive || hoveredAction === 'lookAim' ? "2.5" : "1.5"}
                strokeOpacity={rightStickActive || hoveredAction === 'lookAim' ? 1.0 : 0.6}
                filter={rightStickActive || hoveredAction === 'lookAim' ? "url(#glow-cyan)" : ""}
                className="transition-all duration-200"
              />

              {/* High-Fidelity Controller Image */}
              <image href="/controller.png" x="290" y="90" width="420" height="294" />

              {/* Glowing Interactive Circles on top of controller buttons */}
              {/* Left Side Buttons */}
              <circle cx="376" cy="115" r="12" fill={pressedGpButtons[6] ? 'rgba(34, 211, 238, 0.4)' : 'transparent'} stroke={pressedGpButtons[6] ? '#22d3ee' : 'transparent'} strokeWidth="1.5" />
              <circle cx="389" cy="139" r="12" fill={pressedGpButtons[4] ? 'rgba(34, 211, 238, 0.4)' : 'transparent'} stroke={pressedGpButtons[4] ? '#22d3ee' : 'transparent'} strokeWidth="1.5" />
              <circle cx="462" cy="234" r="8" fill={pressedGpButtons[8] ? 'rgba(34, 211, 238, 0.4)' : 'transparent'} stroke={pressedGpButtons[8] ? '#22d3ee' : 'transparent'} strokeWidth="1.5" />
              <circle cx="395" cy="243" r="24" fill={leftStickActive ? 'rgba(34, 211, 238, 0.25)' : pressedGpButtons[10] ? 'rgba(34, 211, 238, 0.4)' : 'transparent'} stroke={leftStickActive || pressedGpButtons[10] ? '#22d3ee' : 'transparent'} strokeWidth="1.5" />
              <circle cx="445" cy="299" r="20" fill={pressedGpButtons[12] || pressedGpButtons[13] || pressedGpButtons[14] || pressedGpButtons[15] ? 'rgba(34, 211, 238, 0.35)' : 'transparent'} stroke={pressedGpButtons[12] || pressedGpButtons[13] || pressedGpButtons[14] || pressedGpButtons[15] ? '#22d3ee' : 'transparent'} strokeWidth="1.5" />

              {/* Right Side Buttons */}
              <circle cx="622" cy="115" r="12" fill={pressedGpButtons[7] ? 'rgba(34, 211, 238, 0.4)' : 'transparent'} stroke={pressedGpButtons[7] ? '#22d3ee' : 'transparent'} strokeWidth="1.5" />
              <circle cx="611" cy="139" r="12" fill={pressedGpButtons[5] ? 'rgba(34, 211, 238, 0.4)' : 'transparent'} stroke={pressedGpButtons[5] ? '#22d3ee' : 'transparent'} strokeWidth="1.5" />
              <circle cx="546" cy="234" r="8" fill={pressedGpButtons[9] ? 'rgba(34, 211, 238, 0.4)' : 'transparent'} stroke={pressedGpButtons[9] ? '#22d3ee' : 'transparent'} strokeWidth="1.5" />
              <circle cx="616" cy="208" r="11" fill={pressedGpButtons[3] ? 'rgba(250, 204, 21, 0.4)' : hoveredAction === 'gamepadSwapWeapon' ? 'rgba(250, 204, 21, 0.2)' : 'transparent'} stroke={pressedGpButtons[3] || hoveredAction === 'gamepadSwapWeapon' ? '#facc15' : 'transparent'} strokeWidth="1.5" />
              <circle cx="584" cy="235" r="11" fill={pressedGpButtons[2] ? 'rgba(96, 165, 250, 0.4)' : hoveredAction === 'gamepadDash' ? 'rgba(96, 165, 250, 0.2)' : 'transparent'} stroke={pressedGpButtons[2] || hoveredAction === 'gamepadDash' ? '#60a5fa' : 'transparent'} strokeWidth="1.5" />
              <circle cx="646" cy="232" r="11" fill={pressedGpButtons[1] ? 'rgba(248, 113, 113, 0.4)' : hoveredAction === 'gamepadCrouch' ? 'rgba(248, 113, 113, 0.2)' : 'transparent'} stroke={pressedGpButtons[1] || hoveredAction === 'gamepadCrouch' ? '#f87171' : 'transparent'} strokeWidth="1.5" />
              <circle cx="613" cy="260" r="11" fill={pressedGpButtons[0] ? 'rgba(74, 222, 128, 0.4)' : hoveredAction === 'gamepadJump' ? 'rgba(74, 222, 128, 0.2)' : 'transparent'} stroke={pressedGpButtons[0] || hoveredAction === 'gamepadJump' ? '#4ade80' : 'transparent'} strokeWidth="1.5" />
              <circle cx="550" cy="296" r="24" fill={rightStickActive ? 'rgba(34, 211, 238, 0.25)' : pressedGpButtons[11] ? 'rgba(34, 211, 238, 0.4)' : 'transparent'} stroke={rightStickActive || pressedGpButtons[11] ? '#22d3ee' : 'transparent'} strokeWidth="1.5" />

              {/* Render HTML label boxes directly inside the SVG viewBox using foreignObject */}
              {/* Left Column Labels */}
              {/* LT */}
              <foreignObject x="20" y="25" width="200" height="50" className="overflow-visible pointer-events-auto">
                <div
                  onMouseEnter={() => setHoveredAction(getActionKeyForButton(6))}
                  onMouseLeave={() => setHoveredAction(null)}
                  onClick={() => {
                    const act = getActionKeyForButton(6);
                    if (act) setRebindingAction(act);
                    else setUnassignedButtonMap(6);
                  }}
                  className={`group w-[200px] h-[50px] bg-slate-900/50 hover:bg-cyan-950/20 border transition-all duration-200 rounded-xl p-2 cursor-pointer flex flex-col justify-center items-end text-right select-none ${
                    hoveredAction === getActionKeyForButton(6) || rebindingAction === getActionKeyForButton(6) || pressedGpButtons[6]
                      ? 'border-cyan-500/50 shadow-[0_0_12px_rgba(34,211,238,0.15)] bg-slate-900/80'
                      : 'border-white/5 hover:border-cyan-500/30'
                  }`}
                >
                  <span className="text-[10px] font-black uppercase tracking-wider text-white group-hover:text-cyan-400">
                    {getActionKeyForButton(6) ? getActionKeyForButton(6)!.replace('gamepad', '').replace(/([A-Z])/g, ' $1').trim() : 'Unassigned (LT)'}
                  </span>
                  <span className="text-[8px] font-mono text-cyan-400/70 group-hover:text-cyan-300 font-bold bg-cyan-950/40 border border-cyan-500/20 px-1.5 py-0.5 rounded mt-0.5 uppercase tracking-wide">
                    {getActionKeyForButton(6) ? '[LEFT TRIGGER]' : '[LT UNASSIGNED]'}
                  </span>
                </div>
              </foreignObject>

              {/* LB */}
              <foreignObject x="20" y="85" width="200" height="50" className="overflow-visible pointer-events-auto">
                <div
                  onMouseEnter={() => setHoveredAction(getActionKeyForButton(4))}
                  onMouseLeave={() => setHoveredAction(null)}
                  onClick={() => {
                    const act = getActionKeyForButton(4);
                    if (act) setRebindingAction(act);
                    else setUnassignedButtonMap(4);
                  }}
                  className={`group w-[200px] h-[50px] bg-slate-900/50 hover:bg-cyan-950/20 border transition-all duration-200 rounded-xl p-2 cursor-pointer flex flex-col justify-center items-end text-right select-none ${
                    hoveredAction === getActionKeyForButton(4) || rebindingAction === getActionKeyForButton(4) || pressedGpButtons[4]
                      ? 'border-cyan-500/50 shadow-[0_0_12px_rgba(34,211,238,0.15)] bg-slate-900/80'
                      : 'border-white/5 hover:border-cyan-500/30'
                  }`}
                >
                  <span className="text-[10px] font-black uppercase tracking-wider text-white group-hover:text-cyan-400">
                    {getActionKeyForButton(4) ? getActionKeyForButton(4)!.replace('gamepad', '').replace(/([A-Z])/g, ' $1').trim() : 'Unassigned (LB)'}
                  </span>
                  <span className="text-[8px] font-mono text-cyan-400/70 group-hover:text-cyan-300 font-bold bg-cyan-950/40 border border-cyan-500/20 px-1.5 py-0.5 rounded mt-0.5 uppercase tracking-wide">
                    {getActionKeyForButton(4) ? '[LEFT BUMPER]' : '[LB UNASSIGNED]'}
                  </span>
                </div>
              </foreignObject>

              {/* View/Back */}
              <foreignObject x="20" y="145" width="200" height="50" className="overflow-visible pointer-events-auto">
                <div
                  onMouseEnter={() => setHoveredAction('gamepadScoreboard')}
                  onMouseLeave={() => setHoveredAction(null)}
                  onClick={() => setRebindingAction('gamepadScoreboard')}
                  className={`group w-[200px] h-[50px] bg-slate-900/50 hover:bg-cyan-950/20 border transition-all duration-200 rounded-xl p-2 cursor-pointer flex flex-col justify-center items-end text-right select-none ${
                    hoveredAction === 'gamepadScoreboard' || rebindingAction === 'gamepadScoreboard' || pressedGpButtons[8]
                      ? 'border-cyan-500/50 shadow-[0_0_12px_rgba(34,211,238,0.15)] bg-slate-900/80'
                      : 'border-white/5 hover:border-cyan-500/30'
                  }`}
                >
                  <span className="text-[10px] font-black uppercase tracking-wider text-white group-hover:text-cyan-400">
                    Scoreboard
                  </span>
                  <span className="text-[8px] font-mono text-cyan-400/70 group-hover:text-cyan-300 font-bold bg-cyan-950/40 border border-cyan-500/20 px-1.5 py-0.5 rounded mt-0.5 uppercase tracking-wide">
                    [{getGamepadButtonName(keybindings.gamepadScoreboard)}]
                  </span>
                </div>
              </foreignObject>

              {/* LS Click / Sprint */}
              <foreignObject x="20" y="205" width="200" height="50" className="overflow-visible pointer-events-auto">
                <div
                  onMouseEnter={() => setHoveredAction('gamepadSprint')}
                  onMouseLeave={() => setHoveredAction(null)}
                  onClick={() => setRebindingAction('gamepadSprint')}
                  className={`group w-[200px] h-[50px] bg-slate-900/50 hover:bg-cyan-950/20 border transition-all duration-200 rounded-xl p-2 cursor-pointer flex flex-col justify-center items-end text-right select-none ${
                    hoveredAction === 'gamepadSprint' || rebindingAction === 'gamepadSprint' || pressedGpButtons[10]
                      ? 'border-cyan-500/50 shadow-[0_0_12px_rgba(34,211,238,0.15)] bg-slate-900/80'
                      : 'border-white/5 hover:border-cyan-500/30'
                  }`}
                >
                  <span className="text-[10px] font-black uppercase tracking-wider text-white group-hover:text-cyan-400">
                    Sprint
                  </span>
                  <span className="text-[8px] font-mono text-cyan-400/70 group-hover:text-cyan-300 font-bold bg-cyan-950/40 border border-cyan-500/20 px-1.5 py-0.5 rounded mt-0.5 uppercase tracking-wide">
                    [{getGamepadButtonName(keybindings.gamepadSprint)}]
                  </span>
                </div>
              </foreignObject>

              {/* LS Move (Non-rebindable) */}
              <foreignObject x="20" y="265" width="200" height="50" className="overflow-visible pointer-events-auto">
                <div
                  onMouseEnter={() => setHoveredAction('moveCharacter')}
                  onMouseLeave={() => setHoveredAction(null)}
                  className={`group w-[200px] h-[50px] bg-slate-950/20 border transition-all duration-200 rounded-xl p-2 flex flex-col justify-center items-end text-right select-none ${
                    leftStickActive || hoveredAction === 'moveCharacter'
                      ? 'border-cyan-500/35 bg-slate-900/60'
                      : 'border-white/5'
                  }`}
                >
                  <span className="text-[10px] font-black uppercase tracking-wider text-white/70">
                    Move Character
                  </span>
                  <span className="text-[8px] font-mono text-[#38bdf8]/60 font-bold bg-black/45 border border-white/5 px-1.5 py-0.5 rounded mt-0.5 uppercase tracking-wide">
                    [LEFT STICK]
                  </span>
                </div>
              </foreignObject>

              {/* Dpad diagnostics */}
              <foreignObject x="20" y="325" width="200" height="50" className="overflow-visible pointer-events-auto">
                <div
                  onMouseEnter={() => setHoveredAction('dpad')}
                  onMouseLeave={() => setHoveredAction(null)}
                  className={`group w-[200px] h-[50px] bg-slate-950/20 border transition-all duration-200 rounded-xl p-2 flex flex-col justify-center items-end text-right select-none ${
                    pressedGpButtons[12] || pressedGpButtons[13] || pressedGpButtons[14] || pressedGpButtons[15] || hoveredAction === 'dpad'
                      ? 'border-cyan-500/35 bg-slate-900/60 shadow-[0_0_8px_rgba(34,211,238,0.15)]'
                      : 'border-white/5'
                  }`}
                >
                  <span className="text-[10px] font-black uppercase tracking-wider text-white/50">
                    Unassigned D-pad
                  </span>
                  <span className="text-[8px] font-mono text-white/30 bg-black/45 border border-white/5 px-1.5 py-0.5 rounded mt-0.5 uppercase tracking-wide">
                    [D-PAD DIRECTION]
                  </span>
                </div>
              </foreignObject>

              {/* Right Column Labels */}
              {/* RT */}
              <foreignObject x="780" y="25" width="200" height="50" className="overflow-visible pointer-events-auto">
                <div
                  onMouseEnter={() => setHoveredAction('gamepadAttack')}
                  onMouseLeave={() => setHoveredAction(null)}
                  onClick={() => setRebindingAction('gamepadAttack')}
                  className={`group w-[200px] h-[50px] bg-slate-900/50 hover:bg-cyan-950/20 border transition-all duration-200 rounded-xl p-2 cursor-pointer flex flex-col justify-center items-start text-left select-none ${
                    hoveredAction === 'gamepadAttack' || rebindingAction === 'gamepadAttack' || pressedGpButtons[7]
                      ? 'border-cyan-500/50 shadow-[0_0_12px_rgba(34,211,238,0.15)] bg-slate-900/80'
                      : 'border-white/5 hover:border-cyan-500/30'
                  }`}
                >
                  <span className="text-[10px] font-black uppercase tracking-wider text-white group-hover:text-cyan-400">
                    Primary Attack
                  </span>
                  <span className="text-[8px] font-mono text-cyan-400/70 group-hover:text-cyan-300 font-bold bg-cyan-950/40 border border-cyan-500/20 px-1.5 py-0.5 rounded mt-0.5 uppercase tracking-wide">
                    [{getGamepadButtonName(keybindings.gamepadAttack)}]
                  </span>
                </div>
              </foreignObject>

              {/* RB */}
              <foreignObject x="780" y="80" width="200" height="50" className="overflow-visible pointer-events-auto">
                <div
                  onMouseEnter={() => setHoveredAction('gamepadAltAttack')}
                  onMouseLeave={() => setHoveredAction(null)}
                  onClick={() => setRebindingAction('gamepadAltAttack')}
                  className={`group w-[200px] h-[50px] bg-slate-900/50 hover:bg-cyan-950/20 border transition-all duration-200 rounded-xl p-2 cursor-pointer flex flex-col justify-center items-start text-left select-none ${
                    hoveredAction === 'gamepadAltAttack' || rebindingAction === 'gamepadAltAttack' || pressedGpButtons[5]
                      ? 'border-cyan-500/50 shadow-[0_0_12px_rgba(34,211,238,0.15)] bg-slate-900/80'
                      : 'border-white/5 hover:border-cyan-500/30'
                  }`}
                >
                  <span className="text-[10px] font-black uppercase tracking-wider text-white group-hover:text-cyan-400">
                    Secondary Attack
                  </span>
                  <span className="text-[8px] font-mono text-cyan-400/70 group-hover:text-cyan-300 font-bold bg-cyan-950/40 border border-cyan-500/20 px-1.5 py-0.5 rounded mt-0.5 uppercase tracking-wide">
                    [{getGamepadButtonName(keybindings.gamepadAltAttack)}]
                  </span>
                </div>
              </foreignObject>

              {/* Start/Menu */}
              <foreignObject x="780" y="135" width="200" height="50" className="overflow-visible pointer-events-auto">
                <div
                  onMouseEnter={() => setHoveredAction('gamepadPause')}
                  onMouseLeave={() => setHoveredAction(null)}
                  onClick={() => setRebindingAction('gamepadPause')}
                  className={`group w-[200px] h-[50px] bg-slate-900/50 hover:bg-cyan-950/20 border transition-all duration-200 rounded-xl p-2 cursor-pointer flex flex-col justify-center items-start text-left select-none ${
                    hoveredAction === 'gamepadPause' || rebindingAction === 'gamepadPause' || pressedGpButtons[9]
                      ? 'border-cyan-500/50 shadow-[0_0_12px_rgba(34,211,238,0.15)] bg-slate-900/80'
                      : 'border-white/5 hover:border-cyan-500/30'
                  }`}
                >
                  <span className="text-[10px] font-black uppercase tracking-wider text-white group-hover:text-cyan-400">
                    Pause / Menu
                  </span>
                  <span className="text-[8px] font-mono text-cyan-400/70 group-hover:text-cyan-300 font-bold bg-cyan-950/40 border border-cyan-500/20 px-1.5 py-0.5 rounded mt-0.5 uppercase tracking-wide">
                    [{getGamepadButtonName(keybindings.gamepadPause)}]
                  </span>
                </div>
              </foreignObject>

              {/* Y */}
              <foreignObject x="780" y="190" width="200" height="50" className="overflow-visible pointer-events-auto">
                <div
                  onMouseEnter={() => setHoveredAction('gamepadSwapWeapon')}
                  onMouseLeave={() => setHoveredAction(null)}
                  onClick={() => setRebindingAction('gamepadSwapWeapon')}
                  className={`group w-[200px] h-[50px] bg-slate-900/50 hover:bg-cyan-950/20 border transition-all duration-200 rounded-xl p-2 cursor-pointer flex flex-col justify-center items-start text-left select-none ${
                    hoveredAction === 'gamepadSwapWeapon' || rebindingAction === 'gamepadSwapWeapon' || pressedGpButtons[3]
                      ? 'border-cyan-500/50 shadow-[0_0_12px_rgba(34,211,238,0.15)] bg-slate-900/80'
                      : 'border-white/5 hover:border-cyan-500/30'
                  }`}
                >
                  <span className="text-[10px] font-black uppercase tracking-wider text-white group-hover:text-cyan-400">
                    Swap Weapon
                  </span>
                  <span className="text-[8px] font-mono text-cyan-400/70 group-hover:text-cyan-300 font-bold bg-cyan-950/40 border border-cyan-500/20 px-1.5 py-0.5 rounded mt-0.5 uppercase tracking-wide">
                    [{getGamepadButtonName(keybindings.gamepadSwapWeapon)}]
                  </span>
                </div>
              </foreignObject>

              {/* X */}
              <foreignObject x="780" y="245" width="200" height="50" className="overflow-visible pointer-events-auto">
                <div
                  onMouseEnter={() => setHoveredAction('gamepadDash')}
                  onMouseLeave={() => setHoveredAction(null)}
                  onClick={() => setRebindingAction('gamepadDash')}
                  className={`group w-[200px] h-[50px] bg-slate-900/50 hover:bg-cyan-950/20 border transition-all duration-200 rounded-xl p-2 cursor-pointer flex flex-col justify-center items-start text-left select-none ${
                    hoveredAction === 'gamepadDash' || rebindingAction === 'gamepadDash' || pressedGpButtons[2]
                      ? 'border-cyan-500/50 shadow-[0_0_12px_rgba(34,211,238,0.15)] bg-slate-900/80'
                      : 'border-white/5 hover:border-cyan-500/30'
                  }`}
                >
                  <span className="text-[10px] font-black uppercase tracking-wider text-white group-hover:text-cyan-400">
                    Thrust / Dash
                  </span>
                  <span className="text-[8px] font-mono text-cyan-400/70 group-hover:text-cyan-300 font-bold bg-cyan-950/40 border border-cyan-500/20 px-1.5 py-0.5 rounded mt-0.5 uppercase tracking-wide">
                    [{getGamepadButtonName(keybindings.gamepadDash)}]
                  </span>
                </div>
              </foreignObject>

              {/* B */}
              <foreignObject x="780" y="300" width="200" height="50" className="overflow-visible pointer-events-auto">
                <div
                  onMouseEnter={() => setHoveredAction('gamepadCrouch')}
                  onMouseLeave={() => setHoveredAction(null)}
                  onClick={() => setRebindingAction('gamepadCrouch')}
                  className={`group w-[200px] h-[50px] bg-slate-900/50 hover:bg-cyan-950/20 border transition-all duration-200 rounded-xl p-2 cursor-pointer flex flex-col justify-center items-start text-left select-none ${
                    hoveredAction === 'gamepadCrouch' || rebindingAction === 'gamepadCrouch' || pressedGpButtons[1]
                      ? 'border-cyan-500/50 shadow-[0_0_12px_rgba(34,211,238,0.15)] bg-slate-900/80'
                      : 'border-white/5 hover:border-cyan-500/30'
                  }`}
                >
                  <span className="text-[10px] font-black uppercase tracking-wider text-white group-hover:text-cyan-400">
                    Crouch / Slide
                  </span>
                  <span className="text-[8px] font-mono text-cyan-400/70 group-hover:text-cyan-300 font-bold bg-cyan-950/40 border border-cyan-500/20 px-1.5 py-0.5 rounded mt-0.5 uppercase tracking-wide">
                    [{getGamepadButtonName(keybindings.gamepadCrouch)}]
                  </span>
                </div>
              </foreignObject>

              {/* A */}
              <foreignObject x="780" y="355" width="200" height="50" className="overflow-visible pointer-events-auto">
                <div
                  onMouseEnter={() => setHoveredAction('gamepadJump')}
                  onMouseLeave={() => setHoveredAction(null)}
                  onClick={() => setRebindingAction('gamepadJump')}
                  className={`group w-[200px] h-[50px] bg-slate-900/50 hover:bg-cyan-950/20 border transition-all duration-200 rounded-xl p-2 cursor-pointer flex flex-col justify-center items-start text-left select-none ${
                    hoveredAction === 'gamepadJump' || rebindingAction === 'gamepadJump' || pressedGpButtons[0]
                      ? 'border-cyan-500/50 shadow-[0_0_12px_rgba(34,211,238,0.15)] bg-slate-900/80'
                      : 'border-white/5 hover:border-cyan-500/30'
                  }`}
                >
                  <span className="text-[10px] font-black uppercase tracking-wider text-white group-hover:text-cyan-400">
                    Jump / Slide-up
                  </span>
                  <span className="text-[8px] font-mono text-cyan-400/70 group-hover:text-cyan-300 font-bold bg-cyan-950/40 border border-cyan-500/20 px-1.5 py-0.5 rounded mt-0.5 uppercase tracking-wide">
                    [{getGamepadButtonName(keybindings.gamepadJump)}]
                  </span>
                </div>
              </foreignObject>

              {/* RS Move (Non-rebindable) */}
              <foreignObject x="780" y="410" width="200" height="50" className="overflow-visible pointer-events-auto">
                <div
                  onMouseEnter={() => setHoveredAction('lookAim')}
                  onMouseLeave={() => setHoveredAction(null)}
                  className={`group w-[200px] h-[50px] bg-slate-950/20 border transition-all duration-200 rounded-xl p-2 flex flex-col justify-center items-start text-left select-none ${
                    rightStickActive || hoveredAction === 'lookAim'
                      ? 'border-cyan-500/35 bg-slate-900/60'
                      : 'border-white/5'
                  }`}
                >
                  <span className="text-[10px] font-black uppercase tracking-wider text-white/70">
                    Look & Aim Camera
                  </span>
                  <span className="text-[8px] font-mono text-[#38bdf8]/60 font-bold bg-black/45 border border-white/5 px-1.5 py-0.5 rounded mt-0.5 uppercase tracking-wide">
                    [RIGHT STICK]
                  </span>
                </div>
              </foreignObject>
            </svg>

            {/* Hold progress and unassigned selection overlays inside the visual mapper */}
            {/* Rebind prompt overlay */}
            {rebindingAction && rebindingAction.startsWith('gamepad') && (
              <div className="absolute inset-0 bg-slate-950/80 backdrop-blur-md flex items-center justify-center z-50 animate-in fade-in duration-200 rounded-2xl pointer-events-auto">
                <div className="bg-slate-900 border border-cyan-500/40 rounded-2xl p-5 max-w-sm w-full shadow-2xl text-center flex flex-col items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-cyan-950/50 border border-cyan-500/30 flex items-center justify-center text-lg text-cyan-400 animate-pulse">
                    🎮
                  </div>
                  <div>
                    <h4 className="text-white font-black text-sm uppercase tracking-tight">Rebinding Action</h4>
                    <p className="text-cyan-400 font-bold uppercase tracking-wider text-xs mt-0.5">
                      {rebindingAction.replace('gamepad', '').replace(/([A-Z])/g, ' $1').trim()}
                    </p>
                  </div>
                  <p className="text-white/60 text-[10.5px] leading-relaxed">
                    Press any button on controller to assign it to this action.<br/>
                    Press <kbd className="bg-black/60 border border-white/10 px-1 py-0.5 rounded text-[9px] text-white">ESC</kbd> or click Cancel to exit.
                  </p>
                  <button
                    onClick={() => setRebindingAction(null)}
                    className="mt-1 px-4 py-2 bg-white/5 hover:bg-red-500/20 hover:text-red-400 text-white/70 border border-white/10 hover:border-red-500/35 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-all duration-150 cursor-pointer active:scale-95"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {/* Holding timer circle overlay */}
            {holdingGpButton && (
              <div className="absolute inset-0 bg-slate-950/40 backdrop-blur-[2px] flex items-center justify-center z-45 pointer-events-none rounded-2xl">
                <div className="bg-slate-900/95 border border-amber-500/30 rounded-2xl p-4 flex flex-col items-center gap-1.5 shadow-2xl">
                  <div className="relative w-12 h-12 flex items-center justify-center">
                    <svg className="w-12 h-12 transform -rotate-90">
                      <circle cx="24" cy="24" r="20" stroke="rgba(255,255,255,0.05)" strokeWidth="3" fill="transparent" />
                      <circle cx="24" cy="24" r="20" stroke="#f59e0b" strokeWidth="3" fill="transparent"
                        strokeDasharray={125.6}
                        strokeDashoffset={125.6 - (125.6 * holdingGpButton.progress) / 100}
                        strokeLinecap="round"
                        className="transition-all duration-75"
                      />
                    </svg>
                    <span className="absolute font-mono font-black text-amber-400 text-[9px]">
                      {Math.round(holdingGpButton.progress)}%
                    </span>
                  </div>
                  <span className="text-[9px] font-black text-amber-400 uppercase tracking-widest">
                    HOLDING {holdingGpButton.name}...
                  </span>
                  <span className="text-[8px] text-white/50">
                    Keep holding to rebind
                  </span>
                </div>
              </div>
            )}

            {/* Unassigned button actions picker */}
            {unassignedButtonMap !== null && (
              <div className="absolute inset-0 bg-slate-950/85 backdrop-blur-md flex items-center justify-center z-50 animate-in fade-in duration-200 rounded-2xl pointer-events-auto">
                <div className="bg-slate-900 border border-cyan-500/40 rounded-2xl p-5 max-w-xs w-full shadow-2xl text-center flex flex-col gap-3">
                  <div className="w-10 h-10 rounded-full bg-cyan-950/50 border border-cyan-500/30 flex items-center justify-center text-lg text-cyan-400 mx-auto animate-pulse">
                    ⚙️
                  </div>
                  <div>
                    <h4 className="text-white font-black text-sm uppercase tracking-tight">Assign Action to Button</h4>
                    <p className="text-cyan-400 font-bold uppercase tracking-wider text-xs mt-0.5">
                      {getGamepadButtonName(unassignedButtonMap)}
                    </p>
                  </div>
                  <div className="flex flex-col gap-1 max-h-[180px] overflow-y-auto pr-1">
                    {([
                      { key: 'gamepadJump', label: 'Jump' },
                      { key: 'gamepadCrouch', label: 'Crouch / Slide' },
                      { key: 'gamepadDash', label: 'Thrust (Dash)' },
                      { key: 'gamepadSwapWeapon', label: 'Swap Weapon' },
                      { key: 'gamepadAttack', label: 'Primary Attack' },
                      { key: 'gamepadAltAttack', label: 'Secondary Attack' },
                      { key: 'gamepadSprint', label: 'Sprint' },
                      { key: 'gamepadScoreboard', label: 'Scoreboard' },
                      { key: 'gamepadPause', label: 'Pause / Menu' },
                    ]).map(({ key, label }) => (
                      <button
                        key={key}
                        onClick={() => {
                          setKeybindings(prev => {
                            const updated = { ...prev, [key]: unassignedButtonMap };
                            try { localStorage.setItem('grifball_keybindings', JSON.stringify(updated)); } catch (_) {}
                            return updated;
                          });
                          setUnassignedButtonMap(null);
                        }}
                        className="w-full py-1.5 px-2 bg-white/5 hover:bg-cyan-500/20 text-white hover:text-cyan-200 border border-white/5 hover:border-cyan-500/30 rounded-lg text-[10.5px] font-bold text-left transition-all cursor-pointer flex justify-between items-center"
                      >
                        <span>{label}</span>
                        <span className="text-[8px] font-mono text-white/30">
                          {keybindings[key as keyof Keybindings] !== undefined ? `[${getGamepadButtonName(keybindings[key as keyof Keybindings] as number)}]` : 'Unbound'}
                        </span>
                      </button>
                    ))}
                  </div>
                  <button
                    onClick={() => setUnassignedButtonMap(null)}
                    className="w-full py-1.5 bg-white/5 hover:bg-red-500/20 hover:text-red-400 text-white/70 border border-white/10 hover:border-red-500/30 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-all cursor-pointer active:scale-95"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Look Sensitivity & Acceleration sliders — anchored to bottom of frame */}
        <div className="w-full mt-4 flex flex-col sm:flex-row items-stretch gap-3">
          {/* Look Sensitivity */}
          <div className="flex-1 bg-slate-900/60 border border-white/10 rounded-xl px-4 py-3 flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <span className="font-mono text-[9px] uppercase tracking-wider text-white/50">Look Sensitivity</span>
              <span className="text-[#38bdf8] font-bold font-mono text-[11px] min-w-[28px] text-right">{(keybindings.gamepadSensitivity ?? 3.0).toFixed(1)}x</span>
            </div>
            <input
              type="range"
              min="0.5"
              max="10.0"
              step="0.5"
              value={keybindings.gamepadSensitivity ?? 3.0}
              onChange={(e) => {
                const val = parseFloat(e.target.value);
                setKeybindings(prev => {
                  const updated = { ...prev, gamepadSensitivity: val };
                  try { localStorage.setItem('grifball_keybindings', JSON.stringify(updated)); } catch (_) {}
                  return updated;
                });
              }}
              className="w-full accent-[#38bdf8] h-1 bg-white/10 rounded-lg appearance-none cursor-pointer"
            />
            <span className="text-[8px] text-white/35 leading-tight">Overall turn speed of the right stick when aiming.</span>
          </div>

          {/* Look Acceleration */}
          <div className="flex-1 bg-slate-900/60 border border-white/10 rounded-xl px-4 py-3 flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <span className="font-mono text-[9px] uppercase tracking-wider text-white/50">Look Acceleration</span>
              <span className="text-[#38bdf8] font-bold font-mono text-[11px] min-w-[28px] text-right">{(keybindings.gamepadAcceleration ?? 0.0) === 0 ? 'OFF' : `${(keybindings.gamepadAcceleration ?? 0.0).toFixed(1)}x`}</span>
            </div>
            <input
              type="range"
              min="0.0"
              max="2.0"
              step="0.1"
              value={keybindings.gamepadAcceleration ?? 0.0}
              onChange={(e) => {
                const val = parseFloat(e.target.value);
                setKeybindings(prev => {
                  const updated = { ...prev, gamepadAcceleration: val };
                  try { localStorage.setItem('grifball_keybindings', JSON.stringify(updated)); } catch (_) {}
                  return updated;
                });
              }}
              className="w-full accent-[#38bdf8] h-1 bg-white/10 rounded-lg appearance-none cursor-pointer"
            />
            <span className="text-[8px] text-white/35 leading-tight">Ramps turn speed the further the stick is pushed — like mouse acceleration. 0 = linear / 1:1.</span>
          </div>

          {/* Controller Cursor Speed */}
          <div className="flex-1 bg-slate-900/60 border border-white/10 rounded-xl px-4 py-3 flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <span className="font-mono text-[9px] uppercase tracking-wider text-white/50">Controller Cursor Speed</span>
              <span className="text-[#38bdf8] font-bold font-mono text-[11px] min-w-[28px] text-right">{(keybindings.gamepadCursorSpeed ?? 1.0).toFixed(1)}x</span>
            </div>
            <input
              type="range"
              min="0.2"
              max="4.0"
              step="0.1"
              value={keybindings.gamepadCursorSpeed ?? 1.0}
              onChange={(e) => {
                const val = parseFloat(e.target.value);
                setKeybindings(prev => {
                  const updated = { ...prev, gamepadCursorSpeed: val };
                  try { localStorage.setItem('grifball_keybindings', JSON.stringify(updated)); } catch (_) {}
                  return updated;
                });
              }}
              className="w-full accent-[#38bdf8] h-1 bg-white/10 rounded-lg appearance-none cursor-pointer"
            />
            <span className="text-[8px] text-white/35 leading-tight">Movement speed of the controller cursor on menus (Right Stick).</span>
          </div>
        </div>

        {/* Hold to Sprint toggle */}
        <div className="w-full mt-3 bg-slate-900/60 border border-white/10 rounded-xl px-4 py-3">
          <SprintModeToggle keybindings={keybindings} setKeybindings={setKeybindings} />
        </div>
      </div>
    );
  };

  // Retrieve saved player name or generate one
  const [playerName, setPlayerName] = useState<string>(() => {
    try {
      const savedName = localStorage.getItem('grifball_player_name');
      if (savedName) return savedName;
    } catch (e) {}
    return `Sptn-${Math.floor(1000 + Math.random() * 9000)}`;
  });

  // Optional account (null = playing as guest). Settings sync to the account's
  // cloud save when signed in. See SpartanIdentityAccount + services/account.ts.
  const [account, setAccount] = useState<AccountInfo | null>(null);

  const handlePlayerNameChange = (newName: string) => {
    const trimmed = newName.substring(0, MAX_PLAYER_NAME_LENGTH);
    setPlayerName(trimmed);
    setAdminSettings(prev => ({ ...prev, playerName: trimmed }));
    try {
      localStorage.setItem('grifball_player_name', trimmed);
    } catch (e) {}
  };

  const getSavedPlayerHue = (): number => {
    try {
      const saved = localStorage.getItem('grifball_player_hue');
      return saved ? parseInt(saved, 10) : 200;
    } catch (e) {
      return 200;
    }
  };

  const getSavedAdminSettings = (): UniversalSettings => {
    try {
      const savedAdmin = localStorage.getItem('grifball_admin_settings');
      let admin = savedAdmin ? JSON.parse(savedAdmin) : {};

      const savedVersion = localStorage.getItem('grifball_settings_version');
      if (savedVersion !== 'v2') {
        admin.enableSprint = false;
        admin.enableSlide = false;
        try {
          localStorage.setItem('grifball_settings_version', 'v2');
          const { playerHue, playerName: _name, ...rest } = admin;
          localStorage.setItem('grifball_admin_settings', JSON.stringify(rest));
        } catch (e) {}
      }
      
      const savedHue = localStorage.getItem('grifball_player_hue');
      const playerHue = savedHue ? parseInt(savedHue, 10) : 200;

      const savedName = localStorage.getItem('grifball_player_name');
      const nameVal = savedName || `Sptn-${Math.floor(1000 + Math.random() * 9000)}`;

      return {
        ...DEFAULT_ADMIN_SETTINGS,
        ...admin,
        playerHue,
        playerName: nameVal
      };
    } catch (e) {
      return DEFAULT_ADMIN_SETTINGS;
    }
  };

  const [saveCodeImportInput, setSaveCodeImportInput] = useState<string>("");
  const [saveSystemStatus, setSaveSystemStatus] = useState<{ type: 'success' | 'error' | null, message: string }>({ type: null, message: "" });

  const handleExportSaveCode = () => {
    try {
      const dataToSave: SaveData = buildSaveData(adminSettings, playerName, uiLayouts, keybindings);
      const code = encryptSaveData(dataToSave);
      navigator.clipboard.writeText(code);
      
      setSaveSystemStatus({
        type: 'success',
        message: 'Neural Backup Copied to Clipboard!'
      });
      setTimeout(() => setSaveSystemStatus({ type: null, message: "" }), 4000);
    } catch (err: any) {
      setSaveSystemStatus({
        type: 'error',
        message: err.message || 'Export failed.'
      });
    }
  };

  // Apply a decoded SaveData blob to local state + localStorage. Shared by the
  // manual save-code import and the account cloud-save pull (cloud overwrites local).
  const applySaveData = (decrypted: SaveData) => {
    // Apply Name
    handlePlayerNameChange(decrypted.playerName);

    // Apply Hue
    localStorage.setItem('grifball_player_hue', decrypted.playerHue.toString());

    // Apply UI Positions
    if (decrypted.uiLayouts) {
      const migratedLayouts = normalizeUiLayouts(decrypted.uiLayouts);
      applyUiLayouts(migratedLayouts);
    } else if (decrypted.uiPositions && Array.isArray(decrypted.uiPositions)) {
      const migratedLayouts = normalizeUiLayouts(decrypted.uiPositions);
      applyUiLayouts(migratedLayouts);
    }

    // Apply Admin Settings
    if (decrypted.adminSettings) {
      const importedAdminSettings = withDefaultGameplaySettings(decrypted.adminSettings);
      const fullSettings: UniversalSettings = {
        ...adminSettings,
        ...importedAdminSettings,
        playerHue: decrypted.playerHue,
        playerName: decrypted.playerName
      };
      setAdminSettings(fullSettings);
      localStorage.setItem('grifball_admin_settings', JSON.stringify(importedAdminSettings));
    }

    // Apply Keybindings
    if (decrypted.keybindings) {
      const merged = { ...DEFAULT_KEYBINDINGS, ...decrypted.keybindings };
      setKeybindings(merged);
      localStorage.setItem('grifball_keybindings', JSON.stringify(merged));
    }
  };

  const handleImportSaveCode = (code: string) => {
    if (!code) {
      setSaveSystemStatus({ type: 'error', message: 'Please paste a save code first.' });
      return;
    }
    try {
      const decrypted = decryptSaveCode(code);
      if (!decrypted || !decrypted.playerName || decrypted.playerHue === undefined) {
        throw new Error("Malformed save data structure.");
      }

      applySaveData(decrypted);

      setSaveSystemStatus({
        type: 'success',
        message: `Neural Link Synced! Welcome back, ${decrypted.playerName}.`
      });
      setSaveCodeImportInput("");
      setTimeout(() => setSaveSystemStatus({ type: null, message: "" }), 6000);
    } catch (err: any) {
      setSaveSystemStatus({
        type: 'error',
        message: err.message || 'Import failed.'
      });
    }
  };

  const handleResetAllSettings = () => {
    if (confirm("Are you sure you want to completely erase all client saves, custom layout configurations, and restore all default values?")) {
      try {
        localStorage.removeItem('grifball_player_name');
        localStorage.removeItem('grifball_player_hue');
        localStorage.removeItem('grifball_ui_positions');
        localStorage.removeItem('grifball_admin_settings');
        localStorage.removeItem('grifball_keybindings');
        localStorage.removeItem('grifball_settings_version');
        localStorage.removeItem('grifball_collapsed_sections');
        
        // Reset states
        const defaultName = `Sptn-${Math.floor(1000 + Math.random() * 9000)}`;
        setPlayerName(defaultName);
        applyUiLayouts(getDefaultUiLayouts());
        setKeybindings({ ...DEFAULT_KEYBINDINGS });
        setAdminSettings(createDefaultAdminSettings(defaultName));
        setCollapsedSections({});
        
        setSaveSystemStatus({
          type: 'success',
          message: 'All saves purged. Neural connection reset.'
        });
        setTimeout(() => setSaveSystemStatus({ type: null, message: "" }), 4000);
      } catch (err) {
        console.error(err);
      }
    }
  };

  // Keybind rebinding listener
  useEffect(() => {
    if (!rebindingAction) return;

    // Handle gamepad rebinding specifically if the action name starts with 'gamepad'
    if (rebindingAction.startsWith('gamepad')) {
      let active = true;
      let rafId: number;

      // Filter out initially pressed buttons to avoid instant rebinding
      const gps = navigator.getGamepads ? navigator.getGamepads() : [];
      const initialPressed: boolean[] = [];
      for (let i = 0; i < gps.length; i++) {
        if (gps[i]) {
          gps[i]!.buttons.forEach((b, idx) => {
            if (b.pressed) initialPressed[idx] = true;
          });
          break;
        }
      }

      const pollGamepadForRebind = () => {
        if (!active) return;
        const currentGps = navigator.getGamepads ? navigator.getGamepads() : [];
        let activeGp = null;
        for (let i = 0; i < currentGps.length; i++) {
          if (currentGps[i]) {
            activeGp = currentGps[i];
            break;
          }
        }

        if (activeGp) {
          for (let idx = 0; idx < activeGp.buttons.length; idx++) {
            const pressed = activeGp.buttons[idx].pressed;
            if (pressed && !initialPressed[idx]) {
              setKeybindings(prev => {
                const updated = { ...prev, [rebindingAction]: idx };
                try { localStorage.setItem('grifball_keybindings', JSON.stringify(updated)); } catch (_) {}
                return updated;
              });
              setRebindingAction(null);
              active = false;
              return;
            } else if (!pressed) {
              initialPressed[idx] = false;
            }
          }
        }
        rafId = requestAnimationFrame(pollGamepadForRebind);
      };

      rafId = requestAnimationFrame(pollGamepadForRebind);

      const handleGamepadEsc = (e: KeyboardEvent) => {
        if (e.key === 'Escape') {
          setRebindingAction(null);
        }
      };

      window.addEventListener('keydown', handleGamepadEsc, true);
      return () => {
        active = false;
        cancelAnimationFrame(rafId);
        window.removeEventListener('keydown', handleGamepadEsc, true);
      };
    }

    // Standard Keyboard + Mouse rebinding logic
    const handleRebindKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === 'Escape') {
        setRebindingAction(null);
        return;
      }
      const newKey = e.key.toLowerCase();
      setKeybindings(prev => {
        const updated = { ...prev, [rebindingAction]: newKey };
        try { localStorage.setItem('grifball_keybindings', JSON.stringify(updated)); } catch (err) {}
        return updated;
      });
      setRebindingAction(null);
    };

    const handleRebindMouse = (e: MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const mouseMap: Record<number, string> = { 0: 'lmb', 2: 'rmb', 1: 'mmb' };
      const newKey = mouseMap[e.button];
      if (!newKey) return;
      setKeybindings(prev => {
        const updated = { ...prev, [rebindingAction]: newKey };
        try { localStorage.setItem('grifball_keybindings', JSON.stringify(updated)); } catch (err) {}
        return updated;
      });
      setRebindingAction(null);
    };

    window.addEventListener('keydown', handleRebindKey, true);
    window.addEventListener('mousedown', handleRebindMouse, true);
    return () => {
      window.removeEventListener('keydown', handleRebindKey, true);
      window.removeEventListener('mousedown', handleRebindMouse, true);
    };
  }, [rebindingAction]);

  // Gamepad Connection Listeners
  useEffect(() => {
    const handleGamepadConnect = (e: GamepadEvent) => {
      setGamepadConnected(true);
      setGamepadName(e.gamepad.id);
    };

    const handleGamepadDisconnect = (e: GamepadEvent) => {
      const gps = navigator.getGamepads ? navigator.getGamepads() : [];
      let found = false;
      for (let i = 0; i < gps.length; i++) {
        if (gps[i]) {
          setGamepadConnected(true);
          setGamepadName(gps[i]!.id);
          found = true;
          break;
        }
      }
      if (!found) {
        setGamepadConnected(false);
        setGamepadName('');
      }
    };

    window.addEventListener('gamepadconnected', handleGamepadConnect);
    window.addEventListener('gamepaddisconnected', handleGamepadDisconnect);

    // Initial check
    const gps = navigator.getGamepads ? navigator.getGamepads() : [];
    for (let i = 0; i < gps.length; i++) {
      if (gps[i]) {
        setGamepadConnected(true);
        setGamepadName(gps[i]!.id);
        break;
      }
    }

    return () => {
      window.removeEventListener('gamepadconnected', handleGamepadConnect);
      window.removeEventListener('gamepaddisconnected', handleGamepadDisconnect);
    };
  }, []);

  // Gamepad continuous state listener for visual mapper diagnostics, 3s hold trigger, and controller cursor
  useEffect(() => {
    if (!gamepadConnected) return;

    let active = true;
    let rafId: number;
    let lastTime = performance.now();

    const pollGamepad = () => {
      if (!active) return;
      const now = performance.now();
      const dt = Math.min(0.1, (now - lastTime) / 1000);
      lastTime = now;

      const currentGps = navigator.getGamepads ? navigator.getGamepads() : [];
      let activeGp = null;
      for (let i = 0; i < currentGps.length; i++) {
        if (currentGps[i]) {
          activeGp = currentGps[i];
          break;
        }
      }

      if (activeGp) {
        // Update pressed buttons diagnostic array
        const newPressed = activeGp.buttons.map(b => b.pressed);
        setPressedGpButtons(newPressed);

        // Stick diagnostic states
        const deadzone = 0.15;
        const leftActive = activeGp.axes.length >= 2 && (Math.abs(activeGp.axes[0]) > deadzone || Math.abs(activeGp.axes[1]) > deadzone);
        const rightActive = activeGp.axes.length >= 4 && (Math.abs(activeGp.axes[2]) > deadzone || Math.abs(activeGp.axes[3]) > deadzone);
        setLeftStickActive(leftActive);
        setRightStickActive(rightActive);

        // Custom controller cursor movement & interaction when not in active gameplay
        const isCursorActive = !!(
          !isPlaying ||
          isPaused ||
          (document.pointerLockElement === null && !deviceInfo.isMobile && !forceMobileControls) ||
          matchResult !== null
        );

        if (isCursorActive) {
          if (controllerCursorRef.current) {
            controllerCursorRef.current.style.display = 'block';
          }

          const rx = activeGp.axes[2];
          const ry = activeGp.axes[3];
          const aimDeadzone = 0.18;
          
          if (Math.abs(rx) > aimDeadzone || Math.abs(ry) > aimDeadzone) {
            const speedMultiplier = keybindings.gamepadCursorSpeed ?? 1.0;
            const baseSpeed = 400; // base speed in pixels per second
            
            const applyDeadzone = (val: number) => {
              const absVal = Math.abs(val);
              if (absVal <= aimDeadzone) return 0;
              const sign = val < 0 ? -1 : 1;
              return sign * ((absVal - aimDeadzone) / (1 - aimDeadzone));
            };

            const dx = applyDeadzone(rx) * baseSpeed * speedMultiplier * dt;
            const dy = applyDeadzone(ry) * baseSpeed * speedMultiplier * dt;
            
            cursorCoordsRef.current.x = Math.max(0, Math.min(window.innerWidth, cursorCoordsRef.current.x + dx));
            cursorCoordsRef.current.y = Math.max(0, Math.min(window.innerHeight, cursorCoordsRef.current.y + dy));
            
            if (controllerCursorRef.current) {
              controllerCursorRef.current.style.left = `${cursorCoordsRef.current.x}px`;
              controllerCursorRef.current.style.top = `${cursorCoordsRef.current.y}px`;
            }
          }

          // Hover detection
          const hoverEl = findInteractiveElement(cursorCoordsRef.current.x, cursorCoordsRef.current.y);
          if (hoverEl !== prevHoverElRef.current) {
            if (prevHoverElRef.current) {
              prevHoverElRef.current.classList.remove('gpad-hover');
              prevHoverElRef.current.dispatchEvent(new MouseEvent('mouseleave', { bubbles: true, cancelable: true }));
            }
            if (hoverEl) {
              hoverEl.classList.add('gpad-hover');
              hoverEl.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true, cancelable: true }));
            }
            prevHoverElRef.current = hoverEl;
          }

          // A button click/drag simulation
          const aPressed = activeGp.buttons[0]?.pressed || false;
          const aWasPressed = prevAButtonPressedRef.current;
          prevAButtonPressedRef.current = aPressed;

          if (aPressed && !aWasPressed) {
            const target = document.elementFromPoint(cursorCoordsRef.current.x, cursorCoordsRef.current.y);
            if (target) {
              target.dispatchEvent(new MouseEvent('mousedown', {
                bubbles: true,
                cancelable: true,
                view: window,
                clientX: cursorCoordsRef.current.x,
                clientY: cursorCoordsRef.current.y
              }));
              if (typeof (target as any).focus === 'function') {
                (target as any).focus();
              }
            }
          } else if (!aPressed && aWasPressed) {
            const target = document.elementFromPoint(cursorCoordsRef.current.x, cursorCoordsRef.current.y);
            if (target) {
              target.dispatchEvent(new MouseEvent('mouseup', {
                bubbles: true,
                cancelable: true,
                view: window,
                clientX: cursorCoordsRef.current.x,
                clientY: cursorCoordsRef.current.y
              }));
              target.dispatchEvent(new MouseEvent('click', {
                bubbles: true,
                cancelable: true,
                view: window,
                clientX: cursorCoordsRef.current.x,
                clientY: cursorCoordsRef.current.y
              }));
            }
          } else if (aPressed) {
            const target = document.elementFromPoint(cursorCoordsRef.current.x, cursorCoordsRef.current.y);
            if (target) {
              target.dispatchEvent(new MouseEvent('mousemove', {
                bubbles: true,
                cancelable: true,
                view: window,
                clientX: cursorCoordsRef.current.x,
                clientY: cursorCoordsRef.current.y,
                buttons: 1
              }));
            }
          }
        } else {
          if (prevHoverElRef.current) {
            prevHoverElRef.current.classList.remove('gpad-hover');
            prevHoverElRef.current = null;
          }
          if (controllerCursorRef.current) {
            controllerCursorRef.current.style.display = 'none';
          }
          prevAButtonPressedRef.current = false;
        }

        // Only process holds/assignments if we are NOT in the middle of active modal/popup rebinding
        if (!rebindingAction && unassignedButtonMap === null) {
          let pressedIdx = -1;
          for (let idx = 0; idx < activeGp.buttons.length; idx++) {
            if (activeGp.buttons[idx].pressed) {
              pressedIdx = idx;
              break;
            }
          }

          if (pressedIdx !== -1) {
            if (buttonHoldIndex.current === -1) {
              buttonHoldIndex.current = pressedIdx;
              buttonHoldStart.current = performance.now();
              setHoldingGpButton({
                buttonIndex: pressedIdx,
                name: getGamepadButtonName(pressedIdx),
                progress: 0
              });
            } else if (buttonHoldIndex.current === pressedIdx) {
              const elapsed = performance.now() - buttonHoldStart.current;
              const progress = Math.min(100, (elapsed / 3000) * 100);
              
              if (elapsed >= 3000) {
                const actionKey = findActionForButton(pressedIdx);
                if (actionKey) {
                  setRebindingAction(actionKey);
                } else {
                  setUnassignedButtonMap(pressedIdx);
                }
                buttonHoldIndex.current = -1;
                setHoldingGpButton(null);
              } else {
                setHoldingGpButton({
                  buttonIndex: pressedIdx,
                  name: getGamepadButtonName(pressedIdx),
                  progress
                });
              }
            } else {
              buttonHoldIndex.current = -1;
              setHoldingGpButton(null);
            }
          } else {
            if (buttonHoldIndex.current !== -1) {
              buttonHoldIndex.current = -1;
              setHoldingGpButton(null);
            }
          }
        } else {
          if (buttonHoldIndex.current !== -1) {
            buttonHoldIndex.current = -1;
            setHoldingGpButton(null);
          }
        }
      } else {
        setPressedGpButtons([]);
        setLeftStickActive(false);
        setRightStickActive(false);
        if (buttonHoldIndex.current !== -1) {
          buttonHoldIndex.current = -1;
          setHoldingGpButton(null);
        }
        if (prevHoverElRef.current) {
          prevHoverElRef.current.classList.remove('gpad-hover');
          prevHoverElRef.current = null;
        }
        if (controllerCursorRef.current) {
          controllerCursorRef.current.style.display = 'none';
        }
        prevAButtonPressedRef.current = false;
      }

      rafId = requestAnimationFrame(pollGamepad);
    };

    rafId = requestAnimationFrame(pollGamepad);

    return () => {
      active = false;
      cancelAnimationFrame(rafId);
      if (prevHoverElRef.current) {
        prevHoverElRef.current.classList.remove('gpad-hover');
        prevHoverElRef.current = null;
      }
      if (controllerCursorRef.current) {
        controllerCursorRef.current.style.display = 'none';
      }
      prevAButtonPressedRef.current = false;
    };
  }, [gamepadConnected, isPlaying, isPaused, keybindings, deviceInfo, forceMobileControls, matchResult, rebindingAction, unassignedButtonMap]);

  // Multiplayer States
  const [connectionMode, setConnectionMode] = useState<'relay' | 'local'>('relay');
  const [activeMenuTab, setActiveMenuTab] = useState<'single' | 'multi' | 'spec' | 'theater'>('single');
  const [showCustomizationFrame, setShowCustomizationFrame] = useState<boolean>(true);
  const [mainMenuFrameLayout, setMainMenuFrameLayout] = useState<MainMenuFrameLayout>(() => {
    try {
      const saved = localStorage.getItem(MAIN_MENU_FRAME_LAYOUT_STORAGE_KEY);
      return saved ? clampMainMenuFrameLayout(JSON.parse(saved)) : DEFAULT_MAIN_MENU_FRAME_LAYOUT;
    } catch (e) {
      console.error('Failed to load main menu frame layout:', e);
      return DEFAULT_MAIN_MENU_FRAME_LAYOUT;
    }
  });
  const mainMenuLayoutRef = useRef<HTMLDivElement | null>(null);
  const mainMenuContentGridRef = useRef<HTMLDivElement | null>(null);
  const mainMenuFrameLayoutRef = useRef<MainMenuFrameLayout>(mainMenuFrameLayout);
  const [isMultiplayer, setIsMultiplayer] = useState<boolean>(false);

  useEffect(() => {
    mainMenuFrameLayoutRef.current = mainMenuFrameLayout;
  }, [mainMenuFrameLayout]);

  const persistMainMenuFrameLayout = (layout: MainMenuFrameLayout) => {
    try {
      localStorage.setItem(MAIN_MENU_FRAME_LAYOUT_STORAGE_KEY, JSON.stringify(layout));
    } catch (e) {
      console.error('Failed to save main menu frame layout:', e);
    }
  };

  const applyMainMenuFrameLayout = (layout: Partial<MainMenuFrameLayout>, shouldPersist = true) => {
    const nextLayout = clampMainMenuFrameLayout(layout);
    mainMenuFrameLayoutRef.current = nextLayout;
    setMainMenuFrameLayout(nextLayout);
    if (shouldPersist) {
      persistMainMenuFrameLayout(nextLayout);
    }
    return nextLayout;
  };

  const handleToggleCustomizationFrame = () => {
    setShowCustomizationFrame((visible) => {
      const nextVisible = !visible;
      if (!nextVisible) {
        setIsPainting(false);
        setRebindingAction(null);
      }
      return nextVisible;
    });
  };

  const handleResetMainMenuFrameLayout = () => {
    mainMenuFrameLayoutRef.current = DEFAULT_MAIN_MENU_FRAME_LAYOUT;
    setMainMenuFrameLayout(DEFAULT_MAIN_MENU_FRAME_LAYOUT);
    try {
      localStorage.removeItem(MAIN_MENU_FRAME_LAYOUT_STORAGE_KEY);
    } catch (e) {
      console.error('Failed to reset main menu frame layout:', e);
    }
  };

  const handleMainMenuSplitterPointerDown = (
    splitter: 'customization' | 'chat',
    e: React.PointerEvent<HTMLButtonElement>
  ) => {
    if (deviceInfo.isMobile) return;
    const pointerId = e.pointerId;
    let animationFrameId: number | null = null;
    let pendingLayout: MainMenuFrameLayout | null = null;
    const previousCursor = document.body.style.cursor;
    const previousUserSelect = document.body.style.userSelect;

    e.preventDefault();
    e.stopPropagation();
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    const flushPendingLayout = () => {
      animationFrameId = null;
      if (!pendingLayout) return;
      const layout = pendingLayout;
      pendingLayout = null;
      applyMainMenuFrameLayout(layout, false);
    };

    const scheduleLayout = (layout: MainMenuFrameLayout) => {
      pendingLayout = layout;
      if (animationFrameId === null) {
        animationFrameId = window.requestAnimationFrame(flushPendingLayout);
      }
    };

    const handleWindowPointerMove = (event: PointerEvent) => {
      if (event.pointerId !== pointerId) return;

      if (splitter === 'customization') {
        const rect = mainMenuContentGridRef.current?.getBoundingClientRect();
        if (!rect) return;
        const availableWidth = rect.width - MAIN_MENU_SPLITTER_WIDTH_PX;
        const minTotalWidth = MAIN_MENU_SETUP_MIN_PX + MAIN_MENU_CUSTOMIZATION_MIN_PX;
        if (availableWidth <= minTotalWidth) return;

        const setupPx = clampNumber(
          event.clientX - rect.left,
          MAIN_MENU_SETUP_MIN_PX,
          availableWidth - MAIN_MENU_CUSTOMIZATION_MIN_PX
        );
        const totalFr = mainMenuFrameLayoutRef.current.setupFr + mainMenuFrameLayoutRef.current.customizationFr;

        scheduleLayout({
          ...mainMenuFrameLayoutRef.current,
          setupFr: (setupPx / availableWidth) * totalFr,
          customizationFr: ((availableWidth - setupPx) / availableWidth) * totalFr,
        });
        return;
      }

      const rect = mainMenuLayoutRef.current?.getBoundingClientRect();
      if (!rect) return;
      scheduleLayout({
        ...mainMenuFrameLayoutRef.current,
        chatWidth: clampNumber(rect.right - event.clientX, MAIN_MENU_CHAT_MIN_PX, MAIN_MENU_CHAT_MAX_PX),
      });
    };

    const handleWindowPointerUp = (event: PointerEvent) => {
      if (event.pointerId !== pointerId) return;
      if (animationFrameId !== null) {
        window.cancelAnimationFrame(animationFrameId);
        flushPendingLayout();
      }
      persistMainMenuFrameLayout(mainMenuFrameLayoutRef.current);
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousUserSelect;
      window.removeEventListener('pointermove', handleWindowPointerMove);
      window.removeEventListener('pointerup', handleWindowPointerUp);
      window.removeEventListener('pointercancel', handleWindowPointerUp);
    };

    window.addEventListener('pointermove', handleWindowPointerMove);
    window.addEventListener('pointerup', handleWindowPointerUp);
    window.addEventListener('pointercancel', handleWindowPointerUp);
  };

  const mainMenuLayoutStyle = {
    '--main-menu-chat-width': `${mainMenuFrameLayout.chatWidth}px`,
  } as React.CSSProperties;

  const shouldRenderCustomizationFrame = showCustomizationFrame && activeMenuTab !== 'theater';

  const mainMenuContentGridStyle = {
    '--main-menu-setup-fr': `${mainMenuFrameLayout.setupFr}fr`,
    '--main-menu-customization-fr': `${mainMenuFrameLayout.customizationFr}fr`,
    gridTemplateColumns: shouldRenderCustomizationFrame
      ? isPainting
        ? 'minmax(0, 1fr)'
        : `minmax(${MAIN_MENU_SETUP_MIN_PX}px, var(--main-menu-setup-fr)) ${MAIN_MENU_SPLITTER_WIDTH_PX}px minmax(${MAIN_MENU_CUSTOMIZATION_MIN_PX}px, var(--main-menu-customization-fr))`
      : 'minmax(0, 1fr)',
    minWidth: 0,
  } as React.CSSProperties;

  const mainMenuChatStyle = {
    width: 'var(--main-menu-chat-width)',
    flexShrink: 0,
    minHeight: 0,
    display: 'flex',
    flexDirection: 'column',
  } as React.CSSProperties;

  // Theater Mode Replay States
  const [selectedReplay, setSelectedReplay] = useState<ReplayFile | null>(null);
  const [savedReplays, setSavedReplays] = useState<ReplayFile[]>([]);
  const [cachedReplays, setCachedReplays] = useState<ReplayFile[]>([]);
  const [replaySizes, setReplaySizes] = useState<Record<string, number>>({});
  const [heatmapOnlyReplay, setHeatmapOnlyReplay] = useState<ReplayFile | null>(null);
  const [heatmapOnlyTime, setHeatmapOnlyTime] = useState<number>(0);
  const [heatmapOnlyPlaying, setHeatmapOnlyPlaying] = useState<boolean>(false);
  const [replayHeatmapPanelCollapsed, setReplayHeatmapPanelCollapsed] = useState<boolean>(false);
  const [replayHeatmapPanelSize, setReplayHeatmapPanelSize] = useState<{ width: number; height: number }>({
    width: 360,
    height: 280,
  });
  
  // Theater Filters & Search
  const [theaterSearchQuery, setTheaterSearchQuery] = useState<string>('');
  const [theaterMapFilter, setTheaterMapFilter] = useState<'all' | 'hangar' | 'circle'>('all');
  const [theaterModeFilter, setTheaterModeFilter] = useState<'all' | 'sandbox' | 'tournament'>('all');
  
  // Theater Rename Modal States
  const [editReplayId, setEditReplayId] = useState<string | null>(null);
  const [editReplayName, setEditReplayName] = useState<string>('');
  const [editReplayDesc, setEditReplayDesc] = useState<string>('');
  const [showEditModal, setShowEditModal] = useState<boolean>(false);

  // Theater Save Permanently Modal States
  const [saveCachedId, setSaveCachedId] = useState<string | null>(null);
  const [saveCachedName, setSaveCachedName] = useState<string>('');
  const [saveCachedDesc, setSaveCachedDesc] = useState<string>('');
  const [showSaveModal, setShowSaveModal] = useState<boolean>(false);

  // Load replays from IndexedDB
  const loadTheaterReplays = async () => {
    try {
      const saved = await getSavedReplays();
      const cached = await getCachedReplays();
      setSavedReplays(saved);
      setCachedReplays(cached);
      const sizes: Record<string, number> = {};
      for (const replay of [...saved, ...cached]) {
        sizes[replay.id] = getReplayStorageSizeBytes(replay);
      }
      setReplaySizes(sizes);
    } catch (err) {
      console.error('Failed to load theater replays from IndexedDB:', err);
    }
  };

  useEffect(() => {
    if (activeMenuTab === 'theater') {
      loadTheaterReplays();
    }
  }, [activeMenuTab]);

  useEffect(() => {
    if (selectedReplay) {
      setReplayHeatmapPanelCollapsed(false);
    }
  }, [selectedReplay?.id]);

  useEffect(() => {
    if (!heatmapOnlyReplay || !heatmapOnlyPlaying) return;
    let frameId = 0;
    let lastTime = performance.now();

    const tick = (now: number) => {
      const dt = Math.max(0, (now - lastTime) / 1000);
      lastTime = now;
      setHeatmapOnlyTime((current) => {
        const next = Math.min(heatmapOnlyReplay.duration ?? 0, current + dt);
        if (next >= (heatmapOnlyReplay.duration ?? 0)) {
          setHeatmapOnlyPlaying(false);
        }
        return next;
      });
      frameId = requestAnimationFrame(tick);
    };

    frameId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frameId);
  }, [heatmapOnlyReplay, heatmapOnlyPlaying]);

  const handleOpenHeatmapReplay = (replay: ReplayFile) => {
    setHeatmapOnlyReplay(replay);
    setHeatmapOnlyTime(0);
    setHeatmapOnlyPlaying(true);
  };

  const handleReplayHeatmapResizePointerDown = (event: React.PointerEvent<HTMLButtonElement>) => {
    event.preventDefault();
    const startX = event.clientX;
    const startY = event.clientY;
    const startSize = replayHeatmapPanelSize;

    const handlePointerMove = (moveEvent: PointerEvent) => {
      setReplayHeatmapPanelSize({
        width: clampNumber(startSize.width + moveEvent.clientX - startX, 280, 680),
        height: clampNumber(startSize.height + moveEvent.clientY - startY, 210, 560),
      });
    };

    const handlePointerUp = () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
  };

  const renderReplayHeatmapPreview = (replay: ReplayFile) => (
    <ReplayHeatmapCanvas
      replay={replay}
      mode="preview"
      showControls={false}
      className="h-24 min-h-24"
    />
  );

  const renderRollingReplayCachePanel = () => (
    <div className="flex flex-col h-full min-h-0 gap-4 text-left">
      <div className="bg-slate-950/45 border border-white/10 rounded-xl p-4.5 flex flex-col gap-3 shrink-0 shadow-[inset_0_1px_3px_rgba(0,0,0,0.30)]">
        <span className="text-[10px] font-mono font-bold tracking-[0.4em] uppercase text-[#f59e0b]">AUTO-SAVE CACHE</span>
        <h2 className="text-xl font-display font-black italic uppercase tracking-tight" style={{ background: 'linear-gradient(90deg,#f59e0b,#fff,#eab308)', WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent', lineHeight: 1 }}>
          Rolling Match Cache
        </h2>
        <p className="text-[11.5px] text-white/60 leading-normal">
          Keeps a rolling buffer of your last 5 matches. These are overwritten sequentially as new matches finish. Transfer them to Saved Replays to store them permanently!
        </p>
      </div>

      <div className="flex-1 overflow-y-auto min-h-0 flex flex-col gap-2.5 pr-1">
        {cachedReplays.length === 0 ? (
          <div className="bg-black/30 border border-white/5 rounded-lg p-5 text-center my-auto">
            <p className="text-xs text-white/40 italic font-medium">Rolling cache is currently empty.</p>
            <p className="text-[10px] text-white/30 mt-1 leading-normal">
              Complete a training match or tournament fight to see your replay automatically cached here!
            </p>
          </div>
        ) : (
          cachedReplays.map(replay => {
            const minutes = Math.floor(replay.duration / 60);
            const seconds = Math.floor(replay.duration % 60);
            const durationStr = `${minutes}:${seconds < 10 ? '0' : ''}${seconds}`;
            const sizeStr = formatReplaySizeMB(replaySizes[replay.id] ?? 0);
            const canOpenHeatmap = replayHasHeatmapEvents(replay);

            let formattedDate = replay.date;
            try {
              formattedDate = new Date(replay.date).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
            } catch (_) {}

            return (
              <div key={replay.id} className="bg-slate-950/45 border border-white/5 rounded-xl p-3.5 flex flex-col gap-2.5 shadow-md border-l-4 border-l-[#f59e0b] hover:border-l-yellow-400 transition-all shrink-0">
                <div className="flex justify-between items-start gap-2">
                  <div className="flex flex-col min-w-0 text-left">
                    <h4 className="text-xs font-black uppercase text-[#eab308] truncate">
                      {replay.name || `Rolling Cache Match - ${formattedDate}`}
                    </h4>
                    <span className="text-[9px] text-white/40 italic mt-0.5">
                      [Auto-saved from local match]
                    </span>
                  </div>
                  <span className="text-[9px] font-mono font-bold text-white/40 bg-white/5 border border-white/10 px-2 py-0.5 rounded shrink-0">
                    {durationStr} Â· {sizeStr}
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-1 text-[9px] font-mono text-white/50 border-t border-b border-white/5 py-1.5">
                  <div>Map: <span className="text-white/80 font-bold uppercase">{replay.mapType}</span></div>
                  <div>Mode: <span className="text-white/80 font-bold uppercase">{replay.mode}</span></div>
                  <div>Pilot: <span className="text-white/80 font-bold uppercase">{replay.playerName}</span></div>
                  <div>Opponent: <span className="text-white/80 font-bold uppercase">{replay.opponentName}</span></div>
                </div>

                {renderReplayHeatmapPreview(replay)}

                <div className="flex items-center justify-between mt-0.5 gap-2">
                  <span className="text-[9px] font-mono text-white/30">{formattedDate}</span>
                  <div className="flex gap-1.5">
                    <button
                      onClick={async () => {
                        if (confirm('Delete this rolling cache match replay?')) {
                          await deleteReplay(replay.id, true);
                          await loadTheaterReplays();
                        }
                      }}
                      className="p-1 bg-red-950/20 hover:bg-red-900/40 border border-red-500/20 hover:border-red-500/40 rounded text-[9.5px] font-bold text-red-400 hover:text-red-300 uppercase tracking-wider transition-all cursor-pointer flex items-center justify-center w-7 h-7"
                      title="Delete from cache"
                    >
                      ðŸ—‘ï¸
                    </button>
                    <button
                      onClick={() => {
                        setSaveCachedId(replay.id);
                        setSaveCachedName(`${replay.playerName} vs ${replay.opponentName}`);
                        setSaveCachedDesc(`Saved match on ${replay.mapType} map in ${replay.mode} mode.`);
                        setShowSaveModal(true);
                      }}
                      className="px-2.5 h-7 bg-white/5 hover:bg-white/10 border border-white/10 text-[9.5px] font-bold text-white/80 hover:text-white uppercase tracking-wider rounded transition-all cursor-pointer flex items-center gap-1"
                      title="Save permanently to Archives"
                    >
                      ðŸ“¥ Save Permanent
                    </button>
                    <button
                      onClick={() => handleOpenHeatmapReplay(replay)}
                      disabled={!canOpenHeatmap}
                      className="px-2.5 h-7 bg-cyan-950/30 hover:bg-cyan-900/50 border border-cyan-500/20 hover:border-cyan-500/40 rounded text-[9.5px] font-bold text-cyan-300 hover:text-cyan-200 uppercase tracking-wider transition-all cursor-pointer flex items-center justify-center disabled:opacity-40 disabled:cursor-not-allowed"
                      title={canOpenHeatmap ? 'Watch this replay as a 2D heatmap' : 'No heatmap data in this replay'}
                    >
                      Heatmap
                    </button>
                    <button
                      onClick={() => {
                        setSelectedReplay(replay);
                        setIsPlaying(true);
                        setIsPaused(false);
                      }}
                      className="px-3 h-7 bg-gradient-to-r from-amber-600 to-yellow-600 hover:from-amber-500 hover:to-yellow-500 text-[9.5px] font-black text-white uppercase tracking-widest rounded border border-amber-500/20 hover:shadow-[0_0_10px_rgba(245,158,11,0.3)] transition-all cursor-pointer flex items-center gap-1.5"
                    >
                      â–¶ Watch
                    </button>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
  const [multiplayerRole, setMultiplayerRole] = useState<'host' | 'client' | 'observer' | null>(null);
  const [multiplayerSocket, setMultiplayerSocket] = useState<WebSocket | null>(null);
  const [userIp, setUserIp] = useState<string>('127.0.0.1');
  const [lanIp, setLanIp] = useState<string>('127.0.0.1');
  const [hostIdCode, setHostIdCode] = useState<string>('');
  const [joinIpOrId, setJoinIpOrId] = useState<string>('');
  const [connectionStatus, setConnectionStatus] = useState<'idle' | 'fetching_ip' | 'hosting' | 'connecting' | 'connected' | 'error'>('idle');
  const [connectionError, setConnectionError] = useState<string>('');
  const [quickPlayStatus, setQuickPlayStatus] = useState<'idle' | 'searching' | 'matching'>('idle');

  const [opponentClientId, setOpponentClientId] = useState<string>('');
  const [multiplayerPlayerCount, setMultiplayerPlayerCount] = useState<number>(1);
  const [multiplayerSpawnSlot, setMultiplayerSpawnSlot] = useState<number>(0);

  // Persisting network metadata and lobby invitation parameters
  const [menuSocket, setMenuSocket] = useState<WebSocket | null>(null);
  const [clientId, setClientId] = useState<string>('');
  const clientIdRef = useRef<string>('');
  const handleHostGameRef = useRef<(overrideCode?: string) => void>(() => {});
  const handleJoinGameRef = useRef<(target: string) => void>(() => {});

  useEffect(() => {
    handleHostGameRef.current = handleHostGame;
    handleJoinGameRef.current = handleJoinGame;
  });

  const [onlineCount, setOnlineCount] = useState<number>(0);
  const [onlineClients, setOnlineClients] = useState<OnlineClient[]>([]);
  const [activeInvite, setActiveInvite] = useState<{ fromId: string; roomCode: string } | null>(null);
  const [inviteNotifications, setInviteNotifications] = useState<string[]>([]);
  const [ping, setPing] = useState<number | undefined>(undefined);

  const activeUiLayoutMode: keyof UiLayoutState = deviceInfo.isMobile ? 'mobile' : 'desktop';
  const activeUiDefaults = activeUiLayoutMode === 'mobile' ? DEFAULT_MOBILE_UI_POSITIONS : DEFAULT_DESKTOP_UI_POSITIONS;

  const [uiLayouts, setUiLayouts] = useState<UiLayoutState>(() => {
    try {
      const shouldResetSavedMobileLayout =
        localStorage.getItem(MOBILE_HUD_LAYOUT_VERSION_KEY) !== MOBILE_HUD_LAYOUT_VERSION;
      const saved = localStorage.getItem('grifball_ui_positions');
      const layouts = saved
        ? normalizeUiLayouts(JSON.parse(saved), shouldResetSavedMobileLayout)
        : getDefaultUiLayouts();

      if (shouldResetSavedMobileLayout) {
        localStorage.setItem(MOBILE_HUD_LAYOUT_VERSION_KEY, MOBILE_HUD_LAYOUT_VERSION);
        localStorage.setItem('grifball_ui_positions', JSON.stringify(layouts));
      }

      return layouts;
    } catch (e) {
      console.error(e);
    }
    return getDefaultUiLayouts();
  });
  const uiLayoutsRef = useRef<UiLayoutState>(uiLayouts);
  const activeUiPositions = uiLayouts[activeUiLayoutMode];

  useEffect(() => {
    uiLayoutsRef.current = uiLayouts;
  }, [uiLayouts]);

  const persistUiLayouts = (layouts: UiLayoutState) => {
    try {
      localStorage.setItem('grifball_ui_positions', JSON.stringify(layouts));
    } catch (e) {
      console.error(e);
    }
  };

  const applyUiLayouts = (newLayouts: UiLayoutState, shouldPersist = true) => {
    uiLayoutsRef.current = newLayouts;
    setUiLayouts(newLayouts);
    if (shouldPersist) {
      persistUiLayouts(newLayouts);
    }
  };

  const applyActiveUiPositions = (newPositions: UiElementPos[], shouldPersist = true) => {
    applyUiLayouts({
      ...uiLayoutsRef.current,
      [activeUiLayoutMode]: mergeUiPositions(activeUiDefaults, newPositions),
    }, shouldPersist);
  };

  const handleUpdateUiPositions = (newPositions: UiElementPos[]) => {
    applyActiveUiPositions(newPositions);
  };

  const handleResetUiPositions = () => {
    applyActiveUiPositions(activeUiDefaults);
  };

  const [isDraggingUiAdjuster, setIsDraggingUiAdjuster] = useState<boolean>(false);
  const uiAdjusterToolbarRef = useRef<HTMLDivElement>(null);
  const uiAdjusterPointerIdRef = useRef<number | null>(null);
  const defaultUiAdjusterPosition = activeUiDefaults.find((position) => position.id === 'hudAdjuster');
  const uiAdjusterPosition =
    activeUiPositions.find((position) => position.id === 'hudAdjuster') ??
    defaultUiAdjusterPosition;

  const clampUiAdjusterPositionToViewport = (clientX: number, clientY: number) => {
    const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 1;
    const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 1;
    const toolbarRect = uiAdjusterToolbarRef.current?.getBoundingClientRect();
    const toolbarWidth = toolbarRect?.width ?? 0;
    const toolbarHeight = toolbarRect?.height ?? 0;
    const margin = deviceInfo.isMobile ? 8 : 16;

    const minX = ((toolbarWidth / 2 + margin) / viewportWidth) * 100;
    const maxX = ((viewportWidth - toolbarWidth / 2 - margin) / viewportWidth) * 100;
    const minY = (margin / viewportHeight) * 100;
    const maxY = ((viewportHeight - toolbarHeight - margin) / viewportHeight) * 100;
    const pctX = (clientX / viewportWidth) * 100;
    const pctY = (clientY / viewportHeight) * 100;

    return {
      x: Math.max(minX, Math.min(Math.max(minX, maxX), pctX)),
      y: Math.max(minY, Math.min(Math.max(minY, maxY), pctY)),
    };
  };

  const handleUiAdjusterPointerDown = (e: React.PointerEvent) => {
    uiAdjusterPointerIdRef.current = e.pointerId;
    setIsDraggingUiAdjuster(true);
    e.stopPropagation();
    e.preventDefault();
  };

  useEffect(() => {
    if (!isDraggingUiAdjuster) return;

    let animationFrameId: number | null = null;
    let pendingPosition: { x: number; y: number } | null = null;

    const flushPendingPosition = () => {
      animationFrameId = null;
      if (!pendingPosition || !defaultUiAdjusterPosition) return;

      const { x, y } = pendingPosition;
      pendingPosition = null;
      const currentPositions = uiLayoutsRef.current[activeUiLayoutMode];

      const nextPositions = currentPositions.some((position) => position.id === 'hudAdjuster')
        ? currentPositions.map((position) =>
            position.id === 'hudAdjuster' && (position.x !== x || position.y !== y)
              ? { ...position, x, y }
              : position
          )
        : [
            ...currentPositions,
            { ...defaultUiAdjusterPosition, x, y },
          ];

      applyActiveUiPositions(nextPositions, false);
    };

    const handleWindowPointerMove = (e: PointerEvent) => {
      if (uiAdjusterPointerIdRef.current !== null && e.pointerId !== uiAdjusterPointerIdRef.current) return;
      const clampedPosition = clampUiAdjusterPositionToViewport(e.clientX, e.clientY);

      pendingPosition = clampedPosition;
      if (animationFrameId === null) {
        animationFrameId = window.requestAnimationFrame(flushPendingPosition);
      }
    };

    const handleWindowPointerUp = (e: PointerEvent) => {
      if (uiAdjusterPointerIdRef.current !== null && e.pointerId !== uiAdjusterPointerIdRef.current) return;
      if (animationFrameId !== null) {
        window.cancelAnimationFrame(animationFrameId);
        flushPendingPosition();
      }
      persistUiLayouts(uiLayoutsRef.current);
      uiAdjusterPointerIdRef.current = null;
      setIsDraggingUiAdjuster(false);
    };

    window.addEventListener('pointermove', handleWindowPointerMove);
    window.addEventListener('pointerup', handleWindowPointerUp);
    window.addEventListener('pointercancel', handleWindowPointerUp);

    return () => {
      if (animationFrameId !== null) {
        window.cancelAnimationFrame(animationFrameId);
      }
      window.removeEventListener('pointermove', handleWindowPointerMove);
      window.removeEventListener('pointerup', handleWindowPointerUp);
      window.removeEventListener('pointercancel', handleWindowPointerUp);
    };
  }, [isDraggingUiAdjuster]);

  useEffect(() => {
    if (!showUiAdjustment || !uiAdjusterPosition || !defaultUiAdjusterPosition) return;

    const animationFrameId = window.requestAnimationFrame(() => {
      const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 1;
      const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 1;
      const clampedPosition = clampUiAdjusterPositionToViewport(
        (uiAdjusterPosition.x / 100) * viewportWidth,
        (uiAdjusterPosition.y / 100) * viewportHeight
      );

      if (
        Math.abs(clampedPosition.x - uiAdjusterPosition.x) < 0.1 &&
        Math.abs(clampedPosition.y - uiAdjusterPosition.y) < 0.1
      ) {
        return;
      }

      const nextPositions = activeUiPositions.some((position) => position.id === 'hudAdjuster')
        ? activeUiPositions.map((position) =>
            position.id === 'hudAdjuster'
              ? { ...position, x: clampedPosition.x, y: clampedPosition.y }
              : position
          )
        : [
            ...activeUiPositions,
            { ...defaultUiAdjusterPosition, x: clampedPosition.x, y: clampedPosition.y },
          ];

      applyActiveUiPositions(nextPositions);
    });

    return () => window.cancelAnimationFrame(animationFrameId);
  }, [showUiAdjustment, activeUiLayoutMode]);


  // Configuration settings for simulated health, speed percentage, attack offsets and impact sizes
  const [adminSettings, setAdminSettings] = useState<UniversalSettings>(() => getSavedAdminSettings());

  // Automatically save admin settings and hue changes locally
  useEffect(() => {
    try {
      const { playerHue, playerName: sName, ...restSettings } = adminSettings;
      localStorage.setItem('grifball_admin_settings', JSON.stringify(restSettings));
      if (playerHue !== undefined) {
        localStorage.setItem('grifball_player_hue', playerHue.toString());
      }
    } catch (e) {
      console.error('Failed to save settings locally:', e);
    }
  }, [adminSettings]);

  // ── Account session + cloud settings sync ──────────────────────────────────
  // Pull the account's cloud save and apply it locally (cloud overwrites local).
  const pullAndApplyCloudSave = async () => {
    const res = await fetchCloudSave<SaveData>();
    if (res.ok && res.data && res.data.save) {
      applySaveData(res.data.save);
    }
  };

  const handleLoggedIn = async (acct: AccountInfo) => {
    // Apply cloud settings BEFORE marking the session active so the push effect
    // (gated on `account`) can't race and overwrite the cloud with stale local data.
    await pullAndApplyCloudSave();
    setAccount(acct);
  };

  const handleRegistered = (acct: AccountInfo) => {
    setAccount(acct);
    // Seed the new account's cloud save with the current local settings.
    void pushCloudSave(buildSaveData(adminSettings, playerName, uiLayouts, keybindings));
  };

  const handleLoggedOut = () => {
    setAccount(null);
    setShowAdminDashboard(false);
  };
  const handleAccountChanged = (acct: AccountInfo) => setAccount(acct);

  // Restore an existing session on load (persistent login), then pull cloud save.
  // No cleanup-cancel guard: this is a one-shot bootstrap and the resolved result
  // must apply to the live mount (a set on a discarded StrictMode fiber is harmless).
  useEffect(() => {
    if (!getStoredToken()) return;
    (async () => {
      const res = await fetchMe();
      if (res.ok && res.data) {
        setAccount(res.data.account);
        // Pull the account's cloud save (best-effort; never blocks login state).
        try { await pullAndApplyCloudSave(); } catch { /* ignore */ }
      }
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Debounced push of synced settings to the cloud while signed in.
  const cloudPushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!account) return;
    if (cloudPushTimer.current) clearTimeout(cloudPushTimer.current);
    cloudPushTimer.current = setTimeout(() => {
      void pushCloudSave(buildSaveData(adminSettings, playerName, uiLayouts, keybindings));
    }, 1500);
    return () => {
      if (cloudPushTimer.current) clearTimeout(cloudPushTimer.current);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account, adminSettings, playerName, uiLayouts, keybindings]);

  // Collapsed section state for Gameplay/Mechanics Options panel
  const [collapsedSections, setCollapsedSections] = useState<Record<string, boolean>>(() => {
    try {
      const saved = localStorage.getItem('grifball_collapsed_sections');
      return saved ? JSON.parse(saved) : {};
    } catch { return {}; }
  });
  const toggleSectionCollapse = (sectionId: string) => {
    setCollapsedSections(prev => {
      const next = { ...prev, [sectionId]: !prev[sectionId] };
      try { localStorage.setItem('grifball_collapsed_sections', JSON.stringify(next)); } catch {}
      return next;
    });
  };

  // Gameplay presets state and helper functions
  interface GameplayPreset {
    name: string;
    settings: Omit<UniversalSettings, 'playerHue' | 'playerName'>;
  }
  
  const [gameplayPresets, setGameplayPresets] = useState<GameplayPreset[]>(() => {
    try {
      const saved = localStorage.getItem('grifball_gameplay_presets');
      return saved ? JSON.parse(saved) : [];
    } catch (e) {
      console.error('Failed to load gameplay presets:', e);
      return [];
    }
  });
  const [selectedPresetName, setSelectedPresetName] = useState<string>('');
  const [newPresetNameInput, setNewPresetNameInput] = useState<string>('');

  // ── Official Multiplayer Preset (Live Tuning) ──────────────────────────────
  // Source of truth = D1 via GET /api/config (ETag-cached). Forced on everyone in
  // P2P matches; available read-only offline. A cached copy backs offline play.
  const [multiplayerPreset, setMultiplayerPreset] = useState<LiveConfig | null>(() =>
    getCachedLiveConfig()
  );

  useEffect(() => {
    let cancelled = false;
    fetchLiveConfig().then((config) => {
      if (!cancelled && config) setMultiplayerPreset(config);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // ── Multiplayer ruleset draft (Admin Dashboard) ────────────────────────────
  // A SEPARATE settings object the admin edits to govern peer-to-peer matches —
  // intentionally decoupled from the admin's personal sandbox `adminSettings` so
  // editing it never changes their own local play. Seeded from the currently
  // published preset (or defaults), persisted locally as a draft, and AI is forced
  // to 'custom' so the dashboard's AI tuning dials are authoritative. Publishing
  // this is what makes it the Official Multiplayer Preset (also selectable locally).
  const [mpAdminSettings, setMpAdminSettings] = useState<UniversalSettings>(() => {
    const base = createDefaultAdminSettings('');
    const customAi = 'custom' as UniversalSettings['aiDifficulty'];
    try {
      const saved = localStorage.getItem('ibrawls_mp_ruleset');
      if (saved) return { ...base, ...JSON.parse(saved), aiDifficulty: customAi };
    } catch { /* ignore */ }
    const cached = getCachedLiveConfig();
    const seeded = cached?.settings ? { ...base, ...withDefaultGameplaySettings(cached.settings) } : base;
    return { ...seeded, aiDifficulty: customAi };
  });

  useEffect(() => {
    try {
      localStorage.setItem('ibrawls_mp_ruleset', JSON.stringify(stripPlayerIdentitySettings(mpAdminSettings)));
    } catch { /* ignore disabled / full storage */ }
  }, [mpAdminSettings]);

  const handleSavePreset = (name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    // The official multiplayer preset is read-only and managed by the server.
    if (trimmed.toLowerCase() === OFFICIAL_MP_PRESET_NAME.toLowerCase()) return;

    const { playerHue, playerName: sName, ...restSettings } = adminSettings;
    const newPreset: GameplayPreset = {
      name: trimmed,
      settings: restSettings
    };

    setGameplayPresets(prev => {
      const index = prev.findIndex(p => p.name.toLowerCase() === trimmed.toLowerCase());
      let updated;
      if (index >= 0) {
        updated = [...prev];
        updated[index] = newPreset;
      } else {
        updated = [...prev, newPreset];
      }
      try {
        localStorage.setItem('grifball_gameplay_presets', JSON.stringify(updated));
      } catch (e) {
        console.error('Failed to save gameplay presets:', e);
      }
      return updated;
    });
    setSelectedPresetName(trimmed);
    setNewPresetNameInput('');
  };

  const handleDeletePreset = (nameToDelete: string) => {
    // The official multiplayer preset is server-managed and cannot be deleted locally.
    if (nameToDelete === OFFICIAL_MP_PRESET_NAME) return;
    setGameplayPresets(prev => {
      const updated = prev.filter(p => p.name !== nameToDelete);
      try {
        localStorage.setItem('grifball_gameplay_presets', JSON.stringify(updated));
      } catch (e) {
        console.error('Failed to delete gameplay preset:', e);
      }
      return updated;
    });
    if (selectedPresetName === nameToDelete) {
      setSelectedPresetName('');
    }
  };

  const handleSelectPreset = (name: string) => {
    setSelectedPresetName(name);
    if (!name) return;
    // Official multiplayer preset: load its ruleset for offline viewing/play (read-only).
    if (name === OFFICIAL_MP_PRESET_NAME) {
      if (multiplayerPreset) {
        setAdminSettings(prev => ({
          ...prev,
          ...withDefaultGameplaySettings(multiplayerPreset.settings),
          playerHue: prev.playerHue,
          playerName: prev.playerName,
        }));
      }
      return;
    }
    const preset = gameplayPresets.find(p => p.name === name);
    if (preset) {
      setAdminSettings(prev => ({
        ...prev,
        ...withDefaultGameplaySettings(preset.settings)
      }));
    }
  };

  useEffect(() => {
    if (!selectedPresetName) return;
    if (selectedPresetName === OFFICIAL_MP_PRESET_NAME) {
      // Read-only official preset: clear the selection once the user edits away from it.
      if (multiplayerPreset) {
        const restSettings = stripPlayerIdentitySettings(adminSettings);
        if (!gameplaySettingsAreEqual(restSettings, withDefaultGameplaySettings(multiplayerPreset.settings))) {
          setSelectedPresetName('');
        }
      }
      return;
    }
    const activePreset = gameplayPresets.find(p => p.name === selectedPresetName);
    if (activePreset) {
      const restSettings = stripPlayerIdentitySettings(adminSettings);
      if (!gameplaySettingsAreEqual(restSettings, withDefaultGameplaySettings(activePreset.settings))) {
        setSelectedPresetName('');
      }
    }
  }, [adminSettings, gameplayPresets, selectedPresetName, multiplayerPreset]);

  // In multiplayer the official preset's mechanic keys override local edits; player
  // identity (hue/name) is preserved because it isn't part of the governed subset.
  const effectiveAdminSettings = useMemo<UniversalSettings>(() => {
    if (isMultiplayer && multiplayerPreset) {
      return {
        ...adminSettings,
        ...withDefaultGameplaySettings(multiplayerPreset.settings),
        playerHue: adminSettings.playerHue,
        playerName: adminSettings.playerName,
      };
    }
    return adminSettings;
  }, [isMultiplayer, multiplayerPreset, adminSettings]);

  // Admin publish (Official Multiplayer Preset). Gated by the logged-in admin
  // account's session token (self-promoted via the account card), not a typed secret.
  const [publishStatus, setPublishStatus] = useState<{ ok: boolean; msg: string } | null>(null);
  const [isPublishing, setIsPublishing] = useState(false);

  // Admin Dashboard (admin-only multiplayer control surface).
  const [showAdminDashboard, setShowAdminDashboard] = useState(false);
  const [multiplayerBotConfig, setMultiplayerBotConfig] = useState<MultiplayerBotConfig>(() => {
    try {
      const saved = localStorage.getItem('ibrawls_mp_bot_config');
      return saved ? { ...DEFAULT_BOT_CONFIG, ...JSON.parse(saved) } : DEFAULT_BOT_CONFIG;
    } catch {
      return DEFAULT_BOT_CONFIG;
    }
  });
  const handleBotConfigChange = (next: MultiplayerBotConfig) => {
    setMultiplayerBotConfig(next);
    try { localStorage.setItem('ibrawls_mp_bot_config', JSON.stringify(next)); } catch { /* ignore */ }
  };

  const handlePublishOfficial = async () => {
    const sessionToken = getStoredToken();
    if (!sessionToken || isPublishing) return;
    setIsPublishing(true);
    setPublishStatus(null);
    const label = (multiplayerPreset?.version ? `v${multiplayerPreset.version + 1}` : 'v1');
    const result = await publishLiveConfig(
      sessionToken,
      stripPlayerIdentitySettings(mpAdminSettings),
      label
    );
    if (result.ok) {
      setPublishStatus({ ok: true, msg: `Published official preset v${result.version}.` });
      const fresh = await fetchLiveConfig();
      if (fresh) setMultiplayerPreset(fresh);
    } else {
      setPublishStatus({ ok: false, msg: result.error || 'Publish failed.' });
    }
    setIsPublishing(false);
  };

  // AI-only presets state and helper functions
  const [aiPresets, setAiPresets] = useState<AIPreset[]>(() => {
    try {
      const saved = localStorage.getItem('grifball_ai_presets');
      return saved ? JSON.parse(saved) : [];
    } catch (e) {
      console.error('Failed to load AI presets:', e);
      return [];
    }
  });

  const [newAiPresetNameInput, setNewAiPresetNameInput] = useState<string>('');

  const handleSaveAIPreset = (name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return;

    const id = 'ai_preset_' + Date.now();
    const newPreset: AIPreset = {
      id,
      name: trimmed,
      tuning: {
        aiReactionLatency: adminSettings.aiReactionLatency ?? 0.25,
        aiAnticipationFactor: adminSettings.aiAnticipationFactor ?? 0.40,
        aiMovementComplexity: adminSettings.aiMovementComplexity ?? 50,
        aiWeaponSwapIQ: adminSettings.aiWeaponSwapIQ ?? 50,
        aiPlaystyle: adminSettings.aiPlaystyle ?? 50,
        aiWeaponPrioritization: adminSettings.aiWeaponPrioritization ?? 50,
        // Advanced behavior overrides (undefined = derived / neutral).
        aiSpatialIQ: adminSettings.aiSpatialIQ,
        aiFeintChance: adminSettings.aiFeintChance,
        aiPressureAggression: adminSettings.aiPressureAggression,
        aiSpacingBand: adminSettings.aiSpacingBand,
        aiSkipPressure: adminSettings.aiSkipPressure,
      }
    };

    setAiPresets(prev => {
      const updated = [...prev, newPreset];
      try {
        localStorage.setItem('grifball_ai_presets', JSON.stringify(updated));
      } catch (e) {
        console.error('Failed to save AI presets:', e);
      }
      return updated;
    });

    setAdminSettings(prev => ({
      ...prev,
      aiDifficulty: id
    }));
    setNewAiPresetNameInput('');
  };

  const handleDeleteAIPreset = (idToDelete: string) => {
    setAiPresets(prev => {
      const updated = prev.filter(p => p.id !== idToDelete);
      try {
        localStorage.setItem('grifball_ai_presets', JSON.stringify(updated));
      } catch (e) {
        console.error('Failed to delete AI preset:', e);
      }
      return updated;
    });

    // Fallback bot difficulties using this preset
    setBotDifficulties(prev => {
      const updated = { ...prev };
      Object.keys(updated).forEach(key => {
        if (updated[key] === idToDelete) {
          updated[key] = 'normal';
        }
      });
      return updated;
    });

    // Fallback main ai difficulty if using this preset
    if (adminSettings.aiDifficulty === idToDelete) {
      setAdminSettings(prev => ({
        ...prev,
        aiDifficulty: 'normal'
      }));
    }
  };

  const handleSelectAIPreset = (id: string) => {
    if (['easy', 'normal', 'hard', 'nightmare', 'custom'].includes(id)) {
      setAdminSettings(prev => ({
        ...prev,
        aiDifficulty: id
      }));
      return;
    }

    const preset = aiPresets.find(p => p.id === id);
    if (preset) {
      setAdminSettings(prev => ({
        ...prev,
        aiDifficulty: id,
        aiReactionLatency: preset.tuning.aiReactionLatency ?? 0.25,
        aiAnticipationFactor: preset.tuning.aiAnticipationFactor ?? 0.40,
        aiMovementComplexity: preset.tuning.aiMovementComplexity ?? 50,
        aiWeaponSwapIQ: preset.tuning.aiWeaponSwapIQ ?? 50,
        aiPlaystyle: preset.tuning.aiPlaystyle ?? 50,
        aiWeaponPrioritization: preset.tuning.aiWeaponPrioritization ?? 50,
        // Advanced behavior overrides (undefined = derived / neutral).
        aiSpatialIQ: preset.tuning.aiSpatialIQ,
        aiFeintChance: preset.tuning.aiFeintChance,
        aiPressureAggression: preset.tuning.aiPressureAggression,
        aiSpacingBand: preset.tuning.aiSpacingBand,
        aiSkipPressure: preset.tuning.aiSkipPressure,
      }));
    }
  };

  const handleSelectAIArchetype = (archetypeId: string) => {
    if (archetypeId === 'none') {
      setAdminSettings(prev => ({ ...prev, aiArchetype: 'none' }));
      return;
    }

    setAdminSettings(prev => applyArchetypeToSettings(prev, archetypeId as Exclude<AIArchetypeId, 'none'>));
  };



  // Standard initial dummy stats to render HUD beautifully before game starts
  const [currentStats, setCurrentStats] = useState<GameStats>({
    playerHP: 1,
    playerMaxHP: 1,
    enemyHP: 1,
    enemyMaxHP: 1,
    scorePlayer: 0,
    scoreEnemy: 0,
    gameTime: 522, // 8:42
    debugMode: false,
    debugDamageRadius: 4.5,
    weaponReady: true,
    weaponCooldown: 1.0,
    lastStrikePos: null,
    lastStrikeTick: 0,
    isCrouching: false,
    isJumping: false,
    playerRespawnTimer: 0,
    enemyRespawnTimer: 0,
    playerDashCooldownTimer: 0,
    playerDashReady: true,
    settings: {
      maxHP: 1,
      speedForward: 100,
      speedSide: 100,
      speedBackward: 100,
      attackRange: 3.2,
      attackRadius: 4.5,
      dashDistance: 6.0,
      dashDuration: 0.25,
      dashCooldown: 2.0,
      respawnInvulnerabilityDuration: 1.0,
      hammerReloadTime: 0.6,
      hammerMeleeSpeed: 0.24,
      hammerMeleeReload: 0.5,
      hammerSplashVfx: 'current',
      swordLungeVfx: 'current',
      swordLungeDistance: 14.5,
      swordLungeSpeed: 24.0,
      swordSlashSpeed: 0.22,
      swordSlashReload: 0.6,
      swordLungeReload: 1.2,
      hammerJumpPower: 6.5,
      hammerJumpTriggerRadius: 3.5,
      hammerJumpWindow: 0.6,
      hammerJumpInputGate: 0.0,
      hammerJumpAirLimit: 1,
      visualizeJumpZone: true,
      directLightIntensity: 1.6,
      ambientLightIntensity: 0.82,
      skyboxBrightness: 4.0,
      skyboxHue: 224,
      showSkybox: true,
      enableSwordTrade: true,
      enableHammerSwordTrade: true,
      swordTradeWindow: 350,
      hammerSwordTradeWindow: 350,
      playerHue: getSavedPlayerHue(),
      aiDifficulty: 'normal',
      aiReactionLatency: 0.25,
      aiAnticipationFactor: 0.40,
      aiMovementComplexity: 50,
      aiWeaponSwapIQ: 50,
      aiPlaystyle: 50,
    },
    lastDeaths: [],
    playerX: 0,
    playerZ: 12,
    playerYaw: Math.PI,
    enemyX: 0,
    enemyZ: -12,
    enemyYaw: 0,
    enemyIsCrouching: false,
    playerIsCrouchMoving: false,
    enemyIsCrouchMoving: false,
    activeWeapon: 'hammer',
    crosshairColor: 'white',
    fps: 0,
    ping,
  });

  const resetEdgeLowFpsDetection = () => {
    edgeLowFpsSampleRef.current = { lastSampleTime: 0, durationMs: 0 };
    edgeLowFpsStateUpdateRef.current = 0;
    setEdgeLowFpsSampleDurationMs((previous) => previous === 0 ? previous : 0);
  };

  useEffect(() => {
    if (isPlaying && !isPaused && isEdgeBrowser && graphicsCheck.checked && graphicsCheck.supported && graphicsCheck.accelerated) {
      return;
    }

    resetEdgeLowFpsDetection();
    if (!isPlaying) {
      setShowEdgePerformanceWarning(false);
    }
  }, [isPlaying, isPaused, isEdgeBrowser, graphicsCheck.checked, graphicsCheck.supported, graphicsCheck.accelerated]);

  // Fetch client IP on initialization and generate a quick room custom ID
  useEffect(() => {
    const randCode = Math.floor(100000 + Math.random() * 900000).toString();
    setHostIdCode(randCode);

    if (!navigator.onLine) {
      setUserIp('127.0.0.1');
      setLanIp('127.0.0.1');
      setConnectionStatus('idle');
      setConnectionError('Offline mode active. Solo training is available; multiplayer needs a network connection.');
      return;
    }

    setConnectionStatus('fetching_ip');
    fetch(`${getApiUrl()}/api/my-ip`)
      .then(res => {
        if (!res.ok) throw new Error(`API returned status ${res.status}`);
        return res.json();
      })
      .then(async (data) => {
        let detectedIp = data.ip || '127.0.0.1';
        let detectedLan = data.lanIp || '127.0.0.1';
        
        // If detected IP is loopback or local network range (like 127.0.0.1 or ::1),
        // try to query a public WAN IP echo service to show the real internet address.
        if (detectedIp === '127.0.0.1' || detectedIp === '::1' || detectedIp.startsWith('192.168.') || detectedIp.startsWith('10.')) {
          try {
            const ipifyRes = await fetch('https://api.ipify.org?format=json');
            const ipifyData = await ipifyRes.json();
            if (ipifyData && ipifyData.ip) {
              detectedIp = ipifyData.ip;
            }
          } catch (e) {
            console.warn('Failed to fetch from ipify, trying backup ipapi...', e);
            try {
              const ipapiRes = await fetch('https://ipapi.co/json/');
              const ipapiData = await ipapiRes.json();
              if (ipapiData && ipapiData.ip) {
                detectedIp = ipapiData.ip;
              }
            } catch (e2) {
              console.warn('Backup IP fetch failed:', e2);
            }
          }
        }
        
        setUserIp(detectedIp);
        setLanIp(detectedLan);
        setConnectionStatus('idle');
      })
      .catch(async (err) => {
        console.warn('Network metadata unavailable; using offline-safe localhost fallback:', err);
        let fallbackIp = '127.0.0.1';
        if (navigator.onLine) {
          try {
            const ipifyRes = await fetch('https://api.ipify.org?format=json');
            const ipifyData = await ipifyRes.json();
            if (ipifyData && ipifyData.ip) {
              fallbackIp = ipifyData.ip;
            }
          } catch (e) {
            console.warn('Direct ipify fetch failed:', e);
          }
        }
        setUserIp(fallbackIp);
        setLanIp('127.0.0.1');
        setConnectionStatus('idle');
      });
  }, [isOnline]);

  // Dedicated background central server connection for counting players, measuring ping, and carrying match invitations
  useEffect(() => {
    let ws: WebSocket | null = null;
    let reconnectTimeout: any = null;
    let isDestroyed = false;

    function connect() {
      if (isDestroyed) return;

      if (!navigator.onLine) {
        setMenuSocket(null);
        setOnlineCount(0);
        setOnlineClients([]);
        reconnectTimeout = setTimeout(connect, 5000);
        return;
      }
      
      const wsUrl = buildWsUrl(getWsUrl(), 'lobby', playerName);
      console.log('Connecting persistent lobby socket to:', wsUrl);
      ws = new WebSocket(wsUrl);

      ws.onopen = () => {
        console.log('Lobby network established.');
        if (isDestroyed) {
          ws?.close();
          return;
        }
        setMenuSocket(ws);
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          
          if (data.type === 'welcome') {
            setClientId(data.clientId);
            clientIdRef.current = data.clientId;
          } else if (data.type === 'presence') {
            setOnlineCount(data.onlineCount || 0);
            // Capture list of online client info (excluding this browser's self)
            const others = (data.clients || []).filter((c: OnlineClient) => c.id !== clientIdRef.current);
            setOnlineClients(others);
          } else if (data.type === 'pong') {
            const calculatedPing = Date.now() - data.timestamp;
            setPing(calculatedPing);
          } else if (data.type === 'receive_invite') {
            setActiveInvite({
              fromId: data.fromId,
              roomCode: data.roomCode
            });
            sfx.playRespawn(); // Custom prompt trigger sound
          } else if (data.type === 'invite_declined') {
            const declString = `Client ${data.fromId} declined your match invite.`;
            setInviteNotifications(prev => [...prev, declString]);
            setTimeout(() => {
              setInviteNotifications(prev => prev.filter(n => n !== declString));
            }, 5000);
          } else if (data.type === 'lobby_chat') {
            setLobbyChatMessages(prev => {
              if (prev.some(m => m.id === data.id)) return prev;
              return [...prev, {
                id: data.id,
                sender: data.sender,
                text: data.text,
                timestamp: data.timestamp,
                role: 'client',
                isLocal: data.clientId === clientIdRef.current
              }];
            });
          } else if (data.type === 'quickplay_queued') {
            setQuickPlayStatus('searching');
          } else if (data.type === 'quickplay_host') {
            setQuickPlayStatus('matching');
            handleHostGameRef.current(data.roomCode);
          } else if (data.type === 'quickplay_match_found') {
            setQuickPlayStatus('idle');
            handleJoinGameRef.current(data.roomCode);
          } else if (data.type === 'config_changed') {
            // Live tuning nudge: re-fetch the official preset if the server bumped past our version.
            setMultiplayerPreset(prev => {
              if (prev && typeof data.version === 'number' && data.version <= prev.version) {
                return prev;
              }
              fetchLiveConfig().then(config => {
                if (config) setMultiplayerPreset(config);
              });
              return prev;
            });
          }
        } catch (e) {
          console.error('Lobby network parsing error:', e);
        }
      };

      ws.onclose = () => {
        setMenuSocket(null);
        if (!isDestroyed) {
          reconnectTimeout = setTimeout(connect, 2000);
        }
      };

      ws.onerror = (err) => {
        ws?.close();
      };
    }

    connect();

    return () => {
      isDestroyed = true;
      if (ws) ws.close();
      clearTimeout(reconnectTimeout);
    };
  }, [isOnline, playerName]);

  // Heartbeat to measure RTT latency
  useEffect(() => {
    const pingInterval = setInterval(() => {
      const activeSock = (multiplayerSocket && multiplayerSocket.readyState === WebSocket.OPEN) 
        ? multiplayerSocket 
        : (menuSocket && menuSocket.readyState === WebSocket.OPEN) ? menuSocket : null;
      
      if (activeSock && activeSock.readyState === WebSocket.OPEN) {
        try {
          activeSock.send(JSON.stringify({
            type: 'ping',
            timestamp: Date.now()
          }));
        } catch (e) {
          console.error('Error sending ping:', e);
        }
      }
    }, 2000);

    return () => clearInterval(pingInterval);
  }, [multiplayerSocket, menuSocket]);

  // Synchronize player state with central lobby server
  useEffect(() => {
    if (!menuSocket || menuSocket.readyState !== WebSocket.OPEN) return;

    let status: 'menu' | 'solo' | 'multi' = 'menu';
    let roomCode: string | undefined = undefined;
    let spaceAvailable = false;

    if (isPlaying) {
      if (isMultiplayer) {
        status = 'multi';
        roomCode = multiplayerRole === 'host' ? hostIdCode : joinIpOrId;
        spaceAvailable = multiplayerRole !== 'observer'
          && Boolean(roomCode)
          && multiplayerPlayerCount < MAX_MULTIPLAYER_PLAYERS;
      } else {
        status = 'solo';
      }
    } else {
      if (connectionStatus === 'hosting') {
        status = 'multi';
        roomCode = hostIdCode;
        spaceAvailable = true; // Hosting lobby is open (1/2)
      } else if (connectionStatus === 'connecting') {
        status = 'multi';
        roomCode = joinIpOrId;
        spaceAvailable = false;
      } else {
        status = 'menu';
      }
    }

    menuSocket.send(JSON.stringify({
      type: 'update_status',
      status,
      roomCode,
      spaceAvailable,
      playerCount: status === 'multi' ? multiplayerPlayerCount : undefined,
      maxPlayers: status === 'multi' ? MAX_MULTIPLAYER_PLAYERS : undefined,
      name: normalizePlayerName(playerName)
    }));
  }, [menuSocket, isPlaying, isMultiplayer, connectionStatus, hostIdCode, joinIpOrId, multiplayerRole, multiplayerPlayerCount, playerName]);

  // Sync the real-time calculated ping to HUD stats immediately
  useEffect(() => {
    setCurrentStats(prev => ({
      ...prev,
      ping
    }));
  }, [ping]);

  // Dedicated in-game message and role listener
  useEffect(() => {
    if (!multiplayerSocket) return;

    const handleMultiplayerMessage = (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'sync' && data.action === 'chat') {
          setChatMessages(prev => {
            if (prev.some(m => m.id === data.id)) return prev;
            return [...prev, {
              id: data.id,
              sender: data.sender || 'Opponent',
              text: data.text || '',
              timestamp: data.timestamp || new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
              role: data.role || 'client',
              isLocal: false
            }];
          });
        } else if (data.type === 'connected') {
          setMultiplayerPlayerCount(getConnectedMatchPlayerCount(data, data.role || multiplayerRole));
          setMultiplayerSpawnSlot(getMultiplayerSpawnSlotFromMessage(data, data.role || multiplayerRole));
        } else if (data.type === 'player_joined') {
          setMultiplayerPlayerCount(count => Math.min(MAX_MULTIPLAYER_PLAYERS, Math.max(2, count + 1)));
        } else if (data.type === 'player_left') {
          setMultiplayerPlayerCount(count => Math.max(1, count - 1));
        } else if (data.type === 'sync' && data.action === 'request_map') {
          if (multiplayerRole === 'host') {
            console.log('Received request for map sync. Sending selectedMap:', selectedMap);
            multiplayerSocket.send(JSON.stringify({
              type: 'sync',
              action: 'sync_map',
              selectedMap: selectedMap,
              customMap: lobbyCustomMapData
            }));
          }
        } else if (data.type === 'sync' && data.action === 'sync_map') {
          console.log('Received map sync packet from host:', data.selectedMap);
          if (data.selectedMap) {
            setSelectedMap(data.selectedMap);
          }
          if (data.customMap) {
            setLobbyCustomMapData(data.customMap);
          }
        } else if (data.type === 'role_changed') {
          console.log('Role authoritatively updated to:', data.role);
          setMultiplayerPlayerCount(count => {
            if (data.role === 'observer' && multiplayerRole !== 'observer') {
              return Math.max(0, count - 1);
            }
            if (data.role === 'client' && multiplayerRole === 'observer') {
              return Math.min(MAX_MULTIPLAYER_PLAYERS, count + 1);
            }
            return count;
          });
          setMultiplayerRole(data.role);
          setMultiplayerSpawnSlot(getMultiplayerSpawnSlotFromMessage(data, data.role));
          if (data.role === 'observer') {
            setIsPaused(false); // Unpause upon transitioning to observer
          }
        } else if (data.type === 'opponent_role_changed') {
          console.log('Opponent role updated to:', data.role);
          if (data.role === 'observer') {
            setMultiplayerPlayerCount(count => Math.max(1, count - 1));
            setOpponentClientId('Opponent (Spectating)');
          } else {
            setMultiplayerPlayerCount(count => Math.min(MAX_MULTIPLAYER_PLAYERS, count + 1));
            setOpponentClientId('Opponent');
          }
        } else if (data.type === 'error') {
          alert(data.message);
        }
      } catch (err) {
        // Safe catch
      }
    };

    multiplayerSocket.addEventListener('message', handleMultiplayerMessage);
    return () => {
      multiplayerSocket.removeEventListener('message', handleMultiplayerMessage);
    };
  }, [multiplayerSocket, multiplayerRole, selectedMap, lobbyCustomMapData]);

  const sendChatMessage = (text: string) => {
    if (!multiplayerSocket || multiplayerSocket.readyState !== WebSocket.OPEN) return;
    
    const baseSender = multiplayerRole === 'host' ? 'Blue (Host)' : 'Red (Guest)';
    const senderName = playerName ? `${playerName} (${multiplayerRole === 'host' ? 'Host' : 'Guest'})` : baseSender;
    const msgId = Math.random().toString(36).substring(2, 9);
    const timestamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    
    const packet = {
      type: 'sync',
      action: 'chat',
      id: msgId,
      sender: senderName,
      text: text,
      timestamp: timestamp,
      role: multiplayerRole
    };
    
    multiplayerSocket.send(JSON.stringify(packet));
    
    // Append locally immediately
    setChatMessages(prev => [
      ...prev,
      {
        id: msgId,
        sender: `${senderName} (You)`,
        text: text,
        timestamp: timestamp,
        role: multiplayerRole!,
        isLocal: true
      }
    ]);
  };

  const sendLobbyChatMessage = (text: string) => {
    if (!menuSocket || menuSocket.readyState !== WebSocket.OPEN) return;
    
    const packet = {
      type: 'lobby_chat',
      sender: playerName || `Client ${clientId}`,
      text: text
    };
    
    menuSocket.send(JSON.stringify(packet));
  };

  const handleHostGame = (overrideCode?: string) => {
    setConnectionError('');
    setConnectionStatus('hosting');
    setChatMessages([]);
    setMultiplayerPlayerCount(1);
    setMultiplayerSpawnSlot(0);

    const activeCode = overrideCode || hostIdCode;
    if (overrideCode) {
      setHostIdCode(overrideCode);
    }

    const wsUrl = connectionMode === 'relay' ? getWsUrl() : `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}`;
    console.log('WS Host connection target URL resolved to:', wsUrl);
    const ws = new WebSocket(buildWsUrl(wsUrl, 'gameplay'));

    ws.onopen = () => {
      console.log('WS Connection opened. Registering host...');
      ws.send(JSON.stringify({
        type: 'host',
        ip: userIp,
        lanIp: lanIp,
        customId: activeCode
      }));
    };

    const handleHostMessage = (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'hosted') {
          console.log('Successfully hosted lobby inside room of keys:', data.keys);
        } else if (data.type === 'connected') {
          // Unsubscribe to prevent packet intercept or duplication
          ws.removeEventListener('message', handleHostMessage);

          setMultiplayerSocket(ws);
          setIsMultiplayer(true);
          setMultiplayerRole('host');
          setMultiplayerSpawnSlot(getMultiplayerSpawnSlotFromMessage(data, 'host'));
          setConnectionStatus('connected');
          setOpponentClientId(data.clientClientId || 'Opponent');
          setMultiplayerPlayerCount(getConnectedMatchPlayerCount({ ...data, role: 'host' }, 'host'));

          sfx.init();
          sfx.resume();
          sfx.playRespawn();

          setIsPlaying(true);
          setIsPaused(false);
          setIsTerminated(false);
        } else if (data.type === 'error') {
          setConnectionError(data.message);
          setConnectionStatus('error');
          ws.close();
        }
      } catch (err) {
        console.error('Error parsing onmessage host data:', err);
      }
    };

    ws.addEventListener('message', handleHostMessage);

    ws.onclose = () => {
      console.log('Host socket disconnected.');
      setConnectionStatus('idle');
      setMultiplayerSocket(null);
      setMultiplayerSpawnSlot(0);
    };

    ws.onerror = (err) => {
      console.error('WebSocket Host Error:', err);
      setConnectionError('Matchmaker registration failed.');
      setConnectionStatus('error');
    };
  };

  const handleJoinGame = (target: string, isObserver: boolean = false) => {
    if (!target) {
      setConnectionError('Please provide a Host IP address or Room Code.');
      return;
    }
    setJoinIpOrId(target);
    setConnectionError('');
    setConnectionStatus('connecting');
    setChatMessages([]);
    setMultiplayerPlayerCount(isObserver ? 0 : 1);

    const cleanTarget = target.trim().replace(/^(hw|http|https|ws|wss):\/\//i, '');
    const isDirectAddress = cleanTarget.includes('.') || cleanTarget.includes(':') || isNaN(Number(cleanTarget));

    const protocol = (window.location.protocol === 'https:' || connectionMode === 'relay') ? 'wss:' : 'ws:';
    let wsUrl = '';

    if (connectionMode === 'relay') {
      wsUrl = getWsUrl();
    } else {
      if (isDirectAddress) {
        // Direct LAN IP connection
        let hostWithPort = cleanTarget;
        if (!hostWithPort.includes(':')) {
          hostWithPort = `${hostWithPort}:3000`;
        }
        const directProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        wsUrl = `${directProtocol}//${hostWithPort}`;
      } else {
        // Centralized matchmaking Room Code connection
        wsUrl = `${protocol}//${window.location.host}`;
      }
    }

    console.log('WS Join connection target URL resolved to:', wsUrl, 'isObserver:', isObserver);
    const ws = new WebSocket(buildWsUrl(wsUrl, 'gameplay'));

    ws.onopen = () => {
      console.log('WS Connection opened. Joining:', target, 'isObserver:', isObserver);
      ws.send(JSON.stringify({
        type: 'join',
        targetIpOrId: target.trim(),
        isObserver
      }));
    };

    const handleJoinMessage = (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'connected') {
          // Unsubscribe to prevent packet intercept or duplication
          ws.removeEventListener('message', handleJoinMessage);

          setMultiplayerSocket(ws);
          setIsMultiplayer(true);
          setMultiplayerRole(data.role || 'client');
          setMultiplayerSpawnSlot(getMultiplayerSpawnSlotFromMessage(data, data.role || 'client'));
          setConnectionStatus('connected');
          setOpponentClientId(data.hostClientId || 'Opponent');
          setMultiplayerPlayerCount(getConnectedMatchPlayerCount(data, data.role || 'client'));

          sfx.init();
          sfx.resume();
          sfx.playRespawn();

          setIsPlaying(true);
          setIsPaused(false);
          setIsTerminated(false);

          // Request map configuration from the host
          setTimeout(() => {
            if (ws.readyState === WebSocket.OPEN) {
              console.log('Sending request_map to host...');
              ws.send(JSON.stringify({
                type: 'sync',
                action: 'request_map'
              }));
            }
          }, 100);
        } else if (data.type === 'error') {
          setConnectionError(data.message);
          setConnectionStatus('error');
          ws.close();
        }
      } catch (e) {
        console.error(e);
      }
    };

    ws.addEventListener('message', handleJoinMessage);

    ws.onclose = () => {
      console.log('Guest join socket disconnected.');
      setConnectionStatus('idle');
      setMultiplayerSocket(null);
      setMultiplayerSpawnSlot(0);
    };

    ws.onerror = (err) => {
      console.error('WebSocket Join Error:', err);
      setConnectionError('Matching connection failed.');
      setConnectionStatus('error');
    };
  };

  const handleCancelHostOrJoin = () => {
    if (multiplayerSocket) {
      multiplayerSocket.close();
    }
    setConnectionStatus('idle');
    setConnectionError('');
    setMultiplayerSocket(null);
    setQuickPlayStatus('idle');
    setMultiplayerPlayerCount(1);
    setMultiplayerSpawnSlot(0);
  };

  const handleQuickPlay = () => {
    if (!menuSocket || menuSocket.readyState !== WebSocket.OPEN) {
      setConnectionError('Matchmaker connection offline. Retrying...');
      return;
    }
    setConnectionError('');
    setQuickPlayStatus('searching');
    menuSocket.send(JSON.stringify({ type: 'quickplay_join' }));
  };

  const handleCancelQuickPlay = () => {
    if (menuSocket && menuSocket.readyState === WebSocket.OPEN) {
      menuSocket.send(JSON.stringify({ type: 'quickplay_leave' }));
    }
    setQuickPlayStatus('idle');
  };

  const handleInitializeTournament = (
    difficulty: TournamentDifficulty | 'custom',
    killsToWin: number = TOURNAMENT_DEFAULT_KILLS_TO_WIN,
    roundCount: number = TOURNAMENT_DEFAULT_ROUND_COUNT,
    selectedPresets?: AIPreset[]
  ) => {
    const opponents = generateTournamentOpponents(difficulty, getTournamentBotCount(roundCount), selectedPresets);
    const rounds = buildInitialTournamentRounds(roundCount);

    const state: TournamentState = {
      difficulty,
      killsToWin,
      roundCount,
      currentRound: 0,
      currentMatchIndex: 0,
      opponents,
      rounds,
      status: 'bracket'
    };

    saveTournamentState(state);
    setSinglePlayerMode('tournament');
  };

  const handleStartTournamentMatch = () => {
    if (!tournamentState) return;

    const roundIndex = tournamentState.currentRound;
    const matchIndex = tournamentState.currentMatchIndex;
    const match = tournamentState.rounds[roundIndex][matchIndex];
    const opponent = tournamentState.opponents[match.opponent2];

    sfx.init();
    sfx.resume();
    sfx.playRespawn();

    setIsMultiplayer(false);
    setMultiplayerRole(null);
    setMultiplayerPlayerCount(1);
    setMultiplayerSpawnSlot(0);
    if (multiplayerSocket) {
      multiplayerSocket.close();
    }
    setMultiplayerSocket(null);

    setOfflineBotCount(1);
    
    setBotColors({
      main_ai: opponent.hue
    });

    setBotDifficulties({
      main_ai: 'custom'
    });

    setBotBehaviors({
      main_ai: opponent.behavior
    });

    setBotArchetypes({
      main_ai: opponent.archetype ?? 'none',
      bot_2: 'none',
      bot_3: 'none',
      bot_4: 'none',
      bot_5: 'none',
      bot_6: 'none',
      bot_7: 'none',
    });

    setAdminSettings(prev => ({
      ...prev,
      aiDifficulty: 'custom',
      aiReactionLatency: opponent.reactionLatency,
      aiAnticipationFactor: opponent.anticipationFactor,
      aiMovementComplexity: opponent.movementComplexity,
      aiWeaponSwapIQ: opponent.weaponSwapIQ,
      aiPlaystyle: opponent.playstyle,
      aiWeaponPrioritization: getArchetypeDef(opponent.archetype)?.knobOverrides.aiWeaponPrioritization ?? prev.aiWeaponPrioritization ?? 50,
      aiArchetype: opponent.archetype ?? 'none',
      playerName: playerName
    }));

    const nextState: TournamentState = {
      ...tournamentState,
      status: 'playing'
    };
    saveTournamentState(nextState);

    setIsPlaying(true);
    setIsPaused(false);
    setIsTerminated(false);
    setShowAdminPanel(false);
    setShowUiAdjustment(false);
    setShowLightingMenu(false);
  };

  const handleCompleteTournamentMatch = (playerWon: boolean, scorePlayer: number, scoreEnemy: number) => {
    if (!tournamentState) return;

    const roundIndex = tournamentState.currentRound;
    const matchIndex = tournamentState.currentMatchIndex;
    const rounds = [...tournamentState.rounds];
    const opponents = tournamentState.opponents;

    const playerMatch = {
      ...rounds[roundIndex][matchIndex],
      winner: playerWon ? 'player' : rounds[roundIndex][matchIndex].opponent2,
      score1: scorePlayer,
      score2: scoreEnemy,
      isCompleted: true
    };
    rounds[roundIndex][matchIndex] = playerMatch;

    if (!playerWon) {
      const nextState: TournamentState = {
        ...tournamentState,
        rounds,
        status: 'gameover'
      };
      saveTournamentState(nextState);
      handleCloseGame();
      return;
    }

    const killsToWin = tournamentState.killsToWin ?? TOURNAMENT_DEFAULT_KILLS_TO_WIN;
    const simulatedMatches = rounds[roundIndex].map((match, idx) => {
      if (idx === 0) return playerMatch;
      return simulateBotMatch(match, opponents, killsToWin);
    });
    rounds[roundIndex] = simulatedMatches;

    const totalRounds = tournamentState.roundCount ?? tournamentState.rounds.length;
    if (roundIndex === totalRounds - 1) {
      const nextState: TournamentState = {
        ...tournamentState,
        rounds,
        status: 'victory'
      };
      saveTournamentState(nextState);
      handleCloseGame();
    } else {
      const nextRoundIndex = roundIndex + 1;
      const currentWinners = simulatedMatches.map(m => m.winner!);
      rounds[nextRoundIndex] = buildNextTournamentRoundMatches(currentWinners);

      const nextState: TournamentState = {
        ...tournamentState,
        currentRound: nextRoundIndex,
        rounds,
        status: 'bracket'
      };
      saveTournamentState(nextState);
      handleCloseGame();
    }
  };

  const handleResetTournament = () => {
    saveTournamentState(null);
    setSinglePlayerMode('tournament');
  };

  const handleStartGame = () => {
    // Initialise and resume synthesizer context securely on user click gesture!
    sfx.init();
    sfx.resume();
    sfx.playRespawn();

    setIsMultiplayer(false);
    setMultiplayerRole(null);
    setMultiplayerPlayerCount(1);
    setMultiplayerSpawnSlot(0);
    if (multiplayerSocket) {
      multiplayerSocket.close();
    }
    setMultiplayerSocket(null);

    setIsPlaying(true);
    setIsPaused(false);
    setIsTerminated(false);
    setShowAdminPanel(false);
    setShowUiAdjustment(false);
    setShowLightingMenu(false);
  };

  const handleCloseGame = () => {
    if (multiplayerSocket) {
      multiplayerSocket.close();
    }
    setIsTerminated(singlePlayerMode !== 'tournament');
    setIsPlaying(false);
    setIsPaused(false);
    setMultiplayerPlayerCount(1);
    setMultiplayerSpawnSlot(0);
    setShowAdminPanel(false);
    setShowUiAdjustment(false);
    setShowLightingMenu(false);
    setQuickPlayStatus('idle');
  };

  const handleResumeGame = () => {
    sfx.resume();
    setIsPaused(false);
    setShowAdminPanel(false);
    setShowUiAdjustment(false);
    setShowLightingMenu(false);
  };

  const handleJoinObserver = () => {
    if (isMultiplayer && multiplayerSocket && multiplayerSocket.readyState === WebSocket.OPEN) {
      multiplayerSocket.send(JSON.stringify({
        type: 'change_role',
        role: 'observer'
      }));
    } else {
      // Singleplayer observer mode toggle
      setMultiplayerRole('observer');
      setMultiplayerPlayerCount(0);
      setMultiplayerSpawnSlot(0);
      setIsPaused(false);
    }
  };

  const handleJoinPlayer = () => {
    if (isMultiplayer && multiplayerSocket && multiplayerSocket.readyState === WebSocket.OPEN) {
      multiplayerSocket.send(JSON.stringify({
        type: 'change_role',
        role: 'player'
      }));
    } else {
      // Singleplayer player mode toggle
      setMultiplayerRole(null);
      setMultiplayerPlayerCount(1);
      setMultiplayerSpawnSlot(0);
      setIsPaused(false);
    }
  };

  const handleResetMatch = () => {
    // Refresh page / state indices reload
    sfx.playRespawn();
    window.location.reload();
  };

  const handleReturnToMain = () => {
    if (multiplayerSocket) {
      multiplayerSocket.close();
    }
    setIsPlaying(false);
    setIsPaused(false);
    setIsMultiplayer(false);
    setMultiplayerRole(null);
    setMultiplayerSocket(null);
    setConnectionStatus('idle');
    setQuickPlayStatus('idle');
    setMultiplayerPlayerCount(1);
    setMultiplayerSpawnSlot(0);
    setShowAdminPanel(false);
    setShowUiAdjustment(false);
    setShowLightingMenu(false);
    setOpponentClientId('');
  };

  const toggleDebugMode = () => {
    setDebugMode(prev => !prev);
  };

  const trackEdgeLowFps = (fps: number | undefined) => {
    if (
      !isEdgeBrowser ||
      edgePerformanceWarningDismissed ||
      showEdgePerformanceWarning ||
      !isPlaying ||
      isPaused ||
      !graphicsCheck.checked ||
      !graphicsCheck.supported ||
      !graphicsCheck.accelerated
    ) {
      return;
    }

    const fpsValue = typeof fps === 'number' && Number.isFinite(fps) ? fps : 0;
    if (fpsValue <= 0) {
      return;
    }

    const now = performance.now();
    const sample = edgeLowFpsSampleRef.current;
    const elapsedMs = sample.lastSampleTime === 0
      ? 0
      : Math.min(Math.max(now - sample.lastSampleTime, 0), 1000);
    sample.lastSampleTime = now;

    if (fpsValue >= EDGE_LOW_FPS_THRESHOLD) {
      resetEdgeLowFpsDetection();
      return;
    }

    sample.durationMs += elapsedMs;
    if (
      sample.durationMs - edgeLowFpsStateUpdateRef.current >= EDGE_LOW_FPS_STATE_UPDATE_STEP_MS ||
      sample.durationMs >= EDGE_LOW_FPS_SUSTAINED_MS
    ) {
      edgeLowFpsStateUpdateRef.current = sample.durationMs;
      setEdgeLowFpsSampleDurationMs(Math.min(sample.durationMs, EDGE_LOW_FPS_SUSTAINED_MS));
    }

    if (sample.durationMs >= EDGE_LOW_FPS_SUSTAINED_MS) {
      setEdgeLowFpsSampleDurationMs(EDGE_LOW_FPS_SUSTAINED_MS);
      setShowEdgePerformanceWarning(true);
    }
  };

  // Callback to sync game stats live
  const handleStatsUpdate = (stats: GameStats) => {
    if (singlePlayerMode === 'tournament' && tournamentState && tournamentState.status === 'playing') {
      const killsToWin = tournamentState.killsToWin ?? TOURNAMENT_DEFAULT_KILLS_TO_WIN;
      if (stats.scorePlayer >= killsToWin && !matchResult) {
        setMatchResult({
          winner: 'player',
          opponentName: tournamentState.opponents[tournamentState.rounds[tournamentState.currentRound][tournamentState.currentMatchIndex].opponent2]?.name || 'AI Bot',
          playerScore: stats.scorePlayer,
          opponentScore: stats.scoreEnemy
        });
        setIsPaused(true);
        return;
      } else if (stats.scoreEnemy >= killsToWin) {
        handleCompleteTournamentMatch(false, stats.scorePlayer, stats.scoreEnemy);
        return;
      }
    }

    trackEdgeLowFps(stats.fps);

    setCurrentStats({
      ...stats,
      isMultiplayer,
      multiplayerRole,
      opponentConnected: isMultiplayer && !!multiplayerSocket,
      ping,
      playerClientId: clientId || 'Player',
      opponentClientId: opponentClientId || 'Opponent'
    });
  };

  const handlePauseToggle = () => {
    if (showUiAdjustment) {
      setShowUiAdjustment(false);
      return;
    }
    setIsPaused(prev => !prev);
    // Auto-return to main pause menu next time paused
    if (isPaused) {
      setShowAdminPanel(false);
      setShowLightingMenu(false);
      setShowKeybindsMenu(false);
    }
  };

  // Render a single setting control dynamically based on its definition
  // Factory so the same controls can edit EITHER the admin's personal sandbox
  // settings OR the separate multiplayer ruleset (Admin Dashboard). The body is
  // unchanged — `settings`/`setSettings` are shadowed as `adminSettings`/
  // `setAdminSettings` so every existing reference resolves to the chosen target.
  const makeRenderSetting = (
    settings: UniversalSettings,
    setSettings: React.Dispatch<React.SetStateAction<UniversalSettings>>
  ) => {
    const adminSettings = settings;
    const setAdminSettings = setSettings;
    const renderSetting = (def: any) => {
    const value = adminSettings[def.key as keyof UniversalSettings];

    switch (def.type) {
      case 'slider': {
        const displayValue = def.formatValue ? def.formatValue(value) : `${value}${def.unit || ''}`;
        const accentClass = def.sectionId === 'hammer' ? 'accent-amber-400' 
                          : def.sectionId === 'launch' ? 'accent-yellow-400'
                          : def.sectionId === 'trades' ? 'accent-red-500'
                          : def.sectionId === 'sword' ? 'accent-[#22d3ee]'
                          : 'accent-[#38bdf8]';
        const colorClass = def.sectionId === 'hammer' ? 'text-amber-400' 
                          : def.sectionId === 'launch' ? 'text-yellow-400'
                          : def.sectionId === 'trades' ? 'text-red-400'
                          : def.sectionId === 'sword' ? 'text-[#22d3ee]'
                          : 'text-[#38bdf8]';

        return (
          <div key={def.key} className="flex flex-col gap-1">
            <div className="flex justify-between text-[11px] font-bold uppercase tracking-wider text-white/80">
              <span>{def.label}</span>
              <span className={`${colorClass} font-mono`}>{displayValue}</span>
            </div>
            <input 
              type="range" 
              min={def.min} 
              max={def.max} 
              step={def.step}
              value={(value as number) ?? 0} 
              onChange={(e) => setAdminSettings(prev => ({ ...prev, [def.key]: parseFloat(e.target.value) }))}
              className={`w-full ${accentClass} h-1 bg-white/10 rounded-lg appearance-none cursor-pointer`}
            />
          </div>
        );
      }
      case 'toggle': {
        const activeColorClass = def.sectionId === 'hammer' ? 'bg-amber-400' 
                               : def.sectionId === 'launch' ? 'bg-yellow-400'
                               : def.sectionId === 'trades' ? 'bg-red-500'
                               : def.sectionId === 'sword' ? 'bg-[#22d3ee]'
                               : 'bg-[#38bdf8]';

        return (
          <div key={def.key} className="flex justify-between items-center text-xs pt-1.5 border-t border-white/5">
            <div className="flex flex-col text-left">
              <span className="font-bold text-white/90 font-mono text-[10px]">{def.label}</span>
              {def.description && <span className="text-[9px] text-white/40 font-mono">{def.description}</span>}
            </div>
            <button 
              onClick={() => setAdminSettings(prev => ({ ...prev, [def.key]: !prev[def.key as keyof UniversalSettings] }))}
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
        const step = def.step ?? 1;
        const displayValue = def.formatValue ? def.formatValue(value) : `${value}${def.unit || ''}`;

        return (
          <div key={def.key} className="flex items-center justify-between text-xs py-0.5 border-t border-white/5 first:border-t-0">
            <div className="flex flex-col text-left">
              <span className="font-bold text-white/90">{def.label}</span>
              {def.description && <span className="text-[9px] text-white/40">{def.description}</span>}
            </div>
            <div className="flex items-center gap-1.5">
              <button 
                onClick={() => setAdminSettings(prev => {
                  const currentVal = (prev[def.key as keyof UniversalSettings] as number) ?? def.min;
                  const newVal = Math.max(def.min, parseFloat((currentVal - step).toFixed(2)));
                  return { ...prev, [def.key]: newVal };
                })}
                className="w-7 h-7 rounded bg-white/10 hover:bg-white/20 active:scale-90 flex items-center justify-center font-bold text-sm transition-all cursor-pointer select-none"
              >
                -
              </button>
              <span className="font-mono text-xs font-bold text-[#38bdf8] w-12 text-center bg-black/40 py-0.5 rounded border border-white/5">
                {displayValue}
              </span>
              <button 
                onClick={() => setAdminSettings(prev => {
                  const currentVal = (prev[def.key as keyof UniversalSettings] as number) ?? def.min;
                  const newVal = Math.min(def.max, parseFloat((currentVal + step).toFixed(2)));
                  return { ...prev, [def.key]: newVal };
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
        const colorClass = def.sectionId === 'hammer' ? 'text-amber-300' 
                          : def.sectionId === 'launch' ? 'text-yellow-300'
                          : def.sectionId === 'sword' ? 'text-[#22d3ee]'
                          : 'text-[#38bdf8]';
        const focusClass = def.sectionId === 'hammer' ? 'focus:border-amber-400' 
                          : def.sectionId === 'launch' ? 'focus:border-yellow-400'
                          : def.sectionId === 'sword' ? 'focus:border-[#22d3ee]'
                          : 'focus:border-[#38bdf8]';

        if (def.key === 'aiDifficulty') {
          return (
            <div key={def.key} className="flex flex-col gap-1">
              <span className="text-[9px] text-white/50 uppercase tracking-widest font-mono">{def.description}</span>
              <div className="flex gap-2">
                <select
                  value={(value as string) || 'normal'}
                  onChange={(e) => handleSelectAIPreset(e.target.value)}
                  className={`flex-1 h-8 bg-black/60 border border-white/10 rounded px-2 text-xs text-[#38bdf8] font-bold uppercase outline-none ${focusClass} cursor-pointer transition-all font-sans`}
                  title={getPresetDescription((value as string) || 'normal', aiPresets)}
                >
                  {def.options?.map((opt: any) => (
                    <option key={opt.value} value={opt.value} title={getPresetDescription(opt.value, aiPresets)}>{opt.label}</option>
                  ))}
                  {aiPresets.length > 0 && (
                    <optgroup label="Saved Presets">
                      {aiPresets.map(preset => (
                        <option key={preset.id} value={preset.id} title={getPresetDescription(preset.id, aiPresets)}>🤖 {preset.name}</option>
                      ))}
                    </optgroup>
                  )}
                </select>
                {!['easy', 'normal', 'hard', 'nightmare', 'custom'].includes((value as string) || '') && (
                  <button
                    onClick={() => handleDeleteAIPreset(value as string)}
                    className="px-2 h-8 bg-red-950/40 hover:bg-red-900/60 border border-red-500/30 hover:border-red-500/50 text-red-400 text-xs font-bold uppercase rounded cursor-pointer transition-all"
                    title="Delete this AI preset"
                  >
                    🗑️
                  </button>
                )}
              </div>
              {value && value !== 'custom' && (
                <span className="text-[8.5px] text-white/45 leading-snug">
                  {getPresetDescription(value as string, aiPresets)}
                </span>
              )}
            </div>
          );
        }

        if (def.key === 'aiArchetype') {
          return (
            <div key={def.key} className="flex flex-col gap-1">
              <span className="text-[9px] text-white/50 uppercase tracking-widest font-mono">{def.description}</span>
              <select
                value={(value as string) || 'none'}
                onChange={(e) => handleSelectAIArchetype(e.target.value)}
                className={`w-full h-8 bg-black/60 border border-white/10 rounded px-2 text-xs text-[#38bdf8] font-bold uppercase outline-none ${focusClass} cursor-pointer transition-all font-sans`}
              >
                {def.options?.map((opt: any) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
              {adminSettings.aiArchetype && adminSettings.aiArchetype !== 'none' && (
                <span className="text-[8.5px] text-white/45 leading-snug">
                  {getArchetypeDef(adminSettings.aiArchetype)?.description}
                </span>
              )}
            </div>
          );
        }

        return (
          <div key={def.key} className="flex flex-col gap-1">
            <div className="flex justify-between text-[11px] font-bold uppercase tracking-wider text-white/80">
              <span>{def.label}</span>
              <span className={`${colorClass} font-mono`}>
                {def.formatValue ? def.formatValue(value) : value}
              </span>
            </div>
            <select
              value={value as string}
              onChange={(e) => setAdminSettings(prev => ({ ...prev, [def.key]: e.target.value }))}
              className={`w-full h-8 bg-black/60 border border-white/10 rounded px-2 text-[11px] ${colorClass} font-bold uppercase outline-none ${focusClass} cursor-pointer transition-all font-sans`}
            >
              {def.options?.map((opt: any) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>
        );
      }
      case 'color': {
        const colorVal = (value as string) || '#00ffff';
        return (
          <div key={def.key} className="flex justify-between items-center text-xs pt-1.5 border-t border-white/5 gap-2">
            <div className="flex flex-col text-left">
              <span className="font-bold text-white/90">{def.label}</span>
              {def.description && <span className="text-[9px] text-white/40">{def.description}</span>}
            </div>
            <div className="flex items-center gap-2">
              <input 
                type="color" 
                value={colorVal} 
                onChange={(e) => setAdminSettings(prev => ({ ...prev, [def.key]: e.target.value }))}
                className="w-8 h-8 rounded border border-white/20 bg-transparent cursor-pointer p-0 animate-fade-in"
                title="Choose Color"
              />
              <input 
                type="text" 
                value={colorVal} 
                onChange={(e) => setAdminSettings(prev => ({ ...prev, [def.key]: e.target.value }))}
                className="w-20 h-7 bg-black/40 border border-white/10 rounded px-2 font-mono text-[10px] tracking-wide text-white focus:border-[#38bdf8] outline-none text-center"
              />
            </div>
          </div>
        );
      }
      default:
        return null;
    }
    };
    return renderSetting;
  };

  const makeRenderSection = (
    settings: UniversalSettings,
    setSettings: React.Dispatch<React.SetStateAction<UniversalSettings>>,
    renderSetting: (def: any) => React.ReactNode
  ) => {
    const adminSettings = settings;
    const setAdminSettings = setSettings;
    const renderSection = (section: any) => {
    const sectionSettings = SETTING_DEFINITIONS.filter(def => def.sectionId === section.id);
    const visibleSettings = sectionSettings.filter(def => !def.showIf || def.showIf(adminSettings));

    if (visibleSettings.length === 0) return null;

    const isCollapsed = !!collapsedSections[section.id];
    const baseClass = section.bgClass || "border border-white/5 rounded-xl p-2.5 bg-white/1 flex flex-col gap-2.5";

    return (
      <div key={section.id} className={baseClass}>
        <button
          type="button"
          onClick={() => toggleSectionCollapse(section.id)}
          className={`w-full text-[10px] ${section.colorClass} font-bold uppercase tracking-widest border-b border-white/5 pb-1 font-mono flex items-center justify-between cursor-pointer bg-transparent border-x-0 border-t-0 p-0 outline-none select-none transition-colors hover:brightness-125`}
        >
          <span className="flex items-center gap-1.5">
            <svg
              className="w-3 h-3 transition-transform duration-200 shrink-0"
              style={{ transform: isCollapsed ? 'rotate(-90deg)' : 'rotate(0deg)' }}
              fill="none" stroke="currentColor" viewBox="0 0 24 24"
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
            {visibleSettings.map(renderSetting)}

            {section.id === 'ai' && adminSettings.aiDifficulty === 'custom' && (
              <div className="flex flex-col gap-1 pt-1.5 border-t border-white/5 mt-1">
                <span className="text-[8.5px] text-white/50 uppercase tracking-widest font-mono">Save Custom AI Preset:</span>
                <div className="flex gap-1.5">
                  <input
                    type="text"
                    placeholder="Preset Name"
                    value={newAiPresetNameInput}
                    onChange={(e) => setNewAiPresetNameInput(e.target.value)}
                    className="flex-1 h-7 bg-black/60 border border-white/10 rounded px-2 text-[10px] text-white outline-none focus:border-[#38bdf8] transition-all font-sans"
                  />
                  <button
                    onClick={() => handleSaveAIPreset(newAiPresetNameInput)}
                    className="px-2.5 h-7 bg-[#38bdf8]/10 hover:bg-[#38bdf8]/20 border border-[#38bdf8]/20 hover:border-[#38bdf8]/40 text-[#38bdf8] text-[9px] font-bold uppercase rounded cursor-pointer transition-all font-sans"
                  >
                    Save
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    );
    };
    return renderSection;
  };

  // Sandbox / single-player settings editor (edits the admin's personal settings).
  const renderSetting = makeRenderSetting(adminSettings, setAdminSettings);
  const renderSection = makeRenderSection(adminSettings, setAdminSettings, renderSetting);
  // Multiplayer ruleset editor (Admin Dashboard) — edits the separate MP ruleset,
  // never the admin's local sandbox. Published as the Official Multiplayer Preset.
  const renderMpSetting = makeRenderSetting(mpAdminSettings, setMpAdminSettings);
  const renderMpSection = makeRenderSection(mpAdminSettings, setMpAdminSettings, renderMpSetting);

  return (
    <div className="relative w-full h-[100dvh] bg-[#050b1a] text-white overflow-hidden select-none font-sans flex flex-col">
      {/* FIRST-RUN DATA COLLECTION NOTICE (always-on collection disclosure, no gate) */}
      {showDataNotice && (
        <div className="fixed bottom-0 inset-x-0 z-[200] flex justify-center px-3 pb-3 pointer-events-none">
          <div className="pointer-events-auto max-w-2xl w-full bg-slate-900/95 backdrop-blur border border-sky-500/30 rounded-xl shadow-2xl px-4 py-3 flex items-start gap-3">
            <span className="text-lg leading-none mt-0.5">📊</span>
            <p className="text-[11px] text-white/70 leading-snug flex-1">
              <span className="font-bold text-sky-300">Heads up — this is a tech demo.</span>{' '}
              It collects anonymized gameplay stats and a sampled subset of match replays
              (with player names removed) to train and improve the AI. No accounts or
              personal information are stored.
            </p>
            <button
              onClick={dismissDataNotice}
              className="shrink-0 px-3 h-8 bg-sky-500 hover:bg-sky-400 text-slate-950 font-black text-[11px] uppercase tracking-wider rounded cursor-pointer transition-all active:scale-95"
            >
              Got it
            </button>
          </div>
        </div>
      )}

      {/* BACKGROUND ARENA SIMULATION GRID */}
      <div 
        className="absolute inset-0 z-0 opacity-20 pointer-events-none" 
        style={{
          backgroundImage: `
            radial-gradient(circle at center, transparent 0%, #050b1a 80%),
            repeating-linear-gradient(0deg, #1e293b 0px, #1e293b 1px, transparent 1px, transparent 40px),
            repeating-linear-gradient(90deg, #1e293b 0px, #1e293b 1px, transparent 1px, transparent 40px)
          `,
        }}
      />

      {/* THREE.JS ACTIVE PERSPECTIVE IF PLAYING */}
      {isPlaying && !isTerminated && (
        <GrifballGame
          isPlaying={isPlaying}
          selectedMap={selectedMap}
          customMap={selectedMap === 'custom_file' ? (lobbyCustomMapData || undefined) : undefined}
          playerLoadout={playerLoadout}
          isPaused={isPaused}
          debugMode={debugMode}
          adminSettings={effectiveAdminSettings}
          onStatsUpdate={handleStatsUpdate}
          onPauseToggle={handlePauseToggle}
          isMultiplayer={isMultiplayer}
          multiplayerRole={multiplayerRole}
          multiplayerSocket={multiplayerSocket}
          multiplayerSpawnSlot={multiplayerSpawnSlot}
          opponentClientId={opponentClientId}
          replayData={selectedReplay}
          onExitReplay={() => {
            setIsPlaying(false);
            setSelectedReplay(null);
            setIsPaused(false);
          }}
  opponentPlayerName={
    singlePlayerMode === 'tournament' && tournamentState && tournamentState.status === 'playing'
      ? tournamentState.opponents[tournamentState.rounds[tournamentState.currentRound][tournamentState.currentMatchIndex].opponent2]?.name
      : undefined
  }
          keybindings={keybindings}
          offlineBotCount={offlineBotCount}
          botDifficulties={botDifficulties}
          botColors={botColors}
          botBehaviors={botBehaviors}
          botWeaponBehaviors={botWeaponBehaviors}
          botArchetypes={botArchetypes}
          aiPresets={aiPresets}
          aiMatchSessionKey={
            singlePlayerMode === 'tournament' && tournamentState?.status === 'playing'
              ? `tournament-r${tournamentState.currentRound}-m${tournamentState.currentMatchIndex}`
              : 'sandbox'
          }
          matchKillsToWin={
            singlePlayerMode === 'tournament' && tournamentState?.status === 'playing'
              ? (tournamentState.killsToWin ?? TOURNAMENT_DEFAULT_KILLS_TO_WIN)
              : undefined
          }
          deviceInfo={deviceInfo}
          forceMobileControls={forceMobileControls}
          mobileJoystickRef={mobileJoystickRef}
          mobileRightJoystickRef={mobileRightJoystickRef}
          mobileRightJoystickActiveRef={mobileRightJoystickActiveRef}
        />
      )}

      {/* FIRST PERSON USER OVERLAY HEADS-UP-DISPLAY */}
      {isPlaying && (!isPaused || showUiAdjustment) && (
        <HUD 
          stats={currentStats}
          onPauseClick={handlePauseToggle}
          uiPositions={activeUiPositions}
          uiDefaultPositions={activeUiDefaults}
          onUpdateUiPositions={handleUpdateUiPositions}
          isAdjustmentMode={showUiAdjustment}
          deviceInfo={deviceInfo}
          forceMobileControls={forceMobileControls}
          mobileJoystickRef={mobileJoystickRef}
          mobileRightJoystickRef={mobileRightJoystickRef}
          mobileRightJoystickActiveRef={mobileRightJoystickActiveRef}
        />
      )}

      {isPlaying && selectedReplay && (
        <div
          className="fixed top-3 right-3 z-[1001] pointer-events-auto rounded-xl border border-cyan-500/25 bg-slate-950/90 shadow-[0_16px_40px_rgba(0,0,0,0.55)] backdrop-blur-xl overflow-hidden"
          style={{
            width: replayHeatmapPanelCollapsed
              ? 'min(250px, calc(100vw - 1rem))'
              : `min(${replayHeatmapPanelSize.width}px, calc(100vw - 1rem))`,
            height: replayHeatmapPanelCollapsed
              ? 46
              : `min(${replayHeatmapPanelSize.height}px, calc(100dvh - 9rem))`,
          }}
        >
          <div className="h-11 px-3 flex items-center justify-between gap-2 border-b border-white/10 bg-black/35">
            <div className="min-w-0">
              <p className="text-[9px] font-mono font-black uppercase tracking-[0.22em] text-cyan-300">
                Replay Heatmap
              </p>
              <p className="text-[9px] font-mono text-white/45 truncate">
                {Math.round(currentStats.replayElapsedTime ?? 0)}s / {Math.round(selectedReplay.duration ?? 0)}s
              </p>
            </div>
            <button
              type="button"
              onClick={() => setReplayHeatmapPanelCollapsed((value) => !value)}
              className="h-8 w-8 rounded-lg border border-white/10 bg-white/5 text-white/70 hover:text-white hover:bg-white/10 transition-colors"
              title={replayHeatmapPanelCollapsed ? 'Expand heatmap' : 'Collapse heatmap'}
              aria-label={replayHeatmapPanelCollapsed ? 'Expand heatmap' : 'Collapse heatmap'}
            >
              {replayHeatmapPanelCollapsed ? '+' : '-'}
            </button>
          </div>
          {!replayHeatmapPanelCollapsed && (
            <>
              <ReplayHeatmapCanvas
                replay={selectedReplay}
                time={currentStats.replayElapsedTime ?? 0}
                mode="panel"
                className="border-0 rounded-none"
                style={{ height: 'calc(100% - 44px)' } as React.CSSProperties}
              />
              <button
                type="button"
                onPointerDown={handleReplayHeatmapResizePointerDown}
                className="hidden md:flex absolute bottom-1.5 right-1.5 h-5 w-5 items-end justify-end rounded border border-white/15 bg-black/60 text-white/50 hover:text-white hover:border-cyan-300/50 cursor-nwse-resize"
                title="Resize heatmap"
                aria-label="Resize heatmap"
              >
                <span className="block h-2.5 w-2.5 border-b-2 border-r-2 border-current" />
              </button>
            </>
          )}
        </div>
      )}

      {heatmapOnlyReplay && (
        <div className="fixed inset-0 z-[1300] flex flex-col bg-slate-950 text-white p-3 sm:p-5 pointer-events-auto">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 pb-3 mb-3">
            <div className="min-w-0">
              <p className="text-[10px] font-mono font-black uppercase tracking-[0.28em] text-cyan-300">
                Theater Heatmap
              </p>
              <h2 className="text-lg sm:text-2xl font-black uppercase tracking-tight text-white truncate">
                {heatmapOnlyReplay.name}
              </h2>
            </div>
            <button
              type="button"
              onClick={() => {
                setHeatmapOnlyPlaying(false);
                setHeatmapOnlyReplay(null);
              }}
              className="h-10 px-4 rounded-lg border border-red-500/30 bg-red-950/25 text-red-300 hover:bg-red-950/45 font-black text-xs uppercase tracking-widest"
            >
              Exit
            </button>
          </div>

          <div className="flex-1 min-h-0">
            <ReplayHeatmapCanvas
              replay={heatmapOnlyReplay}
              time={heatmapOnlyTime}
              mode="theater"
              className="h-full min-h-0"
            />
          </div>

          <div className="mt-3 rounded-xl border border-cyan-500/20 bg-black/45 p-3 flex flex-col gap-3">
            <div className="flex items-center gap-3">
              <span className="w-12 text-left text-[10px] font-mono font-black text-cyan-300">
                {Math.floor(heatmapOnlyTime / 60)}:{String(Math.floor(heatmapOnlyTime % 60)).padStart(2, '0')}
              </span>
              <input
                type="range"
                min={0}
                max={heatmapOnlyReplay.duration ?? 0}
                step={0.1}
                value={heatmapOnlyTime}
                onChange={(event) => setHeatmapOnlyTime(parseFloat(event.target.value))}
                className="flex-1 accent-cyan-400"
              />
              <span className="w-12 text-right text-[10px] font-mono font-black text-white/45">
                {Math.floor((heatmapOnlyReplay.duration ?? 0) / 60)}:{String(Math.floor((heatmapOnlyReplay.duration ?? 0) % 60)).padStart(2, '0')}
              </span>
            </div>
            <div className="flex items-center justify-center gap-2">
              <button
                type="button"
                onClick={() => setHeatmapOnlyTime((time) => Math.max(0, time - 5))}
                className="h-9 w-9 rounded-lg border border-white/10 bg-white/5 text-white/70 hover:text-white hover:bg-white/10"
                title="Rewind 5 seconds"
              >
                &lt;
              </button>
              <button
                type="button"
                onClick={() => setHeatmapOnlyPlaying((value) => !value)}
                className="h-10 px-5 rounded-lg bg-cyan-400 text-slate-950 font-black text-xs uppercase tracking-widest"
              >
                {heatmapOnlyPlaying ? 'Pause' : 'Play'}
              </button>
              <button
                type="button"
                onClick={() => setHeatmapOnlyTime((time) => Math.min(heatmapOnlyReplay.duration ?? 0, time + 5))}
                className="h-9 w-9 rounded-lg border border-white/10 bg-white/5 text-white/70 hover:text-white hover:bg-white/10"
                title="Forward 5 seconds"
              >
                &gt;
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 🏆 TOURNAMENT MATCH VICTORY POPUP OVERLAY */}
      {isPlaying && matchResult && (
        <div className="absolute inset-0 z-[60] flex items-center justify-center bg-slate-950/85 backdrop-blur-md transition-all duration-300 p-4">
          <div className="relative bg-slate-900/60 border border-emerald-500/30 backdrop-blur-2xl rounded-2xl p-8 w-[450px] max-w-full shadow-[0_20px_50px_rgba(0,0,0,0.6)] flex flex-col items-center text-center select-none overflow-hidden animate-in fade-in zoom-in duration-200">
            {/* Ambient neon radial glow */}
            <div className="absolute -top-20 -left-20 w-48 h-48 bg-emerald-500/10 rounded-full blur-3xl pointer-events-none" />
            <div className="absolute -bottom-20 -right-20 w-48 h-48 bg-emerald-500/10 rounded-full blur-3xl pointer-events-none" />

            {/* Glowing Trophy Icon */}
            <div className="w-16 h-16 rounded-full border border-emerald-500/30 flex items-center justify-center bg-emerald-950/40 shadow-[0_0_15px_rgba(52,211,153,0.2)] mb-5">
              <span className="text-3xl">🏆</span>
            </div>

            <h2 className="text-3xl font-display font-black uppercase tracking-wider text-emerald-400 mb-2 drop-shadow-[0_0_8px_rgba(52,211,153,0.3)]">
              VICTORY DECLARED
            </h2>
            
            <p className="text-sm text-white/70 leading-relaxed max-w-sm mb-6 select-text">
              Outstanding performance, Spartan! You have successfully defeated <span className="text-emerald-400 font-bold uppercase">{matchResult.opponentName}</span> and advanced on the bracket.
            </p>

            {/* Scorecard Box */}
            <div className="w-full bg-black/40 border border-white/5 rounded-xl p-4.5 flex justify-around items-center mb-8 shadow-inner select-none font-sans">
              <div className="text-center font-display">
                <p className="text-[10px] text-emerald-400 font-black uppercase tracking-widest font-mono">You</p>
                <p className="text-3xl font-black tracking-tight text-white">{matchResult.playerScore}</p>
              </div>
              <div className="h-8 w-[1px] bg-white/10" />
              <div className="text-center font-display">
                <p className="text-[10px] text-white/40 font-black uppercase tracking-widest font-mono">Opponent</p>
                <p className="text-3xl font-black tracking-tight text-white/50">{matchResult.opponentScore}</p>
              </div>
            </div>

            {/* Return Button */}
            <button
              onClick={() => {
                handleCompleteTournamentMatch(true, matchResult.playerScore, matchResult.opponentScore);
                setMatchResult(null);
              }}
              className="w-full h-14 bg-gradient-to-b from-emerald-400 to-emerald-600 hover:from-emerald-300 hover:to-emerald-500 text-slate-950 font-sans font-black text-xs uppercase tracking-widest rounded transition-all active:scale-[0.98] cursor-pointer pointer-events-auto shadow-[0_0_15px_rgba(16,185,129,0.3)] flex items-center justify-center gap-2"
            >
              <span>Return to Bracket & Prepare</span>
              <svg className="w-4.5 h-4.5" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
              </svg>
            </button>
          </div>
        </div>
      )}

      {/* IN-GAME MULTIPLAYER CHAT PANEL */}
      {isPlaying && isMultiplayer && (
        <ChatOverlay 
          messages={chatMessages}
          onSendMessage={sendChatMessage}
          isMultiplayer={isMultiplayer}
          multiplayerRole={multiplayerRole}
          deviceInfo={deviceInfo}
        />
      )}

      {/* ADMIN DASHBOARD (admin-only overlay, reachable from the menu header) */}
      {!isPlaying && !isTerminated && showAdminDashboard && account?.isAdmin && (
        <AdminDashboard
          account={account}
          settings={mpAdminSettings as unknown as Record<string, unknown>}
          onSettingChange={(key, value) => setMpAdminSettings(prev => ({ ...prev, [key]: value }))}
          aiSections={AI_CUSTOM_KNOB_SECTIONS}
          mechanicsContent={
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-left">
              <div className="flex flex-col gap-3">
                {SETTING_SECTIONS.filter(s => s.column === 1 && s.id !== 'ai' && s.id !== 'aitune').map(renderMpSection)}
              </div>
              <div className="flex flex-col gap-3">
                {SETTING_SECTIONS.filter(s => s.column === 2 && s.id !== 'ai' && s.id !== 'aitune').map(renderMpSection)}
              </div>
              <div className="flex flex-col gap-3">
                {SETTING_SECTIONS.filter(s => s.column === 3 && s.id !== 'ai' && s.id !== 'aitune').map(renderMpSection)}
              </div>
            </div>
          }
          multiplayerPreset={multiplayerPreset}
          onPublish={handlePublishOfficial}
          isPublishing={isPublishing}
          publishStatus={publishStatus}
          botConfig={multiplayerBotConfig}
          onBotConfigChange={handleBotConfigChange}
          onClose={() => setShowAdminDashboard(false)}
        />
      )}

      {/* START MENU CONTROLLER SCREEN */}
      {!isPlaying && !isTerminated && (
        <div className="mobile-start-overlay absolute inset-0 z-50 flex items-stretch justify-center bg-slate-950/85 backdrop-blur-xl p-6 transition-all duration-300">
          <div className="mobile-menu-card w-full bg-slate-900/40 border border-white/10 rounded-3xl p-8 backdrop-blur-md flex flex-col gap-7 shadow-2xl select-none overflow-hidden">
            
            {/* UNIFIED CARD HEADER */}
            <div className="mobile-menu-header flex flex-wrap justify-between items-center gap-6 border-b border-white/10 pb-5 shrink-0">
              {/* Brand Branding Section */}
              <div className="mobile-brand flex items-center gap-4">
                <h1 style={{ fontFamily: 'Inter, sans-serif', fontSize: 36, fontWeight: 900, fontStyle: 'italic', letterSpacing: '-0.03em', background: 'linear-gradient(180deg, #fff, #94a3b8)', WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent', margin: 0, lineHeight: 1, paddingRight: 16 }}>
                  iBrawls
                </h1>
                <span style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 11, fontWeight: 700, letterSpacing: '0.2em', textTransform: 'uppercase', color: '#38bdf8', background: 'rgba(56,189,248,0.05)', border: '1px solid rgba(56,189,248,0.30)', padding: '6px 12px', borderRadius: 4 }}>
                  Voxel Grifball Tech Demo
                </span>
                 <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, fontWeight: 700, letterSpacing: '0.15em', color: 'rgba(255,255,255,0.35)', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.10)', padding: '5px 10px', borderRadius: 4 }}>
                  v{APP_VERSION}
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
                    gap: '4px'
                  }}>
                    {deviceInfo.os === 'ios' ? '🍏 iOS Web Client' : deviceInfo.os === 'android' ? '🤖 Android Web Client' : '📱 Mobile Client'}
                  </span>
                )}
              </div>

              {/* Pill Segmented Mode Switcher */}
              <div className="mobile-tabs flex bg-black/40 p-1.5 rounded-full border border-white/10 gap-2 select-none shrink-0 shadow-[inset_0_2px_4px_rgba(0,0,0,0.4)]">
                {([
                  { id: 'single', label: 'Single Player' },
                  { id: 'multi',  label: 'Multiplayer'   },
                  { id: 'spec',   label: 'Spectator'     },
                  { id: 'theater', label: 'Theater'       },
                ] as const).map(m => {
                  const isTabActive = !isPainting && activeMenuTab === m.id;
                  return (
                    <button
                      key={m.id}
                      onClick={() => {
                        setActiveMenuTab(m.id);
                        if (isPainting) {
                          setIsPainting(false);
                        }
                      }}
                      className={`px-5 py-2 rounded-full text-xs font-bold font-display uppercase tracking-wider transition-all duration-200 cursor-pointer ${
                        isTabActive
                          ? 'bg-gradient-to-b from-[#22d3ee] to-[#0891b2] text-white shadow-[0_0_12px_rgba(34,211,238,0.60)] font-black'
                          : 'text-white/50 hover:text-white/80'
                      }`}
                    >
                      {m.label}
                    </button>
                  );
                })}

                <button
                  type="button"
                  id="customization-frame-toggle"
                  onClick={handleToggleCustomizationFrame}
                  className={`px-5 py-2 rounded-full text-xs font-bold font-display uppercase tracking-wider transition-all duration-200 cursor-pointer border flex items-center gap-1.5 ${
                    showCustomizationFrame
                      ? 'bg-gradient-to-b from-[#22d3ee] to-[#0891b2] text-white shadow-[0_0_12px_rgba(34,211,238,0.60)] border-cyan-300/30 font-black'
                      : 'text-white/50 hover:text-white/80 border-white/10 hover:border-cyan-500/30'
                  }`}
                  aria-pressed={showCustomizationFrame}
                >
                  Customization
                </button>

                {/* Map Maker Navigation Action */}
                <a
                  href="/mapmaker.html"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="px-5 py-2 rounded-full text-xs font-bold font-display uppercase tracking-wider transition-all duration-200 cursor-pointer text-[#38bdf8] hover:text-cyan-200 hover:bg-cyan-950/20 flex items-center gap-1.5 border border-cyan-500/20 hover:border-cyan-500/40"
                >
                  🛠️ Map Maker
                </a>

                {/* Admin Dashboard — only for admin accounts */}
                {account?.isAdmin && (
                  <button
                    onClick={() => setShowAdminDashboard(true)}
                    className="px-5 py-2 rounded-full text-xs font-bold font-display uppercase tracking-wider transition-all duration-200 cursor-pointer text-amber-300 hover:text-amber-100 hover:bg-amber-950/20 flex items-center gap-1.5 border border-amber-500/30 hover:border-amber-500/50"
                  >
                    ⚙️ Admin Dashboard
                  </button>
                )}
              </div>

              <button
                type="button"
                id="reset-main-menu-frame-layout"
                onClick={handleResetMainMenuFrameLayout}
                className="mobile-frame-reset inline-flex items-center justify-center gap-2 px-3.5 py-2 rounded-full border border-white/10 bg-white/[0.04] text-white/55 hover:text-cyan-200 hover:border-cyan-500/35 hover:bg-cyan-950/20 text-[10px] font-black uppercase tracking-widest transition-all cursor-pointer shrink-0"
                title="Reset main menu frame sizes"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                Reset Frame Layout
              </button>

              {/* Online Player Count */}
              <div className="mobile-online-pill" style={{ display: 'inline-flex', alignItems: 'center', gap: 8, background: 'rgba(16,185,129,0.10)', border: '1px solid rgba(16,185,129,0.30)', color: '#10b981', padding: '8px 16px', borderRadius: 9999, fontFamily: "'JetBrains Mono', monospace", fontWeight: 800, fontSize: 11, letterSpacing: '0.15em', textTransform: 'uppercase' }}>
                <span style={{ width: 8, height: 8, borderRadius: 9999, background: '#34d399', animation: 'pulse 1.4s infinite' }} />
                {isOnline ? `Online Players: ${onlineCount || 1}` : 'Offline Mode'}
              </div>
            </div>

            {/* MAIN LAYOUT: resizable content frames + right chat rail */}
            <div
              ref={mainMenuLayoutRef}
              className="mobile-menu-layout main-menu-dock-layout flex flex-1 min-h-0 overflow-hidden"
              style={mainMenuLayoutStyle}
            >
              {/* 2-column content grid */}
              <div 
                ref={mainMenuContentGridRef}
                className="mobile-content-grid main-menu-content-grid flex-1 grid min-h-0"
                style={mainMenuContentGridStyle}
              >

              {/* COLUMN 1: GAME SETUP & ACTIONS */}
              {!isPainting && (
                <div className="flex flex-col h-full min-h-0 overflow-y-auto pr-0.5">
                {activeMenuTab === 'single' ? (
                  <div className="flex flex-col h-full min-h-0 justify-between">
                    {/* Segmented Mode Selector for Sandbox vs Tournament */}
                    <div className="flex bg-black/50 p-1.5 rounded-xl border border-white/10 gap-2 shrink-0 shadow-[inset_0_1px_3px_rgba(0,0,0,0.3)] mb-4 select-none">
                      <button
                        onClick={() => setSinglePlayerMode('sandbox')}
                        className={`flex-1 py-2 rounded-lg text-xs font-bold uppercase tracking-wider transition-all duration-200 cursor-pointer ${
                          singlePlayerMode === 'sandbox'
                            ? 'bg-gradient-to-b from-[#22d3ee] to-[#0891b2] text-white shadow-[0_0_10px_rgba(34,211,238,0.4)] font-black'
                            : 'text-white/40 hover:text-white/70'
                        }`}
                      >
                        Sandbox Mode
                      </button>
                      <button
                        onClick={() => setSinglePlayerMode('tournament')}
                        className={`flex-1 py-2 rounded-lg text-xs font-bold uppercase tracking-wider transition-all duration-200 cursor-pointer ${
                          singlePlayerMode === 'tournament'
                            ? 'bg-gradient-to-b from-emerald-400 to-emerald-600 text-slate-955 font-black text-white shadow-[0_0_10px_rgba(16,185,129,0.4)]'
                            : 'text-white/40 hover:text-white/70'
                        }`}
                      >
                        Tournament Mode
                      </button>
                    </div>

                    {singlePlayerMode === 'sandbox' ? (
                      <div className="flex flex-col h-full min-h-0 justify-between">
                        <div className="flex flex-col gap-5 min-h-0 overflow-y-auto pr-0.5">
                          <div className="flex items-center gap-2.5 mb-1 shrink-0">
                            <span className="w-2 h-4 bg-blue-500" />
                            <h2 className="text-sm uppercase font-bold tracking-[0.25em] text-white">
                              Training Sandbox Setup
                            </h2>
                          </div>
                          <p className="text-white/60 text-xs leading-relaxed bg-white/5 border border-white/5 rounded-lg p-3.5 leading-normal select-text shrink-0">
                            This is a Grifball iBrawls simulator. The game can be played solo against AI or online against other players. All Gameplay/Mechanics Options only impact you, so coordinate with your opponent on the dials you want to match.
                          </p>

                          {/* AI combat panel in single player mode */}
                          <div className="bg-slate-950/45 border border-white/10 rounded-xl p-4.5 flex flex-col gap-3.5 text-left shrink-0">
                            <div className="flex justify-between items-center pb-2 border-b border-white/5">
                              <span className="text-xs font-bold text-[#38bdf8] uppercase tracking-wider flex items-center gap-1.5 font-display">🤖 AI Combat Neural Net</span>
                              <span className="text-[10px] font-mono text-[#38bdf8] bg-[#38bdf8]/10 border border-[#38bdf8]/20 px-2 py-0.5 rounded uppercase font-black">Offline Play</span>
                            </div>
                            <div className="flex flex-col gap-1.5">
                              <span className="text-[10.5px] text-white/50 uppercase tracking-widest font-mono">Cognitive Matrix Preset:</span>
                              <div className="flex gap-2">
                                <select
                                  value={adminSettings.aiDifficulty || 'normal'}
                                  onChange={(e) => handleSelectAIPreset(e.target.value)}
                                  className="flex-1 h-11 bg-black/60 border border-white/10 rounded px-2.5 text-sm text-[#38bdf8] font-bold uppercase outline-none focus:border-[#38bdf8] transition-all cursor-pointer font-sans"
                                  title={getPresetDescription(adminSettings.aiDifficulty || 'normal', aiPresets)}
                                >
                                  <option value="easy" title={getPresetDescription('easy', aiPresets)}>🟢 Easy (Sub-Normal)</option>
                                  <option value="normal" title={getPresetDescription('normal', aiPresets)}>🟡 Normal · Standard Combat</option>
                                  <option value="hard" title={getPresetDescription('hard', aiPresets)}>🔴 Hard (Calibrated)</option>
                                  <option value="nightmare" title={getPresetDescription('nightmare', aiPresets)}>🟣 Nightmare · Override</option>
                                  <option value="custom" title={getPresetDescription('custom', aiPresets)}>⚙️ Custom AI Behavior</option>
                                  {aiPresets.length > 0 && (
                                    <optgroup label="Saved Presets">
                                      {aiPresets.map(preset => (
                                        <option key={preset.id} value={preset.id} title={getPresetDescription(preset.id, aiPresets)}>🤖 {preset.name}</option>
                                      ))}
                                    </optgroup>
                                  )}
                                </select>
                                {!['easy', 'normal', 'hard', 'nightmare', 'custom'].includes(adminSettings.aiDifficulty || '') && (
                                  <button
                                    onClick={() => handleDeleteAIPreset(adminSettings.aiDifficulty!)}
                                    className="px-3.5 h-11 bg-red-950/40 hover:bg-red-900/60 border border-red-500/30 hover:border-red-500/50 text-red-400 text-xs font-bold uppercase rounded cursor-pointer transition-all"
                                    title="Delete this AI preset"
                                  >
                                    🗑️
                                  </button>
                                )}
                              </div>
                              {adminSettings.aiDifficulty && adminSettings.aiDifficulty !== 'custom' && (
                                <span className="text-[10px] text-white/45 leading-snug">
                                  {getPresetDescription(adminSettings.aiDifficulty, aiPresets)}
                                </span>
                              )}
                            </div>
                            <div className="flex flex-col gap-1.5">
                              <span className="text-[10.5px] text-white/50 uppercase tracking-widest font-mono">Behavior Archetype Presets:</span>
                              <select
                                value={adminSettings.aiArchetype || 'none'}
                                onChange={(e) => handleSelectAIArchetype(e.target.value)}
                                className="w-full h-11 bg-black/60 border border-white/10 rounded px-2.5 text-sm text-[#38bdf8] font-bold uppercase outline-none focus:border-[#38bdf8] transition-all cursor-pointer font-sans"
                              >
                                {AI_ARCHETYPE_OPTIONS.map((option) => (
                                  <option key={option.value} value={option.value}>
                                    {option.label}
                                  </option>
                                ))}
                              </select>
                              {adminSettings.aiArchetype && adminSettings.aiArchetype !== 'none' && (
                                <span className="text-[10px] text-white/45 leading-snug">
                                  {getArchetypeDef(adminSettings.aiArchetype)?.description}
                                </span>
                              )}
                            </div>
                            {adminSettings.aiDifficulty === 'custom' && (
                              <div className="flex flex-col gap-4 pt-1">
                                <p className="text-[10px] text-white/40 leading-snug italic">
                                  Tune every facet of the AI, or pick a Behavior Archetype Preset above to fill all dials as a starting point. Advanced dials marked “Auto” fall back to derived values until you set them.
                                </p>
                                {AI_CUSTOM_KNOB_SECTIONS.map((sectionGroup) => {
                                  const collapsed = !!collapsedAiSections[sectionGroup.title];
                                  return (
                                  <div key={sectionGroup.title} className="flex flex-col gap-3">
                                    <button
                                      type="button"
                                      onClick={() => toggleAiSection(sectionGroup.title)}
                                      className={`flex items-center justify-between w-full text-[10px] uppercase tracking-widest font-mono border-b pb-1 cursor-pointer transition-colors group ${
                                        sectionGroup.expert
                                          ? 'text-fuchsia-400/70 border-fuchsia-500/10 hover:text-fuchsia-300'
                                          : 'text-[#38bdf8]/70 border-white/5 hover:text-[#38bdf8]'
                                      }`}
                                    >
                                      <span className="flex items-center gap-1.5">
                                        <span className={`inline-block transition-transform duration-150 ${collapsed ? '' : 'rotate-90'}`}>▸</span>
                                        {sectionGroup.title}
                                      </span>
                                      <span className="text-white/25 group-hover:text-white/40">{sectionGroup.entries.length}</span>
                                    </button>
                                    {!collapsed && (
                                      <>
                                    {sectionGroup.entries.map((entry) => {
                                      const raw = adminSettings[entry.key] as number | undefined;
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
                                            onChange={(e) => setAdminSettings(prev => ({ ...prev, [entry.key]: parseFloat(e.target.value) }))}
                                            className="w-full accent-cyan-400 h-1 bg-white/10 rounded-lg appearance-none cursor-pointer"
                                          />
                                          <p className="text-[10px] text-white/35 leading-snug">{entry.desc}</p>
                                        </div>
                                      );
                                    })}
                                    {sectionGroup.title === 'Combat Style' && (
                                      <div className="flex flex-col gap-1.5">
                                        <div className="flex items-center justify-between">
                                          <span className="text-xs font-mono uppercase tracking-wider text-white/60">Skip Pressure Chains</span>
                                          <button
                                            onClick={() => setAdminSettings(prev => ({ ...prev, aiSkipPressure: !prev.aiSkipPressure }))}
                                            className={`px-3 h-7 text-[10px] font-bold uppercase rounded cursor-pointer transition-all font-sans border ${
                                              adminSettings.aiSkipPressure
                                                ? 'bg-[#38bdf8]/20 border-[#38bdf8]/50 text-[#38bdf8]'
                                                : 'bg-black/40 border-white/10 text-white/50 hover:text-white/80'
                                            }`}
                                            title="When ON, the AI never chains relentless post-hit pressure."
                                          >
                                            {adminSettings.aiSkipPressure ? 'On' : 'Off'}
                                          </button>
                                        </div>
                                        <p className="text-[10px] text-white/35 leading-snug">When on, the AI disengages after landing a hit instead of chaining relentless follow-up pressure — useful for patient, hit-and-retreat fighters.</p>
                                      </div>
                                    )}
                                      </>
                                    )}
                                  </div>
                                  );
                                })}

                                {/* Save Custom AI Presets */}
                                <div className="flex flex-col gap-1.5 pt-2 border-t border-white/5 mt-2">
                                  <span className="text-[10px] text-white/50 uppercase tracking-widest font-mono">Save Custom AI Preset:</span>
                                  <div className="flex gap-2">
                                    <input
                                      type="text"
                                      placeholder="Preset Name (e.g. AggroBot)"
                                      value={newAiPresetNameInput}
                                      onChange={(e) => setNewAiPresetNameInput(e.target.value)}
                                      className="flex-1 h-9 bg-black/60 border border-white/10 rounded px-2.5 text-xs text-white outline-none focus:border-[#38bdf8] transition-all font-sans"
                                    />
                                    <button
                                      onClick={() => handleSaveAIPreset(newAiPresetNameInput)}
                                      className="px-4 h-9 bg-[#38bdf8]/10 hover:bg-[#38bdf8]/20 border border-[#38bdf8]/30 hover:border-[#38bdf8]/50 text-[#38bdf8] text-[10.5px] font-bold uppercase rounded cursor-pointer transition-all font-sans"
                                    >
                                      Save
                                    </button>
                                  </div>
                                </div>
                              </div>
                            )}
                          </div>
                        </div>
                        
                        {/* Training Actions */}
                        <div className="flex flex-col gap-3.5 mt-auto shrink-0 pt-4">
                          <button 
                            id="play-game-btn"
                            onClick={() => setShowBotSetupMenu(true)}
                            className="group relative w-full h-16 bg-white hover:bg-sky-400 transition-all duration-300 flex items-center justify-center overflow-hidden cursor-pointer rounded shadow-2xl border border-white/20 select-none pointer-events-auto"
                          >
                            <div className="absolute inset-0 bg-blue-600 translate-x-[-100%] group-hover:translate-x-0 transition-transform duration-300" />
                            <span className="relative z-10 text-slate-900 font-sans font-black text-sm uppercase tracking-widest group-hover:text-white pointer-events-none flex items-center gap-2">
                              Start Local Training
                              <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z" clipRule="evenodd" />
                              </svg>
                            </span>
                          </button>
                        </div>
                      </div>
                    ) : (
                      /* Tournament Mode setup or active views */
                      <div className="flex flex-col h-full min-h-0 justify-between">
                        {!tournamentState ? (
                          /* 1. Difficulty Picker */
                          <div className="flex flex-col gap-4">
                            <div className="flex items-center gap-2 mb-1">
                              <span className="w-2 h-4 bg-emerald-500" />
                              <h2 className="text-sm uppercase font-bold tracking-[0.25em] text-white">
                                Tournament Difficulty
                              </h2>
                            </div>
                            <p className="text-white/60 text-xs leading-normal bg-white/5 border border-white/5 rounded-lg p-3.5 leading-normal">
                              Advance through a simulated 1v1 elimination bracket across {tournamentRoundCount} {tournamentRoundCount === 1 ? 'round' : 'rounds'} ({getTournamentBotCount(tournamentRoundCount) + 1} brawlers). Each match is first to {tournamentKillsToWin} kills. If you lose, it's Game Over! AI bots are procedurally customized each playthrough.
                            </p>
                            <div className="flex flex-col gap-1.5 bg-white/5 border border-white/5 rounded-lg p-3.5 pointer-events-auto">
                              <div className="flex justify-between text-xs font-mono uppercase tracking-wider text-white/60">
                                <span>Tournament Rounds</span>
                                <span className="text-emerald-400 font-bold">{tournamentRoundCount}</span>
                              </div>
                              <input
                                type="range"
                                min={TOURNAMENT_MIN_ROUND_COUNT}
                                max={TOURNAMENT_MAX_ROUND_COUNT}
                                step="1"
                                value={tournamentRoundCount}
                                onChange={(e) => setTournamentRoundCount(parseInt(e.target.value, 10))}
                                className="w-full accent-emerald-400 h-1 bg-white/10 rounded-lg appearance-none cursor-pointer"
                              />
                              <span className="text-[9px] font-mono text-white/35 uppercase tracking-widest">
                                {TOURNAMENT_MIN_ROUND_COUNT} – {TOURNAMENT_MAX_ROUND_COUNT} elimination rounds
                              </span>
                            </div>
                            <div className="flex flex-col gap-1.5 bg-white/5 border border-white/5 rounded-lg p-3.5 pointer-events-auto">
                              <div className="flex justify-between text-xs font-mono uppercase tracking-wider text-white/60">
                                <span>Kills to Win</span>
                                <span className="text-emerald-400 font-bold">{tournamentKillsToWin}</span>
                              </div>
                              <input
                                type="range"
                                min={TOURNAMENT_MIN_KILLS_TO_WIN}
                                max={TOURNAMENT_MAX_KILLS_TO_WIN}
                                step="1"
                                value={tournamentKillsToWin}
                                onChange={(e) => setTournamentKillsToWin(parseInt(e.target.value, 10))}
                                className="w-full accent-emerald-400 h-1 bg-white/10 rounded-lg appearance-none cursor-pointer"
                              />
                              <span className="text-[9px] font-mono text-white/35 uppercase tracking-widest">
                                {TOURNAMENT_MIN_KILLS_TO_WIN} – {TOURNAMENT_MAX_KILLS_TO_WIN} kills per match
                              </span>
                            </div>
                            {/* Custom AI Presets Section */}
                            {aiPresets.length > 0 && (
                              <div className="flex flex-col gap-2.5 bg-white/5 border border-white/5 rounded-xl p-3.5 pointer-events-auto">
                                <div className="flex items-center gap-2 mb-1 justify-between">
                                  <div className="flex items-center gap-2">
                                    <span className="w-1.5 h-3.5 bg-sky-400" />
                                    <span className="text-xs uppercase font-bold tracking-wider text-white">
                                      🧬 Custom AI Presets
                                    </span>
                                  </div>
                                  <span className="text-[10px] font-mono text-white/40">
                                    {selectedTournamentPresets.length} selected
                                  </span>
                                </div>
                                
                                <div className="grid grid-cols-2 gap-2 max-h-36 overflow-y-auto pr-1">
                                  {aiPresets.map(preset => {
                                    const isSelected = selectedTournamentPresets.includes(preset.id);
                                    return (
                                      <button
                                        key={preset.id}
                                        onClick={() => {
                                          setSelectedTournamentPresets(prev =>
                                            prev.includes(preset.id)
                                              ? prev.filter(id => id !== preset.id)
                                              : [...prev, preset.id]
                                          );
                                        }}
                                        className={`flex items-center justify-between p-2.5 rounded-lg border text-left transition-all cursor-pointer font-sans ${
                                          isSelected
                                            ? 'bg-sky-500/10 border-sky-400/50 hover:bg-sky-500/15 text-sky-400 shadow-[0_0_10px_rgba(56,189,248,0.15)]'
                                            : 'bg-black/40 border-white/5 text-white/70 hover:bg-black/60 hover:border-white/10 hover:text-white'
                                        }`}
                                        title={getPresetDescription(preset.id, aiPresets)}
                                      >
                                        <div className="flex flex-col min-w-0 pr-2">
                                          <span className="text-xs font-bold truncate">{preset.name}</span>
                                          <span className="text-[9px] text-white/40 font-mono">
                                            RL: {preset.tuning.aiReactionLatency?.toFixed(2)}s
                                          </span>
                                        </div>
                                        <div className={`w-3.5 h-3.5 rounded border flex items-center justify-center transition-all shrink-0 ${
                                          isSelected ? 'border-sky-400 bg-sky-400 text-slate-900' : 'border-white/20 bg-transparent'
                                        }`}>
                                          {isSelected && (
                                            <svg className="w-2.5 h-2.5 font-bold" fill="none" stroke="currentColor" strokeWidth="3" viewBox="0 0 24 24">
                                              <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                                            </svg>
                                          )}
                                        </div>
                                      </button>
                                    );
                                  })}
                                </div>

                                {selectedTournamentPresets.length > 0 && (
                                  <button
                                    onClick={() => {
                                      const presetsToUse = aiPresets.filter(p => selectedTournamentPresets.includes(p.id));
                                      handleInitializeTournament('custom', tournamentKillsToWin, tournamentRoundCount, presetsToUse);
                                    }}
                                    className="group relative w-full h-11 mt-1 bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-400 hover:to-teal-500 transition-all duration-300 flex items-center justify-center overflow-hidden cursor-pointer rounded shadow-[0_0_15px_rgba(16,185,129,0.3)] border border-emerald-400/20 select-none pointer-events-auto active:scale-[0.99]"
                                  >
                                    <span className="text-white font-sans font-black text-[11px] uppercase tracking-widest pointer-events-none flex items-center gap-1.5">
                                      Start Tournament
                                      <svg className="w-4 h-4 transition-transform group-hover:translate-x-1" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
                                      </svg>
                                    </span>
                                  </button>
                                )}
                              </div>
                            )}

                            {aiPresets.length > 0 && selectedTournamentPresets.length === 0 && (
                              <div className="flex items-center gap-3 py-1">
                                <div className="h-[1px] flex-1 bg-white/5" />
                                <span className="text-[9px] font-mono uppercase tracking-widest text-white/30 font-bold">OR SELECT Standard Difficulty</span>
                                <div className="h-[1px] flex-1 bg-white/5" />
                              </div>
                            )}

                            <div className="flex flex-col gap-3 pointer-events-auto">
                              {([
                                { id: 'easy', label: 'Easy', color: 'text-emerald-400 border-emerald-500/20 bg-emerald-950/20 hover:bg-emerald-950/40 shadow-[0_0_8px_rgba(16,185,129,0.1)]', desc: 'Sub-Normal combat reflex latency, simple spacing behavior.' },
                                { id: 'normal', label: 'Normal', color: 'text-cyan-400 border-cyan-500/20 bg-cyan-950/20 hover:bg-cyan-950/40 shadow-[0_0_8px_rgba(6,182,212,0.1)]', desc: 'Standard combat matrix dials, average anticipation calculations.' },
                                { id: 'hard', label: 'Hard', color: 'text-amber-400 border-amber-500/20 bg-amber-950/20 hover:bg-amber-950/40 shadow-[0_0_8px_rgba(245,158,11,0.1)]', desc: 'Calibrated prediction systems, fast pacing & evading.' },
                                { id: 'nightmare', label: 'Nightmare', color: 'text-purple-400 border-purple-500/20 bg-purple-950/20 hover:bg-purple-950/40 shadow-[0_0_8px_rgba(168,85,247,0.1)]', desc: 'Hyper-responsive matrix overrides. Zero anticipation errors.' }
                              ] as const).map(diff => (
                                <button
                                  key={diff.id}
                                  onClick={() => handleInitializeTournament(diff.id, tournamentKillsToWin, tournamentRoundCount)}
                                  className={`group text-left p-4.5 rounded-xl border transition-all duration-300 cursor-pointer flex justify-between items-center ${diff.color} hover:scale-[1.01] hover:border-white/20`}
                                >
                                  <div className="flex flex-col gap-1 pr-4">
                                    <span className="text-base font-black uppercase tracking-wider">{diff.label}</span>
                                    <span className="text-[10px] text-white/50 lowercase leading-normal">{diff.desc}</span>
                                  </div>
                                  <span className="text-[10px] font-mono font-black tracking-widest uppercase opacity-40 group-hover:opacity-100 group-hover:text-white transition-opacity shrink-0">
                                    SELECT &rarr;
                                  </span>
                                </button>
                              ))}
                            </div>
                          </div>
                        ) : (
                          /* 2. Bracket Display (UT2004 simulated cyber bracket style) */
                          <div className="flex flex-col h-full min-h-0 justify-between">
                            <div className="flex flex-col gap-4 min-h-0 overflow-y-auto pr-0.5">
                              <div className="flex justify-between items-center pb-2 border-b border-white/5 shrink-0">
                                <span className="text-xs font-bold text-emerald-400 uppercase tracking-wider flex items-center gap-1.5 font-display">🏆 simulated bracket</span>
                                <div className="flex items-center gap-1.5">
                                  <span className="text-[10px] font-mono text-emerald-400 bg-emerald-950/40 border border-emerald-500/20 px-2 py-0.5 rounded uppercase font-black">{tournamentState.difficulty}</span>
                                  <span className="text-[10px] font-mono text-white/50 bg-white/5 border border-white/10 px-2 py-0.5 rounded uppercase font-black">
                                    FT{tournamentState.killsToWin ?? TOURNAMENT_DEFAULT_KILLS_TO_WIN}
                                  </span>
                                </div>
                              </div>

                              {tournamentState.status === 'gameover' ? (
                                <div className="text-center py-6 flex flex-col items-center gap-4 bg-red-950/20 border border-red-500/20 rounded-xl p-5 shadow-inner">
                                  <div className="w-12 h-12 rounded-full border border-red-500/30 flex items-center justify-center bg-red-950/40 animate-pulse">
                                    <svg className="w-6 h-6 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
                                    </svg>
                                  </div>
                                  <h3 className="text-xl font-black uppercase tracking-wider text-red-400 font-display">SIMULATION OVER</h3>
                                  <p className="text-xs text-white/60 leading-relaxed max-w-xs select-text">
                                    You were eliminated in Round {tournamentState.currentRound + 1} by <span className="text-red-400 font-bold uppercase">{tournamentState.opponents[tournamentState.rounds[tournamentState.currentRound][0].opponent2]?.name}</span>. The tournament data has closed.
                                  </p>
                                  <button
                                    onClick={handleResetTournament}
                                    className="mt-2 w-full h-12 bg-red-600 hover:bg-red-500 text-white font-black text-xs uppercase tracking-widest rounded transition-all active:scale-[0.98] cursor-pointer pointer-events-auto shadow-lg"
                                  >
                                    Restart Tournament
                                  </button>
                                </div>
                              ) : tournamentState.status === 'victory' ? (
                                <div className="text-center py-6 flex flex-col items-center gap-4 bg-amber-950/20 border border-amber-500/20 rounded-xl p-5 shadow-inner">
                                  <div className="w-14 h-14 rounded-full border border-amber-500/30 flex items-center justify-center bg-amber-950/40 shadow-[0_0_15px_rgba(245,158,11,0.25)] animate-pulse">
                                    <span className="text-2xl">🏆</span>
                                  </div>
                                  <h3 className="text-xl font-black uppercase tracking-widest text-transparent bg-clip-text bg-gradient-to-r from-amber-400 to-yellow-200 font-display">CHAMPION DECREED</h3>
                                  <p className="text-xs text-white/60 leading-relaxed max-w-xs select-text">
                                    Congratulations! You have completed the iBrawls simulated tournament brackets and asserted yourself as the Grifball Champion.
                                  </p>

                                  <div className="w-full text-left bg-black/40 border border-white/5 rounded-lg p-3 flex flex-col gap-2">
                                    <span className="text-[9px] font-mono font-bold tracking-widest uppercase text-amber-400">Teased Rewards Unlocked:</span>
                                    <div className="flex flex-col gap-1.5 font-mono text-[9.5px]">
                                      <div className="flex justify-between border-b border-white/5 pb-1">
                                        <span className="text-white/60">🏆 TITLE:</span>
                                        <span className="text-amber-300 font-extrabold">ARENA CHAMPION</span>
                                      </div>
                                      <div className="flex justify-between border-b border-white/5 pb-1">
                                        <span className="text-white/60">🛡️ ARMOR:</span>
                                        <span className="text-indigo-300 font-extrabold">CENTURION VOXEL</span>
                                      </div>
                                      <div className="flex justify-between">
                                        <span className="text-white/60">💫 VFX TRAIL:</span>
                                        <span className="text-cyan-300 font-extrabold">CRIMSON PLASMA</span>
                                      </div>
                                    </div>
                                    <span className="text-[8.5px] text-white/30 text-center italic mt-1 uppercase">Rewards will be equipable in sandbox in the next build!</span>
                                  </div>

                                  <button
                                    onClick={handleResetTournament}
                                    className="w-full h-12 bg-amber-500 hover:bg-amber-400 text-slate-950 font-black text-xs uppercase tracking-widest rounded transition-all active:scale-[0.98] cursor-pointer pointer-events-auto shadow-lg"
                                  >
                                    Begin New Run
                                  </button>
                                </div>
                              ) : (
                                <div className="flex flex-col gap-4">
                                  {/* Simulated UT2004 Bracket round tabs */}
                                  <div className="flex gap-2 font-mono text-[10px] select-none uppercase font-bold shrink-0">
                                    {getTournamentRoundLabels(tournamentState.roundCount ?? tournamentState.rounds.length).map((roundName, rIdx) => (
                                      <div
                                        key={rIdx}
                                        className={`flex-1 text-center py-1.5 rounded border transition-colors ${
                                          tournamentState.currentRound === rIdx
                                            ? 'bg-emerald-600/10 text-emerald-400 border-emerald-500/30'
                                            : rIdx < tournamentState.currentRound
                                              ? 'bg-white/5 text-white/60 border-white/5'
                                              : 'text-white/20 border-white/5'
                                        }`}
                                      >
                                        {roundName}
                                      </div>
                                    ))}
                                  </div>

                                  {/* List of matches in round */}
                                  <div className="flex flex-col gap-3.5 shrink-0">
                                    {tournamentState.rounds[tournamentState.currentRound].map((match, mIdx) => {
                                      const isPlayerMatch = match.opponent1 === 'player' || match.opponent2 === 'player';
                                      const opp1Name = match.opponent1 === 'player' ? `${playerName} (You)` : (tournamentState.opponents[match.opponent1]?.name || 'TBD');
                                      const opp2Name = tournamentState.opponents[match.opponent2]?.name || 'TBD';

                                      const opp1Hue = match.opponent1 === 'player' ? (adminSettings.playerHue ?? 200) : (tournamentState.opponents[match.opponent1]?.hue ?? 0);
                                      const opp2Hue = tournamentState.opponents[match.opponent2]?.hue ?? 0;

                                      const isCompleted = match.isCompleted;
                                      const winnerId = match.winner;

                                      return (
                                        <div
                                          key={mIdx}
                                          className={`bg-slate-950/60 rounded-xl p-3 border transition-all flex flex-col gap-2.5 relative select-none ${
                                            isPlayerMatch && !isCompleted
                                              ? 'border-emerald-400 shadow-[0_0_12px_rgba(52,211,153,0.15)] bg-slate-900/30'
                                              : 'border-white/10'
                                          }`}
                                        >
                                          {isPlayerMatch && !isCompleted && (
                                            <span className="absolute -top-2.5 right-4 bg-emerald-500 text-slate-950 text-[8px] font-black uppercase px-2 py-0.5 rounded tracking-widest shadow-md">
                                              YOUR MATCH
                                            </span>
                                          )}

                                          {/* Competitor 1 */}
                                          <div className="flex justify-between items-center text-left">
                                            <div className="flex items-center gap-2 max-w-[70%]">
                                              <div className="w-3.5 h-3.5 rounded-full border border-white/20 shadow-inner shrink-0" style={{ backgroundColor: `hsl(${opp1Hue}, 80%, 50%)` }} />
                                              <span className={`text-xs font-black truncate uppercase ${winnerId === match.opponent1 ? 'text-white' : winnerId ? 'text-white/30' : 'text-white/80'}`}>
                                                {opp1Name}
                                              </span>
                                            </div>
                                            <span className="text-xs font-mono font-black tracking-tight tabular-nums">
                                              {isCompleted ? match.score1 : '-'}
                                            </span>
                                          </div>

                                          {/* Divider */}
                                          <div className="h-[1px] bg-white/5 flex items-center justify-center">
                                            <span className="text-[7.5px] font-mono font-bold tracking-widest text-white/25 px-2 bg-slate-950 uppercase shrink-0">VS</span>
                                          </div>

                                          {/* Competitor 2 */}
                                          <div className="flex justify-between items-center text-left">
                                            <div className="flex items-center gap-2 max-w-[70%]">
                                              <div className="w-3.5 h-3.5 rounded-full border border-white/20 shadow-inner shrink-0" style={{ backgroundColor: `hsl(${opp2Hue}, 80%, 50%)` }} />
                                              <span className={`text-xs font-black truncate uppercase ${winnerId === match.opponent2 ? 'text-white' : winnerId ? 'text-white/30' : 'text-white/80'}`}>
                                                {opp2Name}
                                              </span>
                                            </div>
                                            <span className="text-xs font-mono font-black tracking-tight tabular-nums">
                                              {isCompleted ? match.score2 : '-'}
                                            </span>
                                          </div>
                                        </div>
                                      );
                                    })}
                                  </div>
                                </div>
                              )}
                            </div>

                            {/* bottom actions when bracket is active or playing status but back in lobby */}
                            {(tournamentState.status === 'bracket' || (tournamentState.status === 'playing' && !isPlaying)) && (
                              <div className="flex flex-col gap-3 mt-auto shrink-0 pt-4">
                                <button
                                  id="start-tournament-match-btn"
                                  onClick={handleStartTournamentMatch}
                                  className="group relative w-full h-16 bg-emerald-500 hover:bg-emerald-400 transition-all duration-300 flex items-center justify-center overflow-hidden cursor-pointer rounded shadow-2xl border border-emerald-400/20 select-none pointer-events-auto"
                                >
                                  <span className="relative z-10 text-slate-950 font-sans font-black text-sm uppercase tracking-widest pointer-events-none flex items-center gap-2">
                                    {tournamentState.status === 'playing' ? 'Resume Match' : 'Start Next Match'}
                                    <svg className="w-5 h-5 text-slate-950" fill="currentColor" viewBox="0 0 20 20">
                                      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z" clipRule="evenodd" />
                                    </svg>
                                  </span>
                                </button>

                                <button
                                  onClick={handleResetTournament}
                                  className="w-full h-12 bg-white/5 border border-white/10 flex items-center justify-center hover:bg-white/10 hover:border-white/20 active:scale-[0.99] transition-all cursor-pointer rounded pointer-events-auto select-none"
                                >
                                  <span className="text-white/40 font-sans font-bold text-xs uppercase tracking-widest pointer-events-none">
                                    Reset Tournament
                                  </span>
                                </button>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ) : activeMenuTab === 'multi' ? (
                  <div className="flex flex-col h-full min-h-0 justify-between gap-5">
                    <div className="flex flex-col gap-4 shrink-0">
                      <div className="flex items-center gap-2.5 mb-1">
                        <span className="w-2 h-4 bg-[#38bdf8]" />
                        <h2 className="text-sm uppercase font-bold tracking-[0.25em] text-white">
                          Multiplayer Setup
                        </h2>
                      </div>
                      
                      {/* CONNECTION MODE SELECTOR */}
                      <div className="flex bg-black/40 p-1.5 rounded-lg border border-white/5 gap-2 select-none shadow-[inset_0_1px_3px_rgba(0,0,0,0.3)]">
                        <button
                          onClick={() => setConnectionMode('relay')}
                          className={`flex-1 py-2 text-xs font-black uppercase tracking-wider rounded transition-all cursor-pointer text-center ${
                            connectionMode === 'relay'
                              ? 'bg-gradient-to-r from-sky-600 to-indigo-600 text-white shadow-md'
                              : 'text-white/40 hover:text-white/70'
                          }`}
                        >
                          🌐 Cloud Relay
                        </button>
                        <button
                          onClick={() => setConnectionMode('local')}
                          className={`flex-1 py-2 text-xs font-black uppercase tracking-wider rounded transition-all cursor-pointer text-center ${
                            connectionMode === 'local'
                              ? 'bg-gradient-to-r from-emerald-600 to-teal-600 text-white shadow-md'
                              : 'text-white/40 hover:text-white/70'
                          }`}
                        >
                          📶 Local LAN IP
                        </button>
                      </div>

                      {!isOnline && (
                        <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-3 text-left">
                          <p className="text-xs font-black uppercase tracking-widest text-amber-300">Offline Mode</p>
                          <p className="mt-1 text-xs text-white/60 leading-relaxed">
                            Solo training remains available from the installed app cache. Multiplayer, matchmaker chat, invites, and public IP discovery will reconnect when the network is back.
                          </p>
                        </div>
                      )}

                      {/* Connection coordinates */}
                      <div className={`p-3.5 rounded-lg border text-xs ${connectionMode === 'relay' ? "bg-sky-500/5 border-sky-500/20" : "bg-white/5 border-white/10"}`}>
                        <p className="text-[11px] text-[#38bdf8] font-bold uppercase tracking-wider mb-2">Your Connection Coordinates</p>
                        <div className="flex flex-col gap-1.5 font-mono text-xs font-semibold">
                          {connectionMode === 'relay' ? (
                            <div className="flex justify-between items-center bg-black/40 px-3 py-1.5 rounded border border-white/5">
                              <span className="text-white/45 uppercase text-[10px] font-bold">Relay Status:</span>
                              <span className="text-sky-400 font-extrabold flex items-center gap-1.5">
                                <span className="w-2 h-2 bg-emerald-400 rounded-full animate-pulse inline-block" /> ONLINE
                              </span>
                            </div>
                          ) : (
                            <div className="flex justify-between items-center bg-black/40 px-3 py-1.5 rounded border border-white/5">
                              <span className="text-white/45 uppercase text-[10px] font-bold">Web/Host IP:</span>
                              <span className="text-[#38bdf8] font-black">{userIp === '127.0.0.1' ? '127.0.0.1' : userIp}</span>
                            </div>
                          )}
                          {connectionMode === 'local' && lanIp && lanIp !== '127.0.0.1' && (
                            <div className="flex justify-between items-center bg-emerald-500/10 px-3 py-1.5 rounded border border-emerald-500/10">
                              <span className="text-emerald-400 uppercase text-[10px] font-bold">LAN Network IP:</span>
                              <span className="text-emerald-400 font-extrabold">{lanIp}</span>
                            </div>
                          )}
                          <div className="flex justify-between items-center bg-black/40 px-3 py-1.5 rounded border border-white/5">
                            <span className="text-white/45 uppercase text-[10px] font-bold">Room Code:</span>
                            <span className="text-amber-400 font-black tracking-widest">{hostIdCode}</span>
                          </div>
                        </div>
                      </div>

                      {/* Connection States */}
                      {connectionStatus === 'hosting' && (
                        <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-lg p-3.5 flex flex-col items-center justify-center text-center gap-1.5 animate-pulse">
                          <span className="w-2 h-2 rounded-full bg-emerald-500 shadow-[0_0_10px_#10b981]" />
                          <p className="text-xs font-bold text-emerald-400 uppercase tracking-widest">Lobby Live & Broadcasting</p>
                          <p className="text-[10px] text-white/60">Awaiting player to join...</p>
                          <button
                            onClick={handleCancelHostOrJoin}
                            className="mt-2 px-4 py-1.5 bg-white/10 hover:bg-white/20 text-xs font-bold uppercase tracking-widest text-white border border-white/10 rounded cursor-pointer transition-all"
                          >
                            Cancel
                          </button>
                        </div>
                      )}

                      {connectionStatus === 'connecting' && (
                        <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-3.5 flex flex-col items-center justify-center text-center gap-1.5 animate-pulse">
                          <span className="w-2 h-2 rounded-full bg-blue-500 shadow-[0_0_10px_#3b82f6]" />
                          <p className="text-xs font-bold text-blue-400 uppercase tracking-widest">Connecting Protocol</p>
                          <p className="text-[10px] text-white/60">Attaching to host session...</p>
                          <button
                            onClick={handleCancelHostOrJoin}
                            className="mt-2 px-4 py-1.5 bg-white/10 hover:bg-white/20 text-xs font-bold uppercase tracking-widest text-white border border-white/10 rounded cursor-pointer transition-all"
                          >
                            Cancel
                          </button>
                        </div>
                      )}

                      {/* Quick Play Search State */}
                      {quickPlayStatus === 'searching' && (
                        <div className="bg-sky-500/10 border border-sky-500/30 rounded-lg p-6 flex flex-col items-center justify-center text-center gap-4 relative overflow-hidden">
                          {/* Pulsing radar scanning animation */}
                          <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
                            <div className="w-32 h-32 border border-sky-500/20 rounded-full animate-ping absolute" />
                            <div className="w-20 h-20 border border-sky-500/30 rounded-full animate-pulse absolute" />
                          </div>
                          
                          <span className="text-3xl animate-spin inline-block">📡</span>
                          <p className="text-sm font-black text-sky-400 uppercase tracking-widest">Searching for Match...</p>
                          <p className="text-xs text-white/60">Scanning open rooms and queuing players</p>
                          
                          <button
                            onClick={handleCancelQuickPlay}
                            className="z-10 px-5 py-2 bg-red-500/25 hover:bg-red-500/40 text-xs font-bold uppercase tracking-widest text-red-400 border border-red-500/30 rounded cursor-pointer transition-all active:scale-[0.97]"
                          >
                            Cancel Search
                          </button>
                        </div>
                      )}

                      {quickPlayStatus === 'matching' && (
                        <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-6 flex flex-col items-center justify-center text-center gap-2 animate-pulse">
                          <span className="text-2xl">⚡</span>
                          <p className="text-sm font-black text-amber-400 uppercase tracking-widest font-bold">Match Found!</p>
                          <p className="text-xs text-white/60">Configuring arena host credentials...</p>
                        </div>
                      )}

                      {/* Host/Connect triggers */}
                      {(connectionStatus === 'idle' || connectionStatus === 'error' || connectionStatus === 'fetching_ip') && quickPlayStatus === 'idle' && (
                        <div className="flex flex-col gap-2.5">
                          <button
                            onClick={handleQuickPlay}
                            className="w-full h-14 bg-gradient-to-r from-sky-400 via-indigo-400 to-purple-500 hover:from-sky-500 hover:to-purple-600 text-slate-950 hover:text-white font-sans font-black text-xs uppercase tracking-[0.2em] transition-all rounded shadow-lg shadow-sky-500/25 border border-sky-300/30 cursor-pointer flex items-center justify-center gap-2 hover:shadow-indigo-500/40 active:scale-[0.98] select-none"
                          >
                            ⚡ Quick Play Matchmaking
                          </button>

                          <div className="flex items-center gap-2 py-0.5">
                            <hr className="flex-grow border-white/5" />
                            <span className="text-[10px] text-white/20 uppercase tracking-widest font-mono">OR DIRECT PLAY</span>
                            <hr className="flex-grow border-white/5" />
                          </div>

                          <button
                            onClick={() => handleHostGame()}
                            className="w-full h-12 bg-white hover:bg-emerald-500 text-slate-900 hover:text-white hover:border-emerald-400 font-sans font-black text-xs uppercase tracking-widest transition-all rounded shadow border border-white/10 cursor-pointer flex items-center justify-center gap-1.5"
                          >
                            🎙️ Host New Match
                          </button>

                          <div className="flex items-center gap-2 py-0.5">
                            <hr className="flex-grow border-white/10" />
                            <span className="text-[10px] text-white/30 uppercase tracking-widest font-mono">OR JOIN ROOM</span>
                            <hr className="flex-grow border-white/10" />
                          </div>

                          <div className="flex gap-2">
                            <input
                              type="text"
                              value={joinIpOrId}
                              onChange={(e) => setJoinIpOrId(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') handleJoinGame(joinIpOrId);
                              }}
                              placeholder="Room Code or IP..."
                              className="flex-1 h-12 bg-black/60 border border-white/10 rounded px-3.5 text-center font-mono text-sm tracking-wide text-[#38bdf8] placeholder:text-white/20 focus:border-[#38bdf8] outline-none transition-all"
                            />
                            <button
                              onClick={() => handleJoinGame(joinIpOrId)}
                              disabled={!joinIpOrId}
                              className={`px-4.5 h-12 font-sans font-black text-xs uppercase tracking-widest rounded transition-all border outline-none ${
                                joinIpOrId 
                                  ? 'bg-[#38bdf8]/15 hover:bg-[#38bdf8]/35 border-[#38bdf8]/50 text-[#38bdf8] cursor-pointer' 
                                  : 'bg-white/5 border-white/5 text-white/20 cursor-not-allowed'
                              }`}
                            >
                              Connect
                            </button>
                            <button
                              onClick={() => handleJoinGame(joinIpOrId, true)}
                              disabled={!joinIpOrId}
                              className={`px-4.5 h-12 font-sans font-black text-xs uppercase tracking-widest rounded transition-all border outline-none ${
                                joinIpOrId 
                                  ? 'bg-amber-500/10 hover:bg-amber-500/30 border-amber-500/50 text-amber-400 cursor-pointer shadow-[0_0_12px_rgba(245,158,11,0.1)]' 
                                  : 'bg-white/5 border-white/5 text-white/20 cursor-not-allowed'
                              }`}
                            >
                              Spectate
                            </button>
                          </div>
                        </div>
                      )}

                      {connectionStatus === 'error' && (
                        <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-2.5 text-center animate-pulse">
                          <p className="text-xs text-red-400 font-black uppercase tracking-wider mb-0.5">⚠️ Sync Timeout</p>
                          <p className="text-xs text-white/70">{connectionError || 'Connection failed.'}</p>
                        </div>
                      )}

                      {/* Collapsible Advanced Settings Panel */}
                      <div className="mt-3.5 border-t border-white/5 pt-3.5">
                        <details className="group">
                          <summary className="flex justify-between items-center text-xs text-[#38bdf8] font-bold uppercase tracking-wider cursor-pointer select-none hover:text-white transition-colors">
                            <span>⚙️ Advanced Settings</span>
                            <span className="text-[10px] transition-transform group-open:rotate-180 font-sans">▼</span>
                          </summary>
                          
                          <div className="flex flex-col gap-2.5 mt-2.5 bg-black/30 p-3 rounded border border-white/5">
                            <label className="text-[10px] text-white/50 uppercase tracking-widest font-mono">Matchmaker Server URL:</label>
                            <input
                              type="text"
                              value={customUrlInput}
                              onChange={(e) => setCustomUrlInput(e.target.value)}
                              placeholder="wss://..."
                              className="w-full h-10 bg-black/60 border border-white/10 rounded px-2.5 font-mono text-xs tracking-wide text-white focus:border-[#38bdf8] outline-none transition-all"
                            />
                            <div className="flex gap-2.5">
                              <button
                                onClick={() => {
                                  let cleanUrl = customUrlInput.trim();
                                  if (cleanUrl) {
                                    if (!cleanUrl.startsWith('ws://') && !cleanUrl.startsWith('wss://')) {
                                      const protocol = window.location.protocol === 'https:' ? 'wss://' : 'ws://';
                                      cleanUrl = protocol + cleanUrl;
                                    }
                                    localStorage.setItem('ibrawls_matchmaker_url', cleanUrl);
                                    setMatchmakerUrl(cleanUrl);
                                    setCustomUrlInput(cleanUrl);
                                    setConnectionError('Matchmaker updated. Reconnecting...');
                                    if (menuSocket) {
                                      menuSocket.close();
                                    }
                                  }
                                }}
                                className="flex-1 h-9 bg-[#38bdf8] hover:bg-[#38bdf8]/80 text-slate-950 font-sans font-black text-xs uppercase tracking-wider rounded cursor-pointer transition-all active:scale-[0.97]"
                              >
                                Apply
                              </button>
                              <button
                                onClick={() => {
                                  localStorage.removeItem('ibrawls_matchmaker_url');
                                  const defaultUrl = getSavedMatchmakerUrl();
                                  setMatchmakerUrl(defaultUrl);
                                  setCustomUrlInput(defaultUrl);
                                  setConnectionError('Reset to default. Reconnecting...');
                                  if (menuSocket) {
                                    menuSocket.close();
                                  }
                                }}
                                className="h-9 px-3 bg-white/5 hover:bg-white/10 text-white/60 hover:text-white border border-white/10 rounded text-xs font-bold uppercase tracking-wider cursor-pointer transition-all"
                              >
                                Reset
                              </button>
                            </div>

                            {/* Always-on data collection disclosure (tech demo) */}
                            <div className="flex items-start gap-2.5 mt-1.5 pt-2.5 border-t border-white/5">
                              <span className="text-sm mt-0.5">📊</span>
                              <span className="flex flex-col gap-0.5">
                                <span className="text-[10px] text-white/70 uppercase tracking-widest font-mono">
                                  Data collection (tech demo)
                                </span>
                                <span className="text-[10px] text-white/40 font-medium leading-snug normal-case tracking-normal">
                                  This demo collects anonymized gameplay stats and a sampled subset of match replays (player names removed) to train and improve the AI. No accounts or personal info are stored.
                                </span>
                              </span>
                            </div>
                          </div>
                        </details>
                      </div>
                    </div>

                  </div>
                ) : activeMenuTab === 'spec' ? (
                  /* SPECTATOR MODE */
                  <div className="flex flex-col gap-4">
                    <div className="bg-slate-950/45 border border-white/10 rounded-xl p-5 flex flex-col gap-3 shadow-[inset_0_1px_3px_rgba(0,0,0,0.30)]">
                      <span className="text-[10px] font-mono font-bold tracking-[0.4em] uppercase text-[#22d3ee]">OBSERVER MODE</span>
                      <h2 className="text-2xl font-display font-black italic uppercase tracking-tight" style={{ background: 'linear-gradient(90deg,#22d3ee,#fff,#a5b4fc)', WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent', lineHeight: 1 }}>
                        FLIGHT ENGINE
                      </h2>
                      <p className="text-sm text-white/65 leading-relaxed">
                        Camera-only access. Maneuver between active brawlers with <code className="bg-[#22d3ee]/10 border border-[#22d3ee]/25 text-[#22d3ee] px-1.5 py-0.5 rounded text-xs font-mono">[W][A][S][D]</code>, rise with <code className="bg-[#22d3ee]/10 border border-[#22d3ee]/25 text-[#22d3ee] px-1.5 py-0.5 rounded text-xs font-mono">[SPACE]</code>, cycle targets with ◀ ▶.
                      </p>
                    </div>
                    <button
                      onClick={() => { setActiveMenuTab('multi'); }}
                      className="w-full h-14 bg-[#22d3ee]/12 border border-[#22d3ee]/45 rounded text-[#22d3ee] font-sans font-black text-sm italic uppercase tracking-wider cursor-pointer shadow-[0_0_18px_rgba(34,211,238,0.25)] hover:bg-[#22d3ee]/20 transition-all"
                    >
                      Spectate Live Match
                    </button>
                    <div className="bg-white/4 border border-white/5 rounded-lg p-3">
                      <span className="text-[9px] font-mono text-[#a5b4fc] uppercase tracking-widest">MANEUVER OVERRIDE SYSTEMS</span>
                      <p className="text-xs text-white/65 mt-1 leading-relaxed">
                        Join an active multiplayer session as an observer. You cannot interact with the match — just watch and analyze brawl patterns.
                      </p>
                    </div>
                  </div>
                ) : (
                  /* THEATER MODE: SAVED REPLAYS ARCHIVE + ROLLING MATCH CACHE */
                  <div className="grid h-full min-h-0 grid-cols-1 xl:grid-cols-2 gap-4 text-left">
                  <div className="flex flex-col h-full min-h-0 gap-4">
                    <div className="bg-slate-950/45 border border-white/10 rounded-xl p-4.5 flex flex-col gap-3 shrink-0 shadow-[inset_0_1px_3px_rgba(0,0,0,0.30)]">
                      <span className="text-[10px] font-mono font-bold tracking-[0.4em] uppercase text-[#e11d48]">THEATER MODE</span>
                      <h2 className="text-xl font-display font-black italic uppercase tracking-tight" style={{ background: 'linear-gradient(90deg,#e11d48,#fff,#f43f5e)', WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent', lineHeight: 1 }}>
                        Saved Replays
                      </h2>
                      <p className="text-[11.5px] text-white/60 leading-normal">
                        Select a recorded match replay to watch with full fly-camera controls, perspective changes, and timeline seeking.
                      </p>
                    </div>

                    {/* SEARCH & FILTERS */}
                    <div className="bg-slate-950/35 border border-white/5 rounded-xl p-3 flex flex-col gap-2 shrink-0">
                      <div className="relative">
                        <input
                          type="text"
                          value={theaterSearchQuery}
                          onChange={(e) => setTheaterSearchQuery(e.target.value)}
                          placeholder="Search saved replays..."
                          className="w-full h-9 bg-black/60 border border-white/10 rounded px-3 text-xs tracking-wide text-[#e11d48] placeholder:text-white/20 focus:border-[#e11d48] outline-none transition-all"
                        />
                        {theaterSearchQuery && (
                          <button
                            onClick={() => setTheaterSearchQuery('')}
                            className="absolute right-3.5 top-2 text-[10px] font-bold text-white/40 hover:text-white"
                          >
                            ✕
                          </button>
                        )}
                      </div>

                      <div className="flex gap-2">
                        {/* Map Filter */}
                        <div className="flex-1 flex flex-col gap-1">
                          <span className="text-[8px] font-mono text-white/40 uppercase tracking-widest">Map Filter</span>
                          <select
                            value={theaterMapFilter}
                            onChange={(e) => setTheaterMapFilter(e.target.value as any)}
                            className="h-8 bg-black/60 border border-white/10 rounded px-2 text-[10.5px] text-white/70 outline-none focus:border-[#e11d48] cursor-pointer"
                          >
                            <option value="all">🌐 All Maps</option>
                            <option value="hangar">⚙️ Hangar</option>
                            <option value="circle">🔵 Circle</option>
                          </select>
                        </div>

                        {/* Mode Filter */}
                        <div className="flex-1 flex flex-col gap-1">
                          <span className="text-[8px] font-mono text-white/40 uppercase tracking-widest">Mode Filter</span>
                          <select
                            value={theaterModeFilter}
                            onChange={(e) => setTheaterModeFilter(e.target.value as any)}
                            className="h-8 bg-black/60 border border-white/10 rounded px-2 text-[10.5px] text-white/70 outline-none focus:border-[#e11d48] cursor-pointer"
                          >
                            <option value="all">🏆 All Modes</option>
                            <option value="sandbox">🛡️ Sandbox</option>
                            <option value="tournament">🎖️ Tourney</option>
                          </select>
                        </div>
                      </div>
                    </div>

                    {/* SAVED REPLAYS LIST */}
                    <div className="flex-1 overflow-y-auto min-h-0 flex flex-col gap-2.5 pr-1">
                      {savedReplays.filter(r => 
                        (theaterMapFilter === 'all' || r.mapType === theaterMapFilter) &&
                        (theaterModeFilter === 'all' || r.mode === theaterModeFilter) &&
                        (r.name.toLowerCase().includes(theaterSearchQuery.toLowerCase()) || 
                         r.description.toLowerCase().includes(theaterSearchQuery.toLowerCase()))
                      ).length === 0 ? (
                        <div className="bg-black/30 border border-white/5 rounded-lg p-5 text-center my-auto">
                          <p className="text-xs text-white/40 italic font-medium">No saved replays found.</p>
                          <p className="text-[10px] text-white/30 mt-1 leading-normal">
                            Record a local training match, then save it from the rolling cache panel.
                          </p>
                        </div>
                      ) : (
                        savedReplays.filter(r => 
                          (theaterMapFilter === 'all' || r.mapType === theaterMapFilter) &&
                          (theaterModeFilter === 'all' || r.mode === theaterModeFilter) &&
                          (r.name.toLowerCase().includes(theaterSearchQuery.toLowerCase()) || 
                           r.description.toLowerCase().includes(theaterSearchQuery.toLowerCase()))
                        ).map(replay => {
                          const minutes = Math.floor(replay.duration / 60);
                          const seconds = Math.floor(replay.duration % 60);
                          const durationStr = `${minutes}:${seconds < 10 ? '0' : ''}${seconds}`;
                          const sizeStr = formatReplaySizeMB(replaySizes[replay.id] ?? 0);
                          const canOpenHeatmap = replayHasHeatmapEvents(replay);
                          
                          let formattedDate = replay.date;
                          try {
                            formattedDate = new Date(replay.date).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
                          } catch (_) {}

                          return (
                            <div key={replay.id} className="bg-slate-950/45 border border-white/5 rounded-xl p-3.5 flex flex-col gap-2.5 shadow-md hover:border-pink-500/30 transition-all shrink-0">
                              <div className="flex justify-between items-start gap-2">
                                <div className="flex flex-col min-w-0">
                                  <h4 className="text-xs font-black uppercase text-[#f43f5e] truncate" title={replay.name}>
                                    {replay.name}
                                  </h4>
                                  {replay.description && (
                                    <p className="text-[10px] text-white/50 italic mt-0.5 line-clamp-2 leading-relaxed" title={replay.description}>
                                      {replay.description}
                                    </p>
                                  )}
                                </div>
                                <span className="text-[9px] font-mono font-bold text-white/40 bg-white/5 border border-white/10 px-2 py-0.5 rounded shrink-0">
                                  {durationStr} · {sizeStr}
                                </span>
                              </div>

                              <div className="grid grid-cols-2 gap-1 text-[9px] font-mono text-white/50 border-t border-b border-white/5 py-1.5">
                                <div>Map: <span className="text-white/80 font-bold uppercase">{replay.mapType}</span></div>
                                <div>Mode: <span className="text-white/80 font-bold uppercase">{replay.mode}</span></div>
                                <div>Pilot: <span className="text-white/80 font-bold uppercase">{replay.playerName}</span></div>
                                <div>Opponent: <span className="text-white/80 font-bold uppercase">{replay.opponentName}</span></div>
                              </div>

                              {renderReplayHeatmapPreview(replay)}

                              <div className="flex items-center justify-between mt-0.5 gap-2">
                                <span className="text-[9px] font-mono text-white/30">{formattedDate}</span>
                                <div className="flex gap-1.5">
                                  <button
                                    onClick={() => {
                                      setEditReplayId(replay.id);
                                      setEditReplayName(replay.name);
                                      setEditReplayDesc(replay.description);
                                      setShowEditModal(true);
                                    }}
                                    className="p-1 bg-white/5 hover:bg-white/10 border border-white/10 rounded text-[9.5px] font-bold text-white/60 hover:text-white uppercase tracking-wider transition-all cursor-pointer flex items-center justify-center w-7 h-7"
                                    title="Edit meta descriptions"
                                  >
                                    ✏️
                                  </button>
                                  <button
                                    onClick={async () => {
                                      if (confirm('Delete this match replay permanent record?')) {
                                        await deleteReplay(replay.id, false);
                                        await loadTheaterReplays();
                                      }
                                    }}
                                    className="p-1 bg-red-950/20 hover:bg-red-900/40 border border-red-500/20 hover:border-red-500/40 rounded text-[9.5px] font-bold text-red-400 hover:text-red-300 uppercase tracking-wider transition-all cursor-pointer flex items-center justify-center w-7 h-7"
                                    title="Delete Replay"
                                  >
                                    🗑️
                                  </button>
                                  <button
                                    onClick={async () => {
                                      setReplayUploadStatus((s) => ({ ...s, [replay.id]: 'uploading' }));
                                      const result = await contributeReplay(replay);
                                      setReplayUploadStatus((s) => ({ ...s, [replay.id]: result.ok ? 'done' : 'error' }));
                                    }}
                                    disabled={replayUploadStatus[replay.id] === 'uploading' || replayUploadStatus[replay.id] === 'done'}
                                    className="px-2 h-7 bg-sky-950/30 hover:bg-sky-900/50 border border-sky-500/20 hover:border-sky-500/40 rounded text-[9.5px] font-bold text-sky-300 hover:text-sky-200 uppercase tracking-wider transition-all cursor-pointer flex items-center justify-center disabled:opacity-50"
                                    title="Upload this replay to AI training now (anonymous, names removed, compressed)"
                                  >
                                    {replayUploadStatus[replay.id] === 'uploading'
                                      ? '⏳ …'
                                      : replayUploadStatus[replay.id] === 'done'
                                      ? '✓ Sent'
                                      : replayUploadStatus[replay.id] === 'error'
                                      ? '⚠ Retry'
                                      : '☁ Contribute'}
                                  </button>
                                  <button
                                    onClick={() => handleOpenHeatmapReplay(replay)}
                                    disabled={!canOpenHeatmap}
                                    className="px-2.5 h-7 bg-cyan-950/30 hover:bg-cyan-900/50 border border-cyan-500/20 hover:border-cyan-500/40 rounded text-[9.5px] font-bold text-cyan-300 hover:text-cyan-200 uppercase tracking-wider transition-all cursor-pointer flex items-center justify-center disabled:opacity-40 disabled:cursor-not-allowed"
                                    title={canOpenHeatmap ? 'Watch this replay as a 2D heatmap' : 'No heatmap data in this replay'}
                                  >
                                    Heatmap
                                  </button>
                                  <button
                                    onClick={() => {
                                      setSelectedReplay(replay);
                                      setIsPlaying(true);
                                      setIsPaused(false);
                                    }}
                                    className="px-3 h-7 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-[9.5px] font-black text-white uppercase tracking-widest rounded border border-emerald-500/20 hover:shadow-[0_0_10px_rgba(16,185,129,0.3)] transition-all cursor-pointer flex items-center gap-1.5"
                                  >
                                    ▶ Watch
                                  </button>
                                </div>
                              </div>
                            </div>
                          );
                        })
                      )}
                    </div>
                  </div>
                  {renderRollingReplayCachePanel()}
                  </div>
                )}
              </div>
              )}

              {shouldRenderCustomizationFrame && !isPainting && (
                <button
                  type="button"
                  className="main-menu-frame-splitter main-menu-frame-splitter-grid"
                  aria-label="Resize setup and customization frames"
                  title="Resize setup and customization frames"
                  onPointerDown={(e) => handleMainMenuSplitterPointerDown('customization', e)}
                >
                  <span />
                </button>
              )}

              {/* COLUMN 2: KEYBIND REFERENCE & CUSTOMIZER */}
              {shouldRenderCustomizationFrame && (
              <div className="mobile-reference-panel flex flex-col h-full min-h-0 overflow-y-auto gap-4">
                  <>
                    {/* Segmented Tab Switcher */}
                <div className="flex bg-black/40 p-1.5 rounded-lg border border-white/5 gap-1.5 select-none shrink-0 shadow-[inset_0_1px_3px_rgba(0,0,0,0.3)]">
                  <button
                    onClick={() => setRightPanelTab('manual')}
                    className={`flex-1 py-2 text-xs font-bold font-display uppercase tracking-wider rounded transition-all cursor-pointer text-center flex items-center justify-center gap-1 shrink-0 ${
                      rightPanelTab === 'manual'
                        ? 'bg-gradient-to-b from-[#22d3ee] to-[#0891b2] text-slate-950 shadow-md font-black'
                        : 'text-white/40 hover:text-white/70'
                    }`}
                  >
                    ⌨ Controls
                  </button>
                  <button
                    onClick={() => setRightPanelTab('gamepad')}
                    className={`flex-1 py-2 text-xs font-bold font-display uppercase tracking-wider rounded transition-all cursor-pointer text-center flex items-center justify-center gap-1 shrink-0 ${
                      rightPanelTab === 'gamepad'
                        ? 'bg-gradient-to-b from-[#22d3ee] to-[#0891b2] text-slate-950 shadow-md font-black'
                        : 'text-white/40 hover:text-white/70'
                    }`}
                  >
                    🎮 Gamepad
                  </button>
                  <button
                    onClick={() => setRightPanelTab('customize')}
                    className={`flex-1 py-2 text-xs font-bold font-display uppercase tracking-wider rounded transition-all cursor-pointer text-center flex items-center justify-center gap-1 shrink-0 ${
                      rightPanelTab === 'customize'
                        ? 'bg-gradient-to-b from-[#22d3ee] to-[#0891b2] text-slate-950 shadow-md font-black'
                        : 'text-white/40 hover:text-white/70'
                    }`}
                  >
                    🎨 Armor
                  </button>
                </div>

                {rightPanelTab === 'manual' && (
                  <div className="flex flex-col gap-4">
                    <CompactKeybindList
                      bindings={keybindings}
                      rebinding={rebindingAction}
                      onPick={(action) => setRebindingAction(prev => prev === action ? null : action)}
                    />

                    {/* Visual Keyboard + Mouse layout */}
                    <div className="desktop-keyboard-visualizer">
                      <KeyboardVisualizer
                        bindings={keybindings}
                        rebinding={rebindingAction}
                        onPick={(action) => setRebindingAction(prev => prev === action ? null : action)}
                      />
                    </div>

                    {/* Mouse sensitivity & acceleration */}
                    <div style={{ background: 'rgba(2,6,23,0.45)', border: '1px solid rgba(255,255,255,0.10)', borderRadius: 12, padding: 18, boxShadow: 'inset 0 1px 3px rgba(0,0,0,0.30)' }}>
                      <span style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 12, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase' as const, color: '#38bdf8', display: 'block', marginBottom: 14, paddingBottom: 10, borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                        🖱 Mouse Settings
                      </span>
                      <div style={{ display: 'flex', flexDirection: 'column' as const, gap: 14 }}>
                        {/* Sensitivity */}
                        <div style={{ display: 'flex', flexDirection: 'column' as const, gap: 6 }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', fontFamily: "'JetBrains Mono', monospace", fontSize: 10, fontWeight: 700, textTransform: 'uppercase' as const, letterSpacing: '0.1em', color: 'rgba(255,255,255,0.70)' }}>
                            <span>Sensitivity</span>
                            <span style={{ color: '#22d3ee' }}>{(keybindings.mouseSensitivity ?? 1.0).toFixed(1)}x</span>
                          </div>
                          <input type="range" min="0.1" max="5.0" step="0.1"
                            value={keybindings.mouseSensitivity ?? 1.0}
                            onChange={(e) => {
                              const v = parseFloat(e.target.value);
                              setKeybindings(prev => {
                                const updated = { ...prev, mouseSensitivity: v };
                                try { localStorage.setItem('grifball_keybindings', JSON.stringify(updated)); } catch (_) {}
                                return updated;
                              });
                            }}
                            className="w-full accent-cyan-400 h-1 bg-white/10 rounded-lg appearance-none cursor-pointer"
                          />
                          <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 9, color: 'rgba(255,255,255,0.35)' }}>
                            0.1 (slow) — 5.0 (fast). Default: 1.0
                          </span>
                        </div>
                        {/* Acceleration */}
                        <div style={{ display: 'flex', flexDirection: 'column' as const, gap: 6 }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', fontFamily: "'JetBrains Mono', monospace", fontSize: 10, fontWeight: 700, textTransform: 'uppercase' as const, letterSpacing: '0.1em', color: 'rgba(255,255,255,0.70)' }}>
                            <span>Acceleration</span>
                            <span style={{ color: (keybindings.mouseAcceleration ?? 0) > 0 ? '#fbbf24' : 'rgba(255,255,255,0.40)' }}>
                              {(keybindings.mouseAcceleration ?? 0.0).toFixed(1)}{(keybindings.mouseAcceleration ?? 0) === 0 ? ' (OFF)' : ''}
                            </span>
                          </div>
                          <input type="range" min="0.0" max="2.0" step="0.1"
                            value={keybindings.mouseAcceleration ?? 0.0}
                            onChange={(e) => {
                              const v = parseFloat(e.target.value);
                              setKeybindings(prev => {
                                const updated = { ...prev, mouseAcceleration: v };
                                try { localStorage.setItem('grifball_keybindings', JSON.stringify(updated)); } catch (_) {}
                                return updated;
                              });
                            }}
                            className="w-full accent-amber-400 h-1 bg-white/10 rounded-lg appearance-none cursor-pointer"
                          />
                          <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 9, color: 'rgba(255,255,255,0.35)' }}>
                            0.0 = linear (off). Higher = faster as you move faster.
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Movement Settings */}
                    <div style={{ background: 'rgba(2,6,23,0.45)', border: '1px solid rgba(255,255,255,0.10)', borderRadius: 12, padding: 18, boxShadow: 'inset 0 1px 3px rgba(0,0,0,0.30)' }}>
                      <span style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 12, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase' as const, color: '#38bdf8', display: 'block', marginBottom: 14, paddingBottom: 10, borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                        🏃 Movement Settings
                      </span>
                      <SprintModeToggle keybindings={keybindings} setKeybindings={setKeybindings} />
                    </div>

                    {/* Reset footer */}
                    <div className="flex items-center justify-between px-2 py-1.5 border-t border-white/5 font-mono text-xs text-white/40">
                      <button
                        onClick={() => {
                          setKeybindings({ ...DEFAULT_KEYBINDINGS });
                          setRebindingAction(null);
                          try { localStorage.setItem('grifball_keybindings', JSON.stringify(DEFAULT_KEYBINDINGS)); } catch (e) {}
                        }}
                        className="text-[10px] text-amber-400/70 hover:text-amber-400 font-bold uppercase tracking-wider cursor-pointer transition-colors bg-transparent border-none p-0"
                      >
                        ↻ Reset All Keybinds
                      </button>
                    </div>
                    <div className="flex flex-col gap-3 font-sans text-sm">
                      {/* kept for legacy compat – hidden */}
                      <div className="hidden">
                      {/* Rebind Instructions */}
                      <div className="flex items-center gap-2 px-2 py-1.5 bg-amber-500/5 border border-amber-500/15 rounded text-[11px] text-amber-400/80 font-medium select-none">
                        <span>⚡</span>
                        <span>Click any key below to rebind. Press <kbd className="bg-black/40 px-1.5 py-0.5 rounded border border-white/10 text-[10px] font-mono font-bold">ESC</kbd> to cancel.</span>
                      </div>

                      {/* Movement Controls */}
                      <div className="bg-white/5 border border-white/5 rounded-lg p-4">
                        <p className="text-xs font-bold text-[#38bdf8] uppercase tracking-wider mb-3">Arena Navigation</p>
                        <div className="grid grid-cols-2 gap-y-3 gap-x-4 text-white/80">
                          {([
                            { action: 'moveForward' as keyof Keybindings, label: 'Move Forward' },
                            { action: 'moveLeft' as keyof Keybindings, label: 'Move Left' },
                            { action: 'moveBackward' as keyof Keybindings, label: 'Move Backward' },
                            { action: 'moveRight' as keyof Keybindings, label: 'Move Right' },
                            { action: 'jump' as keyof Keybindings, label: 'Jump (Boost)' },
                            { action: 'dash' as keyof Keybindings, label: 'Sonic Dash' },
                            { action: 'crouch' as keyof Keybindings, label: 'Crouch / Slide' },
                            { action: 'sprint' as keyof Keybindings, label: 'Sprint' },
                            { action: 'scoreboard' as keyof Keybindings, label: 'Scoreboard' },
                          ]).map(({ action, label }) => (
                            <div key={action} className="flex items-center gap-2.5">
                              <button
                                onClick={() => setRebindingAction(rebindingAction === action ? null : action)}
                                className={`min-w-[3rem] h-7 rounded flex items-center justify-center font-mono font-bold text-xs border cursor-pointer transition-all select-none ${
                                  rebindingAction === action
                                    ? 'bg-amber-500/20 border-amber-500/60 text-amber-400 animate-pulse shadow-[0_0_12px_rgba(245,158,11,0.3)]'
                                    : 'bg-black/50 border-white/20 text-[#38bdf8] hover:border-[#38bdf8]/50 hover:bg-[#38bdf8]/10'
                                }`}
                              >
                                {rebindingAction === action ? '...' : (
                                  keybindings[action] === ' ' ? 'SPACE' : keybindings[action].toUpperCase()
                                )}
                              </button>
                              <span className="text-white/60 text-xs font-medium">{label}</span>
                            </div>
                          ))}
                        </div>
                      </div>

                      {/* Weapon Controls */}
                      <div className="bg-white/5 border border-white/5 rounded-lg p-4">
                        <p className="text-xs font-bold text-[#38bdf8] uppercase tracking-wider mb-3">Arsenal Control & Swapping</p>
                        <div className="grid grid-cols-2 gap-y-3 gap-x-4 text-white/80">
                          {([
                            { action: 'weapon1' as keyof Keybindings, label: 'Grav Hammer', color: 'text-cyan-400' },
                            { action: 'weapon2' as keyof Keybindings, label: 'Energy Sword', color: 'text-purple-400' },
                          ]).map(({ action, label, color }) => (
                            <div key={action} className="flex items-center gap-2.5">
                              <button
                                onClick={() => setRebindingAction(rebindingAction === action ? null : action)}
                                className={`min-w-[3rem] h-7 rounded flex items-center justify-center font-mono font-bold text-xs border cursor-pointer transition-all select-none ${
                                  rebindingAction === action
                                    ? 'bg-amber-500/20 border-amber-500/60 text-amber-400 animate-pulse shadow-[0_0_12px_rgba(245,158,11,0.3)]'
                                    : `bg-black/50 border-white/20 ${color} hover:border-[#38bdf8]/50 hover:bg-[#38bdf8]/10`
                                }`}
                              >
                                {rebindingAction === action ? '...' : (
                                  keybindings[action] === ' ' ? 'SPACE' : keybindings[action].toUpperCase()
                                )}
                              </button>
                              <span className="text-white/60 text-xs font-medium">{label}</span>
                            </div>
                          ))}
                          <div className="flex items-center gap-2.5 col-span-2 border-t border-white/5 pt-2.5 mt-1">
                            <span className="text-amber-400 font-mono text-[10px] uppercase tracking-widest mr-1.5">Switch:</span>
                            <span className="text-white/70 text-xs">Use <kbd className="bg-black/30 px-1.5 py-0.5 border border-white/10 rounded font-bold text-xs">SCROLL WHEEL</kbd> to cycle weapons</span>
                          </div>
                        </div>
                      </div>

                      {/* Combat Controls */}
                      <div className="bg-white/5 border border-white/5 rounded-lg p-4">
                        <p className="text-xs font-bold text-[#38bdf8] uppercase tracking-wider mb-3">Combat Techniques</p>
                        <div className="flex flex-col gap-3">
                          <div className="flex items-start gap-3 text-white/70">
                            <button
                              onClick={() => setRebindingAction(rebindingAction === 'attack' ? null : 'attack')}
                              className={`min-w-[3rem] h-7 rounded flex items-center justify-center font-mono font-black text-[10px] border cursor-pointer transition-all select-none shrink-0 ${
                                rebindingAction === 'attack'
                                  ? 'bg-amber-500/20 border-amber-500/60 text-amber-400 animate-pulse shadow-[0_0_12px_rgba(245,158,11,0.3)]'
                                  : 'bg-cyan-950/40 border-cyan-500/30 text-cyan-400 hover:border-cyan-400/60 hover:bg-cyan-500/15'
                              }`}
                            >
                              {rebindingAction === 'attack' ? '...' : keybindings.attack.toUpperCase()}
                            </button>
                            <div>
                              <p className="text-xs text-white/90 font-bold"><strong className="text-cyan-400">Grav Slam</strong> (With Hammer) / <strong className="text-red-400">Assault Lunge</strong> (Sword)</p>
                              <p className="text-[11px] text-white/55 leading-normal">Primary attack — context-sensitive by equipped weapon.</p>
                            </div>
                          </div>

                          <div className="flex items-start gap-3 text-white/70 border-t border-white/5 pt-2.5">
                            <button
                              onClick={() => setRebindingAction(rebindingAction === 'altAttack' ? null : 'altAttack')}
                              className={`min-w-[3rem] h-7 rounded flex items-center justify-center font-mono font-black text-[10px] border cursor-pointer transition-all select-none shrink-0 ${
                                rebindingAction === 'altAttack'
                                  ? 'bg-amber-500/20 border-amber-500/60 text-amber-400 animate-pulse shadow-[0_0_12px_rgba(245,158,11,0.3)]'
                                  : 'bg-purple-950/40 border-purple-500/30 text-purple-400 hover:border-purple-400/60 hover:bg-purple-500/15'
                              }`}
                            >
                              {rebindingAction === 'altAttack' ? '...' : keybindings.altAttack.toUpperCase()}
                            </button>
                            <div>
                              <p className="text-xs text-white/90 font-bold"><strong className="text-purple-400">Quick Slash</strong> (With Sword)</p>
                              <p className="text-[11px] text-white/55 leading-normal">Swift front slash for immediate counter attacks.</p>
                            </div>
                          </div>

                          {/* Special Combo */}
                          <div className="flex items-center gap-2.5 border-t border-amber-500/10 bg-amber-500/5 p-2.5 rounded mt-1">
                            <span className="text-amber-500 text-xs font-bold select-none">Combo:</span>
                            <span className="text-white/80 text-[11px] leading-relaxed">
                              <strong>Hammer Jump</strong>: {keybindings.attack.toUpperCase()} then immediately press <kbd className="bg-black/30 px-1.5 py-0.5 font-bold rounded text-[10px]">{keybindings.jump === ' ' ? 'SPACE' : keybindings.jump.toUpperCase()}</kbd> to launch high!
                            </span>
                          </div>
                        </div>
                      </div>

                      {/* Mouse Diagram */}
                      <div className="bg-white/5 border border-white/5 rounded-lg p-4">
                        <p className="text-xs font-bold text-[#38bdf8] uppercase tracking-wider mb-3">Mouse Controls</p>
                        <div className="flex items-center justify-center gap-6">
                          <div className="relative w-20 h-28 flex flex-col rounded-[2rem] border-2 border-white/15 bg-black/40 overflow-hidden select-none">
                            {/* Left Button */}
                            <div className={`flex-1 flex items-center justify-center border-b border-r border-white/10 text-[9px] font-mono font-black uppercase tracking-wider transition-colors ${
                              keybindings.attack === 'lmb' ? 'bg-cyan-500/15 text-cyan-400' : 'bg-white/5 text-white/30'
                            }`}>
                              {keybindings.attack === 'lmb' ? 'ATK' : ''}
                            </div>
                            {/* Right Button */}
                            <div className={`flex-1 flex items-center justify-center border-b border-l border-white/10 text-[9px] font-mono font-black uppercase tracking-wider transition-colors absolute top-0 right-0 w-1/2 h-1/2 ${
                              keybindings.altAttack === 'rmb' ? 'bg-purple-500/15 text-purple-400' : 'bg-white/5 text-white/30'
                            }`}>
                              {keybindings.altAttack === 'rmb' ? 'ALT' : ''}
                            </div>
                            {/* Scroll Wheel */}
                            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-3 h-5 bg-white/10 rounded-full border border-white/20" />
                            {/* Body */}
                            <div className="flex-1" />
                          </div>
                          <div className="flex flex-col gap-1.5 text-[11px] text-white/60">
                            <div className="flex items-center gap-1.5">
                              <span className="w-2 h-2 rounded-full bg-cyan-500/60" />
                              <span>Left Click — <span className="text-cyan-400 font-bold">Attack</span></span>
                            </div>
                            <div className="flex items-center gap-1.5">
                              <span className="w-2 h-2 rounded-full bg-purple-500/60" />
                              <span>Right Click — <span className="text-purple-400 font-bold">Alt Attack</span></span>
                            </div>
                            <div className="flex items-center gap-1.5">
                              <span className="w-2 h-2 rounded-full bg-amber-500/60" />
                              <span>Scroll Wheel — <span className="text-amber-400 font-bold">Swap Weapon</span></span>
                            </div>
                            <div className="flex items-center gap-1.5">
                              <span className="w-2 h-2 rounded-full bg-white/30" />
                              <span>Mouse Move — <span className="text-white/80 font-bold">Aim / Look</span></span>
                            </div>
                          </div>
                        </div>
                      </div>

                      </div>{/* end hidden legacy */}
                    </div>
                  </div>
                )}

                {rightPanelTab === 'gamepad' && renderVisualGamepadMapper()}

                {rightPanelTab === 'customize' && (
                  <div className="flex-grow flex flex-col min-h-0 overflow-y-auto pr-1 justify-between gap-4">
                    {isPainting ? (
                      <CharacterPainter
                        loadout={playerLoadout}
                        hue={adminSettings.playerHue ?? 200}
                        onSave={(paint) => {
                          setPlayerLoadout(prev => {
                            const next = { ...prev, paintJob: paint };
                            try { localStorage.setItem('grifball_player_loadout', JSON.stringify(next)); } catch {}
                            return next;
                          });
                          setIsPainting(false);
                        }}
                        onCancel={() => setIsPainting(false)}
                      />
                    ) : (
                      <>
                        <div className="flex flex-col gap-4">
                          {/* Rotating 3D character */}
                          <div className="relative bg-slate-950/30 border border-white/5 rounded-xl select-none overflow-hidden h-[380px] shrink-0">
                            <CharacterPreview hue={adminSettings.playerHue ?? 200} heldWeapon={customizerWeapon} loadout={playerLoadout} />
                          </div>

                          {/* Start Paint Job Button */}
                          <button
                            onClick={() => setIsPainting(true)}
                            className="w-full py-2.5 bg-gradient-to-r from-cyan-500/15 to-blue-500/15 border border-cyan-500/35 hover:border-cyan-400 text-cyan-400 font-black uppercase tracking-widest rounded-lg shadow-lg hover:shadow-cyan-400/10 hover:bg-cyan-500/20 transition-all active:scale-[0.98] cursor-pointer text-center text-xs mt-1"
                          >
                            🖌️ Start Paint Job
                          </button>

                          {/* Controls grid */}
                          <div className="flex flex-col gap-3 font-sans text-xs">
                            
                            {/* Interactive HSL slider */}
                            <div className="bg-white/5 border border-white/5 rounded-lg p-3">
                              <div className="flex justify-between items-center mb-2">
                                <span className="text-xs font-bold text-[#38bdf8] uppercase tracking-wider">Armor Color Hue angle</span>
                                <span 
                                  className="font-mono text-xs font-black uppercase px-2 py-0.5 rounded border shadow"
                                  style={{ 
                                    color: `hsl(${adminSettings.playerHue}, 100%, 65%)`,
                                    backgroundColor: `hsl(${adminSettings.playerHue}, 90%, 12%)`,
                                    borderColor: `hsl(${adminSettings.playerHue}, 50%, 30%)`
                                  }}
                                >
                                  {adminSettings.playerHue}°
                                </span>
                              </div>
                              <input
                                type="range"
                                min="0"
                                max="360"
                                value={adminSettings.playerHue ?? 200}
                                onChange={(e) => {
                                  const newHue = parseInt(e.target.value, 10);
                                  setAdminSettings(prev => ({ ...prev, playerHue: newHue }));
                                  try {
                                    localStorage.setItem('grifball_player_hue', newHue.toString());
                                  } catch (err) {
                                    console.error(err);
                                  }
                                }}
                                className="w-full h-2.5 bg-gradient-to-r from-red-500 via-yellow-500 via-green-500 via-cyan-500 via-blue-500 via-purple-500 to-red-500 rounded-lg appearance-none cursor-pointer outline-none shadow-inner"
                                style={{ WebkitAppearance: 'none' }}
                              />
                            </div>

                            {/* Presets */}
                            <div className="bg-white/5 border border-white/5 rounded-lg p-3">
                              <span className="text-xs font-bold text-[#38bdf8] uppercase tracking-wider block mb-2">Color presets Swatches</span>
                              <div className="flex flex-wrap gap-2 justify-between">
                                {[
                                  { name: 'Red', hue: 0, bg: 'bg-[#ef4444]' },
                                  { name: 'Orange', hue: 20, bg: 'bg-[#f97316]' },
                                  { name: 'Gold', hue: 45, bg: 'bg-[#fbbf24]' },
                                  { name: 'Green', hue: 120, bg: 'bg-[#22c55e]' },
                                  { name: 'Cyan', hue: 180, bg: 'bg-[#06b6d4]' },
                                  { name: 'Blue', hue: 200, bg: 'bg-[#3b82f6]' },
                                  { name: 'Purple', hue: 270, bg: 'bg-[#a855f7]' },
                                  { name: 'Magenta', hue: 300, bg: 'bg-[#d946ef]' },
                                  { name: 'Pink', hue: 330, bg: 'bg-[#ec4899]' },
                                ].map((p) => (
                                  <button
                                    key={p.name}
                                    onClick={() => {
                                      setAdminSettings(prev => ({ ...prev, playerHue: p.hue }));
                                      try {
                                        localStorage.setItem('grifball_player_hue', p.hue.toString());
                                      } catch (err) {
                                        console.error(err);
                                      }
                                    }}
                                    title={p.name}
                                    className={`w-6 h-6 rounded-full cursor-pointer transition-all active:scale-90 relative ${p.bg} ${
                                      adminSettings.playerHue === p.hue 
                                        ? 'ring-1 ring-white ring-offset-2 ring-offset-slate-950 scale-110 shadow-lg' 
                                        : 'hover:scale-105 hover:opacity-90'
                                    }`}
                                  />
                                ))}
                              </div>
                            </div>

                            {/* Held Weapon Selection */}
                            <div className="bg-white/5 border border-white/5 rounded-lg p-3">
                              <span className="text-xs font-bold text-[#38bdf8] uppercase tracking-wider block mb-2">Pose Weapon preview</span>
                              <div className="grid grid-cols-3 gap-2">
                                {[
                                  { id: 'none', label: '🛡️ Fists' },
                                  { id: 'hammer', label: '🔨 Hammer' },
                                  { id: 'sword', label: '⚔️ Sword' },
                                ].map((w) => (
                                  <button
                                    key={w.id}
                                    onClick={() => setCustomizerWeapon(w.id as any)}
                                    className={`py-2 text-xs font-bold uppercase tracking-wider border rounded cursor-pointer transition-all active:scale-98 ${
                                      customizerWeapon === w.id
                                        ? 'bg-[#38bdf8]/15 border-[#38bdf8] text-[#38bdf8] shadow-[0_0_10px_rgba(56,189,248,0.2)] font-black'
                                        : 'bg-black/30 border-white/10 text-white/50 hover:text-white hover:border-white/20'
                                    }`}
                                  >
                                    {w.label}
                                  </button>
                                ))}
                              </div>
                            </div>

                            {/* Armor Loadout Selector */}
                            {(() => {
                              const updateLoadout = (patch: Partial<CharacterLoadout>) => {
                                setPlayerLoadout(prev => {
                                  const next = { ...prev, ...patch };
                                  try { localStorage.setItem('grifball_player_loadout', JSON.stringify(next)); } catch {}
                                  return next;
                                });
                              };
                              const slotLabel: Record<string, string> = {
                                helmet: 'Helmet',
                                torso: 'Chest',
                                arm: 'Arms',
                                leg: 'Legs',
                                hammerPreset: 'Hammer',
                                swordPreset: 'Sword',
                              };
                              const presetLabel: Record<string, string> = {
                                'mark-vi': 'Mk.VI',
                                'odst': 'ODST',
                                'recon': 'Recon',
                                'eva': 'EVA',
                                'gungnir': 'Gungnir',
                                'scout': 'Scout',
                                'jump-jet': 'JmpJet',
                                'eod': 'EOD',
                                'hayabusa': 'Hayabusa',
                                'cqb': 'CQB',
                                'default': 'Default',
                                'akelas': 'Akelas',
                                'akelus': 'Akelus',
                                'paegaas': 'Paegaas',
                                'sepulotez': "Sepulo'tez",
                                'halbashi': 'Halbashi',
                                'eektah-fel': 'Eektah-Fel',
                                'gravity-axe': 'Axe',
                                'gravity-mace': 'Mace',
                                'fist-of-rukt': 'Rukt',
                                'halo-ce': 'CE Classic',
                                'halo-2': 'Halo 2',
                                'halo-3': 'Halo 3',
                                'reach': 'Reach',
                                'anniversary': 'CEA',
                                'halo-4': 'Halo 4',
                                'h2a-blue': 'H2A Blue',
                                'h2a-pink': 'H2A Pink',
                                'halo-5': 'Halo 5',
                                'infinite': 'Infinite',
                              };
                              const slots = [
                                { key: 'helmet', options: AVAILABLE_PRESETS.helmet },
                                { key: 'torso',  options: AVAILABLE_PRESETS.torso },
                                { key: 'arm',    options: AVAILABLE_PRESETS.arm },
                                { key: 'leg',    options: AVAILABLE_PRESETS.leg },
                                { key: 'hammerPreset', options: AVAILABLE_PRESETS.hammer },
                                { key: 'swordPreset', options: AVAILABLE_PRESETS.sword },
                              ] as const;
                              return (
                                <div className="bg-white/5 border border-white/5 rounded-lg p-3">
                                  <span className="text-xs font-bold text-[#38bdf8] uppercase tracking-wider block mb-2.5">Armor Loadout</span>
                                  <div className="flex flex-col gap-2">
                                    {slots.map(({ key, options }) => (
                                      <div key={key} className="flex items-center gap-2">
                                        <span className="text-[10px] font-black uppercase tracking-widest text-white/40 w-14 shrink-0">{slotLabel[key]}</span>
                                        <div className="flex flex-wrap gap-1.5 flex-1">
                                          {options.map((opt) => {
                                            const isActive = playerLoadout[key as keyof CharacterLoadout] === opt;
                                            return (
                                              <button
                                                key={opt}
                                                onClick={() => updateLoadout({ [key]: opt } as Partial<CharacterLoadout>)}
                                                className={`px-2 py-1 text-[10px] font-black uppercase tracking-widest border rounded transition-all active:scale-95 ${
                                                  isActive
                                                    ? 'bg-[#38bdf8]/15 border-[#38bdf8] text-[#38bdf8] shadow-[0_0_8px_rgba(56,189,248,0.25)]'
                                                    : 'bg-black/30 border-white/10 text-white/40 hover:text-white/70 hover:border-white/20'
                                                }`}
                                              >
                                                {presetLabel[opt] ?? opt}
                                              </button>
                                            );
                                          })}
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              );
                            })()}

                            {/* Spartan Nickname Handle */}
                            <div className="bg-white/5 border border-white/5 rounded-lg p-3">
                              <span className="text-xs font-bold text-[#38bdf8] uppercase tracking-wider block mb-2">Spartan Nickname Handle</span>
                              <div className="relative">
                                <input
                                  type="text"
                                  maxLength={10}
                                  value={playerName}
                                  onChange={(e) => handlePlayerNameChange(e.target.value)}
                                  placeholder="Max 10 characters..."
                                  className="w-full h-11 bg-black/60 border border-white/10 rounded px-3.5 text-sm tracking-wide text-white focus:border-[#38bdf8] outline-none transition-all font-sans"
                                />
                                <div className="absolute right-3.5 top-1/2 -translate-y-1/2 w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                              </div>
                            </div>

                            {/* Neural Save System Panel */}
                            <div className="bg-white/5 border border-white/5 rounded-lg p-3 flex flex-col gap-2.5">
                              <div className="flex justify-between items-center border-b border-white/5 pb-2">
                                <span className="text-xs font-bold text-[#38bdf8] uppercase tracking-wider flex items-center gap-1.5">
                                  💾 Neural Backup System
                                </span>
                                <span className="text-[10px] font-mono text-emerald-400 bg-emerald-950/40 border border-emerald-500/20 px-2 py-0.5 rounded flex items-center gap-1.5 shrink-0 select-none animate-pulse">
                                  <span className="w-1.5 h-1.5 bg-emerald-400 rounded-full inline-block" />
                                  LOCAL_COOKIE_ACTIVE
                                </span>
                              </div>
                              
                              <p className="text-xs text-white/50 leading-normal">
                                All configs, layouts, colors, and Spartan handles are synced locally. Export a decryption code to share or migrate your profile!
                              </p>

                              {saveSystemStatus.type && (
                                <div className={`p-2.5 rounded text-xs font-mono border ${
                                  saveSystemStatus.type === 'success' 
                                    ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400' 
                                    : 'bg-red-500/10 border-red-500/30 text-red-400'
                                }`}>
                                  {saveSystemStatus.type === 'success' ? '⚡ ' : '⚠️ '}
                                  {saveSystemStatus.message}
                                </div>
                              )}

                              <div className="flex gap-2">
                                <button
                                  onClick={handleExportSaveCode}
                                  className="flex-1 py-2 bg-[#38bdf8]/15 hover:bg-[#38bdf8]/30 border border-[#38bdf8]/30 text-[#38bdf8] font-bold text-xs uppercase tracking-wider rounded cursor-pointer transition-all active:scale-[0.98]"
                                >
                                  📋 Export Save Code
                                </button>
                                <button
                                  onClick={handleResetAllSettings}
                                  className="py-2 px-3.5 bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 hover:border-red-500/40 text-red-400 font-bold text-xs uppercase tracking-wider rounded cursor-pointer transition-all active:scale-[0.98]"
                                  title="Wipe client database"
                                >
                                  💥 Wipe Saves
                                </button>
                              </div>

                              <div className="flex flex-col gap-1.5 mt-1 border-t border-white/5 pt-2.5">
                                <span className="text-[10px] text-white/30 uppercase tracking-widest font-mono">Import Cybernetic Code:</span>
                                <div className="flex gap-1.5">
                                  <input
                                    type="text"
                                    value={saveCodeImportInput}
                                    onChange={(e) => setSaveCodeImportInput(e.target.value)}
                                    placeholder="Paste GRIF-DEC- code here..."
                                    className="flex-1 h-10 bg-black/60 border border-white/10 rounded px-3 font-mono text-xs text-white placeholder:text-white/20 focus:border-[#38bdf8] outline-none transition-all"
                                  />
                                  <button
                                    onClick={() => handleImportSaveCode(saveCodeImportInput)}
                                    disabled={!saveCodeImportInput}
                                    className={`px-4 h-10 font-sans font-bold text-xs uppercase tracking-wider rounded transition-all border outline-none ${
                                      saveCodeImportInput
                                        ? 'bg-emerald-500/15 hover:bg-emerald-500/35 border-emerald-500/40 text-emerald-400 cursor-pointer'
                                        : 'bg-white/5 border-white/5 text-white/20 cursor-not-allowed'
                                    }`}
                                  >
                                    Decrypt
                                  </button>
                                </div>
                              </div>
                            </div>

                          </div>
                        </div>
                      </>
                    )}
                  </div>
                )}
                </>
              </div>
              )}

              </div>{/* end 2-column content grid */}

              <button
                type="button"
                className="main-menu-frame-splitter main-menu-frame-splitter-chat"
                aria-label="Resize content and chat frames"
                title="Resize content and chat frames"
                onPointerDown={(e) => handleMainMenuSplitterPointerDown('chat', e)}
              >
                <span />
              </button>

              {/* RIGHT RAIL: GLOBAL CHAT (ALWAYS VISIBLE) */}
              <aside className="mobile-lobby-chat" style={mainMenuChatStyle}>
                <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'rgba(2,6,23,0.45)', border: '1px solid rgba(255,255,255,0.10)', borderRadius: 12, padding: 16, gap: 12, boxShadow: 'inset 0 1px 3px rgba(0,0,0,0.30)', overflow: 'hidden' }}>
                  {/* Chat header */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingBottom: 10, borderBottom: '1px solid rgba(255,255,255,0.05)', gap: 8, flexShrink: 0 }}>
                    <span style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 12, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#38bdf8', whiteSpace: 'nowrap' }}>
                      📡 Global Broadcast
                    </span>
                    <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, fontWeight: 800, color: '#34d399', display: 'inline-flex', alignItems: 'center', gap: 6, letterSpacing: '0.15em', textTransform: 'uppercase' }}>
                      <span style={{ width: 6, height: 6, borderRadius: 9999, background: '#34d399', boxShadow: '0 0 6px #34d399', animation: 'pulse 1.4s infinite' }} />
                      LIVE
                    </span>
                  </div>
                  <PilotIdentitySubframe
                    account={account}
                    playerName={playerName}
                    playerHue={adminSettings.playerHue}
                    onPlayerNameChange={handlePlayerNameChange}
                    onRegistered={handleRegistered}
                    onLoggedIn={handleLoggedIn}
                    onLoggedOut={handleLoggedOut}
                    onAccountChanged={handleAccountChanged}
                  />
                  <PlayerListSubframe
                    onlineClients={onlineClients}
                    clientId={clientId}
                    connectionStatus={connectionStatus}
                    connectionMode={connectionMode}
                    menuSocket={menuSocket}
                    hostIdCode={hostIdCode}
                    onJoinGame={handleJoinGame}
                    setInviteNotifications={setInviteNotifications}
                  />
                  <GlobalChatPanel
                    messages={lobbyChatMessages}
                    onSendMessage={sendLobbyChatMessage}
                  />
                </div>
              </aside>

            </div>{/* end flex layout */}
          </div>
        </div>
      )}

      {/* TERMINATED STATE OVERLAY SCREEN */}
      {isTerminated && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-slate-950/95 backdrop-blur-2xl transition-all duration-300">
          <div className="w-full max-w-sm text-center px-4">
            <div className="w-16 h-16 rounded-full border border-red-500/30 flex items-center justify-center bg-red-950/30 mx-auto mb-6">
              <svg className="w-8 h-8 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </div>
            
            <h2 className="text-3xl font-display font-black uppercase tracking-wider mb-2 text-red-400">
              SIMULATION CLOSED
            </h2>
            <p className="text-sm text-white/60 mb-8 leading-relaxed">
              The Grifball VR Sandbox prototype is offline. You can relaunch the client by clicking the button below.
            </p>

            <button 
              id="reboot-sim-btn"
              onClick={handleStartGame}
              className="px-8 py-3.5 bg-blue-600 rounded text-xs select-none hover:bg-blue-500 active:scale-95 border border-blue-400/30 font-black tracking-widest uppercase transition-all duration-150 cursor-pointer pointer-events-auto"
            >
              Reboot Simulation
            </button>
          </div>
        </div>
      )}

      {/* PAUSE DRAWER MODAL COVER (FROSTED GLASS PANEL OVERLAY) */}
      {isPaused && isPlaying && !showUiAdjustment && !matchResult && (
        <div className="absolute inset-0 z-40 flex items-center justify-center bg-slate-950/80 backdrop-blur-xl transition-all duration-300 p-3">
          {!showAdminPanel && !showLightingMenu && !showKeybindsMenu ? (
            <div className="mobile-modal mobile-pause-modal relative bg-slate-950/80 border border-white/10 backdrop-blur-2xl rounded-2xl p-6 w-[460px] max-w-[calc(100vw-1.5rem)] max-h-[calc(100dvh-1.5rem)] shadow-[0_20px_50px_rgba(0,0,0,0.5)] flex flex-col select-none overflow-hidden animate-in fade-in duration-200">
              {/* Decorative ambient glows */}
              <div className="absolute -top-10 -left-10 w-40 h-40 bg-blue-500/10 rounded-full blur-3xl pointer-events-none" />
              <div className="absolute -bottom-10 -right-10 w-40 h-40 bg-purple-500/10 rounded-full blur-3xl pointer-events-none" />

              {/* Logo header */}
              <div className="mobile-pause-header text-center mb-5 border-b border-white/10 pb-4 w-full relative z-10 shrink-0">
                <p className="text-[10px] text-blue-400 font-black tracking-[0.3em] uppercase mb-1 font-display">SIMULATION PAUSED</p>
                <h3 className="text-3xl font-sans font-black tracking-tighter italic uppercase text-transparent bg-clip-text bg-gradient-to-r from-white via-slate-100 to-slate-400">
                  GRIFVX PROTO
                </h3>
              </div>
 
              {/* Primary Pause utility actions */}
              <div className="mobile-pause-scroll w-full flex flex-col gap-4 pointer-events-auto relative z-10 min-h-0 overflow-y-auto overscroll-contain pr-1">
                <button 
                  id="resume-btn"
                  onClick={handleResumeGame}
                  className="w-full h-12 bg-gradient-to-r from-blue-500 to-cyan-500 hover:from-blue-600 hover:to-cyan-600 text-white font-black text-xs uppercase tracking-widest active:scale-[0.98] transition-all duration-200 cursor-pointer rounded-lg shadow-[0_4px_20px_rgba(6,182,212,0.25)] hover:shadow-[0_4px_25px_rgba(6,182,212,0.4)] flex items-center justify-center gap-2 border border-cyan-400/30"
                >
                  <svg className="w-4 h-4 fill-current" viewBox="0 0 24 24">
                    <path d="M8 5v14l11-7z" />
                  </svg>
                  Resume Game
                </button>

                {/* Match Operations Section */}
                <div className="w-full mt-2 flex flex-col gap-2">
                  <div className="flex items-center gap-2 w-full">
                    <span className="text-[10px] font-bold text-slate-500 tracking-wider uppercase font-mono">Match Operations</span>
                    <div className="h-[1px] bg-slate-800/80 flex-1" />
                  </div>
                  <div className="grid grid-cols-2 gap-2 w-full">
                    {multiplayerRole === 'observer' ? (
                      <button 
                        id="join-player-btn"
                        onClick={handleJoinPlayer}
                        className="h-10 bg-emerald-950/40 hover:bg-emerald-900/50 border border-emerald-500/30 text-emerald-400 hover:text-emerald-200 font-bold text-xs uppercase tracking-wide transition-all duration-150 cursor-pointer rounded-lg flex items-center justify-center gap-1.5"
                      >
                        🚀 Join As Player
                      </button>
                    ) : (
                      <button 
                        id="join-observer-btn"
                        onClick={handleJoinObserver}
                        className="h-10 bg-amber-950/40 hover:bg-amber-900/50 border border-amber-500/30 text-amber-400 hover:text-amber-200 font-bold text-xs uppercase tracking-wide transition-all duration-150 cursor-pointer rounded-lg flex items-center justify-center gap-1.5"
                      >
                        👁️ Join Observer
                      </button>
                    )}

                    <button 
                      id="reset-match-btn"
                      onClick={handleResetMatch}
                      className="h-10 bg-slate-900/40 hover:bg-slate-800/60 border border-slate-700/40 text-slate-300 hover:text-white font-bold text-xs uppercase tracking-wide transition-all duration-150 cursor-pointer rounded-lg flex items-center justify-center gap-1.5"
                    >
                      🔄 Reset Match
                    </button>
                  </div>

                  {!isMultiplayer && (
                    <button 
                      id="bot-config-btn"
                      onClick={() => setShowBotSetupMenu(true)}
                      className="w-full h-10 bg-blue-950/40 hover:bg-blue-900/50 border border-blue-500/30 text-blue-400 hover:text-blue-200 font-bold text-xs uppercase tracking-wide transition-all duration-150 cursor-pointer rounded-lg flex items-center justify-center gap-1.5"
                    >
                      🤖 Bot Configuration
                    </button>
                  )}
                </div>

                {/* Adjustments & Options Section */}
                <div className="w-full mt-2 flex flex-col gap-2">
                  <div className="flex items-center gap-2 w-full">
                    <span className="text-[10px] font-bold text-slate-500 tracking-wider uppercase font-mono">Adjustments & Options</span>
                    <div className="h-[1px] bg-slate-800/80 flex-1" />
                  </div>
                  <div className="grid grid-cols-2 gap-2.5 w-full">
                    {/* HOTKEY ADJUSTMENTS */}
                    <button
                      id="keybinds-btn"
                      onClick={() => setShowKeybindsMenu(true)}
                      className="group flex items-center gap-2.5 p-2.5 bg-slate-950/20 hover:bg-cyan-950/10 border border-white/5 hover:border-cyan-500/40 transition-all duration-150 cursor-pointer rounded-xl text-left pointer-events-auto active:scale-[0.98]"
                    >
                      <div className="w-8 h-8 rounded-lg bg-cyan-950/50 border border-cyan-500/30 flex items-center justify-center shrink-0">
                        <svg className="w-4.5 h-4.5 text-cyan-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" d="M3 10h18M7 15h1m4 0h1m-7 4h12a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                        </svg>
                      </div>
                      <span className="font-bold text-xs text-cyan-400 group-hover:text-cyan-200 tracking-wide uppercase leading-tight select-none">
                        Hotkey Adjustments
                      </span>
                    </button>

                    {/* UI ADJUSTMENT */}
                    <button
                      id="ui-adjustment-btn"
                      onClick={() => setShowUiAdjustment(true)}
                      className="group flex items-center gap-2.5 p-2.5 bg-slate-950/20 hover:bg-cyan-950/10 border border-white/5 hover:border-cyan-500/40 transition-all duration-150 cursor-pointer rounded-xl text-left pointer-events-auto active:scale-[0.98]"
                    >
                      <div className="w-8 h-8 rounded-lg bg-cyan-950/50 border border-cyan-500/30 flex items-center justify-center shrink-0">
                        <svg className="w-4.5 h-4.5 text-cyan-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" d="M4 5a1 1 0 011-1h14a1 1 0 011 1v2a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM4 13a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H5a1 1 0 01-1-1v-6zM16 13a1 1 0 011-1h2a1 1 0 011 1v6a1 1 0 01-1 1h-2a1 1 0 01-1-1v-6z" />
                        </svg>
                      </div>
                      <span className="font-bold text-xs text-cyan-400 group-hover:text-cyan-200 tracking-wide uppercase leading-tight select-none">
                        UI Adjustment
                      </span>
                    </button>

                    {/* LIGHTING & SHADOWS */}
                    <button 
                      id="lighting-controls-btn"
                      onClick={() => setShowLightingMenu(true)}
                      className="group flex items-center gap-2.5 p-2.5 bg-slate-950/20 hover:bg-amber-950/10 border border-white/5 hover:border-amber-500/40 transition-all duration-150 cursor-pointer rounded-xl text-left pointer-events-auto active:scale-[0.98]"
                    >
                      <div className="w-8 h-8 rounded-lg bg-amber-950/50 border border-amber-500/30 flex items-center justify-center shrink-0">
                        <svg className="w-4.5 h-4.5 text-amber-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364-6.364l-.707.707M6.343 17.657l-.707.707m0-11.314l.707.707m11.314 11.314l.707-.707M12 17a5 5 0 100-10 5 5 0 000 10z" />
                        </svg>
                      </div>
                      <span className="font-bold text-xs text-amber-400 group-hover:text-amber-200 tracking-wide uppercase leading-tight select-none">
                        Lighting & Shadows
                      </span>
                    </button>

                    {/* GAMEPLAY / MECHANICS OPTIONS */}
                    <button 
                      id="admin-controls-btn"
                      onClick={() => setShowAdminPanel(true)}
                      className="group flex items-center gap-2.5 p-2.5 bg-slate-950/20 hover:bg-blue-950/10 border border-white/5 hover:border-blue-500/40 transition-all duration-150 cursor-pointer rounded-xl text-left pointer-events-auto active:scale-[0.98]"
                    >
                      <div className="w-8 h-8 rounded-lg bg-blue-950/50 border border-blue-500/30 flex items-center justify-center shrink-0">
                        <svg className="w-4.5 h-4.5 text-blue-400 animate-spin-slow" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                        </svg>
                      </div>
                      <span className="font-bold text-[10px] text-blue-400 group-hover:text-blue-300 tracking-wide uppercase leading-none select-none">
                        Gameplay / Mechanics Options
                      </span>
                    </button>
                  </div>
                </div>

                {/* System & Dev Section */}
                <div className="w-full mt-2 flex flex-col gap-2">
                  <div className="flex items-center gap-2 w-full">
                    <span className="text-[10px] font-bold text-slate-500 tracking-wider uppercase font-mono">System & Dev</span>
                    <div className="h-[1px] bg-slate-800/85 flex-1" />
                  </div>
                  
                  {/* Damage Traces Toggle */}
                  <button 
                    id="toggle-debug-btn"
                    onClick={toggleDebugMode}
                    className={`w-full h-10 border rounded-lg font-bold text-xs uppercase tracking-widest transition-all duration-150 cursor-pointer flex items-center justify-between px-4 pointer-events-auto ${
                      debugMode 
                        ? 'bg-red-500/10 border-red-500/40 text-red-400 hover:bg-red-500/20' 
                        : 'bg-slate-950/20 border-white/5 text-white/50 hover:bg-white/5'
                    }`}
                  >
                    <span className="select-none">Damage Traces</span>
                    <div className="flex items-center gap-2">
                      <span className={`text-[10px] font-mono font-bold ${debugMode ? 'text-red-400' : 'text-white/30'}`}>
                        {debugMode ? 'ENABLED' : 'DISABLED'}
                      </span>
                      <div className={`w-3.5 h-3.5 rounded flex items-center justify-center border transition-all ${
                        debugMode ? 'bg-red-500 border-red-400 shadow-[0_0_8px_rgba(239,68,68,0.5)]' : 'bg-transparent border-white/20'
                      }`} />
                    </div>
                  </button>

                  <button 
                    id="quit-btn"
                    onClick={selectedReplay ? () => {
                      setIsPlaying(false);
                      setSelectedReplay(null);
                      setIsPaused(false);
                    } : handleReturnToMain}
                    className="w-full h-10 bg-red-950/20 border border-red-500/20 hover:bg-red-950/40 hover:border-red-500/40 text-red-400 font-bold text-xs uppercase tracking-widest transition-all duration-150 cursor-pointer rounded-lg mt-1 pointer-events-auto active:scale-[0.98]"
                  >
                    {selectedReplay ? "Exit Replay" : "Quit to Title Screen"}
                  </button>
                </div>
              </div>

              {/* Tiny escape instructions */}
              <p className="mobile-pause-footer mt-5 text-[9px] text-white/40 tracking-wider text-center relative z-10 shrink-0">
                Press <span className="font-mono text-[10px] text-blue-400 font-bold">ESC</span> inside game window to pause/unpause
              </p>
            </div>
          ) : showAdminPanel ? (
            /* GAMEPLAY/MECHANICS OPTIONS MULTIPANEL DENSE DASHBOARD */
            <div className="mobile-modal bg-slate-950/95 border border-white/10 backdrop-blur-2xl rounded-2xl p-5 w-full max-w-[940px] xl:max-w-[1240px] 2xl:max-w-[1560px] shadow-2xl flex flex-col select-none max-h-[calc(100dvh-1.5rem)] overflow-y-auto overflow-x-hidden animate-in fade-in duration-200">
              {/* Header */}
              <div className="flex items-center justify-between mb-4 border-b border-white/5 pb-3">
                <div className="flex flex-col items-start text-left">
                  <p className="text-[9px] text-[#38bdf8] font-bold tracking-[0.3em] uppercase mb-0.5 font-display">SYSTEM OVERRIDE</p>
                  <h3 className="text-xl font-sans font-black tracking-tight uppercase text-white">
                    Gameplay / Mechanics Options
                  </h3>
                </div>
                <div className="text-[10px] text-white/50 bg-white/5 px-2.5 py-1 rounded-full border border-white/10 font-mono">
                  Press ESC to close
                </div>
              </div>

              {/* Gameplay Presets Bar */}
              <div className="mb-4 pointer-events-auto border border-white/10 rounded-xl p-3 bg-white/[0.02] backdrop-blur-md flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3 text-left">
                <div className="flex flex-col min-w-[200px]">
                  <span className="text-[10px] text-[#38bdf8] font-bold uppercase tracking-widest font-mono flex items-center gap-1.5 animate-pulse">
                    🎛️ Gameplay Presets
                  </span>
                  <span className="text-[9px] text-white/40">Load, save, or manage your custom rulesets</span>
                </div>
                
                <div className="flex flex-1 flex-col sm:flex-row items-stretch sm:items-center gap-2">
                  {/* Select Dropdown */}
                  <div className="flex-1 min-w-[200px]">
                    <select
                      value={selectedPresetName}
                      onChange={(e) => handleSelectPreset(e.target.value)}
                      className="w-full h-9 bg-black/60 border border-white/10 rounded px-2.5 text-xs text-[#38bdf8] font-bold uppercase outline-none focus:border-[#38bdf8] cursor-pointer transition-all font-sans"
                    >
                      <option value="" disabled={!selectedPresetName}>
                        {gameplayPresets.length === 0
                          ? '📁 No Presets Saved'
                          : selectedPresetName
                            ? '⚙️ Custom/Modified Config'
                            : '📁 Select a Saved Preset...'}
                      </option>
                      {multiplayerPreset && (
                        <option value={OFFICIAL_MP_PRESET_NAME}>
                          {OFFICIAL_MP_PRESET_NAME.toUpperCase()} (READ-ONLY{multiplayerPreset.version ? ` · V${multiplayerPreset.version}` : ''})
                        </option>
                      )}
                      {gameplayPresets.map((preset) => (
                        <option key={preset.name} value={preset.name}>
                          📦 {preset.name.toUpperCase()}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Save Preset Input & Button */}
                  <div className="flex items-center gap-1.5 flex-1 max-w-sm">
                    <input
                      type="text"
                      placeholder="Preset name..."
                      value={newPresetNameInput}
                      onChange={(e) => setNewPresetNameInput(e.target.value)}
                      className="flex-1 h-9 bg-black/60 border border-white/10 rounded px-3 text-xs text-white placeholder:text-white/30 focus:border-[#38bdf8]/50 outline-none transition-all"
                      maxLength={20}
                    />
                    <button
                      onClick={() => handleSavePreset(newPresetNameInput)}
                      disabled={!newPresetNameInput.trim()}
                      className={`h-9 px-3 rounded text-xs font-sans font-bold uppercase tracking-wider transition-all flex items-center justify-center gap-1 shrink-0 ${
                        newPresetNameInput.trim()
                          ? 'bg-emerald-500/15 hover:bg-emerald-500/35 border border-emerald-500/40 text-emerald-400 cursor-pointer active:scale-95'
                          : 'bg-white/5 border border-white/5 text-white/20 cursor-not-allowed'
                      }`}
                    >
                      Save
                    </button>
                  </div>

                  {/* Read-only indicator for the official preset */}
                  {selectedPresetName === OFFICIAL_MP_PRESET_NAME && (
                    <span className="h-9 px-3 bg-amber-500/10 border border-amber-500/30 text-amber-300 font-bold text-[10px] uppercase tracking-wider rounded flex items-center justify-center gap-1 shrink-0">
                      🔒 Read-only · forced in multiplayer
                    </span>
                  )}

                  {/* Delete Button (not available for the server-managed official preset) */}
                  {selectedPresetName && selectedPresetName !== OFFICIAL_MP_PRESET_NAME && (
                    <button
                      onClick={() => handleDeletePreset(selectedPresetName)}
                      className="h-9 px-3 bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 hover:border-red-500/40 text-red-400 font-bold text-xs uppercase tracking-wider rounded cursor-pointer transition-all active:scale-[0.98] flex items-center justify-center gap-1 animate-fade-in"
                      title={`Delete "${selectedPresetName}" preset`}
                    >
                      Delete
                    </button>
                  )}
                </div>
              </div>

              {/* Apply and return */}
              <button
                id="apply-admin-btn"
                onClick={() => setShowAdminPanel(false)}
                className="w-full h-11 mb-4 bg-white hover:bg-sky-400 hover:text-white text-slate-900 text-xs font-black uppercase tracking-widest rounded cursor-pointer transition-colors active:scale-98 flex items-center justify-center gap-2 shadow-lg pointer-events-auto"
              >
                <Check className="w-4 h-4" />
                Apply Changes & Resume Sandbox
              </button>

              {/* 3-Column Dense Settings Grid */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pointer-events-auto text-left">
                {/* COLUMN 1: LOCOMOTION, ACTIONS & HEALTH */}
                <div className="flex flex-col gap-3">
                  {SETTING_SECTIONS.filter(s => s.column === 1 && s.id !== 'ai' && s.id !== 'aitune').map(renderSection)}
                </div>

                {/* COLUMN 2: GRAVITY HAMMER & JUMPING */}
                <div className="flex flex-col gap-3">
                  {SETTING_SECTIONS.filter(s => s.column === 2 && s.id !== 'ai' && s.id !== 'aitune').map(renderSection)}
                </div>

                {/* COLUMN 3: ENERGY SWORD & TRADING CONFIGS */}
                <div className="flex flex-col gap-3">
                  {SETTING_SECTIONS.filter(s => s.column === 3 && s.id !== 'ai' && s.id !== 'aitune').map(renderSection)}
                </div>
              </div>
            </div>
          ) : showKeybindsMenu ? (
            /* HOTKEY ADJUSTMENTS SETTINGS PANEL */
            <div className={`mobile-modal mobile-keybind-modal bg-slate-950/95 border border-white/10 backdrop-blur-2xl rounded-2xl p-6 max-w-[95vw] shadow-2xl flex flex-col select-none max-h-[95vh] overflow-y-auto transition-all duration-300 ${
              keybindsModalTab === 'gamepad' ? 'w-[1040px]' : 'w-[640px]'
            }`}>
              {/* Header */}
              <div className="flex items-center justify-between mb-5 border-b border-white/5 pb-4 shrink-0">
                <div className="flex flex-col items-start text-left">
                  <p className="text-[9px] text-cyan-400 font-bold tracking-[0.3em] uppercase mb-0.5 font-display">INPUT CONFIG</p>
                  <h3 className="text-xl font-sans font-black tracking-tight uppercase text-white">⌨ Hotkey Adjustments</h3>
                </div>
                <div className="flex items-center gap-3 pointer-events-auto">
                  <div className="hidden sm:block text-[10px] text-white/50 bg-white/5 px-2.5 py-1 rounded-full border border-white/10 font-mono">
                    Press ESC to close
                  </div>
                  <button
                    onClick={() => { setShowKeybindsMenu(false); setRebindingAction(null); }}
                    className="h-9 px-4 bg-white hover:bg-cyan-400 hover:text-white text-slate-900 text-xs font-black uppercase tracking-widest rounded-lg cursor-pointer transition-all active:scale-[0.98] flex items-center justify-center gap-1.5 shadow-lg"
                  >
                    <Check className="w-3.5 h-3.5" />
                    Save & Return
                  </button>
                </div>
              </div>

              {/* Tab Switcher */}
              <div className="flex border-b border-white/10 mb-5 gap-2 pointer-events-auto shrink-0">
                <button
                  onClick={() => { setKeybindsModalTab('keyboard'); setRebindingAction(null); }}
                  className={`flex-1 py-2 text-xs font-black uppercase tracking-wider transition-all duration-150 border-b-2 flex items-center justify-center gap-2 cursor-pointer ${
                    keybindsModalTab === 'keyboard'
                      ? 'border-cyan-400 text-cyan-400 bg-cyan-950/20'
                      : 'border-transparent text-white/50 hover:text-white/80 hover:bg-white/[0.02]'
                  }`}
                >
                  ⌨ Keyboard & Mouse
                </button>
                <button
                  onClick={() => { setKeybindsModalTab('gamepad'); setRebindingAction(null); }}
                  className={`flex-1 py-2 text-xs font-black uppercase tracking-wider transition-all duration-150 border-b-2 flex items-center justify-center gap-2 cursor-pointer ${
                    keybindsModalTab === 'gamepad'
                      ? 'border-cyan-400 text-cyan-400 bg-cyan-950/20'
                      : 'border-transparent text-white/50 hover:text-white/80 hover:bg-white/[0.02]'
                  }`}
                >
                  🎮 Gamepad Controller
                </button>
              </div>

              {keybindsModalTab === 'keyboard' ? (
                <>
                  {/* Keyboard visualizer */}
                  <CompactKeybindList
                    bindings={keybindings}
                    rebinding={rebindingAction}
                    onPick={(action) => setRebindingAction(prev => prev === action ? null : action)}
                  />
                  <div className="pointer-events-auto mb-5">
                    <div className="desktop-keyboard-visualizer">
                      <KeyboardVisualizer
                        bindings={keybindings}
                        rebinding={rebindingAction}
                        onPick={(action) => setRebindingAction(prev => prev === action ? null : action)}
                      />
                    </div>
                  </div>

                  {/* Mouse settings */}
                  <div className="pointer-events-auto border border-white/10 rounded-xl p-4 bg-white/[0.02] flex flex-col gap-4 mb-5">
                    <p className="text-[10px] text-cyan-400 font-bold uppercase tracking-widest border-b border-white/5 pb-2 font-mono">🖱 Mouse Settings</p>

                    {/* Sensitivity */}
                    <div className="flex flex-col gap-1.5">
                      <div className="flex justify-between text-[11px] font-bold uppercase tracking-wider text-white/80">
                        <span>Sensitivity</span>
                        <span className="text-cyan-400 font-mono">{(keybindings.mouseSensitivity ?? 1.0).toFixed(1)}x</span>
                      </div>
                      <input type="range" min="0.1" max="5.0" step="0.1"
                        value={keybindings.mouseSensitivity ?? 1.0}
                        onChange={(e) => {
                          const v = parseFloat(e.target.value);
                          setKeybindings(prev => {
                            const updated = { ...prev, mouseSensitivity: v };
                            try { localStorage.setItem('grifball_keybindings', JSON.stringify(updated)); } catch (_) {}
                            return updated;
                          });
                        }}
                        className="w-full accent-cyan-400 h-1 bg-white/10 rounded-lg appearance-none cursor-pointer"
                      />
                      <span className="text-[9px] text-white/35 font-mono">0.1 (slow) — 5.0 (fast). Default: 1.0</span>
                    </div>

                    {/* Acceleration */}
                    <div className="flex flex-col gap-1.5">
                      <div className="flex justify-between text-[11px] font-bold uppercase tracking-wider text-white/80">
                        <span>Acceleration</span>
                        <span className={`font-mono ${(keybindings.mouseAcceleration ?? 0) > 0 ? 'text-amber-400' : 'text-white/40'}`}>
                          {(keybindings.mouseAcceleration ?? 0.0).toFixed(1)}{(keybindings.mouseAcceleration ?? 0) === 0 ? ' (OFF)' : ''}
                        </span>
                      </div>
                      <input type="range" min="0.0" max="2.0" step="0.1"
                        value={keybindings.mouseAcceleration ?? 0.0}
                        onChange={(e) => {
                          const v = parseFloat(e.target.value);
                          setKeybindings(prev => {
                            const updated = { ...prev, mouseAcceleration: v };
                            try { localStorage.setItem('grifball_keybindings', JSON.stringify(updated)); } catch (_) {}
                            return updated;
                          });
                        }}
                        className="w-full accent-amber-400 h-1 bg-white/10 rounded-lg appearance-none cursor-pointer"
                      />
                      <span className="text-[9px] text-white/35 font-mono">0.0 = linear (off). Higher = faster as you move faster.</span>
                    </div>
                  </div>

                  {/* Mobile Gamepad settings */}
                  <div className="pointer-events-auto border border-white/10 rounded-xl p-4 bg-white/[0.02] flex flex-col gap-4 mb-5">
                    <p className="text-[10px] text-cyan-400 font-bold uppercase tracking-widest border-b border-white/5 pb-2 font-mono">📱 Mobile Touch controls</p>
                    <div className="flex items-center justify-between">
                      <div className="flex flex-col text-left">
                        <span className="text-[11px] font-bold uppercase tracking-wider text-white/80">Force Gamepad Overlay</span>
                        <span className="text-[9px] text-white/35 font-mono">Force show touch joysticks & buttons on desktop</span>
                      </div>
                      <button
                        id="force-mobile-controls-toggle"
                        type="button"
                        onClick={() => setForceMobileControls(prev => !prev)}
                        className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out outline-none ${
                          forceMobileControls ? 'bg-cyan-500' : 'bg-slate-800'
                        }`}
                        style={{
                          position: 'relative',
                          display: 'inline-flex',
                          height: '24px',
                          width: '44px',
                          cursor: 'pointer',
                          borderRadius: '9999px',
                          borderWidth: '2px',
                          borderColor: 'transparent',
                          transitionProperty: 'color, background-color, border-color, text-decoration-color, fill, stroke',
                          transitionDuration: '200ms',
                          outline: 'none',
                          backgroundColor: forceMobileControls ? '#06b6d4' : '#1e293b'
                        }}
                      >
                        <span
                          className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                            forceMobileControls ? 'translate-x-5' : 'translate-x-0'
                          }`}
                          style={{
                            pointerEvents: 'none',
                            display: 'inline-block',
                            height: '20px',
                            width: '20px',
                            transform: forceMobileControls ? 'translateX(20px)' : 'translateX(0)',
                            borderRadius: '9999px',
                            backgroundColor: '#ffffff',
                            transitionProperty: 'transform',
                            transitionDuration: '200ms'
                          }}
                        />
                      </button>
                    </div>
                    <p className="text-[9.5px] text-white/40 leading-normal text-left font-mono">
                      💡 <span className="text-[#38bdf8] font-bold">Custom HUD Editor</span>: Go in-game, tap <span className="text-amber-400 font-bold">PAUSE [ESC]</span> &gt; <span className="text-cyan-400 font-bold">HUD CANVAS ADJUSTER</span>. Drag the Left Analog stick and Right Button pads to layout your custom mobile gamepad position!
                    </p>
                  </div>

                  {/* Reset keybinds */}
                  <div className="pointer-events-auto flex items-center justify-between px-1 mb-5 text-[10px] font-mono text-white/40">
                    <button
                      onClick={() => {
                        setKeybindings({ ...DEFAULT_KEYBINDINGS });
                        setRebindingAction(null);
                        try { localStorage.setItem('grifball_keybindings', JSON.stringify(DEFAULT_KEYBINDINGS)); } catch (_) {}
                      }}
                      className="text-amber-400/70 hover:text-amber-400 font-bold uppercase tracking-wider cursor-pointer transition-colors bg-transparent border-none p-0"
                    >
                      ↻ Reset All Keybinds & Mouse
                    </button>
                  </div>
                </>
              ) : (
                renderVisualGamepadMapper()
              )}


            </div>
          ) : (
            /* LIGHTING CONTROLS SLIDERS CONTAINER */
            <div className="mobile-modal bg-slate-950/90 border border-white/10 backdrop-blur-2xl rounded-2xl p-6 w-[400px] max-w-[calc(100vw-1.5rem)] max-h-[calc(100dvh-1.5rem)] shadow-2xl flex flex-col select-none overflow-y-auto overflow-x-hidden">
              {/* Header */}
              <div className="text-center mb-6 border-b border-white/5 pb-4">
                <p className="text-[9px] text-amber-400 font-bold tracking-[0.3em] uppercase mb-1 font-display">ATMOSPHERE & CONFIG</p>
                <h3 className="text-2xl font-sans font-black tracking-tight uppercase text-white">
                  Lighting & Shadows
                </h3>
              </div>

              {/* Sliders list */}
              <div className="flex flex-col gap-6 pointer-events-auto mb-6">
                
                {/* Exposure / Sunlight Intensity */}
                <div className="flex flex-col gap-2">
                  <div className="flex justify-between text-[11px] font-bold uppercase tracking-wider text-white/80">
                    <span>Direct Sunlight Intensity</span>
                    <span className="text-amber-400 font-mono">{adminSettings.directLightIntensity.toFixed(2)}x</span>
                  </div>
                  <input 
                    type="range" 
                    min="0.1" 
                    max="4.0" 
                    step="0.05"
                    value={adminSettings.directLightIntensity} 
                    onChange={(e) => setAdminSettings(prev => ({ ...prev, directLightIntensity: parseFloat(e.target.value) }))}
                    className="w-full accent-amber-400 h-1 bg-white/10 rounded-lg appearance-none cursor-pointer"
                  />
                  <p className="text-[10px] text-white/40">Adjusts direct light intensity / exposure (increases general brightness).</p>
                </div>

                {/* Ambient Soft Fill (Shadow Harshness) */}
                <div className="flex flex-col gap-2">
                  <div className="flex justify-between text-[11px] font-bold uppercase tracking-wider text-white/80">
                    <span>Shadow Softness (Ambient Fill)</span>
                    <span className="text-amber-400 font-mono">{adminSettings.ambientLightIntensity.toFixed(2)}x</span>
                  </div>
                  <input 
                    type="range" 
                    min="0.1" 
                    max="3.5" 
                    step="0.05"
                    value={adminSettings.ambientLightIntensity} 
                    onChange={(e) => setAdminSettings(prev => ({ ...prev, ambientLightIntensity: parseFloat(e.target.value) }))}
                    className="w-full accent-amber-400 h-1 bg-white/10 rounded-lg appearance-none cursor-pointer"
                  />
                  <p className="text-[10px] text-white/40">Fills in shadowed regions to make them brighter and softer.</p>
                </div>

                {/* Skybox Brightness slider */}
                <div className="flex flex-col gap-2">
                  <div className="flex justify-between text-[11px] font-bold uppercase tracking-wider text-white/80">
                    <span>Skybox & Fog Brightness</span>
                    <span className="text-amber-400 font-mono">{adminSettings.skyboxBrightness}%</span>
                  </div>
                  <input 
                    type="range" 
                    min="0" 
                    max="100" 
                    step="1"
                    value={adminSettings.skyboxBrightness} 
                    onChange={(e) => setAdminSettings(prev => ({ ...prev, skyboxBrightness: parseInt(e.target.value) }))}
                    className="w-full accent-amber-400 h-1 bg-white/10 rounded-lg appearance-none cursor-pointer"
                  />
                  <p className="text-[10px] text-white/40">Adjusts background depth brightness and matching volumetric foggy horizon.</p>
                </div>

                {/* Skybox Color Hue slider */}
                <div className="flex flex-col gap-2">
                  <div className="flex justify-between items-center text-[11px] font-bold uppercase tracking-wider text-white/80">
                    <div className="flex items-center gap-2">
                      <span>Skybox & Fog Color Hue</span>
                      <div 
                        className="w-4 h-4 rounded-full border border-white/20 shadow-inner" 
                        style={{ backgroundColor: `hsl(${adminSettings.skyboxHue}, 70%, ${Math.max(25, adminSettings.skyboxBrightness)}%)` }} 
                        title="Selected color color preview"
                      />
                    </div>
                    <span className="text-amber-400 font-mono">{adminSettings.skyboxHue}°</span>
                  </div>
                  <input 
                    type="range" 
                    min="0" 
                    max="360" 
                    step="1"
                    value={adminSettings.skyboxHue} 
                    onChange={(e) => setAdminSettings(prev => ({ ...prev, skyboxHue: parseInt(e.target.value) }))}
                    className="w-full h-1.5 rounded-lg appearance-none cursor-pointer"
                    style={{
                      background: 'linear-gradient(to right, #ff0000 0%, #ffff00 17%, #00ff00 33%, #00ffff 50%, #0000ff 67%, #ff00ff 83%, #ff0000 100%)'
                    }}
                  />
                  <p className="text-[10px] text-white/40">Rotate color hue to select sky atmospheric styling (eg. Blue, Neon Cyan, Purple, Crimson, Amber).</p>
                </div>

                {/* Show Skybox toggle */}
                <div className="flex justify-between items-center text-xs pt-1.5 border-t border-white/5">
                  <div className="flex flex-col text-left">
                    <span className="font-bold text-white/90 uppercase tracking-wider text-[11px]">Show Skybox</span>
                    <span className="text-[10px] text-white/40">Toggle background skybox rendering on or off.</span>
                  </div>
                  <button 
                    id="skybox-visibility-toggle"
                    onClick={() => setAdminSettings(prev => ({ ...prev, showSkybox: prev.showSkybox !== false ? false : true }))}
                    className={`relative inline-flex h-4 w-8 shrink-0 cursor-pointer rounded-full border border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                      adminSettings.showSkybox !== false ? 'bg-amber-400' : 'bg-white/10'
                    }`}
                  >
                    <span className={`pointer-events-none inline-block h-3.5 w-3.5 transform rounded-full bg-slate-900 shadow transition duration-200 ease-in-out ${
                      adminSettings.showSkybox !== false ? 'translate-x-4' : 'translate-x-0'
                    }`} />
                  </button>
                </div>

              </div>

              {/* Button to close and return */}
              <button 
                id="apply-lighting-btn"
                onClick={() => setShowLightingMenu(false)}
                className="w-full h-11 bg-white text-slate-900 hover:bg-amber-400 hover:text-white text-xs font-black uppercase tracking-widest rounded cursor-pointer transition-colors active:scale-98"
              >
                Apply & Return
              </button>
            </div>
          )}
        </div>
      )}

      {/* FLOATING ACTION TOOLBAR DURING UI CUSTOMIZATION MODE */}
      {showUiAdjustment && uiAdjusterPosition && (
        <div
          ref={uiAdjusterToolbarRef}
          id="ui-adjustment-toolbar"
          className="mobile-ui-adjust-toolbar absolute z-50 bg-slate-950/90 border border-cyan-500/50 backdrop-blur-md rounded-xl p-4 shadow-2xl flex items-center gap-6 pointer-events-auto max-w-[90vw] select-none"
          style={{
            left: `${uiAdjusterPosition.x}%`,
            top: `${uiAdjusterPosition.y}%`,
            transform: 'translate(-50%, 0)',
            touchAction: 'none',
          }}
        >
          <div
            id="ui-adjustment-drag-handle"
            className="flex items-start gap-3 cursor-move"
            onPointerDown={handleUiAdjusterPointerDown}
            title="Move HUD Canvas Adjuster"
          >
            <Move className="w-4 h-4 text-cyan-400 mt-0.5 shrink-0" />
            <div className="flex flex-col">
              <h4 className="text-xs font-sans font-black tracking-widest text-cyan-400 uppercase">HUD Canvas Adjuster</h4>
              <p className="text-[10px] text-white/55 font-medium">Click UNLOCKED on an element to drag it. Click LOCK/UNLOCK to toggle attributes.</p>
            </div>
          </div>
          
          <div className="flex items-center gap-2">
            <button 
              id="ui-adjustment-reset"
              onClick={handleResetUiPositions}
              className="px-3 py-1.5 bg-slate-900 border border-slate-700 hover:border-slate-600 text-[10px] font-mono font-bold tracking-widest uppercase transition-all duration-150 rounded cursor-pointer flex items-center gap-1.5"
            >
              <RotateCcw className="w-3.5 h-3.5 text-slate-400" />
              Reset
            </button>

            <button 
              id="ui-adjustment-save"
              onClick={() => setShowUiAdjustment(false)}
              className="px-3.5 py-1.5 bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 border border-cyan-400/30 text-[10px] font-sans font-extrabold tracking-widest uppercase text-white transition-all duration-150 rounded shadow-[0_0_15px_rgba(6,182,212,0.3)] cursor-pointer flex items-center gap-1.5"
            >
              <Check className="w-3.5 h-3.5" />
              Save & Exit
            </button>
          </div>
        </div>
      )}

      {/* DIRECT MULTIPLAYER INVITE POPUP MODAL */}
      {activeInvite && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/90 backdrop-blur-md p-4 select-none">
          <div className="mobile-modal w-full max-w-sm bg-slate-900 border border-sky-500/35 rounded-2xl p-6 shadow-2xl text-center flex flex-col gap-5 max-h-[calc(100dvh-2rem)] overflow-y-auto">
            <div className="flex justify-center flex-col items-center gap-1">
              <span className="text-[10px] text-[#38bdf8] font-bold uppercase tracking-[0.2em] mb-1">Combat Invitation</span>
              <div className="w-12 h-12 rounded-full bg-sky-500/10 border border-sky-500/20 flex items-center justify-center text-sky-400 mb-2">
                <svg className="w-5 h-5 animate-bounce" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                </svg>
              </div>
              <h3 className="text-lg font-black tracking-tight text-white uppercase font-display">Match invite received!</h3>
            </div>
            
            <p className="text-xs text-white/70 leading-relaxed">
              Client <strong className="text-amber-400 font-mono text-sm font-black">{activeInvite.fromId}</strong> has invited you. Do you join?
            </p>
            
            <div className="flex gap-4 mt-2">
              <button
                onClick={() => {
                  const roomToJoin = activeInvite.roomCode;
                  setActiveInvite(null);
                  setConnectionMode('relay'); // force relay connection
                  handleJoinGame(roomToJoin);
                }}
                className="flex-1 py-3 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 active:scale-95 text-xs text-white uppercase font-black tracking-widest transition-all rounded-lg border border-emerald-400/20 shadow-lg cursor-pointer flex items-center justify-center gap-2"
              >
                🎮 Yes
              </button>
              <button
                onClick={() => {
                  if (menuSocket && menuSocket.readyState === WebSocket.OPEN) {
                    menuSocket.send(JSON.stringify({
                      type: 'decline_invite',
                      targetId: activeInvite.fromId
                    }));
                  }
                  setActiveInvite(null);
                }}
                className="flex-1 py-3 bg-white/5 hover:bg-white/10 active:scale-95 text-xs text-white/70 hover:text-white uppercase font-black tracking-widest transition-all rounded-lg border border-white/10 cursor-pointer"
              >
                ❌ No
              </button>
            </div>
          </div>
        </div>
      )}

      {/* BOT SETUP MENU MODAL OVERLAY */}
      {showBotSetupMenu && (
        <div className="fixed inset-0 z-[99] flex items-center justify-center bg-slate-950/90 backdrop-blur-xl p-4 select-none">
          <div className="mobile-modal w-full max-w-2xl bg-slate-900/60 border border-blue-500/20 backdrop-blur-2xl rounded-2xl p-6 shadow-[0_0_60px_rgba(56,189,248,0.08)] flex flex-col gap-5 max-h-[calc(100dvh-2rem)] overflow-y-auto overflow-x-hidden">
            {/* Header */}
            <div className="flex items-center justify-between border-b border-white/5 pb-4">
              <div className="flex flex-col">
                <p className="text-[10px] text-blue-400 font-bold tracking-[0.3em] uppercase mb-1 font-display">COMBAT SIMULATION</p>
                <h3 className="text-xl font-sans font-black tracking-tight uppercase text-white">
                  AI Combatant Grid Setup
                </h3>
              </div>
              <button
                onClick={() => setShowBotSetupMenu(false)}
                className="text-white/40 hover:text-white text-lg font-bold cursor-pointer transition-colors px-2 py-1 rounded hover:bg-white/5"
              >
                ✕
              </button>
            </div>

            {/* Bot Count Slider */}
            <div className="bg-white/5 border border-white/5 rounded-xl p-4 flex flex-col gap-3">
              <div className="flex justify-between items-center">
                <span className="text-xs font-bold text-blue-400 uppercase tracking-wider">Active AI Combatants</span>
                <span className="text-lg font-black font-mono text-blue-400">{offlineBotCount} <span className="text-xs text-white/40 font-normal">BOTS</span></span>
              </div>
              <input
                type="range"
                min="1"
                max="7"
                value={offlineBotCount}
                onChange={(e) => setOfflineBotCount(parseInt(e.target.value))}
                className="w-full accent-blue-400 h-1.5 bg-white/10 rounded-lg appearance-none cursor-pointer"
              />
              <div className="flex justify-between text-[10px] font-mono text-white/30 uppercase">
                <span>1 Bot</span>
                <span>7 Bots</span>
              </div>
            </div>

            {/* Grifball Mode Toggle */}
            <div className="bg-white/5 border border-white/5 rounded-xl p-4 flex items-center justify-between gap-4">
              <div className="flex flex-col text-left">
                <span className="text-xs font-bold text-orange-400 uppercase tracking-wider">🏉 Grifball Mode (4v4)</span>
                <span className="text-[10.5px] text-white/50 leading-snug">
                  Round-based neutral-ball objective. Forces an 8-player match on a reshaped stadium court.
                </span>
              </div>
              <button
                onClick={() => {
                  const enabling = adminSettings.gameMode !== 'grifball';
                  setAdminSettings(prev => ({ ...prev, gameMode: enabling ? 'grifball' : 'sandbox' }));
                  if (enabling) {
                    const isRect = PREMADE_MAPS.find(m => m.id === selectedMap)?.mapShape === 'rectangular';
                    if (!isRect) setSelectedMap('championship_stadium');
                  }
                }}
                className={`shrink-0 px-4 h-10 rounded-lg font-black text-sm uppercase tracking-wider transition-all cursor-pointer border ${
                  adminSettings.gameMode === 'grifball'
                    ? 'bg-orange-500/20 border-orange-400 text-orange-300'
                    : 'bg-black/40 border-white/10 text-white/40 hover:text-white/70'
                }`}
              >
                {adminSettings.gameMode === 'grifball' ? 'ON' : 'OFF'}
              </button>
            </div>

            {/* Map Selector & 3D Preview */}
            <div className="bg-white/5 border border-white/5 rounded-xl p-4 flex gap-5 items-stretch">
              <div className="flex-1 flex flex-col justify-between py-1 select-none text-left">
                <div className="flex flex-col gap-2">
                  <span className="text-xs font-bold text-blue-400 uppercase tracking-wider">Battle Arena Map Selector</span>
                  <p className="text-[10.5px] text-white/50 leading-snug">
                    Choose the virtual environment where your combat simulation will be executed.
                  </p>
                </div>
                <div className="flex flex-col gap-1.5 mt-3">
                  <span className="text-[10px] text-white/40 uppercase tracking-widest font-mono">Arena Blueprint:</span>
                  <select
                    value={selectedMap}
                    onChange={(e) => {
                      const val = e.target.value;
                      setSelectedMap(val);
                    }}
                    className="w-full h-11 bg-black/60 border border-white/10 rounded px-3 text-sm text-cyan-400 font-bold uppercase outline-none focus:border-cyan-400 cursor-pointer transition-all font-sans"
                  >
                    <option value="hangar">⚙️ Industrial Hangar (Default)</option>
                    <option value="circle">🌐 Circle Arena (Minimalist)</option>
                    {PREMADE_MAPS.map(m => (
                      <option key={m.id} value={m.id}>
                        {m.theme === 'cyberpunk' ? '🌐' : m.theme === 'nature' ? '🌳' : m.theme === 'space' ? '🚀' : m.theme === 'synthwave' ? '🌴' : m.theme === 'rainy_streets' ? '🌧️' : m.theme === 'winter_rink' ? '❄️' : m.theme === 'grifball_stadium' ? '🏟️' : '⚔️'} {m.name} (Preset)
                      </option>
                    ))}
                    <option value="custom_file">💾 Load Custom Map (.json)</option>
                  </select>
                </div>
                
                {selectedMap === 'custom_file' && (
                  <div className="flex flex-col gap-2 mt-2 bg-black/40 border border-cyan-500/20 p-3 rounded-lg">
                    <span className="text-[10px] font-mono text-cyan-400 uppercase tracking-wider font-bold">Import Local Map File</span>
                    {lobbyCustomMapData ? (
                      <div className="flex flex-col gap-1 text-[10px] text-white/60">
                        <div>Loaded: <strong className="text-cyan-300 font-black">{lobbyCustomMapData.name}</strong></div>
                        <div>Author: {lobbyCustomMapData.author}</div>
                        <div>Objects: {lobbyCustomMapData.objects?.length || 0} | Spawns: {lobbyCustomMapData.spawnPoints?.length || 0}</div>
                      </div>
                    ) : (
                      <p className="text-[10px] text-white/40 italic">No custom map file loaded yet.</p>
                    )}
                    <label className="h-8 bg-cyan-500/10 hover:bg-cyan-500/20 border border-cyan-500/30 text-cyan-400 font-mono text-[10px] font-bold uppercase tracking-wider rounded flex items-center justify-center cursor-pointer transition-all gap-1.5 mt-1">
                      📂 Select Map JSON
                      <input
                        type="file"
                        accept=".json"
                        className="hidden"
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (!file) return;
                          const reader = new FileReader();
                          reader.onload = (event) => {
                            try {
                              const parsed = JSON.parse(event.target?.result as string) as CustomMapData;
                              if (parsed && parsed.name && parsed.objects) {
                                setLobbyCustomMapData(parsed);
                              } else {
                                alert("Invalid map structure. Make sure objects and name are defined.");
                              }
                            } catch (err) {
                              alert("Failed to parse map JSON.");
                            }
                          };
                          reader.readAsText(file);
                        }}
                      />
                    </label>
                  </div>
                )}

                <div className="text-[10px] text-white/45 mt-2 bg-black/30 border border-white/5 p-2 rounded">
                  {selectedMap === 'hangar' ? (
                    <span><strong>Industrial Hangar:</strong> A gritty, atmospheric warehouse with steel columns, hazard stripes, metal pipes, ceiling trusses, and warm amber light shafts.</span>
                  ) : selectedMap === 'circle' ? (
                    <span><strong>Circle Arena:</strong> A clean, minimalist holographic grid arena with concentric glowing borders, four cardinal posts, and sleek neon cyan lights.</span>
                  ) : selectedMap === 'custom_file' ? (
                    <span><strong>Custom Arena:</strong> An externally loaded .json map designed in the local Standalone Map Maker tool. Supports custom obstacles, spawn zones, and custom lighting.</span>
                  ) : (
                    <span>
                      <strong>{PREMADE_MAPS.find(m => m.id === selectedMap)?.name}:</strong> {PREMADE_MAPS.find(m => m.id === selectedMap)?.description}
                    </span>
                  )}
                </div>
              </div>
              <MapPreview selectedMap={selectedMap} />
            </div>

            {/* Holographic Combatant Grid */}
            <div className="bg-white/5 border border-white/5 rounded-xl p-4 flex flex-col gap-3">
              <span className="text-xs font-bold text-blue-400 uppercase tracking-wider mb-1">Holographic Combatant Grid</span>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {/* Slot 1: Player */}
                <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-3 flex flex-col items-center gap-1.5 text-center">
                  <div className="w-8 h-8 rounded-full border-2 border-blue-400 flex items-center justify-center text-sm" style={{ backgroundColor: `hsl(${adminSettings.playerHue}, 80%, 25%)` }}>
                    👤
                  </div>
                  <span className="text-[10px] font-black text-blue-300 uppercase tracking-wider truncate max-w-full">{playerName}</span>
                  <span className="text-[8px] font-mono text-blue-400/60 uppercase">PLAYER</span>
                </div>

                {/* Slot 2: Main AI (DoomBot Blue) */}
                <div className={`rounded-lg p-3 flex flex-col items-center gap-1.5 text-center transition-all ${1 <= offlineBotCount ? 'bg-white/5 border border-white/10' : 'bg-white/2 border border-white/5 opacity-20'}`}>
                  <div
                    className="w-8 h-8 rounded-full border-2 flex items-center justify-center text-sm"
                    style={{
                      borderColor: `hsl(${botColors.main_ai ?? 0}, 60%, 50%)`,
                      backgroundColor: `hsl(${botColors.main_ai ?? 0}, 60%, 15%)`,
                    }}
                  >
                    🤖
                  </div>
                  <span className="text-[10px] font-bold text-white/60 uppercase tracking-wide">DoomBot</span>
                  <div className="flex flex-wrap justify-center gap-0.5">
                    {BOT_COLOR_PRESETS.map((preset) => (
                      <button
                        key={preset.hue}
                        title={preset.label}
                        onClick={() => setBotColors(prev => ({ ...prev, main_ai: preset.hue }))}
                        className="w-3 h-3 rounded-full cursor-pointer transition-transform hover:scale-125"
                        style={{
                          backgroundColor: `hsl(${preset.hue}, 75%, 50%)`,
                          outline: (botColors.main_ai ?? 0) === preset.hue ? '2px solid white' : '2px solid transparent',
                          outlineOffset: '1px',
                        }}
                      />
                    ))}
                  </div>
                  {1 <= offlineBotCount && (
                    <div className="w-full flex flex-col gap-1 mt-auto">
                      <select
                        value={botDifficulties.main_ai || 'normal'}
                        onChange={(e) => setBotDifficulties(prev => ({ ...prev, main_ai: e.target.value }))}
                        className="w-full h-7 bg-black/60 border border-white/10 rounded px-1.5 text-[10px] text-white/70 font-bold uppercase outline-none focus:border-blue-400 cursor-pointer transition-all font-sans"
                        title={getPresetDescription(botDifficulties.main_ai || 'normal', aiPresets)}
                      >
                        <option value="easy" title={getPresetDescription('easy', aiPresets)}>🟢 Easy</option>
                        <option value="normal" title={getPresetDescription('normal', aiPresets)}>🔵 Normal</option>
                        <option value="hard" title={getPresetDescription('hard', aiPresets)}>🟡 Hard</option>
                        <option value="nightmare" title={getPresetDescription('nightmare', aiPresets)}>🔴 Nightmare</option>
                        {aiPresets.length > 0 && (
                          <optgroup label="Custom Presets">
                            {aiPresets.map(preset => (
                              <option key={preset.id} value={preset.id} title={getPresetDescription(preset.id, aiPresets)}>🤖 {preset.name}</option>
                            ))}
                          </optgroup>
                        )}
                      </select>
                      {['easy', 'normal', 'hard', 'nightmare'].includes(botDifficulties.main_ai || 'normal') && (
                        <select
                          value={botArchetypes.main_ai || 'none'}
                          onChange={(e) => {
                            const newArch = e.target.value as AIArchetypeId;
                            setBotArchetypes(prev => ({ ...prev, main_ai: newArch }));
                            if (newArch === 'none') {
                              setAdminSettings(prev => ({ ...prev, aiArchetype: 'none' }));
                            } else {
                              setAdminSettings(prev => applyArchetypeToSettings(prev, newArch));
                            }
                          }}
                          className="w-full h-7 bg-black/60 border border-white/10 rounded px-1.5 text-[10px] text-cyan-400 font-bold uppercase outline-none focus:border-cyan-400 cursor-pointer transition-all font-sans"
                          title={getArchetypeDescription(botArchetypes.main_ai || 'none')}
                        >
                          {AI_ARCHETYPE_OPTIONS.map((option) => (
                            <option key={option.value} value={option.value} title={getArchetypeDescription(option.value)}>
                              {option.value === 'none' ? '👤 ' + option.label : option.label}
                            </option>
                          ))}
                        </select>
                      )}
                    </div>
                  )}
                </div>

                {/* Slots 3-8: Custom bots */}
                {[
                  { id: 'bot_2', name: 'DoomBot Green', hue: 120 },
                  { id: 'bot_3', name: 'DoomBot Purple', hue: 280 },
                  { id: 'bot_4', name: 'DoomBot Orange', hue: 45 },
                  { id: 'bot_5', name: 'DoomBot Yellow', hue: 60 },
                  { id: 'bot_6', name: 'DoomBot Magenta', hue: 320 },
                  { id: 'bot_7', name: 'DoomBot Cyan', hue: 180 },
                ].map((bot, idx) => {
                  const slotActive = idx + 2 <= offlineBotCount;
                  return (
                    <div
                      key={bot.id}
                      className={`rounded-lg p-3 flex flex-col items-center gap-1.5 text-center transition-all ${slotActive ? 'bg-white/5 border border-white/10' : 'bg-white/2 border border-white/5 opacity-20'}`}
                    >
                      <div
                        className="w-8 h-8 rounded-full border-2 flex items-center justify-center text-sm"
                        style={{
                          borderColor: `hsl(${botColors[bot.id] ?? bot.hue}, 60%, 50%)`,
                          backgroundColor: `hsl(${botColors[bot.id] ?? bot.hue}, 60%, 15%)`,
                        }}
                      >
                        🤖
                      </div>
                      <span className="text-[10px] font-bold text-white/60 uppercase tracking-wide truncate max-w-full">{bot.name}</span>
                      <div className="flex flex-wrap justify-center gap-0.5">
                        {BOT_COLOR_PRESETS.map((preset) => (
                          <button
                            key={preset.hue}
                            title={preset.label}
                            onClick={() => setBotColors(prev => ({ ...prev, [bot.id]: preset.hue }))}
                            className="w-3 h-3 rounded-full cursor-pointer transition-transform hover:scale-125"
                            style={{
                              backgroundColor: `hsl(${preset.hue}, 75%, 50%)`,
                              outline: (botColors[bot.id] ?? bot.hue) === preset.hue ? '2px solid white' : '2px solid transparent',
                              outlineOffset: '1px',
                            }}
                          />
                        ))}
                      </div>
                      {slotActive && (
                        <div className="w-full flex flex-col gap-1 mt-auto">
                          <select
                            value={botDifficulties[bot.id] || 'normal'}
                            onChange={(e) => setBotDifficulties(prev => ({ ...prev, [bot.id]: e.target.value }))}
                            className="w-full h-7 bg-black/60 border border-white/10 rounded px-1.5 text-[10px] text-white/70 font-bold uppercase outline-none focus:border-blue-400 cursor-pointer transition-all font-sans"
                            title={getPresetDescription(botDifficulties[bot.id] || 'normal', aiPresets)}
                          >
                            <option value="easy" title={getPresetDescription('easy', aiPresets)}>🟢 Easy</option>
                            <option value="normal" title={getPresetDescription('normal', aiPresets)}>🔵 Normal</option>
                            <option value="hard" title={getPresetDescription('hard', aiPresets)}>🟡 Hard</option>
                            <option value="nightmare" title={getPresetDescription('nightmare', aiPresets)}>🔴 Nightmare</option>
                            {aiPresets.length > 0 && (
                              <optgroup label="Custom Presets">
                                {aiPresets.map(preset => (
                                  <option key={preset.id} value={preset.id} title={getPresetDescription(preset.id, aiPresets)}>🤖 {preset.name}</option>
                                ))}
                              </optgroup>
                            )}
                          </select>
                          {['easy', 'normal', 'hard', 'nightmare'].includes(botDifficulties[bot.id] || 'normal') && (
                            <select
                              value={botArchetypes[bot.id] || 'none'}
                              onChange={(e) => setBotArchetypes(prev => ({ ...prev, [bot.id]: e.target.value as AIArchetypeId }))}
                              className="w-full h-7 bg-black/60 border border-white/10 rounded px-1.5 text-[10px] text-cyan-400 font-bold uppercase outline-none focus:border-cyan-400 cursor-pointer transition-all font-sans"
                              title={getArchetypeDescription(botArchetypes[bot.id] || 'none')}
                            >
                              {AI_ARCHETYPE_OPTIONS.map((option) => (
                                <option key={option.value} value={option.value} title={getArchetypeDescription(option.value)}>
                                  {option.value === 'none' ? '👤 ' + option.label : option.label}
                                </option>
                              ))}
                            </select>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Quick Presets */}
            <div className="mobile-bot-presets flex items-center gap-2">
              <span className="text-[10px] text-white/40 uppercase tracking-widest font-mono shrink-0">Presets:</span>
              <button
                onClick={() => {
                  const all: Record<string, 'easy' | 'normal' | 'hard' | 'nightmare'> = {};
                  ['main_ai', 'bot_2', 'bot_3', 'bot_4', 'bot_5', 'bot_6', 'bot_7'].forEach(k => all[k] = 'normal');
                  setBotDifficulties(all);
                }}
                className="px-3 py-1.5 bg-blue-500/10 hover:bg-blue-500/20 border border-blue-500/20 text-blue-400 text-[10px] font-bold uppercase tracking-wider rounded cursor-pointer transition-all"
              >
                All Normal
              </button>
              <button
                onClick={() => {
                  const all: Record<string, 'easy' | 'normal' | 'hard' | 'nightmare'> = {};
                  ['main_ai', 'bot_2', 'bot_3', 'bot_4', 'bot_5', 'bot_6', 'bot_7'].forEach(k => all[k] = 'nightmare');
                  setBotDifficulties(all);
                }}
                className="px-3 py-1.5 bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 text-red-400 text-[10px] font-bold uppercase tracking-wider rounded cursor-pointer transition-all"
              >
                All Nightmare
              </button>
              <button
                onClick={() => {
                  const levels: ('easy' | 'normal' | 'hard' | 'nightmare')[] = ['easy', 'normal', 'normal', 'hard', 'hard', 'nightmare', 'nightmare'];
                  const keys = ['main_ai', 'bot_2', 'bot_3', 'bot_4', 'bot_5', 'bot_6', 'bot_7'];
                  const grad: Record<string, 'easy' | 'normal' | 'hard' | 'nightmare'> = {};
                  keys.forEach((k, i) => grad[k] = levels[i]);
                  setBotDifficulties(grad);
                }}
                className="px-3 py-1.5 bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/20 text-amber-400 text-[10px] font-bold uppercase tracking-wider rounded cursor-pointer transition-all"
              >
                Graduated
              </button>
            </div>

            {/* Action Buttons */}
            <div className="mobile-modal-actions flex gap-3 mt-1">
              {isPlaying ? (
                <button
                  onClick={() => {
                    setShowBotSetupMenu(false);
                    setIsPaused(false);
                  }}
                  className="flex-1 h-12 bg-white hover:bg-blue-400 hover:text-white text-slate-900 font-black text-xs uppercase tracking-widest rounded cursor-pointer transition-all active:scale-[0.98] shadow-lg"
                >
                  Apply & Resume
                </button>
              ) : (
                <button
                  onClick={() => {
                    setShowBotSetupMenu(false);
                    handleStartGame();
                  }}
                  className="flex-1 h-12 bg-white hover:bg-blue-400 hover:text-white text-slate-900 font-black text-xs uppercase tracking-widest rounded cursor-pointer transition-all active:scale-[0.98] shadow-lg flex items-center justify-center gap-2"
                >
                  <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z" clipRule="evenodd" />
                  </svg>
                  Initialize Simulation
                </button>
              )}
              <button
                onClick={() => setShowBotSetupMenu(false)}
                className="px-5 h-12 bg-white/5 hover:bg-white/10 border border-white/10 text-white/70 font-bold text-xs uppercase tracking-widest rounded cursor-pointer transition-all"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* THEATER: EDIT REPLAY NAME & DESCRIPTION MODAL OVERLAY */}
      {showEditModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/90 backdrop-blur-xl p-4 select-none animate-in fade-in duration-200">
          <div className="mobile-modal w-full max-w-md bg-slate-900 border border-pink-500/25 rounded-2xl p-6 shadow-2xl flex flex-col gap-5 text-left max-h-[calc(100dvh-2rem)] overflow-y-auto">
            <div className="flex justify-between items-center border-b border-white/5 pb-4 shrink-0">
              <div className="flex flex-col">
                <span className="text-[10px] text-pink-500 font-bold uppercase tracking-[0.2em] mb-1 font-display">ARCHIVE METADATA</span>
                <h3 className="text-lg font-black tracking-tight text-white uppercase font-display">Rename Replay Record</h3>
              </div>
              <button
                onClick={() => setShowEditModal(false)}
                className="text-white/40 hover:text-white font-bold cursor-pointer p-1"
              >
                ✕
              </button>
            </div>

            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <label className="text-[10px] text-white/40 uppercase tracking-widest font-mono font-bold">Record Custom Title:</label>
                <input
                  type="text"
                  maxLength={40}
                  value={editReplayName}
                  onChange={(e) => setEditReplayName(e.target.value)}
                  placeholder="E.g., Sandbox Dominance..."
                  className="w-full h-11 bg-black/60 border border-white/10 rounded px-3 text-sm tracking-wide text-white focus:border-pink-500 outline-none transition-all font-semibold"
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-[10px] text-white/40 uppercase tracking-widest font-mono font-bold">Record Description / Commentary:</label>
                <textarea
                  maxLength={200}
                  rows={4}
                  value={editReplayDesc}
                  onChange={(e) => setEditReplayDesc(e.target.value)}
                  placeholder="E.g., Highlight of the triple-kill sword lunge at the buzzer..."
                  className="w-full bg-black/60 border border-white/10 rounded p-3 text-sm tracking-wide text-white focus:border-pink-500 outline-none transition-all font-medium resize-none leading-relaxed"
                />
              </div>
            </div>

            <div className="flex gap-3 mt-2 shrink-0">
              <button
                onClick={async () => {
                  if (editReplayName.trim()) {
                    await updateReplayMeta(editReplayId!, editReplayName.trim(), editReplayDesc.trim());
                    setShowEditModal(false);
                    await loadTheaterReplays();
                  }
                }}
                disabled={!editReplayName.trim()}
                className={`flex-1 py-3 font-sans font-black text-xs uppercase tracking-widest rounded-lg transition-all border outline-none cursor-pointer flex items-center justify-center gap-1.5 shadow-lg ${
                  editReplayName.trim()
                    ? 'bg-gradient-to-r from-pink-600 to-rose-600 hover:from-pink-500 hover:to-rose-500 text-white border-pink-500/20 active:scale-95 shadow-[0_0_12px_rgba(236,72,153,0.3)]'
                    : 'bg-white/5 border-white/5 text-white/20 cursor-not-allowed'
                }`}
              >
                💾 Update Record
              </button>
              <button
                onClick={() => setShowEditModal(false)}
                className="px-5 py-3 bg-white/5 hover:bg-white/10 text-xs text-white/70 hover:text-white uppercase font-black tracking-widest transition-all rounded-lg border border-white/10 cursor-pointer active:scale-95"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* THEATER: SAVE CACHED REPLAY TO ARCHIVES PERMANENTLY MODAL OVERLAY */}
      {showSaveModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/90 backdrop-blur-xl p-4 select-none animate-in fade-in duration-200">
          <div className="mobile-modal w-full max-w-md bg-slate-900 border border-yellow-500/25 rounded-2xl p-6 shadow-2xl flex flex-col gap-5 text-left max-h-[calc(100dvh-2rem)] overflow-y-auto">
            <div className="flex justify-between items-center border-b border-white/5 pb-4 shrink-0">
              <div className="flex flex-col">
                <span className="text-[10px] text-yellow-500 font-bold uppercase tracking-[0.2em] mb-1 font-display">ARCHIVE ACQUISITION</span>
                <h3 className="text-lg font-black tracking-tight text-white uppercase font-display">Commit Replay to Archives</h3>
              </div>
              <button
                onClick={() => setShowSaveModal(false)}
                className="text-white/40 hover:text-white font-bold cursor-pointer p-1"
              >
                ✕
              </button>
            </div>

            <p className="text-[11.5px] text-white/60 leading-relaxed bg-yellow-500/5 border border-yellow-500/10 p-3 rounded">
              ⚠️ This will save the rolling auto-save match cache item permanently into your Archives, ensuring it won't be overwritten. Add a name and description to find it easily!
            </p>

            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <label className="text-[10px] text-white/40 uppercase tracking-widest font-mono font-bold">Archive Record Title:</label>
                <input
                  type="text"
                  maxLength={40}
                  value={saveCachedName}
                  onChange={(e) => setSaveCachedName(e.target.value)}
                  placeholder="Give this replay record a name..."
                  className="w-full h-11 bg-black/60 border border-white/10 rounded px-3 text-sm tracking-wide text-white focus:border-yellow-500 outline-none transition-all font-semibold"
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-[10px] text-white/40 uppercase tracking-widest font-mono font-bold">Replay Summary / Notes:</label>
                <textarea
                  maxLength={200}
                  rows={4}
                  value={saveCachedDesc}
                  onChange={(e) => setSaveCachedDesc(e.target.value)}
                  placeholder="Record highlight notes, bots behavior details, scores, etc..."
                  className="w-full bg-black/60 border border-white/10 rounded p-3 text-sm tracking-wide text-white focus:border-yellow-500 outline-none transition-all font-medium resize-none leading-relaxed"
                />
              </div>
            </div>

            <div className="flex gap-3 mt-2 shrink-0">
              <button
                onClick={async () => {
                  if (saveCachedName.trim()) {
                    await saveCachedReplay(saveCachedId!, saveCachedName.trim(), saveCachedDesc.trim());
                    setShowSaveModal(false);
                    await loadTheaterReplays();
                  }
                }}
                disabled={!saveCachedName.trim()}
                className={`flex-1 py-3 font-sans font-black text-xs uppercase tracking-widest rounded-lg transition-all border outline-none cursor-pointer flex items-center justify-center gap-1.5 shadow-lg ${
                  saveCachedName.trim()
                    ? 'bg-gradient-to-r from-yellow-600 to-amber-600 hover:from-yellow-500 hover:to-amber-500 text-white border-yellow-500/20 active:scale-95 shadow-[0_0_12px_rgba(245,158,11,0.3)]'
                    : 'bg-white/5 border-white/5 text-white/20 cursor-not-allowed'
                }`}
              >
                📥 Commit to Archives
              </button>
              <button
                onClick={() => setShowSaveModal(false)}
                className="px-5 py-3 bg-white/5 hover:bg-white/10 text-xs text-white/70 hover:text-white uppercase font-black tracking-widest transition-all rounded-lg border border-white/10 cursor-pointer active:scale-95"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* EDGE DEGRADED PERFORMANCE WARNING POPUP */}
      {showEdgePerformanceWarning && (
        <div className="fixed inset-0 z-[105] flex items-center justify-center bg-slate-950/90 backdrop-blur-xl p-4 select-none animate-in fade-in duration-200">
          <div className="mobile-modal w-full max-w-lg bg-slate-900 border border-sky-500/20 hover:border-sky-500/30 rounded-2xl p-6 shadow-[0_0_30px_rgba(14,165,233,0.15)] flex flex-col gap-5 text-left max-h-[calc(100dvh-2rem)] overflow-y-auto transition-all duration-300">
            <div className="flex justify-between items-start border-b border-white/5 pb-4 shrink-0">
              <div className="flex flex-col">
                <span className="text-[10px] text-sky-400 font-bold uppercase tracking-[0.2em] mb-1 font-display">
                  EDGE PERFORMANCE WARNING
                </span>
                <h3 className="text-xl font-black tracking-tight text-white uppercase font-display leading-tight">
                  Edge Graphics Path Degraded
                </h3>
              </div>
              <button
                onClick={() => {
                  setEdgePerformanceWarningDismissed(true);
                  setShowEdgePerformanceWarning(false);
                }}
                className="text-white/40 hover:text-white font-bold cursor-pointer p-1 transition-colors text-base"
                title="Dismiss warning"
              >
                x
              </button>
            </div>

            <div className="flex flex-col gap-4">
              <p className="text-xs text-white/60 leading-relaxed">
                Microsoft Edge is using a <strong className="text-sky-300">low-performance graphics path</strong> on this device. WebGL acceleration is enabled, but iBrawls detected sustained gameplay under <strong className="text-white">{EDGE_LOW_FPS_THRESHOLD} FPS</strong> for <strong className="text-white">{EDGE_LOW_FPS_SUSTAINED_MS / 1000} seconds</strong>. Edge is not recommended for this device; Chrome or Firefox should provide the best performance.
              </p>

              <div className="bg-black/45 border border-white/5 rounded-xl p-4 flex flex-col gap-2.5 font-mono text-[11px] shadow-inner select-text">
                <div className="flex justify-between items-center border-b border-white/5 pb-2">
                  <span className="text-white/45">Browser:</span>
                  <span className="text-sky-300 font-bold">Microsoft Edge</span>
                </div>
                <div className="flex justify-between items-center border-b border-white/5 pb-2">
                  <span className="text-white/45">WebGL Acceleration:</span>
                  <span className="text-emerald-400 font-bold">ENABLED</span>
                </div>
                <div className="flex justify-between items-center border-b border-white/5 pb-2">
                  <span className="text-white/45">Recent FPS:</span>
                  <span className="text-amber-300 font-bold">
                    {currentStats.fps !== undefined && currentStats.fps > 0 ? currentStats.fps : 'Low'}
                  </span>
                </div>
                <div className="flex justify-between items-center border-b border-white/5 pb-2">
                  <span className="text-white/45">Low-FPS Window:</span>
                  <span className="text-amber-300 font-bold">
                    {(edgeLowFpsSampleDurationMs / 1000).toFixed(1)}s
                  </span>
                </div>
                <div className="flex flex-col gap-1">
                  <span className="text-white/45">Detected Renderer:</span>
                  <span className="text-sky-300 font-bold break-all">
                    {graphicsCheck.details || "Hardware Accelerated GPU"}
                  </span>
                </div>
              </div>

              <div className="bg-white/5 border border-white/5 rounded-xl p-4 text-xs select-text leading-relaxed">
                <ol className="list-decimal pl-4 flex flex-col gap-2 text-white/75 font-medium">
                  <li>Open <code className="bg-black/40 px-1 py-0.5 rounded text-sky-300 font-mono">edge://gpu</code> and confirm WebGL is listed as hardware accelerated.</li>
                  <li>Open <code className="bg-black/40 px-1 py-0.5 rounded text-sky-300 font-mono">edge://settings/system</code> and keep <strong className="text-white">Use graphics acceleration when available</strong> enabled.</li>
                  <li>Update Edge from <code className="bg-black/40 px-1 py-0.5 rounded text-sky-300 font-mono">edge://settings/help</code>, then fully restart the browser.</li>
                  <li>Update your GPU driver from Intel, NVIDIA, AMD, or your PC manufacturer.</li>
                  <li>If Chrome or Firefox stays much faster on the same device, use one of those browsers for iBrawls.</li>
                </ol>
              </div>
            </div>

            <div className="flex gap-3 mt-3 shrink-0">
              <button
                onClick={() => {
                  setEdgePerformanceWarningDismissed(true);
                  setShowEdgePerformanceWarning(false);
                }}
                className="flex-1 py-3.5 bg-gradient-to-r from-sky-600 to-cyan-600 hover:from-sky-500 hover:to-cyan-500 text-white font-sans font-black text-xs uppercase tracking-widest rounded-lg border border-sky-500/20 active:scale-95 shadow-[0_0_15px_rgba(14,165,233,0.25)] transition-all cursor-pointer flex items-center justify-center gap-2"
              >
                <span>Dismiss & Play Anyway</span>
                <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
                </svg>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* GRAPHICS ACCELERATION WARNING POPUP */}
      {showGraphicsWarning && (
        <div className="fixed inset-0 z-[105] flex items-center justify-center bg-slate-950/90 backdrop-blur-xl p-4 select-none animate-in fade-in duration-200">
          <div className="mobile-modal w-full max-w-lg bg-slate-900 border border-amber-500/20 hover:border-amber-500/30 rounded-2xl p-6 shadow-[0_0_30px_rgba(245,158,11,0.15)] flex flex-col gap-5 text-left max-h-[calc(100dvh-2rem)] overflow-y-auto transition-all duration-300">
            
            {/* Header Section */}
            <div className="flex justify-between items-start border-b border-white/5 pb-4 shrink-0">
              <div className="flex flex-col">
                <span className="text-[10px] text-amber-500 font-bold uppercase tracking-[0.2em] mb-1 font-display flex items-center gap-1.5 animate-pulse">
                  ⚠️ SYSTEM HARDWARE WARNING
                </span>
                <h3 className="text-xl font-black tracking-tight text-white uppercase font-display leading-tight">
                  Graphics Acceleration Disabled
                </h3>
              </div>
              <button
                onClick={() => setShowGraphicsWarning(false)}
                className="text-white/40 hover:text-white font-bold cursor-pointer p-1 transition-colors text-base"
                title="Dismiss warning"
              >
                ✕
              </button>
            </div>

            {/* Explanation & Diagnostics */}
            <div className="flex flex-col gap-4">
              <p className="text-xs text-white/60 leading-relaxed">
                We detected that your browser is running with <strong className="text-amber-400">graphics acceleration turned off</strong> or is using a slow CPU software rasterizer. iBrawls requires hardware-accelerated WebGL to render high-performance 3D character models and environments smoothly. Without it, you will experience heavy lag, stuttering, and extremely low frame rates.
              </p>

              {/* Diagnostics Box */}
              <div className="bg-black/45 border border-white/5 rounded-xl p-4 flex flex-col gap-2.5 font-mono text-[11px] shadow-inner select-text">
                <div className="flex justify-between items-center border-b border-white/5 pb-2">
                  <span className="text-white/45">WebGL 3D Context:</span>
                  <span className={graphicsCheck.supported ? "text-emerald-400 font-bold" : "text-rose-500 font-bold"}>
                    {graphicsCheck.supported ? "🟢 AVAILABLE" : "🔴 UNSUPPORTED / BLOCKED"}
                  </span>
                </div>
                <div className="flex flex-col gap-1">
                  <span className="text-white/45">Detected Renderer:</span>
                  <span className="text-amber-400 font-bold break-all">
                    {graphicsCheck.details || "Unknown CPU/Software Driver"}
                  </span>
                </div>
              </div>

              {/* Action Tabs for browser steps */}
              <div className="flex flex-col gap-3 mt-1.5">
                <span className="text-[10px] text-white/40 uppercase tracking-widest font-mono font-bold">
                  How to Enable Hardware Acceleration:
                </span>
                
                {/* Tabs Segmented Switcher */}
                <div className="flex bg-black/40 p-1 rounded-lg border border-white/5 gap-1 select-none">
                  {([
                    { id: 'chrome', label: 'Chrome / Edge' },
                    { id: 'firefox', label: 'Firefox' },
                    { id: 'safari', label: 'Safari' },
                  ] as const).map(tab => (
                    <button
                      key={tab.id}
                      onClick={() => setHardwareTab(tab.id)}
                      className={`flex-1 py-1.5 rounded-md text-[10px] font-bold uppercase tracking-wider transition-all duration-200 cursor-pointer text-center ${
                        hardwareTab === tab.id
                          ? 'bg-amber-500/10 border border-amber-500/30 text-amber-400 font-extrabold shadow-[inset_0_1px_3px_rgba(245,158,11,0.1)]'
                          : 'text-white/40 hover:text-white/70 border border-transparent'
                      }`}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>

                {/* Tab Instructions Content Panel */}
                <div className="bg-white/5 border border-white/5 rounded-xl p-4 text-xs select-text leading-relaxed">
                  {hardwareTab === 'chrome' && (
                    <ol className="list-decimal pl-4 flex flex-col gap-2 text-white/75 font-medium">
                      <li>Open your browser settings (enter <code className="bg-black/40 px-1 py-0.5 rounded text-amber-300 font-mono">chrome://settings/system</code> in the address bar).</li>
                      <li>Toggle on <strong className="text-white">"Use graphics acceleration when available"</strong> (or "Use hardware acceleration when available").</li>
                      <li>Click the <strong className="text-amber-400">Relaunch</strong> button to restart the browser.</li>
                      <li>If still slow, enter <code className="bg-black/40 px-1 py-0.5 rounded text-amber-300 font-mono">chrome://flags</code>, search for <strong className="text-white">"Override software rendering list"</strong>, set it to <strong className="text-emerald-400">Enabled</strong>, and relaunch.</li>
                    </ol>
                  )}

                  {hardwareTab === 'firefox' && (
                    <ol className="list-decimal pl-4 flex flex-col gap-2 text-white/75 font-medium">
                      <li>Click the Firefox menu button and select <strong className="text-white">Settings</strong> (or go to <code className="bg-black/40 px-1 py-0.5 rounded text-amber-300 font-mono">about:preferences</code>).</li>
                      <li>In the **General** panel, scroll down to the <strong className="text-white">Performance</strong> section.</li>
                      <li>Uncheck <strong className="text-white">"Use recommended performance settings"</strong>.</li>
                      <li>Check <strong className="text-white">"Use hardware acceleration when available"</strong>.</li>
                      <li>Restart Firefox to apply the changes.</li>
                    </ol>
                  )}

                  {hardwareTab === 'safari' && (
                    <ol className="list-decimal pl-4 flex flex-col gap-2 text-white/75 font-medium">
                      <li>Open <strong className="text-white">Safari Settings / Preferences</strong> (or press <kbd className="bg-black/40 px-1 py-0.5 rounded text-[10px] font-mono">⌘,</kbd>).</li>
                      <li>Go to the <strong className="text-white">Advanced</strong> tab.</li>
                      <li>Ensure that <strong className="text-white">"Use hardware acceleration"</strong> is checked (if available).</li>
                      <li>On iOS/macOS, ensure your system is not running in <strong className="text-amber-400">Low Power Mode</strong>, which often disables GPU acceleration for web pages.</li>
                    </ol>
                  )}
                </div>
              </div>
            </div>

            {/* Actions Footer */}
            <div className="flex gap-3 mt-3 shrink-0">
              <button
                onClick={() => setShowGraphicsWarning(false)}
                className="flex-1 py-3.5 bg-gradient-to-r from-amber-600 to-yellow-600 hover:from-amber-500 hover:to-yellow-500 text-white font-sans font-black text-xs uppercase tracking-widest rounded-lg border border-amber-500/20 active:scale-95 shadow-[0_0_15px_rgba(245,158,11,0.25)] transition-all cursor-pointer flex items-center justify-center gap-2"
              >
                <span>Dismiss & Play Anyway</span>
                <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
                </svg>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* FLOATING INVITE NOTIFICATIONS DRAWER */}
      {inviteNotifications.length > 0 && (
        <div className="fixed top-6 right-6 z-[101] flex flex-col gap-3 pointer-events-none select-none max-w-sm">
          {inviteNotifications.map((notif, index) => (
            <div key={index} className="bg-slate-950/95 border border-sky-400/40 rounded-xl px-4 py-3 shadow-xl backdrop-blur-md flex items-center gap-3 pointer-events-auto">
              <span className="w-2 h-2 rounded-full bg-sky-454 bg-sky-400 animate-ping shrink-0" />
              <p className="text-[11px] font-bold text-sky-200 mt-0.5">{notif}</p>
            </div>
          ))}
        </div>
      )}

      {/* GAMEPAD VIRTUAL CONTROLLER CURSOR */}
      <div
        ref={controllerCursorRef}
        style={{
          position: 'fixed',
          left: '50%',
          top: '50%',
          width: '32px',
          height: '32px',
          transform: 'translate(-50%, -50%)',
          pointerEvents: 'none',
          zIndex: 99999,
          display: 'none',
        }}
      >
        <img
          src="/gamepad-cursor.png"
          style={{
            width: '100%',
            height: '100%',
            display: 'block',
          }}
          alt="Controller Cursor"
        />
      </div>
    </div>
  );
}
