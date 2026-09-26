import type { GrifballTacticalSnapshot } from './aiGrifballTeamPlan';
import { TACTICS_FIELDS, type TacticalNumber, type TeamTactics } from './grifballTacticsConfig';

export interface StyleObservation { pressure: number; width: number }
export interface GrifballStyleMemory {
  round: number; roster: string; elapsed: number; idleSeconds: number; samples: StyleObservation[];
}
export interface StylePreferences { aggression: number; patience: number; width: number; supportDistance: number; runnerRisk: number }
export interface GrifballStylePlan {
  team: string; label: string; preferences: StylePreferences; confidence: number; observations: number;
  pressure: number; opponentWidth: number; adapting: boolean; reason: string;
  difficulty: number; refreshSeconds: number; predictionScale: number; variation: number;
}
export interface TacticalChoice { seed: number; key: string; window: number }
const clamp = (n: number, min = 0, max = 1) => Math.max(min, Math.min(max, n));
const mean = (values: number[]) => values.reduce((sum, n) => sum + n, 0) / Math.max(1, values.length);
export const tacticalDifficulty = (difficulty?: string) => (({ easy: 0, normal: 1, hard: 2, nightmare: 3 } as Record<string, number>)[difficulty ?? 'normal'] ?? 1);

/** Samples public nearby motion at most twice a second, never hidden targets or future inputs. */
export function observeGrifballStyle(memory: GrifballStyleMemory | undefined, snapshot: GrifballTacticalSnapshot, team: string, dt: number): GrifballStyleMemory {
  const roster = snapshot.rosterKey ?? '';
  const next = memory && memory.round === snapshot.round && memory.roster === roster ? memory
    : { round: snapshot.round, roster, elapsed: 0, idleSeconds: 0, samples: [] };
  const elapsed = Math.max(0, dt);
  next.elapsed += elapsed; next.idleSeconds += elapsed;
  // Old evidence must expire when no opponent movement can be observed.
  if (next.idleSeconds >= 4) next.samples = [];
  if (next.elapsed + 1e-9 < 0.5) return next;
  next.elapsed = Math.max(0, next.elapsed - 0.5) % 0.5; // A long frame provides one observation, never synthetic repeated evidence.
  const holder = snapshot.players.find(p => p.id === snapshot.holderId);
  const anchor = holder?.pos ?? snapshot.ball;
  const own = snapshot.goals[team], goal = snapshot.goals[team === 'blue' ? 'red' : 'blue'];
  if (!own || !goal) return next;
  const length = Math.max(0.001, Math.hypot(goal.x - own.x, goal.z - own.z));
  const dx = (goal.x - own.x) / length, dz = (goal.z - own.z) / length;
  const enemies = snapshot.players.filter(p => p.team !== team && Math.hypot(p.pos.x - anchor.x, p.pos.z - anchor.z) <= 24 && Math.hypot(p.vel.x, p.vel.z) > 0.5).sort((a, b) => a.id.localeCompare(b.id));
  if (!enemies.length) return next;
  const observations = enemies.map(p => {
    // Carriers advance toward our goal; support opponents approach the current play.
    const target = p.id === holder?.id ? own : anchor;
    const distance = Math.max(0.001, Math.hypot(target.x - p.pos.x, target.z - p.pos.z));
    const closing = ((target.x - p.pos.x) * p.vel.x + (target.z - p.pos.z) * p.vel.z) / distance;
    return { pressure: clamp(closing / Math.max(1, p.space?.speed ?? 5.2)),
      width: clamp(Math.abs((p.pos.x - anchor.x) * -dz + (p.pos.z - anchor.z) * dx) / 10) };
  });
  next.samples.push({ pressure: mean(observations.map(o => o.pressure)), width: mean(observations.map(o => o.width)) });
  next.samples = next.samples.slice(-24); next.idleSeconds = 0;
  return next;
}

