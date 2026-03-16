export const config = { runtime: 'nodejs' };

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    let body = req.body;
    if (typeof body === 'string') { try { body = JSON.parse(body); } catch { } }

    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
        'HTTP-Referer': 'https://fgc-scout-backen.vercel.app',
        'X-Title': 'FGC Content Scout',
      },
      body: JSON.stringify({
        model: 'meta-llama/llama-3.3-70b-instruct:free',
        messages: body.messages,
      }),
    });

    const raw = await response.text();
    console.log('[scout] OpenRouter raw response:', raw);

    let data;
    try { data = JSON.parse(raw); } catch {
      return res.status(500).json({ error: 'OpenRouter returned invalid JSON', raw });
    }

    if (data.error) {
      return res.status(500).json({ error: data.error.message || 'OpenRouter error', detail: data });
    }

    const text = data.choices?.[0]?.message?.content || '';

    if (!text) {
      return res.status(500).json({ error: 'Empty response from OpenRouter', detail: data });
    }

    return res.status(200).json({
      content: [{ type: 'text', text }]
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}