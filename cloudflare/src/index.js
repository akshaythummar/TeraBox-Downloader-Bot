// TeraBox bot on one free Cloudflare Worker: Telegram webhook + HLS player + cron.
// Bindings: DB (D1), SENDER. Secrets: BOT_TOKEN, WEBHOOK_SECRET, JSTOKEN, TB_COOKIE, PANEL_PASSWORD. Vars: wrangler.toml.

import { DB } from './db.js';
import { makeApi } from './tg.js';
import { createBot, sign, teraboxCfg, resolveCached, streamUrl } from './bot.js';
import { panelApi, botToken, setupWebhook } from './panel.js';

function params(url) {
  const g = k => url.searchParams.get(k) || '';
  const p = { s: g('s'), f: g('f'), q: g('q') || 'M3U8_AUTO_480', t: g('t') };
  return /^[\w-]+$/.test(p.s) && /^\d+$/.test(p.f) && /^M3U8_AUTO_\d+$/.test(p.q) && /^[\w-]+$/.test(p.t) ? p : null;
}

async function m3u8(env, db, url) {
  const p = params(url);
  if (!p || p.t !== (await sign(env.WEBHOOK_SECRET, `${p.s}:${p.f}:${p.q}`))) return new Response('Bad link', { status: 403 });
  const cfg = await teraboxCfg(env, db);
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
  return new Response(
    `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>TeraBox Player</title>
<script src="https://telegram.org/js/telegram-web-app.js"></script>
<script src="https://cdn.jsdelivr.net/npm/hls.js@1.5.13/dist/hls.min.js"></script>
<style>
html,body{margin:0;height:100%;background:#000;color:#eee;font:14px system-ui,sans-serif;overflow:hidden}
video{width:100%;height:100%;object-fit:contain;background:#000}
.pill{padding:8px 14px;border:0;border-radius:20px;background:#000a;color:#fff;font:600 14px system-ui;cursor:pointer;backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px)}
#unmute{position:fixed;top:max(12px,env(safe-area-inset-top));left:12px}
.bar{position:fixed;top:max(12px,env(safe-area-inset-top));right:12px;display:flex;gap:8px;transition:opacity .3s}
body.idle .bar,body.idle #unmute{opacity:0;pointer-events:none}
.cta{position:fixed;left:50%;bottom:calc(64px + env(safe-area-inset-bottom));transform:translateX(-50%);width:min(92vw,360px);padding:14px;border-radius:18px;background:#141821ee;box-shadow:0 10px 30px #000a;text-align:center;font:600 15px system-ui;backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px)}
.cta div{display:flex;gap:8px;margin-top:10px}
.cta button{flex:1;padding:11px 8px;border:0;border-radius:12px;font:700 14px system-ui;cursor:pointer;color:#fff;background:#2a2f3c}
.cta button.go{background:linear-gradient(135deg,#8a6bff,#22c3ee)}
.flash{position:fixed;top:50%;transform:translateY(-50%);padding:10px 16px;border-radius:24px;background:#000a;color:#fff;font:600 16px system-ui;pointer-events:none;opacity:0;transition:opacity .2s;white-space:nowrap}
#err{position:fixed;inset:0;display:none;flex-direction:column;align-items:center;justify-content:center;gap:14px;background:#000d;text-align:center;padding:24px}
#err button{padding:10px 22px;border:0;border-radius:20px;background:#fff;color:#000;font:600 14px system-ui;cursor:pointer}
[hidden]{display:none!important}
</style>
</head><body>
<video id="v" controls autoplay muted playsinline preload="auto"></video>
<button id="unmute" class="pill" hidden>🔇 Tap to unmute</button>
<div class="bar">${open ? '<button id="shr" class="pill">📤 Share</button>' : ''}<button id="spd" class="pill">1x</button></div>
${open ? `<div id="cta" class="cta" hidden>🎬 Want more videos like this?<div><button id="more" class="go">🤖 Open @${bot}</button><button id="shr2">📤 Share</button></div></div>` : ''}
<div id="fl" class="flash"></div>
<div id="err"><div id="em"></div><button onclick="location.reload()">↻ Retry</button></div>
<script>
const tg = window.Telegram && Telegram.WebApp;
try { tg.ready(); tg.expand(); tg.setHeaderColor('#000000'); tg.setBackgroundColor('#000000'); tg.disableVerticalSwipes && tg.disableVerticalSwipes(); } catch {}
const $ = id => document.getElementById(id), v = $('v'), src = ${JSON.stringify(src)};
const KEY = 'pos:' + ${JSON.stringify(`${p.s}:${p.f}`)};
const store = { get: () => { try { return +localStorage.getItem(KEY) || 0; } catch { return 0; } }, set: x => { try { x ? localStorage.setItem(KEY, x) : localStorage.removeItem(KEY); } catch {} } };

// loading / buffering: the browser's own spinner (ours on top of it showed two)

// muted by default (also lets autoplay work everywhere); one tap to turn sound on
v.muted = true;
const syncMute = () => $('unmute').hidden = !v.muted || v.paused && !v.currentTime;
v.addEventListener('volumechange', syncMute); v.addEventListener('playing', syncMute);
$('unmute').onclick = () => { v.muted = false; if (v.volume === 0) v.volume = 1; v.play(); };

// buttons fade out while playing, come back on any touch / mouse move
let idleT;
const wake = () => { document.body.classList.remove('idle'); clearTimeout(idleT); idleT = setTimeout(() => { if (!v.paused) document.body.classList.add('idle'); }, 3000); };
['touchstart', 'mousemove', 'click', 'keydown'].forEach(e => addEventListener(e, wake, { passive: true }));
v.addEventListener('pause', wake); v.addEventListener('play', wake);

// share / open the bot (inside Telegram through the Mini App API, in a browser as a normal link)
const OPEN = ${JSON.stringify(open)}, SHARE_TEXT = '🎬 Watch this video in 1 tap — no download needed 👇';
const go = u => { try { if (tg && tg.initData && tg.openTelegramLink) return tg.openTelegramLink(u); } catch {} if (!window.open(u, '_blank')) location.href = u; };
const share = () => { if (!tg?.initData && navigator.share) return navigator.share({ text: SHARE_TEXT, url: OPEN }).catch(() => {}); go('https://t.me/share/url?url=' + encodeURIComponent(OPEN) + '&text=' + encodeURIComponent(SHARE_TEXT)); };
if (OPEN) {
  $('shr').onclick = $('shr2').onclick = share;
  $('more').onclick = () => go(OPEN);
  // the card shows when paused (after it started) or finished, hides while playing
  const cta = () => $('cta').hidden = !(v.ended || (v.paused && v.currentTime > 3));
  ['pause', 'play', 'ended', 'seeked'].forEach(e => v.addEventListener(e, cta));
}

// playback speed
const SPEEDS = [1, 1.25, 1.5, 2];
$('spd').onclick = () => { const s = SPEEDS[(SPEEDS.indexOf(v.playbackRate) + 1) % SPEEDS.length] || 1; v.playbackRate = s; $('spd').textContent = s + 'x'; };

// resume where you left off
let resumed = false;
v.addEventListener('loadedmetadata', () => {
  const at = store.get();
  if (!resumed && at > 5 && at < v.duration - 15) { v.currentTime = at; flash('⏯ Resumed ' + fmt(at), 50); }
  resumed = true;
});
let last = 0;
v.addEventListener('timeupdate', () => { if (Date.now() - last > 4000) { last = Date.now(); store.set(v.currentTime > 5 && v.currentTime < v.duration - 15 ? Math.floor(v.currentTime) : 0); } });
v.addEventListener('ended', () => store.set(0));

// double-tap left / right side to skip 10s (phones); keyboard on desktop
const fmt = s => (s = Math.floor(s), Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'));
let ft;
function flash(t, x) { const f = $('fl'); f.textContent = t; f.style.left = x + '%'; f.style.transform = 'translate(-50%,-50%)'; f.style.opacity = 1; clearTimeout(ft); ft = setTimeout(() => f.style.opacity = 0, 900); }
const skip = d => { v.currentTime = Math.max(0, Math.min(v.duration || 0, v.currentTime + d)); flash(d < 0 ? '« 10s' : '10s »', d < 0 ? 22 : 78); };
let tap = 0;
v.addEventListener('touchend', e => {
  const x = e.changedTouches[0].clientX / innerWidth, now = Date.now();
  if (now - tap < 300 && (x < 0.35 || x > 0.65)) { e.preventDefault(); skip(x < 0.35 ? -10 : 10); tap = 0; } else tap = now;
});
addEventListener('keydown', e => {
  if (e.key === ' ' || e.key === 'k') { e.preventDefault(); v.paused ? v.play() : v.pause(); }
  else if (e.key === 'ArrowLeft' || e.key === 'j') skip(-10);
  else if (e.key === 'ArrowRight' || e.key === 'l') skip(10);
  else if (e.key === 'm') v.muted = !v.muted;
  else if (e.key === 'f') document.fullscreenElement ? document.exitFullscreen() : v.requestFullscreen?.();
});

// turning the phone sideways goes fullscreen, turning it back leaves
const landscape = () => (screen.orientation?.type || '').startsWith('landscape') || Math.abs(window.orientation || 0) === 90;
const onTurn = () => {
  try {
    if (landscape() && !document.fullscreenElement && v.currentTime) (v.requestFullscreen || v.webkitEnterFullscreen)?.call(v);
    else if (!landscape() && document.fullscreenElement) document.exitFullscreen();
  } catch {}
};
if (screen.orientation?.addEventListener) screen.orientation.addEventListener('change', onTurn); else addEventListener('orientationchange', onTurn);

const fail = m => { $('em').textContent = '⚠️ Video could not be played (' + m + '). The link may have expired — try again or resend it to the bot.'; $('err').style.display = 'flex'; };
if (window.Hls && Hls.isSupported()) {
  // segments come through a proxy that is slow on its first request, so be patient and retry
  const h = new Hls({ fragLoadPolicy: { default: { maxTimeToFirstByteMs: 30000, maxLoadTimeMs: 60000, timeoutRetry: { maxNumRetry: 4, retryDelayMs: 0, maxRetryDelayMs: 0 }, errorRetry: { maxNumRetry: 6, retryDelayMs: 1000, maxRetryDelayMs: 8000 } } }, maxBufferLength: 60, startFragPrefetch: true });
  h.loadSource(src); h.attachMedia(v);
  h.on(Hls.Events.ERROR, (_, d) => {
    if (!d.fatal) return;
    if (d.type === Hls.ErrorTypes.NETWORK_ERROR && d.details !== 'manifestLoadError') return h.startLoad();
    if (d.type === Hls.ErrorTypes.MEDIA_ERROR) return h.recoverMediaError();
    h.destroy();
    fail(d.details + (d.response?.code ? ' ' + d.response.code : ''));
  });
} else if (v.canPlayType('application/vnd.apple.mpegurl')) { v.src = src; v.onerror = () => fail('stream error'); }
else fail('this browser cannot play HLS');
v.play().catch(() => {});
</script></body></html>`,
    { headers: { 'content-type': 'text/html;charset=utf-8', 'cache-control': 'no-store' } }
  );
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
    if (url.pathname === '/m3u8') return m3u8(env, db, url);
    if (url.pathname.startsWith('/panel-api/')) return panelApi(req, env, db, url.pathname.slice(11));
    if (url.pathname === '/setup' && url.searchParams.get('key') === env.WEBHOOK_SECRET)
      return Response.json(await setupWebhook(env, env.BOT_TOKEN, url.origin));
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
