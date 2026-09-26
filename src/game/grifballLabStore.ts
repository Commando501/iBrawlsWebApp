import type { RunnerPlan } from './aiGrifballRunner';
import { defaultGrifballTactics, validateGrifballTactics, type GrifballTacticsConfig } from './grifballTacticsConfig';
import type { GrifballAssignment, GrifballTacticalSnapshot } from './aiGrifballTeamPlan';
import type { UniversalSettings } from '../types';

export type LabScenario = 'pickup' | 'escort' | 'turnover' | 'outnumbered' | 'crowding' | 'goal' | 'lane' | 'pursuit' | 'rendezvous' | 'tanking' | 'double' | 'breakthrough' | 'delay';
export interface LabMetrics {
  seconds: number; goals: number; possessionLosses: number; roleChanges: number;
  outsideSeconds: number; botSeconds: number; stuckSeconds: number; sharedExposureSeconds: number; blockedRouteSeconds: number; runnerWaitSeconds: number; runnerRouteChanges: number; tankingSeconds: number; doubleCommitSeconds: number; delaySeconds: number; engagementReleases: number;
}
export interface LabScenarioRecord {
  map: string;
  mechanics: UniversalSettings;
  roster: { id: string; team: string; difficulty: string; position: { x: number; y: number; z: number } }[];
  holderId: string | null;
}
export interface LabResult { config: GrifballTacticsConfig; metrics: LabMetrics; seed: number; scenario: LabScenario; setup: LabScenarioRecord }
export interface LabDiagnostics {
  runnerPlans: RunnerPlan[];
  assignments: GrifballAssignment[]; snapshot: GrifballTacticalSnapshot | null;
  history: string[]; metrics: LabMetrics; threats: Record<string, string | null>;
}
export type LabCommand = { type: 'step' | 'restart' | 'capture' | 'join' } | { type: 'scenario'; scenario: LabScenario; seed: number } | { type: 'compare'; seconds: number; seed: number; scenario: LabScenario; baseline: GrifballTacticsConfig; candidate: GrifballTacticsConfig };
const listeners = new Set<() => void>();
const STORAGE_KEY = 'ibrawls_grifball_lab_v1';
interface LabPreset { name: string; config: GrifballTacticsConfig }
let snapshot = {
  open: false, running: false, connected: false, config: defaultGrifballTactics(), revision: 0,
  activePreset: 'Defaults', savedConfig: JSON.stringify(defaultGrifballTactics()), presets: [] as LabPreset[],
  diagnostics: null as LabDiagnostics | null, results: [] as LabResult[], baseline: null as GrifballTacticsConfig | null,
  selectedBot: '', selectedTeam: 'all', overlays: { destinations: true, coverage: false, lines: true, candidates: false, routes: true, runnerRoutes: true, intercepts: true, engagements: true },
  message: '', comparing: false,
};
let loaded = false;
let commands: LabCommand[] = [];
function publish(patch: Partial<typeof snapshot>) { snapshot = { ...snapshot, ...patch }; for (const listener of listeners) listener(); }
function persist() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ config: snapshot.config, presets: snapshot.presets, activePreset: snapshot.activePreset, savedConfig: snapshot.savedConfig })); }
  catch { publish({ message: 'Browser storage is unavailable. Export JSON to keep your settings.' }); }
}
export const grifballLab = {
  subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
  getSnapshot: () => snapshot,
  getOpen: () => snapshot.open,
  load() {
    if (loaded) return; loaded = true;
    try {
      const raw = localStorage.getItem(STORAGE_KEY); if (!raw) return;
      const data = JSON.parse(raw);
      const config = validateGrifballTactics(data.config);
      if (!Array.isArray(data.presets) || data.presets.length > 50) throw new Error('Invalid preset list.');
      const presets = data.presets.map((p: LabPreset) => {
        if (typeof p.name !== 'string' || !p.name.trim() || p.name.length > 80) throw new Error('Invalid preset name.');
        return { name: p.name, config: validateGrifballTactics(p.config) };
      });
      publish({ config, presets, activePreset: typeof data.activePreset === 'string' ? data.activePreset : 'Imported', savedConfig: JSON.stringify(validateGrifballTactics(JSON.parse(data.savedConfig))) });
    } catch { publish({ message: 'Stored lab settings could not be loaded. Defaults are active.' }); }
  },
  open() { this.load(); publish({ open: true, running: false }); if (typeof document !== 'undefined') document.exitPointerLock?.(); },
  close() { commands = []; publish({ open: false, running: false, comparing: false }); },
  setConfig(value: unknown) { const config = validateGrifballTactics(value); publish({ config, revision: snapshot.revision + 1 }); persist(); },
  setRunning(running: boolean) { publish({ running }); },
  connect(connected: boolean) { commands = []; publish({ connected, diagnostics: null, running: false, comparing: false, results: [] }); },
  update: publish,
  command(command: LabCommand) { if (snapshot.connected) commands.push(command); },
  takeCommands() { const pending = commands; commands = []; return pending; },
  savePreset(name: string) {
    name = name.trim(); if (!name || name.length > 80) throw new Error('Use a preset name of 1–80 characters.');
    if (snapshot.presets.length >= 50 && !snapshot.presets.some(p => p.name === name)) throw new Error('Limit: 50 local presets.');
    const config = validateGrifballTactics(snapshot.config);
    publish({ presets: [...snapshot.presets.filter(p => p.name !== name), { name, config }], activePreset: name, savedConfig: JSON.stringify(config) }); persist();
  },
  selectPreset(name: string) {
    const preset = snapshot.presets.find(p => p.name === name); if (!preset) return;
    this.setConfig(preset.config); publish({ activePreset: name, savedConfig: JSON.stringify(preset.config) }); persist();
  },
  deletePreset(name: string) { publish({ presets: snapshot.presets.filter(p => p.name !== name), ...(snapshot.activePreset === name ? { activePreset: 'Working copy' } : {}) }); persist(); },
  pinBaseline() { publish({ baseline: validateGrifballTactics(snapshot.config), results: [] }); },
};
