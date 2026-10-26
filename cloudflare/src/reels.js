// The Videos Mini App, Instagram-Reels style: served at /reels (and /app, its old name) by index.js,
// with __BOT__ replaced. APIs: /app/api/feed, /app/v/*, /app/api/send, /app/api/bad, /app/api/live.
// No backticks or dollar-brace inside (String.raw template).
export const REELS_HTML = String.raw`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover,user-scalable=no">
<title>Reels</title>
<script>var tg = null; function tgReady() { tg = window.Telegram && Telegram.WebApp; try { tg.ready(); tg.expand(); tg.setHeaderColor("#000000"); tg.setBackgroundColor("#000000"); if (tg.disableVerticalSwipes) tg.disableVerticalSwipes(); } catch (e) {} }</script>
<script async src="https://telegram.org/js/telegram-web-app.js" onload="tgReady()"></script>
<style>
:root{--sb:max(env(safe-area-inset-bottom),calc(var(--tg-safe-area-inset-bottom,0px) + var(--tg-content-safe-area-inset-bottom,0px)));--st:max(env(safe-area-inset-top),calc(var(--tg-safe-area-inset-top,0px) + var(--tg-content-safe-area-inset-top,0px)));--ig:linear-gradient(45deg,#feda75,#fa7e1e 25%,#d62976 50%,#962fbf 75%,#4f5bd5);--red:#ff3040;--sheet:#1c1c1e;--line:#ffffff26;--mute:#a8a8a8}
*{box-sizing:border-box;-webkit-tap-highlight-color:transparent}
html,body{margin:0;height:100%;background:#000;color:#fff;font:14px -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;overflow:hidden;overscroll-behavior:none;-webkit-user-select:none;user-select:none;-webkit-touch-callout:none}
button{font:inherit;color:inherit}
svg{display:block}
#feed{height:100dvh;overflow-y:scroll;scroll-snap-type:y mandatory;scrollbar-width:none}
#feed::-webkit-scrollbar{display:none}
.slide{position:relative;height:100dvh;scroll-snap-align:start;scroll-snap-stop:always;overflow:hidden;background:#000}
.slide video{position:absolute;inset:0;width:100%;height:100%;object-fit:contain;background:#000}
.slide.tall video{object-fit:cover}
.poster{position:absolute;inset:0;background:#0d0d0d}
.slide.ready .poster{display:none}
.shade{position:absolute;left:0;right:0;bottom:0;height:42%;background:linear-gradient(transparent,#0000004d 40%,#000000b3);pointer-events:none;transition:opacity .2s}
/* top bar */
.top{position:fixed;left:0;right:0;top:0;z-index:5;display:flex;align-items:center;justify-content:flex-end;padding:calc(var(--st) + 12px) 16px 18px;background:linear-gradient(#00000080,transparent);pointer-events:none;transition:opacity .2s}
.pill{padding:6px 12px;border-radius:999px;background:#ffffff26;font-weight:600;font-size:13px;backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px)}
/* right action rail */
.rail{position:absolute;right:8px;bottom:calc(var(--sb) + 34px);display:flex;flex-direction:column;align-items:center;gap:20px;transition:opacity .2s}
.act{display:flex;flex-direction:column;align-items:center;gap:5px;border:0;background:none;padding:0;cursor:pointer;width:52px}
.act svg{width:29px;height:29px;filter:drop-shadow(0 1px 2px #0006)}
.act span{font-size:12px;font-weight:500;text-shadow:0 1px 2px #0009}
.act:active svg{transform:scale(.88)}
.lk .f{display:none}.lk.on .o{display:none}.lk.on .f{display:block;color:var(--red)}
.lk.on svg{animation:likepop .35s cubic-bezier(.2,1.6,.4,1)}
@keyframes likepop{0%{transform:scale(.6)}100%{transform:scale(1)}}
.dl .k,.dl .w{display:none}.dl.done .d{display:none}.dl.done .k{display:block}.dl.busy .d{display:none}.dl.busy .w{display:block;animation:r .8s linear infinite}
.mute .snd .on,.snd .off{display:none}.mute .snd .off{display:block}
.disc{width:30px;height:30px;border-radius:8px;border:2px solid #fff;background:var(--ig);display:grid;place-items:center;font-weight:800;font-size:13px}
/* bottom-left info */
.info{position:absolute;left:14px;right:76px;bottom:calc(var(--sb) + 30px);transition:opacity .2s}
.who{display:flex;align-items:center;gap:10px;margin-bottom:10px}
.av{width:34px;height:34px;border-radius:50%;padding:2px;background:var(--ig);flex:none}
.av i{display:grid;place-items:center;width:100%;height:100%;border-radius:50%;background:#000;border:2px solid #000;font-style:normal;font-weight:800;font-size:13px}
.who b{font-size:14px;font-weight:600;text-shadow:0 1px 2px #0009;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.prem{border:1px solid #ffffffcc;background:none;border-radius:8px;padding:4px 10px;font-size:13px;font-weight:600;cursor:pointer;white-space:nowrap}
.cap{font-size:14px;line-height:1.35;text-shadow:0 1px 2px #0009;margin-bottom:10px}
.aud{display:flex;align-items:center;gap:6px;font-size:13px;overflow:hidden;white-space:nowrap}
.aud svg{width:13px;height:13px;flex:none}
.aud span{display:inline-block;padding-left:100%;animation:mq 9s linear infinite}
.aud div{overflow:hidden;flex:1;-webkit-mask-image:linear-gradient(90deg,transparent,#000 8%,#000 92%,transparent)}
@keyframes mq{to{transform:translateX(-100%)}}
/* progress / seek: thin line at the very bottom, thicker with the time while dragging */
.seek{position:absolute;left:0;right:0;bottom:0;height:calc(var(--sb) + 30px);touch-action:none;cursor:pointer}
.bar{position:absolute;left:12px;right:12px;bottom:calc(var(--sb) + 10px);height:3px;border-radius:3px;background:#ffffff4d;transition:height .15s}
.bar i{position:relative;display:block;height:100%;width:0;border-radius:3px;background:#fff}
.bar i:after{content:"";position:absolute;right:-6px;top:50%;width:12px;height:12px;margin-top:-6px;border-radius:50%;background:#fff;transform:scale(0);transition:transform .15s}
.seek.drag .bar{height:6px}.seek.drag .bar i:after{transform:scale(1)}
.tm{position:fixed;left:50%;bottom:calc(var(--sb) + 90px);transform:translateX(-50%);font-size:26px;font-weight:700;letter-spacing:.5px;text-shadow:0 2px 8px #000a;opacity:0;transition:opacity .15s;pointer-events:none;font-variant-numeric:tabular-nums}
.seek.drag .tm{opacity:1}
.slide.held .tm{opacity:1;font-size:16px}
/* dragging / holding: only the video (and the time) */
.slide.held .rail,.slide.held .info,.slide.held .shade,.seeking .rail,.seeking .info{opacity:0}
body.held .top,body.seeking .top{opacity:0}
/* centre overlays */
.load{position:absolute;inset:0;display:grid;place-items:center;pointer-events:none;opacity:0;transition:opacity .2s}
.slide.wait .load{opacity:1}
.spin{width:34px;height:34px;border:3px solid #ffffff33;border-top-color:#fff;border-radius:50%;animation:r .7s linear infinite}
@keyframes r{to{transform:rotate(360deg)}}
.tp{position:absolute;top:50%;left:50%;width:80px;height:80px;margin:-40px 0 0 -40px;display:none;place-items:center;pointer-events:none;opacity:.9;filter:drop-shadow(0 2px 12px #00000080)}
.tp svg{width:80px;height:80px}
.slide.tap .tp,.slide.up .tp{display:grid;animation:tpin .2s ease-out}
@keyframes tpin{from{opacity:0;transform:scale(1.35)}to{opacity:.9;transform:scale(1)}}
.flash{position:absolute;top:50%;left:50%;width:64px;height:64px;margin:-32px 0 0 -32px;border-radius:50%;background:#0000008c;display:grid;place-items:center;pointer-events:none;animation:fl .7s ease forwards}
.flash svg{width:30px;height:30px}
@keyframes fl{0%{opacity:0;transform:scale(.7)}20%{opacity:1;transform:scale(1)}75%{opacity:1}100%{opacity:0}}
.heart{position:absolute;width:110px;height:110px;margin:-55px 0 0 -55px;pointer-events:none;color:var(--red);filter:drop-shadow(0 4px 12px #0006);animation:hp .9s cubic-bezier(.2,1.4,.4,1) forwards}
.heart svg{width:100%;height:100%}
@keyframes hp{0%{opacity:0;transform:rotate(var(--rot)) scale(.2)}15%{opacity:1;transform:rotate(var(--rot)) scale(1.15)}30%{transform:rotate(var(--rot)) scale(.95)}45%{transform:rotate(var(--rot)) scale(1)}80%{opacity:1;transform:rotate(var(--rot)) scale(1) translateY(0)}100%{opacity:0;transform:rotate(var(--rot)) scale(.9) translateY(-60px)}}
.msg{position:absolute;inset:0;display:none;place-items:center;text-align:center;padding:24px;color:var(--mute)}
.slide.bad .msg{display:grid}.slide.bad .load{opacity:0}
/* snackbar + first-time hint */
#toast{position:fixed;left:16px;right:16px;bottom:calc(var(--sb) + 70px);z-index:8;padding:13px 16px;border-radius:12px;background:#262626;box-shadow:0 6px 24px #0008;font-size:14px;font-weight:500;animation:up .25s ease}
@keyframes up{from{opacity:0;transform:translateY(12px)}}
.hint{position:fixed;left:50%;bottom:calc(var(--sb) + 130px);transform:translateX(-50%);z-index:5;display:flex;flex-direction:column;align-items:center;gap:2px;font-weight:600;text-shadow:0 1px 4px #000;pointer-events:none;animation:bob 1.4s ease-in-out infinite}
.hint svg{width:30px;height:30px}
@keyframes bob{50%{transform:translate(-50%,-8px)}}
/* walls (paywall / errors) */
.wall{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;padding:28px;text-align:center;background:radial-gradient(120% 70% at 50% 0%,#2b1236,#000 70%)}
.wall h2{margin:0;font-size:21px;font-weight:700}.wall p{margin:0;color:var(--mute);line-height:1.45}
.go{padding:13px 24px;border:0;border-radius:10px;font-weight:600;font-size:15px;color:#fff;background:#0095f6;cursor:pointer}
.pay{justify-content:flex-end;padding:0}
.pay .glow{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;padding:80px 24px 20px}
.pay .ring2{width:84px;height:84px;border-radius:50%;padding:3px;background:var(--ig)}
.pay .ring2 div{width:100%;height:100%;border-radius:50%;background:#000;display:grid;place-items:center}
.pay .ring2 svg{width:36px;height:36px}
.pay .again{color:#fff;font-weight:600;font-size:14px;padding:6px 12px;border-radius:999px;background:#ffffff1f}
.sheet{width:100%;background:var(--sheet);border-radius:18px 18px 0 0;padding:10px 16px calc(var(--sb) + 16px)}
.sheet .grab{width:38px;height:4px;border-radius:2px;background:#ffffff40;margin:0 auto 14px}
.sheet h3{margin:0 0 4px;font-size:17px;font-weight:700;text-align:left}
.sheet .perks{margin:0 0 14px;color:var(--mute);font-size:13px;text-align:left}
.plans{display:flex;flex-direction:column;gap:10px}
.plan{position:relative;display:grid;grid-template-columns:1fr auto;align-items:center;gap:2px 12px;padding:14px 16px;border-radius:14px;border:1px solid var(--line);background:#2a2a2d;text-align:left;cursor:pointer}
.plan .nm{font-weight:600;font-size:15px}.plan small{color:var(--mute);font-size:12.5px}
.plan .pr{grid-column:2;grid-row:1/3;font-weight:700;font-size:19px}
.plan.best{border-color:transparent;box-shadow:0 0 0 2px #d62976}
.plan em{position:absolute;top:-9px;left:14px;font-style:normal;font-weight:700;font-size:10px;letter-spacing:.06em;padding:3px 8px;border-radius:6px;background:var(--ig)}
.plan:active{transform:scale(.98)}
.all{margin-top:12px;width:100%;background:none;border:0;color:#0095f6;font-weight:600;font-size:14px;cursor:pointer;padding:8px}
/* login */
#login{position:fixed;inset:0;z-index:20;display:grid;place-items:center;background:#000;transition:opacity .35s}
#login.out{opacity:0;pointer-events:none}
.card{width:min(86vw,340px);text-align:center}
.card .logo{width:72px;height:72px;margin:0 auto 16px;border-radius:22px;background:var(--ig);display:grid;place-items:center}
.card .logo svg{width:38px;height:38px}
.card h3{margin:0 0 20px;font-size:20px;font-weight:700}
.card label{display:block;text-align:left;font-size:12px;color:var(--mute);margin:0 0 6px 4px}
.field{padding:12px 14px;border-radius:10px;background:#121212;border:1px solid #363636;font:600 17px ui-monospace,SFMono-Regular,Consolas,monospace;letter-spacing:.06em;text-align:left;display:flex;justify-content:space-between;align-items:center}
.field small{font:500 12px -apple-system,system-ui,sans-serif;color:var(--mute);letter-spacing:0}
.ring{width:60px;height:60px;margin:22px auto 10px}
.ring svg{width:100%;height:100%}
.ring .c{fill:none;stroke:#ffffff1f;stroke-width:4}
.ring .s{fill:none;stroke:#d62976;stroke-width:4;stroke-linecap:round;stroke-dasharray:40 151;transform-origin:center;animation:r .9s linear infinite}
.ring .k{fill:none;stroke:#fff;stroke-width:5;stroke-linecap:round;stroke-linejoin:round;stroke-dasharray:40;stroke-dashoffset:40}
.ring.ok .c{fill:#1fb36b;stroke:#1fb36b;transition:fill .25s,stroke .25s}
.ring.ok .s{display:none}
.ring.ok .k{animation:tick .35s .15s ease-out forwards}
.ring.ok{animation:boom .4s ease-out}
.ring.no .c{fill:#ed4956;stroke:#ed4956}.ring.no .s{display:none}
@keyframes tick{to{stroke-dashoffset:0}}
@keyframes boom{50%{transform:scale(1.12)}}
.card .sub{color:var(--mute);font-size:14px;min-height:20px}
[hidden]{display:none!important}
</style></head><body>
<div class="top"><span id="badge" class="pill" hidden></span></div>
<div id="feed"></div>
<div id="login"><div class="card">
  <div class="logo"><svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linejoin="round"><rect x="2.5" y="2.5" width="19" height="19" rx="5"/><path d="M2.5 8h19M9 2.5l3 5.5M15 2.5l3 5.5"/><path d="M10 11.5v6l5-3z" fill="#fff"/></svg></div>
  <h3 id="lt">Logging in…</h3>
  <label>Telegram user ID</label>
  <div class="field"><span id="lid">—</span><small id="lname"></small></div>
  <div class="ring" id="ring"><svg viewBox="0 0 64 64"><circle class="c" cx="32" cy="32" r="28"/><circle class="s" cx="32" cy="32" r="28"/><path class="k" d="M20 33l8 8 17-18"/></svg></div>
  <div class="sub" id="lsub">Verifying your Telegram account…</div>
</div></div>
<div id="toast" hidden></div>
<div id="hint" class="hint" hidden><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M6 15l6-6 6 6"/></svg>Swipe up</div>
<script>
var BOT = "__BOT__", MODE = "feed";
if (window.Telegram && Telegram.WebApp && !tg) tgReady();
// Telegram puts the signed login data in the URL hash: read it there so the feed starts at once
var INIT = (tg && tg.initData) || new URLSearchParams(location.hash.slice(1)).get("tgWebAppData") || "";
var feed = document.getElementById("feed"), muted = true, loading = false, ended = false, slides = [], freeLeft = null;
document.documentElement.classList.add("mute");
var me = 0, meName = ""; try { var u0 = JSON.parse(new URLSearchParams(INIT).get("user")); me = u0.id || 0; meName = u0.username ? "@" + u0.username : (u0.first_name || ""); } catch (e) {}
document.getElementById("lid").textContent = me || "—"; document.getElementById("lname").textContent = meName;
var SVG = function (vb, inner, fill) { return '<svg viewBox="' + vb + '" fill="' + (fill || "none") + '" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + inner + "</svg>"; };
var HEART = "M16.79 3.9A4.99 4.99 0 0 1 21.5 9.12c0 3.07-2.65 4.96-5.2 7.22-2.51 2.24-3.86 3.47-4.3 3.75-.48-.31-2.14-1.82-4.3-3.75C5.14 14.07 2.5 12.17 2.5 9.12A4.99 4.99 0 0 1 7.2 3.9a4.21 4.21 0 0 1 3.68 1.94c.84 1.18.98 1.76 1.12 1.76s.28-.59 1.11-1.77A4.17 4.17 0 0 1 16.8 3.9z";
var IC = {
  speakerOn: SVG("0 0 24 24", '<path d="M11 5 6 9H3v6h3l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13"/>'),
  speakerOff: SVG("0 0 24 24", '<path d="M11 5 6 9H3v6h3l5 4z"/><path d="m22 9-6 6M16 9l6 6"/>'),
  play: '<svg viewBox="0 0 24 24" fill="#fff"><path d="M8 5.14v13.72a1 1 0 0 0 1.52.85l11.03-6.86a1 1 0 0 0 0-1.7L9.52 4.29A1 1 0 0 0 8 5.14z"/></svg>',
  lock: SVG("0 0 24 24", '<rect x="4.5" y="10.5" width="15" height="10" rx="2.5"/><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3"/>'),
  music: '<svg viewBox="0 0 24 24" fill="#fff"><path d="M9 18.5a2.5 2.5 0 1 1-2.5-2.5c.53 0 1.02.16 1.43.44V5.5l11-2v12a2.5 2.5 0 1 1-2.5-2.5c.53 0 1.02.16 1.43.44V7.06l-8.86 1.6z"/></svg>'
};
var okAt = 0, loginGone = false;
// the tick stays at least 0.8 s, then the card fades once the first video plays (or after 7 s anyway)
function loginOk() { okAt = Date.now(); document.getElementById("ring").classList.add("ok"); document.getElementById("lt").textContent = "Logged in"; document.getElementById("lsub").textContent = "Loading your reels…"; setTimeout(hideLogin, 7000); }
function loginFail(title, text) { document.getElementById("ring").classList.add("no"); document.getElementById("lt").textContent = title; document.getElementById("lsub").textContent = text; }
function hideLogin() { if (loginGone) return; loginGone = true; setTimeout(function () { document.getElementById("login").classList.add("out"); }, Math.max(0, 800 - (Date.now() - okAt))); }
var liked = {}; try { liked = JSON.parse(localStorage.getItem("liked") || "{}"); } catch (e) {}
function saveLikes() { try { localStorage.setItem("liked", JSON.stringify(liked)); } catch (e) {} }
function go(u) { try { if (tg && tg.openTelegramLink) return tg.openTelegramLink(u); } catch (e) {} location.href = u; }
function haptic(k) { try { tg.HapticFeedback.impactOccurred(k || "light"); } catch (e) {} }
function toast(t) { var el = document.getElementById("toast"); el.textContent = t; el.hidden = true; void el.offsetWidth; el.hidden = false; clearTimeout(toast._t); toast._t = setTimeout(function () { el.hidden = true; }, 2600); }
// the owner's live log: one silent message per session, edited as the user watches (≤ 1 call / 8 s;
// closing the app sends the final state at once). Only counts — nothing is stored anywhere.
var LV = { fail: 0, n: 0, dl: 0, lk: 0, wall: 0, buy: 0, t0: Date.now(), mid: 0, sig: "", at: 0, key: "", busy: false, tm: 0 };
function live(end) {
  if (!okAt) return;
  clearTimeout(LV.tm);
  var wait = 8000 - (Date.now() - LV.at);
  if (LV.busy || (!end && wait > 0)) { LV.tm = setTimeout(function () { live(end); }, LV.busy ? 700 : wait); return; }
  var body = { mode: MODE, fail: LV.fail, initData: INIT, mid: LV.mid, sig: LV.sig, n: LV.n, dl: LV.dl, lk: LV.lk, wall: LV.wall, buy: LV.buy, plan: freeLeft == null ? "paid" : "free", end: end ? 1 : 0 };
  var key = JSON.stringify([body.fail, body.n, body.dl, body.lk, body.wall, body.buy, body.end]);
  if (key === LV.key) return;
  body.secs = Math.round((Date.now() - LV.t0) / 1000);
  LV.key = key; LV.at = Date.now(); LV.busy = true;
  fetch("/app/api/live", { method: "POST", keepalive: true, headers: { "content-type": "application/json" }, body: JSON.stringify(body) })
    .then(function (r) { return r.json(); }).then(function (d) { if (d.mid) { LV.mid = d.mid; LV.sig = d.sig; } })
    .catch(function () {}).then(function () { LV.busy = false; });
}
document.addEventListener("visibilitychange", function () { live(document.hidden); });
function fmt(t) { t = Math.floor(t || 0); var m = Math.floor(t / 60), x = t % 60; return m + ":" + (x < 10 ? "0" : "") + x; }
// Download = this video into the user's Telegram chat (the bot sends it; auto-deleted like /videos)
function download(s, b) {
  if (s._sent) return toast("Already sent to your Telegram chat");
  if (b.classList.contains("busy")) return;
  b.classList.add("busy"); haptic();
  var guard = setTimeout(function () { if (b.classList.contains("busy")) { b.classList.remove("busy"); toast("Sending… check your Telegram chat"); } }, 12000);
  fetch("/app/api/send", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ initData: INIT, id: s.dataset.id, d: s.dataset.d }) })
    .then(function (r) { return r.json(); })
    .then(function (d) { if (!d.ok) throw 0; s._sent = true; LV.dl++; live(); b.classList.add("done"); toast("Sent to your Telegram chat"); try { tg.HapticFeedback.notificationOccurred("success"); } catch (e) {} })
    .catch(function () { toast("Couldn't send — try again"); })
    .then(function () { clearTimeout(guard); b.classList.remove("busy"); });
}
// the seek bar: tap or drag anywhere on it to jump; the big time shows while dragging
function seeker(s) {
  var sk = s.querySelector(".seek"), bar = s.querySelector(".bar"), fill = s.querySelector(".bar i"), tm = s.querySelector(".tm"), dur = s.querySelector(".len");
  s._show = function (t) { var v = s._v; if (v && v.duration) { fill.style.width = (100 * t / v.duration) + "%"; tm.textContent = fmt(t) + " / " + fmt(v.duration); dur.textContent = " · " + fmt(v.duration); } };
  function at(e) { var r = bar.getBoundingClientRect(), v = s._v; return Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * (v ? v.duration : 0); }
  sk.addEventListener("pointerdown", function (e) {
    e.stopPropagation(); if (!s._v || !s._v.duration) return;
    s._drag = true; sk.classList.add("drag"); s.classList.add("seeking"); document.body.classList.add("seeking"); try { sk.setPointerCapture(e.pointerId); } catch (x) {}
    s._show(at(e)); haptic();
  });
  sk.addEventListener("pointermove", function (e) { if (s._drag) s._show(at(e)); });
  function end(e) { if (!s._drag) return; s._drag = false; sk.classList.remove("drag"); s.classList.remove("seeking"); document.body.classList.remove("seeking"); if (!s._v) return; var t = at(e); s._v.currentTime = t; s._show(t); s._up = false; s.classList.remove("up"); start(s); }
  sk.addEventListener("pointerup", function (e) { e.stopPropagation(); end(e); });
  sk.addEventListener("pointercancel", end);
}
function wall(title, text, button, act) {
  var s = document.createElement("div"); s.className = "slide wall";
  s.innerHTML = "<h2></h2><p></p>" + (button ? '<button class="go"></button>' : "");
  s.querySelector("h2").textContent = title; s.querySelector("p").textContent = text;
  if (button) { s.querySelector("button").textContent = button; s.querySelector("button").onclick = act; }
  feed.appendChild(s); return s;
}
function openPlans() { go("https://t.me/" + BOT + "?start=plans"); try { tg.close(); } catch (e) {} }
// a plan card: the bot opens straight on that plan's payment QR
function buy(id) { go("https://t.me/" + BOT + "?start=plan_" + id); try { tg.close(); } catch (e) {} }
// After the last free video: a bottom sheet with the plans (one tap → that plan's QR in the bot) and a
// live countdown to tomorrow's free videos. Without plans (payment API down) the plain button.
function paywall(w) {
  var plans = (w && w.plans) || [];
  if (!plans.length) return wall("That's all your free reels for today", "Come back tomorrow for more — or unlock unlimited reels now.", "Unlock unlimited", openPlans);
  var s = document.createElement("div"); s.className = "slide wall pay";
  s.innerHTML = '<div class="glow"><div class="ring2"><div>' + IC.lock + '</div></div><h2>You\'re all caught up</h2><p>Today\'s free reels are done.</p><span class="again"></span></div>' +
    '<div class="sheet"><div class="grab"></div><h3>Keep watching — unlimited</h3><p class="perks">No daily limit · /videos too · cancel anytime</p><div class="plans"></div><button class="all">See all plans in the bot</button></div>';
  plans.forEach(function (p, i) {
    var b = document.createElement("button"); b.className = "plan" + (p.best ? " best" : "");
    b.innerHTML = '<span class="nm"></span><span class="pr"></span><small></small>' + (p.best ? "<em>BEST VALUE</em>" : "");
    b.querySelector(".nm").textContent = p.name;
    b.querySelector(".pr").textContent = "₹" + p.price;
    b.querySelector("small").textContent = p.days + (p.days === 1 ? " day" : " days") + " unlimited" + (i && p.save >= 10 ? " · save " + p.save + "%" : "");
    b.onclick = function () { haptic("medium"); LV.buy = p.price; live(true); buy(p.id); };
    s.querySelector(".plans").appendChild(b);
  });
  s.querySelector(".all").onclick = openPlans;
  var ag = s.querySelector(".again");
  if (w.daily > 0) {
    var end = Date.now() + w.resetIn * 1000;
    (function tick() { var x = Math.max(0, Math.round((end - Date.now()) / 1000)); ag.textContent = w.daily + " free reels again in " + Math.floor(x / 3600) + "h " + Math.floor(x % 3600 / 60) + "m"; if (x > 0) setTimeout(tick, 20000); })();
  } else ag.hidden = true;
  feed.appendChild(s); return s;
}
// only the on-screen video gets the sound setting; warming (off-screen) ones stay muted
function setSound(flash) {
  var s = current(); if (s && s._v) s._v.muted = muted;
  document.documentElement.classList.toggle("mute", muted);
  if (flash && s) { var f = document.createElement("div"); f.className = "flash"; f.innerHTML = muted ? IC.speakerOff : IC.speakerOn; s.appendChild(f); setTimeout(function () { f.remove(); }, 750); }
}
function like(s, on) {
  var id = s.dataset.id, was = !!liked[id]; liked[id] = on === undefined ? !liked[id] : on; if (!liked[id]) delete liked[id]; saveLikes();
  if (!was && liked[id]) { LV.lk++; live(); haptic(); }
  s.querySelector(".lk").classList.toggle("on", !!liked[id]); s.querySelector(".lk span").textContent = liked[id] ? "Liked" : "Like";
}
// Android's WebView lets a <video> element play with sound only after a tap asked it to play;
// swipes don't count. So 4 elements are reused for all slides, and taps unlock all 4 for good.
var POOL = [];
function unlock() {
  if (navigator.userActivation && !navigator.userActivation.isActive) return;
  POOL.forEach(function (v) {
    if (v._ok) return; v._ok = true;
    var was = v.paused, p = v.play(); if (p && p.catch) p.catch(function () {});
    if (was && !(v._s && v._s._on && current() === v._s)) v.pause();
  });
}
document.addEventListener("pointerup", unlock, true); document.addEventListener("click", unlock, true);
function makeVideo() {
  var v = document.createElement("video");
  v.setAttribute("playsinline", ""); v.setAttribute("disablepictureinpicture", ""); v.setAttribute("controlslist", "nodownload noplaybackrate");
  v.loop = true; v.muted = true; v.preload = "auto"; v.oncontextmenu = function () { return false; };
  // the spinner only if it's really slow (no flicker on fast starts)
  v.addEventListener("loadstart", function () { var s = v._s; if (!s) return; clearTimeout(s._w); s._w = setTimeout(function () { if (v._s === s && !s.classList.contains("ready")) s.classList.add("wait"); }, 400); });
  v.addEventListener("playing", function () { var s = v._s; if (!s) return; clearTimeout(s._w); s.classList.add("ready"); s.classList.remove("wait", "tap"); if (current() === s) { if (okAt) hideLogin(); prepare(slides.indexOf(s)); if (!s._seen) { s._seen = true; LV.n++; live(); } } });
  v.addEventListener("waiting", function () { var s = v._s; if (!s) return; clearTimeout(s._w); s._w = setTimeout(function () { if (v._s === s) s.classList.add("wait"); }, 400); });
  v.addEventListener("timeupdate", function () { var s = v._s; if (s && !s._drag) s._show(v.currentTime); });
  v.addEventListener("loadedmetadata", function () {
    var s = v._s; if (!s) return;
    if (!v.videoWidth) return bad(s, true); // loads, but no picture: really broken → report it
    s.classList.toggle("tall", v.videoHeight >= v.videoWidth * 1.2);
    s._show(v.currentTime);
    if (current() === s) prepare(slides.indexOf(s));
  });
  v.addEventListener("error", function () { if (v._s && v.getAttribute("src")) bad(v._s, false); }); // network / expired link: skip, don't report
  return v;
}
for (var k = 0; k < 4; k++) POOL.push(makeVideo());
// gives slide s a video element: a free one, else the one farthest from the on-screen slide i among
// those outside i..i+2 (the 4th element keeps the previous video while it isn't needed)
function attach(s, i) {
  if (s._v) return s._v;
  if (s.classList.contains("bad")) return null;
  var pick = null, far = -1;
  POOL.forEach(function (v) { var j = v._s ? slides.indexOf(v._s) : -1, d = !v._s ? 1e9 : j < i || j > i + 2 ? Math.abs(j - i) : -1; if (d > far) { far = d; pick = v; } });
  if (!pick) return null;
  detach(pick);
  pick._s = s; s._v = pick; pick.muted = true; pick.src = s.dataset.src;
  s.insertBefore(pick, s.querySelector(".shade"));
  return pick;
}
function detach(v) {
  var s = v._s; if (!s) return;
  v.pause(); v.removeAttribute("src"); v.load();
  clearTimeout(s._w); s._v = null; s._warm = false; s.classList.remove("ready", "wait", "tap"); v._s = null;
  if (v.parentNode) v.parentNode.removeChild(v);
}
// plays the on-screen video. If the browser refuses (sound without a tap) it plays muted instead;
// if even that is refused (data saver) a play button asks for one tap — never a silently frozen video.
function start(s) {
  var v = s._v; if (!v) return;
  v.muted = muted;
  var p = v.play();
  if (p && p.catch) p.catch(function (e) {
    if (!e || e.name !== "NotAllowedError" || v._s !== s || current() !== s) return;
    if (!v.muted) { muted = true; setSound(); toast("Tap the speaker for sound"); var q = v.play(); if (q && q.catch) q.catch(function () { s.classList.add("tap"); }); }
    else s.classList.add("tap");
  });
}
function addVideo(v) {
  var s = document.createElement("div"); s.className = "slide"; s.dataset.id = v.id; s.dataset.src = v.src; s.dataset.d = v.d || "";
  var initial = (BOT.charAt(0) || "R").toUpperCase();
  s.innerHTML = '<div class="poster"></div><div class="shade"></div>' +
    '<div class="load"><div class="spin"></div></div><div class="tp">' + IC.play + '</div>' +
    '<div class="msg">This reel didn\'t load — skipping…</div>' +
    '<div class="info"><div class="who"><span class="av"><i>' + initial + '</i></span><b>' + BOT + '</b>' + (freeLeft != null ? '<button class="prem">Go unlimited</button>' : "") + '</div>' +
      '<div class="cap">Swipe up for the next reel 🔥</div>' +
      '<div class="aud">' + IC.music + '<div><span>' + BOT + ' · Original audio<b class="len"></b></span></div></div></div>' +
    '<div class="rail">' +
      '<button class="act lk"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path class="o" d="' + HEART + '"/></svg><svg class="f" viewBox="0 0 24 24" fill="currentColor"><path d="' + HEART + '"/></svg><span>Like</span></button>' +
      '<button class="act dl"><svg class="d" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3.5v11m0 0-4.5-4.5M12 14.5l4.5-4.5M4.5 16.5v2a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-2"/></svg>' +
        '<svg class="k" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="m4.5 12.5 5 5 10-11"/></svg>' +
        '<svg class="w" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M12 3a9 9 0 1 0 9 9"/></svg><span>Download</span></button>' +
      '<button class="act snd"><span class="on">' + IC.speakerOn + '</span><span class="off">' + IC.speakerOff + '</span><span>Sound</span></button>' +
      '<div class="disc">' + initial + '</div>' +
    '</div>' +
    '<div class="seek"><span class="tm"></span><div class="bar"><i></i></div></div>';
  if (liked[v.id]) like(s, true);
  s.querySelector(".lk").onclick = function (e) { e.stopPropagation(); like(s); };
  s.querySelector(".dl").onclick = function (e) { e.stopPropagation(); download(s, this); };
  s.querySelector(".snd").onclick = function (e) { e.stopPropagation(); muted = !muted; setSound(true); haptic(); if (s._v && s._v.paused && !s._up) start(s); };
  var pr = s.querySelector(".prem"); if (pr) pr.onclick = function (e) { e.stopPropagation(); haptic("medium"); openPlans(); };
  gestures(s); seeker(s);
  feed.appendChild(s); slides.push(s); io.observe(s);
}
// one tap = pause / play, double-tap = like (with the big heart; the tap waits 280 ms to tell them
// apart), hold = pause while held (the UI hides, like Instagram)
function togglePause(s) {
  if (!s._v) return;
  if (s._up) { s._up = false; s.classList.remove("up"); start(s); }
  else { s._up = true; s.classList.add("up"); s._v.pause(); }
  haptic();
}
function gestures(s) {
  var last = 0, hold = null;
  s.addEventListener("pointerdown", function (e) {
    if (e.target.closest(".rail,.seek,.prem")) return;
    hold = setTimeout(function () { s.classList.add("held"); document.body.classList.add("held"); if (s._v) s._v.pause(); }, 300);
  });
  function up(e) {
    clearTimeout(hold);
    if (s.classList.contains("held")) { s.classList.remove("held"); document.body.classList.remove("held"); start(s); return; }
    if (e.type !== "pointerup" || e.target.closest(".rail,.seek,.prem")) return;
    if (s.classList.contains("tap")) { s.classList.remove("tap"); start(s); return; }
    var now = Date.now();
    if (now - last < 300) {
      clearTimeout(s._st); like(s, true); last = 0;
      var h = document.createElement("div"); h.className = "heart";
      h.innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="' + HEART + '"/></svg>';
      h.style.setProperty("--rot", (Math.random() * 30 - 15).toFixed(0) + "deg");
      var r = s.getBoundingClientRect(); h.style.left = (e.clientX - r.left) + "px"; h.style.top = (e.clientY - r.top) + "px";
      s.appendChild(h); setTimeout(function () { h.remove(); }, 950);
    } else { last = now; clearTimeout(s._st); s._st = setTimeout(function () { togglePause(s); }, 280); }
  }
  s.addEventListener("pointerup", up); s.addEventListener("pointercancel", up); s.addEventListener("pointerleave", up);
}
function bad(s, report) {
  if (s.classList.contains("bad")) return;
  s.classList.add("bad"); LV.fail++; live();
  if (s._v) detach(s._v);
  if (report) try { fetch("/app/api/bad", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ initData: INIT, id: s.dataset.id }) }); } catch (e) {}
  if (current() === s) setTimeout(function () { var n = s.nextElementSibling; if (n && current() === s) n.scrollIntoView({ behavior: "smooth" }); }, 900);
}
function current() { var y = feed.scrollTop + feed.clientHeight / 2, c = null; slides.forEach(function (s) { if (s.offsetTop <= y && s.offsetTop + s.offsetHeight > y) c = s; }); return c; }
// Phones' in-app browsers ignore preload, so the next video is "warmed" once the current one has its
// metadata, the one after once it plays: started muted off-screen and paused as soon as it plays —
// the browser has then fetched and decoded its start, and a swipe plays it at once.
function warm(s, i) {
  if (s._warm || s.classList.contains("bad")) return;
  var v = attach(s, i); if (!v) return;
  s._warm = true; v.muted = true;
  v.addEventListener("playing", function stop() { v.removeEventListener("playing", stop); if (v._s === s && current() !== s) v.pause(); });
  var p = v.play(); if (p && p.catch) p.catch(function () {});
}
function prepare(i) {
  var cur = slides[i]; if (!cur) return;
  var v = attach(cur, i); if (!v) return;
  cur._warm = true;
  if (slides[i + 1] && v.readyState >= 1) warm(slides[i + 1], i);
  if (slides[i + 2] && cur.classList.contains("ready")) warm(slides[i + 2], i);
}
var io = new IntersectionObserver(function (es) {
  es.forEach(function (e) {
    var s = e.target;
    // the observer fires several times per swipe: only a real arrival (s._on) restarts the video and
    // only a real departure pauses it
    if (e.isIntersecting && e.intersectionRatio > 0.6) {
      if (s._on) return; s._on = true; s._arr = Date.now();
      var i = slides.indexOf(s);
      // a fast fling passes slides in ~0.2 s: only the one the user stops on starts loading
      clearTimeout(s._go);
      s._go = setTimeout(function () { if (current() !== s) return; prepare(i); if (!s._v) return; if (s._v.currentTime > 0.5) s._v.currentTime = 0; start(s); }, s._v && s._v.readyState >= 2 ? 0 : 250);
      if (s.classList.contains("bad")) setTimeout(function () { var n = s.nextElementSibling; if (n && current() === s) n.scrollIntoView({ behavior: "smooth" }); }, 600);
      if (i > 0) document.getElementById("hint").hidden = true;
      // free users: the badge counts down, so the paywall after the last one is no surprise
      if (freeLeft != null) { var fl = slides.length - 1 - i + freeLeft; document.getElementById("badge").textContent = fl + " free left today"; if (!fl && !s._last) { s._last = true; toast("Last free reel for today"); } }
      if (i >= slides.length - 5) more();
    } else if (s._on) { s._on = false; s._up = false; clearTimeout(s._go); clearTimeout(s._st); s.classList.remove("tap", "held", "up"); document.body.classList.remove("held"); if (s._v) { s._v.pause(); s._v.muted = true; } }
  });
}, { threshold: [0, 0.6, 1] });
// Safety net, twice a second: the on-screen video must be playing — if it sits paused (not held, no
// play button shown) it's started again; if it plays but makes no progress for 2.5 s (stream stalled)
// it's asked again from the same spot.
setInterval(function () {
  var s = current(), v = s && s._v;
  if (!v || !s._on || s._drag || document.hidden) return;
  if (v.paused) { if (!s._up && !s.classList.contains("held") && !s.classList.contains("tap") && v.readyState >= 2 && Date.now() - s._arr > 1200) start(s); return; }
  if (!v.currentTime) return;
  if (v.currentTime !== s._lt) { s._lt = v.currentTime; s._lm = Date.now(); return; }
  if (Date.now() - s._lm > 2500) { s._lm = Date.now(); v.currentTime = v.currentTime + 0.05; }
}, 500);
document.addEventListener("visibilitychange", function () { var s = current(); if (!s || !s._v) return; if (document.hidden) s._v.pause(); else if (!s._up) start(s); });

function more() {
  if (loading || ended) return; loading = true;
  if (!INIT) { loginFail("Open from Telegram", "Open this app with the button in the bot."); ended = true; return; }
  fetch("/app/api/feed", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ initData: INIT }) })
    .then(function (r) { return r.json(); })
    .then(function (d) {
      if (!d.ok) { ended = true; return d.error === "soon" ? loginFail("Coming soon", "Reels open for everyone soon.") : loginFail("Login failed", "Close and open the app again."); }
      if (!okAt) { loginOk(); live(); }
      var b = document.getElementById("badge"); b.hidden = false;
      b.textContent = d.unlimited ? "Unlimited" : (d.left + d.videos.length) + " free today";
      freeLeft = d.unlimited ? null : d.left;
      var firstBatch = !slides.length;
      d.videos.forEach(addVideo);
      if (firstBatch && slides.length) document.getElementById("hint").hidden = false;
      if (!d.unlimited && d.left === 0) {
        ended = true;
        if (!d.videos.length) hideLogin();
        var pw = paywall(d.wall);
        new IntersectionObserver(function (es) { if (es[0].isIntersecting && !LV.wall) { LV.wall = 1; live(); } }, { threshold: 0.6 }).observe(pw);
      }
    })
    .catch(function () { if (!okAt) loginFail("No connection", "Check your internet and open the app again."); else wall("No connection", "Check your internet and reopen the app.", null); ended = true; })
    .then(function () { loading = false; });
}
more();
</script></body></html>
`;
