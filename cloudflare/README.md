# TeraBox Stream Bot on Cloudflare (free tier)

The bot gives users a **stream link** for a TeraBox share. It does not download a file, upload it to a channel, or forward it. Everything runs on one Cloudflare Worker, with D1 and KV for data. R2 is not used.

## 1. Why the current bot cannot run on Cloudflare

| Current piece (`amazon-ktworker`) | Problem on Workers | Replacement |
|---|---|---|
| Telethon (MTProto, long-lived TCP connection) | Workers have no persistent processes or raw MTProto support | Telegram **Bot API webhook** (plain HTTPS) |
| yt-dlp download, then ffmpeg/OpenCV, then upload up to 2 GB | Free plan allows 10 ms CPU per request, no disk, ~128 MB memory | No download: the user streams the HLS directly |
| Private channel cache + `copy_message` | Only needed because files were uploaded | Dropped. Each play re-resolves the link (1 request) |
| Turso "Redis" emulation (`storage.py`) | — | **D1** (users, views, broadcasts) + **KV** (jsToken, maintenance flag) |
| Self-hosted Bot API server (`TG_API_BASE`) | Only needed for 2 GB uploads | `api.telegram.org` |
| Resolver worker + HLS proxy worker | Already on Cloudflare | **Kept as they are**, with the same URL format as `terabox.py::_build_stream_url` |

## 2. How it works

```
User ──link──▶ Telegram ──webhook──▶ terabox-stream-bot (this Worker)
                                       │  D1: user/ban/premium/rate-limit
                                       │  RESOLVER/?q=<surl>  → file list
                                       ▼
            reply: [▶️ name (Mini App)] [🌐 browser]  → /watch?s=&f=&t=<hmac>

/watch  → HTML page with hls.js (opens inside Telegram as a Mini App)
/m3u8   → checks the HMAC, re-resolves (fresh sign/timestamp), reads jsToken from KV,
          302 → HLS_PROXY/?hls=<1024tera streaming.m3u8 URL>
hls.js  → plays the playlist and segments from the HLS proxy worker
```

Because the link is re-resolved every time someone presses play, an expired `sign` or `timestamp` never breaks old links. The HMAC on the link means nobody can use your `/m3u8` endpoint (and your request quota) for share codes the bot didn't issue.

## 3. Free-tier budget

