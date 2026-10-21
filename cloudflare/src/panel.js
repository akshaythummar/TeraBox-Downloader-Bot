// Admin panel API — called only by the Pages panel (cloudflare/panel) through a service binding,
// with the x-panel-key header = PANEL_PASSWORD secret. JSON in, JSON out.

import { makeApi } from './tg.js';

const BOT_TOKEN_KEY = 'panel:bot_token'; // a token set from the panel overrides the BOT_TOKEN secret
const BOT_ID_KEY = 'panel:bot_id';

export const COMMANDS = [
  ['start', 'Start the bot'], ['help', 'Main menu'], ['info', 'Your info & plan'], ['plan', 'Premium plans'],
  ['redeem', 'Redeem a gift card'], ['ref', 'Invite friends, earn Premium'], ['mystats', 'Your statistics'],
  ['mystatus', 'Premium / tag / stats'], ['history', 'Your history'], ['search', 'Search the library'],
  ['videos', 'Videos'], ['lang', 'Language'],
].map(([command, description]) => ({ command, description }));

let tokenCache = null;
// the token in use: panel override (D1) or the BOT_TOKEN secret; cached 30s per isolate
export async function botToken(env, db) {
  if (tokenCache && tokenCache.until > Date.now()) return tokenCache.v;
  const v = (await db.get(BOT_TOKEN_KEY)) || env.BOT_TOKEN;
  tokenCache = { v, until: Date.now() + 30000 };
  return v;
}

// webhook + command menu (what /setup did)
export async function setupWebhook(env, token, origin) {
  const api = makeApi(token, env.TG_API);
  const hook = await api.call('setWebhook', {
    url: `${origin}/webhook`, secret_token: env.WEBHOOK_SECRET, allowed_updates: ['message', 'callback_query', 'my_chat_member'], drop_pending_updates: false,
  });
  // scoped lists (e.g. left by another bot host) override the default one — clear them first
  for (const type of ['all_private_chats', 'all_group_chats', 'all_chat_administrators']) await api.call('deleteMyCommands', { scope: { type } });
  const cmds = await api.call('setMyCommands', { commands: COMMANDS });
  return { hook, cmds };
}

