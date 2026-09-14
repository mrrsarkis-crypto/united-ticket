import { onRequestPost } from '../../functions/api/assistant/extract.js';

export const config = {
  maxDuration: 60,
};

function absoluteUrl(req) {
  const proto = req.headers['x-forwarded-proto'] || 'https';
  const host = req.headers.host || 'localhost';
  return proto + '://' + host + req.url;
}

async function toWebRequest(req) {
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers || {})) {
    if (Array.isArray(value)) headers.set(key, value.join(', '));
    else if (value != null) headers.set(key, String(value));
  }

  let body;
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    if (Buffer.isBuffer(req.body)) body = req.body;
    else if (typeof req.body === 'string') body = req.body;
    else if (req.body != null) body = JSON.stringify(req.body);
  }

  return new Request(absoluteUrl(req), {
    method: req.method,
    headers,
    body,
  });
}

async function sendWebResponse(res, response) {
  response.headers.forEach((value, key) => res.setHeader(key, value));
  res.statusCode = response.status;
  const bytes = Buffer.from(await response.arrayBuffer());
  res.end(bytes);
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.setHeader('Allow', 'POST, OPTIONS');
    return res.end();
  }
  if (req.method !== 'POST') {
    res.statusCode = 405;
    res.setHeader('Allow', 'POST, OPTIONS');
    return res.end(JSON.stringify({ error: 'Method not allowed' }));
  }

  const request = await toWebRequest(req);
  const response = await onRequestPost({ request, env: process.env });
  return sendWebResponse(res, response);
}
