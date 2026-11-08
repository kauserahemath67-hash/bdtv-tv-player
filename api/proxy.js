const url = require('url');
const db = require('./_db');

/**
 * Rewrites an HLS manifest so that all relative and absolute URIs
 * are routed back through this proxy endpoint with channel id.
 */
function rewritePlaylist(manifestText, baseUrl, channelId) {
  function makeProxyUrl(rawUri) {
    if (!rawUri) return rawUri;
    try {
      const resolved = new URL(rawUri, baseUrl).href;
      return `/api/proxy?ch=${encodeURIComponent(channelId)}&u=${encodeURIComponent(resolved)}`;
    } catch (e) {
      return rawUri;
    }
  }

  const lines = manifestText.split(/\r?\n/);
  const rewrittenLines = lines.map((line) => {
    const trimmed = line.trim();
    if (!trimmed) return line;

    // Line is an HLS tag
    if (trimmed.startsWith('#')) {
      // Check for URI="..." attribute inside tags (EXT-X-KEY, EXT-X-MAP, EXT-X-MEDIA, etc.)
      if (trimmed.includes('URI=')) {
        return line.replace(/URI="([^"]+)"/g, (match, uri) => {
          return `URI="${makeProxyUrl(uri)}"`;
        }).replace(/URI=([^",\s]+)/g, (match, uri) => {
          return `URI="${makeProxyUrl(uri)}"`;
        });
      }
      return line;
    }

    // Line is a URI (variant stream or segment)
    return makeProxyUrl(trimmed);
  });

  return rewrittenLines.join('\n');
}

/**
 * Fetch helper following HTTP redirects up to maxRedirects while preserving headers
 */
async function fetchWithRedirects(targetUrl, headers, maxRedirects = 5) {
  let currentUrl = targetUrl;
  let redirects = 0;

  while (redirects <= maxRedirects) {
    const res = await fetch(currentUrl, {
      method: 'GET',
      headers,
      redirect: 'manual',
      signal: AbortSignal.timeout(15000)
    });

    if ([301, 302, 303, 307, 308].includes(res.status)) {
      const location = res.headers.get('location');
      if (!location) {
        return { res, finalUrl: currentUrl };
      }
      currentUrl = new URL(location, currentUrl).href;
      redirects++;
      continue;
    }

    return { res, finalUrl: currentUrl };
  }

  throw new Error('Too many redirects');
}

module.exports = async (req, res) => {
  // Ensure helper methods on response object if not already present
  if (typeof res.status !== 'function') {
    res.status = function(code) { this.statusCode = code; return this; };
  }
  if (typeof res.send !== 'function') {
    res.send = function(content) { this.end(content); };
  }

  // CORS & Methods
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Range');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return res.status(405).send('Method Not Allowed');
  }

  // Parse query params (works for Express / Vercel Serverless and pure Node server.js)
  const parsedQuery = (req.query && Object.keys(req.query).length > 0)
    ? req.query
    : (url.parse(req.url, true).query || {});

  const channelId = parsedQuery.ch;
  if (!channelId) {
    return res.status(404).send('Channel not specified');
  }

  // 1. Channel lookup (strictly from own database, never open proxy)
  let channel = null;
  try {
    const channels = await db.getChannels();
    channel = channels.find(c => c.id === channelId || (c.name && c.name.toLowerCase().replace(/\s+/g, '-') === channelId.toLowerCase()));
  } catch (err) {
    return res.status(502).send('Bad Gateway: Database lookup failed');
  }

  if (!channel) {
    return res.status(404).send('Channel not found');
  }

  // 2. Determine target URL
  let targetUrl = channel.url;
  if (parsedQuery.u) {
    const rawTarget = String(parsedQuery.u).trim();
    if (!rawTarget.startsWith('http://') && !rawTarget.startsWith('https://')) {
      return res.status(400).send('Invalid target URL');
    }
    targetUrl = rawTarget;
  }

  // Guard against self-recursion or invalid protocols
  if (!targetUrl.startsWith('http://') && !targetUrl.startsWith('https://')) {
    return res.status(400).send('Invalid target stream URL');
  }

  // 3. Prepare upstream headers
  const upstreamHeaders = {};
  if (channel.proxy_referer) {
    upstreamHeaders['Referer'] = channel.proxy_referer;
  }
  if (channel.proxy_user_agent) {
    upstreamHeaders['User-Agent'] = channel.proxy_user_agent;
  } else {
    upstreamHeaders['User-Agent'] = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
  }

  // Pass through HTTP Range header if requested
  if (req.headers && req.headers['range']) {
    upstreamHeaders['Range'] = req.headers['range'];
  }

  // 4. Fetch upstream with redirects and 15s timeout
  let upstreamRes;
  let finalUrl;
  try {
    const fetched = await fetchWithRedirects(targetUrl, upstreamHeaders, 5);
    upstreamRes = fetched.res;
    finalUrl = fetched.finalUrl;
  } catch (err) {
    return res.status(502).send('Bad Gateway: Upstream fetch failed');
  }

  if (!upstreamRes) {
    return res.status(502).send('Bad Gateway: Upstream response missing');
  }

  try {
    const rawContentType = (upstreamRes.headers.get('content-type') || '').toLowerCase();
    const isMpegUrl = rawContentType.includes('mpegurl') || rawContentType.includes('x-mpegurl');

    // Read response body as buffer
    const arrayBuf = await upstreamRes.arrayBuffer();
    const buffer = Buffer.from(arrayBuf);

    // Check if body starts with #EXTM3U
    const head = buffer.slice(0, 32).toString('utf8').trimStart();
    const isPlaylist = isMpegUrl || head.startsWith('#EXTM3U');

    if (isPlaylist) {
      const playlistText = buffer.toString('utf8');
      const rewritten = rewritePlaylist(playlistText, finalUrl, channel.id);

      res.setHeader('Content-Type', 'application/vnd.apple.mpegurl; charset=utf-8');
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      return res.status(upstreamRes.status === 200 ? 200 : upstreamRes.status).send(rewritten);
    }

    // Binary segment / Key / Other media
    res.status(upstreamRes.status);
    if (upstreamRes.headers.get('content-type')) {
      res.setHeader('Content-Type', upstreamRes.headers.get('content-type'));
    }
    if (upstreamRes.headers.get('content-range')) {
      res.setHeader('Content-Range', upstreamRes.headers.get('content-range'));
    }
    if (upstreamRes.headers.get('accept-ranges')) {
      res.setHeader('Accept-Ranges', upstreamRes.headers.get('accept-ranges'));
    }
    res.setHeader('Content-Length', buffer.length);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 'public, max-age=60');
    return res.end(buffer);
  } catch (err) {
    return res.status(502).send('Bad Gateway: Stream processing error');
  }
};
