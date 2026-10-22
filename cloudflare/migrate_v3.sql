-- Schema v3 on top of v2 (already in schema.sql for new databases):
--   trial_n  = /videos trial videos used (the trial is now 5 videos instead of 3 minutes)
--   sub_rem  = renew reminder already sent for the current paid plan (soon | ended)
--   npx wrangler d1 execute terabox-bot-eu --remote --file migrate_v3.sql
ALTER TABLE users ADD COLUMN trial_n INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN sub_rem TEXT;
-- everyone who already started the old 3-minute trial has used it
UPDATE users SET trial_n = 5 WHERE trial_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS users_sub ON users (sub_until) WHERE sub_until IS NOT NULL;
