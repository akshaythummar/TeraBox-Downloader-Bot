"""Turso (libSQL) backed drop-in replacement for the subset of the redis-py
API this bot actually uses. Keeps every existing `db.get/set/hset/...` call
site unchanged — only main.py's `db = ...` construction changes.

Backed by 5 normalized tables (not one JSON blob per key) so counters like
hincrby stay atomic under concurrent access (single UPSERT statement per op,
via SQLite's `INSERT ... ON CONFLICT ... RETURNING`).

TTL (Redis' `ex=`) is emulated with an `expires_at` column, checked lazily on
every read. `nx=True` (SETNX) is emulated via `ON CONFLICT DO NOTHING` +
checking rows_affected — same atomicity guarantee, single round trip. This
matters: utils/jobs.py's in-flight download dedup lock depends on it.

Synchronous by design (matches the ~150 existing call sites, none of which
`await`) — every call is a real network round trip and blocks the caller.
Accepted trade-off; see the plan for the async follow-up if this becomes a
bottleneck in practice.
"""

import time

import libsql_client

SCHEMA = (
    "CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT, expires_at REAL)",
    "CREATE TABLE IF NOT EXISTS hashes (key TEXT NOT NULL, field TEXT NOT NULL, value TEXT, "
    "PRIMARY KEY (key, field))",
    "CREATE TABLE IF NOT EXISTS sets (key TEXT NOT NULL, member TEXT NOT NULL, "
    "PRIMARY KEY (key, member))",
    "CREATE TABLE IF NOT EXISTS sorted_sets (key TEXT NOT NULL, member TEXT NOT NULL, "
    "score REAL NOT NULL, PRIMARY KEY (key, member))",
    "CREATE TABLE IF NOT EXISTS lists (key TEXT NOT NULL, position INTEGER NOT NULL, "
    "value TEXT, PRIMARY KEY (key, position))",
)


