import { normalizeRedditPost } from '../../lib/normalize.js';

const SUBREDDITS = (process.env.REDDIT_SUBREDDITS || 'Tekken,Tekken8,kappa')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

const USER_AGENT = process.env.REDDIT_USER_AGENT || 'FGCScout/1.0';

// Reddit's public .json API works without OAuth for read-only access.
// For higher rate limits (60 req/min instead of 10), add OAuth below.
async function fetchSubreddit(subreddit, sort = 'hot', limit = 25) {
  const url = `https://www.reddit.com/r/${subreddit}/${sort}.json?limit=${limit}&raw_json=1`;

  const res = await fetch(url, {
    headers: {
      'User-Agent': USER_AGENT,
      'Accept': 'application/json',
    },
  });

  if (!res.ok) {
    throw new Error(`Reddit ${subreddit} returned ${res.status}`);
  }

  const data = await res.json();
  return data?.data?.children || [];
}

// Optionally get an OAuth token for higher rate limits.
// Set REDDIT_CLIENT_ID and REDDIT_CLIENT_SECRET in env to enable.
async function getOAuthToken() {
  const { REDDIT_CLIENT_ID, REDDIT_CLIENT_SECRET, REDDIT_USER_AGENT } = process.env;
  if (!REDDIT_CLIENT_ID || !REDDIT_CLIENT_SECRET) return null;

  const credentials = Buffer.from(`${REDDIT_CLIENT_ID}:${REDDIT_CLIENT_SECRET}`).toString('base64');

  const res = await fetch('https://www.reddit.com/api/v1/access_token', {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${credentials}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': REDDIT_USER_AGENT || USER_AGENT,
    },
    body: 'grant_type=client_credentials',
  });

  if (!res.ok) return null;
  const data = await res.json();
  return data.access_token || null;
}

export async function fetchReddit() {
  const results = [];
  const errors = [];

  // Stagger requests slightly to avoid rate limiting
  for (const subreddit of SUBREDDITS) {
    try {
      // Pull both hot and top/week for better coverage
      const [hotPosts, topPosts] = await Promise.allSettled([
        fetchSubreddit(subreddit, 'hot', 15),
        fetchSubreddit(subreddit, 'top', 10),
      ]);

      const allPosts = [
        ...(hotPosts.status === 'fulfilled' ? hotPosts.value : []),
        ...(topPosts.status === 'fulfilled' ? topPosts.value : []),
      ];

      // Deduplicate by post id within this batch
      const seen = new Set();
      for (const post of allPosts) {
        const id = post?.data?.id;
        if (!id || seen.has(id)) continue;
        seen.add(id);

        // Filter: skip stickied posts and very low engagement
        const d = post.data;
        if (d.stickied) continue;
        if (d.score < 5 && d.num_comments < 3) continue;

        results.push(normalizeRedditPost(post, subreddit));
      }

      // Small delay between subreddits
      await new Promise(r => setTimeout(r, 200));
    } catch (err) {
      errors.push({ subreddit, error: err.message });
      console.error(`[Reddit] Failed to fetch r/${subreddit}:`, err.message);
    }
  }

  // Sort by engagement score descending
  results.sort((a, b) => (b.score + b.comment_count * 2) - (a.score + a.comment_count * 2));

  return { items: results, errors };
}
