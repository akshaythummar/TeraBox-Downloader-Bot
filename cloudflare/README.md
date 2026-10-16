# TeraBox Bot on Cloudflare (free tier)

This folder is a JavaScript port of the Python bot on the `amazon-ktworker` branch (`main.py` + `commands/*`). It keeps the same commands, menus, message texts and database keys. The one big change is what happens when someone sends a TeraBox link. The Python bot downloaded the video, uploaded it to a channel and forwarded it. This bot replies with a **stream link** instead, and playback goes through your existing resolver and HLS proxy workers.

The whole bot runs on one Cloudflare Worker with one D1 database. It does not use R2 or KV.

## Files

| File | What it is |
|---|---|
| `src/index.js` | Worker entry point: the Telegram webhook, the player page (`/watch`), the stream redirect (`/m3u8`), one-time `/setup`, and the cron |
| `src/bot.js` | Every command and button handler, ported from the Python code |
| `src/db.js` | `storage.py` (the Turso "Redis" layer) rewritten for D1, with the same 5 tables and the same keys |
| `src/tg.js` | Bot API calls. It also converts the Telethon-style markdown in the copied texts (`**bold**`, `` `code` ``) to HTML |
| `schema.sql` | The 5 storage tables plus a `broadcasts` queue |

Because the tables and keys match the Python bot, you can import your existing Turso data as it is (section 4). That includes users, premium, gift cards, tags, referrals, history, stats and the audit log.

## 1. How a link is handled

```
User sends link ─▶ Telegram ─webhook─▶ Worker
   same checks as Python (maintenance, ban, premium, cooldown, 10/hour limit) — one D1 round trip
   in parallel: RESOLVER/?q=<surl> (cached 30 min) · force-join check · "Sending you the media wait..."
   → a "video post": the usual caption + [▶️ Watch Online] [🌐 Open in Browser]
     (sent as a photo when the user set /setthumb; no storage channel is used at all)

▶️  → /watch     player page (hls.js), opens inside Telegram as a Mini App
      /m3u8      checks the link signature, re-resolves the share (fresh sign/timestamp),
                 302 → HLS_PROXY/?hls=<1024tera streaming.m3u8 … jsToken …>
```

The share is resolved again every time someone presses play, so old links keep working after TeraBox's `sign`/`timestamp` expire. Every link is signed, so nobody can use your `/m3u8` endpoint to burn your request quota on share codes the bot didn't issue. `/dl 720p <link>` chooses the TeraBox `M3U8_AUTO_720` rendition; the Python bot re-encoded with ffmpeg instead.

## 2. Deploy

```bash
cd cloudflare
npx wrangler login

# 1. Database — paste the printed database_id into wrangler.toml
npx wrangler d1 create terabox-bot
npx wrangler d1 execute terabox-bot --remote --file schema.sql

# 2. Secrets
npx wrangler secret put BOT_TOKEN        # from @BotFather
npx wrangler secret put WEBHOOK_SECRET   # any random 32+ chars, only A-Z a-z 0-9 _ -
npx wrangler secret put JSTOKEN          # TERABOX_JSTOKEN from config.py

# 3. (optional) import the Python bot's data — section 4

# 4. Deploy and connect Telegram (one time)
npx wrangler deploy
#    then open in a browser:  https://terabox-stream-bot.<your-subdomain>.workers.dev/setup?key=<WEBHOOK_SECRET>
#    you should see "ok": true
```

- **Stop the Python bot before step 4.** A bot token can't receive messages by webhook and by polling at the same time.
- **Make the bot an admin in every force-join channel or group.** If it isn't, Telegram won't tell the bot who is a member, and the bot then blocks everyone. The Python bot behaved the same way.
- `wrangler.toml` already holds the values from your `config.py`: workers, owner, admins, force channel and the `/videos` settings.

## 3. Before going live: check the HLS proxy (couldn't verify from here)

1. **CORS.** On Android and desktop, the player fetches the playlist and every video segment from the proxy, so each of those responses needs `Access-Control-Allow-Origin: *`. My test request to `amzon.ktnetwork002` got an error response without that header. iPhone works without it. Add this to the proxy's response:
   ```js
   const h = new Headers(res.headers); h.set('Access-Control-Allow-Origin', '*');
   return new Response(res.body, { status: res.status, headers: h });
   ```
2. **Segment URLs.** The playlist the proxy returns must point segments back through the proxy, or at a CDN that allows CORS.
3. **The resolver hangs on bad codes.** It took 45 s or more on a fake code in my test. This bot gives up after 20 s and shows the normal "Unable to process this link" error.

## 4. Move data from Turso (optional, recommended)

```bash
turso db shell <your-turso-db> .dump > dump.sql
grep -vE '^(BEGIN TRANSACTION|COMMIT|PRAGMA)' dump.sql | sed 's/^CREATE TABLE /CREATE TABLE IF NOT EXISTS /' > import.sql
npx wrangler d1 execute terabox-bot --remote --file import.sql
```
Run `schema.sql` first (deploy step 1), then this. The old link→storage-message cache rows come across too but are simply ignored: every link now gets a fresh stream post.

