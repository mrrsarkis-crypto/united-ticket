import { onRequestGet } from '../functions/api/health.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.statusCode = 405;
    res.setHeader('Allow', 'GET');
    return res.end(JSON.stringify({ error: 'Method not allowed' }));
  }

  const response = await onRequestGet({ env: process.env });
  response.headers.forEach((value, key) => res.setHeader(key, value));
  res.statusCode = response.status;
  res.end(Buffer.from(await response.arrayBuffer()));
}
