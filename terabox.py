import logging
log = logging.getLogger(__name__)
import asyncio
import re
from urllib.parse import parse_qs, urlparse, quote

import aiohttp

from config import TERABOX_RESOLVER_WORKER, TERABOX_HLS_PROXY_WORKER, TERABOX_JSTOKEN
from tools import extract_code_from_url


# ---------------- URL VALIDATION ---------------- #

def check_url_patterns(url):
    patterns = [
        # Primary
        r"terabox\.com",
        r"terabox\.app",
        r"terabox\.fun",
        r"terabox\.best",
        r"terabox\.ap",
        r"terabox\.club",
        r"terabox\.click",
        r"terabox\.me",
        r"terabox\.site",
        r"terabox\.pro",
        r"terabox\.xyz",
        r"teraboxapp\.com",
        r"teraboxlink\.com",
        r"teraboxlinke\.com",
        r"teraboxshare\.com",
        r"teraboxsharefile\.com",
        r"teraboxurl\.com",
        r"teraboxfree\.com",
        r"teraboxmod\.app",
        # Share domains
        r"terasharelink\.com",
        r"terasharefile\.com",
        r"terashareus\.com",
        r"terafileshare\.com",
        r"terasharedrive\.com",
        # 1024 variants
        r"tera1024box\.com",
        r"1024tera\.com",
        r"1024tera\.co",
        r"1024terabox\.com",
        r"1024-terabox\.com",
        r"1024box\.com",
        # 4fun variants
        r"4funbox\.com",
        r"4funbox\.co",
        r"4funbox\.in",
        # Mirror / legacy
        r"mirrobox\.com",
        r"nephobox\.com",
        r"freeterabox\.com",
        r"momerybox\.com",
        r"tibibox\.com",
        r"gibibox\.com",
        r"pebibox\.com",
        r"fancybox\.in",
        r"dubox\.com",
        r"bestclouddrive\.com",
        r"playduo\.link",
        r"theteraboxmod\.app",
        r"teraboxdownloader\.com",
        r"teradownloader\.com",
    ]

    for pattern in patterns:
        if re.search(pattern, url):
            return True

    return False


def get_urls_from_string(string: str) -> list[str]:
    pattern = r"(https?://\S+)"
    urls = re.findall(pattern, string)
    urls = [url.rstrip(").,;:!?") for url in urls]
    urls = [url for url in urls if check_url_patterns(url)]
    if not urls:
        return []
    return urls[0]


def extract_surl_from_url(url: str) -> str | None:
    parsed_url = urlparse(url)
    query_params = parse_qs(parsed_url.query)
    surl = query_params.get("surl", [])
    return surl[0] if surl else False


# ---------------- RETRY WRAPPER ---------------- #

async def retry_request(method, url, attempts=3, delay=2, **kwargs):
    """Async retry wrapper for GET requests.

    4xx (except 429) fail fast — retrying a dead link is pointless.
    Backoff grows per attempt to avoid hammering a struggling worker.
    URLs are never logged (may carry the jsToken); only status codes.
    """
    timeout = aiohttp.ClientTimeout(total=30, connect=10, sock_read=15)
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
        "Accept": "application/json, text/plain, */*",
        "Accept-Language": "en-US,en;q=0.9",
    }
    headers.update(kwargs.pop("headers", None) or {})
    for i in range(1, attempts + 1):
        try:
            async with aiohttp.ClientSession(timeout=timeout, headers=headers) as session:
                async with session.request(method, url, **kwargs) as resp:
                    if resp.status in (200, 302):
                        resp._text = await resp.text()
                        return resp
                    if resp.status == 429:
                        log.info(f"[Retry {i}] HTTP 429 (rate limited)")
                    elif 400 <= resp.status < 500:
                        log.info(f"[Retry {i}] HTTP {resp.status} (fail fast, no retry)")
                        return None
                    else:
                        log.info(f"[Retry {i}] HTTP {resp.status}")
        except Exception as e:
            from utils.logx import safe_exc
            log.info(f"[Retry {i}] Error: {safe_exc(e)}")
        await asyncio.sleep(delay * i)
    return None


# ---------------- WORKER-BASED RESOLVER ---------------- #
# No more ntmtbapi: resolves via a Cloudflare Worker that reads TeraBox's own
# share metadata, then builds an HLS (.m3u8) stream URL ourselves. Video only —
# the worker/token scheme here has no photo path (see get_files() below).

def _sanitize_filename(name: str) -> str:
    return re.sub(r'[\\/*?:"<>|]', "", str(name or "")).strip() or "file"


async def _resolve_share_metadata(share_code: str):
    """Fetch {shareid, uk, sign, timestamp, list:[...]} for a share code."""
    api_url = f"{TERABOX_RESOLVER_WORKER}/?q={share_code}"
    res = await retry_request("GET", api_url, attempts=2, delay=2)
    if not res:
        log.info("Resolver worker unreachable after retries")
        return False
    try:
        data = await res.json()
    except Exception as e:
        from utils.logx import safe_exc
        log.info(f"Resolver worker bad response: {safe_exc(e, 60)}")
        return False
    if not isinstance(data, dict) or data.get("errno") != 0 or not data.get("list"):
        log.info(f"Resolver worker error: {(data or {}).get('show_msg') or 'no files'}")
        return False
    return data


def _build_stream_url(shareid, uk, sign, timestamp, fid, quality="M3U8_AUTO_480"):
    """Build the HLS (.m3u8) stream URL for one file, proxied through the HLS worker."""
    streaming_link = (
        f"https://1024tera.com/share/streaming.m3u8?uk={uk}"
        f"&shareid={shareid}&type={quality}&fid={fid}"
        f"&sign={sign}&timestamp={timestamp}"
        f"&jsToken={TERABOX_JSTOKEN}"
        f"&esl=1&isplayer=1&ehps=1&clienttype=0&app_id=250528&web=1&channel=dubox"
    )
    return f"{TERABOX_HLS_PROXY_WORKER}/?hls={quote(streaming_link, safe='')}"


async def _fetch_files_via_worker(url: str):
    share_code = extract_code_from_url(url)
    if not share_code:
        log.info("No share code found in URL")
        return False

    data = await _resolve_share_metadata(share_code)
    if not data:
        return False

    shareid, uk, sign, timestamp = data["shareid"], data["uk"], data["sign"], data["timestamp"]

    result = []
    for item in data["list"]:
        fid = item.get("fs_id")
        if not fid:
            continue
        file_name = _sanitize_filename(item.get("server_filename") or "video.mp4")
        result.append({
            "file_name": file_name,
            "size": "Unknown",   # not known until after download — see main.py post-download gate
            "sizebytes": 0,
            "thumb": None,
            "direct_link": _build_stream_url(shareid, uk, sign, timestamp, fid),
            "link": _build_stream_url(shareid, uk, sign, timestamp, fid),
            "expires_in": "",
        })

    if not result:
        log.info("Resolver worker returned no usable files")
        return False

    log.info(f"Resolved files: count={len(result)}")
    return result


async def get_files(url: str):
    """Async: resolve every file in a TeraBox share link via the worker."""
    return await _fetch_files_via_worker(url)


async def get_data(url: str):
    """Async: Fetch the FIRST Terabox file only."""
    files = await get_files(url)
    if not files:
        return False
    return files[0]


async def get_fallback_files(url: str):
    """Async: re-resolve fresh (new sign/timestamp) — used to retry a download
    whose stream URL failed/expired."""
    return await _fetch_files_via_worker(url)
