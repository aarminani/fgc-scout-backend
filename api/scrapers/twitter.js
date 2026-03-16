import { normalizeTweet } from '../../lib/normalize.js';
import { getConfig } from '../../lib/getConfig.js';

const BEARER_TOKEN = process.env.TWITTER_BEARER_TOKEN;
const BASE = 'https://api.twitter.com/2';
const TWEET_FIELDS = 'created_at,public_metrics,author_id';
const MAX_RESULTS = 20;

function authHeaders() {
  if (!BEARER_TOKEN) throw new Error('TWITTER_BEARER_TOKEN is not set');
  return { Authorization: `Bearer ${BEARER_TOKEN}`, 'Content-Type': 'application/json' };
}

async function resolveUserId(handle) {
  const res = await fetch(`${BASE}/users/by/username/${handle}?user.fields=id`, { headers: authHeaders() });
  if (!res.ok) throw new Error(`Could not resolve @${handle}: ${res.status}`);
  const data = await res.json();
  return data?.data?.id;
}

async function fetchAccountTimeline(handle) {
  const userId = await resolveUserId(handle);
  const params = new URLSearchParams({ max_results: MAX_RESULTS, tweet_fields: TWEET_FIELDS, exclude: 'retweets,replies' });
  const res = await fetch(`${BASE}/users/${userId}/tweets?${params}`, { headers: authHeaders() });
  if (!res.ok) throw new Error(`Timeline @${handle} returned ${res.status}`);
  const data = await res.json();
  return (data?.data || []).map(t => normalizeTweet(t, handle));
}

async function fetchKeywordSearch(keyword) {
  const query = `${keyword} -is:retweet lang:en`;
  const params = new URLSearchParams({ query, max_results: MAX_RESULTS, tweet_fields: TWEET_FIELDS, sort_order: 'relevancy' });
  const res = await fetch(`${BASE}/tweets/search/recent?${params}`, { headers: authHeaders() });
  if (!res.ok) throw new Error(`Search "${keyword}" returned ${res.status}`);
  const data = await res.json();
  return (data?.data || []).map(t => normalizeTweet(t, ''));
}

export async function fetchTwitter() {
  if (!BEARER_TOKEN) {
    console.warn('[Twitter] TWITTER_BEARER_TOKEN not set — skipping');
    return { items: [], errors: [{ error: 'Bearer token not configured' }] };
  }

  const cfg = await getConfig();
  const results = [];
  const errors = [];
  const seen = new Set();

  for (const handle of cfg.twitter_accounts) {
    try {
      const tweets = await fetchAccountTimeline(handle);
      for (const t of tweets) { if (!seen.has(t.id)) { seen.add(t.id); results.push(t); } }
      await new Promise(r => setTimeout(r, 500));
    } catch (err) {
      errors.push({ handle, error: err.message });
      console.error(`[Twitter] Failed @${handle}:`, err.message);
    }
  }

  for (const keyword of cfg.twitter_keywords) {
    try {
      const tweets = await fetchKeywordSearch(keyword);
      for (const t of tweets) { if (!seen.has(t.id)) { seen.add(t.id); results.push(t); } }
      await new Promise(r => setTimeout(r, 500));
    } catch (err) {
      errors.push({ keyword, error: err.message });
      console.error(`[Twitter] Failed search "${keyword}":`, err.message);
    }
  }

  results.sort((a, b) => {
    const engA = a.score + a.comment_count * 2 + Math.floor(a.view_count / 1000);
    const engB = b.score + b.comment_count * 2 + Math.floor(b.view_count / 1000);
    return engB - engA;
  });

  return { items: results, errors };
}