export async function panelApi(req, env, db, path) {
  if (!env.PANEL_PASSWORD || req.headers.get('x-panel-key') !== env.PANEL_PASSWORD) return Response.json({ error: 'forbidden' }, { status: 403 });
  const body = req.method === 'POST' ? await req.json().catch(() => ({})) : {};
  const origin = (env.PUBLIC_URL || '').replace(/\/$/, '');
  const token = await botToken(env, db);
  const api = makeApi(token, env.TG_API);
  const ok = (data = {}) => Response.json({ ok: true, ...data });
  const fail = (error, status = 400) => Response.json({ ok: false, error }, { status });

  switch (path) {
    case 'status': {
      const [me, wh, counts, bc, logs, cfgRows] = await Promise.all([
        api.call('getMe', {}),
        api.call('getWebhookInfo', {}),
        db.one(`SELECT (SELECT COUNT(*) FROM sets WHERE key = 'all_known_users') users,
                       (SELECT COUNT(*) FROM hashes WHERE key = 'premium_expiry' AND CAST(value AS INTEGER) > strftime('%s','now')) premium,
                       (SELECT value FROM kv WHERE key = 'maintenance_mode') maint,
                       (SELECT COUNT(*) FROM sorted_sets WHERE key = 'vid_ready') ready`),
        db.one('SELECT * FROM broadcasts ORDER BY id DESC LIMIT 1'),
        db.all("SELECT value FROM lists WHERE key = 'bot_log' ORDER BY position LIMIT 25"),
        db.all("SELECT key, value FROM kv WHERE key IN ('terabox_cfg:cookie', 'terabox_cfg:jstoken')"),
      ]);
      const today = new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10); // IST date, like the bot's funnel
      const funnel = Object.fromEntries((await db.all('SELECT field, value FROM hashes WHERE key = ?', `funnel:${today}`)).map(r => [r.field, +r.value]));
      const cfg = Object.fromEntries(cfgRows.map(r => [r.key.split(':')[1], r.value]));
      // last 24 hours, oldest first (IST hour keys, same as index.js trackActivity)
      const hours = Array.from({ length: 24 }, (_, i) => new Date(Date.now() + 5.5 * 3600e3 - (23 - i) * 3600e3).toISOString().replace(/\D/g, '').slice(0, 10));
      const ph = hours.map(() => '?').join(',');
      const days = [...new Set(hours.map(h => h.slice(0, 8)))];
      const [perHour, distinct, msgRows] = await Promise.all([
        db.all(`SELECT key, COUNT(*) n FROM sets WHERE key IN (${ph}) GROUP BY key`, ...hours.map(h => `act:${h}`)),
        db.one(`SELECT COUNT(DISTINCT member) n FROM sets WHERE key IN (${ph})`, ...hours.map(h => `act:${h}`)),
        db.all(`SELECT key, field, value FROM hashes WHERE key IN (${days.map(() => '?').join(',')})`, ...days.map(d => `msgs:${d}`)),
      ]);
      const users = Object.fromEntries(perHour.map(r => [r.key.slice(4), r.n]));
      const msgs = Object.fromEntries(msgRows.map(r => [r.key.slice(5) + r.field, +r.value]));
      const activity = hours.map(h => ({ hour: +h.slice(8), date: h.slice(0, 8), users: users[h] || 0, messages: msgs[h] || 0 }));
      const vfree = await db.get('videos_free_mode');
      const w = wh.result || {};
      return ok({
        bot: me.ok ? { id: me.result.id, username: me.result.username, name: me.result.first_name } : null,
        tokenError: me.ok ? null : me.description,
        tokenSource: (await db.get(BOT_TOKEN_KEY)) ? 'panel' : 'secret',
        webhook: { url: w.url || '', ours: !!w.url && w.url === `${origin}/webhook`, pending: w.pending_update_count || 0, lastError: w.last_error_message || null, lastErrorAt: w.last_error_date || null },
        running: !!w.url && w.url === `${origin}/webhook`,
        stats: { users: counts.users, premium: counts.premium, readyVideos: counts.ready, today: funnel },
        maintenance: String(env.MAINTENANCE_OFF) !== 'true' && counts.maint === '1',
        broadcast: bc ? { id: bc.id, kind: bc.kind, total: bc.total, sent: bc.sent, failed: bc.failed, done: !!bc.done } : null,
        terabox: { cookie: !!(cfg.cookie || env.TB_COOKIE), cookieFrom: cfg.cookie ? 'panel' : env.TB_COOKIE ? 'secret' : 'none', jstoken: (cfg.jstoken || env.JSTOKEN || '').slice(0, 10) },
        logs: logs.map(r => r.value),
        activity, activeUsers24h: distinct?.n || 0,
        videosFree: vfree == null ? String(env.VIDEOS_FREE_MODE) === 'true' : vfree === '1',
      });
    }

    case 'start': {
      if (!origin) return fail('PUBLIC_URL is not set in wrangler.toml');
      const r = await setupWebhook(env, token, origin);
      return r.hook.ok ? ok({ message: 'Bot started: webhook set to Cloudflare.' }) : fail(r.hook.description || 'setWebhook failed');
    }

    case 'stop': {
      const r = await api.call('deleteWebhook', {});
      return r.ok ? ok({ message: 'Bot stopped: webhook removed. Messages wait at Telegram for up to 24h.' }) : fail(r.description);
    }

    case 'token': {
      const t = String(body.token || '').trim();
      if (!/^\d+:[\w-]{30,}$/.test(t)) return fail('That does not look like a bot token.');
      const me = await makeApi(t, env.TG_API).call('getMe', {});
      if (!me.ok) return fail(`Telegram rejected the token: ${me.description}`);
      const prevId = (await db.get(BOT_ID_KEY)) || (await api.call('getMe', {})).result?.id;
      // a different bot can't use the old bot's saved video file_ids
      let cleared = false;
      if (prevId && String(prevId) !== String(me.result.id)) {
        await db.run("DELETE FROM sorted_sets WHERE key = 'vid_ready'");
        await db.run("DELETE FROM hashes WHERE key = 'vid_meta'");
        cleared = true;
        if (body.stopOld !== false) await api.call('deleteWebhook', {}); // the old bot stops answering
      }
      await db.set(BOT_TOKEN_KEY, t);
      await db.set(BOT_ID_KEY, me.result.id);
      tokenCache = null;
      const r = origin ? await setupWebhook(env, t, origin) : null;
      return ok({ message: `Now running @${me.result.username}.${cleared ? ' Saved video file_ids were cleared (new bot).' : ''}${r?.hook.ok ? ' Webhook set.' : ''}` });
    }

    case 'maintenance': {
      if (body.on) await db.set('maintenance_mode', '1');
      else await db.run("DELETE FROM kv WHERE key IN ('maintenance_mode', 'maintenance_mode:reason')");
      return ok({ message: `Maintenance ${body.on ? 'ON' : 'OFF'} (applies within a few seconds).` });
    }

    case 'videosfree': {
      await db.set('videos_free_mode', body.on ? '1' : '0');
      return ok({ message: `/videos free mode ${body.on ? 'ON — everyone gets /videos free' : 'OFF — trial / plans / premium as usual'} (applies immediately).` });
    }

    case 'broadcast': {
      const text = String(body.text || '').trim();
      if (!text) return fail('Write a message first.');
      if (await db.one('SELECT 1 FROM broadcasts WHERE done = 0 LIMIT 1')) return fail('A broadcast is already running — stop it first.');
      const owner = +env.OWNER_ID;
      const total = await db.scard('all_known_users');
      const status = await api.send(owner, `📢 Broadcast from the panel queued for **${total}** users.\nStarts within a minute — this message updates live.`);
      await db.run('INSERT INTO broadcasts (kind, mode, text, total, status_chat, status_msg) VALUES (?, ?, ?, ?, ?, ?)', 'broadcast', 'text', text, total, owner, status?.id ?? null);
      return ok({ message: `Queued for ${total} users. Progress is shown here and in your Telegram chat.` });
    }

    case 'stopbroadcast': {
      const rows = await db.all('SELECT id, status_chat, status_msg, sent, total FROM broadcasts WHERE done = 0');
      if (!rows.length) return fail('No broadcast is running.');
      await db.run('UPDATE broadcasts SET done = 1 WHERE done = 0');
      for (const r of rows) if (r.status_msg) await api.edit(r.status_chat, r.status_msg, `🛑 **Broadcast #${r.id} — stopped from the panel**\nSent: **${r.sent}** / ${r.total}`, { buttons: [] });
      return ok({ message: `Stopped ${rows.length} broadcast(s).` });
    }

    case 'terabox': {
      const slot = body.slot, value = String(body.value || '').trim();
      if (!['cookie', 'jstoken'].includes(slot) || !value) return fail('Pick cookie or jstoken and paste a value.');
      await db.set(`terabox_cfg:${slot}`, value);
      return ok({ message: `TeraBox ${slot} updated (applies within a few seconds).` });
    }

    default:
      return fail('unknown action', 404);
  }
}
