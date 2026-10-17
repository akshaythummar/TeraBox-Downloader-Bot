// JS port of the Python bot (amazon-ktworker: main.py + commands/*). Same
// commands, texts and DB keys. Difference: a TeraBox link is answered with a
// stream link (resolver + HLS proxy workers) instead of download→upload→forward.

import { Button, md } from './tg.js';

// ---------------- constants (from main.py / tools.py) ---------------- //

const PREMIUM_SET_KEY = 'premium_users';
const PREMIUM_EXPIRY_KEY = 'premium_expiry';
const BANNED_USERS_KEY = 'banned_users';
const STATS_KEY = 'bot_stats';
const AUDIT_LOG_KEY = 'audit_log';
const MAINTENANCE_KEY = 'maintenance_mode';
const COOLDOWN_KEY = 'download_cooldown';
const DYNAMIC_ADMINS_KEY = 'dynamic_admins';
const CUSTOM_TAGS_KEY = 'custom_tags';
const GC_REDIS_KEY = 'gift_cards';
const GC_TAGS_KEY = 'gc_tags';
const GC_USED_KEY = 'gc_used';
const THUMB_KEY = 'custom_thumbs';
const LANG_KEY = 'user_lang';
const LINK_COUNTS_KEY = 'link_counts';
const INDEX_KEY = 'lib:index';
const LOG_KEY = 'bot_log';
const FREE_MODE_KEY = 'videos_free_mode';
const PLANS_PHOTO = 'https://iili.io/nXUjApR.md.png';
const GC_LIST_PER_PAGE = 10;
const TIERS = [[5, 1], [10, 3], [25, 7]];

const DURATION_MAP_GC = { '1d': 1, '2d': 2, '3d': 3, '5d': 5, '7d': 7, '1w': 7, '2w': 14, '1m': 30, '1mo': 30, unlimited: 0, perm: 0 };
const DURATION_MAP = { '1d': 1, '2d': 2, '3d': 3, '5d': 5, '7d': 7, '1w': 7, '2w': 14, '1m': 30, '1mo': 30, unlimited: 0, 0: 0, perm: 0 };
// /dl <quality> → TeraBox HLS rendition (replaces the old ffmpeg re-encode)
const DL_QUALITY_MAP = { '144p': 'M3U8_AUTO_360', '240p': 'M3U8_AUTO_360', '360p': 'M3U8_AUTO_360', '480p': 'M3U8_AUTO_480', '720p': 'M3U8_AUTO_720', '1080p': 'M3U8_AUTO_1080' };
const DEFAULT_QUALITY = 'M3U8_AUTO_480';

const VIDEO_EXTENSIONS = new Set(('.mp4 .mkv .webm .mov .avi .flv .wmv .m4v .mpg .mpeg .3gp .ts .vob .ogv .mts .m2ts .divx .asf .rm .rmvb ' +
  '.3g2 .3gp2 .3gpp2 .f4v .f4p .swf .mpe .mpv .m2v .m2p .mpg4 .mpeg1 .mpeg2 .mpeg4 .qt .hdmov .h264 .h265 .hevc .mod .tod .dav .hdv ' +
  '.svi .ogm .ogg .amv .drc .dv .roq .nsv .xvid .mng .mxg .tp .trp .ps .pva .mxf .yuv .viv .m4p').split(' '));

const URL_PATTERNS = ['terabox\\.com', 'terabox\\.app', 'terabox\\.fun', 'terabox\\.best', 'terabox\\.ap', 'terabox\\.club', 'terabox\\.click',
  'terabox\\.me', 'terabox\\.site', 'terabox\\.pro', 'terabox\\.xyz', 'teraboxapp\\.com', 'teraboxlink\\.com', 'teraboxlinke\\.com',
  'teraboxshare\\.com', 'teraboxsharefile\\.com', 'teraboxurl\\.com', 'teraboxfree\\.com', 'teraboxmod\\.app', 'terasharelink\\.com',
  'terasharefile\\.com', 'terashareus\\.com', 'terafileshare\\.com', 'terasharedrive\\.com', 'tera1024box\\.com', '1024tera\\.com',
  '1024tera\\.co', '1024terabox\\.com', '1024-terabox\\.com', '1024box\\.com', '4funbox\\.com', '4funbox\\.co', '4funbox\\.in',
  'mirrobox\\.com', 'nephobox\\.com', 'freeterabox\\.com', 'momerybox\\.com', 'tibibox\\.com', 'gibibox\\.com', 'pebibox\\.com',
  'fancybox\\.in', 'dubox\\.com', 'bestclouddrive\\.com', 'playduo\\.link', 'theteraboxmod\\.app', 'teraboxdownloader\\.com', 'teradownloader\\.com'];
const URL_RE = new RegExp(URL_PATTERNS.join('|'));

const ERRORS = {
  invalid_link: '❌ Unable to process this link.\n\nPossible reasons:\n• Link expired\n• File unavailable\n• TeraBox service temporarily unavailable\n\nPlease try again later.',
  unsupported_link: '❌ This link type is not supported.\nPlease send a valid TeraBox link.',
  api_unavailable: '❌ Unable to process this link.\n\nPossible reasons:\n• Link expired\n• File unavailable\n• TeraBox service temporarily unavailable\n\nPlease try again later.',
  no_active_job: "ℹ️ You don't have any active downloads.",
};

const LANGUAGES = { en: 'English', ne: 'Nepali', hi: 'Hindi' };
const LANG_SET = { en: 'Language set to {lang}.', ne: 'भाषा {lang} मा सेट भयो।', hi: 'भाषा {lang} में सेट हो गई।' };

const WELCOME_TEXT = `
┏━━━━━━━━━━━━━━━━━⍟
┃ 𝐓𝐞𝐫𝐚𝐁𝐨𝐱 𝐅𝐚𝐬𝐭𝐞𝐬𝐭 𝐃𝐋 𝐁𝐨𝐭
┗━━━━━━━━━━━━━━━━━━━━━⍟

👋 Welcome **{name}**!

Simply send me a **TeraBox link** and I'll download the video for you instantly.

⚡ Free: Unlimited streaming links
⭐ Premium: Unlimited + no limits

Choose an option below 👇
`;

// ---------------- pure helpers (tools.py) ---------------- //

const nowS = () => Date.now() / 1000;
const escHtml = t => String(t ?? '').replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);
const int = v => { const n = parseInt(v, 10); return Number.isNaN(n) ? 0 : n; };
const fmtSize = b => {
  b = +b || 0;
  if (b >= 1024 ** 3) return `${(b / 1024 ** 3).toFixed(2)} GB`;
  if (b >= 1024 ** 2) return `${(b / 1024 ** 2).toFixed(2)} MB`;
  if (b >= 1024) return `${(b / 1024).toFixed(2)} KB`;
  return `${b.toFixed(2)} b`;
};
const convertSeconds = s => {
  s = Math.floor(s); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  return h > 0 ? `${h}h:${m}m:${r}s` : m > 0 ? `${m}m:${r}s` : `${r}s`;
};
const escapeMarkdown = t => (t == null ? '' : String(t).replace(/([*_`[\]])/g, '\\$1'));
const captionName = n => String(n || 'file').replace(/`/g, "'").replace(/([*_[\]])/g, '\\$1');
const sanitize = n => String(n || '').replace(/[\\/*?:"<>|]/g, '').trim() || 'file';
export const shareCode = u => (String(u).match(/\/s\/([\w-]+)/) || String(u).match(/surl=([\w-]+)/) || [])[1] || null;
const getUrl = s => (String(s || '').match(/https?:\/\/\S+/g) || []).find(u => URL_RE.test(u)) || null;
const extOf = n => { n = n.toLowerCase(); return n.includes('.') ? '.' + n.split('.').pop() : ''; };
const pyList = a => `[${a.map(x => `'${x}'`).join(', ')}]`;
const normalizeName = n => String(n || '').toLowerCase().trim().replace(/\.[a-z0-9]{2,5}$/, '').replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
const progressBar = (cur, target, len = 8) => { const r = target ? Math.min(cur, target) / target : 0; const n = Math.floor(r * len); return '█'.repeat(n) + '░'.repeat(len - n); };
const uuid8 = () => crypto.randomUUID().slice(0, 8).toUpperCase();

// HMAC so /m3u8 only serves links this bot issued (protects the free request quota)
export async function sign(secret, data) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(data)));
  return btoa(String.fromCharCode(...mac)).replace(/[+/=]/g, c => ({ '+': '-', '/': '_', '=': '' })[c]).slice(0, 22);
}

// Short-TTL cache like main.py's _cache (5s), per isolate.
const CACHE = new Map();
async function cached(key, fn, ttl = 5) {
  const hit = CACHE.get(key);
  if (hit && hit[1] > Date.now()) return hit[0];
  const v = await fn();
  CACHE.set(key, [v, Date.now() + ttl * 1000]);
  return v;
}
const uncache = key => CACHE.delete(key);

// ---------------- TeraBox (terabox.py) ---------------- //

export async function teraboxCfg(env, db) {
  return cached('tbcfg', async () => {
    const rows = await db.all("SELECT key, value FROM kv WHERE key IN ('terabox_cfg:jstoken', 'terabox_cfg:resolver', 'terabox_cfg:proxy')");
    const o = Object.fromEntries(rows.map(r => [r.key.split(':')[1], r.value]));
    return { jstoken: o.jstoken || env.JSTOKEN || '', resolver: (o.resolver || env.RESOLVER).replace(/\/$/, ''), proxy: (o.proxy || env.HLS_PROXY).replace(/\/$/, '') };
  });
}

// The resolver fails now and then for links that work a moment later, so a quick failure is
// retried once (terabox.py's retry_request did 2 attempts too). No retry on a 4xx (dead link)
// or a timeout: the resolver hangs on invalid codes, and retrying would double that wait.
export async function resolveShare(cfg, code) {
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const r = await fetch(`${cfg.resolver}/?q=${encodeURIComponent(code)}`, {
        signal: AbortSignal.timeout(15000),
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36', Accept: 'application/json, text/plain, */*' },
      });
      const text = await r.text();
      let d = null;
      try { d = JSON.parse(text); } catch {}
      if (r.ok && d?.errno === 0 && d.list?.length) return d;
      console.log(`resolver ${code} attempt ${attempt}: HTTP ${r.status} errno=${d?.errno} ${d?.show_msg || d?.errmsg || ''} ${d ? '' : text.slice(0, 150)}`);
      if (r.status >= 400 && r.status < 500 && r.status !== 429) return null;
    } catch (e) {
      console.log(`resolver ${code} attempt ${attempt}: ${e.name} ${e.message}`);
      if (e.name === 'TimeoutError') return null;
    }
    if (attempt === 1) await new Promise(res => setTimeout(res, 1000));
  }
  return null;
}

// Resolver results are reused for 30 min: repeat links skip the ~3s resolver call and
// the player starts faster. A stream URL from a 10-min-old resolve was verified to still
// play; /m3u8 re-resolves fresh if a cached one ever fails.
const SHARE_TTL = 1800;
export async function resolveCached(env, db, code, fresh = false) {
  const key = `tbshare:${code}`;
  if (!fresh) {
    const hit = await db.get(key);
    if (hit) return { ...JSON.parse(hit), cached: true };
  }
  const d = await resolveShare(await teraboxCfg(env, db), code);
  if (d) {
    const slim = { shareid: d.shareid, uk: d.uk, sign: d.sign, timestamp: d.timestamp, list: d.list.map(i => ({ fs_id: i.fs_id, server_filename: i.server_filename, size: i.size })) };
    await db.set(key, JSON.stringify(slim), { ex: SHARE_TTL });
  }
  return d;
}

