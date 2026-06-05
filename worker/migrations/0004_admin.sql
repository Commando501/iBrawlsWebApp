-- iBrawls D1 — admin accounts.
-- Adds an `is_admin` flag to the accounts table so an account can be granted
-- admin privileges (Admin Dashboard, publishing the Official Multiplayer Preset).
-- Promotion is performed via POST /api/account/promote using the deployment's
-- shared ADMIN_TOKEN secret; thereafter the flag is sticky on the account.
-- Purely additive — existing columns and tables are untouched.

ALTER TABLE accounts ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0;
