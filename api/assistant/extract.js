import { createHash } from 'node:crypto';
import { getVercelOidcToken } from '@vercel/oidc';
import { onRequestPost } from '../../functions/api/assistant/extract.js';

export const config = {
  maxDuration: 60,
};

const DEFAULT_LOCAL_RATE_LIMIT = 30;
const localRateBuckets = new Map();

function absoluteUrl(req) {
  const proto = req.headers['x-forwarded-proto'] || 'https';
  const host = req.headers.host || 'localhost';
  return proto + '://' + host + req.url;
}

function clientIdentity(req) {
  const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return String(req.headers['x-real-ip'] || forwarded || '').trim();
}

function configuredLimit(env = process.env) {
  const configured = Number(env.SCANNER_RATE_LIMIT_PER_MINUTE || DEFAULT_LOCAL_RATE_LIMIT);
  return Number.isFinite(configured)
    ? Math.max(5, Math.min(120, Math.floor(configured)))
    : DEFAULT_LOCAL_RATE_LIMIT;
}

function enforceLocalRateLimit(req, env = process.env, now = Date.now()) {
  const identity = clientIdentity(req);
  const limit = configuredLimit(env);
  if (!identity) return { allowed: true, enforced: false, limit, remaining: limit, retryAfter: 0 };

  const bucket = Math.floor(now / 60000);
  const salt = String(env.SCANNER_RATE_LIMIT_SALT || 'utt-vercel-scanner-v1');
  const hash = createHash('sha256').update(identity + '|' + salt).digest('hex').slice(0, 24);
  const key = bucket + ':' + hash;
  const current = Math.max(0, Number(localRateBuckets.get(key) || 0));
  const retryAfter = Math.max(1, 60 - (Math.floor(now / 1000) % 60));

  if (current >= limit) {
    return { allowed: false, enforced: true, limit, remaining: 0, retryAfter };
  }

  localRateBuckets.set(key, current + 1);

  // Keep warm instances bounded. Old minute buckets are safe to discard.
  if (localRateBuckets.size > 2000) {
    for (const storedKey of localRateBuckets.keys()) {
      if (!storedKey.startsWith(String(bucket) + ':')) localRateBuckets.delete(storedKey);
    }
  }

  return {
    allowed: true,
    enforced: true,
    limit,
    remaining: Math.max(0, limit - current - 1),
    retryAfter,
  };
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

async function runtimeEnv() {
  try {
    const token = await getVercelOidcToken();
    if (token) return { ...process.env, VERCEL_OIDC_TOKEN: token };
  } catch (error) {
    // Do not log token material. The shared provider chain will fail closed with
    // a safe scanner-unavailable response if no other vision provider exists.
    console.warn('vercel scanner OIDC token unavailable', String(error && error.message || error || '').slice(0, 160));
  }
  return process.env;
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

  const rate = enforceLocalRateLimit(req);
  if (rate.enforced) {
    res.setHeader('X-Scanner-RateLimit-Limit', String(rate.limit));
    res.setHeader('X-Scanner-RateLimit-Remaining', String(rate.remaining));
  }
  if (!rate.allowed) {
    res.statusCode = 429;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store, private');
    res.setHeader('Retry-After', String(rate.retryAfter));
    return res.end(JSON.stringify({
      error: 'Too many scan requests were received from this connection. Please wait a moment and try again.',
      code: 'scanner_rate_limited'
    }));
  }

  const request = await toWebRequest(req);
  const env = await runtimeEnv();
  const response = await onRequestPost({ request, env });
  return sendWebResponse(res, response);
}

export const __vercelScannerTest = {
  clientIdentity,
  configuredLimit,
  enforceLocalRateLimit,
  reset() { localRateBuckets.clear(); },
};
