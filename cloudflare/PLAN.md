# Plan — pending work (Cloudflare bot)

What's decided but not done yet, roughly in order. Update this file when something ships.

## Rules for every change

- **Never check anything live**: no playing pool or user videos, no fetching deployed pages (privacy policy). Lint + local tests with mocks, deploy, and the admin tests on the phone.
- New UI goes behind an admin-only command or link first; existing features must not change while something is tested.
- Payment changes are tested with a mock payment worker first, never with real payments.
- Watch D1 limits: 100k rows written/day, 5M read/day. Prefer no new writes.

## 1. /str stream test (TeraBox HLS instead of Telegram files)

**2026-10-31 03:30: `REELS_HLS 2` — every user's /reels plays the HLS streams.** Undo: `/configset REELS_HLS 0`. Watch: payments in `/funnel` vs 30 Oct, the 3 proxy accounts' requests (100k/day each), videos suddenly 0:30 = cookie dead.

Live for admins: `/str` (since 2026-10-31 the Reels page itself, `src/reels.js` with `STR` — same UI, no Download), table `streams` (code, fid, name, fails), feed of every link whose stream post went out.

- [ ] Compare with Reels for 2–3 days: live-log "⚡ Start: … · 🧪 stream test" vs the Reels lines (start time, stalls).
- [ ] Quality: now fixed at 480p (`DEFAULT_QUALITY`, `M3U8_AUTO_480`). Options: 720p (better picture, ~2x data), or pick by the phone's connection (360/480 on slow, 720 on good). Don't use 1080p.
- [ ] Our proxies (`hls-proxy/worker.js`, 3 accounts) work since 2026-10-31 with the old proxy's ndus cookie (hardcoded in the pasted copy only, NOT in git — a logged-out request gets a ~30 s preview).
- [ ] `/strreset` (admin): set `fails` back to 0 — needed if the TeraBox cookie expires and every video collects 3 fails.
- [ ] Decide before opening /str to users: the `streams` table holds users' own files. Showing them to other users is a privacy and report/ban risk.
- [x] 2026-10-31: admins' `/reels` now play the /str streams (HLS) — `REELS_HLS` 1 (admins only; `/configset REELS_HLS 0` = back to Telegram videos). No Download / server likes there (stream ids). Live log says "🧪 stream test".
- [x] 2026-10-31: HLS Reels have the same free count / paywall / likes / profile as the Telegram ones (no Download). Streams go over our own proxies `HLS_PROXIES` (3 accounts, videos take turns); links / Watch Online stay on `HLS_PROXY`. Switch: `/configset REELS_HLS 0` (Telegram videos for all) · `1` (admins on HLS) · `2` (everyone on HLS).
- [x] If it wins: merge into `src/reels.js` (one page, not two copies).

- Request cost (2026-10-29): per video 1 request on our worker (the /m3u8 playlist; a TeraBox resolve + 1 D1 write when the 30-min link cache is cold), but **every HLS segment is a request on the HLS proxy worker** (HLS_PROXY, a separate Cloudflare account) — ~20–40+ per video watched, plus a few for the warmed next one. Watch Online uses the same proxy, so /str and Watch Online share that account's 100k/day (~4,000 videos/day at ~25 segments each). Before opening /str to users: several proxy accounts (spread the load) or a paid proxy plan.
- [ ] Count /str's loading numbers too (counters `rl_*_s`; now only in the live log) to compare stalls with Reels.
- [ ] Don't send users from Reels to /str yet (decided 2026-10-29): /str shows users' own unchecked files to everyone (report / ban risk), only ~1,250 videos, no free count / paywall, depends on the TeraBox cookie and the HLS proxy. Keep Reels; take what makes /str smooth (small HLS chunks, fewer stalls) into Reels instead.

## 2. Reels loading A/B test — done 2026-10-31

The new loading (next 2 warmed at once, next batch at 7 left) won: 14 vs 18 stalls per 100 reels, 2.6 % vs 3.9 % skipped while loading, same start time (0.50 vs 0.48 s; 8,485 starts over 4 days). It is now on for everyone; /funnel shows one loading line.

## 2b. Likes + profile (Instagram-style) — live for everyone since 2026-10-30

