import { ensureSchema, getRecentFeed } from '../lib/db.js';
import { feedToPromptText } from '../lib/normalize.js';

export const config = {
  runtime: 'nodejs',
};

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    await ensureSchema();

    const { platforms, limit = '100', format = 'json' } = req.query;

    const platformFilter = platforms
      ? platforms.split(',').map(s => s.trim()).filter(Boolean)
      : [];

    const items = await getRecentFeed({
      limit: Math.min(parseInt(limit, 10) || 100, 200),
      platforms: platformFilter,
    });

    // Return as JSON (for the frontend to display)
    // or as a formatted text blob (for pasting directly into a Claude prompt)
    if (format === 'text') {
      const text = feedToPromptText(items);
      res.setHeader('Content-Type', 'text/plain');
      return res.status(200).send(text);
    }

    const meta = {
      total: items.length,
      fetched_at: new Date().toISOString(),
      platforms: [...new Set(items.map(i => i.platform))],
    };

    return res.status(200).json({ ok: true, meta, items });
  } catch (err) {
    console.error('[/api/feed] Error:', err.message);
    return res.status(500).json({ error: 'Failed to load feed', detail: err.message });
  }
}
