-- One-time copy from the old Redis-style tables (kv, hashes, sets, sorted_sets, lists) into schema v2.
-- Run AFTER schema.sql. The old tables are left untouched (backup / rollback); drop them once v2 is proven.
--   npx wrangler d1 execute terabox-bot-eu --remote --file schema.sql
--   npx wrangler d1 execute terabox-bot-eu --remote --file migrate_v2.sql
-- Python stored numbers as "17.0", hence CAST(CAST(x AS REAL) AS INTEGER).

-- ---- users: everyone the old keys mention, then one UPDATE … FROM per source ----
-- (each source row is read once: D1's free plan also counts rows read, 5M/day)
-- one statement per source: D1 allows only a few terms in a compound SELECT (UNION)
INSERT INTO users (id) SELECT id FROM (SELECT CAST(member AS INTEGER) id FROM sets WHERE key IN ('all_known_users', 'banned_users', 'dynamic_admins', 'premium_users') AND member GLOB '[0-9]*') WHERE id > 0 ON CONFLICT (id) DO NOTHING;
INSERT INTO users (id) SELECT id FROM (SELECT CAST(field AS INTEGER) id FROM hashes WHERE key IN ('premium_expiry', 'custom_tags', 'custom_thumbs', 'ref:ok', 'ref:last_reward') AND field GLOB '[0-9]*') WHERE id > 0 ON CONFLICT (id) DO NOTHING;
INSERT INTO users (id) SELECT id FROM (SELECT DISTINCT CAST(substr(key, 13) AS INTEGER) id FROM hashes WHERE key GLOB 'video_state:[0-9]*') WHERE id > 0 ON CONFLICT (id) DO NOTHING;
INSERT INTO users (id) SELECT id FROM (SELECT DISTINCT CAST(substr(key, 12) AS INTEGER) id FROM hashes WHERE key GLOB 'user_stats_[0-9]*') WHERE id > 0 ON CONFLICT (id) DO NOTHING;
INSERT INTO users (id) SELECT id FROM (SELECT CAST(substr(key, 14) AS INTEGER) id FROM kv WHERE key GLOB 'member_since:[0-9]*') WHERE id > 0 ON CONFLICT (id) DO NOTHING;
INSERT INTO users (id) SELECT id FROM (SELECT CAST(substr(key, 9) AS INTEGER) id FROM kv WHERE key GLOB 'history_[0-9]*') WHERE id > 0 ON CONFLICT (id) DO NOTHING;
INSERT INTO users (id) SELECT id FROM (SELECT CAST(substr(key, 13) AS INTEGER) id FROM kv WHERE key GLOB 'gc_redeemed_[0-9]*') WHERE id > 0 ON CONFLICT (id) DO NOTHING;
INSERT INTO users (id) SELECT id FROM (SELECT CAST(substr(key, 11) AS INTEGER) id FROM kv WHERE key GLOB 'user_lang_[0-9]*') WHERE id > 0 ON CONFLICT (id) DO NOTHING;
INSERT INTO users (id) SELECT id FROM (SELECT CAST(substr(key, 8) AS INTEGER) id FROM kv WHERE key GLOB 'ref:by:[0-9]*') WHERE id > 0 ON CONFLICT (id) DO NOTHING;

-- /videos state (video_state:<id> hash)
UPDATE users SET v_idx = COALESCE(s.v_idx, 0), v_last = s.v_last, v_pos = s.v_pos, v_start = s.v_start, trial_at = s.trial_at,
                 sub_until = s.sub_until, sub_checked = s.sub_checked, registered = COALESCE(s.registered, 0)
FROM (SELECT CAST(substr(key, 13) AS INTEGER) id,
        CAST(CAST(MAX(CASE WHEN field = 'video_index' THEN value END) AS REAL) AS INTEGER) v_idx,
        CAST(MAX(CASE WHEN field = 'last_video_time' THEN value END) AS REAL) v_last,
        CAST(MAX(CASE WHEN field = 'vid_pos' THEN value END) AS REAL) v_pos,
        CAST(MAX(CASE WHEN field = 'vid_start' THEN value END) AS REAL) v_start,
        CAST(MAX(CASE WHEN field = 'trial_start_time' THEN value END) AS REAL) trial_at,
        CAST(CAST(MAX(CASE WHEN field = 'sub_until' THEN value END) AS REAL) AS INTEGER) sub_until,
        CAST(CAST(MAX(CASE WHEN field = 'sub_checked' THEN value END) AS REAL) AS INTEGER) sub_checked,
        MAX(CASE WHEN field = 'registered' AND CAST(value AS REAL) = 1 THEN 1 END) registered
      FROM hashes WHERE key GLOB 'video_state:[0-9]*' GROUP BY key) s
WHERE users.id = s.id;

-- download stats (user_stats_<id> hash)
UPDATE users SET dl_attempts = COALESCE(s.a, 0), dl_ok = COALESCE(s.ok, s.total, 0), dl_failed = COALESCE(s.f, 0), dl_bytes = COALESCE(s.b, 0), last_activity = s.la
FROM (SELECT CAST(substr(key, 12) AS INTEGER) id,
        CAST(CAST(MAX(CASE WHEN field = 'attempts' THEN value END) AS REAL) AS INTEGER) a,
        CAST(CAST(MAX(CASE WHEN field = 'success' THEN value END) AS REAL) AS INTEGER) ok,
        CAST(CAST(MAX(CASE WHEN field = 'total' THEN value END) AS REAL) AS INTEGER) total,
        CAST(CAST(MAX(CASE WHEN field = 'failed' THEN value END) AS REAL) AS INTEGER) f,
        CAST(CAST(MAX(CASE WHEN field = 'storage' THEN value END) AS REAL) AS INTEGER) b,
        MAX(CASE WHEN field = 'last_activity' THEN value END) la
      FROM hashes WHERE key GLOB 'user_stats_[0-9]*' GROUP BY key) s
WHERE users.id = s.id;

-- per-user hashes: premium, tag, thumb, referral counts
UPDATE users SET premium_until = CAST(CAST(h.value AS REAL) AS INTEGER) FROM hashes h WHERE h.key = 'premium_expiry' AND users.id = CAST(h.field AS INTEGER);
UPDATE users SET tag = h.value FROM hashes h WHERE h.key = 'custom_tags' AND users.id = CAST(h.field AS INTEGER);
UPDATE users SET thumb = h.value FROM hashes h WHERE h.key = 'custom_thumbs' AND users.id = CAST(h.field AS INTEGER);
UPDATE users SET ref_ok = CAST(CAST(h.value AS REAL) AS INTEGER) FROM hashes h WHERE h.key = 'ref:ok' AND users.id = CAST(h.field AS INTEGER);
UPDATE users SET ref_reward = CAST(CAST(h.value AS REAL) AS INTEGER) FROM hashes h WHERE h.key = 'ref:last_reward' AND users.id = CAST(h.field AS INTEGER);
-- sets: banned, dynamic admins
UPDATE users SET banned = 1 FROM sets s WHERE s.key = 'banned_users' AND users.id = CAST(s.member AS INTEGER);
UPDATE users SET admin = 1 FROM sets s WHERE s.key = 'dynamic_admins' AND users.id = CAST(s.member AS INTEGER);
-- per-user kv keys (only ones that haven't expired)
UPDATE users SET joined = k.value FROM kv k WHERE k.key GLOB 'member_since:[0-9]*' AND users.id = CAST(substr(k.key, 14) AS INTEGER);
UPDATE users SET history = k.value FROM kv k WHERE k.key GLOB 'history_[0-9]*' AND (k.expires_at IS NULL OR k.expires_at > CAST(strftime('%s', 'now') AS REAL)) AND users.id = CAST(substr(k.key, 9) AS INTEGER);
UPDATE users SET gc_redeemed = 1 FROM kv k WHERE k.key GLOB 'gc_redeemed_[0-9]*' AND users.id = CAST(substr(k.key, 13) AS INTEGER);
UPDATE users SET lang = k.value FROM kv k WHERE k.key GLOB 'user_lang_[0-9]*' AND users.id = CAST(substr(k.key, 11) AS INTEGER);
UPDATE users SET hourly_n = CAST(CAST(k.value AS REAL) AS INTEGER), hourly_until = CAST(k.expires_at AS INTEGER)
FROM kv k WHERE k.key GLOB 'check_[0-9]*' AND k.expires_at > CAST(strftime('%s', 'now') AS REAL) AND users.id = CAST(substr(k.key, 7) AS INTEGER);
UPDATE users SET ref_by = CAST(k.value AS INTEGER) FROM kv k WHERE k.key GLOB 'ref:by:[0-9]*' AND users.id = CAST(substr(k.key, 8) AS INTEGER);
UPDATE users SET ref_pending = 1 FROM sets s WHERE s.key GLOB 'ref:pending:*' AND users.id = CAST(s.member AS INTEGER) AND users.ref_by = CAST(substr(s.key, 13) AS INTEGER);
-- premium reminders already sent: the strongest live flag wins
UPDATE users SET reminded = r.stage
FROM (SELECT CAST(substr(key, instr(key, ':') + 1) AS INTEGER) id,
        CASE MAX(CASE WHEN key GLOB 'reminder_expired:*' THEN 3 WHEN key GLOB 'reminder_1d:*' THEN 2 ELSE 1 END) WHEN 3 THEN 'expired' WHEN 2 THEN '1d' ELSE '3d' END stage
      FROM kv WHERE key GLOB 'reminder_*' AND (expires_at IS NULL OR expires_at > CAST(strftime('%s', 'now') AS REAL)) GROUP BY 1) r
WHERE users.id = r.id;
-- ---- each /videos user's 200 links ----
INSERT INTO video_lists (id, links)
SELECT CAST(substr(key, 13) AS INTEGER), value FROM hashes WHERE key GLOB 'video_state:[0-9]*' AND field = 'video_links' AND value IS NOT NULL
ON CONFLICT (id) DO NOTHING;

-- ---- pool videos with a Telegram file_id (value: {"u","f"} JSON, or an older bare file_id) ----
INSERT INTO videos (md5, url, file_id, ready)
SELECT h.field,
  CASE WHEN json_valid(h.value) THEN json_extract(h.value, '$.u') END,
  CASE WHEN json_valid(h.value) THEN json_extract(h.value, '$.f') ELSE h.value END,
  (SELECT score FROM sorted_sets WHERE key = 'vid_ready' AND member = h.field)
FROM hashes h WHERE h.key = 'vid_meta'
ON CONFLICT (md5) DO NOTHING;

-- ---- /search library ----
INSERT INTO library (name, entries) SELECT field, value FROM hashes WHERE key = 'lib:index' AND value IS NOT NULL ON CONFLICT (name) DO NOTHING;

-- ---- gift cards: used ("uid:time:days"), then available (code -> days) ----
INSERT INTO gift_cards (code, days, tag, used_by, used_at)
SELECT field,
  CAST(substr(rest, instr(rest, ':') + 1) AS INTEGER),
  (SELECT value FROM hashes WHERE key = 'gc_tags' AND field = g.field),
  CAST(substr(value, 1, instr(value, ':') - 1) AS INTEGER),
  CAST(substr(rest, 1, instr(rest, ':') - 1) AS INTEGER)
FROM (SELECT field, value, substr(value, instr(value, ':') + 1) rest FROM hashes WHERE key = 'gc_used') g WHERE true
ON CONFLICT (code) DO NOTHING;
INSERT INTO gift_cards (code, days, tag)
SELECT field, CAST(CAST(value AS REAL) AS INTEGER), (SELECT value FROM hashes WHERE key = 'gc_tags' AND field = g.field)
FROM hashes g WHERE key = 'gift_cards' AND CAST(value AS TEXT) GLOB '[0-9]*'
ON CONFLICT (code) DO NOTHING;

-- ---- panel graph: users per hour (act:YYYYMMDDHH sets) ----
INSERT INTO activity (hour, uid)
SELECT CAST(substr(key, 5) AS INTEGER), CAST(member AS INTEGER) FROM sets WHERE key GLOB 'act:[0-9]*' AND member GLOB '[0-9]*'
ON CONFLICT DO NOTHING;

-- ---- counters ----
INSERT INTO counters (day, name, n)   -- daily funnel
SELECT substr(key, 8), field, CAST(CAST(value AS REAL) AS INTEGER) FROM hashes WHERE key GLOB 'funnel:*'
ON CONFLICT (day, name) DO NOTHING;
INSERT INTO counters (day, name, n)   -- messages per hour: msgs:YYYYMMDD field HH
SELECT substr(key, 6, 4) || '-' || substr(key, 10, 2) || '-' || substr(key, 12, 2), 'msgs:' || field, CAST(CAST(value AS REAL) AS INTEGER)
FROM hashes WHERE key GLOB 'msgs:[0-9]*'
ON CONFLICT (day, name) DO NOTHING;
INSERT INTO counters (day, name, n)   -- users per hour
SELECT substr(key, 5, 4) || '-' || substr(key, 9, 2) || '-' || substr(key, 11, 2), 'act:' || substr(key, 13, 2), COUNT(*)
FROM sets WHERE key GLOB 'act:[0-9]*' GROUP BY key
ON CONFLICT (day, name) DO NOTHING;
INSERT INTO counters (day, name, n)
SELECT 'all', field, CAST(CAST(value AS REAL) AS INTEGER) FROM hashes WHERE key = 'bot_stats' AND field IN ('total_downloads', 'lib_hits')
ON CONFLICT (day, name) DO NOTHING;
INSERT INTO counters (day, name, n)
SELECT 'all', substr(key, 7), CAST(CAST(value AS REAL) AS INTEGER) FROM kv WHERE key IN ('stats:broadcasts', 'stats:boot_count')
ON CONFLICT (day, name) DO NOTHING;
INSERT INTO counters (day, name, n) SELECT 'all', 'total_users', COUNT(*) FROM users WHERE true
ON CONFLICT (day, name) DO UPDATE SET n = excluded.n;

-- ---- popular links ----
INSERT INTO counters (day, name, n) SELECT 'link', member, CAST(score AS INTEGER) FROM sorted_sets WHERE key = 'link_counts' ON CONFLICT (day, name) DO NOTHING;

-- ---- logs, oldest first (lpush kept the newest at the lowest position) ----
INSERT INTO logs (kind, line) SELECT 'bot', value FROM lists WHERE key = 'bot_log' ORDER BY position DESC;
INSERT INTO logs (kind, line) SELECT 'audit', value FROM lists WHERE key = 'audit_log' ORDER BY position DESC;

-- ---- settings / short-lived state ----
INSERT INTO store (key, value, expires_at)
SELECT key, value, CAST(expires_at AS INTEGER) FROM kv
WHERE (expires_at IS NULL OR expires_at > CAST(strftime('%s', 'now') AS REAL))
  AND key NOT GLOB 'member_since:*' AND key NOT GLOB 'history_*' AND key NOT GLOB 'gc_redeemed_*' AND key NOT GLOB 'reminder_*'
  AND key NOT GLOB 'check_*' AND key NOT GLOB 'user_lang_*' AND key NOT GLOB 'ref:*' AND key NOT GLOB 'active_*'
  AND key NOT GLOB 'stats:*' AND key NOT GLOB 'tbposter:*' AND key <> 'bc_lock'
ON CONFLICT (key) DO NOTHING;
INSERT INTO store (key, value) SELECT 'config_overrides', json_group_object(field, value) FROM hashes WHERE key = 'config_overrides' HAVING COUNT(*) > 0
ON CONFLICT (key) DO NOTHING;
INSERT INTO store (key, value) SELECT 'bot_channel:' || field, value FROM hashes WHERE key = 'bot_channels'
ON CONFLICT (key) DO NOTHING;