These are the free limits as of this writing. Check the [Workers limits](https://developers.cloudflare.com/workers/platform/limits/) page before relying on them.

| Resource | Free limit | Usage in this bot |
|---|---|---|
| Worker requests | 100k/day **per account** | Bot worker: ~3 per link (webhook, watch, m3u8) |
| CPU | 10 ms/request | Only I/O and small JSON work. Fine |
| Subrequests | 50/request | Broadcast sends 40 messages per cron tick |
| D1 | 5M rows read, 100k rows written per day | ~2 writes per link |
| KV | 100k reads, **1k writes** per day | Writes only on `/jstoken` and `/maintenance` |

**The real bottleneck is the HLS proxy worker.** Every HLS segment the player fetches is one request to it. A 30-minute video with ~6–10 s segments is about 200–300 requests. On one free account that comes to roughly **300–500 full plays per day**. To raise that:
1. **Best fix:** if the TeraBox CDN serves segments with CORS and without a referer check, have the proxy rewrite *only the playlists* and point segment URLs straight at the CDN. That brings it down to about 3 requests per play. Test this first.
2. Keep the bot, resolver and proxy on **separate** accounts so each gets its own 100k/day.
3. Workers Paid ($5/month) gives 10M requests per month, if usage grows.

## 4. Check these before going live (I could not verify them)

1. **CORS on the HLS proxy.** On Android and desktop, hls.js fetches the playlist and segments with `fetch`, so every proxy response (playlists *and* segments) needs `Access-Control-Allow-Origin: *`. My test request to the proxy got an error response with no CORS header. iOS uses native HLS and doesn't need CORS. If you control the proxy, add the header in its response.
2. **The proxy rewrites segment URLs.** The playlist it returns must point segments back through the proxy, or straight at a CDN that allows CORS.
3. **The resolver hangs on an invalid code.** It took 45 s or more on a fake code in my test. This Worker gives up after 20 s and replies "Could not resolve". It would be better to make the resolver fail fast.
4. **jsToken expires.** When plays start failing, send `/jstoken NEW_TOKEN` to the bot. No redeploy is needed.

## 5. Deploy steps

```bash
cd cloudflare
npx wrangler login

# 1. Storage
npx wrangler d1 create terabox-bot             # paste database_id into wrangler.toml
npx wrangler kv namespace create KV            # paste id into wrangler.toml
npx wrangler d1 execute terabox-bot --remote --file schema.sql

# 2. Secrets (WEBHOOK_SECRET: letters, digits, _ and - only, 32+ chars)
npx wrangler secret put BOT_TOKEN
npx wrangler secret put WEBHOOK_SECRET
npx wrangler secret put JSTOKEN

# 3. Deploy, then register the webhook (one time)
npx wrangler deploy
curl "https://terabox-stream-bot.<your-subdomain>.workers.dev/setup?key=<WEBHOOK_SECRET>"
```

After step 3, **stop the Python bot**. A bot token can use either polling or a webhook, not both.

Make the bot an **admin** in every `FORCE_CHANNELS` channel, otherwise `getChatMember` fails. In that case the check fails open: users are let through instead of being blocked.

### Local testing
```bash
printf 'BOT_TOKEN=123:fake\nWEBHOOK_SECRET=testsecret\nJSTOKEN=tok\n' > .dev.vars
npx wrangler d1 execute terabox-bot --local --file schema.sql
npx wrangler dev --test-scheduled      # POST updates to /webhook with header x-telegram-bot-api-secret-token
```

## 6. Commands

Users: send a link, `/start`, `/help`.

Admins (`OWNER_ID` + `ADMINS`):

| Command | Effect |
|---|---|
| `/stats` | Users, premium count, links and active users in the last 24 h |
| `/ban ID`, `/unban ID` | Ban or unban a user |
| `/premium ID DAYS` | Give premium for DAYS days; `0` revokes |
| `/jstoken TOKEN` | Replace the TeraBox jsToken (stored in KV) |
| `/maintenance on\|off` | Turn maintenance mode on or off |
| `/broadcast` | Reply to any message with this. Sends about 40 users per minute via cron and reports when finished |

Free users get the first file of a share and 10 links per hour. Premium users and admins get up to 20 files per share and no limit.

## 7. Not ported yet

Each of these is a separate small addition when you need it:
- Gift codes, `/redeem`, custom tags, referral **rewards** (referrals are already *recorded* in `users.referred_by`).
- `/videos` paywall. It already uses workers (`VIDEOS_PAYMENT_API`, `VIDEOS_POOL_WORKER`), so it ports over directly. Note that Bot API `sendVideo` by URL only works for files up to 20 MB, so give a link instead.
- Multi-language menus, inline menu panels, analytics charts, `/update`, `/restart`, `/setstorage`, cleanup jobs. These don't apply on Workers or aren't needed.

## 8. Migrating existing users from Turso (optional)

`storage.py` keeps users in the `sets` table under key `all_known_users`. Export the IDs and load them into D1:
```bash
turso db shell <db> "SELECT member FROM sets WHERE key='all_known_users'" > ids.txt
awk 'NF && $1 ~ /^[0-9]+$/ {printf "INSERT OR IGNORE INTO users (id, joined) VALUES (%s, %d);\n", $1, systime()}' ids.txt > import.sql
npx wrangler d1 execute terabox-bot --remote --file import.sql
```
Re-grant premium with `/premium ID DAYS` (only a few users).
