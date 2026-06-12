/**
 * Derive HUMAN behavior bands from real replay files → python/human_baseline.json.
 *
 * The RL eval matrix scores "does the bot move like a person?" against these bands;
 * until this file exists it falls back to hand-tuned defaults. Feed it replays
 * exported from the game (Theater) — each is a ReplayFile JSON with 20Hz frames of
 * the LOCAL HUMAN player's pos/vel/yaw/jump/dash state.
 *
 *   npx tsx scripts/sim/humanBaseline.ts path\to\replays\*.json
 *   npx tsx scripts/sim/humanBaseline.ts path\to\replayFolder --interval 5
 *
 * Replays are resampled at the bot's decision cadence (decision_interval ticks at
 * 60Hz; default 5 → 12 samples/sec) so human and bot stats are measured on the same
 * clock. Observer recordings and (by default) grifball replays are skipped; only the
 * `player` block is used — it is the one entity guaranteed to be a human.
 *
 * Derivation notes (kept honest in the JSON's `notes`):
 * - move id = velocity quantized into idle + 8 ego-relative directions (the bot's
 *   move factor); switch rate = consecutive samples with different move ids.
 * - attack_rate is approximated by ATTACK ENGAGEMENT (weaponState windup/active):
 *   replays store animation state, not button presses. It still upper-bounds what
 *   non-spam play looks like.
 * - action_repeat_rate cannot be derived from replays (no button data) — the
 *   Python default band stays in effect for it.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

interface PlayerSample {
  time: number;
  vx: number; vz: number; yaw: number;
  isJumping: boolean; isDashing: boolean;
  attacking: boolean;
  dead: boolean;
}

interface ReplayMetrics {
  file: string;
  samples: number;
  idle_frac: number;
  move_switch_rate: number;
  jump_rate: number;
  dash_rate: number;
  attack_rate: number;
}

const argvPaths: string[] = [];
let interval = 5;
let includeGrifball = false;
let outPath = path.join('python', 'human_baseline.json');
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (a === '--interval') interval = Math.max(1, parseInt(process.argv[++i] ?? '5', 10) || 5);
  else if (a === '--out') outPath = process.argv[++i] ?? outPath;
  else if (a === '--include-grifball') includeGrifball = true;
  else argvPaths.push(a);
}

function collectFiles(p: string): string[] {
  const st = fs.statSync(p, { throwIfNoEntry: false });
  if (!st) return [];
  if (st.isDirectory()) {
    return fs.readdirSync(p)
      .filter((f) => f.toLowerCase().endsWith('.json'))
      .map((f) => path.join(p, f));
  }
  return [p];
}

/** Resample a replay's `player` track at the decision cadence, carrying state forward. */
function samplePlayer(replay: any, dt: number): PlayerSample[] {
  const frames: any[] = Array.isArray(replay.frames) ? replay.frames : [];
  if (!frames.length) return [];
  const duration = Number(replay.duration) || frames[frames.length - 1].time || 0;
  const out: PlayerSample[] = [];
  let fi = 0;
  let last: any = null;
  for (let t = 0; t <= duration; t += dt) {
    while (fi < frames.length && frames[fi].time <= t) {
      if (frames[fi].player) last = frames[fi].player;
      fi++;
    }
    if (!last) continue;
    out.push({
      time: t,
      vx: Number(last.vel?.x) || 0,
      vz: Number(last.vel?.z) || 0,
      yaw: Number(last.yaw) || 0,
      isJumping: !!last.isJumping,
      isDashing: !!last.isDashing,
      attacking: last.weaponState === 'windup' || last.weaponState === 'active',
      dead: (Number(last.hp) || 0) <= 0 || (Number(last.respawnTimer) || 0) > 0,
    });
  }
  return out;
}

/** Quantize velocity into the bot's move factor: 0 = idle, 1..8 = ego 8-way. */
function moveId(s: PlayerSample): number {
  const speed = Math.hypot(s.vx, s.vz);
  if (speed < 0.75) return 0;
  // Engine forward = (sin yaw, cos yaw); right = (cos yaw, -sin yaw).
  const ef = s.vx * Math.sin(s.yaw) + s.vz * Math.cos(s.yaw);
  const er = s.vx * Math.cos(s.yaw) - s.vz * Math.sin(s.yaw);
  const angle = Math.atan2(er, ef); // 0 = forward, positive = rightward
  const sector = ((Math.round(angle / (Math.PI / 4)) % 8) + 8) % 8;
  return 1 + sector;
}

