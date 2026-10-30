// TeraBox bot on one free Cloudflare Worker: Telegram webhook + HLS player + cron.
// Bindings: DB (D1), SENDER. Secrets: BOT_TOKEN, WEBHOOK_SECRET, JSTOKEN, TB_COOKIE, PANEL_PASSWORD. Vars: wrangler.toml.

import { DB } from './db.js';
import { makeApi } from './tg.js';
import { createBot, sign, teraboxCfg, resolveCached, streamUrl } from './bot.js';
import { panelApi, botToken, setupWebhook } from './panel.js';
import { REELS_HTML } from './reels.js';
import { playerHtml } from './player.js';

function params(url) {
  const g = k => url.searchParams.get(k) || '';
  const p = { s: g('s'), f: g('f'), q: g('q') || 'M3U8_AUTO_480', t: g('t') };
  return /^[\w-]+$/.test(p.s) && /^\d+$/.test(p.f) && /^M3U8_AUTO_\d+$/.test(p.q) && /^[\w-]+$/.test(p.t) ? p : null;
}

async function m3u8(env, db, url) {
  const p = params(url);
  if (!p || p.t !== (await sign(env.WEBHOOK_SECRET, `${p.s}:${p.f}:${p.q}`))) return new Response('Bad link', { status: 403 });
  let cfg = await teraboxCfg(env, db);
  // p=N: our own proxy N of HLS_PROXIES (other accounts; the /str feed spreads its videos over them).
  // A copy: the cached config stays on the main proxy for everything else
  const own = String(env.HLS_PROXIES || '').split(',')[Number(url.searchParams.get('p')) - 1];
  if (own) cfg = { ...cfg, proxy: own.trim().replace(/\/$/, '') };
  // Serve the playlist from this origin: the HLS proxy sends no CORS header, so a
  // redirect to it is blocked by the browser. Segment URLs stay as the proxy wrote them.
  const playlist = async d => {
    const src = streamUrl(cfg, d, p.f, p.q);
    try {
      const r = await fetch(src, { signal: AbortSignal.timeout(20000) });
      const body = await r.text();
      return r.ok && body.startsWith('#EXTM3U') ? body.replace(/^(?!#)(\S.*)$/gm, u => new URL(u, src).href) : null;
    } catch {
      return null;
    }
  };
  let d = await resolveCached(env, db, p.s);
  let abs = d && (await playlist(d));
  if (!abs && d?.cached) { // cached sign/timestamp no longer accepted: resolve fresh once
    d = await resolveCached(env, db, p.s, true);
    abs = d && (await playlist(d));
  }
  if (!d) return new Response('Link expired or TeraBox unavailable', { status: 502 });
  if (!abs) return new Response('HLS proxy error', { status: 502 });
  return new Response(abs, { headers: { 'content-type': 'application/vnd.apple.mpegurl', 'cache-control': 'no-store' } });
}

// the bot's @username for the player's buttons (one getMe per isolate)
// ponytail: not refreshed if the panel switches to another bot token until the isolate restarts
let botUser = null;
async function botUsername(env) {
  if (!botUser) botUser = (await makeApi(env.BOT_TOKEN, env.TG_API).call('getMe', {})).result?.username || null;
  return botUser;
}

async function watch(env, url) {
  const p = params(url);
  if (!p) return new Response('Bad link', { status: 400 });
  const src = `/m3u8?s=${p.s}&f=${p.f}&q=${p.q}&t=${p.t}`;
  // "open the bot" = this same video in the bot, crediting whoever shared the link (r)
  const bot = await botUsername(env), r = /^\d{1,15}$/.test(url.searchParams.get('r') || '') ? url.searchParams.get('r') : '0';
  let start = `v_${p.s}_${p.f}_${r}`;
  if (start.length > 64) start = `v_${p.s}_${p.f}_0`;
  const open = bot && start.length <= 64 ? `https://t.me/${bot}?start=${start}` : null;
  // n = the file name, shown as the title (display only, not signed)
  return new Response(playerHtml({ src, key: `${p.s}:${p.f}`, open, bot, name: (url.searchParams.get('n') || '').slice(0, 120) }), { headers: { 'content-type': 'text/html;charset=utf-8', 'cache-control': 'no-store' } });
}

// ---------------- Videos Mini App (/reels, /app) ----------------
// The page (src/reels.js, a Reels-style swipe feed), its feed API, and the video stream. Login = Telegram's signed initData
// (checked with the bot token), so the user id can't be faked. Videos are the ones Telegram already
// has (videos.file_id ≤20 MB): streamed through here so the bot token never reaches the browser.
async function appPage(env) {
  return new Response(REELS_HTML.replace('__BOT__', (await botUsername(env)) || ''), { headers: { 'content-type': 'text/html;charset=utf-8', 'cache-control': 'no-store' } });
}

const hex = buf => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
const hmac = async (key, data) => crypto.subtle.sign('HMAC', await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']), new TextEncoder().encode(data));
// Telegram Web App initData → the user id, or null if the signature or its age (24h) is wrong
async function webAppUser(initData, token) {
  const p = new URLSearchParams(String(initData || ''));
  const hash = p.get('hash');
  if (!hash || !token) return null;
  p.delete('hash');
  const check = [...p].sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, v]) => `${k}=${v}`).join('\n');
  const secret = await hmac(new TextEncoder().encode('WebAppData'), token);
  if (hex(await hmac(secret, check)) !== hash) return null;
  if (Date.now() / 1000 - Number(p.get('auth_date')) > 86400) return null;
  try { return Number(JSON.parse(p.get('user')).id) || null; } catch { return null; }
}

