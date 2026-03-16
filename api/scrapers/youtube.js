import { normalizeYouTubeVideo } from '../../lib/normalize.js';
import { getConfig } from '../../lib/getConfig.js';

const API_KEY = process.env.YOUTUBE_API_KEY;
const BASE = 'https://www.googleapis.com/youtube/v3';

function sevenDaysAgo() {
  return new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
}

async function enrichWithStats(videoIds) {
  if (!videoIds.length) return {};
  const params = new URLSearchParams({ part: 'statistics', id: videoIds.join(','), key: API_KEY });
  const res = await fetch(`${BASE}/videos?${params}`);
  if (!res.ok) return {};
  const data = await res.json();
  const map = {};
  for (const item of data.items || []) { map[item.id] = item.statistics || {}; }
  return map;
}

async function fetchChannelVideos(channelId, maxResults = 10) {
  const params = new URLSearchParams({ part: 'snippet', channelId, maxResults, order: 'date', type: 'video', publishedAfter: sevenDaysAgo(), key: API_KEY });
  const res = await fetch(`${BASE}/search?${params}`);
  if (!res.ok) throw new Error(`Channel ${channelId} returned ${res.status}`);
  const data = await res.json();
  const items = data.items || [];
  const ids = items.map(v => v.id?.videoId).filter(Boolean);
  const stats = await enrichWithStats(ids);
  return items.filter(v => v.id?.videoId).map(v => normalizeYouTubeVideo({ ...v, statistics: stats[v.id.videoId] || {} }, v.snippet?.channelTitle || ''));
}

async function fetchKeywordVideos(term, maxResults = 10) {
  const params = new URLSearchParams({ part: 'snippet', q: term, maxResults, order: 'viewCount', type: 'video', publishedAfter: sevenDaysAgo(), relevanceLanguage: 'en', key: API_KEY });
  const res = await fetch(`${BASE}/search?${params}`);
  if (!res.ok) throw new Error(`Search "${term}" returned ${res.status}`);
  const data = await res.json();
  const items = data.items || [];
  const ids = items.map(v => v.id?.videoId).filter(Boolean);
  const stats = await enrichWithStats(ids);
  return items.filter(v => v.id?.videoId).map(v => normalizeYouTubeVideo({ ...v, statistics: stats[v.id.videoId] || {} }, ''));
}

export async function fetchYouTube() {
  if (!API_KEY) {
    console.warn('[YouTube] YOUTUBE_API_KEY not set — skipping');
    return { items: [], errors: [{ error: 'API key not configured' }] };
  }

  const cfg = await getConfig();
  const results = [];
  const errors = [];
  const seen = new Set();

  for (const channelId of cfg.youtube_channel_ids) {
    try {
      const videos = await fetchChannelVideos(channelId);
      for (const v of videos) { if (!seen.has(v.id)) { seen.add(v.id); results.push(v); } }
    } catch (err) {
      errors.push({ channelId, error: err.message });
      console.error(`[YouTube] Failed channel ${channelId}:`, err.message);
    }
  }

  for (const term of cfg.youtube_search_terms) {
    try {
      const videos = await fetchKeywordVideos(term);
      for (const v of videos) { if (!seen.has(v.id)) { seen.add(v.id); results.push(v); } }
    } catch (err) {
      errors.push({ term, error: err.message });
      console.error(`[YouTube] Failed search "${term}":`, err.message);
    }
  }

  results.sort((a, b) => b.view_count - a.view_count);
  return { items: results, errors };
}
