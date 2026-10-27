-- Schema v6: videos whose stream (Watch Online / HLS) was made, for the /str stream test
--   npx wrangler d1 execute terabox-bot-eu --remote --file migrate_v6.sql
CREATE TABLE IF NOT EXISTS streams (
  code TEXT NOT NULL,                -- TeraBox share code (the /m3u8 s)
  fid TEXT NOT NULL,                 -- fs_id of the video in that share (the /m3u8 f)
  name TEXT,                         -- file name (the player's title)
  fails INTEGER NOT NULL DEFAULT 0,  -- didn't play in /str; 3 = left out
  PRIMARY KEY (code, fid)
) WITHOUT ROWID;