// file_id → Telegram file path (valid ≥1h), cached per isolate
const filePaths = new Map();
async function appVideo(env, db, req, url) {
  const id = url.pathname.slice(7), e = Number(url.searchParams.get('e')), t = url.searchParams.get('t') || '', p = url.searchParams.get('p');
  // p = the Telegram file path, signed by the feed (no D1 / getFile here); links without it look the path up
  if (!/^[0-9a-f]{32}$/.test(id) || !(e > Date.now() / 1000) || t !== (await sign(env.WEBHOOK_SECRET, p ? `app:${id}:${e}:${p}` : `app:${id}:${e}`))) return new Response('Bad link', { status: 403 });
  let fp = p ? [p, Date.now() + 60000] : filePaths.get(id);
  if (!fp || fp[1] < Date.now()) {
    const fid = (await db.one('SELECT file_id FROM videos WHERE md5 = ?', id))?.file_id;
    if (!fid) return new Response('Not found', { status: 404 });
    const g = await makeApi(env.BOT_TOKEN, env.TG_API).call('getFile', { file_id: fid });
    if (!g.ok) return new Response('Not available', { status: 404 });
    if (filePaths.size > 2000) filePaths.clear(); // ponytail: crude bound
    filePaths.set(id, fp = [g.result.file_path, Date.now() + 50 * 60 * 1000]);
  }
  const range = req.headers.get('range');
  const r = await fetch(`${env.TG_API || 'https://api.telegram.org'}/file/bot${env.BOT_TOKEN}/${fp[0]}`, { headers: range ? { Range: range } : {} });
  if (!r.ok) { filePaths.delete(id); return new Response('Not available', { status: 502 }); }
  const h = new Headers({ 'content-type': 'video/mp4', 'accept-ranges': 'bytes', 'cache-control': 'private, max-age=3600' });
  for (const k of ['content-length', 'content-range']) if (r.headers.get(k)) h.set(k, r.headers.get(k));
  return new Response(r.body, { status: r.status, headers: h });
}

