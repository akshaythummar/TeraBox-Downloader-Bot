# Plan — pending work (Cloudflare bot)

What's decided but not done yet, roughly in order. Update this file when something ships.

## Rules for every change

- **Never check anything live**: no playing pool or user videos, no fetching deployed pages (privacy policy). Lint + local tests with mocks, deploy, and the admin tests on the phone.
- New UI goes behind an admin-only command or link first; existing features must not change while something is tested.
- Payment changes are tested with a mock payment worker first, never with real payments.
- Watch D1 limits: 100k rows written/day, 5M read/day. Prefer no new writes.

## 1. /str stream test (TeraBox HLS instead of Telegram files)

Live for admins: `/str`, `src/str.js`, table `streams` (code, fid, name, fails), feed of every link whose stream post went out.

- [ ] Compare with Reels for 2–3 days: live-log "⚡ Start: … · 🧪 stream test" vs the Reels lines (start time, stalls).
- [ ] Quality: now fixed at 480p (`DEFAULT_QUALITY`, `M3U8_AUTO_480`). Options: 720p (better picture, ~2x data), or pick by the phone's connection (360/480 on slow, 720 on good). Don't use 1080p.
- [ ] `/strreset` (admin): set `fails` back to 0 — needed if the TeraBox cookie expires and every video collects 3 fails.
- [ ] Decide before opening /str to users: the `streams` table holds users' own files. Showing them to other users is a privacy and report/ban risk.
- [ ] If it wins: merge into `src/reels.js` (one page, not two copies).

- [ ] Count /str's loading numbers too (counters `rl_*_s`; now only in the live log) to compare stalls with Reels.
- [ ] Don't send users from Reels to /str yet (decided 2026-10-29): /str shows users' own unchecked files to everyone (report / ban risk), only ~1,250 videos, no free count / paywall, depends on the TeraBox cookie and the HLS proxy. Keep Reels; take what makes /str smooth (small HLS chunks, fewer stalls) into Reels instead.

## 2. Reels loading A/B test

Odd user ids = new loading (next 2 warmed, next batch at 7 left), even = old. Numbers in `/funnel` ("⚡ Reels loading (old / new)").

- 2026-10-29: old 0.41 s avg start, 21 stalls per 100 videos (1,935 starts); new 0.49 s, 14 stalls per 100 (1,370). Stalls are the lag users feel; the new loading has a third fewer.
- [ ] Give everyone the new loading and delete the old code path.

## 2b. Likes + profile (Instagram-style) — built 2026-10-29, admins + APP_TESTERS only

Live for admins and testers (`PROFILE_PUBLIC` 0). Database `terabox-bot-likes` (binding `LIKES`, `likes_schema.sql`): `likes (uid, vid, at)` and `thumbs (vid, jpg)`. Code: `likesApi` in `src/bot.js`, routes `/app/api/like|thumb|liked` and `/app/thumb/<vid>` in `src/index.js`, the profile / grid / Premium sheet / viewer in `src/reels.js`.

- Likes are saved on the server (1 write per like, unlike = delete); the phone's older local likes are uploaded once.
- Profile button at the bottom of the rail → Instagram-style profile: @username, name, Liked count, plan, 3-column 9:16 grid.
- Thumbnails: one ~3 KB JPEG per video, shared by everyone, first one wins. On like: the frame being watched (dark / flat → 1 s later, 3 tries). Missing ones (Premium): from ~30 %, then 50 %, then 15 % of the video, up to 6 per opening.
- Tap a tile: Premium → the liked reels full screen (swipe through, unlike there); free → the Premium sheet with the plans and the user's offer, no video (decided: replaying liked reels is Premium-only).
- Tested locally with a synthetic clip (3 s black, then colours) and mock Telegram / payment worker; no real video.
- Limits: a separate D1 database (500 MB). Later, if likes near the 100k writes/day: move `likes` to Turso. No R2 (no payment details); when thumbnails fill 500 MB: another free D1 database. Not KV, Supabase or Telegram.
- [ ] The owner tests it on the phone, then `/configset PROFILE_PUBLIC 1` opens it to everyone.
- [ ] /str: likes and the profile there too (the page is a copy of Reels; its videos are HLS, the viewer would need hls.js).
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
