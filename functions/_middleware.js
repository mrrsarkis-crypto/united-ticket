// Cloudflare Pages Functions middleware

const SCANNER_CLIENT_SCRIPT = '<script src="/scanner-client.js"></script>';
const TRUST_BADGE_SCRIPT = '<script src="/trust-badge.js" defer></script>';

export async function onRequest(context) {
  const response = await context.next();
  const newHeaders = new Headers(response.headers);
  const url = new URL(context.request.url);
  const isAmp = url.pathname.startsWith('/amp/') || url.pathname === '/amp';
  const isHtml = (newHeaders.get('content-type') || '').includes('text/html');
  const isStandardHtml = isHtml && !isAmp;
  const isPrivateAdminApi = /^\/api\/cases\/admin(?:\.|$|\/)/.test(url.pathname);
  const isScannerApi = url.pathname === '/api/assistant/extract';

  newHeaders.set('X-Content-Type-Options', 'nosniff');
  newHeaders.set('X-Frame-Options', 'DENY');
  newHeaders.set('Referrer-Policy', 'no-referrer');

  if (isStandardHtml) {
    const csp = [
      "default-src 'self' https: data:",
      "object-src 'none'",
      "base-uri 'self'",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval' https:",
      "img-src 'self' data: https:",
      "style-src 'self' 'unsafe-inline' https:",
      "connect-src 'self' https:",
      "frame-src 'self' https:"
    ];
    newHeaders.set('Content-Security-Policy', csp.join('; '));
    newHeaders.set('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
  }

  // Public utility APIs can remain cross-origin. The scanner is deliberately
  // excluded because each call consumes paid vision capacity and processes a
  // user document; same-origin browser calls do not need CORS headers.
  if (!isPrivateAdminApi && !isScannerApi) {
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

  if (isStandardHtml) {
    output = new HTMLRewriter().on('head', {
      element(element) {
        // Load the scanner request optimizer before body scripts. It compresses
        // oversized phone photos, converts supported HEIC uploads, and bounds
        // request time without changing the visible page structure.
        element.append(SCANNER_CLIENT_SCRIPT, { html: true });
        element.append(TRUST_BADGE_SCRIPT, { html: true });
      }
    }).transform(output);
  }

  return output;
}
