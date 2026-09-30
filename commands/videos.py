"""Paid video drip-feed — /videos.

Free-trial + subscription paywall backed by an external payment API; the
video pool itself is served straight from an external worker via Telegram's
own external-URL fetch (send_protected_video -> InputMediaDocumentExternal),
so the bot never downloads/re-uploads these bytes at all.

Redis namespace: video_state:{uid} (hash) — trial_start_time, last_video_time,
video_index, video_links (JSON-encoded list, refilled once exhausted).
"""

import json
import time

import aiohttp
from telethon import Button, events

from tools import send_protected_video


def _uid_key(user_id):
    return f"video_state:{int(user_id)}"


async def _api_get(url, timeout=10):
    try:
        async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=timeout)) as s:
            async with s.get(url) as r:
                if r.status == 200:
                    return await r.json()
    except Exception:
        pass
    return None


async def _api_post(url, json_body, timeout=10):
    try:
        async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=timeout)) as s:
            async with s.post(url, json=json_body) as r:
                if r.status in (200, 201):
                    return await r.json()
    except Exception:
        pass
    return None


FREE_MODE_KEY = "videos_free_mode"

# In-memory cache for /videos' own per-user state — reads are instant, writes
# still go through to Turso so nothing is lost on a redeploy. Scoped to this
# feature only: _STATE holds {uid: {field: value}}, _FREE_MODE_CACHE is a
# single-slot cache for the (rarely-changing) global toggle.
_STATE = {}
_FREE_MODE_CACHE = {"set": False, "value": False}


def _get_state(db, user_id):
    uid = int(user_id)
    if uid not in _STATE:
        _STATE[uid] = db.hgetall(_uid_key(uid)) or {}
    return _STATE[uid]


def _set_state(db, user_id, **fields):
    uid = int(user_id)
    state = _get_state(db, user_id)
    key = _uid_key(uid)
    for field, value in fields.items():
        value = str(value)
        state[field] = value
        db.hset(key, field, value)


