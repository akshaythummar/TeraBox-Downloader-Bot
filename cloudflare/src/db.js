// Async port of storage.py (TursoRedis) on D1 — same 5 tables, same key names,
// so a Turso dump imports straight into D1 and every Python key keeps working.

const now = () => Date.now() / 1000;

export class DB {
  constructor(d1) {
    this.d = d1;
  }
  q(sql, ...args) {
    return this.d.prepare(sql).bind(...args);
  }
  async one(sql, ...args) {
    return this.q(sql, ...args).first();
  }
  async all(sql, ...args) {
    return (await this.q(sql, ...args).all()).results;
  }
  async run(sql, ...args) {
    return (await this.q(sql, ...args).run()).meta.changes;
  }

  // ---- strings ----
  async get(key) {
    const r = await this.one('SELECT value, expires_at FROM kv WHERE key = ?', key);
    if (!r) return null;
    if (r.expires_at != null && r.expires_at < now()) {
      await this.run('DELETE FROM kv WHERE key = ? AND expires_at < ?', key, now());
      return null;
    }
    return r.value;
  }
  async set(key, value, { ex, nx } = {}) {
    const exp = ex ? now() + Number(ex) : null;
    if (nx) {
      await this.run('DELETE FROM kv WHERE key = ? AND expires_at IS NOT NULL AND expires_at < ?', key, now());
      return (await this.run('INSERT INTO kv(key, value, expires_at) VALUES (?, ?, ?) ON CONFLICT(key) DO NOTHING', key, String(value), exp)) === 1;
    }
    await this.run(
      'INSERT INTO kv(key, value, expires_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, expires_at = excluded.expires_at',
      key, String(value), exp
    );
    return true;
  }
  async delete(...keys) {
    let n = 0;
    for (const key of keys) {
      const res = await this.d.batch(['kv', 'hashes', 'sets', 'sorted_sets', 'lists'].map(t => this.q(`DELETE FROM ${t} WHERE key = ?`, key)));
      n += res.reduce((a, r) => a + r.meta.changes, 0);
    }
    return n;
  }
  async incr(key) {
    const r = await this.one(
      "INSERT INTO kv(key, value) VALUES (?, '1') ON CONFLICT(key) DO UPDATE SET value = CAST(CAST(value AS INTEGER) + 1 AS TEXT) RETURNING value", key
    );
    return +r.value;
  }
  async ttl(key) {
    const r = await this.one('SELECT expires_at FROM kv WHERE key = ?', key);
    if (!r) return -2;
    if (r.expires_at == null) return -1;
    const left = r.expires_at - now();
    return left > 0 ? Math.floor(left) : -2;
  }
  async expire(key, seconds) {
    return (await this.run('UPDATE kv SET expires_at = ? WHERE key = ?', now() + Number(seconds), key)) > 0;
  }
  async exists(key) {
    if ((await this.get(key)) != null) return 1;
    for (const t of ['hashes', 'sets', 'sorted_sets', 'lists'])
      if (await this.one(`SELECT 1 FROM ${t} WHERE key = ? LIMIT 1`, key)) return 1;
    return 0;
  }
  // Redis glob -> LIKE (same translation as storage.py); kv + hashes only, like scan_iter
  async scan(match) {
    const p = match.replace(/\*/g, '%').replace(/\?/g, '_');
    const rows = await this.all('SELECT DISTINCT key FROM kv WHERE key LIKE ?1 UNION SELECT DISTINCT key FROM hashes WHERE key LIKE ?1', p);
    return rows.map(r => r.key);
  }

