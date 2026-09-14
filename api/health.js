import { getVercelOidcToken } from '@vercel/oidc';
import { onRequestGet } from '../functions/api/health.js';

async function runtimeEnv() {
  try {
    const token = await getVercelOidcToken();
    if (token) return { ...process.env, VERCEL_OIDC_TOKEN: token };
  } catch (error) {
    console.warn('vercel health OIDC token unavailable', String(error && error.message || error || '').slice(0, 160));
  }
  return process.env;
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.statusCode = 405;
    res.setHeader('Allow', 'GET');
    return res.end(JSON.stringify({ error: 'Method not allowed' }));
  }

  const env = await runtimeEnv();
  const response = await onRequestGet({ env });
  response.headers.forEach((value, key) => res.setHeader(key, value));
  res.statusCode = response.status;
  res.end(Buffer.from(await response.arrayBuffer()));
}
