// TeraBox HLS proxy — one file, paste it into a Cloudflare Worker (Dashboard → Workers → Edit code).
// Same URL format as the old proxy, so the bot only needs its address:
//   GET /?hls=<TeraBox streaming.m3u8 URL>   → the playlist, every line pointing back at this worker
//   GET /?seg=<segment URL>&k=<signature>    → one video chunk (Range passed through)
// Settings (Worker → Settings → Variables and Secrets):
//   SECRET  (required, Secret) any long random text — signs the chunk links this worker writes, so
//           nobody can use it as an open proxy for other sites
//   COOKIE  (required for full videos, Secret) TeraBox ndus cookie(s): "ndus=Abc…" or just "Abc…";
//           several comma-separated = one picked at random per request. Without it TeraBox plays
//           only a ~30 s preview.

// playlists are fetched only from TeraBox's own sites (chunk links are checked by signature instead)
const HOSTS = ['1024tera.com', 'terabox.com', 'teraboxapp.com', 'freeterabox.com', '4funbox.com', 'mirrobox.com', 'nephobox.com', 'momerybox.com', 'tibibox.com', 'teraboxlink.com', 'terasharelink.com'];
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'range', 'access-control-expose-headers': 'content-length, content-range' };

const enc = new TextEncoder();
async function sig(secret, text) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const b = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(text)));
  return [...b.slice(0, 12)].map(x => x.toString(16).padStart(2, '0')).join('');
}
const teraHost = u => { try { const h = new URL(u).hostname; return HOSTS.some(d => h === d || h.endsWith('.' + d)); } catch { return false; } };
const cookie = env => { const c = String(env.COOKIE || '').split(',').map(x => x.trim()).filter(Boolean); if (!c.length) return {}; const v = c[Math.floor(Math.random() * c.length)]; return { cookie: v.includes('=') ? v : `ndus=${v}` }; };
const upstream = (env, extra = {}) => ({ 'user-agent': UA, referer: 'https://www.terabox.com/', ...cookie(env), ...extra });
const fail = (status, text) => new Response(text, { status, headers: CORS });

// a link this worker writes: playlists again through ?hls=, everything else through ?seg=
async function link(env, origin, u) {
  return `${origin}/?${/m3u8/i.test(new URL(u).pathname) ? 'hls' : 'seg'}=${encodeURIComponent(u)}&k=${await sig(env.SECRET, u)}`;
}

async function playlist(env, origin, src) {
  // TeraBox sometimes answers {"errno":400141} ("needs verify"): wait 1 s and ask again (≤5 times)
  let r, text;
  for (let i = 0; i < 5; i++) {
    r = await fetch(src, { headers: upstream(env), signal: AbortSignal.timeout(15000) });
    text = await r.text();
    if (!text.includes('400141') || text.startsWith('#EXTM3U')) break;
    await new Promise(ok => setTimeout(ok, 1000));
  }
  if (!r.ok || !text.startsWith('#EXTM3U')) return fail(502, 'TeraBox: ' + r.status);
  const base = r.url || src; // after redirects
  const out = [];
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (!t) out.push(line);
    else if (!t.startsWith('#')) out.push(await link(env, origin, new URL(t, base).href));
    // keys / maps / alternative tracks carry their link in URI="…"
    else if (/URI="/.test(t)) {
      const m = /URI="([^"]+)"/.exec(t);
      out.push(t.replace(m[0], `URI="${await link(env, origin, new URL(m[1], base).href)}"`));
    } else out.push(line);
  }
  return new Response(out.join('\n'), { headers: { ...CORS, 'content-type': 'application/vnd.apple.mpegurl', 'cache-control': 'no-store' } });
}

async function segment(env, req, src) {
  const range = req.headers.get('range');
  const r = await fetch(src, { headers: upstream(env, range ? { range } : {}), signal: AbortSignal.timeout(30000) });
  if (!r.ok) return fail(r.status === 404 || r.status === 403 ? r.status : 502, 'TeraBox: ' + r.status);
  const h = new Headers(CORS);
  for (const k of ['content-type', 'content-length', 'content-range', 'accept-ranges']) if (r.headers.has(k)) h.set(k, r.headers.get(k));
  // chunks never change: the phone may keep them for a while
  h.set('cache-control', 'public, max-age=3600');
  return new Response(r.body, { status: r.status, headers: h });
}

export default {
  async fetch(req, env) {
    if (req.method === 'OPTIONS') return new Response(null, { headers: { ...CORS, 'access-control-allow-methods': 'GET, HEAD, OPTIONS' } });
    if (req.method !== 'GET' && req.method !== 'HEAD') return fail(405, 'GET only');
    if (!env.SECRET) return fail(500, 'Set the SECRET variable');
    const url = new URL(req.url), hls = url.searchParams.get('hls'), seg = url.searchParams.get('seg'), k = url.searchParams.get('k');
    try {
      if (hls) {
        if (!/^https:\/\//.test(hls) || !(teraHost(hls) || k === (await sig(env.SECRET, hls)))) return fail(403, 'Not allowed');
        return await playlist(env, url.origin, hls);
      }
      if (seg) {
        if (!/^https:\/\//.test(seg) || k !== (await sig(env.SECRET, seg))) return fail(403, 'Bad link');
        return await segment(env, req, seg);
      }
      return new Response('ok', { headers: CORS }); // health check
    } catch (e) {
      return fail(502, 'Proxy error: ' + (e.name === 'TimeoutError' ? 'timeout' : e.message));
    }
  },
};
