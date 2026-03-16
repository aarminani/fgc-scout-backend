import { getDb } from '../lib/db.js';

export const config = {
  runtime: 'nodejs',
};

const DEFAULT_CONFIG = {
  reddit_subreddits: ['Tekken', 'Tekken8', 'kappa', 'StreetFighter'],
  twitter_accounts: ['Harada_TEKKEN', 'TekkenEsports', 'HomeOfTekken', 'JDCR_Tekken'],
  twitter_keywords: ['tekken8', 'tekken patch', 'tekken tier list', 'fgc'],
  youtube_channel_ids: [],
  youtube_search_terms: ['tekken 8', 'tekken tier list', 'fgc highlights'],
};

export default async function handler(req, res) {
  const db = getDb();

  // GET — return current config
  if (req.method === 'GET') {
    try {
      const { data, error } = await db
        .from('scout_config')
        .select('*')
        .order('key');

      if (error) throw error;

      // Build config object from rows, fall back to defaults
      const cfg = { ...DEFAULT_CONFIG };
      for (const row of data || []) {
        try { cfg[row.key] = JSON.parse(row.value); } catch {}
      }

      return res.status(200).json({ ok: true, config: cfg });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  // POST — update a config key
  if (req.method === 'POST') {
    const secret = process.env.CRON_SECRET;
    const auth = req.headers.authorization;
    if (secret && auth !== `Bearer ${secret}`) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    try {
      const { key, value } = req.body;

      if (!key || !Object.keys(DEFAULT_CONFIG).includes(key)) {
        return res.status(400).json({ error: 'Invalid config key' });
      }

      await db.from('scout_config').upsert(
        { key, value: JSON.stringify(value), updated_at: new Date().toISOString() },
        { onConflict: 'key' }
      );

      return res.status(200).json({ ok: true, key, value });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
