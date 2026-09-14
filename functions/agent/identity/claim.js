// POST /agent/identity/claim
// Returns the full JWT claims for a presented token without requiring the
// caller to parse JWTs themselves. Accepts the token in the Authorization
// header or in the JSON/body {token} field. Downstream automation can POST the
// raw token here to "claim" an identity and obtain verified claims.
import { json } from '../../api/_shared.js';
import { bearerToken, verifyAccessToken, isRevoked, invalidToken, parseFormOrJson } from '../../api/_auth.js';

export async function onRequestPost(context) {
  const { request, env } = context;

  let token = bearerToken(request);
  if (!token) {
    const body = await parseFormOrJson(request);
    token = body && typeof body.token === 'string' ? body.token : '';
  }

  const payload = await verifyAccessToken(env, token);
  if (!payload) return invalidToken();
  if (await isRevoked(env, payload.jti)) return invalidToken();

  return json(
    {
      ok: true,
      claims: {
        sub: payload.sub,
        scope: payload.scope || '',
        iss: payload.iss || '',
        iat: payload.iat || 0,
        exp: payload.exp || 0,
        jti: payload.jti || '',
      },
    },
    200,
    { 'Cache-Control': 'no-store' }
  );
}

export async function onRequestOptions() {
  return new Response(null, { status: 204 });
}