def register(bot, ctx):
    db = ctx["db"]
    is_admin = ctx.get("is_admin", lambda _uid: False)
    default_free_mode = bool(ctx.get("free_mode", False))
    payment_api = ctx["payment_api"].rstrip("/")
    pool_worker = ctx["pool_worker"].rstrip("/")
    trial_seconds = int(ctx.get("trial_seconds", 180))
    cooldown_seconds = float(ctx.get("cooldown_seconds", 1))
    promo_url = ctx.get("promo_url", "")

    def _free_mode():
        """Redis-backed, live-toggleable (see /videosfreemode), cached in
        memory after the first read. config.py's VIDEOS_FREE_MODE is only
        the seed default — once the flag is set at all, Redis wins."""
        if not _FREE_MODE_CACHE["set"]:
            stored = db.get(FREE_MODE_KEY)
            _FREE_MODE_CACHE["value"] = default_free_mode if stored is None else stored == "1"
            _FREE_MODE_CACHE["set"] = True
        return _FREE_MODE_CACHE["value"]

    def _set_free_mode(on):
        db.set(FREE_MODE_KEY, "1" if on else "0")
        _FREE_MODE_CACHE["value"] = bool(on)
        _FREE_MODE_CACHE["set"] = True

    async def _has_access(user_id):
        if _free_mode():
            return True
        resp = await _api_get(f"{payment_api}/api/subscription/status/{int(user_id)}")
        if resp and resp.get("subscribed"):
            return True
        trial_start = _get_state(db, user_id).get("trial_start_time")
        if trial_start:
            try:
                elapsed = time.time() - float(trial_start)
                if 0 <= elapsed <= trial_seconds:
                    return True
            except Exception:
                pass
        return False

    async def _next_video_link(user_id):
        state = _get_state(db, user_id)
        links_raw = state.get("video_links")
        index = int(state.get("video_index") or 0)
        links = json.loads(links_raw) if links_raw else []
        if not links or index >= len(links):
            resp = await _api_get(f"{pool_worker}/?random=200")
            links = (resp or {}).get("links") or []
            if not links:
                return None
            index = 0
            _set_state(db, user_id, video_links=json.dumps(links))
        _set_state(db, user_id, video_index=index + 1)
        return links[index]

    async def _serve_video(chat_id, user_id, reply_target):
        link = await _next_video_link(user_id)
        if not link:
            await reply_target.reply("❌ No videos found, try again in a moment.")
            return
        buttons = [[Button.url("Watch All Movies 🎬🍿", promo_url)]] if promo_url else None
        try:
            await send_protected_video(bot, chat_id, link, buttons=buttons, spoiler=True, protect_content=True)
        except Exception:
            await reply_target.reply("❌ Video error: server busy, please try again in a moment.")

    @bot.on(events.NewMessage(pattern=r"^/videos$", incoming=True, outgoing=False))
    async def _videos(m):
        user_id = m.sender_id

        last = _get_state(db, user_id).get("last_video_time")
        if last:
            try:
                pending = cooldown_seconds - (time.time() - float(last))
            except Exception:
                pending = 0
            if pending > 0:
                return await m.reply(f"⏳ Please wait {pending:.1f} seconds before requesting another video.")
        _set_state(db, user_id, last_video_time=time.time())

        try:
            await _api_post(f"{payment_api}/api/telegram/register",
                             {"telegram_id": int(user_id), "name": (m.sender.username if m.sender else None) or "User"})
        except Exception:
            pass

        if await _has_access(user_id):
            return await _serve_video(m.chat.id, user_id, m)

        trial_start = _get_state(db, user_id).get("trial_start_time")
        if not trial_start or int(float(trial_start)) == 0:
            buttons = [[Button.inline("🎁 Get Free 3-Min Trial", data="vid_trial")]]
            return await m.reply(
                "🎁 <b>FREE TRIAL — Special Offer for New Users!</b>\n\n"
                "Click the button below to claim your <b>3-minute free trial</b> and start watching videos right now:",
                parse_mode="html", buttons=buttons,
            )

        await m.reply(
            "⏰ <b>Your 3-minute free trial has expired!</b>\nPlease choose a plan below to continue watching.",
            parse_mode="html",
        )
        plans_resp = await _api_get(f"{payment_api}/api/plans")
        plans = [p for p in (plans_resp or {}).get("plans", []) if p.get("status") == "active"]
        if not plans:
            return await m.reply("⚠️ No plans available right now. Contact admin.")
        buttons = [[Button.inline(f"{p['name']} - ₹{p['price']} ({p['validity_days']} days)", data=f"vid_plan_{p['id']}")]
                   for p in plans]
        await m.reply("🗂️ Select a Plan for Unlimited Videos\n\n📋 Available Plans:", buttons=buttons)

    @bot.on(events.CallbackQuery(data=b"vid_trial"))
    async def _vid_trial(e):
        _set_state(db, e.sender_id, trial_start_time=time.time())
        try:
            await e.answer("Trial activated!", alert=False)
        except Exception:
            pass
        await e.reply("🎉 <b>Your 3-minute free trial is now ACTIVE!</b>", parse_mode="html")
        await _serve_video(e.chat_id, e.sender_id, e)

    @bot.on(events.CallbackQuery(pattern=rb"^vid_plan_(.+)$"))
    async def _vid_plan(e):
        plan_id = e.pattern_match.group(1).decode()
        try:
            await e.answer("Contact admin to complete payment.", alert=True)
        except Exception:
            pass
        # NOTE: purchase-completion flow isn't wired up — the reference script
        # didn't include what happens after a plan is picked. Replace this
        # with a real call once the payment endpoint/flow is known.
        await e.reply(
            f"📋 Selected plan #{plan_id}.\n\n"
            "Payment completion isn't wired up yet — contact an admin to finish your purchase."
        )

    @bot.on(events.NewMessage(pattern=r"^/videosfreemode(?:\s+(on|off))?$", incoming=True, outgoing=False))
    async def _videosfreemode(m):
        if not is_admin(m.sender_id):
            return await m.reply("Not authorized.")
        arg = (m.pattern_match.group(1) or "").lower()
        if not arg:
            return await m.reply(f"/videos free mode is **{'ON' if _free_mode() else 'OFF'}**", parse_mode="markdown")
        _set_free_mode(arg == "on")
        await m.reply(f"/videos free mode set to **{arg.upper()}**", parse_mode="markdown")
