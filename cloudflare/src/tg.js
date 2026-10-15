// Telegram Bot API helpers. The Python bot used Telethon markdown (**b**, __i__,
// `code`, ```pre```, [t](url)); md() converts that to Bot API HTML so every
// message text could be copied over unchanged.

export const Button = {
  inline: (text, data) => ({ text, callback_data: String(data).slice(0, 64) }),
  url: (text, url) => ({ text, url }),
  webapp: (text, url) => ({ text, web_app: { url } }),
};

const escHtml = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

export function md(src) {
  const keep = [];
  const hold = html => `\u0000${keep.push(html) - 1}\u0000`;
  let s = String(src ?? '').replace(/\u0000/g, '')
    .replace(/\\([*_`[\]~|\\])/g, (_, c) => hold(escHtml(c)))
    .replace(/```(?:\w*\n)?([\s\S]*?)```/g, (_, c) => hold(`<pre>${escHtml(c)}</pre>`))
    .replace(/`([^`\n]+)`/g, (_, c) => hold(`<code>${escHtml(c)}</code>`));
  s = escHtml(s)
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, t, u) => `<a href="${u}">${t}</a>`)
    .replace(/\*\*([\s\S]+?)\*\*/g, '<b>$1</b>')
    .replace(/__([\s\S]+?)__/g, '<i>$1</i>')
    .replace(/~~([\s\S]+?)~~/g, '<s>$1</s>')
    .replace(/\|\|([\s\S]+?)\|\|/g, '<tg-spoiler>$1</tg-spoiler>');
  // placeholders can nest (an escaped _ inside `code`), so restore until none are left
  while (/\u0000\d+\u0000/.test(s)) s = s.replace(/\u0000(\d+)\u0000/g, (_, i) => keep[i]);
  return s;
}

export function makeApi(token, base = 'https://api.telegram.org') {
  let calls = 0;
  const call = async (method, body) => {
    calls++;
    try {
      const r = await fetch(`${base}/bot${token}/${method}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const j = await r.json();
      if (!j.ok) console.log(method, 'failed:', j.description);
      return j;
    } catch (e) {
      console.log(method, 'error:', e.message);
      return { ok: false, description: e.message };
    }
  };
  // text + {buttons, html, preview} -> Bot API fields; falls back to plain text
  // if Telegram rejects the formatting, so a stray marker never loses a reply.
  const textBody = (text, o = {}) => ({
    text: o.html ? String(text) : md(text),
    parse_mode: 'HTML',
    link_preview_options: { is_disabled: !o.preview },
    ...(o.buttons !== undefined ? { reply_markup: { inline_keyboard: o.buttons || [] } } : {}),
  });
  const withFallback = async (method, base, text, o) => {
    let r = await call(method, { ...base, ...textBody(text, o) });
    if (!r.ok && /parse entities/i.test(r.description || '')) {
      const b = textBody(text, o);
      delete b.parse_mode;
      b.text = String(text);
      r = await call(method, { ...base, ...b });
    }
    return r;
  };
  const api = {
    call,
    async send(chat_id, text, o = {}) {
      const r = await withFallback('sendMessage', { chat_id, ...(o.replyTo ? { reply_parameters: { message_id: o.replyTo, allow_sending_without_reply: true } } : {}) }, text, o);
      return r.ok ? api.msg(chat_id, r.result.message_id) : null;
    },
    edit: (chat_id, message_id, text, o = {}) => withFallback('editMessageText', { chat_id, message_id }, text, o),
    // handle on a sent message: .edit() / .delete()
    msg: (chat_id, id) => ({
      id,
      edit: (text, o) => api.edit(chat_id, id, text, o),
      delete: () => call('deleteMessage', { chat_id, message_id: id }),
    }),
    _me: null,
    async me() {
      return (api._me ??= (await call('getMe', {})).result || {});
    },
    // Telethon get_entity(user) equivalent; null when the bot never met them.
    // Name lookups stop at 35 calls so lists (/premium_users…) stay under the
    // free plan's 50-subrequest limit; the rest show as "Unknown".
    async user(id) {
      if (calls >= 35) return null;
      const r = await call('getChat', { chat_id: id });
      return r.ok ? r.result : null;
    },
  };
  return api;
}