## 5. Free-tier limits and how this bot stays inside them

| Limit (free plan) | How the bot handles it |
|---|---|
| 100k Worker requests/day per account | About 3 per link (webhook + player page + stream redirect) |
| 50 outgoing calls per request (Telegram, resolver…) | A link with many files posts 15 videos and lists the rest (they open via `/search`). Name lookups in lists stop at 35. Broadcasts send 40 users per minute from the cron |
| 50 D1 queries per request | Writes are batched. Measured locally: about 28 statements for a new user's link, about 30 round trips for a 30-file link |
| 10 ms CPU per request | Only I/O and small JSON work |

**The real limit is the HLS proxy worker.** Every video segment is one request to it, so a 30-minute video costs about 200–300 requests, which works out to roughly 300–500 full plays a day on one free account. Ways to raise that:
1. Have the proxy rewrite only the playlist, so segments load straight from the TeraBox CDN (if it allows that). That's about 3 requests per play.
2. Put the bot, the resolver and the proxy on separate Cloudflare accounts, so each one gets its own 100k/day.
3. Workers Paid ($5/month).

## 6. What is different from the Python bot

Everything not listed here works the same way.

| Python | Here | Why |
|---|---|---|
| Download → upload → forward | Stream post with ▶️ / 🌐 buttons | No disk, no ffmpeg, no 2 GB uploads on Workers |
| `/dl 720p` re-encoded with ffmpeg | Chooses TeraBox's 720p HLS rendition | Same result, nothing to encode |
| Multi-file: one forward per file, plus a "✅ sent!" reply each | One post per file, maximum 15 per message, the rest listed | Free plan limit of 50 calls per request |
| `/mp3`, `/compress` | Same checks, then "ffmpeg not installed on server." | No ffmpeg on Workers |
| `/setthumb` changed the uploaded video's thumbnail | Used as the stream post's picture | There is no upload (TeraBox's own thumbnails can't be fetched by Telegram) |
| Storage channel cache, `/setstorage`, `/getstorage` | Removed | Nothing is uploaded, so there is nothing to copy from a channel |
| `/cancel`, Cancel buttons | `/cancel` → "You don't have any active downloads." | Nothing long-running to cancel |
| `/broadcast_legacy`, `/announce` sent to channel `-1001336746488`'s members | Sent to the bot's known users (`all_known_users`) | The Bot API can't list channel members |
| `/broadcast` looped inside the command | Queued; the cron sends 40/minute and edits the status message at the end | Free plan limit of 50 calls per request |
| `/update`, `/restart`, `/force` | `/update` explains `wrangler deploy`; `/restart` shows the "SYSTEM ONLINE" card | No process to restart |
| `/usage`, `/cleandownloads` | Same commands; disk and RAM show N/A | No server |
| `/logs`, `/errors`, `/logrotate` read `bot.log` | Read a `bot_log` list in D1 (resolver and cache failures are logged there) | No log file |
| `/backup`/`/restore` | Same JSON format; restore is batched | — |
| `/reindex` rescanned the storage channel | Explains that the library indexes automatically | Every link is indexed when it is sent |
| `/setforce`, `/maxfiles`, `/setcooldown` changed memory only (lost on restart) | Saved in `config_overrides` (same as `/configset`) | Workers keep no memory between requests |
| `/configset` keys | `MAX_FILES_PER_REQUEST`, `DOWNLOAD_COOLDOWN_SECONDS`, `FORCE_CHANNELS`, `FORCE_GROUPS` | The others (watermark, download dir, parallel downloads…) no longer exist |
| `/setplan` text was saved but `/plan` never showed it | `/plan` shows it | Bug fix |
| Free users: 10 links/hour | Unlimited (`FREE_HOURLY_LIMIT` = 0). `/configset FREE_HOURLY_LIMIT 10` brings the cap back | Requested |
| `/videos` plan buttons said "contact admin" | Plan button → `create-order` → 💳 Pay + ✅ I've Paid - Verify (`/api/payment-status`), admins get a "💰 Payment received" message | Same flow as the old `/purchase1-4` + `/verifynew` |
| `/videos` needed a payment subscription or the trial | Bot premium (referral, gift code, `/pre`) and admins also get `/videos` | Requested |
| Language-menu tap added a second Admin Panel button for admins | Only one | Bug fix |

## 7. Local testing

```bash
printf 'BOT_TOKEN=123:fake\nWEBHOOK_SECRET=testsecret\nJSTOKEN=tok\n' > .dev.vars
npx wrangler d1 execute terabox-bot --local --file schema.sql
npx wrangler dev --test-scheduled
```
POST Telegram updates to `http://127.0.0.1:8787/webhook` with the header `x-telegram-bot-api-secret-token: testsecret`. To see what the bot sends without a real bot, add `TG_API=http://127.0.0.1:<port>` (a fake Bot API server) and `RESOLVER=…` to `.dev.vars`. `curl /__scheduled` runs the cron once.
