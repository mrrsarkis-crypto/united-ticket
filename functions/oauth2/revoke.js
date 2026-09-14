// POST /oauth2/revoke
// RFC 7009 token revocation. Marks a previously issued access token as revoked
// in KV ("agent:revoked:<jti>") for the remainder of its natural lifetime.
// Returns 200 regardless of whether the token was recognized (RFC 7009 §2.2
// requires the server not tell the caller whether a token was valid).
import { json } from '../api/_shared.js';
import { verifyAccessToken, isRevoked, parseFormOrJson, bearerToken } from '../api/_auth.js';

export async function onRequestPost(context) {
  const { request, env } = context;

  const body = await parseFormOrJson(request);
  let token = body && typeof body.token === 'string' ? body.token : '';
  if (!token) token = bearerToken(request);

  if (token && env.CASES) {
    try {
      const payload = await verifyAccessToken(env, token);
      if (payload && payload.jti && payload.exp) {
        const now = Math.floor(Date.now() / 1000);
        const ttl = Math.max(1, payload.exp - now);
        if (!(await isRevoked(env, payload.jti))) {
          await env.CASES.put('agent:revoked:' + payload.jti, '1', { expirationTtl: ttl });
        }
      }
    } catch (e) {
      console.error('revocation failed', e);
    }
  }

  return json({}, 200, { 'Cache-Control': 'no-store' });
}

export async function onRequestOptions() {
  return new Response(null, { status: 204 });
}