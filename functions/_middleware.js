// Cloudflare Pages Functions middleware

const ADSENSE_ACCOUNT = 'ca-pub-9943048295609395';
const ADSENSE_SCRIPT = '<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=' + ADSENSE_ACCOUNT + '" crossorigin="anonymous"></script>';
const ADSENSE_META = '<meta name="google-adsense-account" content="' + ADSENSE_ACCOUNT + '">';
const AMP_ADSENSE_SCRIPT = '<script async custom-element="amp-auto-ads" src="https://cdn.ampproject.org/v0/amp-auto-ads-0.1.js"></script>';
const AMP_ADSENSE_UNIT = '<amp-auto-ads type="adsense" data-ad-client="' + ADSENSE_ACCOUNT + '"></amp-auto-ads>';
const SCANNER_CLIENT_SCRIPT = '<script src="/scanner-client.js"></script>';

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
    // AdSense can load on every standard public HTML page. Keep the policy
    // HTTPS-only while allowing Google/Stripe and other HTTPS dependencies.
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
        element.append(ADSENSE_META, { html: true });
        element.append(ADSENSE_SCRIPT, { html: true });
      }
    }).transform(output);
  } else if (isAmp) {
    // AMP requires its dedicated Auto ads component instead of the standard
    // AdSense loader. Google requires the script in <head> and the element
    // immediately inside <body>.
    output = new HTMLRewriter()
      .on('head', {
        element(element) {
          element.append(ADSENSE_META, { html: true });
          element.append(AMP_ADSENSE_SCRIPT, { html: true });
        }
      })
      .on('body', {
        element(element) {
          element.prepend(AMP_ADSENSE_UNIT, { html: true });
        }
      })
      .transform(output);
  }

  return output;
}
