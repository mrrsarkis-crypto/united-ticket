// Cloudflare Pages Functions middleware (runs on every request to /api/*)
const ADSENSE_DOMAINS = [
  'https://pagead2.googlesyndication.com',
  'https://tpc.googlesyndication.com',
  'https://googleads.g.doubleclick.net',
  'https://adservice.google.com',
  'https://partner.googleadservices.com',
  'https://www.googletagservices.com',
  'https://stats.g.doubleclick.net',
  'https://ad.doubleclick.net',
  'https://fundingchoicesmessages.google.com',
];

export async function onRequest(context) {
  const response = await context.next();

  // Security headers
  const newHeaders = new Headers(response.headers);
  newHeaders.set('X-Content-Type-Options', 'nosniff');
  newHeaders.set('X-Frame-Options', 'DENY');
  newHeaders.set('Referrer-Policy', 'no-referrer');
  if (newHeaders.get('content-type') && newHeaders.get('content-type').includes('text/html')) {
    // Strict-ish CSP but broad enough for AdSense. Google does not guarantee a
    // restrictive per-domain allowlist stays working (ad domains rotate), so we
    // allow-list the full known ad-serving surface rather than a narrow subset.
    const csp = [
      "default-src 'self'",
      "object-src 'none'",
      "base-uri 'self'",
      `script-src 'self' https://cdnjs.cloudflare.com ${ADSENSE_DOMAINS.join(' ')} 'unsafe-inline' 'unsafe-eval'`,
      `img-src 'self' data: ${ADSENSE_DOMAINS.join(' ')}`,
      "style-src 'self' 'unsafe-inline'",
      `connect-src 'self' https://api.stripe.com ${ADSENSE_DOMAINS.join(' ')}`,
      `frame-src https://googleads.g.doubleclick.net https://tpc.googlesyndication.com https://pagead2.googlesyndication.com https://s0.2mdn.net https://securepubads.g.doubleclick.net`,
    ];
    newHeaders.set('Content-Security-Policy', csp.join('; '));
    // AdSense Privacy Sandbox / auction APIs.
    newHeaders.set(
      'Permissions-Policy',
      'attribution-reporting=(self), run-ad-auction=(self), join-ad-interest-group=(self), join-ads-conversion-measurement=(self)'
    );
  }
  newHeaders.set('Access-Control-Allow-Origin', '*');
  newHeaders.set('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  newHeaders.set('Access-Control-Allow-Headers', 'Content-Type,Authorization');

  if (context.request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: newHeaders });
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: newHeaders
  });
}
