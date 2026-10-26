// The "Watch Online" player (/watch), Reels-style like src/reels.js: the video full screen, one tap
// pauses / plays, a thin progress line at the bottom (thicker with the time while dragging), the
// sound, speed and share in the header (top right), the file name bottom-left, the time above the line.
// Double-tap left / right skips 10 s, hold = 2x. Same HLS stream (/m3u8) and resume as the old page.
// No fullscreen: inside Telegram's Mini App the page already fills the screen and the API refuses it. Values come in as JSON; the client code uses no template syntax.
export function playerHtml({ src, key, open, bot, name }) {
  const J = x => JSON.stringify(x).replace(/</g, '\\u003c'); // a file name can't close the <script>
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover,user-scalable=no">
<title>${name ? name.replace(/[<>&"]/g, '') : 'Player'}</title>
<script src="https://telegram.org/js/telegram-web-app.js"></script>
<script src="https://cdn.jsdelivr.net/npm/hls.js@1.5.13/dist/hls.min.js"></script>
<style>
:root{--sb:max(env(safe-area-inset-bottom),calc(var(--tg-safe-area-inset-bottom,0px) + var(--tg-content-safe-area-inset-bottom,0px)));--st:max(env(safe-area-inset-top),calc(var(--tg-safe-area-inset-top,0px) + var(--tg-content-safe-area-inset-top,0px)));--ig:linear-gradient(45deg,#feda75,#fa7e1e 25%,#d62976 50%,#962fbf 75%,#4f5bd5);--mute:#a8a8a8}
*{box-sizing:border-box;-webkit-tap-highlight-color:transparent}
html,body{margin:0;height:100%;background:#000;color:#fff;font:14px -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;overflow:hidden;-webkit-user-select:none;user-select:none;-webkit-touch-callout:none}
button{font:inherit;color:inherit;border:0;background:none;padding:0;cursor:pointer}
svg{display:block}
#wrap{position:fixed;inset:0;background:#000;overflow:hidden}
video{position:absolute;inset:0;width:100%;height:100%;object-fit:contain;background:#000}
.shade{position:absolute;left:0;right:0;bottom:0;height:38%;background:linear-gradient(transparent,#0000004d 40%,#000000b3);pointer-events:none;transition:opacity .2s}
/* right action rail */
.top{position:absolute;left:0;right:0;top:0;height:calc(var(--st) + 80px);background:linear-gradient(#00000080,transparent);pointer-events:none;transition:opacity .2s}
.rail{position:absolute;right:6px;top:calc(var(--st) + 8px);display:flex;align-items:center;gap:2px;transition:opacity .2s}
.act{display:grid;place-items:center;width:44px;height:44px;border-radius:50%}
.act:active{background:#ffffff26}
.act svg{width:26px;height:26px;filter:drop-shadow(0 1px 2px #0006)}
.act b{font-size:15px;font-weight:800;text-shadow:0 1px 2px #0009}
.mute .snd .on,.snd .off{display:none}.mute .snd .off{display:block}
/* bottom-left: bot, file name, length */
.info{position:absolute;left:14px;right:14px;bottom:calc(var(--sb) + 50px);transition:opacity .2s}
.cap{font-size:14px;line-height:1.35;text-shadow:0 1px 2px #0009;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;word-break:break-word}
/* progress line at the very bottom; thicker with the big time while dragging */
.seek{position:absolute;left:0;right:0;bottom:0;height:calc(var(--sb) + 38px);touch-action:none;cursor:pointer}
.bar{position:absolute;left:12px;right:12px;bottom:calc(var(--sb) + 18px);height:3px;border-radius:3px;background:#ffffff40;transition:height .15s}
.bar .buf,.bar .done{position:absolute;left:0;top:0;bottom:0;width:0;border-radius:3px}
.bar .buf{background:#ffffff4d}.bar .done{background:#fff}
.bar .done:after{content:"";position:absolute;right:-6px;top:50%;width:12px;height:12px;margin-top:-6px;border-radius:50%;background:#fff;transform:scale(0);transition:transform .15s}
.seek.drag .bar{height:6px}.seek.drag .bar .done:after{transform:scale(1)}
.tm{position:absolute;left:50%;bottom:calc(var(--sb) + 90px);transform:translateX(-50%);font-size:26px;font-weight:700;letter-spacing:.5px;text-shadow:0 2px 8px #000a;opacity:0;transition:opacity .15s;pointer-events:none;font-variant-numeric:tabular-nums;white-space:nowrap}
.drag .tm{opacity:1}
.time{position:absolute;left:14px;right:14px;bottom:calc(var(--sb) + 26px);display:flex;justify-content:space-between;font-size:12px;font-weight:600;font-variant-numeric:tabular-nums;text-shadow:0 1px 3px #000c;pointer-events:none;transition:opacity .2s}
.time span{color:#ddd}
/* while dragging only the video and the time */
.drag .rail,.drag .info,.drag .shade,.drag .top,.drag .time{opacity:0}
/* centre: Reels' play icon while paused, the spinner while loading */
.tp{position:absolute;top:50%;left:50%;width:80px;height:80px;margin:-40px 0 0 -40px;display:none;place-items:center;pointer-events:none;filter:drop-shadow(0 2px 10px #00000080)}
.tp svg{width:80px;height:80px;margin-left:6px}
.paused:not(.wait) .tp{display:grid;animation:tpin .18s ease-out}
@keyframes tpin{from{opacity:0;transform:scale(1.25)}}
.spin{position:absolute;left:50%;top:50%;width:34px;height:34px;margin:-17px 0 0 -17px;border:3px solid #ffffff33;border-top-color:#fff;border-radius:50%;animation:r .7s linear infinite;display:none;pointer-events:none}
.wait .spin{display:block}
@keyframes r{to{transform:rotate(360deg)}}
.flash{position:absolute;top:50%;margin-top:-32px;width:64px;height:64px;border-radius:50%;background:#0000008c;display:grid;place-items:center;pointer-events:none;animation:fl .6s ease forwards}
.flash svg{width:30px;height:30px}
.flash small{position:absolute;bottom:-22px;font-weight:700;font-size:12px;text-shadow:0 1px 3px #000;white-space:nowrap}
@keyframes fl{0%{opacity:0;transform:scale(.7)}20%{opacity:1;transform:scale(1)}75%{opacity:1}100%{opacity:0}}
#toast{position:absolute;left:16px;right:16px;bottom:calc(var(--sb) + 70px);z-index:8;padding:13px 16px;border-radius:12px;background:#262626;box-shadow:0 6px 24px #0008;font-size:14px;font-weight:500;animation:up .25s ease}
@keyframes up{from{opacity:0;transform:translateY(12px)}}
#err{position:absolute;inset:0;display:none;flex-direction:column;align-items:center;justify-content:center;gap:12px;background:#000;text-align:center;padding:28px}
#err b{font-size:18px}
#err p{margin:0;color:var(--mute);line-height:1.45;max-width:320px}
#err button{padding:12px 24px;border-radius:10px;background:#0095f6;font-weight:600}
[hidden]{display:none!important}
</style>
</head><body class="wait mute">
<div id="wrap">
<video id="v" autoplay muted playsinline preload="auto"></video>
<div class="shade"></div><div class="top"></div>
<div class="spin"></div>
<div class="tp"><svg viewBox="0 0 24 24" fill="#ffffffe6"><path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.4-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z"/></svg></div>
<div class="info">
  <div class="cap" id="cap"></div>
</div>
<div class="rail">
  <button class="act snd" id="snd"><span class="on"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5 6 9H3v6h3l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13"/></svg></span><span class="off"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5 6 9H3v6h3l5 4z"/><path d="m22 9-6 6M16 9l6 6"/></svg></span></button>
  <button class="act" id="spd"><b id="rate">1x</b></button>
  ${open ? '<button class="act" id="shr"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M22 3 9.2 10.1M22 3l-7.4 18-4.2-8.5L2 9.1z"/></svg></button>' : ''}
</div>
<div class="time"><b id="cur">0:00 / 0:00</b><span id="left"></span></div>
<div class="seek" id="seek"><span class="tm" id="tm"></span><div class="bar"><i class="buf" id="buf"></i><i class="done" id="done"></i></div></div>
<div id="toast" hidden></div>
<div id="err"><b>Video couldn't play</b><p id="em"></p><button onclick="location.reload()">Try again</button></div>
</div>
<script>
var tg = window.Telegram && Telegram.WebApp;
try { tg.ready(); tg.expand(); tg.setHeaderColor("#000000"); tg.setBackgroundColor("#000000"); if (tg.disableVerticalSwipes) tg.disableVerticalSwipes(); } catch (e) {}
var SRC = ${J(src)}, KEY = "pos:" + ${J(key)}, OPEN = ${J(open)}, NAME = ${J(name || '')};
var $ = function (id) { return document.getElementById(id); }, v = $("v"), B = document.body;
$("cap").textContent = NAME || "Watch online";
function fmt(s) { s = Math.max(0, Math.floor(s || 0)); var h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), x = s % 60; return (h ? h + ":" + (m < 10 ? "0" : "") : "") + m + ":" + (x < 10 ? "0" : "") + x; }
function haptic() { try { tg.HapticFeedback.impactOccurred("light"); } catch (e) {} }
function toast(t) { var el = $("toast"); el.textContent = t; el.hidden = true; void el.offsetWidth; el.hidden = false; clearTimeout(toast._t); toast._t = setTimeout(function () { el.hidden = true; }, 2200); }
var IC = {
  on: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5 6 9H3v6h3l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13"/></svg>',
  off: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5 6 9H3v6h3l5 4z"/><path d="m22 9-6 6M16 9l6 6"/></svg>',
  back: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M11 6v12l-8.5-6zM21 6v12l-8.5-6z"/></svg>',
  fwd: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M13 6v12l8.5-6zM3 6v12l8.5-6z"/></svg>'
};
function flash(svg, label, x) { var f = document.createElement("div"); f.className = "flash"; f.innerHTML = svg + (label ? "<small>" + label + "</small>" : ""); f.style.left = "calc(" + (x || 50) + "% - 32px)"; $("wrap").appendChild(f); setTimeout(function () { f.remove(); }, 650); }
var store = { get: function () { try { return +localStorage.getItem(KEY) || 0; } catch (e) { return 0; } }, set: function (x) { try { x ? localStorage.setItem(KEY, x) : localStorage.removeItem(KEY); } catch (e) {} } };

// state classes
v.addEventListener("play", function () { B.classList.remove("paused"); });
v.addEventListener("pause", function () { B.classList.add("paused"); });
v.addEventListener("waiting", function () { B.classList.add("wait"); });
v.addEventListener("playing", function () { B.classList.remove("wait"); });
v.addEventListener("canplay", function () { B.classList.remove("wait"); });

// one tap = pause / play; double-tap on the left / right third = -10 / +10 s (the tap waits 260 ms
// to tell them apart); hold = 2x while held
function skip(d, x) { if (!v.duration) return; v.currentTime = Math.max(0, Math.min(v.duration - 0.5, v.currentTime + d)); flash(d < 0 ? IC.back : IC.fwd, "10s", x); haptic(); }
var lastTap = 0, tapT, holdT, fast = false, rate = 1;
var UI = ".rail,.info,.seek,#err,#toast";
$("wrap").addEventListener("pointerdown", function (e) {
  if (e.target.closest(UI)) return;
  holdT = setTimeout(function () { if (v.paused) return; fast = true; v.playbackRate = 2; toast("2x speed while holding"); haptic(); }, 450);
});
function endHold() { clearTimeout(holdT); if (fast) { fast = false; v.playbackRate = rate; $("toast").hidden = true; return true; } return false; }
$("wrap").addEventListener("pointerup", function (e) {
  if (endHold() || e.target.closest(UI)) return;
  var x = e.clientX / innerWidth, now = Date.now();
  if (now - lastTap < 260 && (x < 0.35 || x > 0.65)) { clearTimeout(tapT); lastTap = now; skip(x < 0.35 ? -10 : 10, x < 0.35 ? 18 : 82); return; }
  lastTap = now; clearTimeout(tapT);
  tapT = setTimeout(function () { if (v.paused) v.play().catch(function () {}); else v.pause(); haptic(); }, 260);
});
$("wrap").addEventListener("pointercancel", endHold);

// progress line: tap or drag anywhere on it; the big time follows the finger
var seek = $("seek");
function frac(e) { var r = seek.querySelector(".bar").getBoundingClientRect(); return Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)); }
function show(t) { if (!v.duration) return; $("done").style.width = (100 * t / v.duration) + "%"; $("tm").textContent = fmt(t) + " / " + fmt(v.duration); }
seek.addEventListener("pointerdown", function (e) { if (!v.duration) return; e.stopPropagation(); B.classList.add("drag"); seek.classList.add("drag"); try { seek.setPointerCapture(e.pointerId); } catch (x) {} show(frac(e) * v.duration); haptic(); });
seek.addEventListener("pointermove", function (e) { if (seek.classList.contains("drag")) show(frac(e) * v.duration); });
function drop(e) { if (!seek.classList.contains("drag")) return; seek.classList.remove("drag"); B.classList.remove("drag"); v.currentTime = frac(e) * v.duration; v.play().catch(function () {}); }
seek.addEventListener("pointerup", function (e) { e.stopPropagation(); drop(e); });
seek.addEventListener("pointercancel", drop);
function tick() {
  if (!v.duration) return;
  if (!seek.classList.contains("drag")) show(v.currentTime);
  $("cur").textContent = fmt(v.currentTime) + " / " + fmt(v.duration); $("left").textContent = "-" + fmt(v.duration - v.currentTime);
  for (var i = 0; i < v.buffered.length; i++) if (v.buffered.start(i) <= v.currentTime + 0.5 && v.buffered.end(i) >= v.currentTime) $("buf").style.width = (100 * v.buffered.end(i) / v.duration) + "%";
}
v.addEventListener("timeupdate", tick); v.addEventListener("progress", tick); v.addEventListener("loadedmetadata", tick);

// sound: starts muted (so autoplay works everywhere)
function syncMute() { B.classList.toggle("mute", v.muted); }
v.addEventListener("volumechange", syncMute);
$("snd").onclick = function (e) { e.stopPropagation(); v.muted = !v.muted; if (!v.muted && v.volume === 0) v.volume = 1; if (v.paused) v.play().catch(function () {}); flash(v.muted ? IC.off : IC.on); haptic(); };

// speed
var SPEEDS = [1, 1.25, 1.5, 2, 0.75];
$("spd").onclick = function (e) { e.stopPropagation(); rate = SPEEDS[(SPEEDS.indexOf(rate) + 1) % SPEEDS.length]; v.playbackRate = rate; $("rate").textContent = rate + "x"; haptic(); };

// share / open the bot (inside Telegram through the Mini App API, in a browser as a normal link)
var SHARE_TEXT = "🎬 Watch this video in 1 tap — no download needed 👇";
function go(u) { try { if (tg && tg.initData && tg.openTelegramLink) return tg.openTelegramLink(u); } catch (x) {} if (!window.open(u, "_blank")) location.href = u; }
if (OPEN) {
  $("shr").onclick = function (e) { e.stopPropagation(); haptic(); if (!(tg && tg.initData) && navigator.share) return navigator.share({ text: SHARE_TEXT, url: OPEN }).catch(function () {}); go("https://t.me/share/url?url=" + encodeURIComponent(OPEN) + "&text=" + encodeURIComponent(SHARE_TEXT)); };
}

// resume where you left off
var resumed = false;
v.addEventListener("loadedmetadata", function () {
  var at = store.get();
  if (!resumed && at > 5 && at < v.duration - 15) { v.currentTime = at; }
  resumed = true;
});
var saved = 0;
v.addEventListener("timeupdate", function () { if (Date.now() - saved > 4000) { saved = Date.now(); store.set(v.currentTime > 5 && v.currentTime < v.duration - 15 ? Math.floor(v.currentTime) : 0); } });
v.addEventListener("ended", function () { store.set(0); });

// keyboard (desktop)
addEventListener("keydown", function (e) {
  if (e.key === " " || e.key === "k") { e.preventDefault(); v.paused ? v.play().catch(function () {}) : v.pause(); }
  else if (e.key === "ArrowLeft" || e.key === "j") skip(-10, 18);
  else if (e.key === "ArrowRight" || e.key === "l") skip(10, 82);
  else if (e.key === "m") v.muted = !v.muted;
});

// the stream
function fail(m) { $("em").textContent = "The link may have expired (" + m + "). Try again, or send the link to the bot again."; $("err").style.display = "flex"; B.classList.remove("wait"); }
if (window.Hls && Hls.isSupported()) {
  // segments come through a proxy that is slow on its first request, so be patient and retry
  var h = new Hls({ fragLoadPolicy: { default: { maxTimeToFirstByteMs: 30000, maxLoadTimeMs: 60000, timeoutRetry: { maxNumRetry: 4, retryDelayMs: 0, maxRetryDelayMs: 0 }, errorRetry: { maxNumRetry: 6, retryDelayMs: 1000, maxRetryDelayMs: 8000 } } }, maxBufferLength: 60, startFragPrefetch: true });
  h.loadSource(SRC); h.attachMedia(v);
  h.on(Hls.Events.ERROR, function (_, d) {
    if (!d.fatal) return;
    if (d.type === Hls.ErrorTypes.NETWORK_ERROR && d.details !== "manifestLoadError") return h.startLoad();
    if (d.type === Hls.ErrorTypes.MEDIA_ERROR) return h.recoverMediaError();
    h.destroy();
    fail(d.details + (d.response && d.response.code ? " " + d.response.code : ""));
  });
} else if (v.canPlayType("application/vnd.apple.mpegurl")) { v.src = SRC; v.onerror = function () { fail("stream error"); }; }
else fail("this browser cannot play HLS");
v.muted = true; v.play().catch(function () {});
</script></body></html>`;
}