/** Resolve bounded preferences over the module settings; never changes movement/combat mechanics. */
export function resolveGrifballStyle(base: TeamTactics, memory: GrifballStyleMemory | undefined, team: string, difficulty: number): { tuning: TeamTactics; plan: GrifballStylePlan } {
  const samples = memory?.samples ?? [];
  const pressure = mean(samples.map(s => s.pressure)), opponentWidth = mean(samples.map(s => s.width));
  const deviation = mean(samples.map(s => (Math.abs(s.pressure - pressure) + Math.abs(s.width - opponentWidth)) / 2));
  const confidence = clamp(samples.length / Math.max(12, base.adaptationMinSamples)) * clamp(1 - deviation * 2);
  const adapting = base.adaptationEnabled && base.adaptationStrength > 0 && samples.length >= base.adaptationMinSamples && confidence >= base.adaptationConfidence;
  const response = adapting ? base.adaptationStrength * confidence : 0;
  const rush = Math.max(0, pressure - 0.5) * 2 * response;
  const compact = Math.max(0, 0.5 - opponentWidth) * 2 * response;
  const preferences: StylePreferences = {
    aggression: clamp(base.styleAggression - rush * 0.2), patience: clamp(base.stylePatience + rush * 0.15),
    width: clamp(base.styleWidth + compact * 0.2), supportDistance: clamp(base.styleSupportDistance - rush * 0.2),
    runnerRisk: clamp(base.styleRunnerRisk - rush * 0.2),
  };
  const tuning = { ...base };
  const adjust = (key: TacticalNumber, factor: number) => {
    const field = TACTICS_FIELDS[key]; tuning[key] = clamp(base[key] * factor, field.min, field.max);
  };
  const aggression = preferences.aggression - 0.5, patience = preferences.patience - 0.5;
  const width = preferences.width - 0.5, support = preferences.supportDistance - 0.5, risk = preferences.runnerRisk - 0.5;
  adjust('tankMinimumScore', 1 - aggression * 0.8); adjust('tankCoverageWeight', 1 - aggression * 0.6);
  adjust('defensePressure', 1 + aggression * 0.6);
  adjust('tankCommitSeconds', 1 + patience * 0.8); adjust('tankReleaseSeconds', 1 + patience * 0.8);
  adjust('runnerMaxWait', 1 + patience * 0.8);
  for (const key of ['lateralSpacing', 'runnerCutWidth', 'escortLaneWidth'] as const) adjust(key, 1 + width * 0.8);
  for (const key of ['escortLeadDistance', 'escortRearDistance', 'supportSeconds', 'leadForward'] as const) adjust(key, 1 + support * 0.6);
  adjust('runnerRiskWeight', 1 - risk * 0.6); adjust('passSafetyMargin', 1 - risk * 0.5);
  // Easy teams react later and extrapolate less precisely, but still honor immediate game events.
  difficulty = clamp(difficulty, 0, 3);
  const predictionScale = difficulty < 1 ? 0.6 + difficulty * 0.4 : 1;
  tuning.refreshSeconds = clamp(base.refreshSeconds * (difficulty < 1 ? 1.75 - difficulty * 0.75 : 1 - (difficulty - 1) * 0.15), TACTICS_FIELDS.refreshSeconds.min, TACTICS_FIELDS.refreshSeconds.max);
  adjust('defenseLookahead', predictionScale);
  const variation = base.styleVariation * (difficulty < 1 ? 1.25 : difficulty > 1 ? 0.8 : 1);
  const label = `${preferences.aggression > 0.65 ? 'Aggressive' : preferences.aggression < 0.35 ? 'Cautious' : 'Balanced'} / ${preferences.patience > 0.65 ? 'patient' : preferences.patience < 0.35 ? 'quick' : 'steady'} / ${preferences.width > 0.65 ? 'wide' : preferences.width < 0.35 ? 'compact' : 'standard width'}`;
  return { tuning, plan: { team, label, preferences, confidence, observations: samples.length, pressure, opponentWidth, adapting,
    reason: !base.adaptationEnabled ? 'Adaptation disabled' : !base.adaptationStrength ? 'Adaptation strength is zero' : !adapting ? 'Collecting consistent movement observations' : `Respond to ${pressure >= 0.5 ? 'fast' : 'patient'} approaches and ${opponentWidth < 0.5 ? 'compact' : 'wide'} lanes`,
    difficulty, refreshSeconds: tuning.refreshSeconds, predictionScale, variation } };
}

/** Keyed hash avoids consuming combat randomness and remains stable across roster iteration order. */
function preference(seed: number, key: string): number {
  let hash = seed >>> 0;
  for (let i = 0; i < key.length; i++) hash = Math.imul(hash ^ key.charCodeAt(i), 16777619) >>> 0;
  hash ^= hash >>> 16; hash = Math.imul(hash, 0x7feb352d); hash ^= hash >>> 15;
  hash = Math.imul(hash, 0x846ca68b); hash ^= hash >>> 16;
  return (hash >>> 0) / 4294967296;
}
/** Callers filter safety constraints first; quality loss cannot exceed the explicit score window. */
export function chooseTacticalAlternative<T>(choices: T[], score: (item: T) => number, id: (item: T) => string, choice?: TacticalChoice): T | undefined {
  const best = choices.reduce<T | undefined>((best, item) => Number.isFinite(score(item)) && (!best || score(item) > score(best)) ? item : best, undefined);
  if (!best || !choice || choice.window <= 0) return best;
  return choices.filter(item => Number.isFinite(score(item)) && score(item) >= score(best) - choice.window)
    .sort((a, b) => preference(choice.seed, `${choice.key}:${id(b)}`) - preference(choice.seed, `${choice.key}:${id(a)}`) || id(a).localeCompare(id(b)))[0];
}
