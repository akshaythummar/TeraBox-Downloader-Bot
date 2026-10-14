// TeraBox stream bot — Telegram webhook + HLS player on one free Cloudflare Worker.
// No downloads/uploads: the user gets a player link that streams through the
// existing resolver + HLS proxy workers. Bindings: DB (D1), KV.
// Secrets: BOT_TOKEN, WEBHOOK_SECRET, JSTOKEN. Vars: see wrangler.toml.

const HOUR = 3600;
const LINK_RE = /https?:\/\/[^\s]*(terabox|1024tera|tera1024box|terashare|terafileshare|4funbox|mirrobox|nephobox|momerybox|tibibox|gibibox|pebibox|fancybox|dubox|bestclouddrive|playduo|teradownloader)[^\s]*/i;

const tg = (env, method, body) =>
  fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }).then(r => r.json());

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const list = s => (s || '').split(',').map(x => x.trim()).filter(Boolean);
const now = () => Math.floor(Date.now() / 1000);
const isAdmin = (env, uid) => [env.OWNER_ID, ...list(env.ADMINS)].includes(String(uid));
const shareCode = link => (link.match(/\/s\/([\w-]+)/) || link.match(/surl=([\w-]+)/) || [])[1];
const fmtSize = b => (b > 0 ? `${(b / 1048576).toFixed(1)} MB` : '');

// HMAC so /m3u8 only serves links this bot issued (protects the free request quota).
async function sig(env, data) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(env.WEBHOOK_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(data)));
  return btoa(String.fromCharCode(...mac)).replace(/[+/=]/g, c => ({ '+': '-', '/': '_', '=': '' })[c]).slice(0, 22);
}

async function resolve(env, code) {
  try {
    const r = await fetch(`${env.RESOLVER}/?q=${encodeURIComponent(code)}`, { signal: AbortSignal.timeout(20000) });
    const d = await r.json();
    return d?.errno === 0 && d.list?.length ? d : null;
  } catch {
    return null;
  }
}

// Same URL the Python bot built (terabox.py _build_stream_url), proxied through the HLS worker.
const streamUrl = (env, d, fid, jsToken) =>
  `${env.HLS_PROXY}/?hls=${encodeURIComponent(
    `https://1024tera.com/share/streaming.m3u8?uk=${d.uk}&shareid=${d.shareid}&type=M3U8_AUTO_480&fid=${fid}` +
      `&sign=${d.sign}&timestamp=${d.timestamp}&jsToken=${jsToken}` +
      `&esl=1&isplayer=1&ehps=1&clienttype=0&app_id=250528&web=1&channel=dubox`
  )}`;

// ---------------- HTTP: player ---------------- //

function params(url) {
  const s = url.searchParams.get('s') || '', f = url.searchParams.get('f') || '', t = url.searchParams.get('t') || '';
  return /^[\w-]+$/.test(s) && /^\d+$/.test(f) && /^[\w-]+$/.test(t) ? { s, f, t } : null;
}

async function m3u8(env, url) {
  const p = params(url);
  if (!p || p.t !== (await sig(env, `${p.s}:${p.f}`))) return new Response('Bad link', { status: 403 });
  const d = await resolve(env, p.s); // fresh sign/timestamp on every play
  if (!d) return new Response('Link expired or TeraBox unavailable', { status: 502 });
  const token = (await env.KV.get('jstoken')) || env.JSTOKEN;
  return Response.redirect(streamUrl(env, d, p.f, token), 302);
}

function watch(url) {
  const p = params(url);
  if (!p) return new Response('Bad link', { status: 400 });
  const src = `/m3u8?s=${p.s}&f=${p.f}&t=${p.t}`;
  return new Response(
    `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>TeraBox Player</title>
