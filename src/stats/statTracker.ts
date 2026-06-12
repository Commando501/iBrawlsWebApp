import { getLocalPlayerFeedName } from '../components/grifball/deathFeed';
import type { DeathEvent, GameStats } from '../types';
import { STAT_RULES } from './statRules';
import {
  applyDeltaToProfile,
  createEmptyProfile,
  loadPendingDelta,
  loadProfile,
  loadWinStreak,
  mergeDeltas,
  parseStoredProfile,
  saveProfile,
  savePendingDelta,
  saveWinStreak,
} from './statStore';
import {
  createEmptyDelta,
  isDeltaEmpty,
  type MatchContext,
  type MatchOutcome,
  type MatchSummary,
  type PlayerStatsProfile,
  type StatContribution,
  type StatDelta,
  type StatEvent,
  type StatModeKey,
} from './statTypes';

/**
 * Runtime stat tracker.
 *
 * Single integration point: it observes the per-frame GameStats snapshots the
 * app already pushes (offline and online share that pipeline), diffs the
 * counters into discrete gameplay events, feeds the rule engine, and commits
 * contributions to the local profile + the pending cloud delta.
 *
 * Event-level stats (kills, deaths, medals, goals) commit the moment they
 * happen so nothing is lost if the match is abandoned or the tab closes.
 * Match-level stats (wins/losses, time played, personal bests, complex rules)
 * commit once when the match ends.
 */

export interface BeginMatchOptions {
  isMultiplayer: boolean;
  gameMode: 'sandbox' | 'grifball';
  singlePlayerMode?: 'sandbox' | 'tournament' | 'ai-editor';
}

interface MatchTrackerState {
  context: MatchContext;
  ended: boolean;
  // Frame diff baselines
  prevKills: number;
  prevDeaths: number;
  prevGameTime: number | null;
  prevTeamGoals: number;
  prevConcededGoals: number;
  seenDeathEventIds: Set<string>;
  // Per-match accumulators for the summary
  kills: number;
  deaths: number;
  medals: number;
  teamGoals: number;
  goalsConceded: number;
  maxDeficit: number;
  timePlayedSeconds: number;
  // Rule scratchpads keyed by rule id
  scratch: Map<string, Record<string, number>>;
}

export function resolveModeKey(options: BeginMatchOptions): StatModeKey {
  if (options.isMultiplayer) {
    return options.gameMode === 'grifball' ? 'online:grifball' : 'online:sandbox';
  }
  if (options.singlePlayerMode === 'tournament') return 'offline:tournament';
  return options.gameMode === 'grifball' ? 'offline:grifball' : 'offline:sandbox';
}

/** Attacker weapon family from a death-feed event, if attributable. */
export function classifyKillWeapon(weapon: DeathEvent['weapon'] | undefined, activeWeapon: string): string | null {
  if (weapon) {
    if (weapon.startsWith('sword')) return 'sword';
    if (weapon.startsWith('hammer')) return 'hammer';
    return null;
  }
  if (activeWeapon === 'pistol') return 'pistol';
  if (activeWeapon === 'sword') return 'sword';
  if (activeWeapon === 'hammer') return 'hammer';
  return null;
}

const SAVE_DEBOUNCE_MS = 1500;

/** Heuristic for "a brand-new match just started" (all progress reset). */
function isFreshMatchFrame(stats: GameStats): boolean {
  if (stats.grifball && stats.grifball.phase === 'matchEnd') return false;
  return (
    (stats.playerKills ?? 0) === 0 &&
    (stats.playerDeaths ?? 0) === 0 &&
    (stats.scorePlayer ?? 0) === 0 &&
    (stats.scoreEnemy ?? 0) === 0 &&
    (stats.gameTime ?? 0) > 0
  );
}

export class StatTracker {
  private profile: PlayerStatsProfile | null = null;
  private pending: StatDelta | null = null;
  private inFlight: StatDelta | null = null;
  private match: MatchTrackerState | null = null;
  private lastBeginOptions: BeginMatchOptions | null = null;
  private winStreak: number | null = null;
  private listeners = new Set<() => void>();
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private version = 0;

  // ── Lazy persisted state ───────────────────────────────────────────────────
  private ensureLoaded(): void {
    if (this.profile === null) this.profile = loadProfile();
    if (this.pending === null) this.pending = loadPendingDelta();
    if (this.winStreak === null) this.winStreak = loadWinStreak();
  }

