-- Schema v4: daily free /videos (DAILY_FREE_VIDEOS, default 5 a day after the trial is claimed)
--   npx wrangler d1 execute terabox-bot-eu --remote --file migrate_v4.sql
ALTER TABLE users ADD COLUMN free_day TEXT;
