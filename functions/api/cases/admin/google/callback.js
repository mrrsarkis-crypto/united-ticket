import { exchangeGoogleCode, googleRedirectUri, verifyGoogleState } from '../../../_google-oauth.js';

export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const state = await verifyGoogleState(env, url.searchParams.get('state') || '');
  if (!state) return page('Authorization failed', 'The Google authorization link is invalid or expired. Start the connection again from the admin area.', 400);

  const error = url.searchParams.get('error');
  if (error) return page('Authorization cancelled', 'Google returned: ' + escapeHtml(error) + '.', 400);

  const code = url.searchParams.get('code') || '';
  if (!code) return page('Authorization failed', 'Google did not return an authorization code.', 400);
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) {
    return page('Configuration required', 'Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to the runtime environment first.', 503);
  }

  try {
    const token = await exchangeGoogleCode(env, request, code);
    const refreshToken = token.refresh_token;
    return page('Google Calendar connected', [
      '<p>Authorization succeeded. For security, the refresh token is shown once so you can store it as a Cloudflare secret.</p>',
      '<p><strong>GOOGLE_REFRESH_TOKEN</strong></p>',
      '<textarea readonly onclick="this.select()">' + escapeHtml(refreshToken) + '</textarea>',
      '<p>Then redeploy or update the environment variable. Do not commit this token to GitHub.</p>',
      '<p><strong>Redirect URI</strong><br><code>' + escapeHtml(googleRedirectUri(request, env)) + '</code></p>',
    ].join(''), 200);
  } catch (e) {
    console.error('Google OAuth callback failed', e);
    return page('Google authorization failed', escapeHtml(String(e && e.message || e)), 502);
  }
}

function page(title, body, status) {
  return new Response('<!doctype html><html><head><meta charset="utf-8"><title>' + escapeHtml(title) + '</title><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{font-family:system-ui,sans-serif;max-width:720px;margin:60px auto;padding:0 20px;line-height:1.6}textarea{width:100%;min-height:120px;font-family:ui-monospace,monospace;padding:12px;box-sizing:border-box}code{word-break:break-all}</style></head><body><h1>' + escapeHtml(title) + '</h1>' + body + '</body></html>', {
    status,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store, private' },
  });
}

function escapeHtml(value) {
  return String(value || '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}