Live for everyone (`PROFILE_PUBLIC` 1, set 2026-10-30), with a step-by-step first-time tour (Like → Download → profile; once per phone, key `tour_steps`). Database `terabox-bot-likes` (binding `LIKES`, `likes_schema.sql`): `likes (uid, vid, at)` and `thumbs (vid, jpg)`. Code: `likesApi` in `src/bot.js`, routes `/app/api/like|thumb|liked` and `/app/thumb/<vid>` in `src/index.js`, the profile / grid / Premium sheet / viewer in `src/reels.js`.

- Likes are saved on the server (1 write per like, unlike = delete); the phone's older local likes are uploaded once.
- Profile button at the bottom of the rail → Instagram-style profile: @username, name, Liked count, plan, 3-column 9:16 grid.
- Thumbnails: one ~3 KB JPEG per video, shared by everyone, first one wins. On like: the frame being watched (dark / flat → 1 s later, 3 tries). Missing ones (Premium): from ~30 %, then 50 %, then 15 % of the video, up to 6 per opening.
- Tap a tile: Premium → the liked reels full screen (swipe through, unlike there); free → the Premium sheet with the plans and the user's offer, no video (decided: replaying liked reels is Premium-only).
- Tested locally with a synthetic clip (3 s black, then colours) and mock Telegram / payment worker; no real video.
- Limits: a separate D1 database (500 MB). Later, if likes near the 100k writes/day: move `likes` to Turso. No R2 (no payment details); when thumbnails fill 500 MB: another free D1 database. Not KV, Supabase or Telegram.
- [x] Opened to everyone (`/configset PROFILE_PUBLIC 0` turns it off again).
- [ ] Tour back to admins only (2026-10-31): on 30 Oct, its first full day for everyone, paywall views halved (272 → 136) and payments fell (18 → 10, none 00:00–10:00). Check 31 Oct / 1 Nov: paywall views 250+ again → the tour was the cause. If it comes back: never hold the feed, Hinglish text, no Download step.
- [ ] Orders → paid fell 37% → 21% on 30 Oct (48 orders, 10 paid): watch the profile Premium sheet and the ₹19 first-time offer (12 orders, 3 paid); unfinished-payment reminder (section 4).
- [x] /str: likes and the profile there too (the page is a copy of Reels; its videos are HLS, the viewer would need hls.js).
- [ ] `/funnel`: show `pf_open` (profile opens) next to the app numbers.

## 3. Payment worker security (paytm-payment-worker/index.js) — important

- [ ] Admin APIs are open: `isAdminAuthorized()` always returns true. Anyone can change plan prices / status. Add an admin key.
- [ ] `create-order` trusts any amount: anyone with a `user_token` (the status API gives it out) can buy a 30-day plan for ₹1. Fix: an amount below the plan price only with a secret key that only the bot sends (keeps the bot's offers working).
- The owner deploys the payment worker.

## 4. More income / users

- [ ] Check the offers in `/funnel` (first-time ₹19 for 7 days, welcome-back 20% for 24 h): orders → paid, and revenue vs before. Tune with `/configset OFFER_FIRST_PRICE`, `OFFER_BACK_PCT` (0 = off).
- [ ] Reels paywall: "👥 Invite a friend → free Premium" button (the existing referral link). ~390 people see the paywall daily, referrals are ~0–3/day.
- [ ] Unfinished payments (~68% leave at the QR): one more reminder after 30 min with a one-tap new QR.
- [ ] Upsell from ₹9: "MOST POPULAR" on the 7-day plan and ₹/day on every plan; after a 1-day plan ends, offer 7 days.

## 5. Reels experience

- [ ] No repeats: keep the user's position in the list in the phone (localStorage) so ~8,600 videos come before any repeat. No D1 writes.
- [ ] `/health` (admin): today's Cloudflare requests vs the 100k/day limit (Reels uses ~2–3 per video; at the limit the whole bot stops).
- [ ] Cache videos in India: needs a cheap custom domain on Cloudflare (Cache API doesn't work on workers.dev). Biggest speed-up without moving the videos.

## 6. Bigger, later

- [ ] Videos off Telegram (R2): if the bot is banned all ~8,600 file_ids are lost. The owner would run the convert/upload script on their own PC.
- [ ] New content source: no new videos are added now (the pool's links are expired, no upload channel).
- [ ] Hinglish texts for users (discussed, not started).
