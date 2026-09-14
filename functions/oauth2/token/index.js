// POST /oauth2/token
// OAuth 2.1 client_credentials grant. An authenticated agent (client_id +
// client_secret) exchanges its credentials for a short-lived HS256 access
// token. Client credentials may be supplied either in the legacy form-body
// (client_id, client_secret) or via HTTP Basic auth. Only the intersection of
// the client's allowed scopes and the requested scope is granted.
//
// On success: 200 {"access_token","token_type":"Bearer","expires_in","scope"}
// On failure: RFC 6749-style 4xx JSON error.
import { json } from '../../api/_shared.js';
import { verifyClientSecret, signAccessToken, resolveScope, parseFormOrJson } from '../../api/_auth.js';

function oauthError(status, error, description) {
  return json(
    { error, error_description: description, 'Cache-Control': 'no-store' },
    status,
    { 'Cache-Control': 'no-store', 'WWW-Authenticate': 'Bearer realm="oauth"' }
  );
}

function basicCredentials(request) {
  const auth = request.headers.get('authorization') || '';
  if (!/^Basic\s+/i.test(auth)) return null;
  try {
    const decoded = atob(auth.replace(/^Basic\s+/i, '').trim());
    const idx = decoded.indexOf(':');
    if (idx < 0) return null;
    return { clientId: decoded.slice(0, idx), clientSecret: decoded.slice(idx + 1) };
  } catch (e) {
    return null;
  }
}

export async function onRequestPost(context) {
  const { request, env } = context;

  const body = await parseFormOrJson(request);
  if (!body || body.grant_type !== 'client_credentials') {
    return oauthError(400, 'unsupported_grant_type', 'Only grant_type=client_credentials is supported.');
  }

  let clientId = typeof body.client_id === 'string' ? body.client_id : '';
  let clientSecret = typeof body.client_secret === 'string' ? body.client_secret : '';
  if (!clientId || !clientSecret) {
    const basic = basicCredentials(request);
    if (basic) {
      clientId = basic.clientId;
      clientSecret = basic.clientSecret;
    }
  }

  if (!clientId || !clientSecret) {
    return oauthError(400, 'invalid_request', 'client_id and client_secret are required (or use HTTP Basic auth).');
  }

  const rec = await verifyClientSecret(env, clientId, clientSecret);
  if (!rec) {
    return oauthError(401, 'invalid_client', 'Unknown client or incorrect client_secret.');
  }

  let scope;
  try {
    scope = resolveScope(rec.scopes, body.scope);
  } catch (e) {
    return oauthError(400, 'invalid_scope', 'The requested scope is not permitted for this client.');
  }

  let issued;
  try {
    issued = await signAccessToken(env, { sub: rec.id || clientId, scope, client_name: rec.name || '' });
  } catch (e) {
    console.error('token issuance failed', e);
    return oauthError(500, 'server_error', 'Token issuance is temporarily unavailable.');
  }

  return json(
    {
      access_token: issued.token,
      token_type: 'Bearer',
      expires_in: issued.expiresIn,
      scope: issued.payload.scope,
    },
    200,
    { 'Cache-Control': 'no-store', 'Pragma': 'no-cache' }
  );
}

export async function onRequestGet() {
  return json({ error: 'method_not_allowed', error_description: 'Use POST with grant_type=client_credentials.' }, 405, {
    'Allow': 'POST',
  });
}

export async function onRequestOptions() {
  return new Response(null, { status: 204 });
}