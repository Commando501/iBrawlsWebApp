/* iBrawls D1 migration 0003 — replay manifest (catalog) for the behavior-cloning
   training corpus. Replay BLOBS live in R2; this table is the small queryable index
   so the offline download script can enumerate and selectively pull replays.
   sha256 is the hash of the ORIGINAL (decompressed) replay JSON, so the download step
   can verify nothing was corrupted in compression / transit / storage.
   NOTE: no line ("--") comments — they break if the SQL is run with newlines stripped
   (e.g. pasted into the dashboard D1 console). Block comments are newline-safe. */
CREATE TABLE IF NOT EXISTS replay_index (
  id TEXT PRIMARY KEY,
  anon_id TEXT,
  created_at INTEGER NOT NULL,
  duration_s REAL,
  players INTEGER,
  map TEXT,
  mode TEXT,
  game_mode TEXT,
  r2_key TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  schema_version INTEGER
);
CREATE INDEX IF NOT EXISTS idx_replay_index_created ON replay_index (created_at);
CREATE INDEX IF NOT EXISTS idx_replay_index_anon ON replay_index (anon_id);
