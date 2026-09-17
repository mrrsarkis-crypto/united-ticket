// Cloudflare Pages Functions middleware

const ADSENSE_ACCOUNT = 'ca-pub-9943048295609395';
const ADSENSE_SCRIPT = '<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=' + ADSENSE_ACCOUNT + '" crossorigin="anonymous"></script>';
const ADSENSE_META = '<meta name="google-adsense-account" content="' + ADSENSE_ACCOUNT + '">';
const AMP_ADSENSE_SCRIPT = '<script async custom-element="amp-auto-ads" src="https://cdn.ampproject.org/v0/amp-auto-ads-0.1.js"></script>';
const AMP_ADSENSE_UNIT = '<amp-auto-ads type="adsense" data-ad-client="' + ADSENSE_ACCOUNT + '"></amp-auto-ads>';
const SCANNER_CLIENT_SCRIPT = '<script src="/scanner-client.js" defer></script>';
const SCORE_UI_SCRIPT = '<script src="/score-ui.js" defer></script>';
const SCAN_STAGE_SCRIPT = '<script src="/scan-stage.js" defer></script>';
const SCAN_PAY_SCRIPT = '<script src="/scan-pay.js" defer></script>';
const TRUST_BADGE_SCRIPT = '<script src="/trust-badge.js" defer></script>';

function isMonetizedPath(pathname) {
  let path = (pathname || '/').replace(/\/+$/, '') || '/';
  if (path === '/amp') return false;
  if (path.startsWith('/amp/')) path = path.slice(4) || '/';
  return path === '/resources' || path === '/resources.html' ||
    /^\/resources\/[^/]+(?:\.html)?$/.test(path) ||
    path === '/faq' || path === '/faq.html' ||
    path === '/courthouses' || path === '/courthouses.html' ||
    path === '/all-courthouses' || path === '/all-courthouses.html' ||
    /^\/courthouses\/[^/]+(?:\.html)?$/.test(path);
}

export async function onRequest(context) {
  const response = await context.next();
  const newHeaders = new Headers(response.headers);
  const url = new URL(context.request.url);
  const isAmp = url.pathname.startsWith('/amp/') || url.pathname === '/amp';
  const isHtml = (newHeaders.get('content-type') || '').includes('text/html');
  const isStandardHtml = isHtml && !isAmp;
  const isPrivateAdminApi = /^\/api\/cases\/admin(?:\.|$|\/)/.test(url.pathname);
  const isScannerApi = url.pathname === '/api/assistant/extract';
  const monetized = isMonetizedPath(url.pathname);

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
        element.append(SCANNER_CLIENT_SCRIPT, { html: true });
        element.append(SCORE_UI_SCRIPT, { html: true });
        element.append(SCAN_STAGE_SCRIPT, { html: true });
        element.append(SCAN_PAY_SCRIPT, { html: true });
        if (monetized) {
          element.append(ADSENSE_META, { html: true });
          element.append(ADSENSE_SCRIPT, { html: true });
        }
        element.append(TRUST_BADGE_SCRIPT, { html: true });
      }
    }).transform(output);
  } else if (isAmp && monetized) {
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
