const GAS_URL = process.env.GAS_URL;

function parseResponse(text) {
  // Try plain JSON first
  try {
    return JSON.parse(text);
  } catch {}

  // Strip JSONP wrapper: callback({...}) → {...}
  const match = text.match(/^[a-zA-Z_]\w*\(([\s\S]+)\)$/);
  if (match) {
    try {
      return JSON.parse(match[1]);
    } catch {}
  }

  return null;
}

export default async function handler(req, res) {
  if (!GAS_URL) {
    return res.status(500).json({ error: 'GAS_URL not configured' });
  }

  try {
    let gasResponse;

    if (req.method === 'GET') {
      const params = new URLSearchParams(req.query).toString();
      const url = GAS_URL + (params ? '?' + params : '');
      gasResponse = await fetch(url, { redirect: 'follow' });
    } else if (req.method === 'POST') {
      gasResponse = await fetch(GAS_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: typeof req.body === 'string' ? req.body : JSON.stringify(req.body),
        redirect: 'follow',
      });
    } else {
      return res.status(405).json({ error: 'Method not allowed' });
    }

    const text = await gasResponse.text();
    const data = parseResponse(text);

    if (data) {
      return res.status(200).json(data);
    }

    console.error('GAS unparseable response:', text.substring(0, 500));
    return res.status(502).json({ error: 'Invalid response from backend' });
  } catch (error) {
    console.error('GAS proxy error:', error.message || error);
    return res.status(502).json({ error: 'Failed to reach backend', detail: error.message });
  }
}
