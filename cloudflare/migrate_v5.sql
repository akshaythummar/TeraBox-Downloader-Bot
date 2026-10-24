-- Schema v5: /videos messages are deleted from the chat after VIDEO_DELETE_HOURS (default 24)
--   npx wrangler d1 execute terabox-bot-eu --remote --file migrate_v5.sql
ALTER TABLE users ADD COLUMN vmsgs TEXT;
ALTER TABLE users ADD COLUMN vdel_at INTEGER;
CREATE INDEX IF NOT EXISTS users_vdel ON users (vdel_at) WHERE vdel_at IS NOT NULL;
