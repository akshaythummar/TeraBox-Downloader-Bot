-- The likes database (binding LIKES, terabox-bot-likes): liked reels + one thumbnail per video, kept
-- apart from the bot's database so it never fills it up.
--   npx wrangler d1 execute terabox-bot-likes --remote --file likes_schema.sql
-- vid = a Reels video (md5) or a /str stream ("code:fid").

-- one row per like; unlike = delete. Primary key only (no extra index = 1 row written per like).
CREATE TABLE IF NOT EXISTS likes (uid INTEGER NOT NULL, vid TEXT NOT NULL, at INTEGER NOT NULL, PRIMARY KEY (uid, vid)) WITHOUT ROWID;

-- one ~3 KB JPEG per video, grabbed by the first liker's phone; first one wins, never replaced
CREATE TABLE IF NOT EXISTS thumbs (vid TEXT PRIMARY KEY, jpg BLOB NOT NULL);
