// Normalizes raw API responses from each platform into a unified FeedItem shape.
// This is the single schema the Scout app and Claude prompt consume.

const now = () => Date.now();

// ── Reddit ──────────────────────────────────────────────────────────────────
// Raw: Reddit listing children (post objects from /r/sub/hot.json)
export function normalizeRedditPost(post, subreddit) {
  const d = post.data;
  return {
    id:            `reddit_${d.id}`,
    platform:      'reddit',
    source:        `r/${subreddit}`,
    title:         d.title || '',
    body:          (d.selftext || '').slice(0, 800),
    url:           `https://reddit.com${d.permalink}`,
    author:        d.author || '',
    score:         d.score || 0,
    comment_count: d.num_comments || 0,
    view_count:    0,
    fetched_at:    now(),
    created_at:    (d.created_utc || 0) * 1000,
  };
}

// ── Twitter/X ───────────────────────────────────────────────────────────────
// Raw: tweet objects from v2 /tweets/search/recent or /users/:id/tweets
export function normalizeTweet(tweet, accountHandle = '') {
  return {
    id:            `twitter_${tweet.id}`,
    platform:      'twitter',
    source:        accountHandle ? `@${accountHandle}` : 'twitter_search',
    title:         '',
    body:          tweet.text || '',
    url:           `https://twitter.com/i/web/status/${tweet.id}`,
    author:        accountHandle || tweet.author_id || '',
    score:         tweet.public_metrics?.like_count || 0,
    comment_count: tweet.public_metrics?.reply_count || 0,
    view_count:    tweet.public_metrics?.impression_count || 0,
    fetched_at:    now(),
    created_at:    tweet.created_at ? new Date(tweet.created_at).getTime() : now(),
  };
}

// ── YouTube ─────────────────────────────────────────────────────────────────
// Raw: YouTube Data API v3 search result or video resource
export function normalizeYouTubeVideo(video, channelHandle = '') {
  const snippet = video.snippet || {};
  const stats   = video.statistics || {};
  const videoId = video.id?.videoId || video.id || '';

  return {
    id:            `youtube_${videoId}`,
    platform:      'youtube',
    source:        channelHandle || snippet.channelTitle || 'youtube',
    title:         snippet.title || '',
    body:          (snippet.description || '').slice(0, 600),
    url:           `https://youtube.com/watch?v=${videoId}`,
    author:        snippet.channelTitle || '',
    score:         parseInt(stats.likeCount || 0, 10),
    comment_count: parseInt(stats.commentCount || 0, 10),
    view_count:    parseInt(stats.viewCount || 0, 10),
    fetched_at:    now(),
    created_at:    snippet.publishedAt ? new Date(snippet.publishedAt).getTime() : now(),
  };
}

// ── Feed → Claude prompt ─────────────────────────────────────────────────────
// Turns an array of normalized FeedItems into a compact string for the AI prompt
export function feedToPromptText(items) {
  if (!items.length) return 'No feed items available.';

  const byPlatform = {};
  for (const item of items) {
    if (!byPlatform[item.platform]) byPlatform[item.platform] = [];
    byPlatform[item.platform].push(item);
  }

  const lines = [];

  for (const [platform, platformItems] of Object.entries(byPlatform)) {
    lines.push(`\n=== ${platform.toUpperCase()} ===`);
    for (const item of platformItems.slice(0, 20)) {
      const parts = [];
      if (item.title)  parts.push(`TITLE: ${item.title}`);
      if (item.body)   parts.push(`BODY: ${item.body.slice(0, 300)}`);
      if (item.author) parts.push(`AUTHOR: ${item.author}`);
      parts.push(`SOURCE: ${item.source}`);
      parts.push(`ENGAGEMENT: score=${item.score} comments=${item.comment_count} views=${item.view_count}`);
      parts.push(`URL: ${item.url}`);
      lines.push('\n---\n' + parts.join('\n'));
    }
  }

  return lines.join('\n');
}
