// Broadcast sender: sends one batch (≤40 users) for the main bot's cron, which calls it through a
// service binding (no public URL). Each call is its own invocation with its own 50-subrequest budget,
// so the bot can send ~25 messages/second on the free plan instead of 40/minute.
// Body: { token, api?, users: [ids], mode: 'text'|'forward', text (HTML), from_chat, msg_id }
// Reply: { sent, failed }

const sleep = ms => new Promise(r => setTimeout(r, ms));

export default {
  async fetch(req) {
    if (req.method !== 'POST') return new Response('Not found', { status: 404 });
    const { token, api = 'https://api.telegram.org', users = [], mode, text, from_chat, msg_id } = await req.json();
    // copyMessage: same content as the replied message, but no "Forwarded from" header
    const method = mode === 'forward' ? 'copyMessage' : 'sendMessage';
    let sent = 0, failed = 0, calls = 0;
    for (const u of users) {
      const body = mode === 'forward' ? { chat_id: u, from_chat_id: from_chat, message_id: msg_id } : { chat_id: u, text, parse_mode: 'HTML' };
      for (let attempt = 0; ; attempt++) {
        calls++;
        let j = {};
        try {
          const r = await fetch(`${api}/bot${token}/${method}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
          j = await r.json();
        } catch {}
        if (j.ok) { sent++; break; }
        // Telegram rate limit: wait as told and retry once (while the 50-call budget allows it)
        if (j.error_code === 429 && attempt === 0 && calls < 48) { await sleep(Math.min(j.parameters?.retry_after || 1, 10) * 1000); continue; }
        failed++; // blocked the bot / deleted account / invalid chat
        break;
      }
    }
    return Response.json({ sent, failed });
  },
};