  getProfile(): PlayerStatsProfile {
    this.ensureLoaded();
    return this.profile!;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Monotonic change counter — stable snapshot key for useSyncExternalStore. */
  getVersion(): number {
    return this.version;
  }

  private notify(): void {
    this.version += 1;
    this.listeners.forEach((listener) => {
      try {
        listener();
      } catch {
        /* listener errors must not break gameplay */
      }
    });
  }

  private scheduleSave(): void {
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      this.persistNow();
    }, SAVE_DEBOUNCE_MS);
  }

  private persistNow(): void {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    if (this.profile) saveProfile(this.profile);
    if (this.pending) savePendingDelta(this.pending);
  }

  // ── Match lifecycle ────────────────────────────────────────────────────────

  beginMatch(options: BeginMatchOptions): void {
    this.ensureLoaded();
    this.lastBeginOptions = options;
    // A new match while one is open means the previous one was torn down
    // without an explicit end — close it as abandoned first.
    if (this.match && !this.match.ended) this.endMatch('abandoned');

    const context: MatchContext = {
      mode: resolveModeKey(options),
      isMultiplayer: options.isMultiplayer,
      gameMode: options.gameMode,
      startedAt: Date.now(),
    };
    const scratch = new Map<string, Record<string, number>>();
    for (const rule of STAT_RULES) {
      scratch.set(rule.id, rule.createScratch ? rule.createScratch() : {});
    }
    this.match = {
      context,
      ended: false,
      prevKills: 0,
      prevDeaths: 0,
      prevGameTime: null,
      prevTeamGoals: 0,
      prevConcededGoals: 0,
      seenDeathEventIds: new Set(),
      kills: 0,
      deaths: 0,
      medals: 0,
      teamGoals: 0,
      goalsConceded: 0,
      maxDeficit: 0,
      timePlayedSeconds: 0,
      scratch,
    };
  }

  hasActiveMatch(): boolean {
    return this.match !== null && !this.match.ended;
  }

  /**
   * Observe one HUD stats frame. Replays and observer mode are ignored, as is
   * everything outside an active match.
   */
  observeFrame(stats: GameStats): void {
    if (stats.isReplayMode || stats.isObserverMode) return;

    // Back-to-back matches (tournament rounds, online rematches) don't toggle
    // the app-level playing flag — when a fresh match state appears after the
    // tracked one ended, re-arm with the same context.
    if (this.match?.ended && this.lastBeginOptions && isFreshMatchFrame(stats)) {
      this.beginMatch(this.lastBeginOptions);
    }

    const match = this.match;
    if (!match || match.ended) return;

    const contributions: StatContribution[] = [];
    const events: StatEvent[] = [];

    // ── Kills / deaths from counter diffs (covers every code path) ─────────
    const kills = stats.playerKills ?? 0;
    const deaths = stats.playerDeaths ?? 0;
    const killsDelta = kills - match.prevKills;
    const deathsDelta = deaths - match.prevDeaths;
    // Negative deltas mean the runtime re-baselined (round reset, host
    // correction) — adopt the new baseline without emitting events.
    match.prevKills = kills;
    match.prevDeaths = deaths;

    // New death-feed entries enrich kill events with weapon + medals.
    const localFeedName = getLocalPlayerFeedName(stats.settings?.playerName, stats.multiplayerRole);
    const newLocalKillFeed: DeathEvent[] = [];
    for (const death of stats.lastDeaths ?? []) {
      if (match.seenDeathEventIds.has(death.id)) continue;
      match.seenDeathEventIds.add(death.id);
      if (death.attacker === localFeedName && death.victim !== localFeedName) {
        newLocalKillFeed.push(death);
      }
    }
    if (match.seenDeathEventIds.size > 512) {
      // lastDeaths only ever holds the 3 newest entries; trim the dedupe set.
      const keep = new Set((stats.lastDeaths ?? []).map((d) => d.id));
      match.seenDeathEventIds = keep;
    }

    if (killsDelta > 0) {
      newLocalKillFeed.reverse(); // feed is newest-first; consume oldest-first
      for (let i = 0; i < killsDelta; i++) {
        const feed = newLocalKillFeed[i];
        const weapon = classifyKillWeapon(feed?.weapon, stats.activeWeapon);
        const medals = (feed?.medals ?? []).map((m) => m.id);
        match.kills += 1;
        contributions.push({ statId: 'combat.kills', value: 1, merge: 'sum' });
        if (weapon === 'sword') contributions.push({ statId: 'combat.swordKills', value: 1, merge: 'sum' });
        if (weapon === 'hammer') contributions.push({ statId: 'combat.hammerKills', value: 1, merge: 'sum' });
        if (weapon === 'pistol') contributions.push({ statId: 'combat.pistolKills', value: 1, merge: 'sum' });
        if (feed?.weapon && feed.weapon.includes('_vs_')) {
          contributions.push({ statId: 'combat.tradeKills', value: 1, merge: 'sum' });
        }
        events.push({ type: 'kill', weapon, medals });
        for (const medalId of medals) {
          match.medals += 1;
          contributions.push({ statId: `medal.${medalId}`, value: 1, merge: 'sum' });
          contributions.push({ statId: 'combat.medals', value: 1, merge: 'sum' });
          events.push({ type: 'medal', medalId });
        }
      }
    }

    if (deathsDelta > 0) {
      for (let i = 0; i < deathsDelta; i++) {
        match.deaths += 1;
        contributions.push({ statId: 'combat.deaths', value: 1, merge: 'sum' });
        events.push({ type: 'death' });
      }
    }

    // ── Grifball goals ──────────────────────────────────────────────────────
    const grifball = stats.grifball;
    if (grifball) {
      const localTeam = grifball.localTeam;
      const teamGoals = localTeam === 'red' ? grifball.redGoals : grifball.blueGoals;
      const concededGoals = localTeam === 'red' ? grifball.blueGoals : grifball.redGoals;
      const teamGoalsDelta = teamGoals - match.prevTeamGoals;
      const concededDelta = concededGoals - match.prevConcededGoals;
      match.prevTeamGoals = teamGoals;
      match.prevConcededGoals = concededGoals;
      if (teamGoalsDelta > 0) {
        match.teamGoals += teamGoalsDelta;
        contributions.push({ statId: 'objective.teamGoals', value: teamGoalsDelta, merge: 'sum' });
        for (let i = 0; i < teamGoalsDelta; i++) events.push({ type: 'teamGoal' });
      }
      if (concededDelta > 0) {
        match.goalsConceded += concededDelta;
        contributions.push({ statId: 'objective.goalsConceded', value: concededDelta, merge: 'sum' });
        for (let i = 0; i < concededDelta; i++) events.push({ type: 'goalConceded' });
      }
      match.maxDeficit = Math.max(match.maxDeficit, concededGoals - teamGoals);
    } else {
      match.maxDeficit = Math.max(match.maxDeficit, (stats.scoreEnemy ?? 0) - (stats.scorePlayer ?? 0));
    }

    // ── Time played (the match timer counts down while playing) ────────────
    if (typeof stats.gameTime === 'number') {
      if (match.prevGameTime !== null) {
        const elapsed = match.prevGameTime - stats.gameTime;
        if (elapsed > 0 && elapsed < 60) match.timePlayedSeconds += elapsed;
      }
      match.prevGameTime = stats.gameTime;
    }

    // ── Rule engine ─────────────────────────────────────────────────────────
    for (const event of events) {
      for (const rule of STAT_RULES) {
        if (!rule.onEvent) continue;
        const out = rule.onEvent(event, this.match!.scratch.get(rule.id)!, match.context);
        if (out) contributions.push(...out);
      }
    }

    if (contributions.length > 0) {
      this.commit(match.context.mode, contributions);
    }

    // ── Frame-derived match end (covers offline + both online roles) ───────
    const detected = this.detectMatchEnd(stats);
    if (detected) this.endMatch(detected);
  }

  /**
   * Generic win/loss detection from the frame itself. Explicit endMatch calls
   * (tournament flow, host broadcast) take precedence because they fire first;
   * this catches everything else, including the multiplayer client side.
   */
  private detectMatchEnd(stats: GameStats): MatchOutcome | null {
    const grifball = stats.grifball;
    if (grifball) {
      if (grifball.phase !== 'matchEnd') return null;
      if (!grifball.winningTeam) return 'draw';
      return grifball.winningTeam === grifball.localTeam ? 'win' : 'loss';
    }

    const scorePlayer = stats.scorePlayer ?? 0;
    const scoreEnemy = stats.scoreEnemy ?? 0;
    const target = stats.settings?.iBrawlsKillTarget ?? 0;
    const targetReached = target > 0 && (scorePlayer >= target || scoreEnemy >= target);
    const timerExpired = typeof stats.gameTime === 'number' && stats.gameTime <= 0;
    if (!targetReached && !timerExpired) return null;
    if (scorePlayer === scoreEnemy) return 'draw';
    return scorePlayer > scoreEnemy ? 'win' : 'loss';
  }

  /** Close the active match. Safe to call repeatedly; only the first counts. */
  endMatch(outcome: MatchOutcome): void {
    const match = this.match;
    if (!match || match.ended) return;
    match.ended = true;
    this.ensureLoaded();

    const summary: MatchSummary = {
      context: match.context,
      outcome,
      kills: match.kills,
      deaths: match.deaths,
      medals: match.medals,
      teamGoals: match.teamGoals,
      goalsConceded: match.goalsConceded,
      maxDeficit: match.maxDeficit,
      timePlayedSeconds: Math.round(match.timePlayedSeconds),
    };

    const contributions: StatContribution[] = [];
    if (outcome === 'abandoned') {
      contributions.push({ statId: 'match.abandoned', value: 1, merge: 'sum' });
    } else {
      contributions.push({ statId: 'match.played', value: 1, merge: 'sum' });
      if (outcome === 'win') contributions.push({ statId: 'match.wins', value: 1, merge: 'sum' });
      if (outcome === 'loss') contributions.push({ statId: 'match.losses', value: 1, merge: 'sum' });
      if (outcome === 'draw') contributions.push({ statId: 'match.draws', value: 1, merge: 'sum' });
    }
    if (summary.timePlayedSeconds > 0) {
      contributions.push({ statId: 'match.timePlayed', value: summary.timePlayedSeconds, merge: 'sum' });
    }

    // Win streak (device-local working counter; only the record syncs).
    if (outcome === 'win') {
      this.winStreak = (this.winStreak ?? 0) + 1;
      contributions.push({ statId: 'best.winStreak', value: this.winStreak, merge: 'max' });
      saveWinStreak(this.winStreak);
    } else if (outcome === 'loss' || outcome === 'draw') {
      this.winStreak = 0;
      saveWinStreak(0);
    }

    if (outcome !== 'abandoned') {
      for (const rule of STAT_RULES) {
        if (!rule.onMatchEnd) continue;
        const out = rule.onMatchEnd(summary, match.scratch.get(rule.id)!);
        if (out) contributions.push(...out);
      }
    }

    this.commit(match.context.mode, contributions);
    this.persistNow();
  }

  // ── Commit pipeline ────────────────────────────────────────────────────────

  private commit(mode: StatModeKey, contributions: StatContribution[]): void {
    if (contributions.length === 0) return;
    this.ensureLoaded();
    const delta = createEmptyDelta();
    const modeEntry = (delta.modes[mode] = { sums: {}, maxes: {} });
    for (const { statId, value, merge } of contributions) {
      if (!Number.isFinite(value) || value <= 0) continue;
      if (merge === 'sum') {
        delta.sums[statId] = (delta.sums[statId] ?? 0) + value;
        modeEntry.sums[statId] = (modeEntry.sums[statId] ?? 0) + value;
      } else {
        delta.maxes[statId] = Math.max(delta.maxes[statId] ?? 0, value);
        modeEntry.maxes[statId] = Math.max(modeEntry.maxes[statId] ?? 0, value);
      }
    }
    if (isDeltaEmpty(delta)) return;
    applyDeltaToProfile(this.profile!, delta);
    mergeDeltas(this.pending!, delta);
    this.scheduleSave();
    this.notify();
  }

  // ── Cloud sync integration ─────────────────────────────────────────────────

  /** Snapshot pending changes and mark them in-flight. Null if nothing to push. */
  beginFlush(): StatDelta | null {
    this.ensureLoaded();
    if (this.inFlight) return this.inFlight; // previous push unresolved — retry it
    if (isDeltaEmpty(this.pending!)) return null;
    this.inFlight = this.pending!;
    this.pending = createEmptyDelta();
    savePendingDelta(this.pending);
    return this.inFlight;
  }

  /** Push failed — fold the in-flight delta back into pending for retry. */
  abortFlush(): void {
    if (!this.inFlight) return;
    this.ensureLoaded();
    this.pending = mergeDeltas(this.inFlight, this.pending!);
    this.inFlight = null;
    savePendingDelta(this.pending);
  }

  /**
   * Push succeeded: adopt the server's merged totals as truth, then re-apply
   * whatever accumulated locally while the request was running.
   */
  completeFlush(serverPayload: unknown): void {
    this.inFlight = null;
    this.adoptServerProfile(serverPayload);
  }

  /** Replace the profile with server totals + any local pending delta. */
  adoptServerProfile(serverPayload: unknown): void {
    this.ensureLoaded();
    const server = parseStoredProfile(
      typeof serverPayload === 'string' ? serverPayload : JSON.stringify(serverPayload ?? null)
    );
    const next = createEmptyProfile(Date.now());
    next.createdAt = Math.min(this.profile!.createdAt, server.createdAt);
    next.totals = server.totals;
    next.modes = server.modes;
    if (this.inFlight) applyDeltaToProfile(next, this.inFlight);
    applyDeltaToProfile(next, this.pending!);
    this.profile = next;
    this.persistNow();
    this.notify();
  }

  /** True when there is anything to sync (pending or unresolved in-flight). */
  hasUnsyncedChanges(): boolean {
    this.ensureLoaded();
    return this.inFlight !== null || !isDeltaEmpty(this.pending!);
  }

  /** Flush debounced writes immediately (page hide / unload). */
  flushToStorage(): void {
    this.persistNow();
  }
}

export const statTracker = new StatTracker();
