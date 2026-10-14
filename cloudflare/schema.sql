CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,          -- Telegram user id
  name TEXT,
  username TEXT,
  joined INTEGER NOT NULL,         -- unix seconds
  referred_by INTEGER,
  premium_until INTEGER NOT NULL DEFAULT 0,
  banned INTEGER NOT NULL DEFAULT 0
);

-- one row per link resolved; drives the free-tier hourly limit and /stats (pruned after 7 days)
CREATE TABLE IF NOT EXISTS views (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  surl TEXT NOT NULL,
  ts INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS views_user_ts ON views (user_id, ts);
CREATE INDEX IF NOT EXISTS views_ts ON views (ts);

CREATE TABLE IF NOT EXISTS broadcasts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  from_chat INTEGER NOT NULL,
  msg_id INTEGER NOT NULL,
  cursor INTEGER NOT NULL DEFAULT 0,  -- last user id sent to
  sent INTEGER NOT NULL DEFAULT 0,
  done INTEGER NOT NULL DEFAULT 0
);
