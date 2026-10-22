-- Schema v2. Built for D1's free plan, which counts every table row AND every index entry written
-- (100k/day) and every row scanned (5M/day):
--  * one row per user: updating any number of a user's columns is 1 row written
--  * INTEGER PRIMARY KEY / WITHOUT ROWID: no hidden second index to keep in sync
--  * the few secondary indexes are partial (WHERE …), so only the rows they cover cost a write
-- Data from the old Redis-style tables (kv, hashes, sets, sorted_sets, lists) is copied by migrate_v2.sql.

-- Every Telegram user that ever talked to the bot (also the broadcast list).
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,                 -- Telegram user id
  joined TEXT,                            -- first seen, YYYY-MM-DD (NULL: imported from Telebot Creator)
  premium_until INTEGER,                  -- unix seconds; NULL = not premium
  reminded TEXT,                          -- premium reminder already sent for this premium: 3d | 1d | expired
  banned INTEGER NOT NULL DEFAULT 0,
  admin INTEGER NOT NULL DEFAULT 0,       -- added with /addadmin (config admins live in wrangler.toml)
  tag TEXT,
  lang TEXT,
  thumb TEXT,                             -- /setthumb photo file_id
  gc_redeemed INTEGER NOT NULL DEFAULT 0, -- redeemed a gift card (one per active premium)
  ref_by INTEGER,                         -- who invited this user
  ref_pending INTEGER NOT NULL DEFAULT 0, -- 1 = invited but hasn't joined the force channels yet
  ref_ok INTEGER NOT NULL DEFAULT 0,      -- friends this user brought in
  ref_reward INTEGER NOT NULL DEFAULT 0,  -- last milestone tier rewarded
  dl_attempts INTEGER NOT NULL DEFAULT 0, -- links: attempts / sent / failed / bytes
  dl_ok INTEGER NOT NULL DEFAULT 0,
  dl_failed INTEGER NOT NULL DEFAULT 0,
  dl_bytes INTEGER NOT NULL DEFAULT 0,
  last_activity TEXT,
  history TEXT,                           -- JSON array, last 50 files
  hourly_n INTEGER NOT NULL DEFAULT 0,    -- FREE_HOURLY_LIMIT window (only used when the limit is on)
  hourly_until INTEGER,
  v_idx INTEGER NOT NULL DEFAULT 0,       -- /videos: position in the user's 200 links (video_lists)
  v_last REAL,                            -- /videos: last request (cooldown)
  v_pos REAL,                             -- /videos: position in the pre-uploaded list (videos.ready)
  v_start REAL,
  trial_at REAL,                          -- /videos trial start
  trial_n INTEGER NOT NULL DEFAULT 0,     -- /videos trial videos used (VIDEOS_TRIAL_VIDEOS, default 5)
  sub_until INTEGER,                      -- paid /videos subscription end (payment worker)
  sub_checked INTEGER,
  sub_rem TEXT,                           -- renew reminder sent for this sub_until: soon | ended
  registered INTEGER NOT NULL DEFAULT 0   -- registered with the payment worker
);
CREATE INDEX IF NOT EXISTS users_premium ON users (premium_until) WHERE premium_until IS NOT NULL;
CREATE INDEX IF NOT EXISTS users_ref ON users (ref_by) WHERE ref_by IS NOT NULL;
CREATE INDEX IF NOT EXISTS users_ref_ok ON users (ref_ok) WHERE ref_ok > 0;   -- /top leaderboard
CREATE INDEX IF NOT EXISTS users_banned ON users (banned) WHERE banned = 1;
CREATE INDEX IF NOT EXISTS users_admin ON users (admin) WHERE admin = 1;
CREATE INDEX IF NOT EXISTS users_sub ON users (sub_until) WHERE sub_until IS NOT NULL;   -- renew reminders

-- Each /videos user's 200 links (big JSON, kept out of the users row that every request reads).
CREATE TABLE IF NOT EXISTS video_lists (id INTEGER PRIMARY KEY, links TEXT NOT NULL);

-- Pool videos Telegram already has: file_id = instant resend. ready = upload order of pre-uploaded ones.
CREATE TABLE IF NOT EXISTS videos (md5 TEXT PRIMARY KEY, url TEXT, file_id TEXT, ready REAL) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS videos_ready ON videos (ready) WHERE ready IS NOT NULL;

-- /search library: normalized file name -> up to 5 {s, f, name, size, bytes}
CREATE TABLE IF NOT EXISTS library (name TEXT PRIMARY KEY, entries TEXT NOT NULL) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS gift_cards (
  code TEXT PRIMARY KEY,
  days INTEGER NOT NULL,                  -- 0 = permanent
  tag TEXT,
  used_by INTEGER,                        -- NULL = still available
  used_at INTEGER
) WITHOUT ROWID;

-- Users seen per IST hour (hour = YYYYMMDDHH) for the panel graph; the cron keeps 48h.
CREATE TABLE IF NOT EXISTS activity (hour INTEGER NOT NULL, uid INTEGER NOT NULL, PRIMARY KEY (hour, uid)) WITHOUT ROWID;

-- Counters. day = IST YYYY-MM-DD (funnel: new_users, links, videos…; msgs:HH / act:HH per hour)
-- or 'all' (total_users, total_downloads, lib_hits, broadcasts, boot_count) or 'link' (name = share code, /stats popular links; top 500 kept).
-- The worker adds them up in memory and writes them every ~2 minutes.
CREATE TABLE IF NOT EXISTS counters (day TEXT NOT NULL, name TEXT NOT NULL, n INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (day, name)) WITHOUT ROWID;

-- kind = bot (/logs, panel errors; ~500 kept) | audit (/auditlog; 1000 kept)
CREATE TABLE IF NOT EXISTS logs (id INTEGER PRIMARY KEY, kind TEXT NOT NULL, line TEXT NOT NULL);

-- Settings and short-lived state: maintenance_mode, videos_free_mode, config_overrides (JSON),
-- terabox_cfg:*, panel:*, custom_plan_text, tbshare:<code> (resolver cache), vid_order:<uid>,
-- lib:search:<uid>, bc_lock, bot_channel:<id>. expires_at = unix seconds, NULL = never.
CREATE TABLE IF NOT EXISTS store (key TEXT PRIMARY KEY, value TEXT, expires_at INTEGER) WITHOUT ROWID;

-- Broadcast queue (/broadcast, /broadcast_legacy, /announce, panel): the cron sends ~25 users/second.
CREATE TABLE IF NOT EXISTS broadcasts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,                     -- broadcast | legacy | announce
  mode TEXT NOT NULL,                     -- forward | text
  text TEXT,
  from_chat INTEGER,
  msg_id INTEGER,
  exclude INTEGER,
  send_at INTEGER NOT NULL DEFAULT 0,
  cursor TEXT NOT NULL DEFAULT '',        -- last users.id sent to
  total INTEGER NOT NULL DEFAULT 0,
  sent INTEGER NOT NULL DEFAULT 0,
  failed INTEGER NOT NULL DEFAULT 0,
  done INTEGER NOT NULL DEFAULT 0,
  status_chat INTEGER,
  status_msg INTEGER
);