<script src="https://telegram.org/js/telegram-web-app.js"></script>
<script src="https://cdn.jsdelivr.net/npm/hls.js@1.5.13/dist/hls.min.js"></script>
<style>html,body{margin:0;height:100%;background:#000;color:#ccc;font:14px system-ui}video{width:100%;height:100%}#e{position:fixed;top:45%;width:100%;text-align:center}</style>
</head><body><video id="v" controls autoplay playsinline></video><div id="e"></div>
<script>
Telegram.WebApp.ready(); Telegram.WebApp.expand();
const v = document.getElementById('v'), src = ${JSON.stringify(src)};
const fail = m => document.getElementById('e').textContent = 'Playback failed: ' + m;
if (v.canPlayType('application/vnd.apple.mpegurl')) { v.src = src; v.onerror = () => fail('stream error'); }
else if (Hls.isSupported()) { const h = new Hls(); h.loadSource(src); h.attachMedia(v); h.on(Hls.Events.ERROR, (_, d) => d.fatal && fail(d.details)); }
else fail('browser has no HLS support');
</script></body></html>`,
    { headers: { 'content-type': 'text/html;charset=utf-8' } }
  );
}

// ---------------- Telegram ---------------- //

async function setUser(env, id, col, val) {
  // col is always a literal from this file, never user input
  await env.DB.prepare(`INSERT INTO users (id, joined, ${col}) VALUES (?1, ?2, ?3) ON CONFLICT(id) DO UPDATE SET ${col} = ?3`)
    .bind(id, now(), val).run();
}

async function onUpdate(env, origin, u) {
  const m = u.message;
  if (!m?.text || m.chat.type !== 'private') return;
  const uid = m.from.id, text = m.text.trim(), admin = isAdmin(env, uid);
  const reply = (t, extra = {}) =>
    tg(env, 'sendMessage', { chat_id: uid, text: t, parse_mode: 'HTML', disable_web_page_preview: true, ...extra });
  const [cmdRaw, ...args] = text.split(/\s+/);
  const cmd = cmdRaw.startsWith('/') ? cmdRaw.slice(1).split('@')[0].toLowerCase() : '';

  const ref = cmd === 'start' && args[0]?.match(/^ref_(?:AT-)?(\d+)$/)?.[1];
  await env.DB.prepare('INSERT OR IGNORE INTO users (id, name, username, joined, referred_by) VALUES (?, ?, ?, ?, ?)')
    .bind(uid, m.from.first_name ?? '', m.from.username ?? null, now(), ref && ref !== String(uid) ? +ref : null).run();
  const user = await env.DB.prepare('SELECT banned, premium_until FROM users WHERE id = ?').bind(uid).first();

  if (cmd === 'start' || cmd === 'help')
    return reply('👋 Send me any TeraBox link and I will give you a ▶️ stream link — no waiting for downloads.');

  if (admin) {
    const id = +args[0];
    switch (cmd) {
      case 'stats': {
        const q = (sql, ...b) => env.DB.prepare(sql).bind(...b);
        const r = await env.DB.batch([
          q('SELECT COUNT(*) n FROM users'),
          q('SELECT COUNT(*) n FROM users WHERE premium_until > ?', now()),
          q('SELECT COUNT(*) n FROM views WHERE ts > ?', now() - 86400),
          q('SELECT COUNT(DISTINCT user_id) n FROM views WHERE ts > ?', now() - 86400),
        ]);
        const [users, prem, views, active] = r.map(x => x.results[0].n);
        return reply(`📊 Users: <b>${users}</b>\n💎 Premium: <b>${prem}</b>\n▶️ Links (24h): <b>${views}</b>\n👤 Active (24h): <b>${active}</b>`);
      }
      case 'ban': case 'unban':
        if (!id) return reply(`Usage: /${cmd} USER_ID`);
        await setUser(env, id, 'banned', cmd === 'ban' ? 1 : 0);
        return reply(`✅ ${cmd === 'ban' ? 'Banned' : 'Unbanned'} ${id}`);
      case 'premium': {
        const days = +args[1];
        if (!id || !(days >= 0)) return reply('Usage: /premium USER_ID DAYS  (0 = revoke)');
        await setUser(env, id, 'premium_until', days ? now() + days * 86400 : 0);
        return reply(days ? `💎 ${id} is premium for ${days} days` : `Premium revoked for ${id}`);
      }
      case 'jstoken':
        if (!args[0]) return reply('Usage: /jstoken NEW_TOKEN');
        await env.KV.put('jstoken', args[0]);
        return reply('✅ jsToken updated.');
      case 'maintenance':
        await env.KV.put('maintenance', args[0] === 'on' ? '1' : '0');
        return reply(`🔧 Maintenance ${args[0] === 'on' ? 'ON' : 'OFF'}`);
      case 'broadcast':
        if (!m.reply_to_message) return reply('Reply to the message you want to broadcast with /broadcast');
        await env.DB.prepare('INSERT INTO broadcasts (from_chat, msg_id) VALUES (?, ?)').bind(uid, m.reply_to_message.message_id).run();
        return reply('📣 Queued. Sends ~40 users/minute; you will be told when it finishes.');
    }
  }

  const link = text.match(LINK_RE)?.[0];
  if (!link) return reply('Send me a TeraBox link.');
  if (!admin && (await env.KV.get('maintenance')) === '1') return reply('🔧 Bot is under maintenance. Please try again later.');
  if (user?.banned) return reply('🚫 You are banned from using this bot.');

  for (const ch of list(env.FORCE_CHANNELS)) {
    const r = await tg(env, 'getChatMember', { chat_id: ch, user_id: uid });
    // fail open if the bot can't check (not admin in that channel)
    if (r.ok && !['creator', 'administrator', 'member'].includes(r.result.status) && !r.result.is_member)
      return reply(`Please join ${esc(ch)} then send the link again.`,
        ch.startsWith('@') ? { reply_markup: { inline_keyboard: [[{ text: '📢 Join', url: `https://t.me/${ch.slice(1)}` }]] } } : {});
  }

  const premium = admin || user?.premium_until > now();
  if (!premium) {
    const { n } = await env.DB.prepare('SELECT COUNT(*) n FROM views WHERE user_id = ? AND ts > ?').bind(uid, now() - HOUR).first();
    if (n >= +env.FREE_PER_HOUR) return reply(`You've reached your limit (${env.FREE_PER_HOUR} links/hour).\nUpgrade to 💎 Premium for unlimited.`);
  }

  const wait = await reply('🔍 Resolving…');
  const edit = (t, extra = {}) =>
    tg(env, 'editMessageText', { chat_id: uid, message_id: wait.result.message_id, text: t, parse_mode: 'HTML', ...extra });

  const code = shareCode(link);
  const d = code && (await resolve(env, code));
  const files = (d?.list || []).filter(f => f.fs_id && f.isdir != 1);
  if (!files.length) return edit('❌ Could not resolve this link. It may be dead, private, or a folder-only share.');

  const shown = files.slice(0, premium ? 20 : 1);
  const rows = await Promise.all(shown.map(async f => {
    const href = `${origin}/watch?s=${code}&f=${f.fs_id}&t=${await sig(env, `${code}:${f.fs_id}`)}`;
    const name = f.server_filename || 'video';
    return [{ text: `▶️ ${name.length > 40 ? name.slice(0, 37) + '…' : name}`, web_app: { url: href } }, { text: '🌐', url: href }];
  }));
  const lines = shown.map(f => `🎬 <code>${esc(f.server_filename)}</code> ${fmtSize(+f.size)}`);
  if (files.length > shown.length) lines.push(`\n➕ ${files.length - shown.length} more file(s) — 💎 Premium unlocks all.`);

  await env.DB.prepare('INSERT INTO views (user_id, surl, ts) VALUES (?, ?, ?)').bind(uid, code, now()).run();
  return edit(`${lines.join('\n')}\n\n▶️ = play in Telegram · 🌐 = open in browser`, { reply_markup: { inline_keyboard: rows } });
}

