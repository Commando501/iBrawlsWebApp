-- Per-account lifetime player stats. The payload is the generic stat-counter
-- JSON ({ totals: { statId: number }, modes: { modeKey: { statId: number } } });
-- the worker folds client deltas into it without knowing individual stat ids,
-- so new stats never need a schema change.
CREATE TABLE IF NOT EXISTS player_stats (
  account_id TEXT PRIMARY KEY,
  payload TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