// Every update: make sure the sender has a users row (= the broadcast list) and mark them active in
// this IST hour (panel graph). A per-isolate memo skips D1 for someone already seen this hour, so most
// messages cost no query at all; message counts go to the in-memory counters (db.bump).
const seen = new Set();
// returns true only when this is the user's very first update (their row was just created)
async function trackActivity(db, uid) {
  if (!uid) return false;
  const ist = new Date(Date.now() + 5.5 * 3600e3).toISOString();
  const day = ist.slice(0, 10), hh = ist.slice(11, 13), hour = +ist.replace(/\D/g, '').slice(0, 10);
  db.bump(`msgs:${hh}`, 1, day);
  const k = `${hour}:${uid}`;
  if (seen.has(k)) return false;
  try {
    const [u, a] = await db.batch([
      db.q('INSERT INTO users (id, joined) VALUES (?, ?) ON CONFLICT (id) DO NOTHING', uid, day),
      db.q('INSERT INTO activity (hour, uid) VALUES (?, ?) ON CONFLICT DO NOTHING', hour, uid),
    ]);
    if (u.meta.changes) { db.bump('total_users'); db.bump('new_users', 1, day); }
    if (a.meta.changes) db.bump(`act:${hh}`, 1, day);
    if (seen.size > 5000) seen.clear();
    seen.add(k);
    return u.meta.changes > 0;
  } catch (e) { console.log('trackActivity', e.message); return false; }
}

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    const db = new DB(env.DB);
    // a bot token set from the panel overrides the BOT_TOKEN secret
    env = { ...env, BOT_TOKEN: await botToken(env, db) };
    if (url.pathname === '/webhook' && req.method === 'POST') {
      if (req.headers.get('x-telegram-bot-api-secret-token') !== env.WEBHOOK_SECRET) return new Response('forbidden', { status: 403 });
      const u = await req.json();
      const bot = createBot(env, makeApi(env.BOT_TOKEN, env.TG_API), db, url.origin);
      // ack Telegram immediately so it never retries; finish the work in the background.
      // The user row exists before the handler runs (referrals, /start rely on it).
      ctx.waitUntil((async () => {
        const isNew = await trackActivity(db, (u.message || u.callback_query)?.from?.id);
        if (isNew && u.message) u.message._newUser = true; // /start tells the admins only about these
        const work = u.message ? bot.onMessage(u.message) : u.callback_query ? bot.onCallback(u.callback_query) : u.my_chat_member ? bot.onChatMember(u.my_chat_member) : null;
        if (work) await work.catch(e => console.log('update failed', e.stack));
        await db.flush();
      })());
      return new Response('ok');
    }
    if (url.pathname === '/watch') return watch(env, url);
    if (url.pathname === '/reels' || url.pathname === '/app') return appPage(env); // /app: buttons sent before the rename
    // 🧪 /str: the stream test (admins) — the Reels page on its own feed, the /m3u8 stream
    if (url.pathname === '/str') return appPage(env);
    if (url.pathname === '/str/api/feed' && req.method === 'POST') {
      const body = await req.json().catch(() => ({}));
      const uid = await webAppUser(body.initData, env.BOT_TOKEN);
      if (!uid) return Response.json({ ok: false, error: 'login' }, { status: 401 });
      return Response.json(await createBot(env, makeApi(env.BOT_TOKEN, env.TG_API), db, url.origin).strFeed(uid, body.after));
    }
    if (url.pathname === '/str/api/bad' && req.method === 'POST') {
      const body = await req.json().catch(() => ({}));
      const uid = await webAppUser(body.initData, env.BOT_TOKEN);
      if (!uid) return Response.json({ ok: false }, { status: 401 });
      return Response.json(await createBot(env, makeApi(env.BOT_TOKEN, env.TG_API), db, url.origin).strBad(uid, body.id));
    }
    if (url.pathname.startsWith('/app/v/')) return appVideo(env, db, req, url);
    if (url.pathname === '/app/api/bad' && req.method === 'POST') {
      // a video that played black / failed in someone's app: not handed out again
      // ponytail: any logged-in app user can report; add a per-user cap if it gets abused
      const body = await req.json().catch(() => ({}));
      const uid = await webAppUser(body.initData, env.BOT_TOKEN);
      if (!uid || !/^[0-9a-f]{32}$/.test(body.id || '')) return Response.json({ ok: false }, { status: 400 });
      await db.run('INSERT INTO store (key, value) VALUES (?, ?) ON CONFLICT (key) DO NOTHING', `app_bad:${body.id}`, String(uid));
      return Response.json({ ok: true });
    }
    if (url.pathname === '/app/api/live' && req.method === 'POST') {
      const body = await req.json().catch(() => ({}));
      const uid = await webAppUser(body.initData, env.BOT_TOKEN);
      if (!uid) return Response.json({ ok: false }, { status: 401 });
      let user = {}; try { user = JSON.parse(new URLSearchParams(body.initData).get('user')) || {}; } catch {}
      const res = await createBot(env, makeApi(env.BOT_TOKEN, env.TG_API), db, url.origin).appLive(uid, user, body);
      ctx.waitUntil(db.flush()); // the loading counters (written at most every 2 min)
      return Response.json(res);
    }
    if (url.pathname === '/app/api/send' && req.method === 'POST') {
      const body = await req.json().catch(() => ({}));
      const uid = await webAppUser(body.initData, env.BOT_TOKEN);
      if (!uid || !/^[0-9a-f]{32}$/.test(body.id || '') || body.d !== (await sign(env.WEBHOOK_SECRET, `dl:${uid}:${body.id}`))) return Response.json({ ok: false }, { status: 400 });
      const bot = createBot(env, makeApi(env.BOT_TOKEN, env.TG_API), db, url.origin);
      if (!(await bot.appAllowed(uid))) return Response.json({ ok: false });
      const { after, ...res } = await bot.appSend(uid, body.id);
      ctx.waitUntil(Promise.resolve(after).then(() => db.flush()));
      return Response.json(res);
    }
    if (url.pathname === '/app/api/feed' && req.method === 'POST') {
      const body = await req.json().catch(() => ({}));
      const uid = await webAppUser(body.initData, env.BOT_TOKEN);
      if (!uid) return Response.json({ ok: false, error: 'login' }, { status: 401 });
      const bot = createBot(env, makeApi(env.BOT_TOKEN, env.TG_API), db, url.origin);
      if (!(await bot.appAllowed(uid))) return Response.json({ ok: false, error: 'soon' });
      // admins (REELS_HLS 1): the /str streams instead — the speed test; no likes / profile (other ids)
      if (await bot.reelsHls(uid)) return Response.json({ ...(await bot.strFeed(uid, body.after)), hls: true });
      const res = await bot.appFeed(uid);
      if (res.ok) res.profile = !!(await bot.likes()?.profileOn(uid)); // likes on the server + the profile grid
      // the first-time tour: admins only again (2026-10-31) — it held the feed until the user tapped,
      // and on the day it went to everyone fewer users reached the paywall
      if (res.profile) res.tour = await bot.isAdmin(uid);
      ctx.waitUntil(db.flush());
      return Response.json(res);
    }
    // likes + the profile grid (bot.likes(): its own D1 database)
    if (['/app/api/like', '/app/api/thumb', '/app/api/liked', '/app/api/paths'].includes(url.pathname) && req.method === 'POST') {
      const body = await req.json().catch(() => ({}));
      const uid = await webAppUser(body.initData, env.BOT_TOKEN);
      if (!uid) return Response.json({ ok: false }, { status: 401 });
      const L = createBot(env, makeApi(env.BOT_TOKEN, env.TG_API), db, url.origin).likes();
      if (!L) return Response.json({ ok: false });
      const res = await L[url.pathname.slice(9)](uid, body);
      ctx.waitUntil(db.flush());
      return Response.json(res);
    }
    if (url.pathname.startsWith('/app/thumb/')) {
      const vid = decodeURIComponent(url.pathname.slice(11));
      if (url.searchParams.get('t') !== (await sign(env.WEBHOOK_SECRET, `thumb:${vid}`))) return new Response('Bad link', { status: 403 });
      const jpg = await createBot(env, makeApi(env.BOT_TOKEN, env.TG_API), db, url.origin).likes()?.thumbJpg(vid);
      // first one wins and is never replaced: cached for good
      return jpg ? new Response(jpg, { headers: { 'content-type': 'image/jpeg', 'cache-control': 'private, max-age=31536000, immutable' } }) : new Response('Not found', { status: 404 });
    }
    if (url.pathname === '/m3u8') return m3u8(env, db, url);
    if (url.pathname.startsWith('/panel-api/')) return panelApi(req, env, db, url.pathname.slice(11));
    if (url.pathname === '/setup' && url.searchParams.get('key') === env.WEBHOOK_SECRET)
      return Response.json(await setupWebhook(env, env.BOT_TOKEN, url.origin, db));
    return new Response('Not found', { status: 404 });
  },
  async scheduled(event, env) {
    const db = new DB(env.DB);
    env = { ...env, BOT_TOKEN: await botToken(env, db) };
    const bot = createBot(env, makeApi(env.BOT_TOKEN, env.TG_API), db, '');
    const t = new Date(event.scheduledTime);
    await bot.cron(t.getUTCMinutes(), t.getUTCHours());
  },
};
