import { normalizeYouTubeVideo } from '../../lib/normalize.js';

const API_KEY        = process.env.YOUTUBE_API_KEY;
const CHANNEL_IDS    = (process.env.YOUTUBE_CHANNEL_IDS || '')
  .split(',').map(s => s.trim()).filter(Boolean);
const SEARCH_TERMS   = (process.env.YOUTUBE_SEARCH_TERMS || 'tekken 8,tekken tier list')
  .split(',').map(s => s.trim()).filter(Boolean);

const BASE = 'https://www.googleapis.com/youtube/v3';

// Date 7 days ago in RFC3339 for "publishedAfter" param
function sevenDaysAgo() {
  const d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  return d.toISOString();
}

// Enrich search results with real view/like/comment counts
async function enrichWithStats(videoIds) {
  if (!videoIds.length) return {};

  const params = new URLSearchParams({
    part:  'statistics',
    id:    videoIds.join(','),
    key:   API_KEY,
  });

  const res = await fetch(`${BASE}/videos?${params}`);
  if (!res.ok) return {};

  const data = await res.json();
  const map  = {};
  for (const item of data.items || []) {
    map[item.id] = item.statistics || {};
  }
  return map;
}

// Get recent uploads from a specific channel
async function fetchChannelVideos(channelId, maxResults = 10) {
  const params = new URLSearchParams({
    part:          'snippet',
    channelId,
    maxResults,
    order:         'date',
    type:          'video',
    publishedAfter: sevenDaysAgo(),
    key:           API_KEY,
  });

  const res = await fetch(`${BASE}/search?${params}`);
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Channel ${channelId} returned ${res.status}: ${body.slice(0, 200)}`);
  }

  const data   = await res.json();
  const items  = data.items || [];
  const ids    = items.map(v => v.id?.videoId).filter(Boolean);
  const stats  = await enrichWithStats(ids);

  return items
    .filter(v => v.id?.videoId)
    .map(v => normalizeYouTubeVideo(
      { ...v, statistics: stats[v.id.videoId] || {} },
      v.snippet?.channelTitle || ''
    ));
}

// Search for recent high-performing videos by keyword
async function fetchKeywordVideos(term, maxResults = 10) {
  const params = new URLSearchParams({
    part:          'snippet',
    q:             term,
    maxResults,
    order:         'viewCount',   // surface what's performing
    type:          'video',
    publishedAfter: sevenDaysAgo(),
    relevanceLanguage: 'en',
    key:           API_KEY,
  });

  const res = await fetch(`${BASE}/search?${params}`);
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Search "${term}" returned ${res.status}: ${body.slice(0, 200)}`);
  }

  const data  = await res.json();
  const items = data.items || [];
  const ids   = items.map(v => v.id?.videoId).filter(Boolean);
  const stats = await enrichWithStats(ids);

  return items
    .filter(v => v.id?.videoId)
    .map(v => normalizeYouTubeVideo(
      { ...v, statistics: stats[v.id.videoId] || {} },
      ''
    ));
}

export async function fetchYouTube() {
  if (!API_KEY) {
    console.warn('[YouTube] YOUTUBE_API_KEY not set — skipping');
    return { items: [], errors: [{ error: 'API key not configured' }] };
  }

  const results = [];
  const errors  = [];
  const seen    = new Set();

  // Specific channels
  for (const channelId of CHANNEL_IDS) {
    try {
      const videos = await fetchChannelVideos(channelId);
      for (const v of videos) {
        if (!seen.has(v.id)) { seen.add(v.id); results.push(v); }
      }
    } catch (err) {
      errors.push({ channelId, error: err.message });
      console.error(`[YouTube] Failed channel ${channelId}:`, err.message);
    }
  }

  // Keyword searches
  for (const term of SEARCH_TERMS) {
    try {
      const videos = await fetchKeywordVideos(term);
      for (const v of videos) {
        if (!seen.has(v.id)) { seen.add(v.id); results.push(v); }
      }
    } catch (err) {
      errors.push({ term, error: err.message });
      console.error(`[YouTube] Failed search "${term}":`, err.message);
    }
  }

  // Sort by view count (strongest signal for YT virality)
  results.sort((a, b) => b.view_count - a.view_count);

  return { items: results, errors };
}
