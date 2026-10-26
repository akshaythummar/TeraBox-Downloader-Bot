// JS port of the Python bot (amazon-ktworker: main.py + commands/*). Same
// commands, texts and DB keys. Difference: a TeraBox link is answered with a
// stream link (own TeraBox resolver + HLS proxy worker) instead of download→upload→forward.

import { Button, md } from './tg.js';

// ---------------- constants (from main.py / tools.py) ---------------- //

const MAINTENANCE_KEY = 'maintenance_mode';
const FREE_MODE_KEY = 'videos_free_mode';
// const PLANS_PHOTO = 'https://iili.io/nXUjApR.md.png'; // old plans banner
const PLANS_PHOTO = 'https://i.postimg.cc/c4PN5MR0/Neon-Unlimited-Videos-Subscription-Plans.png';
const GC_LIST_PER_PAGE = 10;
const REF_DAYS = 1; // Premium days for every friend who joins
const REF_NEW_DAYS = 1; // Premium days the friend gets for joining with a link
const TIERS = [[10, 3], [25, 7], [50, 15]]; // extra bonus days at these referral counts

const DURATION_MAP_GC = { '1d': 1, '2d': 2, '3d': 3, '5d': 5, '7d': 7, '1w': 7, '2w': 14, '1m': 30, '1mo': 30, unlimited: 0, perm: 0 };
const DURATION_MAP = { '1d': 1, '2d': 2, '3d': 3, '5d': 5, '7d': 7, '1w': 7, '2w': 14, '1m': 30, '1mo': 30, unlimited: 0, 0: 0, perm: 0 };
// /dl <quality> → TeraBox HLS rendition (replaces the old ffmpeg re-encode)
const DL_QUALITY_MAP = { '144p': 'M3U8_AUTO_360', '240p': 'M3U8_AUTO_360', '360p': 'M3U8_AUTO_360', '480p': 'M3U8_AUTO_480', '720p': 'M3U8_AUTO_720', '1080p': 'M3U8_AUTO_1080' };
const DEFAULT_QUALITY = 'M3U8_AUTO_480';
const PHOTO_EXTENSIONS = new Set('.jpg .jpeg .png .webp .gif .bmp'.split(' '));
const PHOTO_URL_MAX = 5 * 1024 * 1024; // Telegram: sendPhoto by URL up to 5 MB (bigger goes as a file, up to 20 MB)
// Telegram's limit for sendVideo by URL, and TeraBox's CDN link by md5 (fixed params, from the old bot)
const VIDEO_URL_MAX = 20 * 1024 * 1024;
const cdnLink = md5 => `https://d8.freeterabox.com/file/${md5}?fid=4401480949283-250528-22673172449066&dstime=1709708137&rt=sh&sign=FDtAER-DCb740ccc5511e5e8fedcff06b081203-xKOOrUER%2B6l7qCouNxQTRYbUXx4%3D&expires=8h&chkv=0&chkbd=0&chkpc=&dp-logid=369036930199400835&dp-callid=0&r=799779934&sh=1&region=jp`;

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

Send me any **TeraBox link** and watch it in **~2 seconds** ⚡
No download, no waiting — it streams right here in Telegram.

🆓 Free: Unlimited streaming links
⭐ Premium: multi-file links + /videos
👥 Invite friends: **+1 day Premium** for you and +1 day for them → /ref

Choose an option below 👇
`;

// ---------------- admin commands: one list for the Admin Panel, /adcmd and the admins' "/" menu ---------------- //
// [command, what it does / usage, owner-only?]
export const ADMIN_HELP = [
  ['stats', '📊 Stats & Logs', [
    ['stats', 'Bot stats, top users, popular links'],
    ['funnel', 'Daily funnel: new users → trials → payments. /funnel 7'],
    ['userstats', 'A user\'s download stats: /userstats <id>'],
    ['logs', 'Recent bot log: /logs 50'],
    ['errors', 'Recent failures: /errors 20'],
    ['apihealth', 'TeraBox API + HLS proxy status'],
    ['auditlog', 'Admin action log: /auditlog 30', 1],
  ]],
  ['premium', '⭐ Premium', [
    ['pre', 'Give Premium: /pre <id> 7d (1d 2d 3d 5d 7d 1w 2w 1m unlimited)'],
    ['addpremium', 'Give Premium days: /addpremium <id> <days>'],
    ['renew', 'Renew / extend: /renew <id> <days>'],
    ['de', 'Remove Premium: /de <id>'],
    ['premium_users', 'List Premium users with expiry'],
    ['finduser', 'Look up a user: /finduser <id>'],
  ]],
  ['gc', '🎁 Gift Cards', [
    ['gen', 'Make cards with one-tap redeem links: /gen 1d 5 VIP'],
    ['gclist', 'All cards with status'],
    ['gctrack', 'Who redeemed: /gctrack 24h, /gctrack <user id>, /gctrack <code>'],
    ['gcheck', 'Check a card: /gcheck AT-XXXXXXXX'],
    ['gcdel', 'Delete an unused card: /gcdel AT-XXXXXXXX'],
    ['allowredeem', 'Let a user redeem another card: /allowredeem <id>', 1],
  ]],
  ['users', '👥 Users & Admins', [
    ['ban', 'Ban: /ban <id>'],
    ['unban', 'Unban: /unban <id>'],
    ['banned_users', 'List banned users'],
    ['settag', 'Set a tag: /settag <id> <tag>'],
    ['masstag', 'Tag many: /masstag <id1,id2> <tag>'],
    ['untag', 'Remove tags: /untag <id1,id2>'],
    ['remove', 'Reset a user\'s hourly link limit: /remove <id>'],
    ['addadmin', 'Add an admin: /addadmin <id>', 1],
    ['removeadmin', 'Remove an admin: /removeadmin <id>', 1],
    ['adminlist', 'List admins', 1],
  ]],
  ['bc', '📢 Broadcast', [
    ['broadcast', 'To all users: /broadcast <text>, or reply to any message — preview + confirm first', 1],
    ['broadcaststatus', 'Live progress of a broadcast', 1],
    ['stopbroadcast', 'Stop a running broadcast', 1],
    ['announce', 'Scheduled: /announce <minutes> <text>', 1],
    ['broadcast_legacy', 'Text broadcast without preview: /broadcast_legacy <text>'],
  ]],
  ['videos', '🎬 /videos & Plans', [
    ['videosfreemode', '/videos free for everyone: /videosfreemode on | off'],
    ['videosready', 'How many pre-uploaded videos are ready'],
    ['app', 'Videos Mini App (beta: admins + APP_TESTERS only until /configset VIDEOS_APP_PUBLIC 1)'],
    ['setcooldown', '/videos cooldown: /setcooldown <seconds>', 1],
    ['setplan', 'Text shown above the /plan menu: /setplan <text>', 1],
  ]],
  ['config', '⚙️ Settings & TeraBox', [
    ['configview', 'All runtime settings'],
    ['configset', 'Change one: /configset DAILY_FREE_VIDEOS 5 (also FREE_HOURLY_LIMIT, MAX_FILES_PER_REQUEST, VIDEOS_COOLDOWN_SECONDS, FORCE_CHANNELS)'],
    ['configreset', 'Back to default: /configreset <KEY>'],
    ['maintenance', 'Maintenance: /maintenance on [reason] | off'],
    ['setapi', 'TeraBox login: /setapi cookie <value> | jstoken <value> | proxy <url>'],
    ['reloadconfig', 'Reload the TeraBox settings'],
    ['maxfiles', 'Max files per link for free users: /maxfiles <n>', 1],
    ['setforce', 'Add a force-join channel: /setforce channel @name', 1],
    ['removeforce', 'Remove one: /removeforce channel @name', 1],
    ['panic', 'Emergency stop (maintenance on)', 1],
    ['resume', 'Back online (maintenance off)', 1],
  ]],
  ['backup', '💾 Backup', [
    ['backup', 'Full database backup as a file', 1],
    ['restore', 'Reply to a backup file to restore it', 1],
    ['logrotate', 'Clear the bot log'],
    ['restart', 'Show the system card (build, maintenance)', 1],
  ]],
];

// Telegram "/" menu for each admin: the user commands + the admin ones they may use. Shown only to
// them (chat scope). Errors are ignored (Telegram refuses it for someone who never opened the bot).
export const COMMANDS = [
  ['start', 'Start the bot'], ['app', '🎬 Videos App — swipe like Reels'], ['help', 'Main menu'], ['info', 'Your info & plan'], ['plan', 'Buy Premium / plans'], ['top', 'Top inviters'],
  ['redeem', 'Redeem a gift card'], ['ref', 'Invite friends, earn Premium'], ['mystats', 'Your statistics'],
  ['mystatus', 'Premium / tag / stats'], ['history', 'Your history'], ['search', 'Search the library'],
  ['videos', 'Videos'], ['lang', 'Language'],
].map(([command, description]) => ({ command, description }));
export async function setAdminMenus(api, env, db, only = null) {
  const owner = +env.OWNER_ID;
  const ids = only ? [only] : [...new Set([owner, ...String(env.ADMINS || '').split(',').map(Number).filter(Boolean), ...(await db.all('SELECT id FROM users WHERE admin = 1')).map(r => r.id)])];
  for (const id of ids) {
    const admin = ADMIN_HELP.flatMap(([, , cmds]) => cmds.filter(c => !c[2] || id === owner)).map(([command, d]) => ({ command, description: `⚙️ ${d}`.slice(0, 256) }));
    await api.call('setMyCommands', { commands: [...COMMANDS, ...admin], scope: { type: 'chat', chat_id: id } });
  }
}

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
// /s/<code> links carry the full code; ?surl=<x> links drop its leading "1", which TeraBox's API needs
export const shareCode = u => {
  const s = String(u).match(/\/s\/([\w-]+)/);
  if (s) return s[1];
  const q = String(u).match(/surl=([\w-]+)/);
  return q ? (q[1].startsWith('1') && q[1].length > 22 ? q[1] : `1${q[1]}`) : null;
};
const getUrl = s => (String(s || '').match(/https?:\/\/\S+/g) || []).find(u => URL_RE.test(u)) || null;
// every TeraBox link in a message, one per share code
const getUrls = s => [...new Map((String(s || '').match(/https?:\/\/\S+/g) || []).filter(u => URL_RE.test(u)).map(u => [shareCode(u) || u, u])).values()];
const MAX_LINKS = 3; // ponytail: per message, each link costs ~10 calls of the free plan's 50; raise on Workers Paid
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
    const rows = await db.all("SELECT key, value FROM store WHERE key IN ('terabox_cfg:jstoken', 'terabox_cfg:cookie', 'terabox_cfg:proxy')");
    const o = Object.fromEntries(rows.map(r => [r.key.split(':')[1], r.value]));
    return { jstoken: o.jstoken || env.JSTOKEN || '', cookie: o.cookie || env.TB_COOKIE || '', proxy: (o.proxy || env.HLS_PROXY).replace(/\/$/, '') };
  });
}

// ---- own resolver: TeraBox's share API, no third-party worker ----
// GET /api/shorturlinfo returns the same {errno, shareid, uk, sign, timestamp, list} the old
// resolver worker relayed. TeraBox answers "need verify_v2" (errno 400210) without a browser
// session cookie (TB_COOKIE secret, or /setapi cookie). An expired jsToken is refreshed from the
// share page (at most once per 5 min) and saved, so stream URLs use the new one too.
// all serve the same API; the session cookie is for 1024terabox.com, the others are fallbacks
// (they often answer "need verify", errno 400141, from Cloudflare IPs).
const TB_HOSTS = ['www.1024terabox.com', 'www.terabox.app', 'www.terabox.com', 'www.1024tera.com'];
const TB_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';
const tbHeaders = cfg => ({ 'User-Agent': TB_UA, Accept: 'application/json, text/plain, */*', 'Accept-Language': 'en-IN,en;q=0.9', ...(cfg.cookie ? { Cookie: cfg.cookie } : {}) });
let lastTokenRefresh = 0;
const TB_DEAD = new Set([105, -3, -9, 2, 115, -70, 9019, 400210]); // bad/expired/removed link, or no cookie (400210)
const TB_VERIFY = new Set([400141]); // "need verify": this IP/domain is challenged, a new token won't help

async function shareInfo(cfg, code) {
  // The cookie belongs to 1024terabox.com, so that domain is asked first; if it hasn't answered with
  // a verdict within 700ms, the other domains are asked in parallel. The first verdict wins (a
  // working answer, or a dead-link errno); "need verify" answers are ignored while others are pending.
  const ctrl = new AbortController();
  const ask = host => fetch(`https://${host}/api/shorturlinfo?app_id=250528&web=1&channel=dubox&clienttype=0&jsToken=${cfg.jstoken}&shorturl=${encodeURIComponent(code)}&root=1`,
    { headers: tbHeaders(cfg), signal: AbortSignal.any([ctrl.signal, AbortSignal.timeout(6000)]) })
    .then(r => r.text()).then(t => { try { return JSON.parse(t); } catch { return { errno: 'bad-json', errmsg: t.slice(0, 120) }; } })
    .catch(e => ({ errno: e.name, errmsg: e.message }));
  const verdict = d => d.errno === 0 || TB_DEAD.has(d.errno);
  let last = null;
  const answers = [];
  const settle = new Promise(res => {
    let pending = 0, started = false;
    const launch = host => {
      pending++;
      ask(host).then(d => {
        pending--;
        answers.push(`${host}:${d.errno}`);
        if (verdict(d)) return res(d);
        last = d;
        if (!started) startRest();
        if (!pending && started) res(last);
      });
    };
    const startRest = () => { if (started) return; started = true; TB_HOSTS.slice(1).forEach(launch); };
    launch(TB_HOSTS[0]);
    setTimeout(startRest, 700);
  });
  const d = await settle;
  ctrl.abort();
  if (d?.errno !== 0) console.log(`resolver ${code}: ${answers.join(' ')}`);
  return d;
}

// a fresh jsToken from the share page (the page embeds it as fn("…") in a script)
async function refreshJsToken(cfg, db, code) {
  if (Date.now() - lastTokenRefresh < 300000) return null;
  lastTokenRefresh = Date.now();
  try {
    const r = await fetch(`https://${TB_HOSTS[0]}/sharing/link?surl=${encodeURIComponent(code.replace(/^1/, ''))}`, { headers: tbHeaders(cfg), signal: AbortSignal.timeout(5000) });
    const m = (await r.text()).match(/fn%28%22([0-9A-F]{64,})%22%29/);
    if (!m || m[1] === cfg.jstoken) return null;
    await db.set('terabox_cfg:jstoken', m[1]);
    uncache('tbcfg');
    console.log('jsToken refreshed from the share page');
    return m[1];
  } catch (e) {
    console.log('jsToken refresh failed:', e.message);
    return null;
  }
}

export async function resolveShare(cfg, code, db) {
  let d = await shareInfo(cfg, code);
  if (d?.errno === 0 && d.list?.length) return d;
  console.log(`resolver ${code}: errno=${d?.errno} ${d?.errmsg || d?.show_msg || ''}`);
  // a dead/expired/removed link is final; any other error may be a stale token: retry once with a fresh one
  const tok = db && d && typeof d.errno === 'number' && !TB_DEAD.has(d.errno) && !TB_VERIFY.has(d.errno) ? await refreshJsToken(cfg, db, code) : null;
  if (tok) {
    d = await shareInfo({ ...cfg, jstoken: tok }, code);
    if (d?.errno === 0 && d.list?.length) return d;
    console.log(`resolver ${code} (new jsToken): errno=${d?.errno} ${d?.errmsg || d?.show_msg || ''}`);
  }
  return null;
}

