-- iBrawls D1 — accounts phase 1.
-- Activates the `accounts` stub from 0001_init.sql into a real auth table and adds
-- a `sessions` table for persistent login. Purely additive: existing columns
-- (id / handle / created_at / last_seen) and the cloud_saves table are untouched.
-- SQLite ADD COLUMN cannot declare UNIQUE inline, so uniqueness is enforced via
-- the case-insensitive indexes below.

ALTER TABLE accounts ADD COLUMN email TEXT;
ALTER TABLE accounts ADD COLUMN username TEXT;
ALTER TABLE accounts ADD COLUMN password_hash TEXT;
ALTER TABLE accounts ADD COLUMN password_salt TEXT;
ALTER TABLE accounts ADD COLUMN recovery_code TEXT;            -- plaintext 4 digits (shown to owner)
ALTER TABLE accounts ADD COLUMN username_changed_at INTEGER;
ALTER TABLE accounts ADD COLUMN email_changed_at INTEGER;
ALTER TABLE accounts ADD COLUMN password_changed_at INTEGER;
ALTER TABLE accounts ADD COLUMN recovery_fail_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE accounts ADD COLUMN recovery_locked_until INTEGER;

CREATE UNIQUE INDEX IF NOT EXISTS idx_accounts_email    ON accounts (email    COLLATE NOCASE);
CREATE UNIQUE INDEX IF NOT EXISTS idx_accounts_username ON accounts (username COLLATE NOCASE);

-- Persistent login. Only the SHA-256 of the bearer token is stored, so a DB
-- read alone cannot reconstruct a usable session token.
CREATE TABLE IF NOT EXISTS sessions (
  token_hash  TEXT    PRIMARY KEY,
  account_id  TEXT    NOT NULL,
  created_at  INTEGER NOT NULL,
  expires_at  INTEGER NOT NULL,
  last_seen   INTEGER
);

CREATE INDEX IF NOT EXISTS idx_sessions_account ON sessions (account_id);
