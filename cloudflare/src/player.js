// The "Watch Online" player (redesign): custom controls instead of the browser's — title bar,
// big centre play/pause with ±10 s, a seek bar with what's buffered, time, sound, speed, fullscreen.
// Same HLS stream (/m3u8) and the same behaviour as the old page (resume, landscape = fullscreen,
// "more videos" card, share). Values come in as JSON; the client code below uses no template syntax.
export function playerHtml({ src, key, open, bot, name }) {
  const J = x => JSON.stringify(x).replace(/</g, '\\u003c'); // a file name can't close the <script>
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover,user-scalable=no">
<title>${name ? name.replace(/[<>&"]/g, '') : 'Player'}</title>
<script src="https://telegram.org/js/telegram-web-app.js"></script>
<script src="https://cdn.jsdelivr.net/npm/hls.js@1.5.13/dist/hls.min.js"></script>
<style>
:root{--sb:max(env(safe-area-inset-bottom),calc(var(--tg-safe-area-inset-bottom,0px) + var(--tg-content-safe-area-inset-bottom,0px)));--st:max(env(safe-area-inset-top),calc(var(--tg-safe-area-inset-top,0px) + var(--tg-content-safe-area-inset-top,0px)));--acc:#ff3040;--mute:#b3b3b3}
*{box-sizing:border-box;-webkit-tap-highlight-color:transparent}
html,body{margin:0;height:100%;background:#000;color:#fff;font:14px -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;overflow:hidden;-webkit-user-select:none;user-select:none;-webkit-touch-callout:none}
button{font:inherit;color:inherit;border:0;background:none;padding:0;cursor:pointer}
svg{display:block}
#wrap{position:fixed;inset:0;background:#000}
video{position:absolute;inset:0;width:100%;height:100%;object-fit:contain;background:#000}
/* controls layer: shown on tap, hides itself while playing */
.ui{position:absolute;inset:0;opacity:0;transition:opacity .25s;pointer-events:none}
.show .ui{opacity:1}
.show .ui .hit{pointer-events:auto}
.ui:before{content:"";position:absolute;inset:0;background:linear-gradient(#000000a6,transparent 22%,transparent 62%,#000000bf)}
.top{position:absolute;left:0;right:0;top:0;display:flex;align-items:center;gap:10px;padding:calc(var(--st) + 10px) 12px 10px}
.ib{width:42px;height:42px;border-radius:50%;display:grid;place-items:center;flex:none}
.ib:active{background:#ffffff26}
.ib svg{width:24px;height:24px;filter:drop-shadow(0 1px 2px #0008)}
.ttl{flex:1;min-width:0}
.ttl b{display:block;font-size:15px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;text-shadow:0 1px 3px #000a}
.ttl small{color:var(--mute);font-size:12px}
.spd{padding:7px 12px;border-radius:999px;background:#ffffff26;font-weight:700;font-size:13px;backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px)}
.mid{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);display:flex;align-items:center;gap:44px}
.mid .ib{width:56px;height:56px;background:#00000059;backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px)}
.mid .ib svg{width:28px;height:28px}
.mid .pp{width:76px;height:76px}
.mid .pp svg{width:38px;height:38px}
.pp .pa{display:none}.playing .pp .pl{display:none}.playing .pp .pa{display:block}
.wait .mid .pp{visibility:hidden}
.bot{position:absolute;left:0;right:0;bottom:0;padding:0 14px calc(var(--sb) + 8px)}
.row{display:flex;align-items:center;gap:6px;margin-bottom:2px}
.tm{flex:1;font-size:13px;font-weight:600;font-variant-numeric:tabular-nums;text-shadow:0 1px 3px #000a}
.tm span{color:var(--mute)}
.mute .snd .on,.snd .off{display:none}.mute .snd .off{display:block}
.fs .full .in,.full .out{display:none}.fs .full .out{display:block}
.seek{position:relative;height:28px;touch-action:none;cursor:pointer}
.track{position:absolute;left:0;right:0;top:12px;height:4px;border-radius:4px;background:#ffffff40;overflow:hidden;transition:height .15s,top .15s}
.track i{position:absolute;left:0;top:0;bottom:0;width:0}
.track .buf{background:#ffffff66}.track .done{background:var(--acc)}
.knob{position:absolute;top:14px;left:0;width:16px;height:16px;margin:-8px 0 0 -8px;border-radius:50%;background:var(--acc);box-shadow:0 0 0 4px #ff304033;transition:transform .15s}
.drag .track{height:6px;top:11px}.drag .knob{transform:scale(1.3)}
.tip{position:absolute;bottom:34px;transform:translateX(-50%);padding:5px 9px;border-radius:8px;background:#000c;font-weight:700;font-size:13px;opacity:0;transition:opacity .15s;pointer-events:none;font-variant-numeric:tabular-nums}
.drag .tip{opacity:1}
/* states and feedback */
.spin{position:absolute;left:50%;top:50%;width:52px;height:52px;margin:-26px 0 0 -26px;border:4px solid #ffffff33;border-top-color:#fff;border-radius:50%;animation:r .75s linear infinite;display:none;pointer-events:none}
.wait .spin{display:block}
@keyframes r{to{transform:rotate(360deg)}}
.rip{position:absolute;top:0;bottom:0;width:38%;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:6px;font-weight:700;font-size:14px;pointer-events:none;opacity:0;transition:opacity .2s}
.rip.l{left:0;border-radius:0 50% 50% 0;background:radial-gradient(circle at 0 50%,#ffffff2e,transparent 70%)}
.rip.r{right:0;border-radius:50% 0 0 50%;background:radial-gradient(circle at 100% 50%,#ffffff2e,transparent 70%)}
.rip svg{width:34px;height:34px}
.rip.on{opacity:1}
.chip{position:absolute;left:50%;top:calc(var(--st) + 70px);transform:translateX(-50%);padding:7px 14px;border-radius:999px;background:#000000b3;font-weight:700;font-size:13px;display:flex;align-items:center;gap:6px;opacity:0;transition:opacity .2s;pointer-events:none;white-space:nowrap}
.chip.on{opacity:1}
.chip svg{width:16px;height:16px}
#unmute{position:absolute;left:12px;top:calc(var(--st) + 64px);display:flex;align-items:center;gap:8px;padding:9px 14px;border-radius:999px;background:#ffffffeb;color:#000;font-weight:700;font-size:13px;box-shadow:0 4px 16px #0006}
#unmute svg{width:18px;height:18px}
/* "more videos" sheet when paused or finished */
.cta{position:absolute;left:12px;right:12px;bottom:calc(var(--sb) + 86px);margin:0 auto;max-width:420px;padding:14px;border-radius:16px;background:#1c1c1ef2;box-shadow:0 10px 30px #000a;display:flex;align-items:center;gap:12px;backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);animation:up .25s ease}
@keyframes up{from{opacity:0;transform:translateY(12px)}}
.cta .av{width:42px;height:42px;border-radius:12px;flex:none;display:grid;place-items:center;background:linear-gradient(45deg,#feda75,#fa7e1e 25%,#d62976 50%,#962fbf 75%,#4f5bd5);font-weight:800}
.cta p{margin:0;flex:1;font-size:13px;color:var(--mute);line-height:1.35}
.cta p b{display:block;color:#fff;font-size:14px}
.cta .go{padding:10px 14px;border-radius:10px;background:#0095f6;font-weight:700;font-size:13px;white-space:nowrap}
#err{position:absolute;inset:0;display:none;flex-direction:column;align-items:center;justify-content:center;gap:14px;background:#000e;text-align:center;padding:28px}
#err svg{width:48px;height:48px;color:var(--acc)}
#err p{margin:0;color:var(--mute);line-height:1.5;max-width:320px}
#err b{font-size:17px}
#err button{padding:12px 26px;border-radius:10px;background:#fff;color:#000;font-weight:700}
[hidden]{display:none!important}
</style>
</head><body class="show wait mute">
<div id="wrap">
<video id="v" autoplay muted playsinline preload="auto"></video>
<div class="spin"></div>
<div class="rip l" id="rl"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M11 6v12l-8.5-6zM21 6v12l-8.5-6z"/></svg>10 seconds</div>
<div class="rip r" id="rr"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M13 6v12l8.5-6zM3 6v12l8.5-6z"/></svg>10 seconds</div>
<div class="chip" id="chip"></div>
<div class="ui">
  <div class="top">
    <button class="ib hit" id="close" aria-label="Close"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg></button>
    <div class="ttl"><b id="name"></b><small id="sub"></small></div>
    <button class="spd hit" id="spd">1x</button>
    ${open ? '<button class="ib hit" id="shr" aria-label="Share"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M22 3 9.2 10.1M22 3l-7.4 18-4.2-8.5L2 9.1z"/></svg></button>' : ''}
  </div>
  <div class="mid">
    <button class="ib hit" id="back" aria-label="Back 10 seconds"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 3v5h5"/><text x="12" y="15.5" font-size="7.5" font-weight="700" text-anchor="middle" fill="currentColor" stroke="none" font-family="system-ui">10</text></svg></button>
    <button class="ib pp hit" id="pp" aria-label="Play/pause"><svg class="pl" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.4-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z"/></svg><svg class="pa" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4.5" width="4.2" height="15" rx="1.3"/><rect x="13.8" y="4.5" width="4.2" height="15" rx="1.3"/></svg></button>
    <button class="ib hit" id="fwd" aria-label="Forward 10 seconds"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-3-6.7"/><path d="M21 3v5h-5"/><text x="12" y="15.5" font-size="7.5" font-weight="700" text-anchor="middle" fill="currentColor" stroke="none" font-family="system-ui">10</text></svg></button>
  </div>
  <div class="bot">
    <div class="row">
      <div class="tm"><b id="cur">0:00</b> <span>/ <span id="dur">0:00</span></span></div>
      <button class="ib hit snd" id="snd" aria-label="Sound"><svg class="on" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5 6 9H3v6h3l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13"/></svg><svg class="off" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5 6 9H3v6h3l5 4z"/><path d="m22 9-6 6M16 9l6 6"/></svg></button>
      <button class="ib hit full" id="full" aria-label="Fullscreen"><svg class="in" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg><svg class="out" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5"/></svg></button>
    </div>
    <div class="seek hit" id="seek"><div class="track"><i class="buf" id="buf"></i><i class="done" id="done"></i></div><div class="knob" id="knob"></div><div class="tip" id="tip">0:00</div></div>
  </div>
</div>
<button id="unmute" hidden><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5 6 9H3v6h3l5 4z"/><path d="m22 9-6 6M16 9l6 6"/></svg>Tap for sound</button>
${open ? `<div class="cta" id="cta" hidden><div class="av">${(bot || 'B').charAt(0).toUpperCase()}</div><p><b>Want more videos like this?</b>Unlimited videos in @${bot}</p><button class="go" id="more">Open</button></div>` : ''}
<div id="err"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9.5"/><path d="M12 7.5v5.5M12 16.5v.01"/></svg><b>Video couldn't play</b><p id="em"></p><button onclick="location.reload()">Try again</button></div>
</div>
<script>
var tg = window.Telegram && Telegram.WebApp;
try { tg.ready(); tg.expand(); tg.setHeaderColor("#000000"); tg.setBackgroundColor("#000000"); if (tg.disableVerticalSwipes) tg.disableVerticalSwipes(); } catch (e) {}
var SRC = ${J(src)}, KEY = "pos:" + ${J(key)}, OPEN = ${J(open)}, BOT = ${J(bot || '')}, NAME = ${J(name || '')};
var $ = function (id) { return document.getElementById(id); }, v = $("v"), B = document.body;
$("name").textContent = NAME || "Video"; $("sub").textContent = BOT ? "@" + BOT : "";
function fmt(s) { s = Math.max(0, Math.floor(s || 0)); var h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), x = s % 60; return (h ? h + ":" + (m < 10 ? "0" : "") : "") + m + ":" + (x < 10 ? "0" : "") + x; }
function haptic() { try { tg.HapticFeedback.impactOccurred("light"); } catch (e) {} }
var store = { get: function () { try { return +localStorage.getItem(KEY) || 0; } catch (e) { return 0; } }, set: function (x) { try { x ? localStorage.setItem(KEY, x) : localStorage.removeItem(KEY); } catch (e) {} } };

// controls: shown on a tap, hidden again 3 s later while playing
var hideT;
function showUI(stay) { B.classList.add("show"); clearTimeout(hideT); if (!stay && !v.paused) hideT = setTimeout(function () { if (!v.paused && !B.classList.contains("drag")) B.classList.remove("show"); }, 3000); }
function hideUI() { clearTimeout(hideT); if (!v.paused) B.classList.remove("show"); }
var chipT;
function chip(html, ms) { var c = $("chip"); c.innerHTML = html; c.classList.add("on"); clearTimeout(chipT); if (ms) chipT = setTimeout(function () { c.classList.remove("on"); }, ms); }

// play / pause, ±10 s
function toggle() { if (v.paused) v.play().catch(function () {}); else v.pause(); haptic(); }
function skip(d) { if (!v.duration) return; v.currentTime = Math.max(0, Math.min(v.duration - 0.5, v.currentTime + d)); var r = $(d < 0 ? "rl" : "rr"); r.classList.add("on"); clearTimeout(r._t); r._t = setTimeout(function () { r.classList.remove("on"); }, 600); haptic(); }
$("pp").onclick = function (e) { e.stopPropagation(); toggle(); showUI(); };
$("back").onclick = function (e) { e.stopPropagation(); skip(-10); showUI(); };
$("fwd").onclick = function (e) { e.stopPropagation(); skip(10); showUI(); };
v.addEventListener("play", function () { B.classList.add("playing"); showUI(); syncCta(); });
v.addEventListener("pause", function () { B.classList.remove("playing"); showUI(true); syncCta(); });
v.addEventListener("waiting", function () { B.classList.add("wait"); });
v.addEventListener("playing", function () { B.classList.remove("wait"); syncMute(); });
v.addEventListener("canplay", function () { B.classList.remove("wait"); });

// taps on the video: one = show/hide the controls, two on the left / right third = ∓10 s,
// hold = 2x while held (like YouTube)
var lastTap = 0, tapT, holdT, fast = false;
$("wrap").addEventListener("pointerdown", function (e) {
  if (e.target.closest(".hit,#unmute,.cta,#err")) return;
  holdT = setTimeout(function () { if (v.paused) return; fast = true; v.playbackRate = 2; chip('<svg viewBox="0 0 24 24" fill="currentColor"><path d="M4 6v12l8.5-6zM12.5 6v12L21 12z"/></svg>2x speed'); haptic(); }, 450);
});
function endHold() { clearTimeout(holdT); if (fast) { fast = false; v.playbackRate = rate; $("chip").classList.remove("on"); return true; } return false; }
$("wrap").addEventListener("pointerup", function (e) {
  if (endHold() || e.target.closest(".hit,#unmute,.cta,#err")) return;
  var x = e.clientX / innerWidth, now = Date.now();
  if (now - lastTap < 280 && (x < 0.38 || x > 0.62)) { clearTimeout(tapT); lastTap = now; skip(x < 0.38 ? -10 : 10); return; }
  lastTap = now; clearTimeout(tapT);
  tapT = setTimeout(function () { if (B.classList.contains("show") && !v.paused) hideUI(); else showUI(); }, 260);
});
$("wrap").addEventListener("pointercancel", endHold);

// the seek bar: drag anywhere on it; the time follows the finger
var seek = $("seek");
function frac(e) { var r = seek.getBoundingClientRect(); return Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)); }
function paint(f) { $("done").style.width = f * 100 + "%"; $("knob").style.left = f * 100 + "%"; }
seek.addEventListener("pointerdown", function (e) {
  if (!v.duration) return; e.stopPropagation(); B.classList.add("drag"); seek.classList.add("drag"); try { seek.setPointerCapture(e.pointerId); } catch (x) {} move(e); showUI(true);
});
function move(e) { var f = frac(e); paint(f); var t = $("tip"); t.textContent = fmt(f * v.duration); t.style.left = Math.max(8, Math.min(92, f * 100)) + "%"; }
seek.addEventListener("pointermove", function (e) { if (seek.classList.contains("drag")) move(e); });
function drop(e) { if (!seek.classList.contains("drag")) return; seek.classList.remove("drag"); B.classList.remove("drag"); v.currentTime = frac(e) * v.duration; showUI(); }
seek.addEventListener("pointerup", function (e) { e.stopPropagation(); drop(e); });
seek.addEventListener("pointercancel", drop);
function tick() {
  if (!v.duration) return;
  $("cur").textContent = fmt(v.currentTime); $("dur").textContent = fmt(v.duration);
  if (!seek.classList.contains("drag")) paint(v.currentTime / v.duration);
  for (var i = 0; i < v.buffered.length; i++) if (v.buffered.start(i) <= v.currentTime + 0.5 && v.buffered.end(i) >= v.currentTime) $("buf").style.width = (100 * v.buffered.end(i) / v.duration) + "%";
}
v.addEventListener("timeupdate", tick); v.addEventListener("progress", tick); v.addEventListener("loadedmetadata", tick);

// sound: muted at first (autoplay works everywhere), one tap anywhere on the pill or the button
function syncMute() { B.classList.toggle("mute", v.muted); $("unmute").hidden = !v.muted || (v.paused && !v.currentTime); }
v.addEventListener("volumechange", syncMute);
$("unmute").onclick = function (e) { e.stopPropagation(); v.muted = false; if (v.volume === 0) v.volume = 1; v.play().catch(function () {}); haptic(); };
$("snd").onclick = function (e) { e.stopPropagation(); v.muted = !v.muted; if (!v.muted && v.volume === 0) v.volume = 1; showUI(); haptic(); };

// speed
var SPEEDS = [1, 1.25, 1.5, 2, 0.75], rate = 1;
$("spd").onclick = function (e) { e.stopPropagation(); rate = SPEEDS[(SPEEDS.indexOf(rate) + 1) % SPEEDS.length]; v.playbackRate = rate; this.textContent = rate + "x"; chip(rate + "x speed", 900); showUI(); haptic(); };

// fullscreen (also when the phone turns sideways)
function inFs() { return !!(document.fullscreenElement || document.webkitFullscreenElement); }
function goFs() { var el = $("wrap"); try { if (el.requestFullscreen) return el.requestFullscreen().then(function () { try { screen.orientation.lock("landscape"); } catch (x) {} }).catch(function () {}); if (v.webkitEnterFullscreen) v.webkitEnterFullscreen(); } catch (x) {} }
function exitFs() { try { (document.exitFullscreen || document.webkitExitFullscreen).call(document); } catch (x) {} }
$("full").onclick = function (e) { e.stopPropagation(); inFs() ? exitFs() : goFs(); showUI(); };
document.addEventListener("fullscreenchange", function () { B.classList.toggle("fs", inFs()); });
function landscape() { return ((screen.orientation && screen.orientation.type) || "").indexOf("landscape") === 0 || Math.abs(window.orientation || 0) === 90; }
function onTurn() { if (landscape() && !inFs() && v.currentTime) goFs(); else if (!landscape() && inFs()) exitFs(); }
if (screen.orientation && screen.orientation.addEventListener) screen.orientation.addEventListener("change", onTurn); else addEventListener("orientationchange", onTurn);

// close: back to the chat
$("close").onclick = function (e) { e.stopPropagation(); try { if (tg && tg.initData) return tg.close(); } catch (x) {} history.length > 1 ? history.back() : window.close(); };

// share / "more videos" (inside Telegram through the Mini App API, in a browser as a normal link)
var SHARE_TEXT = "🎬 Watch this video in 1 tap — no download needed 👇";
function go(u) { try { if (tg && tg.initData && tg.openTelegramLink) return tg.openTelegramLink(u); } catch (x) {} if (!window.open(u, "_blank")) location.href = u; }
function share() { if (!(tg && tg.initData) && navigator.share) return navigator.share({ text: SHARE_TEXT, url: OPEN }).catch(function () {}); go("https://t.me/share/url?url=" + encodeURIComponent(OPEN) + "&text=" + encodeURIComponent(SHARE_TEXT)); }
function syncCta() { if ($("cta")) $("cta").hidden = !(v.ended || (v.paused && v.currentTime > 3)); }
if (OPEN) { $("shr").onclick = function (e) { e.stopPropagation(); share(); }; $("more").onclick = function (e) { e.stopPropagation(); go(OPEN); }; v.addEventListener("ended", syncCta); }

// resume where you left off
var resumed = false;
v.addEventListener("loadedmetadata", function () {
  var at = store.get();
  if (!resumed && at > 5 && at < v.duration - 15) { v.currentTime = at; chip("Resumed from " + fmt(at), 1800); }
  resumed = true;
});
var saved = 0;
v.addEventListener("timeupdate", function () { if (Date.now() - saved > 4000) { saved = Date.now(); store.set(v.currentTime > 5 && v.currentTime < v.duration - 15 ? Math.floor(v.currentTime) : 0); } });
v.addEventListener("ended", function () { store.set(0); showUI(true); });

// keyboard (desktop)
addEventListener("keydown", function (e) {
  if (e.key === " " || e.key === "k") { e.preventDefault(); toggle(); }
  else if (e.key === "ArrowLeft" || e.key === "j") skip(-10);
  else if (e.key === "ArrowRight" || e.key === "l") skip(10);
  else if (e.key === "m") v.muted = !v.muted;
  else if (e.key === "f") inFs() ? exitFs() : goFs();
  showUI();
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
