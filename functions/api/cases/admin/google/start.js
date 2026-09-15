import { json, unauthorizedIfNotAdmin } from '../../../_shared.js';
import { createGoogleState, googleAuthUrl, googleRedirectUri } from '../../../_google-oauth.js';

export async function onRequestGet(context) {
  const { request, env } = context;
  const denied = unauthorizedIfNotAdmin(request, env);
  if (denied) return denied;
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) {
    return json({ error: 'Google OAuth is not configured. Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET first.' }, 503);
  }
  const state = await createGoogleState(env, { path: '/api/cases/admin/google/callback' });
  return Response.redirect(googleAuthUrl(env, request, state), 302);
}