class TursoRedis:
    def __init__(self, url, auth_token, **kwargs):
        # libsql:// maps to the websocket transport, which fails the handshake
        # (HTTP 400) against some Turso instances — the HTTP transport works
        # reliably, so translate rather than make callers change their URL.
        if url.startswith("libsql://"):
            url = "https://" + url[len("libsql://"):]
        self._c = libsql_client.create_client_sync(url, auth_token=auth_token, **kwargs)
        try:
            # libsql_client's sync bridge runs a non-daemon background thread —
            # without this, an unhandled crash before close() hangs the process forever.
            self._c._executor._thread.daemon = True
        except Exception:
            pass
        for stmt in SCHEMA:
            self._c.execute(stmt)

    def close(self):
        self._c.close()

    def ping(self):
        self._c.execute("SELECT 1")
        return True

    def batch(self, statements):
        """Run several independent (sql, params) statements in ONE round trip.
        Use for fire-and-forget writes whose results don't depend on each other."""
        return self._c.batch(statements)

    def track_activity(self, today_key, member_since_key, today_str, user_set_key, member):
        """Combine per-message tracking (daily-active incr, member-since-once,
        new-user check) into one round trip instead of three. Returns
        (is_first_message_today, is_new_user) so the caller can do the rare
        follow-ups (expire / sadd+hincrby) only when they're actually needed."""
        member = str(member)
        results = self._c.batch([
            ("INSERT INTO kv(key, value) VALUES (?, '1') "
             "ON CONFLICT(key) DO UPDATE SET value = CAST(CAST(value AS INTEGER) + 1 AS TEXT) "
             "RETURNING value", [today_key]),
            ("INSERT INTO kv(key, value) VALUES (?, ?) ON CONFLICT(key) DO NOTHING",
             [member_since_key, today_str]),
            ("SELECT 1 FROM sets WHERE key = ? AND member = ? LIMIT 1", [user_set_key, member]),
        ])
        is_first_today = int(results[0].rows[0]["value"]) == 1
        is_new_user = not results[2].rows
        return is_first_today, is_new_user

    # ---- internal helpers ----

    def _now(self):
        return time.time()

    def _purge_expired(self, key):
        self._c.execute(
            "DELETE FROM kv WHERE key = ? AND expires_at IS NOT NULL AND expires_at < ?",
            [key, self._now()],
        )

    # ---- strings ----

    def get(self, key):
        self._purge_expired(key)
        rs = self._c.execute("SELECT value FROM kv WHERE key = ?", [key])
        return rs.rows[0]["value"] if rs.rows else None

    def set(self, key, value, ex=None, nx=None):
        expires_at = self._now() + float(ex) if ex else None
        if nx:
            self._purge_expired(key)
            rs = self._c.execute(
                "INSERT INTO kv(key, value, expires_at) VALUES (?, ?, ?) "
                "ON CONFLICT(key) DO NOTHING",
                [key, str(value), expires_at],
            )
            return rs.rows_affected == 1
        self._c.execute(
            "INSERT INTO kv(key, value, expires_at) VALUES (?, ?, ?) "
            "ON CONFLICT(key) DO UPDATE SET value = excluded.value, expires_at = excluded.expires_at",
            [key, str(value), expires_at],
        )
        return True

    def delete(self, *keys):
        count = 0
        for key in keys:
            for table in ("kv", "hashes", "sets", "sorted_sets", "lists"):
                rs = self._c.execute(f"DELETE FROM {table} WHERE key = ?", [key])
                count += max(rs.rows_affected, 0)
        return count

    def incr(self, key):
        rs = self._c.execute(
            "INSERT INTO kv(key, value) VALUES (?, '1') "
            "ON CONFLICT(key) DO UPDATE SET value = CAST(CAST(value AS INTEGER) + 1 AS TEXT) "
            "RETURNING value",
            [key],
        )
        return int(rs.rows[0]["value"])

    def ttl(self, key):
        self._purge_expired(key)
        rs = self._c.execute("SELECT expires_at FROM kv WHERE key = ?", [key])
        if not rs.rows:
            return -2
        expires_at = rs.rows[0]["expires_at"]
        if expires_at is None:
            return -1
        remaining = expires_at - self._now()
        return int(remaining) if remaining > 0 else -2

    def expire(self, key, seconds):
        rs = self._c.execute(
            "UPDATE kv SET expires_at = ? WHERE key = ?",
            [self._now() + float(seconds), key],
        )
        return rs.rows_affected > 0

    def exists(self, key):
        self._purge_expired(key)
        for table in ("kv", "hashes", "sets", "sorted_sets", "lists"):
            rs = self._c.execute(f"SELECT 1 FROM {table} WHERE key = ? LIMIT 1", [key])
            if rs.rows:
                return 1
        return 0

    def scan_iter(self, match=None, count=None):
        pattern = (match or "*").replace("*", "%").replace("?", "_")
        seen = set()
        for table in ("kv", "hashes"):
            rs = self._c.execute(f"SELECT DISTINCT key FROM {table} WHERE key LIKE ?", [pattern])
            for row in rs.rows:
                k = row["key"]
                if k not in seen:
                    seen.add(k)
                    yield k

    # ---- hashes ----

    def hget(self, key, field):
        rs = self._c.execute("SELECT value FROM hashes WHERE key = ? AND field = ?", [key, field])
        return rs.rows[0]["value"] if rs.rows else None

    def hset(self, key, field, value):
        self._c.execute(
            "INSERT INTO hashes(key, field, value) VALUES (?, ?, ?) "
            "ON CONFLICT(key, field) DO UPDATE SET value = excluded.value",
            [key, field, str(value)],
        )
        return 1

    def hgetall(self, key):
        rs = self._c.execute("SELECT field, value FROM hashes WHERE key = ?", [key])
        return {row["field"]: row["value"] for row in rs.rows}

    def hdel(self, key, *fields):
        count = 0
        for field in fields:
            rs = self._c.execute("DELETE FROM hashes WHERE key = ? AND field = ?", [key, field])
            count += max(rs.rows_affected, 0)
        return count

    def hincrby(self, key, field, amount=1):
        amount = int(amount)
        rs = self._c.execute(
            "INSERT INTO hashes(key, field, value) VALUES (?, ?, ?) "
            "ON CONFLICT(key, field) DO UPDATE SET value = CAST(CAST(value AS INTEGER) + ? AS TEXT) "
            "RETURNING value",
            [key, field, str(amount), amount],
        )
        return int(rs.rows[0]["value"])

    def hexists(self, key, field):
        rs = self._c.execute("SELECT 1 FROM hashes WHERE key = ? AND field = ? LIMIT 1", [key, field])
        return bool(rs.rows)

    def hlen(self, key):
        rs = self._c.execute("SELECT COUNT(*) AS n FROM hashes WHERE key = ?", [key])
        return int(rs.rows[0]["n"]) if rs.rows else 0

    # ---- sets ----

    def sismember(self, key, member):
        rs = self._c.execute("SELECT 1 FROM sets WHERE key = ? AND member = ? LIMIT 1", [key, str(member)])
        return bool(rs.rows)

    def sadd(self, key, *members):
        count = 0
        for member in members:
            rs = self._c.execute(
                "INSERT INTO sets(key, member) VALUES (?, ?) ON CONFLICT(key, member) DO NOTHING",
                [key, str(member)],
            )
            count += max(rs.rows_affected, 0)
        return count

    def srem(self, key, *members):
        count = 0
        for member in members:
            rs = self._c.execute("DELETE FROM sets WHERE key = ? AND member = ?", [key, str(member)])
            count += max(rs.rows_affected, 0)
        return count

    def smembers(self, key):
        rs = self._c.execute("SELECT member FROM sets WHERE key = ?", [key])
        return {row["member"] for row in rs.rows}

    def scard(self, key):
        rs = self._c.execute("SELECT COUNT(*) AS n FROM sets WHERE key = ?", [key])
        return int(rs.rows[0]["n"]) if rs.rows else 0

    # ---- sorted sets ----

    def zadd(self, key, mapping):
        count = 0
        for member, score in dict(mapping).items():
            rs = self._c.execute(
                "INSERT INTO sorted_sets(key, member, score) VALUES (?, ?, ?) "
                "ON CONFLICT(key, member) DO UPDATE SET score = excluded.score",
                [key, str(member), float(score)],
            )
            count += max(rs.rows_affected, 0)
        return count

    def zincrby(self, key, amount, member):
        rs = self._c.execute(
            "INSERT INTO sorted_sets(key, member, score) VALUES (?, ?, ?) "
            "ON CONFLICT(key, member) DO UPDATE SET score = score + ? "
            "RETURNING score",
            [key, str(member), float(amount), float(amount)],
        )
        return float(rs.rows[0]["score"])

    def _zrange(self, key, start, end, withscores, desc):
        order = "DESC" if desc else "ASC"
        rs = self._c.execute(f"SELECT member, score FROM sorted_sets WHERE key = ? ORDER BY score {order}", [key])
        rows = rs.rows
        n = len(rows)
        lo = start if start >= 0 else max(n + start, 0)
        hi = (end + 1) if end >= 0 else (n + end + 1)
        hi = min(hi, n)
        sliced = rows[lo:hi] if lo < n else []
        if withscores:
            return [(row["member"], float(row["score"])) for row in sliced]
        return [row["member"] for row in sliced]

    def zrange(self, key, start, end, withscores=False):
        return self._zrange(key, start, end, withscores, desc=False)

    def zrevrange(self, key, start, end, withscores=False):
        return self._zrange(key, start, end, withscores, desc=True)

    def zremrangebyrank(self, key, start, end):
        """Remove members ranked start..end (ascending by score, inclusive) — e.g.
        (0, -501) drops the lowest-scoring members, keeping only the top 500."""
        rs = self._c.execute("SELECT member FROM sorted_sets WHERE key = ? ORDER BY score ASC", [key])
        members = [row["member"] for row in rs.rows]
        n = len(members)
        lo = start if start >= 0 else max(n + start, 0)
        hi = (end + 1) if end >= 0 else (n + end + 1)
        hi = min(hi, n)
        to_delete = members[lo:hi] if lo < n else []
        count = 0
        for m in to_delete:
            r = self._c.execute("DELETE FROM sorted_sets WHERE key = ? AND member = ?", [key, m])
            count += max(r.rows_affected, 0)
        return count

    # ---- lists ----

    def _list_push(self, key, values, front):
        n = 0
        for value in values:
            rs = self._c.execute(
                "SELECT MIN(position) AS lo, MAX(position) AS hi FROM lists WHERE key = ?", [key]
            )
            row = rs.rows[0]
            lo, hi = row["lo"], row["hi"]
            if front:
                pos = (lo - 1) if lo is not None else 0
            else:
                pos = (hi + 1) if hi is not None else 0
            self._c.execute(
                "INSERT INTO lists(key, position, value) VALUES (?, ?, ?)",
                [key, pos, str(value)],
            )
            n += 1
        rs = self._c.execute("SELECT COUNT(*) AS n FROM lists WHERE key = ?", [key])
        return int(rs.rows[0]["n"])

    def rpush(self, key, *values):
        return self._list_push(key, values, front=False)

    def lpush(self, key, *values):
        return self._list_push(key, values, front=True)

    def lrange(self, key, start, end):
        rs = self._c.execute("SELECT value FROM lists WHERE key = ? ORDER BY position ASC", [key])
        rows = [row["value"] for row in rs.rows]
        n = len(rows)
        lo = start if start >= 0 else max(n + start, 0)
        hi = (end + 1) if end >= 0 else (n + end + 1)
        hi = min(hi, n)
        return rows[lo:hi] if lo < n else []

    def ltrim(self, key, start, end):
        """Keep only positions start..end (inclusive), drop everything else."""
        rs = self._c.execute("SELECT position FROM lists WHERE key = ? ORDER BY position ASC", [key])
        positions = [row["position"] for row in rs.rows]
        n = len(positions)
        lo = start if start >= 0 else max(n + start, 0)
        hi = (end + 1) if end >= 0 else (n + end + 1)
        hi = min(hi, n)
        keep = set(positions[lo:hi]) if lo < n else set()
        for p in positions:
            if p not in keep:
                self._c.execute("DELETE FROM lists WHERE key = ? AND position = ?", [key, p])
        return True
