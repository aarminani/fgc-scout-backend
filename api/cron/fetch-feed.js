import { ensureSchema, upsertItems, pruneOldItems, logFetch } from '../../lib/db.js';
import { fetchReddit } from '../scrapers/reddit.js';
import { fetchTwitter } from '../scrapers/twitter.js';
import { fetchYouTube } from '../scrapers/youtube.js';

const MAX_ITEMS = parseInt(process.env.FEED_MAX_ITEMS_PER_SOURCE || '50', 10);

export const config = {
  runtime: 'nodejs',
};

export default async function handler(req, res) {
  // Protect the endpoint — Vercel sends CRON_SECRET automatically,
  // but also support manual runs with the same header.
  const secret = process.env.CRON_SECRET;
  const authHeader = req.headers.authorization;

  if (secret && authHeader !== `Bearer ${secret}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  console.log('[Cron] fetch-feed started at', new Date().toISOString());

  try {
    await ensureSchema();
  } catch (err) {
    console.error('[Cron] Schema init failed:', err.message);
    return res.status(500).json({ error: 'DB init failed', detail: err.message });
  }

  const summary = { reddit: null, twitter: null, youtube: null, errors: [] };

  // ── Reddit ────────────────────────────────────────────────────────────────
  try {
    const { items, errors } = await fetchReddit();
    const inserted = await upsertItems(items);
    await logFetch({ platform: 'reddit', status: 'ok', item_count: inserted });
    summary.reddit = { fetched: items.length, inserted };
    if (errors.length) summary.errors.push(...errors.map(e => ({ platform: 'reddit', ...e })));
    console.log(`[Cron] Reddit: ${items.length} fetched, ${inserted} new`);
  } catch (err) {
    await logFetch({ platform: 'reddit', status: 'error', error: err.message });
    summary.errors.push({ platform: 'reddit', error: err.message });
    console.error('[Cron] Reddit failed:', err.message);
  }

  // ── Twitter ───────────────────────────────────────────────────────────────
  try {
    const { items, errors } = await fetchTwitter();
    const inserted = await upsertItems(items);
    await logFetch({ platform: 'twitter', status: 'ok', item_count: inserted });
    summary.twitter = { fetched: items.length, inserted };
    if (errors.length) summary.errors.push(...errors.map(e => ({ platform: 'twitter', ...e })));
    console.log(`[Cron] Twitter: ${items.length} fetched, ${inserted} new`);
  } catch (err) {
    await logFetch({ platform: 'twitter', status: 'error', error: err.message });
    summary.errors.push({ platform: 'twitter', error: err.message });
    console.error('[Cron] Twitter failed:', err.message);
  }

  // ── YouTube ───────────────────────────────────────────────────────────────
  try {
    const { items, errors } = await fetchYouTube();
    const inserted = await upsertItems(items);
    await logFetch({ platform: 'youtube', status: 'ok', item_count: inserted });
    summary.youtube = { fetched: items.length, inserted };
    if (errors.length) summary.errors.push(...errors.map(e => ({ platform: 'youtube', ...e })));
    console.log(`[Cron] YouTube: ${items.length} fetched, ${inserted} new`);
  } catch (err) {
    await logFetch({ platform: 'youtube', status: 'error', error: err.message });
    summary.errors.push({ platform: 'youtube', error: err.message });
    console.error('[Cron] YouTube failed:', err.message);
  }

  // ── Prune old items ───────────────────────────────────────────────────────
  try {
    await pruneOldItems(MAX_ITEMS);
    console.log(`[Cron] Pruned to ${MAX_ITEMS} items per source`);
  } catch (err) {
    console.error('[Cron] Prune failed:', err.message);
  }

  const totalInserted =
    (summary.reddit?.inserted || 0) +
    (summary.twitter?.inserted || 0) +
    (summary.youtube?.inserted || 0);

  console.log(`[Cron] Done. Total new items: ${totalInserted}`);

  return res.status(200).json({
    ok: true,
    ran_at: new Date().toISOString(),
    summary,
    total_new: totalInserted,
  });
}
