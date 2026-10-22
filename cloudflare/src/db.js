// D1 access for schema v2 (schema.sql). Plain SQL helpers, the `store` key/value table, user rows,
// and counters that are added up in memory and written at most every 2 minutes (D1's free plan
// allows 100k rows written per day, so a counter bump must not cost a row every time).

const now = () => Math.floor(Date.now() / 1000);

// counters: per isolate, `${day}\u0000${name}` → amount not written yet
const pending = new Map();
let lastFlush = Date.now();
const FLUSH_MS = 120000; // ponytail: up to 2 min of counts lost if the isolate is evicted; counts only, never user data

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
  batch(stmts) {
    return this.d.batch(stmts);
  }

  // ---- store: settings and short-lived state (expired rows are ignored; the cron deletes them) ----
  async get(key) {
    return (await this.one('SELECT value FROM store WHERE key = ? AND (expires_at IS NULL OR expires_at > ?)', key, now()))?.value ?? null;
  }
  // nx: only if the key is missing (or expired) — returns whether it was set
  async set(key, value, { ex, nx } = {}) {
    const exp = ex ? now() + Math.ceil(Number(ex)) : null;
    const sql = nx
      ? 'INSERT INTO store (key, value, expires_at) VALUES (?1, ?2, ?3) ON CONFLICT (key) DO UPDATE SET value = excluded.value, expires_at = excluded.expires_at WHERE store.expires_at IS NOT NULL AND store.expires_at <= ?4'
      : 'INSERT INTO store (key, value, expires_at) VALUES (?1, ?2, ?3) ON CONFLICT (key) DO UPDATE SET value = excluded.value, expires_at = excluded.expires_at';
    return (await this.run(sql, key, String(value), exp, ...(nx ? [now()] : []))) === 1;
  }
  async del(...keys) {
    if (!keys.length) return 0;
    return this.run(`DELETE FROM store WHERE key IN (${keys.map(() => '?').join(',')})`, ...keys);
  }

  // ---- users ----
  user(id) {
    return this.one('SELECT * FROM users WHERE id = ?', +id);
  }
  // Insert-or-update one user's columns: 1 row written however many columns change.
  // fields: { col: value } or { col: ['+', n] } to add n.
  setUser(id, fields) {
    return this.run(...userUpsert(id, fields));
  }
  setUserQ(id, fields) {
    return this.q(...userUpsert(id, fields));
  }

  // ---- counters ----
  bump(name, n = 1, day = 'all') {
    if (!n) return;
    const k = `${day}\u0000${name}`;
    pending.set(k, (pending.get(k) || 0) + n);
  }
  // write now and return the new value (boot count etc.)
  async incr(name, n = 1, day = 'all') {
    return (await this.one('INSERT INTO counters (day, name, n) VALUES (?, ?, ?) ON CONFLICT (day, name) DO UPDATE SET n = n + excluded.n RETURNING n', day, name, n)).n;
  }
  // flushes the bumped counters if a minute has passed (or force); one multi-row statement per 30 counters
  async flush(force = false) {
    if (!pending.size || (!force && Date.now() - lastFlush < FLUSH_MS)) return;
    lastFlush = Date.now();
    const rows = [...pending].map(([k, n]) => [...k.split('\u0000'), n]);
    pending.clear();
    const st = [];
    for (let i = 0; i < rows.length; i += 30) {
      const part = rows.slice(i, i + 30);
      st.push(this.q(`INSERT INTO counters (day, name, n) VALUES ${part.map(() => '(?, ?, ?)').join(', ')} ON CONFLICT (day, name) DO UPDATE SET n = n + excluded.n`, ...part.flat()));
    }
    try { await this.batch(st); } catch (e) { // keep them for the next flush
      console.log('counters flush failed:', e.message);
      for (const [d, name, n] of rows) this.bump(name, n, d);
    }
  }
}

const COL = /^[a-z_]+$/;
function userUpsert(id, fields) {
  const cols = Object.keys(fields);
  if (cols.some(c => !COL.test(c))) throw new Error('bad column');
  const vals = cols.map(c => (Array.isArray(fields[c]) ? fields[c][1] : fields[c]));
  const set = cols.map(c => (Array.isArray(fields[c]) ? `${c} = ${c} + excluded.${c}` : `${c} = excluded.${c}`));
  return [`INSERT INTO users (id${cols.map(c => `, ${c}`).join('')}) VALUES (?${cols.map(() => ', ?').join('')}) ON CONFLICT (id) DO UPDATE SET ${set.join(', ')}`, +id, ...vals];
}
