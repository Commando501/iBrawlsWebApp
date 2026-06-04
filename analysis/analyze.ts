/**
 * Telemetry analysis CLI (offline). Pulls match rows from the Analytics Engine SQL
 * API and prints a Phase 3 (tuning) + Phase 4 (archetype discovery) report.
 *
 * Usage:
 *   CF_ACCOUNT_ID=... CF_AE_API_TOKEN=... npm run analyze -- --since=30 --k=4
 *
 * Safe to run with zero data — it reports "no telemetry yet" and exits cleanly, so
 * the whole pipeline can be wired up and verified before players generate data.
 */

import { credentialsFromEnv, fetchMatchRows, type MatchRow } from './telemetryQuery';
import {
  flagImbalances,
  summarizeFeatures,
  winRateByDimension,
  FINGERPRINT_FEATURES,
} from './stats';
import { suggestTuning } from './suggestTuning';
import { buildCandidateArchetypes } from './archetypeMapping';

// Minimal ambient declaration so this stays dependency-free (no @types/node).
declare const process: {
  env: Record<string, string | undefined>;
  argv: string[];
  exit(code?: number): never;
};

function parseArgs(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const arg of argv) {
    const m = /^--([^=]+)=(.*)$/.exec(arg);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

function header(title: string): void {
  console.log(`\n=== ${title} ===`);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const sinceDays = args.since ? Number(args.since) : 30;
  const k = args.k ? Number(args.k) : 4;
  const limit = args.limit ? Number(args.limit) : 10000;

  const creds = credentialsFromEnv(process.env);
  if (!creds) {
    console.error(
      'Missing credentials. Set CF_ACCOUNT_ID and CF_AE_API_TOKEN (an account API\n' +
        'token with "Account Analytics: Read"). See analysis/README.md.',
    );
    process.exit(1);
  }

  let rows: MatchRow[];
  try {
    rows = await fetchMatchRows(creds, { sinceDays, limit });
  } catch (err) {
    console.error(`Failed to query Analytics Engine: ${(err as Error).message}`);
    process.exit(1);
  }

  console.log(`Analyzed window: last ${sinceDays} day(s). Rows: ${rows.length}.`);
  if (rows.length === 0) {
    console.log('No telemetry yet — the pipeline is wired up and ready for data.');
    return;
  }

  // ── Phase 3: population shape ──────────────────────────────────────────────
  header('Population fingerprint (mean ± std)');
  const summary = summarizeFeatures(rows);
  for (const feature of FINGERPRINT_FEATURES) {
    const s = summary[feature];
    console.log(
      `  ${feature.padEnd(18)} ${s.mean.toFixed(3)} ± ${s.std.toFixed(3)}  ` +
        `[${s.min.toFixed(2)}, ${s.max.toFixed(2)}]`,
    );
  }

  // ── Phase 3: win-rate + imbalance per difficulty / archetype ───────────────
  for (const dim of ['aiDifficulty', 'aiArchetype'] as const) {
    header(`Player win-rate by ${dim}`);
    const winRates = winRateByDimension(rows, dim);
    for (const w of winRates) {
      console.log(
        `  ${w.value.padEnd(16)} winRate ${(w.winRate * 100).toFixed(1)}%  ` +
          `(${w.playerWins}/${w.matches}, avgScoreDiff ${w.avgScoreDiff.toFixed(2)})`,
      );
    }
    const suggestions = suggestTuning(flagImbalances(winRates, dim));
    if (suggestions.length > 0) {
      header(`Tuning suggestions (${dim}) — review, then publish via /api/admin/config`);
      for (const s of suggestions) console.log(`  • ${s.rationale}`);
    }
  }

  // ── Phase 4: discovered archetypes ─────────────────────────────────────────
  header(`Candidate archetypes (k=${k}) — review before adding to AI_ARCHETYPES`);
  const candidates = buildCandidateArchetypes(rows, k);
  for (const c of candidates) {
    console.log(`  • ${c.id} — ${(c.share * 100).toFixed(1)}% of players (${c.matches} matches)`);
  }
  console.log('\nCandidate archetype definitions (JSON):');
  console.log(
    JSON.stringify(
      candidates.map((c) => ({
        id: c.id,
        label: c.label,
        description: c.description,
        knobOverrides: c.knobOverrides,
        flags: c.flags,
      })),
      null,
      2,
    ),
  );
}

main();