// Same URL terabox.py::_build_stream_url built, proxied through the HLS worker.
export const streamUrl = (cfg, d, fid, quality = DEFAULT_QUALITY) =>
  `${cfg.proxy}/?hls=${encodeURIComponent(
    `https://1024tera.com/share/streaming.m3u8?uk=${d.uk}&shareid=${d.shareid}&type=${quality}&fid=${fid}` +
      `&sign=${d.sign}&timestamp=${d.timestamp}&jsToken=${cfg.jstoken}` +
      '&esl=1&isplayer=1&ehps=1&clienttype=0&app_id=250528&web=1&channel=dubox'
  )}`;

// ---------------- the bot ---------------- //

export function createBot(env, api, db, origin) {
  const OWNER_ID = int(env.OWNER_ID);
  const ADMINS = [...new Set([OWNER_ID, ...String(env.ADMINS || '').split(',').map(int).filter(Boolean)])];
  const SPOILER = String(env.SPOILER_VIDEOS ?? 'true') === 'true';
  const TZ = env.TZ || 'Asia/Kolkata';

  // --- time formatting (Python used server-local time) ---
  const parts = (ts, o) => Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: TZ, ...o }).formatToParts(new Date(ts * 1000)).map(p => [p.type, p.value]));
  const dmyHM = ts => { const p = parts(ts, { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true }); return `${p.day} ${p.month} ${p.year}, ${p.hour}:${p.minute} ${p.dayPeriod}`; };
  const ymdHMS = (ts = nowS()) => { const p = parts(ts, { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }); return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}:${p.second}`; };
  const ymd = () => ymdHMS().slice(0, 10);

  async function logx(line) {
    console.log(line);
    try {
      await db.lpush(LOG_KEY, `${ymdHMS()} [INFO] ${line}`);
      if (Math.random() < 0.05) await db.ltrim(LOG_KEY, 0, 499); // ponytail: trim 1 in 20 writes, keeps ~500 lines
    } catch {}
  }

  // --- runtime config (config_overrides hash, like /configset in Python) ---
  const csv = s => String(s || '').split(',').map(x => x.trim()).filter(Boolean);
  const runtime = () => cached('cfg', async () => {
    const o = await db.hgetall('config_overrides');
    return {
      MAX_FILES_PER_REQUEST: int(o.MAX_FILES_PER_REQUEST ?? 10),
      DOWNLOAD_COOLDOWN_SECONDS: int(o.DOWNLOAD_COOLDOWN_SECONDS ?? 10),
      FREE_HOURLY_LIMIT: int(o.FREE_HOURLY_LIMIT ?? 0),
      FORCE_CHANNELS: csv(o.FORCE_CHANNELS ?? env.FORCE_CHANNELS),
      FORCE_GROUPS: csv(o.FORCE_GROUPS ?? env.FORCE_GROUPS),
    };
  });
  async function setOverride(key, value) {
    await db.hset('config_overrides', key, value);
    uncache('cfg');
  }

  // --- users / admins / premium (main.py) ---
  const isAdmin = async uid => ADMINS.includes(int(uid)) || cached(`admin:${uid}`, () => db.sismember(DYNAMIC_ADMINS_KEY, String(uid)));
  const isBanned = uid => cached(`banned:${uid}`, () => db.sismember(BANNED_USERS_KEY, String(uid)));
  const getAllAdmins = async () => [...new Set([...ADMINS, ...(await db.smembers(DYNAMIC_ADMINS_KEY)).map(int)])];

  async function grantPremium(uid, days) {
    await db.hset(PREMIUM_EXPIRY_KEY, String(uid), Math.floor(nowS()) + days * 86400);
    await db.sadd(PREMIUM_SET_KEY, String(uid));
    await db.run("DELETE FROM kv WHERE key IN (?1, ?2, ?3)", `reminder_3d:${uid}`, `reminder_1d:${uid}`, `reminder_expired:${uid}`);
    uncache(`premium:${uid}`);
  }
  async function revokePremium(uid) {
    await db.hdel(PREMIUM_EXPIRY_KEY, String(uid));
    await db.srem(PREMIUM_SET_KEY, String(uid));
    if (int(uid) !== OWNER_ID && !(await isAdmin(uid))) await db.hdel(CUSTOM_TAGS_KEY, String(uid));
    uncache(`premium:${uid}`);
  }
  const isPremium = uid => cached(`premium:${uid}`, async () => {
    const exp = await db.hget(PREMIUM_EXPIRY_KEY, String(uid));
    if (exp == null) return false;
    if (nowS() >= int(exp)) { await revokePremium(uid); return false; }
    return true;
  });
  const premiumRemaining = async uid => Math.max(int(await db.hget(PREMIUM_EXPIRY_KEY, String(uid))) - Math.floor(nowS()), 0);

  async function getCustomTag(uid) {
    const tag = await db.hget(CUSTOM_TAGS_KEY, String(uid));
    if (int(uid) === OWNER_ID) { if (!tag) await db.hset(CUSTOM_TAGS_KEY, String(uid), 'OWNER'); return tag || 'OWNER'; }
    if (await isAdmin(uid)) { if (!tag) await db.hset(CUSTOM_TAGS_KEY, String(uid), 'ADMIN'); return tag || 'ADMIN'; }
    if (!(await isPremium(uid))) { if (tag) await db.hdel(CUSTOM_TAGS_KEY, String(uid)); return ''; }
    return tag || '';
  }
  const setCustomTag = (uid, tag) => db.hset(CUSTOM_TAGS_KEY, String(uid), tag);

  async function logAudit(action, admin, details = '') {
    await db.lpush(AUDIT_LOG_KEY, JSON.stringify({ action, admin, details, time: ymdHMS() }));
    await db.ltrim(AUDIT_LOG_KEY, 0, 999);
  }
  const isMaintenance = () => cached('maint', async () => (await db.get(MAINTENANCE_KEY)) === '1');
  async function setMaintenance(on, reason = '') {
    if (on) {
      await db.set(MAINTENANCE_KEY, '1');
      if (reason) await db.set(`${MAINTENANCE_KEY}:reason`, reason);
      else await db.delete(`${MAINTENANCE_KEY}:reason`);
    } else await db.run('DELETE FROM kv WHERE key IN (?1, ?2)', MAINTENANCE_KEY, `${MAINTENANCE_KEY}:reason`);
    uncache('maint');
    return on;
  }
  const getMaintenance = async () => [(await db.get(MAINTENANCE_KEY)) === '1', (await db.get(`${MAINTENANCE_KEY}:reason`)) || ''];

  async function checkCooldown(uid) {
    const last = await db.get(`${COOLDOWN_KEY}_${uid}`);
    if (!last) return 0;
    const cd = (await runtime()).DOWNLOAD_COOLDOWN_SECONDS, el = nowS() - parseFloat(last);
    return el < cd ? Math.floor(cd - el) : 0;
  }
  const setCooldown = async uid => db.set(`${COOLDOWN_KEY}_${uid}`, nowS(), { ex: (await runtime()).DOWNLOAD_COOLDOWN_SECONDS + 5 });

  async function isUserOnChat(chat, uid) {
    const r = await api.call('getChatMember', { chat_id: chat, user_id: uid });
    return !!r.ok && (['creator', 'administrator', 'member'].includes(r.result.status) || (r.result.status === 'restricted' && r.result.is_member));
  }

  // commands/analytics.py track_download, as one D1 round trip
  // n = how many files this call counts for (multi-file links record once, not per file)
  async function recordDl(uid, size, link, ok = true, n = 1) {
    if (n <= 0) return;
    const k = `user_stats_${int(uid)}`;
    const inc = (key, f, by) => db.q('INSERT INTO hashes(key, field, value) VALUES (?1, ?2, ?3) ON CONFLICT(key, field) DO UPDATE SET value = CAST(CAST(value AS INTEGER) + ?3 AS TEXT)', key, f, by);
    const st = [inc(k, 'attempts', n)];
    if (ok) {
      st.push(inc(k, 'total', n), inc(k, 'success', n), inc(STATS_KEY, 'total_downloads', n),
        db.q('INSERT INTO hashes(key, field, value) VALUES (?1, ?2, ?3) ON CONFLICT(key, field) DO UPDATE SET value = excluded.value', k, 'last_activity', ymdHMS()));
      if (size > 0) st.push(inc(k, 'storage', size));
      if (link) st.push(db.q('INSERT INTO sorted_sets(key, member, score) VALUES (?1, ?2, ?3) ON CONFLICT(key, member) DO UPDATE SET score = score + ?3', LINK_COUNTS_KEY, String(link).slice(0, 120), n));
    } else st.push(inc(k, 'failed', n));
    try {
      await db.d.batch(st);
      if (ok && link && Math.random() < 0.05) await db.ztrim(LINK_COUNTS_KEY, 500); // ponytail: prune 1 in 20, keeps ~top 500
    } catch (e) { console.log('recordDl', e.message); }
  }

  async function addHistory(uid, files) {
    if (!files.length) return;
    const raw = await db.get(`history_${uid}`);
    const list = raw ? JSON.parse(raw) : [];
    for (const f of files) list.push(JSON.stringify({ file: f.file_name, size: f.size, time: ymdHMS() }));
    await db.set(`history_${uid}`, JSON.stringify(list.slice(-50)), { ex: 2592000 });
  }

  // commands/library.py index_file — stream entries carry s(urlcode)/f(fid) instead of a
  // storage message id. One read + one batched write for any number of files.
  async function libIndex(files) {
    const byNorm = new Map();
    for (const f of files.slice(0, 90)) { const n = normalizeName(f.file_name); if (n) byNorm.set(n, [...(byNorm.get(n) || []), f]); }
    if (!byNorm.size) return;
    const norms = [...byNorm.keys()];
    const rows = await db.all(`SELECT field, value FROM hashes WHERE key = ? AND field IN (${norms.map(() => '?').join(',')})`, INDEX_KEY, ...norms);
    const have = Object.fromEntries(rows.map(r => [r.field, JSON.parse(r.value)]));
    const rows2 = [];
    for (const [norm, fs] of byNorm) {
      const entries = have[norm] || [];
      const fresh = fs.filter(f => !entries.some(e => e.s === f.code && e.f === f.fid));
      if (!fresh.length) continue;
      for (const f of fresh) entries.push({ s: f.code, f: f.fid, name: f.file_name.slice(0, 120), size: f.size, bytes: f.sizebytes });
      rows2.push([norm, JSON.stringify(entries.slice(-5))]);
    }
    // multi-row upserts: one statement per 45 rows (D1 allows 100 bound params per statement)
    for (let i = 0; i < rows2.length; i += 45) {
      const chunk = rows2.slice(i, i + 45);
      await db.run(`INSERT INTO hashes(key, field, value) VALUES ${chunk.map(() => `('${INDEX_KEY}', ?, ?)`).join(', ')} ON CONFLICT(key, field) DO UPDATE SET value = excluded.value`, ...chunk.flat());
    }
  }

  // --- TeraBox files ---
  async function getFiles(url) {
    const code = shareCode(url);
    if (!code) return false;
    const d = await resolveCached(env, db, code);
    if (!d) { await logx(`Resolver worker error for ${code}`); return false; }
    const files = d.list.filter(i => i.fs_id).map(i => ({
      file_name: sanitize(i.server_filename || 'video.mp4'), fid: String(i.fs_id), sizebytes: +i.size || 0,
      size: +i.size ? fmtSize(+i.size) : 'Unknown', code,
    }));
    return files.length ? files : false;
  }

  // Everything the link handler checks, read in one D1 round trip.
  async function gate(uid) {
    const u = String(uid);
    const [kv, h, s] = await db.d.batch([
      db.q('SELECT key, value, expires_at FROM kv WHERE key IN (?1, ?2, ?3)', MAINTENANCE_KEY, `${COOLDOWN_KEY}_${u}`, `check_${u}`),
      db.q('SELECT key, value FROM hashes WHERE field = ?1 AND key IN (?2, ?3)', u, PREMIUM_EXPIRY_KEY, THUMB_KEY),
      db.q('SELECT key FROM sets WHERE member = ?1 AND key IN (?2, ?3)', u, BANNED_USERS_KEY, DYNAMIC_ADMINS_KEY),
    ]);
    const now = nowS();
    const k = Object.fromEntries(kv.results.filter(r => r.expires_at == null || r.expires_at > now).map(r => [r.key, r]));
    const hv = Object.fromEntries(h.results.map(r => [r.key, r.value]));
    const sv = new Set(s.results.map(r => r.key));
    const exp = hv[PREMIUM_EXPIRY_KEY];
    return {
      maintenance: k[MAINTENANCE_KEY]?.value === '1',
      banned: sv.has(BANNED_USERS_KEY),
      admin: ADMINS.includes(int(uid)) || sv.has(DYNAMIC_ADMINS_KEY),
      premium: exp != null && now < int(exp),
      expired: exp != null && now >= int(exp),
      lastDl: k[`${COOLDOWN_KEY}_${u}`]?.value,
      count: k[`check_${u}`]?.value,
      countExp: k[`check_${u}`]?.expires_at,
      thumb: hv[THUMB_KEY] || null,
    };
  }

  // track active-today / member-since / new-user in one round trip
  async function trackActivity(uid) {
    try {
      const todayKey = `active_${ymd()}`;
      const [a, , b] = await db.d.batch([
        db.q("INSERT INTO kv(key, value) VALUES (?, '1') ON CONFLICT(key) DO UPDATE SET value = CAST(CAST(value AS INTEGER) + 1 AS TEXT) RETURNING value", todayKey),
        db.q('INSERT INTO kv(key, value) VALUES (?, ?) ON CONFLICT(key) DO NOTHING', `member_since:${uid}`, ymd()),
        db.q("SELECT 1 FROM sets WHERE key = 'all_known_users' AND member = ? LIMIT 1", String(uid)),
      ]);
      if (int(a.results[0].value) === 1) await db.expire(todayKey, 86400);
      if (!b.results.length) { await db.sadd('all_known_users', String(uid)); await db.hincrby(STATS_KEY, 'total_users', 1); }
    } catch (e) { console.log('track_activity', e.message); }
  }

  async function watchUrl(code, fid, q) {
    q ||= DEFAULT_QUALITY;
    return `${origin}/watch?s=${code}&f=${fid}&q=${q}&t=${await sign(env.WEBHOOK_SECRET, `${code}:${fid}:${q}`)}`;
  }

  const cardCaption = (f, from, tag, took) => `
┏━━━━━━━━━━⍟
┃ 𝐓𝐞𝐫𝐚𝐁𝐨𝐱 𝐅𝐚𝐬𝐭𝐞𝐬𝐭 𝐃𝐋 𝐁𝐨𝐭
┗━━━━━━━━━━━━━━━━━⍟
╔══════════⍟
╟➣𝙁𝙞𝙡𝙚 𝙉𝙖𝙢𝙚: \`${captionName(f.file_name)}\`
╟➣𝙎𝙞𝙯𝙚: **${f.size}**
╟➣𝗙𝗶𝗿𝘀𝗧 𝗡𝗮𝗺𝗲: ${escapeMarkdown(from.first_name)}${tag ? ` (${tag})` : ''}
╟➣𝗨𝘀𝗲𝗿𝗻𝗮𝗺𝗲: @${escapeMarkdown(from.username || '-')}${took != null ? `\n╟➣𝐓𝐨𝐭𝐚𝐥 𝐓𝐢𝐦𝐞 𝐓𝐚𝐤𝐞𝐧: ${took}` : ''}
╚═════════════════⍟
         @AT_BOTZ
`;

  // The stream "video post": caption + play buttons, as a photo when the user set a /setthumb.
  async function sendStream(chatId, isPrivate, f, caption, q, userThumb) {
    const href = await watchUrl(f.code, f.fid, q);
    const buttons = [[isPrivate ? Button.webapp('▶️ Watch Online', href) : Button.url('▶️ Watch Online', href)], [Button.url('🌐 Open in Browser', href)]];
    if (userThumb) {
      const r = await api.call('sendPhoto', { chat_id: chatId, photo: userThumb, caption: md(caption), parse_mode: 'HTML', has_spoiler: SPOILER, reply_markup: { inline_keyboard: buttons } });
      if (r.ok) return true;
    }
    return !!(await api.send(chatId, caption, { buttons }));
  }

  // ---------------- message / callback wrappers ---------------- //

  const NOOP = { id: 0, edit: async () => {}, delete: async () => {} };
  const wrapMsg = msg => ({
    raw: msg, text: msg.text || msg.caption || '', uid: msg.from?.id, chatId: msg.chat.id, isPrivate: msg.chat.type === 'private',
    from: msg.from || {}, id: msg.message_id, replyTo: msg.reply_to_message,
    reply: async (text, o = {}) => (await api.send(msg.chat.id, text, { ...o, replyTo: msg.message_id })) || NOOP,
  });
  const wrapCb = q => {
    const chatId = q.message?.chat.id ?? q.from.id, msgId = q.message?.message_id;
    const e = {
      data: q.data || '', uid: q.from.id, from: q.from, chatId, msgId, answered: false,
      answer: (text = '', alert = false) => { e.answered = true; return api.call('answerCallbackQuery', { callback_query_id: q.id, text: String(text).slice(0, 200), show_alert: alert }); },
      edit: (text, o = {}) => api.edit(chatId, msgId, text, o),
      reply: async (text, o = {}) => (await api.send(chatId, text, { ...o, replyTo: msgId })) || NOOP,
      delete: () => api.call('deleteMessage', { chat_id: chatId, message_id: msgId }),
    };
    return e;
  };
  const nameOf = async uid => { const u = await api.user(uid); return u ? [u.first_name || '-', u.username || '-', u.last_name] : null; };

  // ---------------- handler tables ---------------- //

  const CMDS = []; // [regex (Telethon re.match = anchored at start), fn, guard]
  const CBS = [];
  const on = (re, fn, guard) => CMDS.push([re, fn, guard]);
  const onCb = (re, fn) => CBS.push([re, fn]);
  const ADMIN = 'admin', OWNER = 'owner';

  // ==================== /info /id ====================
  on(/^\/(info|id)/, async m => {
    const uid = m.uid;
    let plan = '🆓 Free';
    if (await isPremium(uid)) {
      const rem = await premiumRemaining(uid);
      plan = rem > 9000000 ? '⭐ Premium (Permanent)'
        : `⭐ Premium (${Math.floor(rem / 86400)}d ${Math.floor((rem % 86400) / 3600)}h ${Math.floor((rem % 3600) / 60)}m left)\nExpires: ${dmyHM(Math.floor(nowS()) + rem)}`;
    }
    const tag = await getCustomTag(uid);
    await m.reply(`**Name:** ${m.from.first_name}\n**Username:** @${m.from.username || '-'}\n**User ID:** \`${uid}\`\n${tag ? `**Tag:** ${tag}\n` : ''}**Plan:** ${plan}`);
  });

  const mainMenuButtons = uid => {
    const rows = [
      [Button.inline('📥 How to Use', 'menu_howto'), Button.inline('📋 My Info', 'menu_info')],
      [Button.inline('⭐ Premium', 'menu_premium'), Button.inline('🎁 Redeem Card', 'menu_redeem')],
    ];
    if (ADMINS.includes(int(uid))) rows.push([Button.inline('⚙️ Admin Panel', 'menu_admin')]);
    rows.push(
      [Button.inline('🛠 Tools', 'menu_tools'), Button.inline('🌐 Language', 'menu_lang')],
      [Button.inline('👥 Referral', 'menu_referral'), Button.inline('📊 My Stats', 'menu_mystats')],
      [Button.url('📣 Channel', 'https://t.me/AT_BOTZ'), Button.url('💬 Group', 'https://t.me/AT_BOTZ')],
    );
    return rows;
  };
  const welcome = name => WELCOME_TEXT.replace('{name}', name);

  on(/^(\/cmds|\/help)/, m => m.reply(welcome(m.from.first_name), { buttons: mainMenuButtons(m.uid) }));

  on(/^\/ping/, async m => {
    const t0 = Date.now();
    const msg = await m.reply('🖥️ Connection Status\nCommand: `/ping`\nResponse Time: Calculating...');
    await msg.edit(`🖥️ Connection Status\nCommand: \`/ping\`\nResponse Time: ${((Date.now() - t0) / 1000).toFixed(2)} seconds`);
  });

  // ==================== gift cards ====================
  const giftcardButtons = codes => codes.slice(0, 25).map(c => [Button.inline(`🎁 ${c}`, `redeem_${c}`)]);

  on(/^\/gen\s+(\S+)(?:\s+(\d+))?(?:\s+(.+))?/, async (m, g) => {
    const dur = g[1].toLowerCase(), count = int(g[2] || 1), tag = (g[3] || '').trim();
    if (count > 50) return m.reply('Max 50 codes at once.');
    if (!(dur in DURATION_MAP_GC))
      return m.reply(`Invalid duration: \`${dur}\`\n\nValid: \`${Object.keys(DURATION_MAP_GC).join(', ')}\`\n\n**Usage:** \`/gen <duration> [count] [tag]\`\nExamples:\n- \`/gen 7d 5\` — 5 cards, 7 days\n- \`/gen 7d 5 VIP\` — 5 cards, 7 days, VIP tag\n- \`/gen unlimited 1 PREMIUM\` — 1 card, permanent, PREMIUM tag`);
    const days = DURATION_MAP_GC[dur], codes = [];
    const st = [];
    for (let i = 0; i < count; i++) {
      const code = `AT-${uuid8()}`;
      st.push(db.q('INSERT INTO hashes(key, field, value) VALUES (?, ?, ?) ON CONFLICT(key, field) DO UPDATE SET value = excluded.value', GC_REDIS_KEY, code, String(days)));
      if (tag) st.push(db.q('INSERT INTO hashes(key, field, value) VALUES (?, ?, ?) ON CONFLICT(key, field) DO UPDATE SET value = excluded.value', GC_TAGS_KEY, code, tag));
      codes.push(code);
    }
    await db.d.batch(st);
    const label = days > 0 ? `${days} day(s)` : 'Permanent (Unlimited)';
    const lines = codes.map(c => (tag ? `\`/redeem ${c}\` (Tag: ${tag})` : `\`/redeem ${c}\``));
    await m.reply(`**${count} Gift Card(s) Generated**\n\nDuration: **${label}**${tag ? `\nTag: **${tag}**` : ''}\n\n**Send these to users:**\n${lines.join('\n')}`, { buttons: giftcardButtons(codes) });
  }, ADMIN);

  async function gcItems(withTags) {
    const [unused, used, tags] = await Promise.all([db.hgetall(GC_REDIS_KEY), db.hgetall(GC_USED_KEY), withTags ? db.hgetall(GC_TAGS_KEY) : {}]);
    const items = [];
    for (const [code, d] of Object.entries(unused)) {
      if (Number.isNaN(parseInt(d, 10))) continue;
      items.push({ code, status: 'available', label: int(d) === 0 ? 'Permanent' : `${int(d)}d`, tag: tags[code] || '' });
    }
    for (const [code, v] of Object.entries(used)) {
      const p = String(v || '').split(':');
      const d = int(p[2]);
      items.push({ code, status: 'used', label: d === 0 ? 'Permanent' : `${d}d`, user: p[0] || '?', tag: tags[code] || '' });
    }
    return items;
  }
  function gcPage(items, page) {
    const pages = Math.max(1, Math.ceil(items.length / GC_LIST_PER_PAGE));
    page = Math.min(page, pages);
    const start = (page - 1) * GC_LIST_PER_PAGE;
    const avail = items.filter(i => i.status === 'available').length;
    const lines = items.slice(start, start + GC_LIST_PER_PAGE).map((it, i) => {
      const t = it.tag ? ` (${it.tag})` : '';
      return it.status === 'available' ? `${start + i + 1}. \`/redeem ${it.code}\` — ${it.label}${t} [Available]` : `${start + i + 1}. \`${it.code}\` — ${it.label}${t} [Used by \`${it.user}\`]`;
    });
    const text = `**Gift Cards** (${items.length} total)\nAvailable: ${avail} | Used: ${items.length - avail}\nPage ${page}/${pages}\n\n${lines.join('\n')}`;
    const nav = [];
    if (page > 1) nav.push(Button.inline('◀️ Prev', `gcpage_${page - 1}_${items.length}`));
    if (page < pages) nav.push(Button.inline('Next ▶️', `gcpage_${page + 1}_${items.length}`));
    return [text, [...(nav.length ? [nav] : []), [Button.inline('Refresh', `gcpage_${page}_${items.length}`)]]];
  }
  on(/^\/gclist/, async m => {
    const items = await gcItems(false);
    if (!items.length) return m.reply('No gift cards found.');
    const [text, buttons] = gcPage(items, 1);
    await m.reply(text, { buttons });
  }, ADMIN);
  onCb(/^gcpage_/, async e => {
    if (!(await isAdmin(e.uid))) return e.answer('Access denied!', true);
    const p = e.data.split('_');
    if (!int(p[1])) return e.answer('Invalid callback data.', true);
    const [text, buttons] = gcPage(await gcItems(true), int(p[1]));
    await e.edit(text, { buttons });
  });

  on(/^\/gcdel\s+(\S+)/, async (m, g) => {
    const code = g[1].toUpperCase();
    await m.reply((await db.hdel(GC_REDIS_KEY, code)) ? `Deleted \`${code}\`.` : `Code \`${code}\` not found.`);
  }, ADMIN);

  const gcTrackButtons = [[Button.inline('Last 1h', 'gctrack_1h'), Button.inline('Last 24h', 'gctrack_24h'), Button.inline('Last 7d', 'gctrack_7d')], [Button.inline('All', 'gctrack_all')]];
  async function gcTrack(filter, allowIdFilters) {
    const used = await db.hgetall(GC_USED_KEY);
    const now = Math.floor(nowS()), results = [];
    for (const [code, v] of Object.entries(used)) {
      const p = String(v || '').split(':'), uid = p[0] || '?', ts = int(p[1]), d = int(p[2]);
      const age = ts ? (now - ts) / 3600 : 0;
      if (filter === '1h' && age > 1) continue;
      if (filter === '24h' && age > 24) continue;
      if (filter === '7d' && age > 168) continue;
      if (allowIdFilters && filter && !['1h', '24h', '7d'].includes(filter)) {
        if (/^\d+$/.test(filter) ? uid !== filter : code.toUpperCase() !== filter.toUpperCase()) continue;
      }
      results.push(`\`${code}\` — ${d === 0 ? 'Permanent' : `${d}d`}\n  User: \`${uid}\`\n  Time: ${ts ? dmyHM(ts) : '?'} (${Math.round(age * 10) / 10}h ago)`);
    }
    if (!results.length) return null;
    let text = `**Gift Card Usage** (${results.length} found)\n\n${results.join('\n\n')}`;
    if (text.length > 3000) text = text.slice(0, 3000) + '\n\n... (truncated)';
    return [text, Object.keys(used).length];
  }
  on(/^\/gctrack(?:\s+(\S+))?/, async (m, g) => {
    if (!(await db.hlen(GC_USED_KEY))) return m.reply('No redeemed gift cards found.');
    const r = await gcTrack(g[1], true);
    if (!r) return m.reply('No matching gift cards found.');
    await m.reply(r[0], { buttons: gcTrackButtons });
  }, ADMIN);
  onCb(/^gctrack_/, async e => {
    if (!(await isAdmin(e.uid))) return e.answer('Access denied!', true);
    const r = await gcTrack(e.data.split('_').slice(1).join('_'), false);
    if (!r) return e.answer('No results for this filter.', true);
    await e.edit(r[0], { buttons: gcTrackButtons });
  });

  // commands/redeem_core.py
  async function redeemCode(uid, code) {
    code = String(code || '').trim().toUpperCase();
    if ((await db.get(`gc_redeemed_${uid}`)) && (await isPremium(uid)))
      return [false, 'You have already redeemed a gift card and your premium is still active.\nEach user can only redeem **1 gift card** while premium is active.\nWait for expiry or contact admin.', null];
    const daysStr = await db.hget(GC_REDIS_KEY, code);
    if (!daysStr || Number.isNaN(parseInt(daysStr, 10))) return [false, 'Invalid or already used gift card.', null];
    const days = int(daysStr), tag = (await db.hget(GC_TAGS_KEY, code)) || '';
    await db.hdel(GC_REDIS_KEY, code);
    await db.hdel(GC_TAGS_KEY, code);
    await db.hset(GC_USED_KEY, code, `${uid}:${Math.floor(nowS())}:${days}`);
    await db.set(`gc_redeemed_${uid}`, '1');
    if (tag) await setCustomTag(uid, tag);
    await grantPremium(uid, days === 0 ? 99999 : days);
    const tagInfo = tag ? `\nTag: **${tag}**` : '';
    const text = days === 0
      ? `Gift card redeemed!\n\n**Premium: Unlimited**\nDuration: Permanent (never expires)${tagInfo}`
      : `Gift card redeemed!\n\n**Premium: ${days} day(s)**\nExpires: \`${dmyHM(Math.floor(nowS()) + days * 86400)}\`${tagInfo}`;
    return [true, text, { code, days, tag }];
  }
  const identityBlock = (first, last, username, uid) => `\n\nRedeemed by: ${`${first || ''} ${last || ''}`.trim() || '-'} (${username ? `@${username}` : '@-'})\nID: \`${uid}\``;
  async function notifyRedeem(uid, from, info) {
    const tagMsg = info.tag ? `\nTag: ${info.tag}` : '';
    for (const a of await getAllAdmins())
      await api.send(a, `Gift Card Redeemed!\nUser: ${from.first_name || '-'} (@${from.username || '-'})\nID: \`${uid}\`\nCode: \`${info.code}\`\nDuration: ${info.days}d${tagMsg}`);
  }

  on(/^\/redeem\s+(\S+)/, async (m, g) => {
    let [ok, text, info] = await redeemCode(m.uid, g[1]);
    if (ok) text += identityBlock(m.from.first_name || '-', m.from.last_name, m.from.username, m.uid);
    await m.reply(text);
    if (ok && info) await notifyRedeem(m.uid, m.from, info);
  });
  // commands/ux.py one-click gift-card button
  onCb(/^redeem_/, async e => {
    const code = e.data.split('redeem_')[1]?.trim().toUpperCase();
    if (!code) return e.answer('Invalid code.', true);
    let [ok, text, info] = await redeemCode(e.uid, code);
    await e.answer(ok ? 'Redeemed!' : 'Failed');
    if (ok) text += identityBlock(e.from.first_name || '-', e.from.last_name, e.from.username, e.uid);
    if (ok && info) await notifyRedeem(e.uid, e.from, info);
    if (!(await api.send(e.uid, text))) await e.reply(text);
  });

  on(/^\/allowredeem\s+(\d+)/, async (m, g) => {
    await db.delete(`gc_redeemed_${g[1]}`);
    await logAudit('ALLOW_REDEEM', m.uid, `Reset GC redemption for ${g[1]}`);
    await m.reply(`User \`${g[1]}\` can now redeem another gift card.`);
  }, OWNER);

  // ==================== tags ====================
  on(/^\/settag\s+(\d+)\s+(.+)/, async (m, g) => {
    const tag = g[2].trim();
    await setCustomTag(int(g[1]), tag);
    await logAudit('SET_TAG', m.uid, `Set tag '${tag}' for ${int(g[1])}`);
    await m.reply(`Tag set!\nUser: \`${int(g[1])}\`\nTag: **${tag}**`);
  }, ADMIN);
  on(/^\/tag/, async m => {
    const tag = await getCustomTag(m.uid);
    await m.reply(tag ? `Your tag: **${tag}**` : 'You have no custom tag.\nAdmins can set one with `/settag <user_id> <tag>`');
  });

  // ==================== broadcasts (queued; the cron sends 40/minute) ====================
  async function queueBroadcast(row) {
    const cols = Object.keys(row);
    await db.run(`INSERT INTO broadcasts (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`, ...cols.map(c => row[c]));
  }
  // Python sent this to members of channel -1001336746488 (get_participants); the Bot API
  // can't list channel members, so it goes to the bot's known users instead.
  on(/^\/broadcast_legacy/, async m => {
    const text = m.text.split('/broadcast_legacy')[1].trim();
    if (!text) return m.reply('**Usage:** `/broadcast_legacy <message>`\nSend a message to channel members (legacy). Use /broadcast for all users.');
    const status = await m.reply('Broadcasting...');
    await queueBroadcast({ kind: 'legacy', mode: 'text', text, total: await db.scard('all_known_users'), status_chat: m.chatId, status_msg: status.id });
  }, ADMIN);

  // ==================== /start ====================
  on(/^\/start/, async m => {
    const uid = m.uid, name = m.from.first_name;
    const arg = m.text.split(/\s+/)[1];
    const ref = arg?.startsWith('ref_AT-') ? int(arg.split('ref_AT-')[1]) : 0;
    if (ref > 0 && (await recordReferral(ref, uid))) {
      const [granted, days] = await checkAndGrantReward(ref);
      if (granted) await logx(`Referral reward: ${ref} +${days}d`);
    }
    const admins = await getAllAdmins();
    if (!admins.includes(uid))
      for (const a of admins) await api.send(a, `👤 New user started bot:\nName: ${name}\nUsername: @${m.from.username || '-'}\nID: \`${uid}\``);
    await m.reply(welcome(name), { buttons: mainMenuButtons(uid) });
  });

  // ==================== menu callbacks ====================
  const back = to => [[Button.inline('◀️ Back', to)]];
  onCb(/^menu_howto$/, e => e.edit(`
┏━━━━━━━━━━━━━━━━━⍟
┃  📥 𝐇𝐨𝐰 𝐭𝐨 𝐔𝐬𝐞
┗━━━━━━━━━━━━━━━━━━━━━⍟

**Step 1:** Join our Channel & Group
**Step 2:** Send me any TeraBox link
**Step 3:** Wait for the magic! ✨

**Supported formats:**
mp4, mkv, webm, mov, avi, flv, wmv, m4v, mpg, mpeg, 3gp, ts, and more...

**Commands:**
\`/dl <link>\` — Download original
\`/dl 720p <link>\` — Download + compress 720p
\`/dl 480p <link>\` — Download + compress 480p
\`/folder <link>\` — Download entire folder
\`/quick <link>\` — Fast single-file download
\`/preview <link>\` — Preview first 3 files
\`/mystatus\` — Your premium/tag/stats
\`/mp3\` — Reply to video → extract audio
\`/compress\` — Reply to video → compress
`, { buttons: back('menu_main') }));

  onCb(/^menu_info$/, async e => {
    let plan = '🆓 Free';
    if (await isPremium(e.uid)) {
      const rem = await premiumRemaining(e.uid);
      plan = rem > 9000000 ? '⭐ Premium (Permanent)' : `⭐ Premium (${Math.floor(rem / 86400)}d ${Math.floor((rem % 86400) / 3600)}h ${Math.floor((rem % 3600) / 60)}m)`;
    }
    await e.edit(`
┏━━━━━━━━━━━━━━━━━⍟
┃  📋 𝐌𝐲 𝐈𝐧𝐟𝐨
┗━━━━━━━━━━━━━━━━━━━━━⍟

**Name:** ${e.from.first_name}
**Username:** @${e.from.username || '-'}
**User ID:** \`${e.uid}\`
**Plan:** ${plan}
`, { buttons: [[Button.inline('📜 Download History', 'menu_history')], [Button.inline('◀️ Back', 'menu_main')]] });
  });

  onCb(/^menu_history$/, async e => {
    const raw = await db.get(`history_${e.uid}`);
    let text = '📭 No download history yet.';
    if (raw) {
      const lines = JSON.parse(raw).slice(-10).reverse().map((x, i) => { const en = JSON.parse(x); return `${i + 1}. \`${en.file.slice(0, 30)}\` (${en.size})`; });
      text = `**📜 Last ${lines.length} Downloads:**\n\n${lines.join('\n')}`;
    }
    await e.edit(text, { buttons: back('menu_info') });
  });

  onCb(/^menu_premium$/, async e => {
    let status = '🆓 **Free Plan**';
    if (await isPremium(e.uid)) {
      const rem = await premiumRemaining(e.uid);
      status = rem > 9000000 ? '♾️ **Permanent Premium**' : `⏰ **Active** — ${Math.floor(rem / 86400)}d ${Math.floor((rem % 86400) / 3600)}h remaining`;
    }
    await e.edit(`
┏━━━━━━━━━━━━━━━━━⍟
┃  ⭐ 𝐏𝐫𝐞𝐦𝐢𝐮𝐦
┗━━━━━━━━━━━━━━━━━━━━━⍟

**Your Status:** ${status}

**Free Plan:**
• Unlimited streaming links
• Single file only

**Premium Plan:**
• ✅ /videos access
• ✅ Multi-file support
• ✅ No size limit
• ✅ Priority speed
• ✅ Custom thumbnail
• ✅ Folder download

👥 Earn free Premium: /ref
Contact @buggybeats to purchase.
`, { buttons: [[Button.inline('🎁 Redeem Gift Card', 'menu_redeem')], [Button.inline('◀️ Back', 'menu_main')]] });
  });

  onCb(/^menu_redeem$/, e => e.edit(`
┏━━━━━━━━━━━━━━━━━⍟
┃  🎁 𝐑𝐞𝐝𝐞𝐞𝐦 𝐆𝐢𝐟𝐭 𝐂𝐚𝐫𝐝
┗━━━━━━━━━━━━━━━━━━━━━⍟

Send your gift card code like this:

\`/redeem AT-XXXXXXXX\`

You will receive premium instantly!
`, { buttons: back('menu_main') }));

  onCb(/^menu_mystats$/, async e => {
    const h = await db.hgetall(`user_stats_${e.uid}`);
    const success = int(h.success) || int(h.total), failed = int(h.failed);
    await e.edit(
      '┏━━━━━━━━━━━━━━━━━⍟\n┃  📊 𝐌𝐲 𝐒𝐭𝐚𝐭𝐬\n┗━━━━━━━━━━━━━━━━━━━━━⍟\n\n' +
      `Files: **${success}**\nData: **${fmtSize(int(h.storage))}**\nSuccessful: **${success}** | Failed: **${failed}**\nLast activity: **${h.last_activity || 'Never'}**\n\nFull details: /mystats`,
      { buttons: back('menu_main') });
  });

  onCb(/^menu_tools$/, e => e.edit(`
┏━━━━━━━━━━━━━━━━━⍟
┃  🛠 𝐓𝐨𝐨𝐥𝐬
┗━━━━━━━━━━━━━━━━━━━━━⍟

**📥 Download Tools:**
\`/dl <link>\` — Download original
\`/dl 720p <link>\` — Download + compress 720p
\`/dl 480p <link>\` — Download + compress 480p
\`/folder <link>\` — Entire folder (⭐)
\`/quick <link>\` — Fast single file
\`/preview <link>\` — Preview folder
\`/search <text>\` — Search the library
\`/mystatus\` — Your status

**🎵 Media Tools:**
\`/mp3\` — Reply to video → Audio
\`/compress\` — Reply to video → Compress
\`/compress low\` — Low quality compress

**🎨 Customization:**
\`/setthumb\` — Set custom thumbnail (⭐)
\`/removethumb\` — Remove thumbnail
\`/lang ne\` — Set language (en/ne/hi)
`, { buttons: back('menu_main') }));

  onCb(/^menu_lang$/, e => e.edit(`
┏━━━━━━━━━━━━━━━━━⍟
┃  🌐 𝐒𝐞𝐭 𝐋𝐚𝐧𝐠𝐮𝐚𝐠𝐞
┗━━━━━━━━━━━━━━━━━━━━━⍟

Choose your preferred language:
`, { buttons: [[Button.inline('English 🇬🇧', 'setlang_en'), Button.inline('नेपाली 🇳🇵', 'setlang_ne')], [Button.inline('हिन्दी 🇮🇳', 'setlang_hi')], [Button.inline('◀️ Back', 'menu_main')]] }));

  onCb(/^setlang_/, async e => {
    const code = e.data.replace('setlang_', '');
    await db.set(`${LANG_KEY}_${e.uid}`, code);
    await e.answer(`Language set to ${LANGUAGES[code] || 'English'}!`);
    await e.edit(welcome(e.from.first_name), { buttons: mainMenuButtons(e.uid) });
  });
  onCb(/^menu_main$/, e => e.edit(welcome(e.from.first_name), { buttons: mainMenuButtons(e.uid) }));

  // ==================== admin panel ====================
  const adminCb = (re, fn) => onCb(re, async e => ((await isAdmin(e.uid)) ? fn(e) : e.answer('Access denied!', true)));

  adminCb(/^menu_admin$/, e => e.edit(`
┏━━━━━━━━━━━━━━━━━⍟
┃  ⚙️ 𝐀𝐝𝐦𝐢𝐧 𝐏𝐚𝐧𝐞𝐥
┗━━━━━━━━━━━━━━━━━━━━━⍟

Choose an admin action 👇
`, { buttons: [
    [Button.inline('📊 Stats', 'admin_stats'), Button.inline('💻 Usage', 'admin_usage')],
    [Button.inline('⭐ Premium Mgmt', 'admin_premium'), Button.inline('🎁 Gift Cards', 'admin_gc')],
    [Button.inline('🏷 Tags', 'admin_tags'), Button.inline('🚫 Ban Users', 'admin_ban')],
    [Button.inline('📝 Logs', 'admin_logs'), Button.inline('📢 Broadcast', 'admin_broadcast')],
    [Button.inline('🔧 Maintenance', 'admin_maint')],
    [Button.inline('🩺 API Health', 'admin_api'), Button.inline('🧩 Config', 'admin_config')],
    [Button.inline('💾 Backup', 'admin_backup')],
    [Button.inline('◀️ Back', 'menu_main')],
  ] }));

  adminCb(/^admin_stats$/, async e => {
    const [s, prem, banned, gc, active] = await Promise.all([db.hgetall(STATS_KEY), db.scard(PREMIUM_SET_KEY), db.scard(BANNED_USERS_KEY), db.hlen(GC_REDIS_KEY), db.get(`active_${ymd()}`)]);
    await e.edit(`
┏━━━━━━━━━━━━━━━━━⍟
┃  📊 𝐁𝐨𝐭 𝐒𝐭𝐚𝐭𝐢𝐬𝐭𝐢𝐜𝐬
┗━━━━━━━━━━━━━━━━━━━━━⍟

📥 **Total Downloads:** ${int(s.total_downloads)}
👤 **Total Users:** ${int(s.total_users)}
🟢 **Active Today:** ${int(active)}
⭐ **Premium:** ${prem}
🚫 **Banned:** ${banned}
🎁 **Gift Cards:** ${gc}
`, { buttons: back('menu_admin') });
  });

  adminCb(/^admin_usage$/, e => e.edit(`
┏━━━━━━━━━━━━━━━━━⍟
┃  💻 𝐑𝐞𝐬𝐨𝐮𝐫𝐜𝐞 𝐔𝐬𝐚𝐠𝐞
┗━━━━━━━━━━━━━━━━━━━━━⍟

💾 **Disk:** N/A (Cloudflare Workers)
🧠 **RAM:** N/A (Cloudflare Workers)
📁 **Downloads:** 0 files (0MB) — streaming only
`, { buttons: back('menu_admin') }));

  adminCb(/^admin_premium$/, e => e.edit(`
┏━━━━━━━━━━━━━━━━━⍟
┃  ⭐ 𝐏𝐫𝐞𝐦𝐢𝐮𝐦 𝐌𝐚𝐧𝐚𝐠𝐞𝐦𝐞𝐧𝐭
┗━━━━━━━━━━━━━━━━━━━━━⍟

**Commands:**
\`/pre <user_id> <duration>\` — Promote
\`/de <user_id>\` — Demote
\`/premium_users\` — List all
\`/demote_all_premium\` — Remove all
\`/addpremium <id> <days>\` — Grant days
\`/delpremium <id>\` — Revoke
\`/renew <id> <days>\` — Renew/extend
\`/finduser <id>\` — Lookup user
\`/userstats [id]\` — Download stats

**Duration:** 1d, 2d, 3d, 5d, 7d, 1w, 2w, 1m, unlimited
`, { buttons: back('menu_admin') }));

  adminCb(/^admin_gc$/, e => e.edit(`
┏━━━━━━━━━━━━━━━━━⍟
┃  🎁 𝐆𝐢𝐟𝐭 𝐂𝐚𝐫𝐝 𝐌𝐚𝐧𝐚𝐠𝐞𝐦𝐞𝐧𝐭
┗━━━━━━━━━━━━━━━━━━━━━⍟

**Commands:**
\`/gen <duration> [count]\` — Generate cards
\`/gclist\` — List all cards (with buttons)
\`/gctrack\` — Track who used cards
\`/gctrack 24h\` — Cards used last 24h
\`/gctrack <user_id>\` — Cards used by user
\`/gcdel <code>\` — Delete a card
\`/gcheck <code>\` — Validate a card
\`/allowredeem <user_id>\` — Reset user redemption

**Duration:** 1d, 2d, 3d, 5d, 7d, 1w, 2w, 1m, unlimited
`, { buttons: back('menu_admin') }));

  adminCb(/^admin_tags$/, e => e.edit(`
┏━━━━━━━━━━━━━━━━━⍟
┃  🏷 𝐓𝐚𝐠 𝐌𝐚𝐧𝐚𝐠𝐞𝐦𝐞𝐧𝐭
┗━━━━━━━━━━━━━━━━━━━━━⍟

**Commands:**
\`/settag <user_id> <tag>\` — Set custom tag
\`/masstag <id1,id2> <tag>\` — Tag many users
\`/untag <id1,id2>\` — Remove tags
\`/tag\` — View your own tag

**Auto Tags:**
Owner and Admins get auto-tagged if no custom tag set.
`, { buttons: back('menu_admin') }));

  adminCb(/^admin_ban$/, async e => {
    const banned = await db.smembers(BANNED_USERS_KEY);
    const lines = [];
    for (const uid of banned.slice(0, 10)) { const n = await nameOf(uid); lines.push(n ? `• ${n[0]} — \`${uid}\`` : `• Unknown — \`${uid}\``); }
    await e.edit(`
┏━━━━━━━━━━━━━━━━━⍟
┃  🚫 𝐁𝐚𝐧 𝐔𝐬𝐞𝐫𝐬
┗━━━━━━━━━━━━━━━━━━━━━⍟

**Current banned:**
${lines.length ? lines.join('\n') : 'No banned users.'}

**Commands:**
\`/finduser <id>\` — Lookup user
\`/ban <user_id>\` — Ban
\`/unban <user_id>\` — Unban
\`/banned_users\` — List all
`, { buttons: back('menu_admin') });
  });

  adminCb(/^admin_logs$/, e => e.edit(`
┏━━━━━━━━━━━━━━━━━⍟
┃  📝 𝐋𝐨𝐠𝐬
┗━━━━━━━━━━━━━━━━━━━━━⍟

Use: \`/logs\` or \`/logs 50\`
\`/errors [n]\` — Download failures
\`/apihealth\` — API status
\`/logrotate\` — Rotate log now
`, { buttons: back('menu_admin') }));

  adminCb(/^admin_broadcast$/, e => e.edit(`
┏━━━━━━━━━━━━━━━━━⍟
┃  📢 𝐁𝐫𝐨𝐚𝐝𝐜𝐚𝐬𝐭
┗━━━━━━━━━━━━━━━━━━━━━⍟

**Commands:**
\`/broadcast <message>\` — Send now (owner)
\`/broadcast_legacy <message>\` — Via channel (admin)
\`/announce <minutes> <msg>\` — Schedule delay
`, { buttons: back('menu_admin') }));

  adminCb(/^admin_maint$/, async e => {
    const [on, reason] = await getMaintenance();
    await e.edit(`🔧 Maintenance Mode\n\nStatus: **${on ? 'ON' : 'OFF'}**${reason ? `\nReason: ${reason}` : ''}\n\nON blocks new downloads for normal users; admins keep full access.`,
      { buttons: [[Button.inline('🔧 Turn ON', 'mt_on'), Button.inline('✅ Turn OFF', 'mt_off')], [Button.inline('◀️ Back', 'menu_admin')]] });
  });
  adminCb(/^mt_(on|off)/, async e => {
    const action = e.data.split('_')[1];
    await setMaintenance(action === 'on', '');
    await logAudit(`MAINTENANCE_${action.toUpperCase()}_BTN`, e.uid, '');
    await e.answer(`Maintenance ${action === 'on' ? 'ON' : 'OFF'}.`);
    await e.edit(`🔧 Maintenance Mode\n\nStatus: **${action === 'on' ? 'ON' : 'OFF'}**`, { buttons: back('menu_admin') });
  });

  async function apiHealth() {
    const cfg = await teraboxCfg(env, db), out = {};
    for (const [name, url] of [['resolver_worker', cfg.resolver], ['hls_proxy', cfg.proxy]]) {
      const t0 = Date.now();
      try {
        const r = await fetch(url, { signal: AbortSignal.timeout(10000) });
        out[name] = { ok: r.status < 500, state: [200, 302].includes(r.status) ? 'UP' : r.status < 500 ? 'REACHABLE' : 'DOWN', status: r.status, ms: Date.now() - t0 };
      } catch {
        out[name] = { ok: false, state: 'DOWN', status: 'None', ms: Date.now() - t0 };
      }
    }
    return out;
  }
  adminCb(/^admin_api$/, async e => {
    const lines = ['**API Health**', ''];
    for (const [n, r] of Object.entries(await apiHealth())) lines.push(`${r.state} **${n}**: status=${r.status} ${r.ms}ms`);
    await e.edit(lines.join('\n') + '\n\nFull: `/apihealth`', { buttons: back('menu_admin') });
  });

  // commands/config_editor.py — only the keys that still mean something on Workers
  const SPECS = {
    MAX_FILES_PER_REQUEST: { section: 'Limits', kind: 'int', min: 1, max: 50 },
    DOWNLOAD_COOLDOWN_SECONDS: { section: 'Limits', kind: 'int', min: 0, max: 300 },
    FREE_HOURLY_LIMIT: { section: 'Limits', kind: 'int', min: 0, max: 1000 },
    FORCE_CHANNELS: { section: 'Force Join', kind: 'csv' },
    FORCE_GROUPS: { section: 'Force Join', kind: 'csv' },
  };
  const BLOCKED = new Set(['BOT_TOKEN', 'API_ID', 'API_HASH', 'TURSO_DB_URL', 'TURSO_AUTH_TOKEN', 'PRIVATE_CHAT_ID', 'OWNER_ID', 'ADMINS', 'TERABOX_JSTOKEN', 'TERABOX_RESOLVER_WORKER', 'TERABOX_HLS_PROXY_WORKER']);
  async function configViewText() {
    const rt = await runtime(), lines = ['**Runtime Config**', ''];
    for (const section of ['Limits', 'Force Join']) {
      lines.push(`__${section}__`);
      for (const [k, s] of Object.entries(SPECS)) if (s.section === section) lines.push(`\`${k}\` = **${Array.isArray(rt[k]) ? rt[k].join(', ') || '-' : rt[k]}**`);
      lines.push('');
    }
    lines.push('Edit: `/configset <KEY> <VALUE>` · Reset: `/configreset <KEY>` (admin only).');
    return lines.join('\n');
  }
  function validateConfig(key, raw) {
    if (BLOCKED.has(key)) return [false, null, `\`${key}\` is protected — edit via ${key.includes('TERABOX') ? '/setapi' : 'wrangler.toml / secrets'}.`];
    const spec = SPECS[key];
    if (!spec) return [false, null, `Unknown key. Editable: \`${Object.keys(SPECS).sort().join(', ')}\``];
    if (spec.kind === 'int') {
      const v = parseInt(String(raw).trim(), 10);
      if (Number.isNaN(v)) return [false, null, `Invalid value: \`${raw}\``];
      return spec.min <= v && v <= spec.max ? [true, v, ''] : [false, null, `\`${key}\` must be ${spec.min}-${spec.max}.`];
    }
    const items = String(raw).split(',').map(x => x.trim()).filter(Boolean);
    if (!items.length || items.length > 20) return [false, null, `\`${key}\` needs 1-20 entries.`];
    const bad = items.find(t => !/^(?:@\w{3,64}|-100\d{5,32})$/.test(t));
    return bad ? [false, null, `Bad entry \`${bad}\` (use @name or -100id).`] : [true, items, ''];
  }
  adminCb(/^admin_config$/, async e => e.edit('**Runtime Config**\n\n' + (await configViewText()) + '\n\nEdit: `/configset <KEY> <VALUE>` · Reset: `/configreset <KEY>`', { buttons: back('menu_admin') }));

  adminCb(/^admin_backup$/, e => e.edit(`
┏━━━━━━━━━━━━━━━━━⍟
┃  💾 𝐁𝐚𝐜𝐤𝐮𝐩
┗━━━━━━━━━━━━━━━━━━━━━⍟

Use: \`/backup\`
Full snapshot: premium, bans, tags, gift cards, stats, history, config.
Restore: reply to the file with \`/restore\`
`, { buttons: back('menu_admin') }));

  // ==================== user mgmt / plans ====================
  on(/^\/remove (.*)/, async (m, g) => {
    if (await db.get(`check_${g[1]}`)) { await db.delete(`check_${g[1]}`); await m.reply(`Removed ${g[1]} from the list.`); }
    else await m.reply(`${g[1]} is not in the list.`);
  }, ADMIN);

  on(/^\/plan/, async m => m.reply((await db.get('custom_plan_text')) || `
┏━━━━━━━━━━━━━━━━━⍟
┃ 𝐓𝐞𝐫𝐚𝐁𝐨𝐱 𝐅𝐚𝐬𝐭𝐞𝐬𝐭 𝐃𝐋 𝐁𝐨𝐭
┗━━━━━━━━━━━━━━━━━━━━━⍟

🌟 **Free Plan**
• Unlimited streaming links
• Single file only

⚡ **Premium Plan**
• /videos access
• Multi-file support
• No size limit
• Priority speed

Contact @buggybeats for premium.
`));

  on(/^\/pre\s+(\d+)\s+(\S+)/, async (m, g) => {
    const uid = g[1], dur = g[2].toLowerCase();
    if (!(dur in DURATION_MAP)) return m.reply(`Invalid duration: \`${dur}\`\n\nValid: \`${Object.keys(DURATION_MAP).join(', ')}\`\n\n**Usage:** \`/pre <user_id> <duration>\`\nExample: \`/pre 123456 7d\``);
    const days = DURATION_MAP[dur];
    if (days === 0) { await grantPremium(uid, 99999); return m.reply(`✅ **${uid}** promoted to **permanent premium**.`); }
    await grantPremium(uid, days);
    await m.reply(`✅ **${uid}** promoted to premium for **${days} day(s)**.\nExpires: \`${dmyHM(Math.floor(nowS()) + days * 86400)}\``);
  }, ADMIN);

  on(/^\/de\s+(\d+)/, async (m, g) => {
    if (await isPremium(g[1])) { await revokePremium(g[1]); await m.reply(`✅ Revoked premium from **${g[1]}**.`); }
    else await m.reply(`**${g[1]}** is not a premium user.`);
  }, ADMIN);

  on(/^\/premium_users/, async m => {
    const all = await db.smembers(PREMIUM_SET_KEY);
    if (!all.length) return m.reply('No premium users found.');
    const lines = [];
    for (const uid of all) {
      const rem = await premiumRemaining(uid);
      if (rem === 0) { await revokePremium(uid); continue; }
      const n = await nameOf(uid);
      const status = rem > 9000000 ? '♾️ Permanent' : `⏰ ${Math.floor(rem / 86400)}d ${Math.floor((rem % 86400) / 3600)}h left`;
      lines.push(`• ${n ? n[0] : 'Unknown'} (@${n ? n[1] : '-'})\n  ID: \`${uid}\`\n  Status: ${status}`);
    }
    await m.reply(`**Premium Users (${lines.length}):**\n\n${lines.join('\n\n')}`.slice(0, 4000));
  }, ADMIN);

  on(/^\/demote_all_premium/, async m => {
    await db.delete(PREMIUM_SET_KEY);
    await db.delete(PREMIUM_EXPIRY_KEY);
    CACHE.clear();
    await m.reply('All premium users demoted successfully.');
  }, ADMIN);

  // ==================== the link handler (handle_message) ====================
  async function handleMessage(m, quality = null) {
    const T0 = Date.now();
    const url = getUrl(m.text);
    if (!url) return m.reply(ERRORS.unsupported_link);
    const shorturl = shareCode(url);
    if (!shorturl) return m.reply(ERRORS.invalid_link);

    // 1 D1 round trip for every check (was ~10 sequential queries)
    const [g, rt] = await Promise.all([gate(m.uid), runtime()]);
    if (g.maintenance) return m.reply('🔧 Bot is currently under maintenance. Please try again later.');
    if (g.banned) return m.reply('🚫 You are banned from using this bot.');
    const free = !g.premium && !g.admin;
    if (free && g.lastDl) {
      const cd = Math.floor(rt.DOWNLOAD_COOLDOWN_SECONDS - (nowS() - parseFloat(g.lastDl)));
      if (cd > 0) return m.reply(`⏳ Please wait **${cd} seconds** before downloading again.`);
    }
    // 0 = unlimited links for everyone (default); /configset FREE_HOURLY_LIMIT 10 brings the old cap back
    if (free && rt.FREE_HOURLY_LIMIT && int(g.count) >= rt.FREE_HOURLY_LIMIT) {
      const ttl = g.countExp ? Math.floor(g.countExp - nowS()) : 0;
      return m.reply(`You've reached your limit (${rt.FREE_HOURLY_LIMIT} videos/hour).\nTry again in **${ttl > 0 ? convertSeconds(ttl) : '1 hour'}**.\nUpgrade to **Premium** for unlimited downloads.`);
    }

    // The resolver (the slow part) runs while we post the status message and check membership.
    const filesP = getFiles(url);
    const [hm, joined, tag] = await Promise.all([
      m.reply('Sending you the media wait...'),
      (async () => {
        for (const ch of [...rt.FORCE_CHANNELS, ...rt.FORCE_GROUPS]) if (!(await isUserOnChat(ch, m.uid))) return ch;
        return null;
      })(),
      getCustomTag(m.uid), // also drops the tag of an expired premium user
      trackActivity(m.uid),
      g.expired ? revokePremium(m.uid) : null,
    ]);
    if (joined) return hm.edit(`Please join ${joined} then send me the link again.`);

    const files = await filesP;
    if (!files) return hm.edit(ERRORS.api_unavailable);
    if (files.length > rt.MAX_FILES_PER_REQUEST && !g.premium)
      return hm.edit(`⚠️ This link has **${files.length} files**.\nFree users can download max **${rt.MAX_FILES_PER_REQUEST}** files.\nUpgrade to **Premium** for unlimited.`);

    const todo = g.premium ? files : files.slice(0, 1);
    const after = () => [free ? setCooldown(m.uid) : null, db.set(`check_${m.uid}`, int(g.count) + 1, { ex: g.countExp ? Math.max(Math.ceil(g.countExp - nowS()), 1) : 3600 })];
    if (todo.length === 1) {
      const f = todo[0], ext = extOf(f.file_name);
      if (!VIDEO_EXTENSIONS.has(ext))
        return hm.edit(`Sorry! File type \`${ext}\` is not supported (photos aren't supported right now).\nSupported: ${[...VIDEO_EXTENSIONS].sort().join(', ')}`);
      const took = `${((Date.now() - T0) / 1000).toFixed(1)}s`;
      if (!(await sendStream(m.chatId, m.isPrivate, f, cardCaption(f, m.from, tag, took), quality, g.thumb))) {
        await recordDl(m.uid, 0, shorturl, false);
        return hm.edit(`Sorry! Download Failed but you can download it from [here](${url}).`, { buttons: [] });
      }
      console.log(`link ${shorturl} posted in ${Date.now() - T0}ms`);
      await Promise.all([
        hm.edit('✅ Video sent successfully to your chat!', { buttons: [] }),
        recordDl(m.uid, f.sizebytes, shorturl, true), libIndex([f]), addHistory(m.uid, [f]), ...after(),
      ]);
      return;
    }
    const [sent, failed] = await sendMany(m, todo, tag, quality, shorturl, g.thumb);
    await Promise.all([hm.edit(`✅ Complete!\nSent: ${sent}/${todo.length} | Failed: ${failed}`, { buttons: [] }), ...after()]);
  }

  // multi-file / folder: one stream post per video
  // ponytail: 15 posts per message keeps one request under the free plan's 50 subrequests
  // (each post can cost 2 Telegram calls); the rest are listed so the user can open them.
  const MAX_POSTS = 15;
  async function sendMany(m, todo, tag, quality, link, thumb = null) {
    const ok = [];
    let failed = 0, sendFails = 0;
    const videos = todo.filter(f => VIDEO_EXTENSIONS.has(extOf(f.file_name)));
    failed += todo.length - videos.length;
    for (const f of videos.slice(0, MAX_POSTS)) {
      if (await sendStream(m.chatId, m.isPrivate, f, cardCaption(f, m.from, tag, null), quality, thumb)) ok.push(f);
      else { failed++; sendFails++; }
    }
    const rest = videos.slice(MAX_POSTS);
    if (rest.length) await m.reply(`➕ ${rest.length} more video(s) in this link:\n${rest.slice(0, 40).map(f => `• \`${captionName(f.file_name)}\``).join('\n')}\n\nUse /search <name> to open them.`);
    await Promise.all([
      recordDl(m.uid, ok.reduce((a, f) => a + f.sizebytes, 0), link, true, ok.length),
      recordDl(m.uid, 0, link, false, sendFails),
      libIndex([...ok, ...rest]),
      addHistory(m.uid, ok),
    ]);
    return [ok.length, failed];
  }

  on(/^\/cleandownloads/, m => m.reply('Downloads folder does not exist. Nothing to clean.'), ADMIN);

  on(/^\/mystatus/, async m => {
    const tag = await getCustomTag(m.uid), h = await db.hgetall(`user_stats_${m.uid}`);
    const exp = await db.hget(PREMIUM_EXPIRY_KEY, String(m.uid));
    const prem = exp ? `🟡 Premium expires in ${Math.max(Math.floor((parseFloat(exp) - nowS()) / 86400), 0)} days` : '🆓 Free user';
    await m.reply(`**👤 Your Status**\n\n💰 **Premium:** ${prem}\n${tag ? `🏷 Tag: **${tag}**` : '🏷 No custom tag'}\n📊 **Download Stats:**\n` +
      `• Total downloads: **${int(h.total)}**\n• Total storage: **${fmtSize(int(h.storage))}**\n• Last activity: **${h.last_activity || 'Never'}**\n\n💡 Use /plan to check premium plans, /tag to manage your tag.`);
  });

  // ==================== owner: server ops (Workers equivalents) ====================
  async function bootCard(chatId) {
    const boots = await db.incr('stats:boot_count');
    const [maint] = await getMaintenance();
    await api.send(chatId,
      '┏━━━━━━━━━━━━━━━━━⍟\n┃  ⚡ **𝐒𝐘𝐒𝐓𝐄𝐌 𝐎𝐍𝐋𝐈𝐍𝐄**\n┗━━━━━━━━━━━━━━━━━━━━━⍟\n\n' +
      `🆔 **Build:** \`${(env.CF_VERSION?.id || '?').slice(0, 8)}\` (#${boots})\n🕒 **Started:** \`${dmyHM(nowS())}\`\n☁️ **Runtime:** \`Cloudflare Workers\`\n\n` +
      `🛠 **Maintenance:** \`${maint ? 'ON' : 'OFF'}\`\n\n🗄️ **D1:** 🟢 Connected\n\n┏━━━━━━━━━━━━━━━━━⍟\n┃  🛡️ All systems operational\n┗━━━━━━━━━━━━━━━━━━━━━⍟`,
      { buttons: [[Button.inline('⚙️ Admin Panel', 'menu_admin'), Button.inline('📊 Stats', 'menu_mystats')], [Button.inline('📋 My Info', 'menu_info')]] });
  }
  on(/^\/update/, m => m.reply('On Cloudflare the bot updates by deploying: run `npx wrangler deploy` in the `cloudflare` folder. No restart needed.'), OWNER);
  on(/^\/(restart|force)/, async m => { await m.reply(m.text.startsWith('/force') ? 'Force restarting bot...' : 'Restarting bot...'); await bootCard(m.chatId); }, OWNER);

  on(/^\/setforce\s+(channel|group)\s+(\S+)/, async (m, g) => {
    const key = g[1] === 'channel' ? 'FORCE_CHANNELS' : 'FORCE_GROUPS', list = (await runtime())[key];
    if (!list.includes(g[2])) list.push(g[2]);
    await setOverride(key, list.join(','));
    await m.reply(`Force ${g[1]} updated.\nCurrent ${g[1]}s: ${pyList(list)}`);
  }, OWNER);
  on(/^\/removeforce\s+(channel|group)\s+(\S+)/, async (m, g) => {
    const key = g[1] === 'channel' ? 'FORCE_CHANNELS' : 'FORCE_GROUPS', list = (await runtime())[key].filter(x => x !== g[2]);
    await setOverride(key, list.join(','));
    await m.reply(`Force ${g[1]} removed.\nCurrent ${g[1]}s: ${pyList(list)}`);
  }, OWNER);

  on(/^\/adcmd/, async m => {
    let text = `
┏━━━━━━━━━━⍟
┃ 𝘼𝙙𝙢𝙞𝙣 & 𝙊𝙬𝙣𝙚𝙧 𝘾𝙤𝙢𝙢𝙖𝙣𝙙𝙨
┗━━━━━━━━━━━━━━━━━⍟

**── Premium Management ──**
/pre \`<user_id>\` \`<duration>\` — Promote to premium
/de \`<user_id>\` — Demote from premium
/premium_users — List all premium with expiry
/demote_all_premium — Remove all premium
/addpremium \`<id>\` \`<days>\` — Grant premium days
/delpremium \`<id>\` — Revoke premium
/renew \`<id>\` \`<days>\` — Renew/extend premium
/userstats \`[id]\` — Per-user download stats

**Duration:** \`1d\` \`2d\` \`3d\` \`5d\` \`7d\` \`1w\` \`2w\` \`1m\` \`unlimited\`

**── Gift Cards ──**
/gen \`<duration>\` \`[count]\` — Generate gift cards
/gclist — List all gift cards
/gcdel \`<code>\` — Delete a gift card
/gcheck \`<code>\` — Validate a gift card

**── User Management ──**
/finduser \`<id>\` — Lookup user (status/premium/tag)
/ban \`<user_id>\` — Ban user
/unban \`<user_id>\` — Unban user
/banned_users — List banned users
/masstag \`<id1,id2>\` \`<tag>\` — Tag many users
/untag \`<id1,id2>\` — Remove tags
/remove \`<user_id>\` — Remove user rate limit
/broadcast \`<message>\` — Broadcast (owner only)
/broadcast_legacy \`<message>\` — Broadcast via channel
/announce \`<minutes>\` \`<message>\` — Scheduled broadcast

**── Bot Management ──**
/stats — Bot statistics + top users/links
/usage — Disk, RAM, CPU usage
/logs \`[count]\` — Recent error logs
/errors \`[count]\` — Recent download failures
/apihealth — Resolver/HLS worker status
/logrotate — Rotate bot.log now (auto daily)
/configview — View runtime config
/configset \`<KEY>\` \`<VALUE>\` — Edit runtime config
/configreset \`<KEY>\` — Reset key to default
/setapi \`<jstoken|resolver|proxy>\` \`<value>\` — Rotate resolver config live
/reloadconfig — Reload resolver config
/backup — Full Redis snapshot
/restore — Restore (reply to backup file)
/reindex — Rebuild file library (owner)
/setplan \`<text>\` — Update plan text
/cleandownloads — Clean downloads folder

**── Media Tools ──**
/mp3 — Reply to video → bitrate menu (128/192/256/320)
/compress — Reply to video → resolution menu (480/720/1080)
/dl \`<link>\` — Download original quality
/dl \`720p\` \`<link>\` — Download + compress 720p
/dl \`480p\` \`<link>\` — Download + compress 480p
/folder \`<link>\` — Download entire folder (premium)
/quick \`<link>\` — Fast single-file download
/preview \`<link>\` — Preview first 3 files
/search \`<name>\` — Find files in the library
/mystatus — Your premium/tag/stats
/mystats — Download statistics
/ref — Invite friends, earn Premium
/cancel — Cancel active downloads
/setthumb — Reply to image → set thumbnail (premium)
/removethumb — Remove custom thumbnail
/lang \`<code>\` — Set language (en/ne/hi)
`;
    if (m.uid === OWNER_ID) text += `
**── Owner Only ──**
/update — Pull latest code & restart bot
/setforce channel \`@username\` — Add force channel
/setforce group \`@username\` — Add force group
/removeforce channel \`@username\` — Remove force channel
/removeforce group \`@username\` — Remove force group
/panic — 🚨 Emergency stop all services
/resume — Bring bot back online
/maintenance [on/off] — Toggle maintenance mode
/auditlog \`[count]\` — View admin action log
/maxfiles \`<number>\` — Set max files per request
/setcooldown \`<seconds>\` — Set download cooldown

**── Admin Management (Owner) ──**
/addadmin \`<user_id>\` — Add new admin
/removeadmin \`<user_id>\` — Remove admin
/adminlist — List all admins
`;
    await m.reply(text);
  }, ADMIN);

  on(/^\/history/, async m => {
    const raw = await db.get(`history_${m.uid}`);
    if (!raw) return m.reply('No download history yet.');
    const h = JSON.parse(raw);
    const lines = [...h].reverse().map((x, i) => { const e = JSON.parse(x); return `${i + 1}. \`${e.file}\` (${e.size}) — ${e.time}`; });
    let text = `**Your Download History (${h.length}):**\n\n${lines.join('\n')}`;
    if (text.length > 4000) text = text.slice(0, 4000) + '\n...';
    await m.reply(text);
  });

  // ==================== thumbnail (used as the stream post's picture) ====================
  on(/^\/setthumb/, async m => {
    if (!(await isPremium(m.uid))) return m.reply('Premium feature only.\nUse /plan to check plans.');
    if (!m.replyTo) return m.reply('Reply to an image with `/setthumb` to set your custom thumbnail.');
    const photo = m.replyTo.photo?.at(-1);
    if (!photo) return m.reply('Please reply to a **photo/image** only.');
    await db.hset(THUMB_KEY, String(m.uid), photo.file_id);
    await m.reply('✅ Custom thumbnail set!\nIt will be used on your downloads.');
  });
  on(/^\/removethumb/, async m => { await db.hdel(THUMB_KEY, String(m.uid)); await m.reply('✅ Custom thumbnail removed.'); });

  on(/^\/lang(?:\s+(\w+))?/, async (m, g) => {
    const code = g[1]?.toLowerCase();
    if (!code || !(code in LANGUAGES))
      return m.reply(`**Select Language:**\n\n${Object.entries(LANGUAGES).map(([k, v]) => `\`${k}\` — ${v}`).join('\n')}\n\nUsage: \`/lang ne\``);
    await db.set(`${LANG_KEY}_${m.uid}`, code);
    await m.reply(LANG_SET[code].replace('{lang}', LANGUAGES[code]));
  });

  on(/^\/dl(?:\s+(\w+))?\s+(https?:\/\/\S+)/, async (m, g) => {
    const q = g[1]?.toLowerCase();
    if (q && !(q in DL_QUALITY_MAP)) return m.reply(`Invalid quality: \`${q}\`\nValid: ${Object.keys(DL_QUALITY_MAP).join(', ')}`);
    await handleMessage({ ...m, text: g[2] }, q ? DL_QUALITY_MAP[q] : null);
  });

  on(/^\/folder\s+(https?:\/\/\S+)/, async (m, g) => {
    const url = g[1];
    if (await isBanned(m.uid)) return m.reply('🚫 You are banned from using this bot.');
    if (!(await isPremium(m.uid))) return m.reply('Folder download is a **premium feature**.\nUse /plan to check plans.');
    if ((await isMaintenance()) && !(await isAdmin(m.uid))) return m.reply('🔧 Bot is currently under maintenance. Please try again later.');
    const hm = await m.reply('Fetching folder contents...');
    const files = await getFiles(url);
    if (!files) return hm.edit('Sorry! Could not fetch folder contents.');
    if (files.length === 1) { await hm.delete(); return handleMessage({ ...m, text: url }); }
    const [sent, failed] = await sendMany(m, files, await getCustomTag(m.uid), null, url, await db.hget(THUMB_KEY, String(m.uid)));
    await hm.edit(`✅ Folder complete!\nSent: ${sent}/${files.length} | Failed: ${failed}`, { buttons: [] });
  });

  on(/^\/banned_users/, async m => {
    const banned = await db.smembers(BANNED_USERS_KEY);
    if (!banned.length) return m.reply('No banned users.');
    const lines = [];
    for (const uid of banned) { const n = await nameOf(uid); lines.push(`• ${n ? n[0] : 'Unknown'} (@${n ? n[1] : '-'}) — \`${uid}\``); }
    await m.reply(`**Banned Users (${lines.length}):**\n\n${lines.join('\n')}`.slice(0, 4000));
  }, ADMIN);

  on(/^\/usage/, m => m.reply('**Bot Resource Usage**\n\n**Disk:** N/A\n**RAM:** N/A\n**Downloads:** 0 files (0MB) — streaming only\n**Platform:** Cloudflare Workers\n**Uptime:** serverless (always on)\n'), ADMIN);

  on(/^\/logs(?:\s+(\d+))?/, async (m, g) => {
    const lines = await db.lrange(LOG_KEY, 0, Math.min(int(g[1] || 20), 100) - 1);
    if (!lines.length) return m.reply('Log file is empty.');
    await m.reply('```\n' + lines.reverse().join('\n').slice(-3000) + '\n```');
  }, ADMIN);

  on(/^\/setplan\s+(.*)/s, async (m, g) => { await db.set('custom_plan_text', g[1]); await m.reply(`Plan text updated:\n\n${g[1]}`); }, OWNER);

  // Python sent this to channel -1001336746488's members; Bot API → the bot's known users.
  on(/^\/announce\s+(\d+)\s+(.*)/s, async (m, g) => {
    const minutes = int(g[1]);
    if (minutes > 1440) return m.reply('Max 1440 minutes (24 hours).');
    await m.reply(`Announcement scheduled in ${minutes} minute(s).`);
    await queueBroadcast({ kind: 'announce', mode: 'text', text: g[2], send_at: Math.floor(nowS()) + minutes * 60, total: await db.scard('all_known_users'), status_chat: m.chatId, status_msg: m.id });
  }, OWNER);

  on(/^\/panic/, async m => {
    await db.set(MAINTENANCE_KEY, '1'); uncache('maint');
    await logAudit('PANIC_STOP', m.uid, 'Emergency stop activated');
    await m.reply('🚨 **EMERGENCY STOP ACTIVATED**\n\nAll download services are now **STOPPED**.\nUsers will see: `Bot under maintenance`\n\nUse `/resume` to bring bot back online.');
  }, OWNER);
  on(/^\/resume/, async m => {
    await db.delete(MAINTENANCE_KEY); uncache('maint');
    await logAudit('RESUME', m.uid, 'Bot resumed from panic/maintenance');
    await m.reply('✅ **Bot is back online!** All services resumed.');
  }, OWNER);

  on(/^\/auditlog(?:\s+(\d+))?/, async (m, g) => {
    const entries = await db.lrange(AUDIT_LOG_KEY, 0, Math.min(int(g[1] || 15), 50) - 1);
    if (!entries.length) return m.reply('No audit log entries found.');
    const lines = entries.map((x, i) => { const e = JSON.parse(x); return `${i + 1}. \`${e.time}\` — **${e.action}** by \`${e.admin}\`${e.details ? `\n   ${e.details}` : ''}`; });
    let text = `**📝 Audit Log (last ${lines.length}):**\n\n${lines.join('\n\n')}`;
    if (text.length > 4000) text = text.slice(0, 4000) + '\n...';
    await m.reply(text);
  }, OWNER);

  on(/^\/maxfiles\s+(\d+)/, async (m, g) => {
    await setOverride('MAX_FILES_PER_REQUEST', int(g[1]));
    await logAudit('SET_MAX_FILES', m.uid, `Set to ${int(g[1])}`);
    await m.reply(`✅ Max files per request set to **${int(g[1])}**.`);
  }, OWNER);
  on(/^\/setcooldown\s+(\d+)/, async (m, g) => {
    await setOverride('DOWNLOAD_COOLDOWN_SECONDS', int(g[1]));
    await logAudit('SET_COOLDOWN', m.uid, `Set to ${int(g[1])}s`);
    await m.reply(`✅ Download cooldown set to **${int(g[1])} seconds**.`);
  }, OWNER);

  on(/^\/addadmin\s+(\d+)/, async (m, g) => {
    const uid = int(g[1]);
    if (uid === OWNER_ID) return m.reply('Cannot remove owner from admin.');
    if (await isAdmin(uid)) return m.reply(`User \`${uid}\` is already an admin.`);
    await db.sadd(DYNAMIC_ADMINS_KEY, String(uid)); uncache(`admin:${uid}`);
    await logAudit('ADD_ADMIN', m.uid, `Added user ${uid}`);
    const n = await nameOf(uid);
    await m.reply(n ? `✅ **Admin Added!**\n\n**Name:** ${n[0]}\n**Username:** @${n[1]}\n**ID:** \`${uid}\`` : `✅ Admin \`${uid}\` added (user not found for name).`);
  }, OWNER);
  on(/^\/removeadmin\s+(\d+)/, async (m, g) => {
    const uid = int(g[1]);
    if (uid === OWNER_ID) return m.reply('Cannot remove owner from admin.');
    if (ADMINS.includes(uid)) return m.reply(`❌ Cannot remove \`${uid}\` — they are a **config admin**.\nEdit ADMINS in wrangler.toml to remove them.`);
    if (!(await db.sismember(DYNAMIC_ADMINS_KEY, String(uid)))) return m.reply(`User \`${uid}\` is not an admin.`);
    await db.srem(DYNAMIC_ADMINS_KEY, String(uid)); uncache(`admin:${uid}`);
    await logAudit('REMOVE_ADMIN', m.uid, `Removed user ${uid}`);
    await m.reply(`✅ Admin \`${uid}\` removed.`);
  }, OWNER);
  on(/^\/adminlist/, async m => {
    const lines = [];
    for (const uid of ADMINS) { const n = await nameOf(uid); lines.push(n ? `• ${n[0]} (@${n[1]}) — \`${uid}\` 🔒 Config` : `• Unknown — \`${uid}\` 🔒 Config`); }
    for (const uid of await db.smembers(DYNAMIC_ADMINS_KEY)) {
      if (ADMINS.includes(int(uid))) continue;
      const n = await nameOf(uid);
      lines.push(n ? `• ${n[0]} (@${n[1]}) — \`${uid}\` ⚡ Dynamic` : `• Unknown — \`${uid}\` ⚡ Dynamic`);
    }
    if (!lines.length) return m.reply('No admins found.');
    await m.reply(`**👥 All Admins (${lines.length}):**\n\n${lines.join('\n')}\n\n🔒 = Config admin | ⚡ = Bot-added admin`);
  }, OWNER);

  // ==================== commands/admin_users.py ====================
  const parseIds = raw => [...new Set(String(raw || '').trim().split(/[\s,;]+/).filter(p => /^\d+$/.test(p)).map(int))];
  const parseDays = raw => { const d = parseInt(String(raw).trim(), 10); return d > 0 ? d : null; };
  const renewResult = (uid, days, was) => `**${uid}** ${was ? 'renewed' : 'granted'} for **${days} day(s)**.\nExpires: \`${dmyHM(Math.floor(nowS()) + days * 86400)}\``;

  on(/^\/finduser\s+(\d+)/, async (m, g) => {
    const uid = g[1], banned = await db.sismember(BANNED_USERS_KEY, uid), prem = await isPremium(uid);
    const rem = prem ? await premiumRemaining(uid) : 0, tag = await getCustomTag(int(uid)), n = await nameOf(uid);
    const premTxt = prem ? (rem > 9000000 ? 'Permanent' : `Premium (${Math.floor(rem / 86400)}d ${Math.floor((rem % 86400) / 3600)}h left)`) : 'Free';
    await m.reply(`**User \`${uid}\`**\n${n ? n[0] : 'Unknown'} (@${n ? n[1] : '-'})\n• Status: ${banned ? 'Banned' : 'Active'}\n• ${premTxt}\n• ${tag ? `Tag: **${tag}**` : 'No tag'}`);
  }, ADMIN);
  on(/^\/ban\s+(\d+)/, async (m, g) => { await db.sadd(BANNED_USERS_KEY, g[1]); uncache(`banned:${g[1]}`); await m.reply(`Banned user \`${g[1]}\`.`); }, ADMIN);
  on(/^\/unban\s+(\d+)/, async (m, g) => { await db.srem(BANNED_USERS_KEY, g[1]); uncache(`banned:${g[1]}`); await m.reply(`Unbanned user \`${g[1]}\`.`); }, ADMIN);
  on(/^\/addpremium\s+(\d+)\s+(\d+)/, async (m, g) => {
    const days = parseDays(g[2]);
    if (!days) return m.reply('**Usage:** `/addpremium <id> <days>`');
    await grantPremium(int(g[1]), days);
    await m.reply(renewResult(g[1], days, false));
  }, ADMIN);
  on(/^\/delpremium\s+(\d+)/, async (m, g) => {
    if (await isPremium(g[1])) { await revokePremium(int(g[1])); await m.reply(`Revoked premium from **${g[1]}**.`); }
    else await m.reply(`**${g[1]}** is not a premium user.`);
  }, ADMIN);
  on(/^\/renew\s+(\d+)\s+(\d+)/, async (m, g) => {
    const days = parseDays(g[2]);
    if (!days) return m.reply('**Usage:** `/renew <id> <days>`');
    const was = await isPremium(g[1]);
    await grantPremium(int(g[1]), days);
    await m.reply(renewResult(g[1], days, was));
  }, ADMIN);
  on(/^\/masstag\s+([\d,\s;]+)\s+(.+)/, async (m, g) => {
    const ids = parseIds(g[1]), tag = g[2].trim();
    if (!ids.length || !tag) return m.reply('**Usage:** `/masstag <id1,id2..> <tag>`');
    for (const id of ids) await setCustomTag(id, tag);
    await m.reply(`Tagged ${ids.length}/${ids.length} as **${tag}**.`);
  }, ADMIN);
  on(/^\/gcheck\s+(\S+)/, async (m, g) => {
    const code = g[1].trim().toUpperCase();
    const [days, tag, used] = await Promise.all([db.hget(GC_REDIS_KEY, code), db.hget(GC_TAGS_KEY, code), db.hget(GC_USED_KEY, code)]);
    const t = tag ? `\nTag: **${tag}**` : '';
    if (used) return m.reply(`\`${code}\` — **USED** by \`${String(used).split(':')[0] || '?'}\`.${t}`);
    if (days == null) return m.reply(`\`${code}\` — invalid or unknown.`);
    await m.reply(`\`${code}\` — **VALID** (${days !== '0' ? `${days} day(s)` : 'Permanent'}).${t}`);
  }, ADMIN);
  on(/^\/untag\s+([\d,\s;]+)/, async (m, g) => {
    const ids = parseIds(g[1]);
    if (!ids.length) return m.reply('**Usage:** `/untag <id1,id2..>`');
    for (const id of ids) await db.hdel(CUSTOM_TAGS_KEY, String(id));
    await m.reply(`Untagged ${ids.length}/${ids.length}.`);
  }, ADMIN);

  // ==================== commands/analytics.py ====================
  on(/^\/stats/, async m => {
    const [s, active, prem, banned, gc, topRows, links] = await Promise.all([
      db.hgetall(STATS_KEY), db.get(`active_${ymd()}`), db.scard(PREMIUM_SET_KEY), db.scard(BANNED_USERS_KEY), db.hlen(GC_REDIS_KEY),
      db.all("SELECT key, CAST(value AS INTEGER) n FROM hashes WHERE key LIKE 'user_stats_%' AND field = 'total' ORDER BY n DESC LIMIT 5"),
      db.zrevrange(LINK_COUNTS_KEY, 3),
    ]);
    const lines = ['**Bot Statistics**', '', `**Total Downloads:** ${int(s.total_downloads)}`, `**Total Users:** ${int(s.total_users)}`,
      `**Active Today:** ${int(active)}`, `**Premium Users:** ${prem}`, `**Banned Users:** ${banned}`, `**Gift Cards:** ${gc}`, `**Library Hits:** ${int(s.lib_hits)}`, '', '**Top 5 Users:**'];
    if (!topRows.length) lines.push('__No user data yet.__');
    for (const [i, r] of topRows.entries()) {
      const uid = r.key.split('_').pop(), u = await api.user(uid);
      let name = u ? `${u.first_name || ''} ${u.last_name || ''}`.trim() : '';
      if (u?.username) name = `${name} (@${u.username})`.trim();
      lines.push(`${i + 1}. ${name ? `${name} \`${uid}\`` : `\`${uid}\``} — ${r.n} downloads`);
    }
    if (links.length) { lines.push('', '**Popular Links:**'); links.forEach(([l, n], i) => lines.push(`${i + 1}. \`${l}\` — ${Math.floor(n)} downloads`)); }
    await m.reply(lines.join('\n'));
  }, ADMIN);
  on(/^\/userstats(?:\s+(\d+))?/, async (m, g) => {
    const target = g[1] ? int(g[1]) : m.uid, h = await db.hgetall(`user_stats_${target}`), tag = await db.hget(CUSTOM_TAGS_KEY, String(target));
    await m.reply(`**User Stats — \`${target}\`**\n\n**Premium:** N/A\n${tag ? `Tag: **${tag}**` : 'No custom tag'}\n**Downloads:** ${int(h.total)}\n**Storage:** ${fmtSize(int(h.storage))}\n**Last activity:** ${h.last_activity || 'Never'}`);
  }, ADMIN);
  on(/^\/apihealth$/, async m => {
    const lines = ['**API Health**', ''];
    for (const [n, r] of Object.entries(await apiHealth())) lines.push(`${r.state} **${n}**: ok=${r.ok ? 'True' : 'False'} status=${r.status} ${r.ms}ms`);
    lines.push('', '__UP = healthy | REACHABLE = server alive (probe link rejected) | DOWN = failing__');
    await m.reply(lines.join('\n'));
  }, ADMIN);
  on(/^\/errors(?:\s+(\d+))?/, async (m, g) => {
    const n = Math.max(1, Math.min(int(g[1] || 15), 100));
    const errs = (await db.lrange(LOG_KEY, 0, 499)).reverse().filter(l => /ERROR|Error|Failed|failed|Traceback/.test(l)).slice(-n);
    if (!errs.length) return m.reply('No errors found in log.');
    await m.reply('```\n' + errs.join('\n').slice(-3000) + '\n```');
  }, ADMIN);

  // ==================== commands/maintenance.py ====================
  const denyUnlessAdmin = fn => async (m, g) => ((await isAdmin(m.uid)) ? fn(m, g) : m.reply('Not authorized.'));
  on(/^\/maintenance(?:\s+(on|off))?(?:\s+(.*))?$/s, denyUnlessAdmin(async (m, g) => {
    const arg = (g[1] || '').toLowerCase(), reason = (g[2] || '').trim();
    if (!arg) { const [on, cur] = await getMaintenance(); return m.reply(`Maintenance is **${on ? 'ON' : 'OFF'}**${cur ? `\nReason: ${cur}` : ''}`); }
    const on = await setMaintenance(arg === 'on', reason);
    await logAudit(`MAINTENANCE_${arg.toUpperCase()}`, m.uid, reason);
    await m.reply(`Maintenance **${on ? 'ON' : 'OFF'}**${reason ? `\nReason: ${reason}` : ''}`);
  }));
  on(/^\/logrotate$/, denyUnlessAdmin(async m => {
    const n = (await db.lrange(LOG_KEY, 0, -1)).length;
    await db.delete(LOG_KEY);
    const text = `Rotated bot_log (${n} lines), kept 0 file(s).`;
    await logAudit('LOGROTATE', m.uid, text);
    await m.reply(text);
  }));
  const short = (t, n = 160) => { t = t == null ? '-' : String(t); return t.length <= n ? t : t.slice(0, n) + '...'; };
  const reloadText = c => `Reloaded resolver config without restart.\njsToken: \`${short(c.jstoken ? c.jstoken.slice(0, 10) + '...' : '')}\`\nResolver worker: \`${short(c.resolver)}\`\nHLS proxy worker: \`${short(c.proxy)}\``;
  on(/^\/setapi\s+(jstoken|resolver|proxy)\s+(\S.*)$/s, denyUnlessAdmin(async (m, g) => {
    const slot = g[1].toLowerCase(), value = g[2].trim();
    if (slot !== 'jstoken' && !value.startsWith('http'))
      return m.reply('Usage: `/setapi <jstoken|resolver|proxy> <value>`\n`resolver`/`proxy` must be a worker URL starting with http.');
    await db.set(`terabox_cfg:${slot}`, slot === 'jstoken' ? value : value.replace(/\/$/, ''));
    uncache('tbcfg');
    await logAudit('SETAPI', m.uid, `${slot}=${value.slice(0, 120)}`);
    await m.reply(reloadText(await teraboxCfg(env, db)));
  }));
  on(/^\/reloadconfig$/, denyUnlessAdmin(async m => {
    uncache('tbcfg');
    const c = await teraboxCfg(env, db);
    await logAudit('RELOADCONFIG', m.uid, JSON.stringify({ resolver: c.resolver, proxy: c.proxy }).slice(0, 200));
    await m.reply(reloadText(c));
  }));

  // ==================== commands/config_editor.py ====================
  on(/^\/configview$/, async m => m.reply(await configViewText()), ADMIN);
  on(/^\/configset(?:\s+(.*))?$/s, async m => {
    const p = m.text.trim().split(/\s+/);
    if (p.length < 3) return m.reply('**Usage:** `/configset <KEY> <VALUE>`');
    const key = p[1].toUpperCase(), raw = m.text.trim().replace(/^\S+\s+\S+\s+/, '');
    if (BLOCKED.has(key)) return m.reply(`\`${key}\` is protected and can never be edited from Telegram.`);
    const [ok, v, err] = validateConfig(key, raw);
    if (!ok) return m.reply(err);
    const store = Array.isArray(v) ? v.join(',') : String(v);
    await setOverride(key, store);
    await logAudit('CONFIGSET', m.uid, `${key}=${store}`);
    await m.reply(`Updated \`${key}\` = **${store}** (live, no restart).`);
  }, ADMIN);
  on(/^\/configreset(?:\s+(\S+))?$/, async (m, g) => {
    const arg = (g[1] || '').trim().toUpperCase();
    if (!arg) return m.reply('**Usage:** `/configreset <KEY>`');
    if (BLOCKED.has(arg) || !SPECS[arg]) return m.reply(`Unknown or protected key: \`${arg}\``);
    await db.hdel('config_overrides', arg); uncache('cfg');
    await logAudit('CONFIGRESET', m.uid, arg);
    const rt = await runtime();
    await m.reply(`\`${arg}\` reset to default (${Array.isArray(rt[arg]) ? rt[arg].join(', ') : rt[arg]}).`);
  }, ADMIN);

  // ==================== commands/backup.py ====================
  const B_SETS = ['premium_users', 'banned_users', 'dynamic_admins', 'all_known_users'];
  const B_HASHES = ['premium_expiry', 'custom_tags', 'gift_cards', 'gc_tags', 'gc_used', 'bot_stats', 'config_overrides'];
  const B_STRINGS = ['maintenance_mode', 'maintenance_mode:reason', 'stats:broadcasts', 'stats:boot_count'];
  on(/^\/backup$/, async m => {
    const msg = await m.reply('Backing up Redis data...');
    try {
      const data = { sets: {}, hashes: {}, strings: {}, lists: {}, zsets: {} };
      for (const r of await db.all(`SELECT key, member FROM sets WHERE key IN (${B_SETS.map(() => '?').join(',')}) ORDER BY member`, ...B_SETS)) (data.sets[r.key] ??= []).push(r.member);
      for (const r of await db.all(`SELECT key, field, value FROM hashes WHERE key IN (${B_HASHES.map(() => '?').join(',')}) OR key LIKE 'user_stats_%'`, ...B_HASHES)) (data.hashes[r.key] ??= {})[r.field] = r.value;
      for (const r of await db.all(`SELECT key, value FROM kv WHERE (key IN (${B_STRINGS.map(() => '?').join(',')}) OR key LIKE 'history_%' OR key LIKE 'gc_redeemed_%') AND (expires_at IS NULL OR expires_at > ?)`, ...B_STRINGS, nowS())) data.strings[r.key] = r.value;
      data.lists.audit_log = await db.lrange(AUDIT_LOG_KEY, 0, -1);
      data.zsets.link_counts = await db.zrange(LINK_COUNTS_KEY);
      const sum = o => Object.values(o).reduce((a, v) => a + (Array.isArray(v) ? v.length : Object.keys(v).length), 0);
      const caption = `**Redis Backup**\nSets: ${sum(data.sets)} | Hashes: ${sum(data.hashes)} | Strings: ${Object.keys(data.strings).length} | Lists: ${data.lists.audit_log.length} | ZSets: ${data.zsets.link_counts.length}\nRestore: reply to this file with \`/restore\``;
      const form = new FormData();
      form.append('chat_id', String(m.chatId));
      form.append('caption', md(caption));
      form.append('parse_mode', 'HTML');
      form.append('document', new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }), 'backup.json');
      const r = await (await fetch(`${env.TG_API || 'https://api.telegram.org'}/bot${env.BOT_TOKEN}/sendDocument`, { method: 'POST', body: form })).json();
      if (!r.ok) throw new Error(r.description);
      await msg.delete();
    } catch (e) { await msg.edit(`Backup failed: \`${e.message}\``); }
  }, OWNER);
  on(/^\/restore$/, async m => {
    const doc = m.replyTo?.document;
    if (!doc) return m.reply('Reply to a backup `.json` file with `/restore`.');
    let data;
    try {
      const f = await api.call('getFile', { file_id: doc.file_id });
      data = await (await fetch(`${env.TG_API || 'https://api.telegram.org'}/file/bot${env.BOT_TOKEN}/${f.result.file_path}`)).json();
    } catch (e) { return m.reply(`Could not download file: \`${e.message}\``); }
    try {
      const st = [], c = { sets: 0, hashes: 0, strings: 0, lists: 0, zsets: 0 };
      for (const [k, ms] of Object.entries(data.sets || {})) for (const v of ms || []) { st.push(db.q('INSERT INTO sets(key, member) VALUES (?, ?) ON CONFLICT DO NOTHING', k, String(v))); c.sets++; }
      for (const [k, h] of Object.entries(data.hashes || {})) for (const [f, v] of Object.entries(h || {})) { st.push(db.q('INSERT INTO hashes(key, field, value) VALUES (?, ?, ?) ON CONFLICT(key, field) DO UPDATE SET value = excluded.value', k, f, String(v))); c.hashes++; }
      for (const [k, v] of Object.entries(data.strings || {})) { st.push(db.q('INSERT INTO kv(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, expires_at = NULL', k, String(v))); c.strings++; }
      for (const [k, items] of Object.entries(data.lists || {})) {
        st.push(db.q('DELETE FROM lists WHERE key = ?', k));
        (items || []).forEach((v, i) => { st.push(db.q('INSERT INTO lists(key, position, value) VALUES (?, ?, ?)', k, i, String(v))); c.lists++; });
      }
      for (const [k, pairs] of Object.entries(data.zsets || {})) for (const [mem, sc] of pairs || []) { st.push(db.q('INSERT INTO sorted_sets(key, member, score) VALUES (?, ?, ?) ON CONFLICT(key, member) DO UPDATE SET score = excluded.score', k, String(mem), +sc)); c.zsets++; }
      // ponytail: 500-statement batches; a very large backup may hit the free plan's per-request D1 limit — use the Turso→D1 import in the README instead
      for (let i = 0; i < st.length; i += 500) await db.d.batch(st.slice(i, i + 500));
      CACHE.clear();
      await m.reply(`**Restore complete (merged).**\nSets: ${c.sets} | Hashes: ${c.hashes} | Strings: ${c.strings} | Lists: ${c.lists} | ZSets: ${c.zsets}\nRestart the bot if values look stale.`);
    } catch (e) { await m.reply(`Restore failed: \`${e.message}\``); }
  }, OWNER);

  // ==================== commands/library.py ====================
  on(/^\/search(?:\s+(.*))?$/s, async (m, g) => {
    const q = (g[1] || '').trim();
    if (!q) return m.reply('**Usage:** `/search <movie or file name>`');
    const qt = normalizeName(q).split(' ').filter(Boolean);
    const scored = [];
    if (qt.length) {
      for (const [norm, raw] of Object.entries(await db.hgetall(INDEX_KEY))) {
        let entries; try { entries = JSON.parse(raw); } catch { continue; }
        const et = new Set(norm.split(' ')), hits = qt.filter(t => et.has(t)).length;
        // entries the old bot indexed point at storage-channel messages (no share code) — skipped
        if (hits) for (const e of entries) if (e.s) scored.push([hits === qt.length, hits, e, norm]);
      }
      scored.sort((a, b) => (b[0] - a[0]) || (b[1] - a[1]));
    }
    const results = [];
    for (const [full, , e, norm] of scored) {
      if (!full && results.length) break;
      results.push({ ...e, norm });
      if (results.length >= 8) break;
    }
    if (!results.length) return m.reply(`No library hits for \`${q}\`.\nSend the TeraBox link to download it fresh.`);
    await db.set(`lib:search:${m.uid}`, JSON.stringify(results), { ex: 300 });
    const buttons = results.map((r, i) => [Button.inline(`📥 ${String(r.name).slice(0, 40)} (${r.size})`, `lib_${i}`)]);
    buttons.push([Button.inline('Close', 'lib_close')]);
    await m.reply(`**Library hits for \`${q}\`:**`, { buttons });
  });
  async function dropEntry(norm, r) {
    const raw = await db.hget(INDEX_KEY, norm);
    const kept = (raw ? JSON.parse(raw) : []).filter(e => !(e.s === r.s && e.f === r.f));
    if (kept.length) await db.hset(INDEX_KEY, norm, JSON.stringify(kept)); else await db.hdel(INDEX_KEY, norm);
  }
  onCb(/^lib_/, async e => {
    if (e.data === 'lib_close') return e.delete();
    const idx = parseInt(e.data.split('lib_')[1], 10);
    if (Number.isNaN(idx)) return e.answer('Invalid selection.', true);
    const raw = await db.get(`lib:search:${e.uid}`), results = raw ? JSON.parse(raw) : [];
    if (idx >= results.length) return e.answer('Expired — /search again.', true);
    const r = results[idx];
    const f = { file_name: r.name, size: r.size, sizebytes: r.bytes, fid: r.f, code: r.s };
    const ok = await sendStream(e.uid, true, f, cardCaption(f, e.from, await getCustomTag(e.uid), null), null, await db.hget(THUMB_KEY, String(e.uid)));
    if (!ok) { await dropEntry(r.norm, r); return e.answer('Removed stale entry — resend the link to fetch fresh.', true); }
    await db.hincrby(STATS_KEY, 'lib_hits', 1);
    await e.answer('Sent from library!');
  });
  on(/^\/reindex$/, async m => {
    if (m.uid !== OWNER_ID && !(await isAdmin(m.uid))) return;
    await m.reply('The library already indexes every link automatically — nothing to rescan.');
  });

  // ==================== commands/cancel.py / media.py (no jobs or ffmpeg on Workers) ====================
  on(/^\/cancel$/, m => m.reply(ERRORS.no_active_job));
  const mediaGate = usage => async m => {
    if ((await isMaintenance()) && !(await isAdmin(m.uid))) return m.reply('🔧 Bot is currently under maintenance. Please try again later.');
    if (!m.replyTo) return m.reply(usage);
    if (!(m.replyTo.video || m.replyTo.document || m.replyTo.audio || m.replyTo.photo)) return m.reply(usage.startsWith('Usage: reply') ? 'Replied message has no media.' : usage);
    await m.reply('ffmpeg not installed on server.');
  };
  on(/^\/mp3$/, mediaGate('Usage: reply to a video first, then send the command again.'));
  on(/^\/compress(?:\s+(\w+))?$/, mediaGate('Usage: Reply to a video with `/compress`\n\nExample:\n1. Send a video\n2. Reply to it with `/compress`\n3. Pick a resolution'));

  // ==================== commands/mystats.py ====================
  on(/^\/mystats$/, async m => {
    const h = await db.hgetall(`user_stats_${m.uid}`);
    const attempts = int(h.attempts), success = int(h.success) || int(h.total), failed = int(h.failed) || Math.max(attempts - success, 0);
    if (!attempts && !success) return m.reply('📊 Your Statistics\n\nNo completed downloads yet.\n\nStart by sending a TeraBox link.');
    await m.reply(`📊 Your Statistics\n\nFiles: ${success}\nData downloaded: ${fmtSize(int(h.storage))}\n\nSuccessful: ${success}\nFailed: ${failed}\nAudio conversions: ${int(h.audio)}\nVideo conversions: ${int(h.video)}\n\n` +
      `Premium: ${(await isPremium(m.uid)) ? 'Active' : 'Free'}\nMember since: ${(await db.get(`member_since:${m.uid}`)) || '?'}`);
  });

  // ==================== commands/referral.py ====================
  async function recordReferral(referrer, uid) {
    if (referrer === uid || (await db.get(`ref:by:${uid}`)) != null) return false;
    await db.set(`ref:by:${uid}`, referrer);
    await db.sadd(`ref:invited:${referrer}`, uid);
    await db.hincrby('ref:ok', String(referrer), 1);
    return true;
  }
  async function refStats(uid) {
    const invited = await db.scard(`ref:invited:${uid}`), ok = int(await db.hget('ref:ok', String(uid)));
    const next = TIERS.find(([t]) => ok < t);
    return [invited, ok, next?.[0] ?? null, next?.[1] ?? null];
  }
  async function checkAndGrantReward(uid) {
    const ok = int(await db.hget('ref:ok', String(uid))), last = int(await db.hget('ref:last_reward', String(uid)));
    for (const [t, days] of TIERS) if (ok >= t && t > last) { await grantPremium(int(uid), days); await db.hset('ref:last_reward', String(uid), t); return [true, days]; }
    return [false, 0];
  }
  const tierText = ok => TIERS.map(([t, days], i) => {
    const prev = i ? TIERS[i - 1][0] : 0;
    return `${ok >= t ? '✅' : '⬜'} \`${progressBar(Math.max(0, Math.min(ok, t) - prev), t - prev)}\` ${t} referrals → ${days}d Premium`;
  }).join('\n');
  const refLink = async uid => `https://t.me/${(await api.me()).username || 'YourBot'}?start=ref_AT-${int(uid)}`;

  on(/^\/(ref|refer|referral)$/, async m => {
    const link = await refLink(m.uid), [invited, ok, next, days] = await refStats(m.uid);
    let text = '┏━━━━━━━━━━━━━━━━━⍟\n┃  👥 𝗥𝗲𝗳𝗲𝗿𝗿𝗮𝗹 𝗦𝘆𝘀𝘁𝗲𝗺\n┗━━━━━━━━━━━━━━━━━━━━━⍟\n\n' +
      `📎 Your referral link:\n\`${link}\`\n\n👥 Invited: **${invited}**\n✅ Successful: **${ok}**\n\n${tierText(ok)}\n\n` +
      `${next ? `Next tier: **${next - ok} more** referral(s) → ${days}d Premium` : '🏆 **All tiers unlocked!**'}\n\n` +
      '💡 Share your link — when someone joins, you earn points!\n🎁 Hit a tier to unlock Premium rewards.';
    const [granted, gd] = await checkAndGrantReward(m.uid);
    if (granted) text += `\n\n🎉 **Congratulations!** You just earned **${gd} days Premium!**`;
    await m.reply(text, { buttons: [[Button.url('📤 Share Link', `https://t.me/share/url?url=${link}`)], [Button.inline('🏆 Claim Reward', 'ref_claim'), Button.inline('📊 Full Stats', 'ref_fullstats')], [Button.inline('◀️ Back', 'menu_main')]] });
  });
  onCb(/^ref_claim$/, async e => {
    const [granted, days] = await checkAndGrantReward(e.uid);
    if (granted) return e.answer(`🎉 **Reward Claimed!**\n\nYou received **${days} days Premium!**\n\nEnjoy your benefits!`, true);
    const [, ok, next, nd] = await refStats(e.uid);
    await e.answer(next ? `⏳ No reward to claim yet.\n\nYou need **${next - ok} more** referral(s) to reach the next tier (${nd}d Premium).` : "🏆 You've already claimed all available rewards!", true);
  });
  onCb(/^ref_fullstats$/, async e => {
    const [invited, ok] = await refStats(e.uid), last = int(await db.hget('ref:last_reward', String(e.uid)));
    const earned = TIERS.reduce((a, [t, d]) => (ok >= t ? d : a), 0);
    await e.edit('┏━━━━━━━━━━━━━━━━━⍟\n┃  📊 𝗥𝗲𝗳𝗲𝗿𝗿𝗮𝗹 𝗦𝘁𝗮𝘁𝘀\n┗━━━━━━━━━━━━━━━━━━━━━⍟\n\n' +
      `👥 Total invited: **${invited}**\n✅ Successful: **${ok}**\n🎁 Rewards earned: **${earned} days** Premium\n📌 Last tier claimed: **${last}** referrals\n\n${tierText(ok)}`,
      { buttons: back('menu_referral') });
  });
  onCb(/^menu_referral$/, async e => {
    const link = await refLink(e.uid), [invited, ok, next, days] = await refStats(e.uid);
    await e.edit('┏━━━━━━━━━━━━━━━━━⍟\n┃  👥 𝗥𝗲𝗳𝗲𝗿𝗿𝗮𝗹𝘀\n┗━━━━━━━━━━━━━━━━━━━━━⍟\n\n' +
      `\`${link}\`\n\n👥 Invited: **${invited}** | ✅ Successful: **${ok}**\n\n${tierText(ok)}\n\n${next ? `Next: **${next - ok} more** → ${days}d Premium` : '🏆 **All tiers unlocked!**'}`,
      { buttons: [[Button.url('📤 Share', `https://t.me/share/url?url=${link}`)], [Button.inline('🏆 Claim', 'ref_claim'), Button.inline('📊 Stats', 'ref_fullstats')], [Button.inline('◀️ Back', 'menu_main')]] });
  });
  onCb(/^renew_info$/, async e => { await e.answer('See plans below.'); await e.reply('⭐ Renew Premium\n\nUse /plan to check plans or contact an admin to renew.'); });

  // ==================== commands/ux.py ====================
  on(/^\/quick\s+(\S+)/, async (m, g) => {
    const files = await getFiles(g[1].trim());
    if (!files) return m.reply('Sorry! API is dead or link is broken.');
    if (files.length > 1) await m.reply(`Single-file mode: downloading 1 of ${files.length} files.`);
    await handleMessage(m);
  });
  on(/^\/preview\s+(\S+)/, async (m, g) => {
    const files = await getFiles(g[1].trim());
    if (!files) return m.reply('Sorry! API is dead or link is broken.');
    const lines = [`**Preview — ${files.length} file(s)**`, '', ...files.slice(0, 3).map((f, i) => `${i + 1}. \`${f.file_name}\` — **${f.size}**`)];
    if (files.length > 3) lines.push(`...and ${files.length - 3} more.`);
    lines.push('Send /quick <link> to download the first file.');
    await m.reply(lines.join('\n'));
  });
  on(/^\/broadcast(?:\s|$)/, async m => {
    if (m.uid !== OWNER_ID) return m.reply('Owner only.');
    const text = m.replyTo ? '' : m.text.split('/broadcast').slice(1).join('/broadcast').trim();
    if (!m.replyTo && !text) return m.reply('**Usage:** `/broadcast <message>`\nOr reply to any message with `/broadcast`.');
    const total = Math.max((await db.scard('all_known_users')) - ((await db.sismember('all_known_users', m.uid)) ? 1 : 0), 0);
    const mode = m.replyTo ? 'forward' : 'text';
    const status = await m.reply(`Broadcasting (${mode}) to ${total} users...`);
    await queueBroadcast({ kind: 'broadcast', mode, text, from_chat: m.chatId, msg_id: m.replyTo?.message_id ?? null, exclude: m.uid, total, status_chat: m.chatId, status_msg: status.id });
  });

  // ==================== commands/videos.py ====================
  let uploadTick = null; // set below when /videos is configured; run by the cron
  if (env.VIDEOS_POOL_WORKER && env.VIDEOS_PAYMENT_API) {
    const pay = env.VIDEOS_PAYMENT_API.replace(/\/$/, ''), pool = env.VIDEOS_POOL_WORKER.replace(/\/$/, '');
    const trialSeconds = int(env.VIDEOS_TRIAL_SECONDS || 180), cooldown = parseFloat(env.VIDEOS_COOLDOWN_SECONDS || 1), promo = env.VIDEOS_PROMO_URL || '';
    const getJ = async (url, body) => {
      try {
        const r = await fetch(url, { method: body ? 'POST' : 'GET', signal: AbortSignal.timeout(10000), ...(body ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {}) });
        return [200, 201].includes(r.status) ? await r.json() : null;
      } catch { return null; }
    };
    const vkey = uid => `video_state:${int(uid)}`;
    // all fields in one statement (was one D1 query per field)
    const setState = async (uid, fields) => {
      const e = Object.entries(fields);
      if (!e.length) return;
      await db.run(`INSERT INTO hashes(key, field, value) VALUES ${e.map(() => '(?, ?, ?)').join(', ')} ON CONFLICT(key, field) DO UPDATE SET value = excluded.value`,
        ...e.flatMap(([k, v]) => [vkey(uid), k, String(v)]));
    };
    const freeMode = () => cached('vfree', async () => { const s = await db.get(FREE_MODE_KEY); return s == null ? String(env.VIDEOS_FREE_MODE) === 'true' : s === '1'; }, 60);
    // A paid subscription's end time is remembered (sub_until), so the payment worker is only
    // asked again after it ends; a "not subscribed" answer is trusted for SUB_RECHECK seconds.
    const SUB_RECHECK = 120;
    const subUntil = st => {
      const t = Date.parse(st.subscription_end_at || '') / 1000;
      return t > 0 ? t : +st.seconds_remaining > 0 ? nowS() + +st.seconds_remaining : 0;
    };
    // Bot premium (referral, gift code, /pre…) and admins also unlock /videos.
    async function hasAccess(uid, ctx) {
      if (await freeMode()) return true;
      if (ctx.admin || ctx.premium) return true;
      const state = ctx.state, now = nowS();
      if (+state.sub_until > now) return true;
      if (!(+state.sub_checked > now - SUB_RECHECK)) {
        const st = await getJ(`${pay}/api/subscription/status/${int(uid)}`);
        if (st) { // API down → not cached, asked again next time
          const until = st.subscribed ? subUntil(st) : 0;
          await setState(uid, { sub_checked: now, ...(until > now ? { sub_until: until } : {}) });
          if (st.subscribed) return true;
        }
      }
      const el = nowS() - parseFloat(state.trial_start_time);
      return state.trial_start_time && el >= 0 && el <= trialSeconds;
    }
    // ---- per-user pool list (same as the old bot) ----
    // Each user gets 200 random links from the pool, served in order; when they run out, a new
    // 200 is fetched. Once a video has been sent, Telegram's file_id is kept (vid_meta: md5 → file_id) so any user who gets
    // that video again receives it instantly, without Telegram downloading the file again.
    const META = 'vid_meta';
    const md5Of = u => (String(u).match(/\/file\/([0-9a-f]{32})/) || [])[1] || null;
    const fidOf = v => { try { return JSON.parse(v).f || null; } catch { return v || null; } };
    // The user's next link from their own 200 (old bot behaviour): sent as-is, no checks.
    // When the 200 are used up, a new 200 is fetched.
    async function nextVideo(uid, state) {
      let links = state.video_links ? JSON.parse(state.video_links) : [], idx = int(state.video_index);
      if (!links.length || idx >= links.length) {
        links = (await getJ(`${pool}/?random=200`))?.links || [];
        if (!links.length) return null;
        idx = 0;
        await setState(uid, { video_links: JSON.stringify(links) });
      }
      await setState(uid, { video_index: idx + 1 });
      const url = links[idx], md5 = md5Of(url);
      const fid = md5 ? fidOf(await db.hget(META, md5)) : null;
      return { url, md5, fid };
    }
    // ---- pre-uploaded videos (instant /videos) ----
    // The cron uploads pool videos to VIDEOS_CHANNEL (the old storage channel) and keeps
    // their Telegram file_id: vid_ready = md5 → upload order, vid_meta = md5 → {u, f}. Each user
    // walks vid_ready from the start (vid_pos); once they've had them all, /videos falls back to
    // their own 200 links exactly as before.
    const READY = 'vid_ready';
    const readyMarkup = promo ? { reply_markup: { inline_keyboard: [[Button.url('Watch All Movies 🎬🍿', promo)]] } } : {};
    // Everything /videos needs in ONE D1 round trip (was ~6 sequential queries): the user's state,
    // premium/admin, and their next pre-uploaded video with its file_id.
    async function loadCtx(uid) {
      const k = vkey(uid), u = String(uid);
      const [st, pa, rd] = await db.d.batch([
        db.q('SELECT field, value FROM hashes WHERE key = ?', k),
        db.q('SELECT (SELECT value FROM hashes WHERE key = ? AND field = ?) exp, (SELECT 1 FROM sets WHERE key = ? AND member = ?) adm', PREMIUM_EXPIRY_KEY, u, DYNAMIC_ADMINS_KEY, u),
        db.q(`SELECT s.member, s.score, h.value FROM sorted_sets s JOIN hashes h ON h.key = ? AND h.field = s.member
              WHERE s.key = ? AND s.score > COALESCE((SELECT CAST(value AS REAL) FROM hashes WHERE key = ? AND field = 'vid_pos'), 0)
              ORDER BY s.score LIMIT 1`, META, READY, k),
      ]);
      const p = pa.results[0] || {}, r = rd.results[0], fid = r ? fidOf(r.value) : null;
      return {
        state: Object.fromEntries(st.results.map(x => [x.field, x.value])),
        admin: ADMINS.includes(int(uid)) || !!p.adm,
        premium: p.exp != null && nowS() < int(p.exp),
        ready: fid ? { md5: r.member, pos: r.score, fid } : null,
      };
    }
    // ponytail: 45 sends + 1 pool fetch stays under the free plan's 50 subrequests per cron run.
    // Telegram caps how fast a bot may post into one channel: a 429 drops that channel until the
    // next run. More channels in VIDEOS_CHANNEL (comma-separated) = more uploads per minute.
    // Daily cap keeps D1 under its free 100k rows written/day (2 rows per upload).
    const CHANNELS = String(env.VIDEOS_CHANNEL || '').split(',').map(x => x.trim()).filter(Boolean);
    const PER_RUN = 45, PER_DAY = int(env.VIDEOS_UPLOADS_PER_DAY || 25000);
    uploadTick = async () => {
      if (!CHANNELS.length) return;
      const dayKey = `vid_up:${new Date().toISOString().slice(0, 10)}`;
      const today = int(await db.get(dayKey));
      if (today >= PER_DAY) return;
      const links = (await getJ(`${pool}/?random=200`))?.links || [];
      const cand = [...new Map(links.map(u => [md5Of(u), u])).entries()].filter(([m]) => m);
      const have = new Set();
      for (let i = 0; i < cand.length; i += 90) { // D1: max 100 bound parameters per query
        const part = cand.slice(i, i + 90).map(([m]) => m);
        for (const r of await db.all(`SELECT field FROM hashes WHERE key = ? AND value LIKE '%"f":%' AND field IN (${part.map(() => '?').join(',')})`, META, ...part)) have.add(r.field);
      }
      const todo = cand.filter(([m]) => !have.has(m)).slice(0, Math.min(PER_RUN, PER_DAY - today));
      const live = [...CHANNELS], done = [];
      let k = 0;
      for (const [m, u] of todo) {
        if (!live.length) break;
        const ch = live[k++ % live.length];
        const r = await api.call('sendVideo', { chat_id: ch, video: u, supports_streaming: true, disable_notification: true });
        const fid = r.result?.video?.file_id;
        if (fid) done.push([m, u, fid]);
        else if (r.error_code === 429) live.splice(live.indexOf(ch), 1); // channel rate limit: stop it for this run
      }
      for (let i = 0; i < done.length; i += 30) { // multi-row writes, 90 parameters each
        const part = done.slice(i, i + 30), now = Date.now();
        await db.d.batch([
          db.q(`INSERT INTO hashes(key, field, value) VALUES ${part.map(() => `('${META}', ?, ?)`).join(', ')} ON CONFLICT(key, field) DO UPDATE SET value = excluded.value`,
            ...part.flatMap(([m, u, f]) => [m, JSON.stringify({ u, f })])),
          db.q(`INSERT INTO sorted_sets(key, member, score) VALUES ${part.map(() => `('${READY}', ?, ?)`).join(', ')} ON CONFLICT DO NOTHING`,
            ...part.flatMap(([m], j) => [m, now + i + j])),
        ]);
      }
      if (done.length) await db.set(dayKey, today + done.length, { ex: 2 * 86400 });
      console.log(`videos uploaded ${done.length}/${todo.length} (today ${today + done.length})${live.length < CHANNELS.length ? ' — channel rate limit hit' : ''}`);
    };

    on(/^\/videosready$/, async m => {
      const n = (await db.one('SELECT COUNT(*) n FROM sorted_sets WHERE key = ?', READY)).n;
      const today = int(await db.get(`vid_up:${new Date().toISOString().slice(0, 10)}`));
      await m.reply(`🎬 Instant videos ready: **${n}**\nUploaded today: ${today}/${PER_DAY}\nChannel(s): \`${CHANNELS.join(', ') || 'not set'}\` — up to ${PER_RUN} per minute.`);
    }, ADMIN);

    // save = state fields to write in the same statement as the new position (e.g. last_video_time)
    async function serveVideo(chatId, uid, target, ctx = null, save = {}) {
      ctx ||= await loadCtx(uid);
      const state = ctx.state;
      // 1) a pre-uploaded video (file_id) this user hasn't had yet → instant; state is saved after it's sent
      if (ctx.ready) {
        const r = await api.call('sendVideo', { chat_id: chatId, video: ctx.ready.fid, has_spoiler: true, protect_content: true, supports_streaming: true, ...readyMarkup });
        if (r.ok) return setState(uid, { ...save, vid_pos: ctx.ready.pos });
        await db.run('DELETE FROM sorted_sets WHERE key = ? AND member = ?', READY, ctx.ready.md5); // unusable file_id
        save = { ...save, vid_pos: ctx.ready.pos };
      }
      if (Object.keys(save).length) await setState(uid, save);
      // 2) otherwise the user's own 200 links, as before
      const [, c] = await Promise.all([
        api.call('sendChatAction', { chat_id: chatId, action: 'upload_video' }), // "sending video…" while Telegram fetches the link
        nextVideo(uid, state),
      ]);
      if (!c) return target.reply('❌ No videos found, try again in a moment.');
      const markup = promo ? { reply_markup: { inline_keyboard: [[Button.url('Watch All Movies 🎬🍿', promo)]] } } : {};
      const r = await api.call('sendVideo', { chat_id: chatId, video: c.fid || c.url, has_spoiler: true, protect_content: true, supports_streaming: true, ...markup });
      if (!r.ok) return target.reply('❌ Video error: server busy, please try again in a moment.');
      const fid = r.result?.video?.file_id;
      if (fid && !c.fid && c.md5) await db.hset(META, c.md5, JSON.stringify({ u: c.url, f: fid }));
    }

    on(/^\/videos$/, async m => {
      const ctx = await loadCtx(m.uid), state = ctx.state;
      if (state.last_video_time) {
        const pending = cooldown - (nowS() - parseFloat(state.last_video_time));
        if (pending > 0) return m.reply(`⏳ Please wait ${pending.toFixed(1)} seconds before requesting another video.`);
      }
      const [reg, access] = await Promise.all([
        // register with the payment worker once per user (was every /videos)
        state.registered === '1' || getJ(`${pay}/api/telegram/register`, { telegram_id: m.uid, name: m.from.username || 'User' }),
        hasAccess(m.uid, ctx),
      ]);
      const save = { last_video_time: nowS(), ...(reg ? { registered: 1 } : {}) };
      if (access) return serveVideo(m.chatId, m.uid, m, ctx, save);
      await setState(m.uid, save);
      if (!state.trial_start_time || int(parseFloat(state.trial_start_time)) === 0)
        return m.reply('🎁 <b>FREE TRIAL — Special Offer for New Users!</b>\n\nClick the button below to claim your <b>3-minute free trial</b> and start watching videos right now:', { html: true, buttons: [[Button.inline('🎁 Get Free 3-Min Trial', 'vid_trial')]] });
      await m.reply('⏰ <b>Your 3-minute free trial has expired!</b>\nPlease choose a plan below to continue watching.', { html: true });
      await showPlans(m.chatId);
    });

    async function showPlans(chatId) {
      const res = await getJ(`${pay}/api/plans`);
      if (!res) return api.send(chatId, '⚠️ Error loading plans. Please try again later.');
      const plans = (res.plans || []).filter(p => p.status === 'active');
      if (!plans.length) return api.send(chatId, '⚠️ No plans available right now. Contact admin.');
      const buttons = plans.map(p => [Button.inline(`${p.name} - ₹${p.price} (${p.validity_days} days)`, `vid_plan_${p.id}`)]);
      const caption = '🗂️ Select a Plan Category for Unlimited Videos\n\n⚡ All plans are fastest and having smooth experience for premium videos ⚡ \n\n📋 <b>Available Plans:</b>\nChoose a plan below to subscribe: 👇';
      const r = await api.call('sendPhoto', { chat_id: chatId, photo: PLANS_PHOTO, caption, parse_mode: 'HTML', reply_markup: { inline_keyboard: buttons } });
      if (!r.ok) await api.send(chatId, caption, { html: true, buttons });
    }
    onCb(/^vid_trial$/, async e => {
      await setState(e.uid, { trial_start_time: nowS() });
      await e.answer('Trial activated!');
      await e.reply('🎉 <b>Your 3-minute free trial is now ACTIVE!</b>', { html: true });
      await serveVideo(e.chatId, e.uid, e);
    });
    // /purchase<N> from the old bot: create an order on the payment worker, show Pay + Verify.
    onCb(/^vid_plan_(\d+)$/, async e => {
      await e.answer();
      const chatId = e.chatId, uid = e.uid, planId = int(e.data.slice(9));
      const busyMsg = await api.send(chatId, '⏳ Creating payment request...');
      const done = async text => { await busyMsg?.delete(); return text ? api.send(chatId, text, { html: true }) : null; };

      const status = await getJ(`${pay}/api/subscription/status/${uid}`);
      if (!status) return done('❌ Error fetching user data. Please try again.');
      if (status.subscribed) {
        const until = subUntil(status);
        if (until > nowS()) await setState(uid, { sub_until: until, sub_checked: nowS() });
        return done('✅ You already have an active subscription!');
      }
      let token = status.user_token;
      if (!token) token = (await getJ(`${pay}/api/telegram/register`, { telegram_id: uid, name: e.from.username || 'User' }))?.user_token;
      if (!token) return done('❌ Error fetching user data. Please try again.');

      const plan = ((await getJ(`${pay}/api/plans`))?.plans || []).find(p => int(p.id) === planId);
      if (!plan) return done('❌ Plan not found. Please try again.');

      let order;
      try {
        const r = await fetch(`${pay}/api/create-order`, {
          method: 'POST', headers: { 'content-type': 'application/json' }, signal: AbortSignal.timeout(15000),
          body: JSON.stringify({
            customer_mobile: '9999999999', user_token: token, amount: int(plan.price),
            order_id: `ORD${Math.floor(nowS())}${String(token).slice(-4)}`, plan_id: int(plan.id),
            redirect_url: 'https://t.me/at_botz', remark1: `plan_${plan.id}`, remark2: 'telegram_bot',
          }),
        });
        if (![200, 201].includes(r.status)) { await logx(`create-order ${uid} HTTP ${r.status}`); return done(`❌ Payment server error (${r.status}). Please try again.`); }
        order = await r.json();
      } catch (err) {
        await logx(`create-order ${uid} failed: ${err.message}`);
        return done('❌ Could not create the payment. Please try again.');
      }
      if (!order?.status || !order.result?.payment_url) return done(`❌ Failed to create order: ${escHtml(order?.message || 'Unknown error')}`);

      await db.set(`vid_order:${uid}`, JSON.stringify({ order_id: order.result.orderId, plan: plan.name, amount: plan.price, days: plan.validity_days, byte_txn: order.result.byteTransactionId }), { ex: 86400 });
      await done();
      await api.send(chatId,
        `💳 <b>Pay for ${escHtml(plan.name)}</b>\n\n<b>Amount:</b> ₹${plan.price}\n<b>Validity:</b> ${plan.validity_days} days\n\n` +
        "<b>📱 How to Pay:</b>\n1️⃣ Scan QR or click Pay button\n2️⃣ Complete payment in UPI app\n3️⃣ Click 'I've Paid' below\n\n⏰ Payment link expires in 5 minutes",
        { html: true, buttons: [[Button.url(`💳 Pay ₹${plan.price}`, order.result.payment_url)], [Button.inline("✅ I've Paid - Verify", 'vid_verify')]] });
    });

    // /verifynew from the old bot: ask the payment worker whether the order was paid.
    onCb(/^vid_verify$/, async e => {
      await e.answer();
      const chatId = e.chatId, raw = await db.get(`vid_order:${e.uid}`);
      if (!raw) return api.send(chatId, '❌ No payment found. Please start again with /videos');
      const o = JSON.parse(raw);
      const checking = await api.send(chatId, '🔍 Checking payment status...');
      let res = null;
      try {
        const r = await fetch(`${pay}/api/payment-status`, {
          method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, signal: AbortSignal.timeout(15000),
          body: new URLSearchParams({ order_id: o.order_id }),
        });
        res = r.status === 200 ? (await r.text()).trim() : null;
      } catch (err) { await logx(`payment-status ${e.uid} failed: ${err.message}`); }
      await checking?.delete();
      if (res == null) return api.send(chatId, '❌ Error checking payment status.\n\nPlease try again later or contact support.');
      if (res === 'success') {
        await db.delete(`vid_order:${e.uid}`);
        await setState(e.uid, { sub_checked: 0 });
        await logx(`payment ok ${e.uid} order=${o.order_id} plan=${o.plan} amount=${o.amount}`);
        for (const a of await getAllAdmins())
          await api.send(a, `💰 Payment received\nUser: ${escHtml(e.from.first_name || '-')} (@${escHtml(e.from.username || '-')})\nID: <code>${e.uid}</code>\nPlan: ${escHtml(o.plan)} — ₹${o.amount}\nOrder: <code>${o.order_id}</code>`, { html: true });
        return api.send(chatId,
          `🎉 <b>Payment Verified!</b>\n\n✅ Your payment of ₹${o.amount} has been confirmed.\n📋 Plan: ${escHtml(o.plan)}\n🆔 Order ID: <code>${o.order_id}</code>\n\nThank you! Your subscription has been activated.\nSend /videos to start watching 🎬`,
          { html: true });
      }
      if (res === 'FAILURE') return api.send(chatId, '❌ <b>Payment Failed</b>\n\nYour payment was not successful. Please try again.', { html: true });
      await api.send(chatId,
        `⏳ <b>Payment Pending</b>\n\nYour payment has not been confirmed yet.\nPlease complete the payment and click verify again.\n\nOrder ID: <code>${o.order_id}</code>`,
        { html: true, buttons: [[Button.inline("✅ I've Paid - Verify", 'vid_verify')]] });
    });

    on(/^\/videosfreemode(?:\s+(on|off))?$/, async (m, g) => {
      if (!(await isAdmin(m.uid))) return m.reply('Not authorized.');
      const arg = (g[1] || '').toLowerCase();
      if (!arg) return m.reply(`/videos free mode is **${(await freeMode()) ? 'ON' : 'OFF'}**`);
      await db.set(FREE_MODE_KEY, arg === 'on' ? '1' : '0'); uncache('vfree');
      await m.reply(`/videos free mode set to **${arg.toUpperCase()}**`);
    });
  }

  // ---------------- dispatch ---------------- //

  async function onMessage(msg) {
    const m = wrapMsg(msg);
    if (msg.new_chat_members) { // events.ChatAction user_joined
      for (const u of msg.new_chat_members) {
        if (u.is_bot) continue;
        for (const a of await getAllAdmins()) await api.send(a, `User joined the bot:\nName: ${u.first_name}\nUsername: @${u.username || '-'}\nUser ID: ${u.id}`);
      }
      return;
    }
    if (!m.text || !m.uid) return;
    // "/cmd@ThisBot args" → "/cmd args" (group commands)
    const text = m.text.replace(/^(\/\w+)@\w+/, '$1');
    m.text = text;
    for (const [re, fn, guard] of CMDS) {
      const g = text.match(re);
      if (!g) continue;
      if (guard === OWNER && m.uid !== OWNER_ID) continue;
      if (guard === ADMIN && !(await isAdmin(m.uid))) continue;
      await fn(m, g);
    }
    if (m.isPrivate && !text.startsWith('/') && getUrl(text)) await handleMessage(m);
  }

  async function onCallback(q) {
    const e = wrapCb(q);
    for (const [re, fn] of CBS) if (re.test(e.data)) await fn(e);
    if (!e.answered) await e.answer();
  }

  // ---------------- cron: broadcasts, premium reminders ---------------- //

  async function broadcastTick() {
    const BATCH = 40; // free plan: 50 subrequests per invocation
    const b = await db.one('SELECT * FROM broadcasts WHERE done = 0 AND send_at <= ? ORDER BY id LIMIT 1', Math.floor(nowS()));
    if (!b) return false; // false = nothing sent this minute
    const users = await db.all("SELECT member FROM sets WHERE key = 'all_known_users' AND member > ? ORDER BY member LIMIT ?", b.cursor, BATCH);
    let sent = 0, failed = 0;
    for (const { member } of users) {
      if (b.exclude && member === String(b.exclude)) continue;
      const r = b.mode === 'forward'
        ? await api.call('forwardMessage', { chat_id: member, from_chat_id: b.from_chat, message_id: b.msg_id })
        : await api.call('sendMessage', { chat_id: member, text: md(b.text), parse_mode: 'HTML' });
      r.ok ? sent++ : failed++;
    }
    const done = users.length < BATCH;
    await db.run('UPDATE broadcasts SET cursor = ?, sent = sent + ?, failed = failed + ?, done = ? WHERE id = ?', users.at(-1)?.member ?? b.cursor, sent, failed, done ? 1 : 0, b.id);
    if (!done) return true;
    const S = b.sent + sent, F = b.failed + failed;
    if (b.kind === 'broadcast') {
      await db.incr('stats:broadcasts');
      await api.edit(b.status_chat, b.status_msg, `**Broadcast Complete**\nTotal: **${b.total}**\nSent: **${S}**\nFailed: **${F}**${F ? '\nFailed = blocked/deleted accounts.' : ''}`);
    } else if (b.kind === 'legacy') {
      await api.edit(b.status_chat, b.status_msg, `**Broadcast Complete**\n\nTotal users: **${b.total}**\nSent: **${S}**\nFailed: **${F}**`);
    } else await api.send(b.status_chat, `**Announcement sent!**\nSent: ${S}\nFailed: ${F}`, { replyTo: b.status_msg });
    return true;
  }

  // referral.py referral_sweep_once — 3d / 1d / expired reminders
  async function reminderSweep() {
    const exp = await db.hgetall(PREMIUM_EXPIRY_KEY);
    const flags = new Set((await db.all("SELECT key FROM kv WHERE key LIKE 'reminder_%' AND (expires_at IS NULL OR expires_at > ?)", nowS())).map(r => r.key));
    const now = Math.floor(nowS()), btn = [[Button.inline('Renew Premium', 'renew_info')]];
    let budget = 15; // keeps each cron run inside the free-plan subrequest limit
    for (const [uid, e] of Object.entries(exp)) {
      if (budget <= 0) break;
      const rem = int(e) - now;
      if (rem <= 0) {
        if (flags.has(`reminder_expired:${uid}`)) continue;
        budget--;
        await db.set(`reminder_expired:${uid}`, '1');
        await api.send(int(uid), "⭐ Premium Reminder\n\nYour Premium access has expired.\n\nDon't lose your Premium benefits.", { buttons: btn });
        continue;
      }
      for (const [win, flag, label] of [[86400, 'reminder_1d', '1 day'], [3 * 86400, 'reminder_3d', '3 days']]) {
        if (rem > win) continue;
        if (!flags.has(`${flag}:${uid}`)) {
          budget--;
          await db.set(`${flag}:${uid}`, '1', { ex: win + 86400 });
          await api.send(int(uid), `⭐ Premium Reminder\n\nYour Premium access expires in ${label}.\n\nDon't lose your Premium benefits.`, { buttons: btn });
        }
        break;
      }
    }
  }

  async function cron(minute) {
    const broadcasting = await broadcastTick();
    // uploads share the free plan's 50-subrequest budget: skip minutes with a broadcast batch or reminders
    if (uploadTick && !broadcasting && minute !== 0) {
      try { await uploadTick(); } catch (e) { console.log('uploadTick', e.message); }
    }
    if (minute === 0) {
      await reminderSweep();
      await db.run('DELETE FROM kv WHERE expires_at IS NOT NULL AND expires_at < ?', nowS());
    }
  }

  return { onMessage, onCallback, cron, bootCard };
}
