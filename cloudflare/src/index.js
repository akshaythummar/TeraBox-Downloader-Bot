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

// ---------------- Videos Mini App (/app) ----------------
// The page (a swipe feed), its feed API, and the video stream. Login = Telegram's signed initData
// (checked with the bot token), so the user id can't be faked. Videos are the ones Telegram already
// has (videos.file_id ≤20 MB): streamed through here so the bot token never reaches the browser.
const APP_HTML = String.raw`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover,user-scalable=no">
<title>Videos</title>
<script>var tg = null; function tgReady() { tg = window.Telegram && Telegram.WebApp; try { tg.ready(); tg.expand(); tg.setHeaderColor("#000000"); tg.setBackgroundColor("#000000"); if (tg.disableVerticalSwipes) tg.disableVerticalSwipes(); } catch (e) {} }</script>
<script async src="https://telegram.org/js/telegram-web-app.js" onload="tgReady()"></script>
<style>
html,body{margin:0;height:100%;background:#000;color:#fff;font:15px system-ui,-apple-system,Segoe UI,Roboto,sans-serif;overflow:hidden;overscroll-behavior:none;-webkit-user-select:none;user-select:none;-webkit-touch-callout:none}
#feed{height:100dvh;overflow-y:scroll;scroll-snap-type:y mandatory;scrollbar-width:none}
#feed::-webkit-scrollbar{display:none}
.slide{position:relative;height:100dvh;scroll-snap-align:start;scroll-snap-stop:always;overflow:hidden;background:#000}
.slide video{position:absolute;inset:0;width:100%;height:100%;object-fit:contain;background:#000}
.slide.tall video{object-fit:cover}
.shade{position:absolute;left:0;right:0;bottom:0;height:38%;background:linear-gradient(transparent,#000c);pointer-events:none}
.info{position:absolute;left:14px;right:84px;bottom:calc(46px + env(safe-area-inset-bottom));pointer-events:none;text-shadow:0 1px 4px #000}
.info b{display:block;font-size:16px}.info span{font-size:13px;color:#ddd}
.rail{position:absolute;right:10px;bottom:calc(50px + env(safe-area-inset-bottom));display:flex;flex-direction:column;gap:18px;align-items:center}
.rail button{width:48px;height:48px;border:0;border-radius:50%;background:#0006;color:#fff;font-size:24px;display:grid;place-items:center;backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);cursor:pointer}
.rail button.on{color:#ff3b5c}
.rail small{display:block;font-size:11px;text-align:center;margin-top:-12px;color:#eee;text-shadow:0 1px 3px #000}
.seek{position:absolute;left:0;right:0;bottom:env(safe-area-inset-bottom);height:34px;touch-action:none;cursor:pointer}
.bar{position:absolute;left:12px;right:12px;bottom:12px;height:3px;border-radius:2px;background:#ffffff40;transition:height .15s}
.bar i{position:relative;display:block;height:100%;width:0;border-radius:2px;background:#fff}
.bar i:after{content:"";position:absolute;right:-7px;top:50%;width:14px;height:14px;margin-top:-7px;border-radius:50%;background:#fff;transform:scale(0);transition:transform .15s}
.seek.drag .bar{height:6px}.seek.drag .bar i:after{transform:scale(1)}
.tm{position:absolute;left:14px;bottom:24px;font:600 12px ui-monospace,Consolas,monospace;color:#eee;text-shadow:0 1px 3px #000;pointer-events:none}
.seek.drag .tm{font-size:15px}
#toast{position:fixed;top:max(56px,calc(env(safe-area-inset-top) + 46px));left:50%;transform:translateX(-50%);z-index:6;transition:opacity .3s;white-space:nowrap}
.load{position:absolute;inset:0;display:grid;place-items:center;pointer-events:none;opacity:0;transition:opacity .2s}
.slide.wait .load{opacity:1}
.slide.ready .poster{display:none}
.poster{position:absolute;inset:0;background:radial-gradient(circle at 50% 40%,#2a2340,#000 70%)}
.msg{position:absolute;inset:0;display:none;place-items:center;text-align:center;padding:24px;color:#bbb}
.slide.bad .msg{display:grid}.slide.bad .load{opacity:0}
.heart{position:absolute;font-size:96px;pointer-events:none;transform:translate(-50%,-50%) scale(.3);opacity:0;animation:pop .8s ease-out forwards}
@keyframes pop{30%{transform:translate(-50%,-50%) scale(1.15);opacity:1}100%{transform:translate(-50%,-80%) scale(1);opacity:0}}
.paused{position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);font-size:64px;opacity:0;transition:opacity .15s;pointer-events:none;text-shadow:0 2px 10px #000}
.slide.held .paused{opacity:.85}
.tp{position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);width:84px;height:84px;border-radius:50%;background:#0009;display:none;place-items:center;font-size:38px;pointer-events:none}
.slide.tap .tp{display:grid}
.top{position:fixed;top:max(10px,env(safe-area-inset-top));left:12px;z-index:5;pointer-events:none}
.pill{padding:6px 12px;border-radius:16px;background:#0007;font:600 13px system-ui;backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px)}
.hint{position:fixed;bottom:calc(110px + env(safe-area-inset-bottom));left:50%;transform:translateX(-50%);padding:9px 16px;border-radius:20px;background:#000a;font-size:14px;z-index:5;transition:opacity .4s;pointer-events:none;white-space:nowrap;animation:bob 1.6s ease-in-out infinite}
@keyframes bob{50%{transform:translate(-50%,-6px)}}
.wall{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;padding:28px;text-align:center;background:radial-gradient(circle at 50% 35%,#2a2340,#000 70%)}
.wall h2{margin:0;font-size:22px}.wall p{margin:0;color:#bbb;line-height:1.5}
.go{padding:14px 24px;border:0;border-radius:14px;font:700 16px system-ui;color:#fff;background:linear-gradient(135deg,#8a6bff,#22c3ee);cursor:pointer}
.spin{width:42px;height:42px;border:4px solid #fff3;border-top-color:#fff;border-radius:50%;animation:r .8s linear infinite}
@keyframes r{to{transform:rotate(360deg)}}
#login{position:fixed;inset:0;z-index:20;display:grid;place-items:center;background:radial-gradient(circle at 50% 30%,#2a2340,#07060d 70%);transition:opacity .35s}
#login.out{opacity:0;pointer-events:none}
.card{width:min(86vw,340px);padding:26px 22px;border-radius:22px;background:#15131f;box-shadow:0 20px 60px #000a;text-align:center}
.card .logo{width:62px;height:62px;margin:0 auto 12px;border-radius:18px;display:grid;place-items:center;font-size:32px;background:linear-gradient(135deg,#8a6bff,#22c3ee)}
.card h3{margin:0 0 16px;font-size:19px}
.card label{display:block;text-align:left;font-size:12px;color:#9a97ad;margin:0 0 6px 4px}
.field{padding:12px 14px;border-radius:12px;background:#0d0c14;border:1px solid #2c2940;font:600 18px ui-monospace,Consolas,monospace;letter-spacing:.06em;text-align:left;display:flex;justify-content:space-between;align-items:center}
.field small{font:500 12px system-ui;color:#9a97ad;letter-spacing:0}
.ring{width:64px;height:64px;margin:20px auto 10px}
.ring svg{width:100%;height:100%}
.ring .c{fill:none;stroke:#ffffff22;stroke-width:4}
.ring .s{fill:none;stroke:#8a6bff;stroke-width:4;stroke-linecap:round;stroke-dasharray:40 151;transform-origin:center;animation:r .9s linear infinite}
.ring .k{fill:none;stroke:#fff;stroke-width:5;stroke-linecap:round;stroke-linejoin:round;stroke-dasharray:40;stroke-dashoffset:40}
.ring.ok .c{fill:#1fb36b;stroke:#1fb36b;transition:fill .25s,stroke .25s}
.ring.ok .s{display:none}
.ring.ok .k{animation:tick .35s .15s ease-out forwards}
.ring.ok{animation:boom .4s ease-out}
.ring.no .c{fill:#e5484d;stroke:#e5484d}.ring.no .s{display:none}
@keyframes tick{to{stroke-dashoffset:0}}
@keyframes boom{50%{transform:scale(1.12)}}
.card .sub{color:#b9b6c9;font-size:14px;min-height:20px}
.links .dl,.links .dl+small{display:none}
.pay{gap:10px;padding:22px 18px calc(22px + env(safe-area-inset-bottom))}
.pay .lock{font-size:44px;line-height:1}
.pay .again{color:#ffd479;font-weight:600;font-size:15px}
.plans{display:flex;flex-direction:column;gap:12px;width:min(100%,360px);margin:6px 0 2px}
.plan{position:relative;display:grid;grid-template-columns:1fr auto;align-items:center;gap:3px 12px;padding:14px 16px;border-radius:16px;border:1px solid #2f2b45;background:#16131f;color:#fff;text-align:left;cursor:pointer;font:inherit}
.plan .nm{font-weight:700;font-size:16px}.plan small{color:#a9a5bd;font-size:12.5px}
.plan .pr{grid-column:2;grid-row:1/3;font-weight:800;font-size:21px}
.plan.best{border-color:#8a6bff;background:linear-gradient(135deg,#251d45,#14202b);box-shadow:0 0 0 1px #8a6bff55,0 8px 24px #8a6bff33}
.plan em{position:absolute;top:-9px;right:14px;font:800 10px system-ui;letter-spacing:.06em;font-style:normal;padding:3px 8px;border-radius:8px;background:linear-gradient(135deg,#8a6bff,#22c3ee)}
.plan:active{transform:scale(.98)}
.pay .perks{font-size:13px;color:#bbb}
.pay .all{background:none;border:0;color:#9aa3c7;text-decoration:underline;font:500 14px system-ui;cursor:pointer;padding:6px}
[hidden]{display:none!important}
</style></head><body>
<div class="top"><span id="badge" class="pill" hidden></span></div>
<div id="feed"></div>
<div id="login"><div class="card">
  <div class="logo">🎬</div>
  <h3 id="lt">Logging in…</h3>
  <label>Telegram user ID</label>
  <div class="field"><span id="lid">—</span><small id="lname"></small></div>
  <div class="ring" id="ring"><svg viewBox="0 0 64 64"><circle class="c" cx="32" cy="32" r="28"/><circle class="s" cx="32" cy="32" r="28"/><path class="k" d="M20 33l8 8 17-18"/></svg></div>
  <div class="sub" id="lsub">Verifying your Telegram account…</div>
</div></div>
<div id="toast" class="pill" hidden></div>
<div id="hint" class="hint" hidden>⬆️ Swipe up for more</div>
<script>
var BOT = "__BOT__", MODE = "__MODE__"; // MODE "links" = /app2, the pool's links straight from TeraBox (test)
if (MODE === "links") document.documentElement.className = "links";
if (window.Telegram && Telegram.WebApp && !tg) tgReady();
// Telegram puts the signed login data in the URL hash: read it there so the feed starts at once
var INIT = (tg && tg.initData) || new URLSearchParams(location.hash.slice(1)).get("tgWebAppData") || "";
var feed = document.getElementById("feed"), muted = true, loading = false, ended = false, slides = [], freeLeft = null;
var me = 0, meName = ""; try { var u0 = JSON.parse(new URLSearchParams(INIT).get("user")); me = u0.id || 0; meName = u0.username ? "@" + u0.username : (u0.first_name || ""); } catch (e) {}
document.getElementById("lid").textContent = me || "—"; document.getElementById("lname").textContent = meName;
var okAt = 0, loginGone = false;
// the tick stays at least 0.8 s, then the card fades once the first video plays (or after 7 s anyway)
function loginOk() { okAt = Date.now(); document.getElementById("ring").classList.add("ok"); document.getElementById("lt").textContent = "Logged in"; document.getElementById("lsub").textContent = "Loading your videos…"; setTimeout(hideLogin, 7000); }
function loginFail(title, text) { document.getElementById("ring").classList.add("no"); document.getElementById("lt").textContent = title; document.getElementById("lsub").textContent = text; }
function hideLogin() { if (loginGone) return; loginGone = true; setTimeout(function () { document.getElementById("login").classList.add("out"); }, Math.max(0, 800 - (Date.now() - okAt))); }
var liked = {}; try { liked = JSON.parse(localStorage.getItem("liked") || "{}"); } catch (e) {}
function saveLikes() { try { localStorage.setItem("liked", JSON.stringify(liked)); } catch (e) {} }
function go(u) { try { if (tg && tg.openTelegramLink) return tg.openTelegramLink(u); } catch (e) {} location.href = u; }
function toast(t) { var el = document.getElementById("toast"); el.textContent = t; el.hidden = false; clearTimeout(toast._t); toast._t = setTimeout(function () { el.hidden = true; }, 2500); }
// the owner's live log: one silent message per session, edited as the user watches (≤ 1 call / 8 s;
// closing the app sends the final state at once). Only counts — nothing is stored anywhere.
var LV = { fail: 0, n: 0, dl: 0, lk: 0, wall: 0, buy: 0, t0: Date.now(), mid: 0, sig: "", at: 0, key: "", busy: false, tm: 0 };
function live(end) {
  if (!okAt) return;
  clearTimeout(LV.tm);
  var wait = 8000 - (Date.now() - LV.at);
  if (LV.busy || (!end && wait > 0)) { LV.tm = setTimeout(function () { live(end); }, LV.busy ? 700 : wait); return; }
  var body = { mode: MODE, fail: LV.fail, initData: INIT, mid: LV.mid, sig: LV.sig, n: LV.n, dl: LV.dl, lk: LV.lk, wall: LV.wall, buy: LV.buy, plan: freeLeft == null ? "paid" : "free", end: end ? 1 : 0 };
  var key = JSON.stringify([body.fail, body.n, body.dl, body.lk, body.wall, body.buy, body.end]);
  if (key === LV.key) return;
  body.secs = Math.round((Date.now() - LV.t0) / 1000);
  LV.key = key; LV.at = Date.now(); LV.busy = true;
  fetch("/app/api/live", { method: "POST", keepalive: true, headers: { "content-type": "application/json" }, body: JSON.stringify(body) })
    .then(function (r) { return r.json(); }).then(function (d) { if (d.mid) { LV.mid = d.mid; LV.sig = d.sig; } })
    .catch(function () {}).then(function () { LV.busy = false; });
}
document.addEventListener("visibilitychange", function () { live(document.hidden); });
function fmt(t) { t = Math.floor(t || 0); var m = Math.floor(t / 60), x = t % 60; return m + ":" + (x < 10 ? "0" : "") + x; }
// ⬇️ = this video into the user's Telegram chat (the bot sends it; auto-deleted like /videos)
function download(s, b) {
  if (s._sent) return toast("✅ Already sent to your chat");
  if (b.disabled) return;
  b.disabled = true; b.textContent = "⏳";
  fetch("/app/api/send", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ initData: INIT, id: s.dataset.id, d: s.dataset.d }) })
    .then(function (r) { return r.json(); })
    .then(function (d) { if (!d.ok) throw 0; s._sent = true; LV.dl++; live(); b.textContent = "✅"; toast("✅ Sent to your Telegram chat"); try { tg.HapticFeedback.notificationOccurred("success"); } catch (e) {} })
    .catch(function () { b.textContent = "⬇️"; toast("❌ Couldn't send — try again"); })
    .then(function () { b.disabled = false; });
}
// the seek bar: tap or drag anywhere on it to jump; the time grows while dragging
function seeker(s) {
  var sk = s.querySelector(".seek"), bar = s.querySelector(".bar"), fill = s.querySelector(".bar i"), tm = s.querySelector(".tm");
  s._show = function (t) { var v = s._v; if (v && v.duration) { fill.style.width = (100 * t / v.duration) + "%"; tm.textContent = fmt(t) + " / " + fmt(v.duration); } };
  function at(e) { var r = bar.getBoundingClientRect(), v = s._v; return Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * (v ? v.duration : 0); }
  sk.addEventListener("pointerdown", function (e) {
    e.stopPropagation(); if (!s._v || !s._v.duration) return;
    s._drag = true; sk.classList.add("drag"); try { sk.setPointerCapture(e.pointerId); } catch (x) {}
    s._show(at(e));
  });
  sk.addEventListener("pointermove", function (e) { if (s._drag) s._show(at(e)); });
  function end(e) { if (!s._drag) return; s._drag = false; sk.classList.remove("drag"); if (!s._v) return; var t = at(e); s._v.currentTime = t; s._show(t); start(s); }
  sk.addEventListener("pointerup", function (e) { e.stopPropagation(); end(e); });
  sk.addEventListener("pointercancel", end);
}
function wall(title, text, button, act) {
  var s = document.createElement("div"); s.className = "slide wall";
  s.innerHTML = "<h2></h2><p></p>" + (button ? '<button class="go"></button>' : "");
  s.querySelector("h2").textContent = title; s.querySelector("p").textContent = text;
  if (button) { s.querySelector("button").textContent = button; s.querySelector("button").onclick = act; }
  feed.appendChild(s); return s;
}
function openPlans() { go("https://t.me/" + BOT + "?start=plans"); try { tg.close(); } catch (e) {} }
// a plan card: the bot opens straight on that plan's payment QR
function buy(id) { go("https://t.me/" + BOT + "?start=plan_" + id); try { tg.close(); } catch (e) {} }
// After the last free video: the plans right here (one tap → that plan's QR in the bot) and a live
// countdown to tomorrow's free videos. Without plans (payment API down) the plain button as before.
function paywall(w) {
  var plans = (w && w.plans) || [];
  if (!plans.length) return wall("🔒 That's all your free videos for today", "Come back tomorrow for more — or unlock unlimited videos now.", "🔓 Unlock unlimited", openPlans);
  var s = document.createElement("div"); s.className = "slide wall pay";
  s.innerHTML = '<div class="lock">🔒</div><h2>Today\'s free videos are done</h2><p class="again"></p><div class="plans"></div>' +
    '<p class="perks">♾️ Unlimited videos · ⚡ No daily limit · 🎬 /videos too</p><button class="all">See all plans in the bot</button>';
  plans.forEach(function (p, i) {
    var b = document.createElement("button"); b.className = "plan" + (p.best ? " best" : "");
    b.innerHTML = '<span class="nm"></span><span class="pr"></span><small></small>' + (p.best ? "<em>BEST VALUE</em>" : "");
    b.querySelector(".nm").textContent = (i === 0 ? "⚡ " : p.best ? "💎 " : "") + p.name;
    b.querySelector(".pr").textContent = "₹" + p.price;
    b.querySelector("small").textContent = p.days + (p.days === 1 ? " day" : " days") + " unlimited" + (i && p.save >= 10 ? " · save " + p.save + "%" : "");
    b.onclick = function () { LV.buy = p.price; live(true); buy(p.id); };
    s.querySelector(".plans").appendChild(b);
  });
  s.querySelector(".all").onclick = openPlans;
  var ag = s.querySelector(".again");
  if (w.daily > 0) {
    var end = Date.now() + w.resetIn * 1000;
    (function tick() { var x = Math.max(0, Math.round((end - Date.now()) / 1000)); ag.textContent = "🎁 " + w.daily + " free videos again in " + Math.floor(x / 3600) + "h " + Math.floor(x % 3600 / 60) + "m"; if (x > 0) setTimeout(tick, 20000); })();
  } else ag.textContent = "Pick a plan to keep watching 👇";
  feed.appendChild(s); return s;
}
// only the on-screen video gets the sound setting; warming (off-screen) ones stay muted
function setSound() {
  var s = current(); if (s && s._v) s._v.muted = muted;
  document.querySelectorAll(".snd").forEach(function (b) { b.textContent = muted ? "🔇" : "🔊"; });
}
function like(s, on) {
  var id = s.dataset.id, was = !!liked[id]; liked[id] = on === undefined ? !liked[id] : on; if (!liked[id]) delete liked[id]; saveLikes();
  if (!was && liked[id]) { LV.lk++; live(); }
  s.querySelector(".lk").classList.toggle("on", !!liked[id]); s.querySelector(".lk").textContent = liked[id] ? "❤️" : "🤍";
}
// Android's WebView lets a <video> element play with sound only after a tap asked it to play;
// swipes don't count. A new element per slide meant every later video (each new batch) sat paused
// until a long press. So 4 elements are reused for all slides, and taps unlock all 4 for good.
var POOL = [];
function unlock() {
  if (navigator.userActivation && !navigator.userActivation.isActive) return;
  POOL.forEach(function (v) {
    if (v._ok) return; v._ok = true;
    var was = v.paused, p = v.play(); if (p && p.catch) p.catch(function () {});
    if (was && !(v._s && v._s._on && current() === v._s)) v.pause();
  });
}
document.addEventListener("pointerup", unlock, true); document.addEventListener("click", unlock, true);
function makeVideo() {
  var v = document.createElement("video");
  v.setAttribute("playsinline", ""); v.setAttribute("disablepictureinpicture", ""); v.setAttribute("controlslist", "nodownload noplaybackrate");
  v.loop = true; v.muted = true; v.preload = "auto"; v.oncontextmenu = function () { return false; };
  // the spinner only if it's really slow (no flicker on fast starts)
  v.addEventListener("loadstart", function () { var s = v._s; if (!s) return; clearTimeout(s._w); s._w = setTimeout(function () { if (v._s === s && !s.classList.contains("ready")) s.classList.add("wait"); }, 400); });
  v.addEventListener("playing", function () { var s = v._s; if (!s) return; clearTimeout(s._w); s.classList.add("ready"); s.classList.remove("wait", "tap"); if (current() === s) { if (okAt) hideLogin(); prepare(slides.indexOf(s)); if (!s._seen) { s._seen = true; LV.n++; live(); } } });
  v.addEventListener("waiting", function () { var s = v._s; if (!s) return; clearTimeout(s._w); s._w = setTimeout(function () { if (v._s === s) s.classList.add("wait"); }, 400); });
  v.addEventListener("timeupdate", function () { var s = v._s; if (s && !s._drag) s._show(v.currentTime); });
  v.addEventListener("loadedmetadata", function () {
    var s = v._s; if (!s) return;
    if (!v.videoWidth) return bad(s, true); // loads, but no picture: really broken → report it
    s.classList.toggle("tall", v.videoHeight >= v.videoWidth * 1.2);
    s._show(v.currentTime);
    if (current() === s) prepare(slides.indexOf(s));
  });
  v.addEventListener("error", function () { if (v._s && v.getAttribute("src")) bad(v._s, false); }); // network / expired link: skip, don't report
  return v;
}
for (var k = 0; k < 4; k++) POOL.push(makeVideo());
// gives slide s a video element: a free one, else the one farthest from the on-screen slide i among
// those outside i..i+2 (the 4th element keeps the previous video while it isn't needed)
function attach(s, i) {
  if (s._v) return s._v;
  if (s.classList.contains("bad")) return null;
  var pick = null, far = -1;
  POOL.forEach(function (v) { var j = v._s ? slides.indexOf(v._s) : -1, d = !v._s ? 1e9 : j < i || j > i + 2 ? Math.abs(j - i) : -1; if (d > far) { far = d; pick = v; } });
  if (!pick) return null;
  detach(pick);
  pick._s = s; s._v = pick; pick.muted = true; pick.src = s.dataset.src;
  s.insertBefore(pick, s.querySelector(".shade"));
  return pick;
}
function detach(v) {
  var s = v._s; if (!s) return;
  v.pause(); v.removeAttribute("src"); v.load();
  clearTimeout(s._w); s._v = null; s._warm = false; s.classList.remove("ready", "wait", "tap"); v._s = null;
  if (v.parentNode) v.parentNode.removeChild(v);
}
// plays the on-screen video. If the browser refuses (sound without a tap) it plays muted instead;
// if even that is refused (data saver) a ▶ asks for one tap — never a silently frozen video.
function start(s) {
  var v = s._v; if (!v) return;
  v.muted = muted;
  var p = v.play();
  if (p && p.catch) p.catch(function (e) {
    if (!e || e.name !== "NotAllowedError" || v._s !== s || current() !== s) return;
    if (!v.muted) { muted = true; setSound(); toast("🔇 Tap 🔊 for sound"); var q = v.play(); if (q && q.catch) q.catch(function () { s.classList.add("tap"); }); }
    else s.classList.add("tap");
  });
}
function addVideo(v) {
  var s = document.createElement("div"); s.className = "slide"; s.dataset.id = v.id; s.dataset.src = v.src; s.dataset.d = v.d || "";
  s.innerHTML = '<div class="poster"></div>' +
    '<div class="shade"></div><div class="load"><div class="spin"></div></div><div class="paused">⏸</div><div class="tp">▶</div>' +
    '<div class="msg">⚠️ This one didn\'t load — skipping…</div>' +
    '<div class="info"><b>@' + BOT + '</b><span>🎬 Swipe up for the next video</span></div>' +
    '<div class="rail"><button class="lk">🤍</button><small>Like</small><button class="dl">⬇️</button><small>Download</small><button class="snd">🔇</button><small>Sound</small></div>' +
    '<div class="seek"><span class="tm"></span><div class="bar"><i></i></div></div>';
  if (liked[v.id]) like(s, true);
  s.querySelector(".lk").onclick = function (e) { e.stopPropagation(); like(s); };
  s.querySelector(".dl").onclick = function (e) { e.stopPropagation(); download(s, this); };
  s.querySelector(".snd").onclick = function (e) { e.stopPropagation(); muted = !muted; setSound(); if (s._v && s._v.paused) start(s); };
  s.querySelector(".snd").textContent = muted ? "🔇" : "🔊";
  gestures(s); seeker(s);
  feed.appendChild(s); slides.push(s); io.observe(s);
}
// double-tap = like (with a heart), hold = pause, single tap = nothing (or play, if a ▶ is shown)
function gestures(s) {
  var last = 0, hold = null;
  s.addEventListener("pointerdown", function (e) {
    if (e.target.closest(".rail,.seek")) return;
    hold = setTimeout(function () { s.classList.add("held"); if (s._v) s._v.pause(); }, 350);
  });
  function up(e) {
    clearTimeout(hold);
    if (s.classList.contains("held")) { s.classList.remove("held"); start(s); return; }
    if (e.type !== "pointerup" || e.target.closest(".rail,.seek")) return;
    if (s.classList.contains("tap")) { s.classList.remove("tap"); start(s); return; }
    var now = Date.now();
    if (now - last < 300) {
      like(s, true); last = 0;
      var h = document.createElement("div"); h.className = "heart"; h.textContent = "❤️";
      var r = s.getBoundingClientRect(); h.style.left = (e.clientX - r.left) + "px"; h.style.top = (e.clientY - r.top) + "px";
      s.appendChild(h); setTimeout(function () { h.remove(); }, 900);
    } else last = now;
  }
  s.addEventListener("pointerup", up); s.addEventListener("pointercancel", up); s.addEventListener("pointerleave", up);
}
function bad(s, report) {
  if (s.classList.contains("bad")) return;
  s.classList.add("bad"); LV.fail++; live();
  if (s._v) detach(s._v);
  if (report && MODE !== "links") try { fetch("/app/api/bad", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ initData: INIT, id: s.dataset.id }) }); } catch (e) {}
  if (current() === s) setTimeout(function () { var n = s.nextElementSibling; if (n && current() === s) n.scrollIntoView({ behavior: "smooth" }); }, 900);
}
function current() { var y = feed.scrollTop + feed.clientHeight / 2, c = null; slides.forEach(function (s) { if (s.offsetTop <= y && s.offsetTop + s.offsetHeight > y) c = s; }); return c; }
// Phones' in-app browsers ignore preload, so the next video is "warmed" once the current one has its
// metadata, the one after once it plays (what's on screen gets the bandwidth first): started muted
// off-screen and paused as soon as it plays — the browser has then really fetched and decoded its
// start, and a swipe plays it at once.
function warm(s, i) {
  if (s._warm || s.classList.contains("bad")) return;
  var v = attach(s, i); if (!v) return;
  s._warm = true; v.muted = true;
  v.addEventListener("playing", function stop() { v.removeEventListener("playing", stop); if (v._s === s && current() !== s) v.pause(); });
  var p = v.play(); if (p && p.catch) p.catch(function () {});
}
function prepare(i) {
  var cur = slides[i]; if (!cur) return;
  var v = attach(cur, i); if (!v) return;
  cur._warm = true;
  if (slides[i + 1] && v.readyState >= 1) warm(slides[i + 1], i);
  if (slides[i + 2] && cur.classList.contains("ready")) warm(slides[i + 2], i);
}
var seen = 0;
var io = new IntersectionObserver(function (es) {
  es.forEach(function (e) {
    var s = e.target;
    // the observer fires several times per swipe (also when a swipe away starts): only a real
    // arrival (s._on) restarts the video and only a real departure pauses it
    if (e.isIntersecting && e.intersectionRatio > 0.6) {
      if (s._on) return; s._on = true; s._arr = Date.now();
      var i = slides.indexOf(s);
      // a fast fling passes slides in ~0.2 s: only the one the user stops on starts loading
      clearTimeout(s._go);
      s._go = setTimeout(function () { if (current() !== s) return; prepare(i); if (!s._v) return; if (s._v.currentTime > 0.5) s._v.currentTime = 0; start(s); }, s._v && s._v.readyState >= 2 ? 0 : 250);
      if (s.classList.contains("bad")) setTimeout(function () { var n = s.nextElementSibling; if (n && current() === s) n.scrollIntoView({ behavior: "smooth" }); }, 600);
      if (i > 0) { seen++; document.getElementById("hint").hidden = true; }
      // free users: the badge counts down, so the paywall after the last one is no surprise
      if (freeLeft != null) { var fl = slides.length - 1 - i + freeLeft; document.getElementById("badge").textContent = "🎁 " + fl + " more free today"; if (!fl && !s._last) { s._last = true; toast("🎁 Last free video for today"); } }
      if (i >= slides.length - 5) more();
    } else if (s._on) { s._on = false; clearTimeout(s._go); s.classList.remove("tap"); if (s._v) { s._v.pause(); s._v.muted = true; } }
  });
}, { threshold: [0, 0.6, 1] });
// Safety net, twice a second: the on-screen video must be playing — if it sits paused (not held,
// no ▶ shown) it's started again; if it plays but makes no progress for 2.5 s (stream stalled) it's
// asked again from the same spot — what users did by hand with the seek bar.
setInterval(function () {
  var s = current(), v = s && s._v;
  if (!v || !s._on || s._drag || document.hidden) return;
  if (v.paused) { if (!s.classList.contains("held") && !s.classList.contains("tap") && v.readyState >= 2 && Date.now() - s._arr > 1200) start(s); return; }
  if (!v.currentTime) return;
  if (v.currentTime !== s._lt) { s._lt = v.currentTime; s._lm = Date.now(); return; }
  if (Date.now() - s._lm > 2500) { s._lm = Date.now(); v.currentTime = v.currentTime + 0.05; }
}, 500);
document.addEventListener("visibilitychange", function () { var s = current(); if (!s || !s._v) return; if (document.hidden) s._v.pause(); else start(s); });

function more() {
  if (MODE === "links") return moreLinks();
  if (loading || ended) return; loading = true;
  if (!INIT) { loginFail("Open from Telegram", "Open this app with the button in the bot."); ended = true; return; }
  fetch("/app/api/feed", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ initData: INIT }) })
    .then(function (r) { return r.json(); })
    .then(function (d) {
      if (!d.ok) { ended = true; return d.error === "soon" ? loginFail("Coming soon", "The Videos App opens for everyone soon.") : loginFail("Login failed", "Close and open the app again."); }
      if (!okAt) { loginOk(); live(); }
      var b = document.getElementById("badge"); b.hidden = false;
      b.textContent = d.unlimited ? "♾️ Unlimited" : "🎁 " + (d.left + d.videos.length) + " free today";
      freeLeft = d.unlimited ? null : d.left;
      var firstBatch = !slides.length;
      d.videos.forEach(addVideo);
      if (firstBatch && slides.length) document.getElementById("hint").hidden = false;
      if (!d.unlimited && d.left === 0) {
        ended = true;
        if (!d.videos.length) hideLogin();
        var pw = paywall(d.wall);
        new IntersectionObserver(function (es) { if (es[0].isIntersecting && !LV.wall) { LV.wall = 1; live(); } }, { threshold: 0.6 }).observe(pw);
      }
    })
    .catch(function () { if (!okAt) loginFail("No connection", "Check your internet and open the app again."); else wall("⚠️ Network error", "Check your connection and reopen the app.", null); ended = true; })
    .then(function () { loading = false; });
}
// /app2: 200 links per fetch, kept in the phone (localStorage) and shown 10 at a time
function moreLinks() {
  if (loading || ended) return; loading = true;
  if (!INIT) { loginFail("Open from Telegram", "Open this app with the button in the bot."); ended = true; return; }
  var c = null; try { c = JSON.parse(localStorage.getItem("links200") || "null"); } catch (e) {}
  function take(c) {
    var batch = c.links.slice(c.i, c.i + 10); c.i += batch.length;
    try { localStorage.setItem("links200", JSON.stringify(c)); } catch (e) {}
    if (!okAt) { loginOk(); live(); }
    var b = document.getElementById("badge"); b.hidden = false; b.textContent = "🧪 Links test · " + c.i + "/" + c.links.length;
    var firstBatch = !slides.length;
    batch.forEach(function (u) { addVideo({ id: (String(u).match(/file\/([0-9a-f]{32})/) || [])[1] || "x", src: u, d: "" }); });
    if (firstBatch && slides.length) document.getElementById("hint").hidden = false;
    loading = false;
  }
  if (c && c.links && c.i < c.links.length && Date.now() - c.at < 6 * 3600e3) return take(c);
  fetch("/app/api/links", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ initData: INIT }) })
    .then(function (r) { return r.json(); })
    .then(function (d) {
      if (!d.ok || !d.links.length) { ended = true; loading = false; return loginFail(d.error === "admin" ? "Admins only" : "No links", d.error === "admin" ? "This test is for admins." : "The pool returned no links — try again."); }
      take({ links: d.links, i: 0, at: Date.now() });
    })
    .catch(function () { loading = false; if (!okAt) loginFail("No connection", "Check your internet and open the app again."); });
}
more();
</script></body></html>
`;
async function appPage(env, mode = 'feed') {
  return new Response(APP_HTML.replace('__BOT__', (await botUsername(env)) || '').replace('__MODE__', mode), { headers: { 'content-type': 'text/html;charset=utf-8', 'cache-control': 'no-store' } });
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
    if (url.pathname === '/app') return appPage(env);
    if (url.pathname === '/app2') return appPage(env, 'links');
    if (url.pathname === '/app/api/links' && req.method === 'POST') {
      const uid = await webAppUser((await req.json().catch(() => ({}))).initData, env.BOT_TOKEN);
      if (!uid) return Response.json({ ok: false }, { status: 401 });
      const bot = createBot(env, makeApi(env.BOT_TOKEN, env.TG_API), db, url.origin);
      if (!(await bot.isAdmin(uid))) return Response.json({ ok: false, error: 'admin' });
      return Response.json({ ok: true, links: await bot.appLinks() });
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
      return Response.json(await createBot(env, makeApi(env.BOT_TOKEN, env.TG_API), db, url.origin).appLive(uid, user, body));
    }
    if (url.pathname === '/app/api/send' && req.method === 'POST') {
      const body = await req.json().catch(() => ({}));
      const uid = await webAppUser(body.initData, env.BOT_TOKEN);
      if (!uid || !/^[0-9a-f]{32}$/.test(body.id || '') || body.d !== (await sign(env.WEBHOOK_SECRET, `dl:${uid}:${body.id}`))) return Response.json({ ok: false }, { status: 400 });
      const bot = createBot(env, makeApi(env.BOT_TOKEN, env.TG_API), db, url.origin);
      if (!(await bot.appAllowed(uid))) return Response.json({ ok: false });
      const res = await bot.appSend(uid, body.id);
      ctx.waitUntil(db.flush());
      return Response.json(res);
    }
    if (url.pathname === '/app/api/feed' && req.method === 'POST') {
      const uid = await webAppUser((await req.json().catch(() => ({}))).initData, env.BOT_TOKEN);
      if (!uid) return Response.json({ ok: false, error: 'login' }, { status: 401 });
      const bot = createBot(env, makeApi(env.BOT_TOKEN, env.TG_API), db, url.origin);
      if (!(await bot.appAllowed(uid))) return Response.json({ ok: false, error: 'soon' });
      const res = await bot.appFeed(uid);
      ctx.waitUntil(db.flush());
      return Response.json(res);
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
