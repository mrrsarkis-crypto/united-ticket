// GET /agent/identity
// Verifies the bearer token and returns the calling agent's identity. Useful
// for an agent to confirm who it is after token issuance, and for downstream
// services to trust the caller.
import { json } from '../../api/_shared.js';
import { bearerToken, verifyAccessToken, isRevoked, invalidToken, loadAgentClient } from '../../api/_auth.js';

export async function onRequestGet(context) {
  const { request, env } = context;

  const token = bearerToken(request);
  const payload = await verifyAccessToken(env, token);
  if (!payload) return invalidToken();
  if (await isRevoked(env, payload.jti)) return invalidToken();

  let rec = null;
  if (env.CASES) {
    try {
      rec = await env.CASES.get('agent:client:' + payload.sub, 'json');
    } catch (e) {
      console.error('KV read failed', e);
    }
  }
  const id = loadAgentClient(rec);

  return json(
    {
      ok: true,
      client_id: payload.sub,
      name: (id && id.name) || payload.client_name || payload.sub,
      scope: payload.scope || '',
      roles: (id && id.roles) || [],
      expires_at: new Date(payload.exp * 1000).toISOString(),
      issued_at: new Date(payload.iat * 1000).toISOString(),
    },
    200,
    { 'Cache-Control': 'no-store' }
  );
}

export async function onRequestOptions() {
  return new Response(null, { status: 204 });
}