// Resolver results are reused for 30 min: repeat links skip the ~3s resolver call and
// the player starts faster. A stream URL from a 10-min-old resolve was verified to still
// play; /m3u8 re-resolves fresh if a cached one ever fails.
// Also kept in isolate memory, so a link and its /m3u8 plays usually skip D1 entirely.
const SHARE_TTL = 1800;
const shareMem = new Map(); // code → [slim, expires ms]
export async function resolveCached(env, db, code, fresh = false) {
  const key = `tbshare:${code}`;
  if (!fresh) {
    const m = shareMem.get(code);
    if (m && m[1] > Date.now()) return { ...m[0], cached: true };
    const hit = await db.get(key);
    if (hit) return { ...JSON.parse(hit), cached: true };
  }
  const d = await resolveShare(await teraboxCfg(env, db), code, db);
  if (d) {
    const slim = { shareid: d.shareid, uk: d.uk, sign: d.sign, timestamp: d.timestamp, list: d.list.map(i => ({ fs_id: i.fs_id, server_filename: i.server_filename, size: i.size, md5: i.md5 })) };
    if (shareMem.size > 500) shareMem.clear(); // ponytail: crude bound, fine for one isolate's traffic
    shareMem.set(code, [slim, Date.now() + SHARE_TTL * 1000]);
    await db.set(key, JSON.stringify(slim), { ex: SHARE_TTL }).catch(e => console.log('share cache', e.message));
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

  // logs table: kind 'bot' (/logs, /errors, panel) ~500 kept, 'audit' (/auditlog) 1000 kept
  async function addLog(kind, line, keep) {
    try {
      await db.run('INSERT INTO logs (kind, line) VALUES (?, ?)', kind, line);
      // ponytail: trim 1 in 20 writes, keeps roughly `keep` lines
      if (Math.random() < 0.05) await db.run('DELETE FROM logs WHERE kind = ?1 AND id < (SELECT id FROM logs WHERE kind = ?1 ORDER BY id DESC LIMIT 1 OFFSET ?2)', kind, keep);
    } catch (e) { console.log('log write failed:', e.message); }
  }
  const logx = line => { console.log(line); return addLog('bot', `${ymdHMS()} [INFO] ${line}`, 500); };
  // newest first
  const readLogs = async (kind, n) => (await db.all('SELECT line FROM logs WHERE kind = ? ORDER BY id DESC LIMIT ?', kind, n)).map(r => r.line);

  // --- runtime config (store 'config_overrides' = JSON object, like /configset in Python) ---
  const csv = s => String(s || '').split(',').map(x => x.trim()).filter(Boolean);
  const overrides = async () => { try { return JSON.parse((await db.get('config_overrides')) || '{}'); } catch { return {}; } };
  const runtime = () => cached('cfg', async () => {
    const o = await overrides();
    return {
      MAX_FILES_PER_REQUEST: int(o.MAX_FILES_PER_REQUEST ?? 10),
      VIDEOS_COOLDOWN_SECONDS: parseFloat(o.VIDEOS_COOLDOWN_SECONDS ?? env.VIDEOS_COOLDOWN_SECONDS ?? 1) || 0,
      FREE_HOURLY_LIMIT: int(o.FREE_HOURLY_LIMIT ?? 0),
      DAILY_FREE_VIDEOS: int(o.DAILY_FREE_VIDEOS ?? env.VIDEOS_DAILY_FREE ?? 5),
      // /videos messages are deleted from the chat after this many hours (0 = never; Telegram allows ≤48)
      VIDEO_DELETE_HOURS: Math.min(int(o.VIDEO_DELETE_HOURS ?? env.VIDEO_DELETE_HOURS ?? 24), 47),
      VIDEOS_APP_PUBLIC: int(o.VIDEOS_APP_PUBLIC ?? env.VIDEOS_APP_PUBLIC ?? 0), // 0 = the Videos Mini App is for admins only
      APP_LOG_CHAT: csv(o.APP_LOG_CHAT ?? env.APP_LOG_CHAT), // where the Videos App's live session log goes (default the owner; 0 = off)
      APP_TESTERS: csv(o.APP_TESTERS ?? env.APP_TESTERS), // user IDs who get the app before it's public — as normal users (free limit, paywall)
      FORCE_CHANNELS: csv(o.FORCE_CHANNELS ?? env.FORCE_CHANNELS),
      FORCE_GROUPS: csv(o.FORCE_GROUPS ?? env.FORCE_GROUPS),
    };
  });
  async function setOverride(key, value) {
    const o = await overrides();
    if (value == null) delete o[key]; else o[key] = String(value);
    await db.set('config_overrides', JSON.stringify(o));
    uncache('cfg');
  }

  // --- users / admins / premium (main.py) — all in the users row ---
  const urow = async uid => (await db.user(uid)) || {};
  const isAdmin = async uid => ADMINS.includes(int(uid)) || cached(`admin:${uid}`, async () => (await urow(uid)).admin === 1);
  const isBanned = uid => cached(`banned:${uid}`, async () => (await urow(uid)).banned === 1);
  const getAllAdmins = () => cached('admins', async () => [...new Set([...ADMINS, ...(await db.all('SELECT id FROM users WHERE admin = 1')).map(r => r.id)])], 60);

  // adds days on top of any Premium the user already has (grantPremium starts from now)
  async function addPremiumDays(uid, days) {
    const cur = int((await urow(uid)).premium_until);
    await db.setUser(uid, { premium_until: Math.max(Math.floor(nowS()), cur) + days * 86400, reminded: null });
    uncache(`premium:${uid}`);
  }
  async function grantPremium(uid, days) {
    await db.setUser(uid, { premium_until: Math.floor(nowS()) + days * 86400, reminded: null });
    uncache(`premium:${uid}`);
  }
  async function revokePremium(uid) {
    const keepTag = int(uid) === OWNER_ID || (await isAdmin(uid));
    await db.run(`UPDATE users SET premium_until = NULL${keepTag ? '' : ', tag = NULL'} WHERE id = ?`, int(uid));
    uncache(`premium:${uid}`);
  }
  const isPremium = uid => cached(`premium:${uid}`, async () => {
    const exp = (await urow(uid)).premium_until;
    if (exp == null) return false;
    if (nowS() >= exp) { await revokePremium(uid); return false; }
    return true;
  });
  const premiumRemaining = async uid => Math.max(int((await urow(uid)).premium_until) - Math.floor(nowS()), 0);

  async function getCustomTag(uid) {
    const tag = (await urow(uid)).tag;
    if (int(uid) === OWNER_ID) { if (!tag) await setCustomTag(uid, 'OWNER'); return tag || 'OWNER'; }
    if (await isAdmin(uid)) { if (!tag) await setCustomTag(uid, 'ADMIN'); return tag || 'ADMIN'; }
    if (!(await isPremium(uid))) { if (tag) await db.run('UPDATE users SET tag = NULL WHERE id = ?', int(uid)); return ''; }
    return tag || '';
  }
  const setCustomTag = (uid, tag) => db.setUser(uid, { tag });

  const logAudit = (action, admin, details = '') => addLog('audit', JSON.stringify({ action, admin, details, time: ymdHMS() }), 1000);
  // MAINTENANCE_OFF=true (deploy var) forces it off without a D1 write — for when D1 refuses writes
  const maintOff = String(env.MAINTENANCE_OFF) === 'true';
  const isMaintenance = () => !maintOff && cached('maint', async () => (await db.get(MAINTENANCE_KEY)) === '1');
  async function setMaintenance(on, reason = '') {
    if (on) {
      await db.set(MAINTENANCE_KEY, '1');
      if (reason) await db.set(`${MAINTENANCE_KEY}:reason`, reason);
      else await db.del(`${MAINTENANCE_KEY}:reason`);
    } else await db.del(MAINTENANCE_KEY, `${MAINTENANCE_KEY}:reason`);
    uncache('maint');
    return on;
  }
  // a user row's download stats under the field names the texts used (user_stats_<id> hash)
  const statsOf = u => ({ attempts: u.dl_attempts, total: u.dl_ok, success: u.dl_ok, failed: u.dl_failed, storage: u.dl_bytes, last_activity: u.last_activity });
  const getMaintenance = async () => [!maintOff && (await db.get(MAINTENANCE_KEY)) === '1', (await db.get(`${MAINTENANCE_KEY}:reason`)) || ''];


  async function isUserOnChat(chat, uid) {
    const r = await api.call('getChatMember', { chat_id: chat, user_id: uid });
    return !!r.ok && (['creator', 'administrator', 'member'].includes(r.result.status) || (r.result.status === 'restricted' && r.result.is_member));
  }

  // commands/analytics.py track_download + history (+ the FREE_HOURLY_LIMIT window) as ONE users-row
  // write; totals and popular links go to the in-memory counters (counters day 'link').
  // files = files sent, failedN = sends that failed, g = gate() result when the caller has it.
  async function recordLink(uid, { files = [], failedN = 0, link, g = null, hourly = 0 }) {
    const n = files.length;
    if (!n && !failedN) return;
    const f = { dl_attempts: ['+', n + failedN] };
    if (failedN) f.dl_failed = ['+', failedN];
    if (n) {
      const history = g ? g.history : (await db.one('SELECT history FROM users WHERE id = ?', int(uid)))?.history;
      const list = history ? JSON.parse(history) : [];
      for (const x of files) list.push(JSON.stringify({ file: x.file_name, size: x.size, time: ymdHMS() }));
      Object.assign(f, { dl_ok: ['+', n], dl_bytes: ['+', files.reduce((a, x) => a + x.sizebytes, 0)], last_activity: ymdHMS(), history: JSON.stringify(list.slice(-50)) });
      db.bump('total_downloads', n);
      if (link) db.bump(String(link).slice(0, 120), n, 'link');
    }
    // only when /configset FREE_HOURLY_LIMIT is on: links sent in the current hour
    if (hourly && g) Object.assign(f, g.countExp > nowS() ? { hourly_n: g.count + 1 } : { hourly_n: 1, hourly_until: Math.floor(nowS()) + 3600 });
    await db.setUser(uid, f).catch(e => console.log('recordLink', e.message));
  }

  // daily funnel counters (counters day = IST date) — see /funnel
  const funnel = (field, n = 1) => db.bump(field, n, ymd());

  // commands/library.py index_file — stream entries carry s(urlcode)/f(fid) instead of a
  // storage message id. One read + one batched write for any number of files.
  async function libIndex(files) {
    const byNorm = new Map();
    for (const f of files.slice(0, 90)) { const n = normalizeName(f.file_name); if (n) byNorm.set(n, [...(byNorm.get(n) || []), f]); }
    if (!byNorm.size) return;
    const norms = [...byNorm.keys()];
    const rows = await db.all(`SELECT name, entries FROM library WHERE name IN (${norms.map(() => '?').join(',')})`, ...norms);
    const have = Object.fromEntries(rows.map(r => [r.name, JSON.parse(r.entries)]));
    const rows2 = [];
    for (const [norm, fs] of byNorm) {
      const entries = have[norm] || [];
      const fresh = fs.filter(f => !entries.some(e => e.s === f.code && e.f === f.fid));
      if (!fresh.length) continue;
      for (const f of fresh) entries.push({ s: f.code, f: f.fid, name: f.file_name.slice(0, 120), size: f.size, bytes: f.sizebytes, ...(f.md5 ? { m: f.md5 } : {}) });
      rows2.push([norm, JSON.stringify(entries.slice(-5))]);
    }
    // multi-row upserts: one statement per 45 rows (D1 allows 100 bound params per statement)
    for (let i = 0; i < rows2.length; i += 45) {
      const chunk = rows2.slice(i, i + 45);
      await db.run(`INSERT INTO library (name, entries) VALUES ${chunk.map(() => '(?, ?)').join(', ')} ON CONFLICT (name) DO UPDATE SET entries = excluded.entries`, ...chunk.flat());
    }
  }

  // --- TeraBox files ---
  async function getFiles(url) {
    const code = shareCode(url);
    if (!code) return false;
    const d = await resolveCached(env, db, code);
    if (!d) { await logx(`Resolver worker error for ${code}`); return false; }
    const files = d.list.filter(i => i.fs_id).map(i => ({
      file_name: sanitize(i.server_filename || 'video.mp4'), fid: String(i.fs_id), sizebytes: +i.size || 0, md5: /^[0-9a-f]{32}$/.test(i.md5) ? i.md5 : null,
      size: +i.size ? fmtSize(+i.size) : 'Unknown', code,
    }));
    return files.length ? files : false;
  }

  // Everything the link handler checks: the user's row + maintenance, in one D1 query.
  async function gate(uid) {
    const r = await db.one('SELECT u.*, (SELECT value FROM store WHERE key = ?) maint FROM (SELECT 1) LEFT JOIN users u ON u.id = ?', MAINTENANCE_KEY, int(uid));
    const now = nowS(), exp = r.premium_until;
    const windowOn = r.hourly_until > now;
    return {
      maintenance: !maintOff && r.maint === '1',
      banned: r.banned === 1,
      admin: ADMINS.includes(int(uid)) || r.admin === 1,
      premium: exp != null && now < exp,
      expired: exp != null && now >= exp,
      count: windowOn ? r.hourly_n : 0,
      countExp: windowOn ? r.hourly_until : 0,
      thumb: r.thumb || null,
      history: r.history,
      refPending: r.ref_pending === 1,
    };
  }

  // r = who shared it (the player's "open the bot" / share buttons credit them)
  async function watchUrl(code, fid, q, r = 0) {
    q ||= DEFAULT_QUALITY;
    return `${origin}/watch?s=${code}&f=${fid}&q=${q}&t=${await sign(env.WEBHOOK_SECRET, `${code}:${fid}:${q}`)}${int(r) ? `&r=${int(r)}` : ''}`;
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
  // A file up to 20 MB is first sent as the video itself, with the same caption and Watch buttons
  // under it: Telegram fetches it from TeraBox's CDN by md5 (the old Telebot Creator link; the
  // other params are fixed). Telegram only fetches URLs up to 20 MB. If that fails (file not on
  // that CDN, Telegram error) the normal stream post goes out instead, so the user always gets one.
  // sharer = the user the post is for: the Share button carries their referral credit
  async function sendStream(chatId, isPrivate, f, caption, q, userThumb, tryVideo = true, sharer = 0) {
    const href = await watchUrl(f.code, f.fid, q, sharer);
    const share = await videoShare(f.code, f.fid, sharer);
    const buttons = [[isPrivate ? Button.webapp('▶️ Watch Online', href) : Button.url('▶️ Watch Online', href)], [Button.url('🌐 Open in Browser', href)], ...(share ? [[Button.url('📤 Share this video', share)]] : [])];
    if (tryVideo && f.md5 && f.sizebytes > 0 && f.sizebytes <= VIDEO_URL_MAX) {
      // a file_id Telegram already gave us for this file is instant; the CDN link is the fallback
      const known = (await db.one('SELECT file_id FROM videos WHERE md5 = ?', f.md5).catch(() => null))?.file_id;
      for (const video of known ? [known, cdnLink(f.md5)] : [cdnLink(f.md5)]) {
        const r = await api.call('sendVideo', { chat_id: chatId, video, caption: md(caption), parse_mode: 'HTML', has_spoiler: SPOILER, supports_streaming: true, reply_markup: { inline_keyboard: buttons } });
        if (!r.ok) continue;
        const fid = r.result?.video?.file_id || r.result?.document?.file_id;
        if (fid && fid !== known) await db.run('INSERT INTO videos (md5, file_id) VALUES (?, ?) ON CONFLICT (md5) DO UPDATE SET file_id = excluded.file_id', f.md5, fid).catch(() => {});
        return true;
      }
    }
    if (userThumb) {
      const r = await api.call('sendPhoto', { chat_id: chatId, photo: userThumb, caption: md(caption), parse_mode: 'HTML', has_spoiler: SPOILER, reply_markup: { inline_keyboard: buttons } });
      if (r.ok) return true;
    }
    return !!(await api.send(chatId, caption, { buttons }));
  }

  // A photo in a link: Telegram fetches it from TeraBox's CDN by md5, like the videos (≤5 MB as a photo,
  // ≤20 MB as a file). Returns false when it can't (no md5, too big, not on that CDN).
  async function sendImage(chatId, f, caption) {
    if (!f.md5 || !(f.sizebytes > 0) || f.sizebytes > VIDEO_URL_MAX) return false;
    const asPhoto = f.sizebytes <= PHOTO_URL_MAX;
    const r = await api.call(asPhoto ? 'sendPhoto' : 'sendDocument', { chat_id: chatId, [asPhoto ? 'photo' : 'document']: cdnLink(f.md5), caption: md(caption), parse_mode: 'HTML' });
    return !!r.ok;
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

  const appButton = async chatId => (chatId > 0 && origin && (await runtime()).VIDEOS_APP_PUBLIC === 1 ? [Button.webapp('🎬 Videos App — swipe like Reels', `${origin}/app`)] : null);
  const mainMenuButtons = async (uid, chatId) => {
    const app = await appButton(chatId);
    const rows = [
      ...(app ? [app] : []),
      [Button.inline('👥 Invite Friends → Free Premium', 'menu_referral')],
      [Button.inline('📥 How to Use', 'menu_howto'), Button.inline('📋 My Info', 'menu_info')],
      [Button.inline('⭐ Premium', 'menu_premium'), Button.inline('🎁 Redeem Card', 'menu_redeem')],
    ];
    if (ADMINS.includes(int(uid))) rows.push([Button.inline('⚙️ Admin Panel', 'menu_admin')]);
    rows.push(
      [Button.inline('🛠 Tools', 'menu_tools'), Button.inline('🌐 Language', 'menu_lang')],
      [Button.inline('📊 My Stats', 'menu_mystats')],
      [Button.url('📣 Channel', 'https://t.me/AT_BOTZ'), Button.url('💬 Group', 'https://t.me/AT_BOTZ')],
    );
    return rows;
  };
  const welcome = name => WELCOME_TEXT.replace('{name}', name);

  on(/^(\/cmds|\/help)/, async m => m.reply(welcome(m.from.first_name), { buttons: await mainMenuButtons(m.uid, m.chatId) }));

  on(/^\/ping/, async m => {
    const t0 = Date.now();
    const msg = await m.reply('🖥️ Connection Status\nCommand: `/ping`\nResponse Time: Calculating...');
    await msg.edit(`🖥️ Connection Status\nCommand: \`/ping\`\nResponse Time: ${((Date.now() - t0) / 1000).toFixed(2)} seconds`);
  });

  // ==================== gift cards ====================
  // t.me/<bot>?start=gc_<code>: one tap opens the bot and redeems (no copy-paste); /start handles it
  const redeemLink = async code => `https://t.me/${(await api.me()).username || 'YourBot'}?start=gc_${code}`;
  const giftcardButtons = async codes => Promise.all(codes.slice(0, 25).map(async c => [Button.url(`🎁 Redeem ${c}`, await redeemLink(c))]));
  const redeemLine = async c => `🎁 [Redeem ${c}](${await redeemLink(c)}) · \`/redeem ${c}\``;

  on(/^\/gen\s+(\S+)(?:\s+(\d+))?(?:\s+(.+))?/, async (m, g) => {
    const dur = g[1].toLowerCase(), count = int(g[2] || 1), tag = (g[3] || '').trim();
    if (count > 50) return m.reply('Max 50 codes at once.');
    if (!(dur in DURATION_MAP_GC))
      return m.reply(`Invalid duration: \`${dur}\`\n\nValid: \`${Object.keys(DURATION_MAP_GC).join(', ')}\`\n\n**Usage:** \`/gen <duration> [count] [tag]\`\nExamples:\n- \`/gen 7d 5\` — 5 cards, 7 days\n- \`/gen 7d 5 VIP\` — 5 cards, 7 days, VIP tag\n- \`/gen unlimited 1 PREMIUM\` — 1 card, permanent, PREMIUM tag`);
    const days = DURATION_MAP_GC[dur], codes = [];
    const st = [];
    for (let i = 0; i < count; i++) {
      const code = `AT-${uuid8()}`;
      st.push(db.q('INSERT INTO gift_cards (code, days, tag) VALUES (?, ?, ?) ON CONFLICT (code) DO NOTHING', code, days, tag || null));
      codes.push(code);
    }
    await db.batch(st);
    const label = days > 0 ? `${days} day(s)` : 'Permanent (Unlimited)';
    const lines = await Promise.all(codes.map(async c => `${await redeemLine(c)}${tag ? ` (Tag: ${tag})` : ''}`));
    await m.reply(`**${count} Gift Card(s) Generated**\n\nDuration: **${label}**${tag ? `\nTag: **${tag}**` : ''}\n\n**Send these to users** (one tap on a link redeems it):\n${lines.join('\n')}`, { buttons: await giftcardButtons(codes) });
  }, ADMIN);

  async function gcItems(withTags) {
    // available first, then used (same order as before)
    return (await db.all('SELECT code, days, tag, used_by FROM gift_cards ORDER BY used_by IS NOT NULL')).map(r => ({
      code: r.code, status: r.used_by == null ? 'available' : 'used', label: r.days === 0 ? 'Permanent' : `${r.days}d`, user: r.used_by ?? '?', tag: (withTags && r.tag) || '',
    }));
  }
  async function gcPage(items, page) {
    const pages = Math.max(1, Math.ceil(items.length / GC_LIST_PER_PAGE));
    page = Math.min(page, pages);
    const start = (page - 1) * GC_LIST_PER_PAGE;
    const avail = items.filter(i => i.status === 'available').length;
    const lines = await Promise.all(items.slice(start, start + GC_LIST_PER_PAGE).map(async (it, i) => {
      const t = it.tag ? ` (${it.tag})` : '';
      return it.status === 'available' ? `${start + i + 1}. ${await redeemLine(it.code)} — ${it.label}${t} [Available]` : `${start + i + 1}. \`${it.code}\` — ${it.label}${t} [Used by \`${it.user}\`]`;
    }));
    const text = `**Gift Cards** (${items.length} total)\nAvailable: ${avail} | Used: ${items.length - avail}\nPage ${page}/${pages}\n\n${lines.join('\n')}`;
    const nav = [];
    if (page > 1) nav.push(Button.inline('◀️ Prev', `gcpage_${page - 1}_${items.length}`));
    if (page < pages) nav.push(Button.inline('Next ▶️', `gcpage_${page + 1}_${items.length}`));
    return [text, [...(nav.length ? [nav] : []), [Button.inline('Refresh', `gcpage_${page}_${items.length}`)]]];
  }
  on(/^\/gclist/, async m => {
    const items = await gcItems(false);
    if (!items.length) return m.reply('No gift cards found.');
    const [text, buttons] = await gcPage(items, 1);
    await m.reply(text, { buttons });
  }, ADMIN);
  onCb(/^gcpage_/, async e => {
    if (!(await isAdmin(e.uid))) return e.answer('Access denied!', true);
    const p = e.data.split('_');
    if (!int(p[1])) return e.answer('Invalid callback data.', true);
    const [text, buttons] = await gcPage(await gcItems(true), int(p[1]));
    await e.edit(text, { buttons });
  });

  on(/^\/gcdel\s+(\S+)/, async (m, g) => {
    const code = g[1].toUpperCase();
    await m.reply((await db.run('DELETE FROM gift_cards WHERE code = ? AND used_by IS NULL', code)) ?`Deleted \`${code}\`.` : `Code \`${code}\` not found.`);
  }, ADMIN);

  const gcTrackButtons = [[Button.inline('Last 1h', 'gctrack_1h'), Button.inline('Last 24h', 'gctrack_24h'), Button.inline('Last 7d', 'gctrack_7d')], [Button.inline('All', 'gctrack_all')]];
  async function gcTrack(filter, allowIdFilters) {
    const used = await db.all('SELECT code, days, used_by, used_at FROM gift_cards WHERE used_by IS NOT NULL');
    const now = Math.floor(nowS()), results = [];
    for (const { code, days: d, used_by: ub, used_at: ts } of used) {
      const uid = String(ub);
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
    return [text, used.length];
  }
  on(/^\/gctrack(?:\s+(\S+))?/, async (m, g) => {
    if (!(await db.one('SELECT 1 FROM gift_cards WHERE used_by IS NOT NULL LIMIT 1'))) return m.reply('No redeemed gift cards found.');
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
    const u = await urow(uid);
    if (u.gc_redeemed === 1 && (await isPremium(uid)))
      return [false, `⭐ **You already have Premium** (${premiumLeft(u.premium_until - Math.floor(nowS()))}).\n\nOnly **1 gift card** can be redeemed while Premium is active — try again after it ends.`, null];
    // claimed in one statement, so two users pressing at once can't both get it
    const card = await db.one('UPDATE gift_cards SET used_by = ?, used_at = ? WHERE code = ? AND used_by IS NULL RETURNING days, tag', int(uid), Math.floor(nowS()), code);
    if (!card) {
      const c = await db.one('SELECT used_by FROM gift_cards WHERE code = ?', code);
      return [false, !c ? `❌ **Gift card \`${code}\` doesn't exist.**\nCheck the code and try again.`
        : c.used_by === int(uid) ? '✅ **You already redeemed this gift card.**\nYour Premium is on your account — see /plan.'
        : `😕 **Too late — gift card \`${code}\` was already claimed by someone else.**\n\nStay in the channel for the next drop, or get free Premium by inviting friends: /ref`, null];
    }
    const days = card.days, tag = card.tag || '';
    await db.setUser(uid, { gc_redeemed: 1 });
    if (tag) await setCustomTag(uid, tag);
    await grantPremium(uid, days === 0 ? 99999 : days);
    const tagInfo = tag ? `\nTag: **${tag}**` : '';
    const text = '🎉🎉 **GIFT CARD REDEEMED!** 🎉🎉\n\n' + (days === 0
      ? `⭐ **Premium: Permanent** (never expires)${tagInfo}`
      : `⭐ **Premium activated: ${days} day(s)**\n⏰ Expires: **${dmyHM(Math.floor(nowS()) + days * 86400)}**${tagInfo}`) +
      '\n\n✅ Unlimited /videos · multi-file links · folders · custom thumbnail\n👉 Send /videos to start watching!';
    return [true, text, { code, days, tag }];
  }
  // after a redeem: success → plan status; failure → ways to still get Premium
  const redeemButtons = ok => (ok ? [[Button.inline('⭐ My Premium', 'vid_plans')], [Button.inline('🏠 Main menu', 'menu_main')]]
    : [[Button.inline('👥 Free Premium: invite friends', 'menu_referral')], [Button.inline('💳 Buy Premium', 'vid_plans')], [Button.inline('🏠 Main menu', 'menu_main')]]);
  const identityBlock = (first, last, username, uid) => `\n\nRedeemed by: ${`${first || ''} ${last || ''}`.trim() || '-'} (${username ? `@${username}` : '@-'})\nID: \`${uid}\``;
  // a name the admin can tap to open the user's profile, even without a username
  const userLink = (uid, name) => `<a href="tg://user?id=${int(uid)}">${escHtml(name || 'User')}</a>`;
  async function notifyRedeem(uid, from, info) {
    const tagMsg = info.tag ? `\nTag: ${info.tag}` : '';
    for (const a of await getAllAdmins())
      await api.send(a, `Gift Card Redeemed!\nUser: ${userLink(uid, from.first_name)} (@${escHtml(from.username || '-')})\nID: <code>${uid}</code>\nCode: <code>${info.code}</code>\nDuration: ${info.days}d${escHtml(tagMsg)}`, { html: true });
  }

  on(/^\/redeem\s+(\S+)/, async (m, g) => {
    let [ok, text, info] = await redeemCode(m.uid, g[1]);
    if (ok) text += identityBlock(m.from.first_name || '-', m.from.last_name, m.from.username, m.uid);
    await m.reply(text, { buttons: redeemButtons(ok) });
    if (ok && info) await notifyRedeem(m.uid, m.from, info);
  });
  // commands/ux.py one-click gift-card button
  onCb(/^redeem_/, async e => {
    const code = e.data.split('redeem_')[1]?.trim().toUpperCase();
    if (!code) return e.answer('Invalid code.', true);
    let [ok, text, info] = await redeemCode(e.uid, code);
    await e.answer(ok ? '🎉 Redeemed! Premium activated' : 'Not redeemed — see the message', !ok);
    if (ok) text += identityBlock(e.from.first_name || '-', e.from.last_name, e.from.username, e.uid);
    if (ok && info) await notifyRedeem(e.uid, e.from, info);
    if (!(await api.send(e.uid, text, { buttons: redeemButtons(ok) }))) await e.reply(text, { buttons: redeemButtons(ok) });
  });

  on(/^\/allowredeem\s+(\d+)/, async (m, g) => {
    await db.run('UPDATE users SET gc_redeemed = 0 WHERE id = ?', int(g[1]));
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
  // the broadcast list = every user row (a full count; only used when a broadcast is queued)
  const userCount = async () => (await db.one('SELECT COUNT(*) n FROM users')).n;
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
    await queueBroadcast({ kind: 'legacy', mode: 'text', text, total: await userCount(), status_chat: m.chatId, status_msg: status.id });
  }, ADMIN);

  // ==================== /start ====================
  on(/^\/start/, async m => {
    const uid = m.uid, name = m.from.first_name;
    const arg = m.text.split(/\s+/)[1];
    // shared video link: v_<code>_<fid>_<sharer> (the code may contain _, the two numbers can't)
    const vm = arg?.match(/^v_([\w-]+)_(\d+)_(\d+)$/);
    const ref = arg?.startsWith('ref_AT-') ? int(arg.split('ref_AT-')[1]) : vm ? int(vm[3]) : 0;
    let refPending = false;
    if (ref > 0 && (await recordReferral(ref, uid))) {
      // the referrer is rewarded only once this user has joined the force channels
      const missing = await missingChannels(uid);
      if (!missing.length) await confirmReferral(uid, name);
      else {
        refPending = true;
        await api.send(ref, `👋 **${escapeMarkdown(name)}** opened your link!\n\n⏳ Your +${REF_DAYS} day Premium is added as soon as they join ${missing.join(', ')}.`);
      }
    }
    // (the user row — the broadcast list — was already created by index.js trackActivity)
    await funnel('starts');
    // gift card link (t.me/<bot>?start=gc_<code>): redeem straight away and answer before anything else
    if (arg?.startsWith('gc_')) {
      const [ok, text, info] = await redeemCode(uid, arg.slice(3));
      await m.reply(text, { buttons: redeemButtons(ok) });
      if (ok && info) await notifyRedeem(uid, m.from, info);
    }
    // the shared video first (it handles the force-join prompt itself)
    if (vm) await handleMessage({ ...m, text: `https://www.terabox.com/s/${vm[1]}`, deep: arg }, null, vm[2]);
    const admins = await getAllAdmins();
    // only a user's very first /start (gift / shared-video links and their buttons send /start again)
    if (m.raw._newUser && !admins.includes(uid))
      for (const a of admins) await api.send(a, `👤 New user started bot:\nName: ${userLink(uid, name)}\nUsername: @${escHtml(m.from.username || '-')}\nID: <code>${uid}</code>`, { html: true });
    const planArg = /^plan_\d+$/.test(arg || '');
    if (!arg?.startsWith('gc_') && !vm && !planArg) await m.reply(welcome(name), { buttons: await mainMenuButtons(uid, m.chatId) });
    if (refPending && !vm) await sendJoinPrompt(m.chatId, await missingChannels(uid));
    else if (arg === 'plans' && planViewHook) await planViewHook(m.chatId, uid); // t.me/<bot>?start=plans
    else if (planArg && buyPlanHook) { await funnel('app_buy'); await buyPlanHook(m.chatId, uid, m.from, int(arg.slice(5))); }
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
    const raw = (await urow(e.uid)).history;
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
      status = rem > 9000000 ? '♾️ **Permanent Premium**' : `⏰ **Active** — ${Math.floor(rem / 86400)}d ${Math.floor((rem % 86400) / 3600)}h left (expires ${dmyHM(Math.floor(nowS()) + rem)})`;
    }
    const subActive = +(await urow(e.uid)).sub_until > nowS();
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
${subActive ? '✅ Your paid plan is active.' : '💳 Buy Premium below 👇'}
`, { buttons: [...(planViewHook && !subActive ? [[Button.inline('💳 Buy Premium / See plans', 'vid_plans')]] : []), [Button.inline('🎁 Redeem Gift Card', 'menu_redeem')], [Button.inline('◀️ Back', 'menu_main')]] });
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
    const h = statsOf(await urow(e.uid));
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
    await db.setUser(e.uid, { lang: code });
    await e.answer(`Language set to ${LANGUAGES[code] || 'English'}!`);
    await e.edit(welcome(e.from.first_name), { buttons: await mainMenuButtons(e.uid, e.chatId) });
  });
  onCb(/^menu_main$/, async e => e.edit(welcome(e.from.first_name), { buttons: await mainMenuButtons(e.uid, e.chatId) }));

  // ==================== admin panel ====================
  const adminCb = (re, fn) => onCb(re, async e => ((await isAdmin(e.uid)) ? fn(e) : e.answer('Access denied!', true)));

  adminCb(/^menu_admin$/, e => e.edit('┏━━━━━━━━━━━━━━━━━⍟\n┃  ⚙️ 𝐀𝐝𝐦𝐢𝐧 𝐏𝐚𝐧𝐞𝐥\n┗━━━━━━━━━━━━━━━━━━━━━⍟\n\nPick a section — each one lists its commands with examples.\n💡 Tip: type **/** in this chat — admin commands are in the menu (⚙️).', { buttons: [
    [Button.inline('📊 Live stats', 'admin_stats'), Button.inline('🔧 Maintenance', 'admin_maint')],
    ...ADMIN_HELP.reduce((rows, [key, title], i) => (i % 2 ? rows[rows.length - 1].push(Button.inline(title, `ah_${key}`)) : rows.push([Button.inline(title, `ah_${key}`)]), rows), []),
    [Button.inline('🩺 API Health', 'admin_api'), Button.inline('🧩 Current settings', 'admin_config')],
    [Button.inline('📋 All commands', 'ah_all'), Button.inline('◀️ Back', 'menu_main')],
  ] }));
  // one section's commands (owner-only ones marked 👑, hidden from other admins)
  const helpLines = (cmds, uid) => cmds.filter(c => !c[2] || int(uid) === OWNER_ID).map(([c, d, o]) => `${o ? '👑 ' : ''}/${c} — ${escapeMarkdown(d)}`);
  adminCb(/^ah_\w+$/, async e => {
    const key = e.data.slice(3);
    if (key === 'all') return e.edit(adcmdText(e.uid).slice(0, 4000), { buttons: back('menu_admin') });
    const sec = ADMIN_HELP.find(([k]) => k === key);
    if (!sec) return e.answer('Unknown section', true);
    await e.edit(`**${sec[1]}**\n\n${helpLines(sec[2], e.uid).join('\n')}${int(e.uid) === OWNER_ID ? '\n\n👑 = owner only' : ''}`, { buttons: back('menu_admin') });
  });
  const adcmdText = uid => '┏━━━━━━━━━━⍟\n┃ 𝘼𝙙𝙢𝙞𝙣 𝘾𝙤𝙢𝙢𝙖𝙣𝙙𝙨\n┗━━━━━━━━━━━━━━━━━⍟\n\n' +
    ADMIN_HELP.map(([, title, cmds]) => { const l = helpLines(cmds, uid); return l.length ? `**── ${title} ──**\n${l.join('\n')}` : ''; }).filter(Boolean).join('\n\n');

  // admin_stats + /stats: counters (day 'all'), active premium, banned, unused gift cards, users seen today
  async function botTotals() {
    const today = Number(ymd().replace(/-/g, '')) * 100;
    await db.flush(true); // include this isolate's not-yet-written counters
    const r = await db.one(`SELECT
        (SELECT json_group_object(name, n) FROM counters WHERE day = 'all') s,
        (SELECT COUNT(*) FROM users WHERE premium_until > ?) prem,
        (SELECT COUNT(*) FROM users WHERE banned = 1) banned,
        (SELECT COUNT(*) FROM gift_cards WHERE used_by IS NULL) gc,
        (SELECT COUNT(DISTINCT uid) FROM activity WHERE hour >= ?) active`, Math.floor(nowS()), today);
    return { ...r, s: JSON.parse(r.s || '{}') };
  }
  adminCb(/^admin_stats$/, async e => {
    const { s, prem, banned, gc, active } = await botTotals();
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
    for (const [name, url] of [['terabox_api', `https://${TB_HOSTS[0]}/api/shorturlinfo?app_id=250528&web=1&channel=dubox&clienttype=0&shorturl=1x&root=1`], ['hls_proxy', cfg.proxy]]) {
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
    VIDEOS_COOLDOWN_SECONDS: { section: 'Limits', kind: 'int', min: 0, max: 300 },
    FREE_HOURLY_LIMIT: { section: 'Limits', kind: 'int', min: 0, max: 1000 },
    DAILY_FREE_VIDEOS: { section: 'Limits', kind: 'int', min: 0, max: 50 },
    VIDEO_DELETE_HOURS: { section: 'Limits', kind: 'int', min: 0, max: 47 },
    VIDEOS_APP_PUBLIC: { section: 'Limits', kind: 'int', min: 0, max: 1 },
    APP_TESTERS: { section: 'Limits', kind: 'csv' },
    APP_LOG_CHAT: { section: 'Limits', kind: 'csv' },
    FORCE_CHANNELS: { section: 'Force Join', kind: 'csv' },
    FORCE_GROUPS: { section: 'Force Join', kind: 'csv' },
  };
  const BLOCKED = new Set(['BOT_TOKEN', 'API_ID', 'API_HASH', 'TURSO_DB_URL', 'TURSO_AUTH_TOKEN', 'PRIVATE_CHAT_ID', 'OWNER_ID', 'ADMINS', 'TERABOX_JSTOKEN', 'TB_COOKIE', 'TERABOX_HLS_PROXY_WORKER']);
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

  // ==================== user mgmt / plans ====================
  on(/^\/remove (.*)/, async (m, g) => {
    if (await db.run('UPDATE users SET hourly_n = 0, hourly_until = NULL WHERE id = ? AND hourly_until > ?', int(g[1]), Math.floor(nowS()))) { await m.reply(`Removed ${g[1]} from the list.`); }
    else await m.reply(`${g[1]} is not in the list.`);
  }, ADMIN);

  // the plain plans text: used when /videos (the payment worker) isn't set up or its plans can't be loaded
  const planText = async () => (await db.get('custom_plan_text')) || `
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

👥 Free Premium: /ref · 🎁 Gift card: /redeem
`;
  const premiumLeft = rem => (rem > 9000000 ? '♾️ Permanent' : `till ${dmyHM(Math.floor(nowS()) + rem)}`);
  // /plan, /plans: status + the buy menu (private chat); groups get a button to the bot's chat
  on(/^\/plans?\b/, async m => {
    if (!m.isPrivate) return m.reply('💳 Plans and payments are in private chat 👇', { buttons: [[Button.url('💳 See plans', `https://t.me/${await botName()}?start=plans`)]] });
    if (planViewHook) return planViewHook(m.chatId, m.uid);
    await m.reply(await planText());
  });

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
    const all = (await db.all('SELECT id FROM users WHERE premium_until IS NOT NULL ORDER BY premium_until')).map(r => r.id);
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
    await db.run('UPDATE users SET premium_until = NULL, reminded = NULL WHERE premium_until IS NOT NULL');
    CACHE.clear();
    await m.reply('All premium users demoted successfully.');
  }, ADMIN);

  // ==================== the link handler (handle_message) ====================
  // pickFid: send only that file of the link (a shared video); m.deep: the start param to come back to
  async function handleMessage(m, quality = null, pickFid = null) {
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
    // no cooldown on links — only /videos has one (VIDEOS_COOLDOWN_SECONDS)
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
      g.expired ? revokePremium(m.uid) : null,
    ]);
    if (joined) {
      const join = chanUrl(joined) ? [[Button.url(`📣 Join ${joined}`, chanUrl(joined))]] : [];
      if (!m.deep) return hm.edit(`Please join ${joined} then send me the link again.`, { buttons: join });
      return hm.edit(`📢 Join ${joined} to watch this video, then tap the button below 👇`, { buttons: [...join, [Button.url('✅ Joined — get the video', `https://t.me/${await botName()}?start=${m.deep}`)]] });
    }
    if (g.refPending) await confirmReferral(m.uid, m.from.first_name).catch(e => console.log('confirmReferral', e.message));

    let files = await filesP;
    if (!files) return hm.edit(ERRORS.api_unavailable);
    if (pickFid) { const one = files.filter(f => f.fid === String(pickFid)); if (one.length) files = one; }
    if (files.length > rt.MAX_FILES_PER_REQUEST && !g.premium)
      return hm.edit(`⚠️ This link has **${files.length} files**.\nFree users can download max **${rt.MAX_FILES_PER_REQUEST}** files.\nUpgrade to **Premium** for unlimited.`);

    const todo = g.premium ? files : files.slice(0, 1);
    const hourly = free ? rt.FREE_HOURLY_LIMIT : 0;
    if (todo.length === 1) {
      const f = todo[0], ext = extOf(f.file_name);
      if (PHOTO_EXTENSIONS.has(ext)) {
        if (!(await sendImage(m.chatId, f, cardCaption(f, m.from, tag, null)))) return hm.edit(`Sorry! Couldn't fetch this photo (${f.size}). Photos up to 20 MB are supported — open it on TeraBox: ${url}`);
        await Promise.all([hm.edit(`✅ Photo sent ⚡`, { buttons: [[Button.url('📤 Share & get Premium', await refShare(m.uid))]] }), funnel('links'), recordLink(m.uid, { files: [f], link: shorturl, g, hourly })]);
        return;
      }
      if (!VIDEO_EXTENSIONS.has(ext))
        return hm.edit(`Sorry! File type \`${ext}\` is not supported.\nSupported: videos (${[...VIDEO_EXTENSIONS].slice(0, 8).join(', ')}…) and photos (${[...PHOTO_EXTENSIONS].join(', ')}).`);
      const took = `${((Date.now() - T0) / 1000).toFixed(1)}s`;
      if (!(await sendStream(m.chatId, m.isPrivate, f, cardCaption(f, m.from, tag, took), quality, g.thumb, true, m.uid))) {
        await recordLink(m.uid, { failedN: 1, g });
        return hm.edit(`Sorry! Download Failed but you can download it from [here](${url}).`, { buttons: [] });
      }
      console.log(`link ${shorturl} posted in ${Date.now() - T0}ms`);
      await Promise.all([
        hm.edit(`✅ Ready in ${((Date.now() - T0) / 1000).toFixed(1)}s ⚡\n\n🎁 Share the bot: every friend who joins = **+${REF_DAYS} day Premium** for you (and +${REF_NEW_DAYS} day for them)`, { buttons: [[Button.url('📤 Share & get Premium', await refShare(m.uid))]] }),
        funnel('links'),
        recordLink(m.uid, { files: [f], link: shorturl, g, hourly }), libIndex([f]),
      ]);
      return;
    }
    const [sent, failed] = await sendMany(m, todo, tag, quality, shorturl, g.thumb, g, hourly);
    if (sent) await funnel('links');
    await hm.edit(`✅ Complete!\nSent: ${sent}/${todo.length} | Failed: ${failed}`, { buttons: [] });
  }

  // multi-file / folder: one stream post per video
  // ponytail: 15 posts per message keeps one request under the free plan's 50 subrequests
  // (each post can cost 2 Telegram calls); the rest are listed so the user can open them.
  const MAX_POSTS = 15;
  async function sendMany(m, todo, tag, quality, link, thumb = null, g = null, hourly = 0) {
    const ok = [];
    let failed = 0, sendFails = 0;
    const videos = todo.filter(f => VIDEO_EXTENSIONS.has(extOf(f.file_name)));
    const photos = todo.filter(f => PHOTO_EXTENSIONS.has(extOf(f.file_name)));
    failed += todo.length - videos.length - photos.length;
    // ponytail: photos of a folder: the first 5 (each is one Telegram call)
    for (const f of photos.slice(0, 5)) { if (await sendImage(m.chatId, f, cardCaption(f, m.from, tag, null))) ok.push(f); else { failed++; sendFails++; } }
    failed += Math.max(photos.length - 5, 0);
    for (const [i, f] of videos.slice(0, MAX_POSTS).entries()) {
      // ponytail: video files only for the first 5 (each try can cost 2 Telegram calls + 2 D1 queries)
      if (await sendStream(m.chatId, m.isPrivate, f, cardCaption(f, m.from, tag, null), quality, thumb, i < 5, m.uid)) ok.push(f);
      else { failed++; sendFails++; }
    }
    const rest = videos.slice(MAX_POSTS);
    if (rest.length) await m.reply(`➕ ${rest.length} more video(s) in this link:\n${rest.slice(0, 40).map(f => `• \`${captionName(f.file_name)}\``).join('\n')}\n\nUse /search <name> to open them.`);
    await Promise.all([
      recordLink(m.uid, { files: ok, failedN: sendFails, link, g, hourly }),
      libIndex([...ok, ...rest]),
    ]);
    return [ok.length, failed];
  }

  on(/^\/cleandownloads/, m => m.reply('Downloads folder does not exist. Nothing to clean.'), ADMIN);

  on(/^\/mystatus/, async m => {
    const tag = await getCustomTag(m.uid), u = await urow(m.uid), h = statsOf(u);
    const exp = u.premium_until;
    const prem = exp ? `🟡 Premium expires in ${Math.max(Math.floor((parseFloat(exp) - nowS()) / 86400), 0)} days` : '🆓 Free user';
    await m.reply(`**👤 Your Status**\n\n💰 **Premium:** ${prem}\n${tag ? `🏷 Tag: **${tag}**` : '🏷 No custom tag'}\n📊 **Download Stats:**\n` +
      `• Total downloads: **${int(h.total)}**\n• Total storage: **${fmtSize(int(h.storage))}**\n• Last activity: **${h.last_activity || 'Never'}**\n\n💡 Use /plan to check premium plans, /tag to manage your tag.`);
  });

  // ==================== owner: server ops (Workers equivalents) ====================
  async function bootCard(chatId) {
    const boots = await db.incr('boot_count');
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

  on(/^\/adcmd/, async m => m.reply(adcmdText(m.uid).slice(0, 4000)), ADMIN);

  on(/^\/history/, async m => {
    const raw = (await urow(m.uid)).history;
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
    await db.setUser(m.uid, { thumb: photo.file_id });
    await m.reply('✅ Custom thumbnail set!\nIt will be used on your downloads.');
  });
  on(/^\/removethumb/, async m => { await db.run('UPDATE users SET thumb = NULL WHERE id = ?', m.uid); await m.reply('✅ Custom thumbnail removed.'); });

  on(/^\/lang(?:\s+(\w+))?/, async (m, g) => {
    const code = g[1]?.toLowerCase();
    if (!code || !(code in LANGUAGES))
      return m.reply(`**Select Language:**\n\n${Object.entries(LANGUAGES).map(([k, v]) => `\`${k}\` — ${v}`).join('\n')}\n\nUsage: \`/lang ne\``);
    await db.setUser(m.uid, { lang: code });
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
    const [sent, failed] = await sendMany(m, files, await getCustomTag(m.uid), null, url, (await urow(m.uid)).thumb);
    await hm.edit(`✅ Folder complete!\nSent: ${sent}/${files.length} | Failed: ${failed}`, { buttons: [] });
  });

  on(/^\/banned_users/, async m => {
    const banned = (await db.all('SELECT id FROM users WHERE banned = 1')).map(r => r.id);
    if (!banned.length) return m.reply('No banned users.');
    const lines = [];
    for (const uid of banned) { const n = await nameOf(uid); lines.push(`• ${n ? n[0] : 'Unknown'} (@${n ? n[1] : '-'}) — \`${uid}\``); }
    await m.reply(`**Banned Users (${lines.length}):**\n\n${lines.join('\n')}`.slice(0, 4000));
  }, ADMIN);

  on(/^\/usage/, m => m.reply('**Bot Resource Usage**\n\n**Disk:** N/A\n**RAM:** N/A\n**Downloads:** 0 files (0MB) — streaming only\n**Platform:** Cloudflare Workers\n**Uptime:** serverless (always on)\n'), ADMIN);

  on(/^\/logs(?:\s+(\d+))?/, async (m, g) => {
    const lines = await readLogs('bot', Math.min(int(g[1] || 20), 100));
    if (!lines.length) return m.reply('Log file is empty.');
    await m.reply('```\n' + lines.reverse().join('\n').slice(-3000) + '\n```');
  }, ADMIN);

  on(/^\/setplan\s+(.*)/s, async (m, g) => { await db.set('custom_plan_text', g[1]); await m.reply(`Plan text updated:\n\n${g[1]}`); }, OWNER);

  // Python sent this to channel -1001336746488's members; Bot API → the bot's known users.
  on(/^\/announce\s+(\d+)\s+(.*)/s, async (m, g) => {
    const minutes = int(g[1]);
    if (minutes > 1440) return m.reply('Max 1440 minutes (24 hours).');
    await m.reply(`Announcement scheduled in ${minutes} minute(s).`);
    await queueBroadcast({ kind: 'announce', mode: 'text', text: g[2], send_at: Math.floor(nowS()) + minutes * 60, total: await userCount(), status_chat: m.chatId, status_msg: m.id });
  }, OWNER);

  on(/^\/panic/, async m => {
    await db.set(MAINTENANCE_KEY, '1'); uncache('maint');
    await logAudit('PANIC_STOP', m.uid, 'Emergency stop activated');
    await m.reply('🚨 **EMERGENCY STOP ACTIVATED**\n\nAll download services are now **STOPPED**.\nUsers will see: `Bot under maintenance`\n\nUse `/resume` to bring bot back online.');
  }, OWNER);
  on(/^\/resume/, async m => {
    await db.del(MAINTENANCE_KEY, `${MAINTENANCE_KEY}:reason`); uncache('maint');
    await logAudit('RESUME', m.uid, 'Bot resumed from panic/maintenance');
    await m.reply('✅ **Bot is back online!** All services resumed.');
  }, OWNER);

  on(/^\/auditlog(?:\s+(\d+))?/, async (m, g) => {
    const entries = await readLogs('audit', Math.min(int(g[1] || 15), 50));
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
    await setOverride('VIDEOS_COOLDOWN_SECONDS', int(g[1]));
    await logAudit('SET_COOLDOWN', m.uid, `/videos cooldown set to ${int(g[1])}s`);
    await m.reply(`✅ /videos cooldown set to **${int(g[1])} seconds**.
(Links have no cooldown.)`);
  }, OWNER);

  on(/^\/addadmin\s+(\d+)/, async (m, g) => {
    const uid = int(g[1]);
    if (uid === OWNER_ID) return m.reply('Cannot remove owner from admin.');
    if (await isAdmin(uid)) return m.reply(`User \`${uid}\` is already an admin.`);
    await db.setUser(uid, { admin: 1 }); uncache(`admin:${uid}`); uncache('admins');
    await setAdminMenus(api, env, db, uid); // their "/" menu gets the admin commands
    await logAudit('ADD_ADMIN', m.uid, `Added user ${uid}`);
    const n = await nameOf(uid);
    await m.reply(n ? `✅ **Admin Added!**\n\n**Name:** ${n[0]}\n**Username:** @${n[1]}\n**ID:** \`${uid}\`` : `✅ Admin \`${uid}\` added (user not found for name).`);
  }, OWNER);
  on(/^\/removeadmin\s+(\d+)/, async (m, g) => {
    const uid = int(g[1]);
    if (uid === OWNER_ID) return m.reply('Cannot remove owner from admin.');
    if (ADMINS.includes(uid)) return m.reply(`❌ Cannot remove \`${uid}\` — they are a **config admin**.\nEdit ADMINS in wrangler.toml to remove them.`);
    if ((await urow(uid)).admin !== 1) return m.reply(`User \`${uid}\` is not an admin.`);
    await db.run('UPDATE users SET admin = 0 WHERE id = ?', uid); uncache(`admin:${uid}`); uncache('admins');
    await api.call('deleteMyCommands', { scope: { type: 'chat', chat_id: uid } }); // back to the normal "/" menu
    await logAudit('REMOVE_ADMIN', m.uid, `Removed user ${uid}`);
    await m.reply(`✅ Admin \`${uid}\` removed.`);
  }, OWNER);
  on(/^\/adminlist/, async m => {
    const lines = [];
    for (const uid of ADMINS) { const n = await nameOf(uid); lines.push(n ? `• ${n[0]} (@${n[1]}) — \`${uid}\` 🔒 Config` : `• Unknown — \`${uid}\` 🔒 Config`); }
    for (const { id: uid } of await db.all('SELECT id FROM users WHERE admin = 1')) {
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
    const uid = g[1], banned = (await urow(uid)).banned === 1, prem = await isPremium(uid);
    const rem = prem ? await premiumRemaining(uid) : 0, tag = await getCustomTag(int(uid)), n = await nameOf(uid);
    const premTxt = prem ? (rem > 9000000 ? 'Permanent' : `Premium (${Math.floor(rem / 86400)}d ${Math.floor((rem % 86400) / 3600)}h left)`) : 'Free';
    await m.reply(`**User \`${uid}\`**\n${n ? n[0] : 'Unknown'} (@${n ? n[1] : '-'})\n• Status: ${banned ? 'Banned' : 'Active'}\n• ${premTxt}\n• ${tag ? `Tag: **${tag}**` : 'No tag'}`);
  }, ADMIN);
  on(/^\/ban\s+(\d+)/, async (m, g) => { await db.setUser(g[1], { banned: 1 }); uncache(`banned:${g[1]}`); await m.reply(`Banned user \`${g[1]}\`.`); }, ADMIN);
  on(/^\/unban\s+(\d+)/, async (m, g) => { await db.run('UPDATE users SET banned = 0 WHERE id = ?', int(g[1])); uncache(`banned:${g[1]}`); await m.reply(`Unbanned user \`${g[1]}\`.`); }, ADMIN);
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
    const card = await db.one('SELECT days, tag, used_by FROM gift_cards WHERE code = ?', code);
    const days = card ? String(card.days) : null, t = card?.tag ? `\nTag: **${card.tag}**` : '';
    if (card?.used_by != null) return m.reply(`\`${code}\` — **USED** by \`${card.used_by}\`.${t}`);
    if (days == null) return m.reply(`\`${code}\` — invalid or unknown.`);
    await m.reply(`\`${code}\` — **VALID** (${days !== '0' ? `${days} day(s)` : 'Permanent'}).${t}`);
  }, ADMIN);
  on(/^\/untag\s+([\d,\s;]+)/, async (m, g) => {
    const ids = parseIds(g[1]);
    if (!ids.length) return m.reply('**Usage:** `/untag <id1,id2..>`');
    await db.run(`UPDATE users SET tag = NULL WHERE id IN (${ids.map(() => '?').join(',')})`, ...ids);
    await m.reply(`Untagged ${ids.length}/${ids.length}.`);
  }, ADMIN);

  // ==================== commands/analytics.py ====================
  on(/^\/stats/, async m => {
    const [{ s, active, prem, banned, gc }, topRows, links] = await Promise.all([
      botTotals(),
      db.all('SELECT id, dl_ok n FROM users WHERE dl_ok > 0 ORDER BY dl_ok DESC LIMIT 5'), // ponytail: scans all users; admin-only, fine
      db.all("SELECT name, n FROM counters WHERE day = 'link' ORDER BY n DESC LIMIT 3").then(rows => rows.map(r => [r.name, r.n])),
    ]);
    const lines = ['**Bot Statistics**', '', `**Total Downloads:** ${int(s.total_downloads)}`, `**Total Users:** ${int(s.total_users)}`,
      `**Active Today:** ${int(active)}`, `**Premium Users:** ${prem}`, `**Banned Users:** ${banned}`, `**Gift Cards:** ${gc}`, `**Library Hits:** ${int(s.lib_hits)}`, '', '**Top 5 Users:**'];
    if (!topRows.length) lines.push('__No user data yet.__');
    for (const [i, r] of topRows.entries()) {
      const uid = r.id, u = await api.user(uid);
      let name = u ? `${u.first_name || ''} ${u.last_name || ''}`.trim() : '';
      if (u?.username) name = `${name} (@${u.username})`.trim();
      lines.push(`${i + 1}. ${name ? `${name} \`${uid}\`` : `\`${uid}\``} — ${r.n} downloads`);
    }
    if (links.length) { lines.push('', '**Popular Links:**'); links.forEach(([l, n], i) => lines.push(`${i + 1}. \`${l}\` — ${Math.floor(n)} downloads`)); }
    lines.push('', '📈 Daily funnel (users → trials → payments): /funnel');
    await m.reply(lines.join('\n'));
  }, ADMIN);
  // /funnel [days] — the daily counters from funnel(): who arrives, uses the bot, tries, pays
  on(/^\/funnel(?:\s+(\d+))?/, async (m, g) => {
    const days = Math.min(Math.max(int(g[1] || 7), 1), 31);
    const keys = Array.from({ length: days }, (_, i) => ymdHMS(nowS() - i * 86400).slice(0, 10));
    await db.flush(true);
    const rows = await db.all(`SELECT day, name, n FROM counters WHERE day IN (${keys.map(() => '?').join(',')})`, ...keys);
    const by = {};
    for (const r of rows) (by[r.day] ??= {})[r.name] = r.n;
    const F = ['new_users', 'starts', 'links', 'referrals', 'videos', 'trials', 'plans_shown', 'orders', 'paid', 'revenue', 'app_videos', 'app_wall', 'app_buy', 'app_dl'];
    const tot = Object.fromEntries(F.map(f => [f, keys.reduce((a, k) => a + (by[k]?.[f] || 0), 0)]));
    const pct = (a, b) => (b ? `${Math.round((a / b) * 100)}%` : '-');
    const lines = keys.map(k => {
      const d = by[k] || {};
      return `\`${k.slice(5)}\` 👤${d.new_users || 0} 🔗${d.links || 0} 👥${d.referrals || 0} 🎬${d.videos || 0} 🎁${d.trials || 0} 🛒${d.orders || 0} 💰${d.paid || 0} ₹${d.revenue || 0}`;
    });
    await m.reply(
      `**📈 Funnel — last ${days} day(s)**\n\n` +
      `👤 New users: **${tot.new_users}** (starts: ${tot.starts})\n` +
      `🔗 Links streamed: **${tot.links}**\n` +
      `👥 Referrals: **${tot.referrals}**\n` +
      `🎬 /videos sent: **${tot.videos}**\n` +
      `📱 Videos App: **${tot.app_videos}** videos served · 🔒 paywall ${tot.app_wall} · 💳 plan taps ${tot.app_buy} · ⬇️ downloads ${tot.app_dl}\n` +
      `🎁 Trials started: **${tot.trials}** (${pct(tot.trials, tot.new_users)} of new users)\n` +
      `📋 Plans shown: **${tot.plans_shown}**\n` +
      `🛒 Orders created: **${tot.orders}** (${pct(tot.orders, tot.plans_shown)} of plan views)\n` +
      `💰 Paid (verified): **${tot.paid}** (${pct(tot.paid, tot.orders)} of orders)\n` +
      `₹ Revenue (verified): **₹${tot.revenue}**\n\n` +
      `**Per day:**\n${lines.join('\n')}\n\n` +
      '__Paid counts users who pressed Verify; payments activated without it show in the payment worker only.__'
    );
  }, ADMIN);
  on(/^\/userstats(?:\s+(\d+))?/, async (m, g) => {
    const target = g[1] ? int(g[1]) : m.uid, u = await urow(target), h = statsOf(u), tag = u.tag;
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
    const errs = (await readLogs('bot', 500)).reverse().filter(l => /ERROR|Error|Failed|failed|Traceback/.test(l)).slice(-n);
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
    const n = await db.run("DELETE FROM logs WHERE kind = 'bot'");
    const text = `Rotated bot_log (${n} lines), kept 0 file(s).`;
    await logAudit('LOGROTATE', m.uid, text);
    await m.reply(text);
  }));
  const short = (t, n = 160) => { t = t == null ? '-' : String(t); return t.length <= n ? t : t.slice(0, n) + '...'; };
  const reloadText = c => `Reloaded TeraBox config without restart.\njsToken: \`${short(c.jstoken ? c.jstoken.slice(0, 10) + '...' : '')}\`\nCookie: \`${c.cookie ? `set (${c.cookie.length} chars)` : 'NOT SET'}\`\nHLS proxy worker: \`${short(c.proxy)}\``;
  on(/^\/setapi\s+(jstoken|cookie|proxy)\s+(\S.*)$/s, denyUnlessAdmin(async (m, g) => {
    const slot = g[1].toLowerCase(), value = g[2].trim();
    if (slot === 'proxy' && !value.startsWith('http'))
      return m.reply('Usage: `/setapi <jstoken|cookie|proxy> <value>`\n`proxy` must be a worker URL starting with http; `cookie` is the TeraBox browser cookie string.');
    await db.set(`terabox_cfg:${slot}`, slot === 'proxy' ? value.replace(/\/$/, '') : value);
    uncache('tbcfg');
    await logAudit('SETAPI', m.uid, slot === 'cookie' ? 'cookie updated' : `${slot}=${value.slice(0, 120)}`);
    await m.reply(reloadText(await teraboxCfg(env, db)));
  }));
  on(/^\/reloadconfig$/, denyUnlessAdmin(async m => {
    uncache('tbcfg');
    const c = await teraboxCfg(env, db);
    await logAudit('RELOADCONFIG', m.uid, JSON.stringify({ cookie: !!c.cookie, proxy: c.proxy }).slice(0, 200));
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
    await setOverride(arg, null);
    await logAudit('CONFIGRESET', m.uid, arg);
    const rt = await runtime();
    await m.reply(`\`${arg}\` reset to default (${Array.isArray(rt[arg]) ? rt[arg].join(', ') : rt[arg]}).`);
  }, ADMIN);

  // ==================== commands/backup.py ====================
  // Full snapshot of the tables that can't be rebuilt (users with premium/tags/stats/history, gift
  // cards, settings, counters, /videos file_ids, library, audit log) as one JSON file.
  const B_TABLES = { users: ['id'], gift_cards: ['code'], store: ['key'], counters: ['day', 'name'], videos: ['md5'], library: ['name'], logs: ['id'] };
  const B_WHERE = { store: 'WHERE expires_at IS NULL', logs: "WHERE kind = 'audit'" };
  on(/^\/backup$/, async m => {
    const msg = await m.reply('Backing up the database...');
    try {
      await db.flush(true);
      const data = { version: 2, time: ymdHMS(), tables: {} };
      for (const t of Object.keys(B_TABLES)) data.tables[t] = await db.all(`SELECT * FROM ${t} ${B_WHERE[t] || ''}`);
      const counts = Object.entries(data.tables).map(([t, rows]) => `${t}: ${rows.length}`).join(' | ');
      const form = new FormData();
      form.append('chat_id', String(m.chatId));
      form.append('caption', md(`**Database Backup** (${data.time})\n${counts}\nRestore: reply to this file with \`/restore\``));
      form.append('parse_mode', 'HTML');
      form.append('document', new Blob([JSON.stringify(data)], { type: 'application/json' }), `backup-${data.time.slice(0, 10)}.json`);
      const r = await (await fetch(`${env.TG_API || 'https://api.telegram.org'}/bot${env.BOT_TOKEN}/sendDocument`, { method: 'POST', body: form })).json();
      if (!r.ok) throw new Error(r.description);
      await msg.delete();
    } catch (e) { await msg.edit(`Backup failed: \`${e.message}\``); }
  }, OWNER);
  // Merges a /backup file back (existing rows are overwritten). Rows go in as JSON chunks through
  // json_each, so 25k users are ~a dozen statements instead of 25k (D1: ≤50 queries per request).
  on(/^\/restore$/, async m => {
    const doc = m.replyTo?.document;
    if (!doc) return m.reply('Reply to a backup `.json` file with `/restore`.');
    let data;
    try {
      const f = await api.call('getFile', { file_id: doc.file_id });
      data = await (await fetch(`${env.TG_API || 'https://api.telegram.org'}/file/bot${env.BOT_TOKEN}/${f.result.file_path}`)).json();
    } catch (e) { return m.reply(`Could not download file: \`${e.message}\``); }
    if (data?.version !== 2) return m.reply('This is not a backup from this bot version (needs a `/backup` file made after the database upgrade).');
    try {
      const done = [];
      for (const [t, key] of Object.entries(B_TABLES)) {
        const rows = data.tables?.[t] || [];
        if (!rows.length) continue;
        const cols = Object.keys(rows[0]).filter(c => /^[a-z][a-z0-9_]*$/.test(c));
        const upsert = t === 'logs' ? 'ON CONFLICT (id) DO NOTHING' : key ? `ON CONFLICT (${key.join(', ')}) DO UPDATE SET ${cols.filter(c => !key.includes(c)).map(c => `${c} = excluded.${c}`).join(', ') || `${key[0]} = excluded.${key[0]}`}` : '';
        const sql = `INSERT INTO ${t} (${cols.join(', ')}) SELECT ${cols.map(c => `json_extract(value, '$.${c}')`).join(', ')} FROM json_each(?) WHERE true ${upsert}`;
        let chunk = [], size = 0;
        const send = async () => { if (chunk.length) await db.run(sql, JSON.stringify(chunk)); chunk = []; size = 0; };
        for (const r of rows) {
          const o = Object.fromEntries(cols.map(c => [c, r[c]]));
          chunk.push(o); size += JSON.stringify(o).length;
          if (size > 500000) await send(); // D1: a bound value may be up to ~2 MB
        }
        await send();
        done.push(`${t}: ${rows.length}`);
      }
      CACHE.clear();
      await m.reply(`**Restore complete (merged).**\n${done.join(' | ')}`);
    } catch (e) { await m.reply(`Restore failed: \`${e.message}\``); }
  }, OWNER);

  // ==================== commands/library.py ====================
  on(/^\/search(?:\s+(.*))?$/s, async (m, g) => {
    const q = (g[1] || '').trim();
    if (!q) return m.reply('**Usage:** `/search <movie or file name>`');
    const qt = normalizeName(q).split(' ').filter(Boolean);
    const scored = [];
    if (qt.length) {
      for (const { name: norm, entries: raw } of await db.all('SELECT name, entries FROM library')) { // ponytail: full scan (~3k rows) per search
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
    const raw = (await db.one('SELECT entries FROM library WHERE name = ?', norm))?.entries;
    const kept = (raw ? JSON.parse(raw) : []).filter(e => !(e.s === r.s && e.f === r.f));
    if (kept.length) await db.run('UPDATE library SET entries = ? WHERE name = ?', JSON.stringify(kept), norm);
    else await db.run('DELETE FROM library WHERE name = ?', norm);
  }
  onCb(/^lib_/, async e => {
    if (e.data === 'lib_close') return e.delete();
    const idx = parseInt(e.data.split('lib_')[1], 10);
    if (Number.isNaN(idx)) return e.answer('Invalid selection.', true);
    const raw = await db.get(`lib:search:${e.uid}`), results = raw ? JSON.parse(raw) : [];
    if (idx >= results.length) return e.answer('Expired — /search again.', true);
    const r = results[idx];
    const f = { file_name: r.name, size: r.size, sizebytes: r.bytes, fid: r.f, code: r.s, md5: r.m || null };
    const ok = await sendStream(e.uid, true, f, cardCaption(f, e.from, await getCustomTag(e.uid), null), null, (await urow(e.uid)).thumb, true, e.uid);
    if (!ok) { await dropEntry(r.norm, r); return e.answer('Removed stale entry — resend the link to fetch fresh.', true); }
    db.bump('lib_hits');
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
    const u = await urow(m.uid), h = statsOf(u);
    const attempts = int(h.attempts), success = int(h.success) || int(h.total), failed = int(h.failed) || Math.max(attempts - success, 0);
    if (!attempts && !success) return m.reply('📊 Your Statistics\n\nNo completed downloads yet.\n\nStart by sending a TeraBox link.');
    await m.reply(`📊 Your Statistics\n\nFiles: ${success}\nData downloaded: ${fmtSize(int(h.storage))}\n\nSuccessful: ${success}\nFailed: ${failed}\nAudio conversions: ${int(h.audio)}\nVideo conversions: ${int(h.video)}\n\n` +
      `Premium: ${(await isPremium(m.uid)) ? 'Active' : 'Free'}\nMember since: ${u.joined || '?'}`);
  });

  // ==================== commands/referral.py ====================
  // A referral is recorded on /start (users.ref_by) but stays pending (ref_pending = 1) until the new user
  // has joined every force channel; confirmReferral then counts it and rewards the referrer, once.
  async function recordReferral(referrer, uid) {
    if (referrer === uid) return false;
    // only a NEW user (first seen today) nobody referred yet: both sides get Premium, so old users
    // opening each other's links must not count
    return (await db.run('INSERT INTO users (id, joined, ref_by, ref_pending) VALUES (?1, ?3, ?2, 1) ON CONFLICT (id) DO UPDATE SET ref_by = excluded.ref_by, ref_pending = 1 WHERE users.ref_by IS NULL AND users.joined = ?3',
      int(uid), int(referrer), ymd())) === 1;
  }
  async function missingChannels(uid) {
    const rt = await runtime(), out = [];
    for (const ch of [...rt.FORCE_CHANNELS, ...rt.FORCE_GROUPS]) if (!(await isUserOnChat(ch, uid))) out.push(ch);
    return out;
  }
  async function confirmReferral(uid, name) {
    // one statement claims it, so it's counted once even if two updates race
    const ref = int((await db.one('UPDATE users SET ref_pending = 0 WHERE id = ? AND ref_pending = 1 RETURNING ref_by', int(uid)))?.ref_by);
    if (!ref) return false; // none, or already counted
    const ok = (await db.one('INSERT INTO users (id, ref_ok) VALUES (?, 1) ON CONFLICT (id) DO UPDATE SET ref_ok = ref_ok + 1 RETURNING ref_ok', ref)).ref_ok;
    await addPremiumDays(ref, REF_DAYS);
    await addPremiumDays(uid, REF_NEW_DAYS); // the friend who joined gets Premium too
    const [bonus, bd] = await checkAndGrantReward(ref);
    await funnel('referrals');
    await logx(`Referral: ${ref} invited ${uid} → +${REF_DAYS}d${bonus ? ` +${bd}d bonus` : ''} (friend +${REF_NEW_DAYS}d)`);
    await api.send(ref, `🎉 **${escapeMarkdown(name || 'A friend')}** joined with your link!\n\n⭐ +${REF_DAYS} day Premium added${bonus ? `\n🏆 Milestone bonus: **+${bd} days**` : ''}\n👥 Total friends: **${ok}**\n\nKeep sharing: /ref · 🏆 /top`, { buttons: [[Button.url('📤 Invite more friends', await refShare(ref))]] });
    await api.send(uid, `🎁 **Welcome gift: +${REF_NEW_DAYS} day Premium!**\nYou joined with a friend's link — enjoy multi-file links and /videos.\n\n👥 Invite your friends too: every friend who joins = **+${REF_DAYS} day** for you and **+${REF_NEW_DAYS} day** for them.`, { buttons: [[Button.url('📤 Invite friends', await refShare(uid))]] });
    return true;
  }
  const chanUrl = ch => (String(ch).startsWith('@') ? `https://t.me/${String(ch).slice(1)}` : null);
  async function sendJoinPrompt(chatId, missing) {
    const buttons = missing.map(ch => chanUrl(ch)).filter(Boolean).map((u, i) => [Button.url(`📣 Join ${missing[i]}`, u)]);
    buttons.push([Button.inline('✅ Joined', 'ref_joined')]);
    await api.send(chatId, `📢 Join ${missing.join(', ')} to start using the bot, then tap **✅ Joined**.`, { buttons });
  }
  onCb(/^ref_joined$/, async e => {
    const missing = await missingChannels(e.uid);
    if (missing.length) return e.answer(`❌ You haven't joined ${missing.join(', ')} yet. Join, then tap ✅ Joined again.`, true);
    await confirmReferral(e.uid, e.from.first_name);
    await e.answer('✅ Thanks for joining! Send me any TeraBox link.');
    await e.edit('✅ Joined! Now send me any TeraBox link and watch it in ~2 seconds ⚡', { buttons: [] });
  });
  async function refStats(uid) {
    const r = await db.one('SELECT (SELECT COUNT(*) FROM users WHERE ref_by = ?1) invited, (SELECT COUNT(*) FROM users WHERE ref_by = ?1 AND ref_pending = 1) pending, (SELECT ref_ok FROM users WHERE id = ?1) ok', int(uid));
    const { invited, pending } = r, ok = int(r.ok);
    const next = TIERS.find(([t]) => ok < t);
    return [invited, ok, next?.[0] ?? null, next?.[1] ?? null, pending];
  }
  async function checkAndGrantReward(uid) {
    const u = await urow(uid), ok = int(u.ref_ok), last = int(u.ref_reward);
    for (const [t, days] of TIERS) if (ok >= t && t > last) { await addPremiumDays(int(uid), days); await db.setUser(uid, { ref_reward: t }); return [true, days]; }
    return [false, 0];
  }
  const tierText = ok => TIERS.map(([t, days], i) => {
    const prev = i ? TIERS[i - 1][0] : 0;
    return `${ok >= t ? '✅' : '⬜'} \`${progressBar(Math.max(0, Math.min(ok, t) - prev), t - prev)}\` ${t} friends → +${days}d bonus`;
  }).join('\n');
  const refEarned = ok => ok * REF_DAYS + TIERS.reduce((a, [t, d]) => (ok >= t ? a + d : a), 0);
  const botName = () => cached('botname', async () => (await api.me()).username || 'YourBot', 3600);
  const refLink = async uid => `https://t.me/${await botName()}?start=ref_AT-${int(uid)}`;
  // one video, shareable: t.me/<bot>?start=v_<code>_<fid>_<sharer> opens the bot and sends that video;
  // the sharer gets referral credit (start params are max 64 chars: the sharer is dropped if needed)
  const videoStart = async (code, fid, uid) => {
    let p = `v_${code}_${fid}_${int(uid)}`;
    if (p.length > 64) p = `v_${code}_${fid}_0`;
    return p.length > 64 ? null : `https://t.me/${await botName()}?start=${p}`;
  };
  const videoShare = async (code, fid, uid) => {
    const link = await videoStart(code, fid, uid);
    return link && `https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent('🎬 Watch this video in 1 tap — no download needed 👇')}`;
  };
  // Telegram's share sheet with the invite link + a short pitch
  const refShare = async uid => `https://t.me/share/url?url=${encodeURIComponent(await refLink(uid))}&text=${encodeURIComponent(`🎬 Watch any TeraBox video in 2 seconds — no download!\n🎁 Join with my link and get +${REF_NEW_DAYS} day Premium free`)}`;

  on(/^\/(ref|refer|referral)$/, async m => {
    const link = await refLink(m.uid), [invited, ok, next, days, pending] = await refStats(m.uid);
    let text = '┏━━━━━━━━━━━━━━━━━⍟\n┃  👥 𝗥𝗲𝗳𝗲𝗿𝗿𝗮𝗹 𝗦𝘆𝘀𝘁𝗲𝗺\n┗━━━━━━━━━━━━━━━━━━━━━⍟\n\n' +
      `📎 Your referral link:\n\`${link}\`\n\n👥 Invited: **${invited}**\n✅ Successful: **${ok}**${pending ? `\n⏳ Pending: **${pending}** (haven't joined the channel yet)` : ''}\n\n${tierText(ok)}\n\n` +
      `${next ? `Next bonus: **${next - ok} more** friend(s) → +${days}d` : '🏆 **All bonuses unlocked!**'}\n\n` +
      `🎁 Every friend who joins the channel = **+${REF_DAYS} day Premium** for you, **+${REF_NEW_DAYS} day** for them.\n⭐ You've earned **${refEarned(ok)} days** so far.`;
    const [granted, gd] = await checkAndGrantReward(m.uid);
    if (granted) text += `\n\n🎉 **Congratulations!** You just earned **${gd} days Premium!**`;
    await m.reply(text, { buttons: [[Button.url('📤 Share Link', await refShare(m.uid))], [Button.inline('🏆 Claim Reward', 'ref_claim'), Button.inline('📊 Full Stats', 'ref_fullstats')], [Button.inline('🥇 Top inviters', 'ref_top')], [Button.inline('◀️ Back', 'menu_main')]] });
  });
  onCb(/^ref_claim$/, async e => {
    const [granted, days] = await checkAndGrantReward(e.uid);
    if (granted) return e.answer(`🎉 **Reward Claimed!**\n\nYou received **${days} days Premium!**\n\nEnjoy your benefits!`, true);
    const [, ok, next, nd] = await refStats(e.uid);
    await e.answer(next ? `✅ Your +${REF_DAYS}d per friend is added automatically.\n\nNext bonus: ${next - ok} more friend(s) → +${nd}d.` : "🏆 You've unlocked every bonus!", true);
  });
  onCb(/^ref_fullstats$/, async e => {
    const [invited, ok] = await refStats(e.uid), last = int((await urow(e.uid)).ref_reward);
    const earned = refEarned(ok);
    await e.edit('┏━━━━━━━━━━━━━━━━━⍟\n┃  📊 𝗥𝗲𝗳𝗲𝗿𝗿𝗮𝗹 𝗦𝘁𝗮𝘁𝘀\n┗━━━━━━━━━━━━━━━━━━━━━⍟\n\n' +
      `👥 Total invited: **${invited}**\n✅ Successful: **${ok}**\n🎁 Rewards earned: **${earned} days** Premium\n📌 Last tier claimed: **${last}** referrals\n\n${tierText(ok)}`,
      { buttons: back('menu_referral') });
  });
  onCb(/^menu_referral$/, async e => {
    const link = await refLink(e.uid), [invited, ok, next, days, pending] = await refStats(e.uid);
    await e.edit('┏━━━━━━━━━━━━━━━━━⍟\n┃  👥 𝗥𝗲𝗳𝗲𝗿𝗿𝗮𝗹𝘀\n┗━━━━━━━━━━━━━━━━━━━━━⍟\n\n' +
      `🎁 Every friend who joins the channel = **+${REF_DAYS} day Premium** for you, **+${REF_NEW_DAYS} day** for them.\n\n\`${link}\`\n\n👥 Invited: **${invited}** | ✅ Successful: **${ok}** | ⭐ Earned: **${refEarned(ok)}d**${pending ? `\n⏳ Pending: **${pending}** (not in the channel yet)` : ''}\n\n${tierText(ok)}\n\n${next ? `Next bonus: **${next - ok} more** → +${days}d` : '🏆 **All bonuses unlocked!**'}`,
      { buttons: [[Button.url('📤 Share', await refShare(e.uid))], [Button.inline('🏆 Claim', 'ref_claim'), Button.inline('📊 Stats', 'ref_fullstats')], [Button.inline('🥇 Top inviters', 'ref_top')], [Button.inline('◀️ Back', 'menu_main')]] });
  });
  // /top: the 10 users who brought in the most friends, and where you stand (users_ref_ok index:
  // only users with at least one referral are read)
  async function topText(uid) {
    const rows = await db.all('SELECT id, ref_ok FROM users WHERE ref_ok > 0 ORDER BY ref_ok DESC LIMIT 10');
    const mine = int((await urow(uid)).ref_ok);
    const rank = mine ? (await db.one('SELECT COUNT(*) + 1 n FROM users WHERE ref_ok > ?', mine)).n : null;
    const medal = i => ['🥇', '🥈', '🥉'][i] || `${i + 1}.`;
    const lines = [];
    for (const [i, r] of rows.entries()) {
      const u = await api.user(r.id);
      lines.push(`${medal(i)} ${escapeMarkdown(u?.first_name || 'User')}${r.id === int(uid) ? ' (you)' : ''} — **${r.ref_ok}** friends`);
    }
    return '┏━━━━━━━━━━━━━━━━━⍟\n┃  🏆 𝗧𝗼𝗽 𝗜𝗻𝘃𝗶𝘁𝗲𝗿𝘀\n┗━━━━━━━━━━━━━━━━━━━━━⍟\n\n' +
      (lines.length ? lines.join('\n') : 'Nobody yet — be the first!') +
      `\n\n${rank ? `📍 You: **#${rank}** with **${mine}** friends` : '📍 You have no referrals yet'}\n🎁 Every friend = **+${REF_DAYS} day Premium** for you, +${REF_NEW_DAYS} day for them`;
  }
  on(/^\/top$/, async m => m.reply(await topText(m.uid), { buttons: [[Button.url('📤 Invite friends', await refShare(m.uid))]] }));
  onCb(/^ref_top$/, async e => e.edit(await topText(e.uid), { buttons: [[Button.url('📤 Invite friends', await refShare(e.uid))], [Button.inline('◀️ Back', 'menu_referral')]] }));
  // reminder button: show the purchase plans right away (falls back to text when /videos isn't set up)
  onCb(/^renew_info$/, async e => {
    await e.answer('See plans below.');
    if (planViewHook) return planViewHook(e.chatId, e.uid);
    await e.reply('⭐ Renew Premium\n\nUse /plan to check plans or contact an admin to renew.');
  });

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
    const total = Math.max((await userCount()) - 1, 0); // minus the owner, who is a user too
    const mode = m.replyTo ? 'forward' : 'text';
    // nothing is sent until the owner confirms: first a preview, exactly as users will see it
    const pv = mode === 'forward'
      ? await api.call('copyMessage', { chat_id: m.chatId, from_chat_id: m.chatId, message_id: m.replyTo.message_id })
      : await api.call('sendMessage', { chat_id: m.chatId, text: md(text), parse_mode: 'HTML' });
    if (!pv.ok) return m.reply(`❌ Preview failed: ${pv.description || 'unknown error'} — nothing was sent.`);
    await db.set(`bc_draft:${m.uid}`, JSON.stringify({ mode, text, from_chat: m.chatId, msg_id: m.replyTo?.message_id ?? null, total }), { ex: 3600 });
    await m.reply(`👆 **Preview** — this is exactly what users get (${mode === 'forward' ? 'copy of the replied message' : 'text'}).\n\n📢 Send it to **${total}** users?`,
      { buttons: [[Button.inline(`✅ Send to ${total} users`, 'bc_go')], [Button.inline('❌ Cancel', 'bc_cancel')]] });
  });
  onCb(/^bc_(go|cancel)$/, async e => {
    if (e.uid !== OWNER_ID) return e.answer('Owner only.', true);
    const raw = await db.get(`bc_draft:${e.uid}`);
    if (!raw) { await e.answer('This preview expired — send /broadcast again.', true); return e.edit('⌛ Preview expired — nothing was sent.', { buttons: [] }); }
    await db.del(`bc_draft:${e.uid}`); // claimed: a double tap can't queue it twice
    if (e.data === 'bc_cancel') { await e.answer('Cancelled'); return e.edit('❌ Broadcast cancelled — nothing was sent.', { buttons: [] }); }
    const d = JSON.parse(raw);
    await e.answer('📢 Queued!');
    await e.edit(`📢 Broadcast queued for **${d.total}** users.\nStarts within a minute — this message updates live.`, { buttons: [] });
    await queueBroadcast({ kind: 'broadcast', mode: d.mode, text: d.text, from_chat: d.from_chat, msg_id: d.msg_id, exclude: e.uid, total: d.total, status_chat: e.chatId, status_msg: e.msgId });
    await logAudit('BROADCAST', e.uid, `${d.mode} to ${d.total}`);
  });
  onCb(/^bc_stop_\d+$/, async e => {
    if (e.uid !== OWNER_ID) return e.answer('Owner only.', true);
    const b = await db.one('SELECT * FROM broadcasts WHERE id = ?', int(e.data.slice(8)));
    if (!b) return e.answer('Broadcast not found.', true);
    if (b.done) { await e.answer('Already finished.'); return e.edit(bcProgress(b, b.sent, b.failed, 'complete'), { buttons: [] }); }
    await db.run('UPDATE broadcasts SET done = 1 WHERE id = ?', b.id);
    await logAudit('BROADCAST_STOP', e.uid, `#${b.id} (button)`);
    await e.answer('🛑 Broadcast stopped.');
    await e.edit(bcProgress(b, b.sent, b.failed, 'stopped'), { buttons: [] });
  });
  on(/^\/broadcaststatus$/, async m => {
    if (m.uid !== OWNER_ID) return m.reply('Owner only.');
    const rows = await db.all('SELECT * FROM broadcasts WHERE done = 0 ORDER BY id');
    if (!rows.length) {
      const last = await db.one('SELECT * FROM broadcasts ORDER BY id DESC LIMIT 1');
      return m.reply(last ? `ℹ️ No broadcast is running. Last one:\n\n${bcProgress(last, last.sent, last.failed, 'complete')}` : 'ℹ️ No broadcasts yet.');
    }
    for (const r of rows) await m.reply(bcProgress(r), { buttons: bcStopBtn(r.id) });
  });
  // stops every running/scheduled broadcast (and /announce) right away; the cron skips done rows
  on(/^\/stopbroadcast$/, async m => {
    if (m.uid !== OWNER_ID) return m.reply('Owner only.');
    const rows = await db.all('SELECT * FROM broadcasts WHERE done = 0 ORDER BY id');
    if (!rows.length) return m.reply('ℹ️ No broadcast is running.');
    await db.run('UPDATE broadcasts SET done = 1 WHERE done = 0');
    await logAudit('BROADCAST_STOP', m.uid, rows.map(r => `#${r.id}`).join(','));
    for (const r of rows) if (r.kind !== 'announce') await api.edit(r.status_chat, r.status_msg, bcProgress(r, r.sent, r.failed, 'stopped'), { buttons: [] });
    await m.reply(`🛑 **Broadcast stopped.**\n\n${rows.map(r => `#${r.id} (${r.kind}) — sent **${r.sent}** / ${r.total}, failed ${r.failed}`).join('\n')}`);
  });

  // ==================== commands/videos.py ====================
  let uploadTick = null; // set below when /videos is configured; run by the cron
  let planViewHook = null; // status + /videos plans menu: /plan, ⭐ Premium, Renew buttons
  let buyPlanHook = null; // t.me/<bot>?start=plan_<id> (the Videos App's plan cards): straight to that plan's QR
  let ordersTick = null, subReminders = null, videoCleanTick = null, appFeed = null, appSend = null, appLinks = null; // /videos payments: auto-verify + renew reminders (cron)
  if (env.VIDEOS_POOL_WORKER && env.VIDEOS_PAYMENT_API) {
    const pay = env.VIDEOS_PAYMENT_API.replace(/\/$/, '');
    // VIDEOS_POOL_WORKER can list several pool workers (comma-separated); each fetch picks the next
    // one, spreading the load (and their request limits) across them
    const pools = String(env.VIDEOS_POOL_WORKER).split(',').map(x => x.trim().replace(/\/$/, '')).filter(Boolean);
    let poolTurn = Math.floor(Math.random() * pools.length);
    const pool = () => pools[poolTurn++ % pools.length];
    const TRIAL = int(env.VIDEOS_TRIAL_VIDEOS || 5), promo = env.VIDEOS_PROMO_URL || '';
    const getJ = async (url, body) => {
      try {
        const r = await fetch(url, { method: body ? 'POST' : 'GET', signal: AbortSignal.timeout(10000), ...(body ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {}) });
        return [200, 201].includes(r.status) ? await r.json() : null;
      } catch { return null; }
    };
    // /videos state lives in the users row; the code keeps the old video_state field names
    const VCOL = { video_index: 'v_idx', last_video_time: 'v_last', vid_pos: 'v_pos', vid_start: 'v_start', trial_start_time: 'trial_at', trial_n: 'trial_n', free_day: 'free_day', vmsgs: 'vmsgs', vdel_at: 'vdel_at', sub_until: 'sub_until', sub_checked: 'sub_checked', registered: 'registered' };
    // One users-row write (+ video_lists when a new 200 is fetched). Never throws: if D1 refuses
    // writes (e.g. free daily write limit hit) the video is still sent — only position/cooldown isn't saved.
    const setState = async (uid, fields) => {
      const { video_links, ...rest } = fields, cols = {};
      for (const [k, v] of Object.entries(rest)) if (VCOL[k]) cols[VCOL[k]] = v; else console.log('setState: unknown field', k);
      if ('sub_until' in rest) cols.sub_rem = null;
      const st = [];
      if (Object.keys(cols).length) st.push(db.setUserQ(uid, cols));
      if (video_links != null) st.push(db.q('INSERT INTO video_lists (id, links) VALUES (?, ?) ON CONFLICT (id) DO UPDATE SET links = excluded.links', int(uid), video_links));
      if (!st.length) return true;
      return db.batch(st).then(() => true, err => (console.log('setState', err.message), false));
    };
    const freeMode = async () => { const s = await db.get(FREE_MODE_KEY); return s == null ? String(env.VIDEOS_FREE_MODE) === 'true' : s === '1'; };
    // A paid subscription's end time is remembered (sub_until), so the payment worker is only
    // asked again after it ends; a "not subscribed" answer is trusted for SUB_RECHECK seconds.
    const SUB_RECHECK = 120;
    const subUntil = st => {
      const t = Date.parse(st.subscription_end_at || '') / 1000;
      return t > 0 ? t : +st.seconds_remaining > 0 ? nowS() + +st.seconds_remaining : 0;
    };
    // Bot premium (referral, gift code, /pre…) and admins also unlock /videos. Returns 'trial' while the
    // user still has free trial videos left.
    async function hasAccess(uid, ctx) {
      if (ctx.free || ctx.admin || ctx.premium) return true;
      const state = ctx.state, now = nowS();
      if (+state.sub_until > now) return true;
      if (!(+state.sub_checked > now - SUB_RECHECK)) {
        const st = await getJ(`${pay}/api/subscription/status/${int(uid)}`);
        if (st) { // API down → not cached, asked again next time
          const until = st.subscribed ? subUntil(st) : 0;
          await setState(uid, { sub_checked: Math.floor(now), ...(until > now ? { sub_until: Math.floor(until) } : {}) });
          if (st.subscribed) return true;
        }
      }
      ctx.freeInfo = freeInfo(state, (await runtime()).DAILY_FREE_VIDEOS);
      return ctx.freeInfo && ctx.freeInfo.used < ctx.freeInfo.limit ? 'trial' : false;
    }
    // Free videos for a user who has claimed the trial. With DAILY_FREE_VIDEOS > 0 they get that many
    // every IST day (trial_n counts today's, free_day = the day it counts for); 0 = the one-time trial.
    function freeInfo(state, daily) {
      if (!state.trial_start_time) return null;
      if (daily > 0) return { limit: daily, used: state.free_day === ymd() ? int(state.trial_n) : 0, daily: true };
      return { limit: TRIAL, used: int(state.trial_n), daily: false };
    }
    // ---- per-user pool list (same as the old bot) ----
    // Each user gets 200 random links from the pool, served in order; when they run out, a new
    // 200 is fetched. Once a video has been sent, Telegram's file_id is kept (videos: md5 → file_id) so any user who gets
    // that video again receives it instantly, without Telegram downloading the file again.
    const md5Of = u => (String(u).match(/\/file\/([0-9a-f]{32})/) || [])[1] || null;
    // The user's next link from their own 200 (old bot behaviour): sent as-is, no checks.
    // When the 200 are used up, a new 200 is fetched. save = other state written in the same row write.
    // fields = what to save once it's sent (position, a new 200)
    async function nextVideo(uid, ctx) {
      const state = ctx.state;
      let links = state.video_links ? JSON.parse(state.video_links) : [], idx = int(state.video_index), fresh = null;
      if (!links.length || idx >= links.length) {
        links = (await getJ(`${pool()}/?random=200`))?.links || [];
        if (!links.length) return null;
        idx = 0;
        fresh = JSON.stringify(links);
      }
      const url = links[idx], md5 = md5Of(url);
      // loadCtx already looked up the file_id of the link at the saved position
      const fid = !fresh && idx === int(state.video_index) ? ctx.nextFid : md5 ? (await db.one('SELECT file_id FROM videos WHERE md5 = ?', md5))?.file_id : null;
      return { url, md5, fid: fid || null, fields: { video_index: idx + 1, ...(fresh ? { video_links: fresh } : {}) } };
    }
    // Remembers a sent /videos message (users.vmsgs = [[chat, message_id, sent_at]…], vdel_at = the
    // oldest) so the cron can delete it after VIDEO_DELETE_HOURS — saved in the same row write as the
    // position. Entries older than 47h are dropped: Telegram lets a bot delete only for 48h.
    function trackMsg(state, chatId, r) {
      const id = r.result?.message_id;
      if (!id) return {};
      const now = Math.floor(nowS());
      let list = [];
      try { list = JSON.parse(state.vmsgs || '[]'); } catch {}
      list = list.filter(m => m[2] > now - 47 * 3600);
      list.push([chatId, id, now]);
      state.vmsgs = JSON.stringify(list);
      return { vmsgs: state.vmsgs, vdel_at: Math.min(...list.map(m => m[2])) };
    }
    // ---- pre-uploaded videos (instant /videos) ----
    // The cron uploads pool videos to VIDEOS_CHANNEL (the old storage channel) and keeps
    // their Telegram file_id: videos.ready = upload order. Each user walks the ready list from a
    // random start (v_pos / v_start); once they've had them all, /videos falls back to their own
    // 200 links exactly as before.
    const readyMarkup = promo ? { reply_markup: { inline_keyboard: [[Button.url('Watch All Movies 🎬🍿', promo)]] } } : {};
    // + "swipe more in the app" under each video in a private chat (when the app is public)
    const videoMarkup = async chatId => {
      const app = await appButton(chatId);
      const rows = [...(app ? [[Button.webapp('🎬 Swipe more in Videos App', `${origin}/app`)]] : []), ...(readyMarkup.reply_markup?.inline_keyboard || [])];
      return rows.length ? { reply_markup: { inline_keyboard: rows } } : {};
    };
    // Everything /videos needs in ONE D1 round trip: the user's row (state, premium, admin), their
    // 200 links with the file_id of the next one, free mode, and their next pre-uploaded video.
    async function loadCtx(uid) {
      const readyAfter = where => db.q(`SELECT md5, ready, file_id FROM videos WHERE ready > ${where} ORDER BY ready LIMIT 1`);
      const nextLink = "json_extract(vl.links, '$[' || COALESCE(u.v_idx, 0) || ']')";
      const [ur, nxt, first] = await db.batch([
        db.q(`SELECT u.*, vl.links, (SELECT value FROM store WHERE key = ?) vfree,
                (SELECT file_id FROM videos WHERE md5 = substr(${nextLink}, instr(${nextLink}, '/file/') + 6, 32)) next_fid
              FROM (SELECT 1) LEFT JOIN users u ON u.id = ? LEFT JOIN video_lists vl ON vl.id = u.id`, FREE_MODE_KEY, int(uid)),
        readyAfter(`COALESCE((SELECT v_pos FROM users WHERE id = ${int(uid)}), 0)`),
        readyAfter('0'),
      ]);
      const u = ur.results[0] || {};
      const state = {
        video_links: u.links, video_index: u.v_idx, last_video_time: u.v_last, vid_pos: u.v_pos, vid_start: u.v_start,
        trial_start_time: u.trial_at, trial_n: u.trial_n, free_day: u.free_day, vmsgs: u.vmsgs, sub_until: u.sub_until, sub_checked: u.sub_checked, registered: u.registered === 1 ? '1' : undefined,
      };
      // Each user starts at a random video (vid_start), walks to the end, wraps to the beginning and
      // stops just before vid_start — so users get different orders and nobody gets a repeat.
      const pos = +u.v_pos || 0, start = +u.v_start || 0;
      let row = null, newStart = null;
      if (!pos) {
        const n = (await db.one('SELECT COUNT(*) n FROM videos WHERE ready IS NOT NULL')).n;
        row = n ? await db.one('SELECT md5, ready, file_id FROM videos WHERE ready IS NOT NULL ORDER BY ready LIMIT 1 OFFSET ?', Math.floor(Math.random() * n)) : null;
        newStart = row?.ready ?? null;
      } else if (pos >= start) {
        row = nxt.results[0] || (first.results[0]?.ready < start ? first.results[0] : null);
      } else {
        row = nxt.results[0]?.ready < start ? nxt.results[0] : null; // already wrapped: stop before the start
      }
      return {
        state,
        nextFid: u.next_fid || null,
        admin: ADMINS.includes(int(uid)) || u.admin === 1,
        free: u.vfree == null ? String(env.VIDEOS_FREE_MODE) === 'true' : u.vfree === '1', // read fresh every time: panel toggle is instant
        premium: u.premium_until != null && nowS() < u.premium_until,
        ready: row?.file_id ? { md5: row.md5, pos: row.ready, fid: row.file_id, ...(newStart != null ? { start: newStart } : {}) } : null,
      };
    }
    // ponytail: 45 sends + 1 pool fetch stays under the free plan's 50 subrequests per cron run.
    // Telegram caps how fast a bot may post into one channel: a 429 drops that channel until the
    // next run. More channels in VIDEOS_CHANNEL (comma-separated) = more uploads per minute.
    // Daily cap keeps D1 under its free 100k rows written/day (2 rows per upload: row + ready index).
    const CHANNELS = String(env.VIDEOS_CHANNEL || '').split(',').map(x => x.trim()).filter(Boolean);
    const PER_RUN = 45, PER_DAY = int(env.VIDEOS_UPLOADS_PER_DAY || 25000);
    uploadTick = async () => {
      if (!CHANNELS.length) return;
      const dayKey = `vid_up:${new Date().toISOString().slice(0, 10)}`;
      const today = int(await db.get(dayKey));
      if (today >= PER_DAY) return;
      const links = (await getJ(`${pool()}/?random=200`))?.links || [];
      const cand = [...new Map(links.map(u => [md5Of(u), u])).entries()].filter(([m]) => m);
      const have = new Set();
      for (let i = 0; i < cand.length; i += 90) { // D1: max 100 bound parameters per query
        const part = cand.slice(i, i + 90).map(([m]) => m);
        for (const r of await db.all(`SELECT md5 FROM videos WHERE file_id IS NOT NULL AND md5 IN (${part.map(() => '?').join(',')})`, ...part)) have.add(r.md5);
      }
      const todo = cand.filter(([m]) => !have.has(m)).slice(0, Math.min(PER_RUN, PER_DAY - today));
      const live = [...CHANNELS], done = [];
      let k = 0;
      for (const [m, u] of todo) {
        if (!live.length) break;
        const ch = live[k++ % live.length];
        const r = await api.call('sendVideo', { chat_id: ch, video: u, has_spoiler: true, supports_streaming: true, disable_notification: true });
        const fid = r.result?.video?.file_id;
        if (fid) done.push([m, u, fid]);
        else if (r.error_code === 429) live.splice(live.indexOf(ch), 1); // channel rate limit: stop it for this run
      }
      for (let i = 0; i < done.length; i += 20) { // multi-row writes, 80 parameters each
        const part = done.slice(i, i + 20), now = Date.now();
        await db.run(`INSERT INTO videos (md5, url, file_id, ready) VALUES ${part.map(() => '(?, ?, ?, ?)').join(', ')}
                      ON CONFLICT (md5) DO UPDATE SET url = excluded.url, file_id = excluded.file_id, ready = COALESCE(videos.ready, excluded.ready)`,
        ...part.flatMap(([m, u, f], j) => [m, u, f, now + i + j]));
      }
      if (done.length) await db.set(dayKey, today + done.length, { ex: 2 * 86400 });
      console.log(`videos uploaded ${done.length}/${todo.length} (today ${today + done.length})${live.length < CHANNELS.length ? ' — channel rate limit hit' : ''}`);
    };

    on(/^\/videosready$/, async m => {
      const n = (await db.one('SELECT COUNT(*) n FROM videos WHERE ready IS NOT NULL')).n;
      const today = int(await db.get(`vid_up:${new Date().toISOString().slice(0, 10)}`));
      await m.reply(`🎬 Instant videos ready: **${n}**\nUploaded today: ${today}/${PER_DAY}\nChannel(s): \`${CHANNELS.join(', ') || 'not set'}\` — up to ${PER_RUN} per minute.`);
    }, ADMIN);

    // save = state fields to write in the same row write as the new position (e.g. last_video_time)
    async function serveVideo(chatId, uid, target, ctx = null, save = {}, caption = null) {
      ctx ||= await loadCtx(uid);
      const hours = (await runtime()).VIDEO_DELETE_HOURS;
      const text = [caption, hours ? `⏳ Auto-deletes from this chat in ${hours}h` : ''].filter(Boolean).join('\n');
      const cap = text ? { caption: text } : {};
      const track = r => (hours ? trackMsg(ctx.state, chatId, r) : {});
      // 1) a pre-uploaded video (file_id) this user hasn't had yet → instant; state is saved after it's sent
      if (ctx.ready) {
        const r = await api.call('sendVideo', { chat_id: chatId, video: ctx.ready.fid, has_spoiler: true, protect_content: true, supports_streaming: true, ...cap, ...(await videoMarkup(chatId)) });
        const pos = { vid_pos: ctx.ready.pos, ...(ctx.ready.start != null ? { vid_start: ctx.ready.start } : {}) };
        if (r.ok) { funnel('videos'); await setState(uid, { ...save, ...pos, ...track(r) }); return true; }
        await db.run('UPDATE videos SET ready = NULL WHERE md5 = ?', ctx.ready.md5); // unusable file_id
        save = { ...save, ...pos };
      }
      // 2) otherwise the user's own 200 links, as before
      const [, c] = await Promise.all([
        api.call('sendChatAction', { chat_id: chatId, action: 'upload_video' }), // "sending video…" while Telegram fetches the link
        nextVideo(uid, ctx),
      ]);
      if (!c) { if (Object.keys(save).length) await setState(uid, save); return target.reply('❌ No videos found, try again in a moment.'); }
      const r = await api.call('sendVideo', { chat_id: chatId, video: c.fid || c.url, has_spoiler: true, protect_content: true, supports_streaming: true, ...cap, ...(await videoMarkup(chatId)) });
      // the position moves on either way (a link that fails isn't retried forever)
      await setState(uid, { ...save, ...c.fields, ...(r.ok ? track(r) : {}) });
      if (!r.ok) { await target.reply('❌ Video error: server busy, please try again in a moment.'); return false; }
      const fid = r.result?.video?.file_id;
      funnel('videos');
      if (fid && !c.fid && c.md5) await db.run('INSERT INTO videos (md5, url, file_id) VALUES (?, ?, ?) ON CONFLICT (md5) DO UPDATE SET file_id = excluded.file_id', c.md5, c.url, fid).catch(() => {});
      return true;
    }
    // one trial video (n = how many the user had before): counted in the same row write, and the
    // plans come right after the last one
    async function trialVideo(chatId, uid, target, ctx, save, f) {
      const n = f.used, left = f.limit - n - 1;
      const sent = await serveVideo(chatId, uid, target, ctx, { ...save, trial_n: n + 1, ...(f.daily ? { free_day: ymd() } : {}) },
        `🎁 Free video ${n + 1}/${f.limit}${f.daily ? ' today' : ''}${left ? ` · ${left} left` : ''}`);
      if (sent !== false && !left) {
        await api.send(chatId, f.daily
          ? `⏰ <b>That was your last free video for today!</b>\n🎁 ${f.limit} more free tomorrow — or watch unlimited right now 👇`
          : '⏰ <b>That was your last free video!</b>\nPick a plan to keep watching unlimited videos 👇', { html: true });
        await showPlans(chatId);
      }
    }

    on(/^\/videos$/, async m => {
      const ctx = await loadCtx(m.uid), state = ctx.state;
      if (state.last_video_time) {
        const pending = (await runtime()).VIDEOS_COOLDOWN_SECONDS - (nowS() - parseFloat(state.last_video_time));
        if (pending > 0) return m.reply(`⏳ Please wait ${pending.toFixed(1)} seconds before requesting another video.`);
      }
      const [reg, access] = await Promise.all([
        // register with the payment worker once per user (was every /videos)
        state.registered === '1' || getJ(`${pay}/api/telegram/register`, { telegram_id: m.uid, name: m.from.username || 'User' }),
        hasAccess(m.uid, ctx),
      ]);
      const save = { last_video_time: nowS(), ...(reg ? { registered: 1 } : {}) };
      if (access === 'trial') return trialVideo(m.chatId, m.uid, m, ctx, save, ctx.freeInfo);
      if (access) return serveVideo(m.chatId, m.uid, m, ctx, save);
      await setState(m.uid, save);
      if (!state.trial_start_time || int(parseFloat(state.trial_start_time)) === 0)
        return m.reply(`🎁 <b>FREE TRIAL — Special Offer for New Users!</b>\n\nClick the button below to get <b>${(await runtime()).DAILY_FREE_VIDEOS || TRIAL} free videos${(await runtime()).DAILY_FREE_VIDEOS ? ' every day' : ''}</b> and start watching right now:`, { html: true, buttons: [[Button.inline(`🎁 Get ${(await runtime()).DAILY_FREE_VIDEOS || TRIAL} Free Videos`, 'vid_trial')]] });
      await m.reply(ctx.freeInfo?.daily
        ? `⏰ <b>Today's ${ctx.freeInfo.limit} free videos are used up!</b>\nCome back tomorrow for ${ctx.freeInfo.limit} more, or pick a plan to keep watching now 👇`
        : '⏰ <b>Your free trial is over!</b>\nPlease choose a plan below to continue watching.', { html: true });
      await showPlans(m.chatId);
    });

    const getPlans = () => cached('vid_plans', () => getJ(`${pay}/api/plans`), 300);
    // returns false (sending nothing) when quiet and the plans can't be loaded
    async function showPlans(chatId, intro = null, quiet = false) {
      const res = await getPlans();
      if (!res) return quiet ? false : api.send(chatId, '⚠️ Error loading plans. Please try again later.');
      const plans = (res.plans || []).filter(p => p.status === 'active');
      if (!plans.length) return quiet ? false : api.send(chatId, '⚠️ No plans available right now. Contact admin.');
      // cheapest first (the easy first purchase); the lowest price per day is marked best value
      plans.sort((a, b) => a.price - b.price);
      const best = plans.reduce((a, p) => (p.price / p.validity_days < a.price / a.validity_days ? p : a), plans[0]);
      // longer plans show how much they save per day against the cheapest one (the upgrade nudge)
      const base = plans[0].price / plans[0].validity_days;
      const save = p => Math.round((1 - p.price / p.validity_days / base) * 100);
      const buttons = plans.map((p, i) => [Button.inline(`${i === 0 ? '⚡ ' : p === best ? '💎 ' : ''}${p.name} - ₹${p.price} (${p.validity_days} days)${i && save(p) >= 10 ? ` • save ${save(p)}%` : ''}`, `vid_plan_${p.id}`)]);
      await funnel('plans_shown');
      const caption = (intro ? `${intro}\n\n` : '') + '🗂️ Select a Plan Category for Unlimited Videos\n\n⚡ All plans are fastest and having smooth experience for premium videos ⚡ \n\n📋 <b>Available Plans:</b>\nChoose a plan below to subscribe: 👇';
      const r = await api.call('sendPhoto', { chat_id: chatId, photo: PLANS_PHOTO, caption, parse_mode: 'HTML', reply_markup: { inline_keyboard: buttons } });
      if (!r.ok) await api.send(chatId, caption, { html: true, buttons });
      return true;
    }
    // The user's status (paid plan / Premium / admin / trial) above the buy menu. While a paid plan
    // is active there is nothing to buy (the payment worker refuses a second one), so only the status.
    async function planView(chatId, uid) {
      const u = await urow(uid), now = nowS();
      const custom = await db.get('custom_plan_text');
      if (custom) await api.send(chatId, custom);
      if (+u.sub_until > now)
        return api.send(chatId, `✅ <b>Your plan is active till ${dmyHM(u.sub_until)}</b>\n⭐ Premium included — unlimited /videos, multi-file links, folders, custom thumbnail.\n\nWe'll remind you when it ends so you can renew.`, { html: true });
      const lines = [];
      if (ADMINS.includes(int(uid)) || u.admin === 1) lines.push('👑 <b>Admin</b> — everything is free for you (plans shown as a preview).');
      else if (u.premium_until > now) lines.push(`⭐ <b>Premium active</b> — ${premiumLeft(u.premium_until - Math.floor(now))}\nBuying a plan adds its days on top.`);
      else {
        const daily = (await runtime()).DAILY_FREE_VIDEOS, f = freeInfo({ trial_start_time: u.trial_at, trial_n: u.trial_n, free_day: u.free_day }, daily);
        if (!f) lines.push(`🎁 You have <b>${daily || TRIAL} free videos${daily ? ' every day' : ''}</b> — send /videos to try.`);
        else if (f.used < f.limit) lines.push(`🎁 <b>${f.limit - f.used} free video(s)</b> left${f.daily ? ' today' : ''} — send /videos.`);
        else lines.push(f.daily ? `🆓 Today's free videos are used — <b>${f.limit} more tomorrow</b>.` : '🆓 Free plan — your free videos are used up.');
      }
      if (await freeMode()) lines.push('🎉 /videos is <b>free for everyone</b> right now!');
      lines.push('💎 <b>Premium</b> = unlimited /videos · multi-file links · folders · custom thumbnail');
      // plans API down: the plain plans text (unless the /setplan text above already went out)
      if (!(await showPlans(chatId, lines.join('\n'), true)) && !custom) await api.send(chatId, await planText());
    }
    planViewHook = planView;
    onCb(/^vid_trial$/, async e => {
      const ctx = await loadCtx(e.uid);
      const daily = (await runtime()).DAILY_FREE_VIDEOS;
      if (ctx.state.trial_start_time) { // an old button pressed again: no second trial
        const f = freeInfo(ctx.state, daily);
        await e.answer(f.used < f.limit ? 'Here is your next free video.' : 'Your free videos are used up for now.');
        return f.used < f.limit ? trialVideo(e.chatId, e.uid, e, ctx, {}, f) : showPlans(e.chatId);
      }
      funnel('trials');
      await e.answer('Trial activated!');
      const f = daily > 0 ? { limit: daily, used: 0, daily: true } : { limit: TRIAL, used: 0, daily: false };
      await e.reply(`🎉 <b>Your free trial is ACTIVE!</b> ${f.limit} free videos${f.daily ? ' <b>every day</b>' : ''} — send /videos for the next one.`, { html: true });
      await trialVideo(e.chatId, e.uid, e, ctx, { trial_start_time: nowS() }, f);
    });
    // /purchase<N> from the old bot: create an order on the payment worker, show Pay + Verify.
    onCb(/^vid_plan_(\d+)$/, async e => { await e.answer(); await buyPlan(e.chatId, e.uid, e.from, int(e.data.slice(9))); });
    async function buyPlan(chatId, uid, from, planId) {
      const busyMsg = await api.send(chatId, '⏳ Creating payment request...');
      const done = async text => { await busyMsg?.delete(); return text ? api.send(chatId, text, { html: true }) : null; };

      const status = await getJ(`${pay}/api/subscription/status/${uid}`);
      if (!status) return done('❌ Error fetching user data. Please try again.');
      if (status.subscribed) {
        const until = subUntil(status);
        if (until > nowS()) await setState(uid, { sub_until: Math.floor(until), sub_checked: Math.floor(nowS()) });
        return done(`✅ <b>Your plan is already active${until > nowS() ? ` till ${dmyHM(until)}` : ''}.</b>\nWe'll remind you when it ends so you can renew.`);
      }
      let token = status.user_token;
      if (!token) token = (await getJ(`${pay}/api/telegram/register`, { telegram_id: uid, name: from.username || 'User' }))?.user_token;
      if (!token) return done('❌ Error fetching user data. Please try again.');

      const plan = ((await getPlans())?.plans || []).find(p => int(p.id) === planId);
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

      await funnel('orders');
      await db.set(`vid_order:${uid}`, JSON.stringify({ order_id: order.result.orderId, plan: plan.name, amount: plan.price, days: plan.validity_days, byte_txn: order.result.byteTransactionId, at: Math.floor(nowS()), chat: chatId, first: from.first_name || '-', user: from.username || '-' }), { ex: 86400 });
      await done();
      const buttons = [[Button.url(`💳 Pay ₹${plan.price}`, order.result.payment_url)], [Button.inline("✅ I've Paid - Verify", 'vid_verify')]];
      // the QR right in the chat (same QR as the Pay page — the payment worker keeps it fixed per order);
      // without it (older payment worker, or Telegram can't fetch it) the text-only message as before
      const qr = order.result.qr_url || String(order.result.payment_url).replace('/instant-pay/', '/qr/');
      const sent = await api.call('sendPhoto', { chat_id: chatId, photo: qr, parse_mode: 'HTML', reply_markup: { inline_keyboard: buttons },
        caption: `💳 <b>Pay ₹${plan.price} for ${escHtml(plan.name)}</b> (${plan.validity_days} days)\n\n` +
          '<b>📱 How to pay:</b>\n1️⃣ Scan this QR in any UPI app — or save it and use <i>Scan from gallery</i> in GPay / PhonePe / Paytm\n' +
          "2️⃣ Or tap <b>Pay</b> below for the payment page\n3️⃣ Done — it activates automatically (or tap <b>I've Paid</b>)\n\n⏰ This QR expires in 10 minutes" });
      if (!sent.ok) await api.send(chatId,
        `💳 <b>Pay for ${escHtml(plan.name)}</b>\n\n<b>Amount:</b> ₹${plan.price}\n<b>Validity:</b> ${plan.validity_days} days\n\n` +
        "<b>📱 How to Pay:</b>\n1️⃣ Scan QR or click Pay button\n2️⃣ Complete payment in UPI app\n3️⃣ Click 'I've Paid' below\n\n⏰ Payment link expires in 10 minutes",
        { html: true, buttons });
    }
    buyPlanHook = buyPlan;

    // /verifynew from the old bot: ask the payment worker whether the order was paid.
    async function paymentStatus(o, uid) {
      try {
        const r = await fetch(`${pay}/api/payment-status`, {
          method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, signal: AbortSignal.timeout(15000),
          body: new URLSearchParams({ order_id: o.order_id }),
        });
        return r.status === 200 ? (await r.text()).trim() : null;
      } catch (err) { await logx(`payment-status ${uid} failed: ${err.message}`); return null; }
    }
    // Paid: the order row is deleted first, so the Verify button and the cron can't both count it.
    async function paymentDone(uid, o, auto) {
      if (!(await db.del(`vid_order:${uid}`))) return false;
      await setState(uid, { sub_checked: 0 });
      if (int(o.days) > 0) {
        await addPremiumDays(uid, int(o.days)); // a paid plan includes bot Premium for its days
        // the plan runs as long as that Premium: sub_until drives the plan's renew reminders and
        // /plan's "active till"; reminded = 'expired' keeps the Premium reminders from doubling them
        const end = (await urow(uid)).premium_until;
        if (end) await db.setUser(uid, { sub_until: end, sub_rem: null, reminded: 'expired' });
      }
      await logx(`payment ok ${uid} order=${o.order_id} plan=${o.plan} amount=${o.amount}${auto ? ' (auto)' : ''}`);
      funnel('paid');
      funnel('revenue', int(o.amount));
      for (const a of await getAllAdmins())
        await api.send(a, `💰 Payment received${auto ? ' (auto-verified)' : ''}\nUser: ${escHtml(o.first || '-')} (@${escHtml(o.user || '-')})\nID: <code>${uid}</code>\nPlan: ${escHtml(o.plan)} — ₹${o.amount}\nOrder: <code>${o.order_id}</code>`, { html: true });
      await api.send(o.chat || uid,
        `🎉 <b>Payment Verified!</b>\n\n✅ Your payment of ₹${o.amount} has been confirmed.\n📋 Plan: ${escHtml(o.plan)}\n🆔 Order ID: <code>${o.order_id}</code>\n\nThank you! Your plan is active — ⭐ Premium included (multi-file links, folders, custom thumbnail).\nSend /videos to start watching 🎬`,
        { html: true });
      return true;
    }
    onCb(/^vid_verify$/, async e => {
      await e.answer();
      const chatId = e.chatId, raw = await db.get(`vid_order:${e.uid}`);
      if (!raw) return api.send(chatId, '❌ No payment found. Please start again with /videos');
      const o = { chat: chatId, first: e.from.first_name || '-', user: e.from.username || '-', ...JSON.parse(raw) };
      const checking = await api.send(chatId, '🔍 Checking payment status...');
      const res = await paymentStatus(o, e.uid);
      await checking?.delete();
      if (res == null) return api.send(chatId, '❌ Error checking payment status.\n\nPlease try again later or contact support.');
      if (res === 'success') return paymentDone(e.uid, o, false);
      if (res === 'FAILURE') return api.send(chatId, '❌ <b>Payment Failed</b>\n\nYour payment was not successful. Please try again.', { html: true });
      await api.send(chatId,
        `⏳ <b>Payment Pending</b>\n\nYour payment has not been confirmed yet.\nPlease complete the payment and click verify again.\n\nOrder ID: <code>${o.order_id}</code>`,
        { html: true, buttons: [[Button.inline("✅ I've Paid - Verify", 'vid_verify')]] });
    });

    // Every cron minute: open orders from the last 30 min are checked with the payment worker, so a
    // user who paid but never pressed Verify is activated anyway; one nudge after 3 min if still pending.
    // ponytail: 8 checks per minute — plenty for ~25 orders a day; raise if orders grow a lot.
    // Every 5 min (cron): delete /videos messages older than VIDEO_DELETE_HOURS, and all of them for a
    // user whose paid plan / Premium ended after they were sent (videos don't outlive the plan).
    // ponytail: 12 users per run, one deleteMessages call per 100 messages; raise if it falls behind.
    videoCleanTick = async () => {
      const hours = (await runtime()).VIDEO_DELETE_HOURS;
      if (!hours) return;
      const now = Math.floor(nowS()), cut = now - hours * 3600;
      const rows = await db.all(`SELECT id, vmsgs, vdel_at, sub_until, premium_until FROM users
        WHERE vdel_at IS NOT NULL AND (vdel_at <= ?1 OR MAX(COALESCE(sub_until, 0), COALESCE(premium_until, 0)) BETWEEN vdel_at AND ?2)
        ORDER BY vdel_at LIMIT 12`, cut, now);
      const st = [];
      let calls = 0;
      for (const u of rows) {
        let list = [];
        try { list = JSON.parse(u.vmsgs || '[]'); } catch {}
        const end = Math.max(int(u.sub_until), int(u.premium_until));
        const ended = end > 0 && end <= now && end >= int(u.vdel_at);
        const del = list.filter(m => ended || m[2] <= cut);
        const keep = list.filter(m => !del.includes(m) && m[2] > now - 47 * 3600);
        const byChat = new Map();
        for (const [chat, id] of del) byChat.set(chat, [...(byChat.get(chat) || []), id]);
        for (const [chat, ids] of byChat)
          for (let i = 0; i < ids.length && calls < 20; i += 100, calls++) await api.call('deleteMessages', { chat_id: chat, message_ids: ids.slice(i, i + 100) });
        st.push(db.q('UPDATE users SET vmsgs = ?, vdel_at = ? WHERE id = ?', keep.length ? JSON.stringify(keep) : null, keep.length ? Math.min(...keep.map(m => m[2])) : null, u.id));
        if (calls >= 20) break;
      }
      if (st.length) await db.batch(st);
    };

    // ---- Videos Mini App (/app): a swipe feed of the videos Telegram already has (videos.file_id) ----
    // Same access rules as /videos: free mode / paid / Premium / admin = unlimited, everyone else the
    // daily free videos (the trial starts on first open). Free videos are counted when handed out.
    async function pickVideos(n) {
      // a random point in md5 order, then the next n: random enough, and reads only ~n rows
      const start = [...crypto.getRandomValues(new Uint8Array(16))].map(b => b.toString(16).padStart(2, '0')).join('');
      // only the /videos pool (url set) — the table also keeps file_ids of files users sent the bot (their
      // own TeraBox links, no url), which must never show up in someone else's feed. Videos someone's
      // app reported as broken (store app_bad:<md5>) are skipped.
      const ok = "url IS NOT NULL AND file_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM store WHERE key = 'app_bad:' || md5)";
      let rows = await db.all(`SELECT md5, file_id FROM videos WHERE md5 >= ? AND ${ok} ORDER BY md5 LIMIT ?`, start, n);
      if (rows.length < n) rows = rows.concat(await db.all(`SELECT md5, file_id FROM videos WHERE ${ok} ORDER BY md5 LIMIT ?`, n - rows.length));
      return [...new Map(rows.map(r => [r.md5, r])).values()];
    }
    appFeed = async uid => {
      const ctx = await loadCtx(uid), access = await hasAccess(uid, ctx), daily = (await runtime()).DAILY_FREE_VIDEOS;
      let n = 10, left = null, save = {};
      if (access !== true) {
        const fresh = !ctx.state.trial_start_time;
        const f = fresh ? (daily > 0 ? { limit: daily, used: 0, daily: true } : { limit: TRIAL, used: 0, daily: false }) : (ctx.freeInfo || freeInfo(ctx.state, daily));
        n = Math.max(0, Math.min(10, f.limit - f.used));
        left = f.limit - f.used - n;
        if (n) save = { trial_n: f.used + n, ...(f.daily ? { free_day: ymd() } : {}), ...(fresh ? { trial_start_time: nowS() } : {}) };
        if (n && fresh) funnel('trials');
      }
      // getFile is slow the first time for a file (Telegram fetches it: 0.6–9 s) — and a video without
      // its path waits for that when played. All are asked at once, for at most 3.5 s: the ready ones
      // go first with the path signed into the link; the rest follow (Telegram keeps preparing them,
      // so by the time they're played the lookup is quick).
      const picked = n ? await pickVideos(n) : [];
      const cap = new Promise(r => setTimeout(r, 3500, null));
      const paths = await Promise.all(picked.map(v => Promise.race([api.call('getFile', { file_id: v.file_id }).then(g => (g.ok ? g.result.file_path : null), () => null), cap])));
      const ok = picked.map((v, i) => [v.md5, paths[i]]).sort((a, b) => !a[1] - !b[1]);
      const ids = ok.map(([id]) => id);
      if (ids.length && save.trial_n != null) await setState(uid, { ...save, trial_n: save.trial_n - n + ids.length });
      if (ids.length) funnel('app_videos', ids.length);
      const exp = Math.floor(nowS()) + 50 * 60; // Telegram keeps a file path valid ≥1h; the app asks for more as you swipe
      const videos = await Promise.all(ok.map(async ([id, p]) => ({ id, d: await sign(env.WEBHOOK_SECRET, `dl:${uid}:${id}`), src: p ? `/app/v/${id}?e=${exp}&p=${encodeURIComponent(p)}&t=${await sign(env.WEBHOOK_SECRET, `app:${id}:${exp}:${p}`)}` : `/app/v/${id}?e=${exp}&t=${await sign(env.WEBHOOK_SECRET, `app:${id}:${exp}`)}` })));
      // the paywall (shown after the last free video): the plans as on the bot's menu, and when the
      // daily free videos come back (midnight in TZ)
      let wall = null;
      if (access !== true && left === 0) {
        funnel('app_wall');
        const plans = ((await getPlans())?.plans || []).filter(p => p.status === 'active').sort((x, y) => x.price - y.price);
        const perDay = p => p.price / p.validity_days, best = plans.reduce((x, p) => (!x || perDay(p) < perDay(x) ? p : x), null);
        const [h, mi, se] = ymdHMS().slice(11).split(':').map(Number);
        wall = {
          daily, resetIn: 86400 - (h * 3600 + mi * 60 + se),
          plans: plans.map(p => ({ id: int(p.id), name: String(p.name), price: +p.price, days: int(p.validity_days), save: Math.round((1 - perDay(p) / perDay(plans[0])) * 100), best: plans.length > 1 && p === best })),
        };
      }
      return { ok: true, unlimited: access === true, left, videos, wall };
    };
    // ⬇️ in the app: that video into the user's chat (by file_id, instant) — like /videos: spoiler,
    // no forwarding, auto-deleted. The feed signed the id for this user (d), so only videos the app
    // already gave them; not counted again.
    appSend = async (uid, id) => {
      const fid = (await db.one('SELECT file_id FROM videos WHERE md5 = ?', id))?.file_id;
      if (!fid) return { ok: false };
      const hours = (await runtime()).VIDEO_DELETE_HOURS;
      const r = await api.call('sendVideo', { chat_id: uid, video: fid, has_spoiler: true, protect_content: true, supports_streaming: true, ...(hours ? { caption: `⏳ Auto-deletes from this chat in ${hours}h` } : {}), ...readyMarkup });
      if (!r.ok) return { ok: false };
      funnel('app_dl');
      if (hours) await setState(uid, trackMsg({ vmsgs: (await db.one('SELECT vmsgs FROM users WHERE id = ?', int(uid)))?.vmsgs }, uid, r));
      return { ok: true };
    };
    // 🧪 /app2 (admins only, separate from /app): the pool's links played straight from TeraBox — 200
    // per fetch, cached in the phone. No file_id, no D1 reads or writes.
    appLinks = async () => (await getJ(`${pool()}/?random=200`))?.links || [];
    on(/^\/app2$/, async m => {
      if (!m.isPrivate) return;
      await m.reply('🧪 **Videos App — links test** (admins only)\nVideos play straight from the pool\'s TeraBox links; nothing is saved.', { buttons: [[Button.webapp('🧪 Open links test', `${origin}/app2`)]] });
    }, ADMIN);
    on(/^\/app$/, async m => {
      if (!(await appAllowed(m.uid))) return; // not public yet: no reply, like any unknown command
      if (!m.isPrivate) return m.reply('Open the Videos App in a private chat with the bot.');
      await m.reply('🎬 **Videos App** (beta)\nSwipe up for the next video.', { buttons: [[Button.webapp('🎬 Open Videos App', `${origin}/app`)]] });
    });

    ordersTick = async () => {
      const now = Math.floor(nowS());
      const rows = await db.all("SELECT key, value FROM store WHERE key GLOB 'vid_order:*' AND expires_at > ?", now);
      let budget = 8;
      for (const { key, value } of rows) {
        let o; try { o = JSON.parse(value); } catch { continue; }
        const uid = int(key.slice(10)), age = now - int(o.at);
        if (!o.at || age < 60 || age > 1800 || budget-- <= 0) continue;
        const res = await paymentStatus(o, uid);
        if (res === 'success') { await paymentDone(uid, o, true); continue; }
        if (res === 'FAILURE') { await db.del(key); continue; }
        if (age >= 180 && !o.nudged) {
          await db.set(key, JSON.stringify({ ...o, nudged: 1 }), { ex: 86400 - age });
          await api.send(o.chat || uid, `⏳ <b>Payment not completed yet</b>\n\nYour <b>${escHtml(o.plan)}</b> plan (₹${o.amount}) is waiting. Finish the payment in your UPI app — it activates automatically.\n\nLink expired? Pick the plan again 👇`,
            { html: true, buttons: [[Button.inline("✅ I've Paid - Verify", 'vid_verify')], [Button.inline('📋 Show plans', 'vid_plans')]] });
        }
      }
    };
    onCb(/^vid_plans$/, async e => { await e.answer(); await planView(e.chatId, e.uid); });

    // Paid /videos plans: a reminder ~2h before the end (renew / upgrade) and one when it ends.
    // users.sub_rem remembers what was sent; a new sub_until clears it (setState).
    subReminders = async () => {
      const now = Math.floor(nowS());
      const rows = await db.all("SELECT id, sub_until, sub_rem FROM users WHERE sub_until BETWEEN ? AND ? AND (sub_rem IS NULL OR (sub_rem = 'soon' AND sub_until <= ?))", now - 86400, now + 7200, now);
      const done = { soon: [], ended: [] };
      for (const r of rows.slice(0, 10)) { // ponytail: 10 per run (each plans menu is 1-2 Telegram calls)
        const ended = r.sub_until <= now, mins = Math.max(1, Math.round((r.sub_until - now) / 60));
        // before the end only a heads-up: a second plan can't be bought while one is active
        if (ended) await showPlans(r.id, '⏰ <b>Your /videos plan has ended.</b>\nRenew now to keep watching — longer plans save more per day:');
        else await api.send(r.id, `⏳ <b>Your /videos plan ends in ${mins >= 60 ? `${Math.round(mins / 60)} hour(s)` : `${mins} min`}</b> (${dmyHM(r.sub_until)}).\nYou can renew as soon as it ends — we'll send you the plans then.`, { html: true });
        done[ended ? 'ended' : 'soon'].push(r.id);
      }
      for (const [stage, ids] of Object.entries(done))
        if (ids.length) await db.run(`UPDATE users SET sub_rem = ? WHERE id IN (${ids.map(() => '?').join(',')})`, stage, ...ids);
    };

    on(/^\/videosfreemode(?:\s+(on|off))?$/, async (m, g) => {
      if (!(await isAdmin(m.uid))) return m.reply('Not authorized.');
      const arg = (g[1] || '').toLowerCase();
      if (!arg) return m.reply(`/videos free mode is **${(await freeMode()) ? 'ON' : 'OFF'}**`);
      await db.set(FREE_MODE_KEY, arg === 'on' ? '1' : '0');
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
    if (m.isPrivate && !text.startsWith('/') && getUrl(text)) {
      // several links in one message: each one in turn (the first MAX_LINKS)
      const urls = getUrls(text);
      for (const url of urls.slice(0, MAX_LINKS)) await handleMessage(urls.length > 1 ? { ...m, text: url } : m);
      if (urls.length > MAX_LINKS) await m.reply(`ℹ️ I took the first **${MAX_LINKS}** links. Send the other **${urls.length - MAX_LINKS}** in another message.`);
    }
  }

  async function onCallback(q) {
    const e = wrapCb(q);
    for (const [re, fn] of CBS) if (re.test(e.data)) await fn(e);
    if (!e.answered) await e.answer();
  }

  // ---------------- cron: broadcasts, premium reminders ---------------- //

  // With the SENDER service binding (cloudflare/sender), each cron minute hands BC_WAVES batches of
  // BC_CHUNK users to the sender worker, one every BC_GAP ms: 40 per 1.6s = 25 messages/second, under
  // Telegram's ~30/s broadcast limit. Without it, the cron sends BC_CHUNK itself (40/minute).
  const BC_CHUNK = 40, BC_WAVES = 30, BC_GAP = 1600; // 30 waves ≈ 54s, measured on Cloudflare (33 took 58s)
  const BC_BATCH = env.SENDER ? BC_CHUNK * BC_WAVES : BC_CHUNK; // users per cron minute
  const bcStopBtn = id => [[Button.inline('🛑 Stop broadcast', `bc_stop_${id}`)]];
  function bcProgress(b, S = b.sent, F = b.failed, state = 'running') {
    const doneN = S + F, total = Math.max(b.total, doneN, 1), pct = Math.min(100, Math.floor((doneN / total) * 100));
    const left = Math.max(total - doneN, 0), mins = Math.ceil(left / BC_BATCH);
    const head = state === 'running' ? `📢 **Broadcast #${b.id} — running**` : state === 'stopped' ? `🛑 **Broadcast #${b.id} — stopped**` : `✅ **Broadcast #${b.id} — complete**`;
    return `${head}\n\n\`${progressBar(doneN, total, 12)}\` **${pct}%**\n\n` +
      `✅ Sent: **${S}**\n❌ Failed: **${F}**${F ? ' (blocked/deleted accounts)' : ''}\n👥 Done: **${doneN}** / ${total}` +
      (state === 'running' ? `\n⏱ About **${mins >= 60 ? `${Math.floor(mins / 60)}h ${mins % 60}m` : `${mins} min`}** left (${BC_BATCH} users/minute)` : '');
  }

  async function broadcastTick() {
    const b = await db.one('SELECT * FROM broadcasts WHERE done = 0 AND send_at <= ? ORDER BY id LIMIT 1', Math.floor(nowS()));
    if (!b) return false; // false = nothing sent this minute
    // one cron at a time: a minute's run can take ~55s, the lock keeps the next one from overlapping
    if (!(await db.set('bc_lock', b.id, { ex: 75, nx: true }))) return true;
    try {
      // users in id order after the cursor (the users primary key: reads only this batch)
      const ids = (await db.all('SELECT id FROM users WHERE id > ? ORDER BY id LIMIT ?', int(b.cursor), BC_BATCH)).map(r => r.id);
      const users = ids.filter(u => !(b.exclude && u === b.exclude)).map(String);
      const done = ids.length < BC_BATCH;
      // reserve this range first, so nobody gets the message twice even if a run is cut short
      if (ids.length) await db.run('UPDATE broadcasts SET cursor = ? WHERE id = ?', String(ids.at(-1)), b.id);
      const payload = { mode: b.mode, text: b.mode === 'forward' ? null : md(b.text), from_chat: b.from_chat, msg_id: b.msg_id };
      let sent = 0, failed = 0;
      if (env.SENDER) {
        const chunks = [];
        for (let i = 0; i < users.length; i += BC_CHUNK) chunks.push(users.slice(i, i + BC_CHUNK));
        const t0 = Date.now();
        const results = await Promise.all(chunks.map(async (chunk, i) => {
          await new Promise(r => setTimeout(r, Math.max(0, t0 + i * BC_GAP - Date.now())));
          // a stop pressed mid-run halts the remaining waves
          if (i && i % 5 === 0 && (await db.one('SELECT done FROM broadcasts WHERE id = ?', b.id))?.done) return { sent: 0, failed: 0, skipped: chunk.length };
          try {
            const r = await env.SENDER.fetch('https://sender/send', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...payload, token: env.BOT_TOKEN, api: env.TG_API, users: chunk }) });
            return r.ok ? await r.json() : { sent: 0, failed: chunk.length };
          } catch (e) {
            console.log('sender failed:', e.message);
            return { sent: 0, failed: chunk.length };
          }
        }));
        for (const r of results) { sent += r.sent || 0; failed += r.failed || 0; }
      } else {
        for (const member of users) {
          const r = b.mode === 'forward'
            ? await api.call('copyMessage', { chat_id: member, from_chat_id: b.from_chat, message_id: b.msg_id })
            : await api.call('sendMessage', { chat_id: member, text: payload.text, parse_mode: 'HTML' });
          r.ok ? sent++ : failed++;
        }
      }
      const stopped = (await db.one('SELECT done FROM broadcasts WHERE id = ?', b.id))?.done;
      await db.run('UPDATE broadcasts SET sent = sent + ?, failed = failed + ?, done = ? WHERE id = ?', sent, failed, done || stopped ? 1 : 0, b.id);
      if (stopped) return true; // the Stop button already showed the final state
      return await finishTick(b, sent, failed, done);
    } finally {
      await db.del('bc_lock');
    }
  }

  async function finishTick(b, sent, failed, done) {
    const S = b.sent + sent, F = b.failed + failed;
    // the status message is the bot's own reply for /broadcast and /broadcast_legacy; for /announce it is the
    // owner's command message, which the bot can't edit — announcements report only at the end
    if (!done) {
      if (b.kind !== 'announce') await api.edit(b.status_chat, b.status_msg, bcProgress(b, S, F), { buttons: bcStopBtn(b.id) });
      return true;
    }
    if (b.kind === 'broadcast') {
      db.bump('broadcasts');
      await api.edit(b.status_chat, b.status_msg, bcProgress(b, S, F, 'complete'), { buttons: [] });
    } else if (b.kind === 'legacy') {
      await api.edit(b.status_chat, b.status_msg, bcProgress(b, S, F, 'complete'), { buttons: [] });
    } else await api.send(b.status_chat, `**Announcement sent!**\nSent: ${S}\nFailed: ${F}`, { replyTo: b.status_msg });
    return true;
  }

  // referral.py referral_sweep_once — 3d / 1d / expired reminders. users.reminded remembers the last
  // one sent (grant/addPremium clear it); the partial index means only premium rows are read.
  async function reminderSweep() {
    const now = Math.floor(nowS()), btn = [[Button.inline('Renew Premium', 'renew_info')]];
    const rows = await db.all("SELECT id, premium_until, reminded FROM users WHERE premium_until < ? AND (reminded IS NULL OR reminded <> 'expired')", now + 3 * 86400);
    let budget = 15; // keeps each cron run inside the free-plan subrequest limit
    for (const { id, premium_until: e, reminded } of rows) {
      if (budget <= 0) break;
      const rem = e - now;
      const [stage, text] = rem <= 0 ? ['expired', 'Your Premium access has expired.']
        : rem <= 86400 ? (reminded === '1d' ? [] : ['1d', 'Your Premium access expires in 1 day.'])
        : reminded ? [] : ['3d', 'Your Premium access expires in 3 days.'];
      if (!stage) continue;
      budget--;
      await db.run('UPDATE users SET reminded = ? WHERE id = ?', stage, id);
      await api.send(id, `⭐ Premium Reminder\n\n${text}\n\nDon't lose your Premium benefits.`, { buttons: btn });
    }
  }

  async function cron(minute, hour) {
    const broadcasting = await broadcastTick();
    // uploads share the free plan's 50-subrequest budget: skip minutes with a broadcast batch or reminders
    if (uploadTick && !broadcasting && minute !== 0) {
      try { await uploadTick(); } catch (e) { console.log('uploadTick', e.message); }
    }
    // payments: every minute; renew reminders at :30 (away from the :00 premium reminders and cleanup)
    if (videoCleanTick && !broadcasting && minute % 5 === 2) {
      try { await videoCleanTick(); } catch (e) { console.log('videoCleanTick', e.message); }
    }
    if (ordersTick && !broadcasting) {
      try { await ordersTick(); } catch (e) { console.log('ordersTick', e.message); }
    }
    if (subReminders && !broadcasting && minute === 30) {
      try { await subReminders(); } catch (e) { console.log('subReminders', e.message); }
    }
    if (minute === 0) {
      await reminderSweep();
      const now = Math.floor(nowS());
      const cutHour = Number(ymdHMS(now - 48 * 3600).replace(/\D/g, '').slice(0, 10)); // panel graph: keep 48h
      const cutDay = ymdHMS(now - 40 * 86400).slice(0, 10); // /funnel shows up to 31 days
      await db.batch([
        db.q('DELETE FROM store WHERE expires_at <= ?', now),
        db.q('DELETE FROM activity WHERE hour < ?', cutHour),
        db.q("DELETE FROM counters WHERE day GLOB '[0-9]*' AND day < ?", cutDay),
      ]);
      if (hour === 0) { // once a day: popular links back to the top 500, exact user total
        await db.batch([
          db.q("DELETE FROM counters WHERE day = 'link' AND name NOT IN (SELECT name FROM counters WHERE day = 'link' ORDER BY n DESC LIMIT 500)"),
          db.q("INSERT INTO counters (day, name, n) VALUES ('all', 'total_users', (SELECT COUNT(*) FROM users)) ON CONFLICT (day, name) DO UPDATE SET n = excluded.n"),
        ]);
      }
    }
    await db.flush(true);
  }

  // Bot made admin of / removed from a channel → tell the owner the channel ID (for VIDEOS_CHANNEL)
  async function onChatMember(u) {
    if (u.chat?.type !== 'channel') return;
    const st = u.new_chat_member?.status, id = u.chat.id, title = u.chat.title || '-';
    if (st === 'administrator') {
      await db.set(`bot_channel:${id}`, title);
      await api.send(OWNER_ID, `📢 Bot is now admin in channel **${escapeMarkdown(title)}**\nID: \`${id}\`${u.new_chat_member.can_post_messages ? '' : '\n⚠️ Give it "Post messages" permission.'}\n\nAdd it to VIDEOS_CHANNEL in wrangler.toml to upload /videos there.`);
    } else if (st === 'left' || st === 'kicked' || st === 'member') {
      await db.del(`bot_channel:${id}`);
      await api.send(OWNER_ID, `📢 Bot is no longer admin in channel **${escapeMarkdown(title)}** (\`${id}\`).`);
    }
  }

  // The Videos App's live log: one silent message per app session to APP_LOG_CHAT (default the
  // owner), edited as the user watches. The app keeps the message id (signed for that user) — nothing
  // is stored. ponytail: a logged-in user could open many sessions = many messages; cap if abused.
  const appLive = async (uid, user, b) => {
    const chat = (await runtime()).APP_LOG_CHAT[0] ?? String(OWNER_ID);
    if (!chat || chat === '0') return { ok: false };
    const n = x => Math.max(0, Math.min(int(x), 1e6)), secs = n(b.secs), name = [user.first_name, user.last_name].filter(Boolean).join(' ');
    const text = `🎬 <b>Videos App</b> — ${userLink(uid, name)}${user.username ? ` @${escHtml(user.username)}` : ''} <code>${int(uid)}</code>\n` +
      `${b.plan === 'free' ? '🆓 Free' : '♾️ Unlimited'} · ${b.end ? '⚪ closed' : '🟢 watching now'}\n\n` +
      `▶️ Videos watched: <b>${n(b.n)}</b>\n⏱ Time: ${Math.floor(secs / 60)}m ${secs % 60}s\n⬇️ Downloads: ${n(b.dl)} · ❤️ Likes: ${n(b.lk)}` +
      (b.mode === 'links' ? `\n❌ Didn't load: <b>${n(b.fail)}</b> · 🧪 links test` : '') +
      (b.wall ? '\n🔒 Reached the paywall' : '') + (b.buy ? `\n💳 Tapped the ₹${n(b.buy)} plan → payment QR` : '');
    const mid = int(b.mid);
    if (mid && b.sig === (await sign(env.WEBHOOK_SECRET, `live:${uid}:${mid}`))) {
      await api.call('editMessageText', { chat_id: chat, message_id: mid, text, parse_mode: 'HTML', disable_web_page_preview: true });
      return { ok: true };
    }
    const r = await api.call('sendMessage', { chat_id: chat, text, parse_mode: 'HTML', disable_notification: true, disable_web_page_preview: true });
    if (!r.ok) return { ok: false };
    return { ok: true, mid: r.result.message_id, sig: await sign(env.WEBHOOK_SECRET, `live:${uid}:${r.result.message_id}`) };
  };
  // the Videos Mini App: admins + APP_TESTERS only until /configset VIDEOS_APP_PUBLIC 1
  const appAllowed = async uid => {
    if (await isAdmin(uid)) return true;
    const rt = await runtime();
    return rt.VIDEOS_APP_PUBLIC === 1 || rt.APP_TESTERS.includes(String(uid));
  };
  return { onMessage, onCallback, onChatMember, cron, bootCard, appAllowed, appFeed: uid => (appFeed ? appFeed(uid) : { ok: false, error: 'off' }), appSend: (uid, id) => (appSend ? appSend(uid, id) : { ok: false }), appLive, isAdmin, appLinks: () => (appLinks ? appLinks() : []) };
}
