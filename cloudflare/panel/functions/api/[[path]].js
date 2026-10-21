// Panel backend (Pages Function): password login → signed session cookie; every other /api/* call is
// forwarded to the bot worker's /panel-api/* through the BOT service binding.
// Secret: PANEL_PASSWORD (same value as the bot worker's PANEL_PASSWORD).

const enc = new TextEncoder();
const DAY = 86400;

async function hmac(secret, data) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(data))))).replace(/[+/=]/g, c => ({ '+': '-', '/': '_', '=': '' })[c]);
}
const sameText = (a, b) => { // constant-time compare
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
};
async function session(env) {
  const exp = Math.floor(Date.now() / 1000) + 7 * DAY;
  return `${exp}.${await hmac(env.PANEL_PASSWORD, `panel:${exp}`)}`;
}
async function validSession(env, req) {
  const c = (req.headers.get('cookie') || '').match(/(?:^|;\s*)panel=([^;]+)/)?.[1];
  if (!c) return false;
  const [exp, sig] = c.split('.');
  return +exp > Date.now() / 1000 && sameText(sig || '', await hmac(env.PANEL_PASSWORD, `panel:${exp}`));
}
const cookie = (v, maxAge) => `panel=${v}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAge}`;

export async function onRequest({ request: req, env, params }) {
  const path = (params.path || []).join('/');
  if (!env.PANEL_PASSWORD) return Response.json({ ok: false, error: 'PANEL_PASSWORD is not set for this Pages project.' }, { status: 500 });

  if (path === 'login' && req.method === 'POST') {
    const { password = '' } = await req.json().catch(() => ({}));
    if (!sameText(String(password), env.PANEL_PASSWORD)) {
      await new Promise(r => setTimeout(r, 800)); // slows down guessing
      return Response.json({ ok: false, error: 'Wrong password' }, { status: 401 });
    }
    return Response.json({ ok: true }, { headers: { 'set-cookie': cookie(await session(env), 7 * DAY) } });
  }
  if (path === 'logout') return Response.json({ ok: true }, { headers: { 'set-cookie': cookie('', 0) } });

  if (!(await validSession(env, req))) return Response.json({ ok: false, error: 'login' }, { status: 401 });
  return env.BOT.fetch(`https://bot/panel-api/${path}`, {
    method: req.method,
    headers: { 'content-type': 'application/json', 'x-panel-key': env.PANEL_PASSWORD },
    body: req.method === 'POST' ? await req.text() : undefined,
  });
}