  // ---- hashes ----
  async hget(key, field) {
    return (await this.one('SELECT value FROM hashes WHERE key = ? AND field = ?', key, String(field)))?.value ?? null;
  }
  async hset(key, field, value) {
    await this.run('INSERT INTO hashes(key, field, value) VALUES (?, ?, ?) ON CONFLICT(key, field) DO UPDATE SET value = excluded.value', key, String(field), String(value));
    return 1;
  }
  async hgetall(key) {
    return Object.fromEntries((await this.all('SELECT field, value FROM hashes WHERE key = ?', key)).map(r => [r.field, r.value]));
  }
  async hdel(key, ...fields) {
    let n = 0;
    for (const f of fields) n += await this.run('DELETE FROM hashes WHERE key = ? AND field = ?', key, String(f));
    return n;
  }
  async hincrby(key, field, amount = 1) {
    const r = await this.one(
      'INSERT INTO hashes(key, field, value) VALUES (?, ?, ?) ON CONFLICT(key, field) DO UPDATE SET value = CAST(CAST(value AS INTEGER) + ? AS TEXT) RETURNING value',
      key, String(field), String(amount), amount
    );
    return +r.value;
  }
  async hexists(key, field) {
    return !!(await this.one('SELECT 1 FROM hashes WHERE key = ? AND field = ? LIMIT 1', key, String(field)));
  }
  async hlen(key) {
    return (await this.one('SELECT COUNT(*) n FROM hashes WHERE key = ?', key)).n;
  }

  // ---- sets ----
  async sismember(key, member) {
    return !!(await this.one('SELECT 1 FROM sets WHERE key = ? AND member = ? LIMIT 1', key, String(member)));
  }
  async sadd(key, ...members) {
    let n = 0;
    for (const m of members) n += await this.run('INSERT INTO sets(key, member) VALUES (?, ?) ON CONFLICT DO NOTHING', key, String(m));
    return n;
  }
  async srem(key, ...members) {
    let n = 0;
    for (const m of members) n += await this.run('DELETE FROM sets WHERE key = ? AND member = ?', key, String(m));
    return n;
  }
  async smembers(key) {
    return (await this.all('SELECT member FROM sets WHERE key = ?', key)).map(r => r.member);
  }
  async scard(key) {
    return (await this.one('SELECT COUNT(*) n FROM sets WHERE key = ?', key)).n;
  }

  // ---- sorted sets ----
  async zadd(key, member, score) {
    await this.run('INSERT INTO sorted_sets(key, member, score) VALUES (?, ?, ?) ON CONFLICT(key, member) DO UPDATE SET score = excluded.score', key, String(member), +score);
  }
  async zincrby(key, amount, member) {
    return (await this.one(
      'INSERT INTO sorted_sets(key, member, score) VALUES (?, ?, ?) ON CONFLICT(key, member) DO UPDATE SET score = score + ? RETURNING score',
      key, String(member), amount, amount
    )).score;
  }
  async zrevrange(key, n) {
    return (await this.all('SELECT member, score FROM sorted_sets WHERE key = ? ORDER BY score DESC LIMIT ?', key, n)).map(r => [r.member, r.score]);
  }
  async zrange(key) {
    return (await this.all('SELECT member, score FROM sorted_sets WHERE key = ? ORDER BY score ASC', key)).map(r => [r.member, r.score]);
  }
  // keep only the top `keep` members (Python: zremrangebyrank(key, 0, -(keep+1)))
  async ztrim(key, keep) {
    await this.run('DELETE FROM sorted_sets WHERE key = ?1 AND member NOT IN (SELECT member FROM sorted_sets WHERE key = ?1 ORDER BY score DESC LIMIT ?2)', key, keep);
  }

  // ---- lists ----
  async lpush(key, value) {
    await this.run('INSERT INTO lists(key, position, value) SELECT ?1, COALESCE(MIN(position), 1) - 1, ?2 FROM lists WHERE key = ?1', key, String(value));
  }
  async rpush(key, value) {
    await this.run('INSERT INTO lists(key, position, value) SELECT ?1, COALESCE(MAX(position), -1) + 1, ?2 FROM lists WHERE key = ?1', key, String(value));
  }
  async lrange(key, start, stop) {
    const limit = stop < 0 ? -1 : stop - start + 1;
    return (await this.all('SELECT value FROM lists WHERE key = ? ORDER BY position LIMIT ? OFFSET ?', key, limit, start)).map(r => r.value);
  }
  async ltrim(key, start, stop) {
    await this.run(
      'DELETE FROM lists WHERE key = ?1 AND position NOT IN (SELECT position FROM lists WHERE key = ?1 ORDER BY position LIMIT ?2 OFFSET ?3)',
      key, stop - start + 1, start
    );
  }
}
