const GOOGLE_SCOPE = 'https://www.googleapis.com/auth/calendar.events';

export function googleRedirectUri(request, env) {
  return env.GOOGLE_REDIRECT_URI || (new URL('/api/cases/admin/google/callback', request.url)).toString();
}

export async function createGoogleState(env, payload) {
  const secret = String(env.ADMIN_CODE || '').trim();
  if (!secret) throw new Error('ADMIN_CODE is required for Google authorization');
  const body = btoa(unescape(encodeURIComponent(JSON.stringify({ ...payload, exp: Date.now() + 10 * 60 * 1000 }))));
  const sig = await hmac(secret, body);
  return body + '.' + sig;
}

export async function verifyGoogleState(env, state) {
  const secret = String(env.ADMIN_CODE || '').trim();
  if (!secret || !state || !state.includes('.')) return null;
  const parts = String(state).split('.');
  if (parts.length !== 2) return null;
  const expected = await hmac(secret, parts[0]);
  if (!(await timingSafeEqual(expected, parts[1]))) return null;
  try {
    const decoded = decodeURIComponent(escape(atob(parts[0])));
    const payload = JSON.parse(decoded);
    if (!payload.exp || Number(payload.exp) < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

export function googleAuthUrl(env, request, state) {
  const params = new URLSearchParams({
    client_id: String(env.GOOGLE_CLIENT_ID || ''),
    redirect_uri: googleRedirectUri(request, env),
    response_type: 'code',
    scope: GOOGLE_SCOPE,
    access_type: 'offline',
    prompt: 'consent',
    state,
  });
  return 'https://accounts.google.com/o/oauth2/v2/auth?' + params.toString();
}

export async function exchangeGoogleCode(env, request, code) {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: String(env.GOOGLE_CLIENT_ID || ''),
      client_secret: String(env.GOOGLE_CLIENT_SECRET || ''),
      redirect_uri: googleRedirectUri(request, env),
      grant_type: 'authorization_code',
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.refresh_token) {
    throw new Error('Google authorization exchange failed: ' + (data.error_description || data.error || 'no refresh token returned'));
  }
  return data;
}

async function hmac(secret, value) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value));
  const bytes = new Uint8Array(sig);
  let out = '';
  for (const byte of bytes) out += byte.toString(16).padStart(2, '0');
  return out;
}

async function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
