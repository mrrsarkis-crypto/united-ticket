// Cloudflare Pages Functions middleware (runs on every request to /api/*)

export async function onRequest(context) {
  let response = await context.next();

  const newHeaders = new Headers(response.headers);
  newHeaders.set('X-Content-Type-Options', 'nosniff');
  newHeaders.set('X-Frame-Options', 'DENY');
  newHeaders.set('Referrer-Policy', 'no-referrer');
  const url = new URL(context.request.url);
  const isAmp = url.pathname.startsWith('/amp/') || url.pathname.startsWith('/amp');
  const isHtml = !isAmp && newHeaders.get('content-type') && newHeaders.get('content-type').includes('text/html');
  const isPrivateAdminApi = /^\/api\/cases\/admin(?:\.|$|\/)/.test(url.pathname);

  if (isHtml) {
    const csp = [
      "default-src 'self'",
      "object-src 'none'",
      "base-uri 'self'",
      `script-src 'self' https://cdnjs.cloudflare.com 'unsafe-inline'`,
      `img-src 'self' data:`,
      "style-src 'self' 'unsafe-inline'",
      `connect-src 'self' https://api.stripe.com`,
      `frame-src 'self' https://checkout.stripe.com https://js.stripe.com`,
    ];
    newHeaders.set('Content-Security-Policy', csp.join('; '));
    newHeaders.set(
      'Permissions-Policy',
      'attribution-reporting=(), run-ad-auction=(), join-ad-interest-group=(), join-ads-conversion-measurement=()'
    );
  }

  // Public APIs may be consumed cross-origin. The admin case API contains
  // sensitive customer data, so do not advertise it to arbitrary origins.
  if (!isPrivateAdminApi) {
    newHeaders.set('Access-Control-Allow-Origin', '*');
    newHeaders.set('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    newHeaders.set('Access-Control-Allow-Headers', 'Content-Type,Authorization');
  } else {
    newHeaders.delete('Access-Control-Allow-Origin');
    newHeaders.delete('Access-Control-Allow-Methods');
    newHeaders.delete('Access-Control-Allow-Headers');
  }

  if (context.request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: newHeaders });
  }

  let body = response.body;

  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers: newHeaders
  });
}
