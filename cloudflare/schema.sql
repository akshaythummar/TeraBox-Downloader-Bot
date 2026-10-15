-- Same 5 tables as the Python bot's storage.py (Turso), so a Turso dump imports as-is.
CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT, expires_at REAL);
CREATE TABLE IF NOT EXISTS hashes (key TEXT NOT NULL, field TEXT NOT NULL, value TEXT, PRIMARY KEY (key, field));
CREATE TABLE IF NOT EXISTS sets (key TEXT NOT NULL, member TEXT NOT NULL, PRIMARY KEY (key, member));
CREATE TABLE IF NOT EXISTS sorted_sets (key TEXT NOT NULL, member TEXT NOT NULL, score REAL NOT NULL, PRIMARY KEY (key, member));
CREATE TABLE IF NOT EXISTS lists (key TEXT NOT NULL, position INTEGER NOT NULL, value TEXT, PRIMARY KEY (key, position));
CREATE INDEX IF NOT EXISTS kv_expires ON kv (expires_at);

-- Broadcast queue (/broadcast, /broadcast_legacy, /announce): the cron sends 40 users/minute.
CREATE TABLE IF NOT EXISTS broadcasts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,                 -- broadcast | legacy | announce
  mode TEXT NOT NULL,                 -- forward | text
  text TEXT,
  from_chat INTEGER,
  msg_id INTEGER,
  exclude INTEGER,
  send_at INTEGER NOT NULL DEFAULT 0,
  cursor TEXT NOT NULL DEFAULT '',    -- last all_known_users member sent to
  total INTEGER NOT NULL DEFAULT 0,
  sent INTEGER NOT NULL DEFAULT 0,
  failed INTEGER NOT NULL DEFAULT 0,
  done INTEGER NOT NULL DEFAULT 0,
  status_chat INTEGER,
  status_msg INTEGER
);
