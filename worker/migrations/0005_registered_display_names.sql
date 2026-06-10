-- iBrawls D1 - registered display names.
-- Each account can reserve one public nameplate base name. The owner renders
-- the plain name; non-owners using that base are shown with a session suffix.

CREATE TABLE IF NOT EXISTS registered_display_names (
  account_id      TEXT    PRIMARY KEY,
  display_name    TEXT    NOT NULL,
  normalized_name TEXT    NOT NULL,
  updated_at      INTEGER NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_registered_display_names_normalized
  ON registered_display_names (normalized_name COLLATE NOCASE);
