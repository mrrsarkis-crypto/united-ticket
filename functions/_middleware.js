// Cloudflare Pages Functions middleware

const ADSENSE_ACCOUNT = 'ca-pub-9943048295609395';
const ADSENSE_SCRIPT = '<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=' + ADSENSE_ACCOUNT + '" crossorigin="anonymous"></script>';
const ADSENSE_META = '<meta name="google-adsense-account" content="' + ADSENSE_ACCOUNT + '">';
const SCANNER_CLIENT_SCRIPT = '<script src="/scanner-client.js"></script>';

function isMonetizedPath(pathname) {
  const path = (pathname || '/').replace(/\/+$/, '') || '/';
  return (
    path === '/resources' || path === '/resources.html' ||
    /^\/resources\/[^/]+(?:\.html)?$/.test(path) ||
    path === '/faq' || path === '/faq.html' ||
    path === '/courthouses' || path === '/courthouses.html' ||
    path === '/all-courthouses' || path === '/all-courthouses.html' ||
    /^\/courthouses\/[^/]+(?:\.html)?$/.test(path)
  );
}

export async function onRequest(context) {
  const response = await context.next();
  const newHeaders = new Headers(response.headers);
  const url = new URL(context.request.url);
  const isAmp = url.pathname.startsWith('/amp/') || url.pathname === '/amp';
  const isHtml = !isAmp && (newHeaders.get('content-type') || '').includes('text/html');
  const monetized = isHtml && isMonetizedPath(url.pathname);
  const isPrivateAdminApi = /^\/api\/cases\/admin(?:\.|$|\/)/.test(url.pathname);

  newHeaders.set('X-Content-Type-Options', 'nosniff');
  newHeaders.set('X-Frame-Options', 'DENY');
  newHeaders.set('Referrer-Policy', 'no-referrer');

  if (isHtml) {
    // Keep conversion and case-workflow pages tightly locked down. AdSense pages
    // get an HTTPS-only policy compatible with Google's current CSP guidance.
    const csp = monetized ? [
      "default-src 'self' https: data:",
      "object-src 'none'",
      "base-uri 'self'",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval' https: http:",
      "img-src 'self' data: https:",
      "style-src 'self' 'unsafe-inline' https:",
      "connect-src 'self' https:",
      "frame-src 'self' https:"
    ] : [
      "default-src 'self'",
      "object-src 'none'",
      "base-uri 'self'",
      "script-src 'self' https://cdnjs.cloudflare.com 'unsafe-inline'",
      "img-src 'self' data:",
      "style-src 'self' 'unsafe-inline'",
      "connect-src 'self' https://api.stripe.com",
      "frame-src 'self' https://checkout.stripe.com https://js.stripe.com"
    ];
    newHeaders.set('Content-Security-Policy', csp.join('; '));
    newHeaders.set(
      'Permissions-Policy',
      monetized
        ? 'geolocation=(), microphone=(), camera=()'
        : 'attribution-reporting=(), run-ad-auction=(), join-ad-interest-group=(), join-ads-conversion-measurement=()'
    );
  }

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

  let output = new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: newHeaders
  });

  if (isHtml) {
    output = new HTMLRewriter().on('head', {
      element(element) {
        // Load the scanner request optimizer before body scripts. It compresses
        // oversized phone photos, converts supported HEIC uploads, and bounds
        // request time without changing the visible page structure.
        element.append(SCANNER_CLIENT_SCRIPT, { html: true });
        // Site ownership signal on every normal HTML page. This does not itself
        // enable ads on protected customer-workflow pages.
        element.append(ADSENSE_META, { html: true });
        if (monetized) element.append(ADSENSE_SCRIPT, { html: true });
      }
    }).transform(output);
  }

  return output;
}