// ---------------- Cron: broadcast batches + pruning ---------------- //

async function tick(env) {
  const BATCH = 40; // free plan: 50 subrequests per invocation
  const b = await env.DB.prepare('SELECT * FROM broadcasts WHERE done = 0 ORDER BY id LIMIT 1').first();
  if (b) {
    const { results } = await env.DB.prepare('SELECT id FROM users WHERE id > ? AND banned = 0 ORDER BY id LIMIT ?').bind(b.cursor, BATCH).all();
    let sent = 0;
    for (const u of results)
      if ((await tg(env, 'copyMessage', { chat_id: u.id, from_chat_id: b.from_chat, message_id: b.msg_id })).ok) sent++;
    const done = results.length < BATCH;
    await env.DB.prepare('UPDATE broadcasts SET cursor = ?, sent = sent + ?, done = ? WHERE id = ?')
      .bind(results.at(-1)?.id ?? b.cursor, sent, done ? 1 : 0, b.id).run();
    if (done) await tg(env, 'sendMessage', { chat_id: b.from_chat, text: `📣 Broadcast #${b.id} finished — delivered to ${b.sent + sent} users.` });
  }
  await env.DB.prepare('DELETE FROM views WHERE ts < ?').bind(now() - 7 * 86400).run();
}

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    if (url.pathname === '/webhook' && req.method === 'POST') {
      if (req.headers.get('x-telegram-bot-api-secret-token') !== env.WEBHOOK_SECRET) return new Response('forbidden', { status: 403 });
      const update = await req.json();
      // ack Telegram immediately so it never retries; finish the work in the background
      ctx.waitUntil(onUpdate(env, url.origin, update).catch(e => console.log('update failed', e.stack)));
      return new Response('ok');
    }
    if (url.pathname === '/watch') return watch(url);
    if (url.pathname === '/m3u8') return m3u8(env, url);
    if (url.pathname === '/setup' && url.searchParams.get('key') === env.WEBHOOK_SECRET) {
      const hook = await tg(env, 'setWebhook', {
        url: `${url.origin}/webhook`, secret_token: env.WEBHOOK_SECRET, allowed_updates: ['message'], drop_pending_updates: true,
      });
      const cmds = await tg(env, 'setMyCommands', { commands: [{ command: 'start', description: 'Start the bot' }, { command: 'help', description: 'How to use' }] });
      return Response.json({ hook, cmds });
    }
    return new Response('Not found', { status: 404 });
  },
  async scheduled(_, env) {
    await tick(env);
  },
};
