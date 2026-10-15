// TeraBox bot on one free Cloudflare Worker: Telegram webhook + HLS player + cron.
// Bindings: DB (D1). Secrets: BOT_TOKEN, WEBHOOK_SECRET, JSTOKEN. Vars: wrangler.toml.

import { DB } from './db.js';
import { makeApi } from './tg.js';
import { createBot, sign, teraboxCfg, resolveCached, streamUrl } from './bot.js';

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

function watch(url) {
  const p = params(url);
  if (!p) return new Response('Bad link', { status: 400 });
  const src = `/m3u8?s=${p.s}&f=${p.f}&q=${p.q}&t=${p.t}`;
  return new Response(
    `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>TeraBox Player</title>
<script src="https://telegram.org/js/telegram-web-app.js"></script>
<script src="https://cdn.jsdelivr.net/npm/hls.js@1.5.13/dist/hls.min.js"></script>
<style>html,body{margin:0;height:100%;background:#000;color:#ccc;font:14px system-ui}video{width:100%;height:100%}#e{position:fixed;top:45%;width:100%;text-align:center}</style>
</head><body><video id="v" controls autoplay playsinline></video><div id="e"></div>
<script>
try { Telegram.WebApp.ready(); Telegram.WebApp.expand(); } catch {}
const v = document.getElementById('v'), src = ${JSON.stringify(src)};
const msg = t => document.getElementById('e').textContent = t;
const fail = m => msg('Playback failed: ' + m);
msg('Loading video...');
v.addEventListener('playing', () => msg(''));
if (Hls.isSupported()) {
  // segments come through a proxy that is slow on its first request, so be patient and retry
  const h = new Hls({ fragLoadPolicy: { default: { maxTimeToFirstByteMs: 30000, maxLoadTimeMs: 60000, timeoutRetry: { maxNumRetry: 4, retryDelayMs: 0, maxRetryDelayMs: 0 }, errorRetry: { maxNumRetry: 6, retryDelayMs: 1000, maxRetryDelayMs: 8000 } } }, maxBufferLength: 60 });
  h.loadSource(src); h.attachMedia(v);
  h.on(Hls.Events.ERROR, (_, d) => {
    if (!d.fatal) return;
    if (d.type === Hls.ErrorTypes.NETWORK_ERROR && d.details !== 'manifestLoadError') return h.startLoad();
    if (d.type === Hls.ErrorTypes.MEDIA_ERROR) return h.recoverMediaError();
    fail(d.details + (d.response?.code ? ' (' + d.response.code + ')' : ''));
  });
}
else if (v.canPlayType('application/vnd.apple.mpegurl')) { v.src = src; v.onerror = () => fail('stream error'); }
else fail('browser has no HLS support');
</script></body></html>`,
    { headers: { 'content-type': 'text/html;charset=utf-8' } }
  );
}

const COMMANDS = [
  ['start', 'Start the bot'], ['help', 'Main menu'], ['info', 'Your info & plan'], ['plan', 'Premium plans'],
  ['redeem', 'Redeem a gift card'], ['ref', 'Invite friends, earn Premium'], ['mystats', 'Your statistics'],
  ['mystatus', 'Premium / tag / stats'], ['history', 'Your history'], ['search', 'Search the library'],
  ['videos', 'Videos'], ['lang', 'Language'],
].map(([command, description]) => ({ command, description }));

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    const db = new DB(env.DB);
    if (url.pathname === '/webhook' && req.method === 'POST') {
      if (req.headers.get('x-telegram-bot-api-secret-token') !== env.WEBHOOK_SECRET) return new Response('forbidden', { status: 403 });
      const u = await req.json();
      const bot = createBot(env, makeApi(env.BOT_TOKEN, env.TG_API), db, url.origin);
      // ack Telegram immediately so it never retries; finish the work in the background
      const work = u.message ? bot.onMessage(u.message) : u.callback_query ? bot.onCallback(u.callback_query) : null;
      if (work) ctx.waitUntil(work.catch(e => console.log('update failed', e.stack)));
      return new Response('ok');
    }
    if (url.pathname === '/watch') return watch(url);
    if (url.pathname === '/m3u8') return m3u8(env, db, url);
    if (url.pathname === '/setup' && url.searchParams.get('key') === env.WEBHOOK_SECRET) {
      const api = makeApi(env.BOT_TOKEN, env.TG_API);
      const hook = await api.call('setWebhook', {
        url: `${url.origin}/webhook`, secret_token: env.WEBHOOK_SECRET, allowed_updates: ['message', 'callback_query'], drop_pending_updates: true,
      });
      const cmds = await api.call('setMyCommands', { commands: COMMANDS });
      return Response.json({ hook, cmds });
    }
    return new Response('Not found', { status: 404 });
  },
  async scheduled(event, env) {
    const bot = createBot(env, makeApi(env.BOT_TOKEN, env.TG_API), new DB(env.DB), '');
await bot.cron(new Date(event.scheduledTime).getUTCMinutes());
  },
};
