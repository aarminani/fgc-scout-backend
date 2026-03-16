# FGC Scout Backend

Automated feed fetcher for the FGC Content Scout app. Pulls from Reddit, Twitter/X, and YouTube every 4 hours via Vercel Cron, stores results in Turso (SQLite), and exposes a `/api/feed` endpoint the Scout app reads from.

---

## Stack

| Layer | Tech |
|---|---|
| Hosting | Vercel (serverless + cron) |
| Database | Turso (SQLite on the edge) |
| Reddit | Public JSON API (no key needed) or OAuth for higher limits |
| Twitter/X | v2 API, Bearer Token (free Basic tier) |
| YouTube | Data API v3 (Google Cloud) |

---

## Setup

### 1. Clone and install

```bash
git clone https://github.com/you/fgc-scout-backend
cd fgc-scout-backend
npm install
```

### 2. Create a Turso database

```bash
# Install Turso CLI
curl -sSfL https://get.tur.so/install.sh | bash

# Login
turso auth login

# Create DB
turso db create fgc-scout

# Get credentials
turso db show fgc-scout --url    # → TURSO_DATABASE_URL
turso db tokens create fgc-scout # → TURSO_AUTH_TOKEN
```

### 3. Get your API keys

#### Reddit (optional — public API works without keys)
1. Go to https://www.reddit.com/prefs/apps
2. Click "create another app" → choose **script**
3. Name: `FGCScout`, redirect URI: `http://localhost`
4. Copy the client ID (under the app name) and client secret

#### Twitter/X
1. Go to https://developer.twitter.com/en/portal/dashboard
2. Create a project and app (Free tier is fine)
3. Under "Keys and Tokens" → copy **Bearer Token**
4. Note: Free tier gives you ~500k tweet reads/month — more than enough

#### YouTube
1. Go to https://console.cloud.google.com
2. Create a project → enable **YouTube Data API v3**
3. Credentials → Create credentials → **API Key**
4. Restrict the key to YouTube Data API v3 for security
5. Free quota: 10,000 units/day (each search = 100 units, video fetch = 1 unit)

### 4. Set environment variables

```bash
cp .env.example .env
# Fill in your values
```

For Vercel, add them in the dashboard: **Settings → Environment Variables**

Key variables to configure:
```
TURSO_DATABASE_URL=libsql://your-db.turso.io
TURSO_AUTH_TOKEN=...
REDDIT_SUBREDDITS=Tekken,Tekken8,kappa,StreetFighter
TWITTER_BEARER_TOKEN=...
TWITTER_ACCOUNTS=Harada_TEKKEN,TekkenEsports,HomeOfTekken
TWITTER_KEYWORDS=tekken8,tekken patch,tekken tier list
YOUTUBE_API_KEY=...
YOUTUBE_CHANNEL_IDS=UCo8bcnLyZH8tBIH9V1mLgqQ
YOUTUBE_SEARCH_TERMS=tekken 8,tekken tier list,fgc highlights
CRON_SECRET=your-random-secret-string
```

### 5. Deploy to Vercel

```bash
npm install -g vercel
vercel login
vercel --prod
```

The cron job at `0 */4 * * *` activates automatically on Vercel Pro or higher.
On Vercel Free, trigger it manually or upgrade.

---

## API Endpoints

### `GET /api/feed`

Returns recent feed items from the database.

**Query params:**
| Param | Default | Description |
|---|---|---|
| `platforms` | all | Comma-separated: `reddit,twitter,youtube` |
| `limit` | 100 | Max items to return (max 200) |
| `format` | `json` | Use `text` for a Claude-ready prompt blob |

**Examples:**
```bash
# All platforms, JSON
curl https://your-backend.vercel.app/api/feed

# Only Reddit + YouTube, last 50 items
curl "https://your-backend.vercel.app/api/feed?platforms=reddit,youtube&limit=50"

# Text format — paste directly into Claude
curl "https://your-backend.vercel.app/api/feed?format=text"
```

### `GET /api/cron/fetch-feed`

Triggers a manual feed refresh. Requires `Authorization: Bearer YOUR_CRON_SECRET` header.

```bash
curl -H "Authorization: Bearer your-cron-secret" \
  https://your-backend.vercel.app/api/cron/fetch-feed
```

---

## Connecting to the Scout App

In the Scout frontend, replace the manual paste input logic with:

```js
// Instead of manual paste, auto-load from your backend
const res = await fetch('https://your-backend.vercel.app/api/feed?format=text');
const feedText = await res.text();
// feedText is already formatted for the Claude prompt
```

Or fetch JSON and render the feed items in a sidebar before running the scout.

---

## Cron Schedule

The cron runs every 4 hours:
```
0 */4 * * *   → 12am, 4am, 8am, 12pm, 4pm, 8pm UTC
```

To change frequency, edit `vercel.json`:
```json
{ "schedule": "0 */2 * * *" }  // every 2 hours
{ "schedule": "0 8 * * *"   }  // once daily at 8am UTC
```

---

## Adding More Sources

1. Create `api/scrapers/your-source.js` following the same pattern
2. Export a `fetchYourSource()` function that returns `{ items, errors }`
3. Use the appropriate `normalize*` function from `lib/normalize.js` (or add a new one)
4. Import and call it in `api/cron/fetch-feed.js`
