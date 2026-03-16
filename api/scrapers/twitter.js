import { normalizeTweet } from '../../lib/normalize.js';

const BEARER_TOKEN = process.env.TWITTER_BEARER_TOKEN;
const ACCOUNTS     = (process.env.TWITTER_ACCOUNTS || '')
  .split(',').map(s => s.trim()).filter(Boolean);
const KEYWORDS     = (process.env.TWITTER_KEYWORDS || 'tekken8,tekken patch,fgc')
  .split(',').map(s => s.trim()).filter(Boolean);

const BASE = 'https://api.twitter.com/2';

const TWEET_FIELDS = 'created_at,public_metrics,author_id';
const MAX_RESULTS  = 20; // free tier allows up to 100

function authHeaders() {
  if (!BEARER_TOKEN) throw new Error('TWITTER_BEARER_TOKEN is not set');
  return {
    Authorization: `Bearer ${BEARER_TOKEN}`,
    'Content-Type': 'application/json',
  };
}

// Resolve @handle → user id (needed for timeline endpoint)
async function resolveUserId(handle) {
  const res = await fetch(`${BASE}/users/by/username/${handle}?user.fields=id`, {
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error(`Could not resolve @${handle}: ${res.status}`);
  const data = await res.json();
  return data?.data?.id;
}

// Fetch recent tweets from a user's timeline
async function fetchAccountTimeline(handle) {
  const userId = await resolveUserId(handle);
  if (!userId) throw new Error(`No user id for @${handle}`);

  const params = new URLSearchParams({
    max_results:  MAX_RESULTS,
    tweet_fields: TWEET_FIELDS,
    exclude:      'retweets,replies', // original tweets only
  });

  const res = await fetch(`${BASE}/users/${userId}/tweets?${params}`, {
    headers: authHeaders(),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Timeline @${handle} returned ${res.status}: ${body.slice(0, 200)}`);
  }

  const data = await res.json();
  return (data?.data || []).map(t => normalizeTweet(t, handle));
}

// Search recent tweets by keyword (last 7 days on free tier)
async function fetchKeywordSearch(keyword) {
  // Exclude retweets to keep the signal clean
  const query = `${keyword} -is:retweet lang:en`;

  const params = new URLSearchParams({
    query,
    max_results:  MAX_RESULTS,
    tweet_fields: TWEET_FIELDS,
    sort_order:   'relevancy',
  });

  const res = await fetch(`${BASE}/tweets/search/recent?${params}`, {
    headers: authHeaders(),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Search "${keyword}" returned ${res.status}: ${body.slice(0, 200)}`);
  }

  const data = await res.json();
  return (data?.data || []).map(t => normalizeTweet(t, ''));
}

export async function fetchTwitter() {
  if (!BEARER_TOKEN) {
    console.warn('[Twitter] TWITTER_BEARER_TOKEN not set — skipping');
    return { items: [], errors: [{ error: 'Bearer token not configured' }] };
  }

  const results = [];
  const errors  = [];
  const seen    = new Set();

  // Account timelines
  for (const handle of ACCOUNTS) {
    try {
      const tweets = await fetchAccountTimeline(handle);
      for (const t of tweets) {
        if (!seen.has(t.id)) { seen.add(t.id); results.push(t); }
      }
      // Twitter free tier is rate-limited — space out requests
      await new Promise(r => setTimeout(r, 500));
    } catch (err) {
      errors.push({ handle, error: err.message });
      console.error(`[Twitter] Failed @${handle}:`, err.message);
    }
  }

  // Keyword searches
  for (const keyword of KEYWORDS) {
    try {
      const tweets = await fetchKeywordSearch(keyword);
      for (const t of tweets) {
        if (!seen.has(t.id)) { seen.add(t.id); results.push(t); }
      }
      await new Promise(r => setTimeout(r, 500));
    } catch (err) {
      errors.push({ keyword, error: err.message });
      console.error(`[Twitter] Failed search "${keyword}":`, err.message);
    }
  }

  // Sort by engagement (likes + 2× replies + impressions/1000)
  results.sort((a, b) => {
    const engA = a.score + a.comment_count * 2 + Math.floor(a.view_count / 1000);
    const engB = b.score + b.comment_count * 2 + Math.floor(b.view_count / 1000);
    return engB - engA;
  });

  return { items: results, errors };
}
