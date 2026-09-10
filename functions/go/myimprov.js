// GET /go/myimprov?c=<placement> — referral click tracker for myimprov.com.
//
// Logs the click (placement, referrer page, device type, anonymized visitor
// hash) to KV under `clk:YYYY-MM-DD:<clickId>`, then 302-redirects to
// myimprov.com with the partner UTM params plus a per-click `ref` tag so a
// later partner conversion report can be correlated back to this click.
import { rand } from '../api/_shared.js';

const TARGETS = {
  topbar: 'utm_content=topbar',
  hero_cta: 'utm_content=hero_cta',
  cta_bottom: 'utm_content=cta_bottom',
};

const BASE = 'https://myimprov.com/?utm_source=partner&utm_medium=referral&utm_campaign=uttd_myimprov';

async function sha256(text) {
  const mac = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  let hex = '';
  for (const b of new Uint8Array(mac)) hex += b.toString(16).padStart(2, '0');
  return hex;
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);

  const content = (url.searchParams.get('c') || '').trim();
  const known = TARGETS[content] ? content : 'generic';
  const contentParam = TARGETS[content] || 'utm_content=' + known;

  const clickId = Date.now().toString(36) + '-' + rand(6);
  const now = new Date();
  const day = now.toISOString().slice(0, 10);

  // Referrer: only meaningful when the click came from one of our own pages.
  const referer = request.headers.get('referer') || '';
  let referrerPage = '';
  try {
    if (referer && new URL(referer).hostname === url.hostname) {
      referrerPage = new URL(referer).pathname || '/';
    }
  } catch (e) { /* ignore malformed referer */ }

  const ua = request.headers.get('user-agent') || '';
  const isBot = /bot|crawler|spider|curl|wget|headless|preview/i.test(ua);
  const device = isBot ? 'bot' : /mobile|android|iphone|ipad|ipod/i.test(ua) ? 'mobile' : 'desktop';

  // Anonymized visitor fingerprint (day-scoped) so we can count unique clicks
  // without ever storing a raw IP or a full UA.
  const fpInput = (request.headers.get('cf-connecting-ip') || '') + '|' + ua + '|' + day;
  const visitorHash = await sha256(fpInput + '|uttd-referral').catch(() => '');

  const record = {
    click_id: clickId,
    ts: now.toISOString(),
    day,
    c: known,
    device,
    visitor_hash: visitorHash,
    ...(referrerPage ? { ref_page: referrerPage } : {}),
  };

  const redirectUrl = BASE + '&' + contentParam + '&ref=UTTD-' + clickId;

  // Fire-and-hold the KV write so the redirect stays instant; a slow/failed
  // write must never block the visitor leaving for the partner site.
  context.waitUntil(env.CASES.put('clk:' + day + ':' + clickId, JSON.stringify(record)).catch(() => {}));

  return new Response(null, {
    status: 302,
    headers: {
      Location: redirectUrl,
      'Cache-Control': 'no-store, no-cache, must-revalidate',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
    },
  });
}