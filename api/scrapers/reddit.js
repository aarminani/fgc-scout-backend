import { normalizeRedditPost } from '../../lib/normalize.js';
import { getConfig } from '../../lib/getConfig.js';

const USER_AGENT = process.env.REDDIT_USER_AGENT || 'FGCScout/1.0';

async function fetchSubreddit(subreddit, sort = 'hot', limit = 25) {
  const url = `https://www.reddit.com/r/${subreddit}/${sort}.json?limit=${limit}&raw_json=1`;
  const res = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT, 'Accept': 'application/json' },
  });
  if (!res.ok) throw new Error(`Reddit ${subreddit} returned ${res.status}`);
  const data = await res.json();
  return data?.data?.children || [];
}

export async function fetchReddit() {
  const cfg = await getConfig();
  const subreddits = cfg.reddit_subreddits;
  const results = [];
  const errors = [];

  for (const subreddit of subreddits) {
    try {
      const [hotPosts, topPosts] = await Promise.allSettled([
        fetchSubreddit(subreddit, 'hot', 15),
        fetchSubreddit(subreddit, 'top', 10),
      ]);

      const allPosts = [
        ...(hotPosts.status === 'fulfilled' ? hotPosts.value : []),
        ...(topPosts.status === 'fulfilled' ? topPosts.value : []),
      ];

      const seen = new Set();
      for (const post of allPosts) {
        const id = post?.data?.id;
        if (!id || seen.has(id)) continue;
        seen.add(id);
        const d = post.data;
        if (d.stickied) continue;
        if (d.score < 5 && d.num_comments < 3) continue;
        results.push(normalizeRedditPost(post, subreddit));
      }

      await new Promise(r => setTimeout(r, 200));
    } catch (err) {
      errors.push({ subreddit, error: err.message });
      console.error(`[Reddit] Failed r/${subreddit}:`, err.message);
    }
  }

  results.sort((a, b) => (b.score + b.comment_count * 2) - (a.score + a.comment_count * 2));
  return { items: results, errors };
}
