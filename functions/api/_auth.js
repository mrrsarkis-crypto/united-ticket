// Shared helpers for OAuth 2.1 agent authentication (client_credentials grant).
// - Access tokens are signed HS256 JWTs (AGENT_AUTH_SECRET) with a short TTL.
// - Agent clients are registered as JSON records in the CASES KV namespace
//   under the key "agent:client:<clientId>" (only a salted secret hash is
//   stored, never the raw secret).
// - Revoked tokens are recorded under "agent:revoked:<jti>" with a TTL equal
//   to the remaining token life.
import { json } from './_shared.js';

export const AUTH_ISSUER = 'united-traffic-tickets-defense';
export const DEFAULT_TOKEN_TTL = 3600;

const enc = new TextEncoder();
const dec = new TextDecoder();

export function b64url(bytes) {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

export function b64urlToBytes(str) {
  let s = String(str).replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  const bin = atob(s);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

async function sha256B64(text) {
  const digest = await crypto.subtle.digest('SHA-256', enc.encode(text));
  return b64url(new Uint8Array(digest));
}

export async function hmacSha256(secret, text) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(text));
  return b64url(new Uint8Array(sig));
}

function constantTimeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function randomId() {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return b64url(bytes);
}

// Client > scope access control. The granted scope is the intersection of the
// client's allowed scopes and the requested scope (default: all allowed).
export function resolveScope(allowed, requested) {
  const base = Array.isArray(allowed) && allowed.length ? allowed : ['agent'];
  if (!requested) return base.join(' ');
  const want = String(requested).trim().split(/\s+/).filter(Boolean);
  const ok = base.filter((s) => want.includes(s));
  return (ok.length ? ok : base).join(' ');
}

export async function clientSecretHash(clientId, secret) {
  return sha256B64(String(clientId) + ':' + String(secret));
}

// Loads and verifies a client's credentials. Returns the client record
// (JSON from KV) when valid, otherwise null.
export async function verifyClientSecret(env, clientId, clientSecret) {
  if (!env.CASES || !clientId || !clientSecret) return null;
  let rec;
  try {
    rec = await env.CASES.get('agent:client:' + String(clientId), 'json');
  } catch (e) {
    console.error('KV read failed', e);
    return null;
  }
  if (!rec || typeof rec !== 'object') return null;
  const found = await clientSecretHash(clientId, clientSecret);
  if (!rec.secretHash || !constantTimeEqual(rec.secretHash, found)) return null;
  if (rec.disabled === true) return null;
  return rec;
}

// Signs a client_credentials access token. Returns { token, payload, expiresIn }.
export async function signAccessToken(env, claims) {
  const secret = env.AGENT_AUTH_SECRET;
  if (!secret) throw new Error('AGENT_AUTH_SECRET is not configured');
  const now = Math.floor(Date.now() / 1000);
  const ttl = Number(env.AGENT_TOKEN_TTL) > 0 ? Number(env.AGENT_TOKEN_TTL) : DEFAULT_TOKEN_TTL;
  const header = { alg: 'HS256', typ: 'JWT' };
  const payload = {
    iss: AUTH_ISSUER,
    iat: now,
    exp: now + ttl,
    jti: randomId(),
    ...claims,
  };
  const h = b64url(enc.encode(JSON.stringify(header)));
  const p = b64url(enc.encode(JSON.stringify(payload)));
  const sig = await hmacSha256(secret, h + '.' + p);
  return { token: h + '.' + p + '.' + sig, payload, expiresIn: ttl };
}

// Verifies a JWT and returns its payload, or null when invalid/expired.
export async function verifyAccessToken(env, token) {
  if (!token || !env.AGENT_AUTH_SECRET) return null;
  const parts = String(token).split('.');
  if (parts.length !== 3) return null;
  const expected = await hmacSha256(env.AGENT_AUTH_SECRET, parts[0] + '.' + parts[1]);
  if (!constantTimeEqual(expected, parts[2])) return null;
  let payload;
  try {
    payload = JSON.parse(dec.decode(b64urlToBytes(parts[1])));
  } catch (e) {
    return null;
  }
  if (typeof payload !== 'object' || payload === null) return null;
  const now = Math.floor(Date.now() / 1000);
  if (typeof payload.exp !== 'number' || payload.exp <= now) return null;
  if (typeof payload.iat !== 'number' || payload.iat > now + 600) return null;
  return payload;
}

export async function isRevoked(env, jti) {
  if (!env.CASES || !jti) return false;
  try {
    return !!(await env.CASES.get('agent:revoked:' + String(jti)));
  } catch (e) {
    console.error('KV revoke check failed', e);
    return false;
  }
}

export function bearerToken(request) {
  return (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
}

// Reads a form-urlencoded or JSON body into a plain object, or null.
export async function parseFormOrJson(request) {
  const ct = request.headers.get('content-type') || '';
  if (ct.includes('application/x-www-form-urlencoded')) {
    try {
      const params = new URLSearchParams(await request.text());
      const out = {};
      for (const [k, v] of params.entries()) out[k] = v;
      return out;
    } catch (e) {
      return null;
    }
  }
  if (ct.includes('application/json')) {
    try {
      const body = await request.json();
      return typeof body === 'object' && body !== null ? body : null;
    } catch (e) {
      return null;
    }
  }
  return null;
}

export function loadAgentClient(rec) {
  if (!rec || typeof rec !== 'object') return null;
  return {
    client_id: rec.id || '',
    name: rec.name || rec.id || '',
    scopes: resolveScope(rec.scopes, null),
    roles: Array.isArray(rec.roles) ? rec.roles : [],
  };
}

export function invalidToken() {
  return json({ error: 'invalid_token', error_description: 'The access token is invalid, expired, or revoked.' }, 401, {
    'WWW-Authenticate': 'Bearer error="invalid_token"',
    'Cache-Control': 'no-store',
  });
}