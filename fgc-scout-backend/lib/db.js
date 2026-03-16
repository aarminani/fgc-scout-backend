import { createClient } from '@supabase/supabase-js';

let _client = null;

export function getDb() {
  if (_client) return _client;

  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in environment');
  }

  // Use service role key (backend only — never expose this to the frontend)
  _client = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );

  return _client;
}

// No-op — Supabase tables are created via SQL editor (see bottom of file)
export async function ensureSchema() {
  return;
}

export async function upsertItems(items) {
  if (!items.length) return 0;
  const db = getDb();

  const { error } = await db
    .from('feed_items')
    .upsert(items, { onConflict: 'id', ignoreDuplicates: true });

  if (error) {
    console.error('upsertItems error:', error.message);
    return 0;
  }

  return items.length;
}

export async function getRecentFeed({ limit = 100, platforms = [] } = {}) {
  const db = getDb();

  let query = db
    .from('feed_items')
    .select('*')
    .order('fetched_at', { ascending: false })
    .limit(limit);

  if (platforms.length) {
    query = query.in('platform', platforms);
  }

  const { data, error } = await query;

  if (error) {
    console.error('getRecentFeed error:', error.message);
    return [];
  }

  return data || [];
}

export async function pruneOldItems(maxPerSource = 50) {
  const db = getDb();

  const { error } = await db.rpc('prune_feed_items', { max_per_source: maxPerSource });

  if (error) {
    console.warn('pruneOldItems warning:', error.message);
  }
}

export async function logFetch({ platform, status, item_count = 0, error = null }) {
  const db = getDb();

  await db.from('fetch_log').insert({
    platform,
    status,
    item_count,
    error,
    ran_at: new Date().toISOString(),
  });
}

/*
── SUPABASE SETUP SQL ────────────────────────────────────────────────────────
Run this ONCE in: Supabase Dashboard → SQL Editor → New Query

create table if not exists feed_items (
  id            text primary key,
  source        text not null,
  platform      text not null,
  title         text,
  body          text,
  url           text,
  author        text,
  score         integer default 0,
  comment_count integer default 0,
  view_count    integer default 0,
  fetched_at    bigint not null,
  created_at    bigint not null
);

create index if not exists idx_platform   on feed_items(platform);
create index if not exists idx_fetched_at on feed_items(fetched_at desc);

create table if not exists fetch_log (
  id          bigserial primary key,
  platform    text not null,
  status      text not null,
  item_count  integer default 0,
  error       text,
  ran_at      timestamptz not null
);

create or replace function prune_feed_items(max_per_source int)
returns void language sql as $$
  delete from feed_items
  where id in (
    select id from (
      select id,
             row_number() over (partition by source order by fetched_at desc) as rn
      from feed_items
    ) ranked
    where rn > max_per_source
  );
$$;
─────────────────────────────────────────────────────────────────────────────
*/
