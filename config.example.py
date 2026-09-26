# ================== TELEGRAM API CONFIG ==================
# Get these from https://my.telegram.org/apps
API_ID = 12345678
API_HASH = "YOUR_API_HASH_HERE"

# Bot token from @BotFather
BOT_TOKEN = "1234567890:ABCdefGhIjKlMnOpQrStUvWxYz"


# ================== TURSO DATABASE CONFIG ==================

TURSO_DB_URL = "libsql://your-db-name.turso.io"
TURSO_AUTH_TOKEN = "your_turso_auth_token"


# ================== BOT SETTINGS ==================

# Private storage chat where files are uploaded
# Use your private channel / chat ID (must be integer)
PRIVATE_CHAT_ID = -1001234567890

# Folder where downloaded videos are stored on the VPS
DOWNLOAD_DIR = "downloads"


# ================== ADMIN & OWNER ==================

# Owner — only this user can run /update, /setstorage, /panic, /addadmin
OWNER_ID = 123456789

# Admin user IDs (MUST be integers)
# Owner is automatically admin
ADMINS = [
    123456789,
]


# ================== FORCE JOIN CHANNELS & GROUPS ==================

# Users must join these before using the bot
# Use username (e.g. "@your_channel") or chat ID (e.g. -1001234567890)
FORCE_CHANNELS = [
    "@your_channel",
]

FORCE_GROUPS = [
    "@your_group",
]


# ================== TERA BOX RESOLVER (worker-based, no ntmtbapi) ==================

# Cloudflare Worker that reads TeraBox's own share metadata (shareid/uk/sign/timestamp/list)
TERABOX_RESOLVER_WORKER = "https://your-metadata-worker.workers.dev"

# Cloudflare Worker that proxies the built streaming.m3u8 URL
TERABOX_HLS_PROXY_WORKER = "https://your-hls-proxy-worker.workers.dev"

# TeraBox web-session token embedded in the streaming URL. This WILL expire/rotate
# over time — update it here (or live via /setapi) when downloads start failing.
TERABOX_JSTOKEN = "your_js_token"

# Self-hosted Telegram Bot API server (replaces https://api.telegram.org)
# Enables high-speed uploads up to 2GB via the Bot HTTP API.
TG_API_BASE = "https://your-bot-api-server.com"


# ================== UPDATE SETTINGS ==================

GITHUB_REPO = "https://github.com/your-username/your-repo"