function analyzeReplay(file: string, dt: number): ReplayMetrics | null {
  let replay: any;
  try {
    replay = JSON.parse(fs.readFileSync(file, 'utf-8'));
  } catch {
    console.error(`  skip (unparseable): ${file}`);
    return null;
  }
  if (replay.recordedAsObserver) {
    console.error(`  skip (observer recording): ${file}`);
    return null;
  }
  if (!includeGrifball && replay.gameMode === 'grifball') {
    console.error(`  skip (grifball; pass --include-grifball to keep): ${file}`);
    return null;
  }
  const samples = samplePlayer(replay, dt).filter((s) => !s.dead);
  if (samples.length < 100) {
    console.error(`  skip (too short: ${samples.length} live samples): ${file}`);
    return null;
  }
  let idle = 0, jump = 0, dash = 0, attack = 0, switches = 0;
  let prevMove: number | null = null;
  for (const s of samples) {
    const m = moveId(s);
    if (m === 0) idle++;
    if (s.isJumping) jump++;
    if (s.isDashing) dash++;
    if (s.attacking) attack++;
    if (prevMove !== null && m !== prevMove) switches++;
    prevMove = m;
  }
  const n = samples.length;
  return {
    file: path.basename(file),
    samples: n,
    idle_frac: idle / n,
    move_switch_rate: switches / Math.max(1, n - 1),
    jump_rate: jump / n,
    dash_rate: dash / n,
    attack_rate: attack / n,
  };
}

function quantile(sorted: number[], q: number): number {
  if (!sorted.length) return 0;
  const idx = (sorted.length - 1) * q;
  const lo = Math.floor(idx), hi = Math.ceil(idx);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

/** Band = p25..p75 across replays, widened 30% each way (few replays = wide bands). */
function band(values: number[]): [number, number] {
  const sorted = [...values].sort((a, b) => a - b);
  const lo = sorted.length >= 4 ? quantile(sorted, 0.25) : sorted[0];
  const hi = sorted.length >= 4 ? quantile(sorted, 0.75) : sorted[sorted.length - 1];
  const width = Math.max(0.02, hi - lo);
  return [
    Math.max(0, +(lo - width * 0.3).toFixed(4)),
    Math.min(1, +(hi + width * 0.3).toFixed(4)),
  ];
}

// ---------------------------------------------------------------------------
const files = argvPaths.flatMap(collectFiles);
if (!files.length) {
  console.error('usage: npx tsx scripts/sim/humanBaseline.ts <replay .json files or folders> '
    + '[--interval 5] [--out python/human_baseline.json] [--include-grifball]');
  process.exit(1);
}

const dt = interval / 60;
console.error(`analyzing ${files.length} file(s) at ${(60 / interval).toFixed(1)} samples/sec ...`);
const results: ReplayMetrics[] = [];
for (const f of files) {
  const r = analyzeReplay(f, dt);
  if (r) {
    results.push(r);
    console.error(`  ${r.file}: ${r.samples} samples — idle ${(r.idle_frac * 100).toFixed(0)}%, `
      + `switch ${(r.move_switch_rate * 100).toFixed(0)}%, jump ${(r.jump_rate * 100).toFixed(0)}%, `
      + `dash ${(r.dash_rate * 100).toFixed(0)}%, attack≈${(r.attack_rate * 100).toFixed(0)}%`);
  }
}
if (!results.length) {
  console.error('no usable replays — nothing written.');
  process.exit(1);
}

const metric = (k: keyof ReplayMetrics) => results.map((r) => r[k] as number);
const payload = {
  version: 1,
  generated: new Date().toISOString(),
  decision_interval: interval,
  sample_hz: +(60 / interval).toFixed(2),
  replays: results.length,
  samples: results.reduce((n, r) => n + r.samples, 0),
  bands: {
    idle_frac: band(metric('idle_frac')),
    move_switch_rate: band(metric('move_switch_rate')),
    jump_rate: band(metric('jump_rate')),
    dash_rate: band(metric('dash_rate')),
    attack_rate: band(metric('attack_rate')),
    // action_repeat_rate: not derivable from replays (no button data) — Python default applies.
  },
  per_replay: results,
  notes: 'attack_rate approximated by weaponState engagement (windup/active), not button presses; '
    + 'move ids quantized from velocity in the ego frame at the decision cadence.',
};

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(payload, null, 1));
console.error(`wrote ${outPath} (${results.length} replays, ${payload.samples} samples)`);
