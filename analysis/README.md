# Telemetry Analysis (Phase 3 + 4)

Offline tooling that turns collected match telemetry into **AI tuning suggestions**
(Phase 3) and **candidate human-like archetypes** (Phase 4). It reads from Workers
Analytics Engine via the SQL API; it never touches the client or the live game.

This is scaffolding — it runs today and reports "no telemetry yet" until players
opt in and generate data.

## How the loop fits together

```
client match-end → Worker /api/telemetry/match → lobby DO governor → Analytics Engine
                                                                          │
                                                              (this tool reads it)
                                                                          ▼
   Phase 3: win-rate by difficulty/archetype → imbalance flags → tuning suggestions
            → publish reviewed values via /api/admin/config (existing live-config)
   Phase 4: cluster fingerprints → candidate archetypes → review → add to AI_ARCHETYPES
```

## Setup

You need an **account-scoped API token** with `Account Analytics: Read`
(Cloudflare dashboard → My Profile → API Tokens). Then:

```bash
export CF_ACCOUNT_ID=<your-account-id>
export CF_AE_API_TOKEN=<token>

npm run analyze -- --since=30 --k=4
```

Flags: `--since=<days>` (default 30), `--k=<clusters>` (default 4),
`--limit=<rows>` (default 10000).

## What it prints

- **Population fingerprint** — mean ± std per behavior feature (the distribution an
  AI should resemble to feel human).
- **Win-rate by `aiDifficulty` / `aiArchetype`** — a balanced AI sits near 50%.
- **Tuning suggestions** — advisory only; a human reviews and publishes via
  `POST /api/admin/config`. Analysis never auto-publishes.
- **Candidate archetypes** — JSON in the `AIPersonalityDef` shape, ready to review
  and paste into `src/game/aiPersonalities.ts` (then follow the Custom AI Behavior
  exposure convention: panel + presets + RosterSlotConfig + archetype fill).

## Schema single-source (important)

Analytics Engine stores data **positionally** (`blob1`, `double6`, …). The column
layout is defined once in [`../worker/src/telemetrySchema.ts`](../worker/src/telemetrySchema.ts):
the Worker writes via `toAnalyticsDataPoint()` and this tool reads via
`analyticsSqlSelectColumns()` — both from the same ordered arrays, so producer and
consumer can't drift.

**Append-only:** never reorder/remove schema fields (it silently re-maps historical
rows). Add new fields to the end and bump `TELEMETRY_FINGERPRINT_SCHEMA` on the
client so analysis can segment by schema version.

## Replay corpus (behavior cloning)

Opt-in full match replays are gzipped client-side, uploaded to **R2** (blobs) with a
row in the D1 `replay_index` catalog (metadata + SHA-256 of the original JSON).
Download them for offline training with:

```bash
WORKER_URL=https://<your-worker> ADMIN_TOKEN=<token> \
  npm run download:replays -- --out=./replays --limit=2000
```

Each blob is gunzipped and its SHA-256 re-verified against the manifest before being
written — a corrupted replay is reported and skipped, never silently trained on.
gzip is lossless, so the decompressed JSON is byte-identical to what was recorded.

## Files

| File | Role |
|---|---|
| `telemetryQuery.ts` | AE SQL API client + query builder |
| `stats.ts` | Pure stats: distributions, win-rate, imbalance flags, k-means |
| `suggestTuning.ts` | Phase 3: imbalance flags → advisory tuning suggestions |
| `archetypeMapping.ts` | Phase 4: cluster centroid → candidate archetype knobs/flags |
| `analyze.ts` | CLI that ties it together and prints the report |
| `downloadReplays.mjs` | Download + integrity-verify the replay corpus from R2 |
| `*.test.ts` | Unit tests (run via the root `npm test`) |

## Tests / typecheck

```bash
npm test                  # includes analysis/*.test.ts
npm run typecheck:analysis
```
