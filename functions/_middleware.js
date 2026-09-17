// Cloudflare Pages Functions middleware
import { ADSENSE_ACCOUNT, isAdsenseEligiblePath } from '../public/adsense-policy.js';

const ADSENSE_BOOTSTRAP = '<script type="module" src="/adsense.js" data-utt-adsense-bootstrap></script>';
const ADSENSE_META = '<meta name="google-adsense-account" content="' + ADSENSE_ACCOUNT + '">';
const AMP_ADSENSE_SCRIPT = '<script async custom-element="amp-auto-ads" src="https://cdn.ampproject.org/v0/amp-auto-ads-0.1.js"></script>';
const AMP_ADSENSE_UNIT = '<amp-auto-ads type="adsense" data-ad-client="' + ADSENSE_ACCOUNT + '"></amp-auto-ads>';
const SCANNER_CLIENT_SCRIPT = '<script src="/scanner-client.js"></script>';
const TRUST_BADGE_SCRIPT = '<script src="/trust-badge.js" defer></script>';

export async function onRequest(context) {
  const response = await context.next();
  const newHeaders = new Headers(response.headers);
  const url = new URL(context.request.url);
  const isAmp = url.pathname.startsWith('/amp/') || url.pathname === '/amp';
  const isHtml = (newHeaders.get('content-type') || '').includes('text/html');
  const isAdsenseEligible = response.ok && isHtml && isAdsenseEligiblePath(url.pathname);
  const isStandardHtml = isHtml && !isAmp;
  const isAmpHtml = isHtml && isAmp;
  const isPrivateAdminApi = /^\/api\/cases\/admin(?:\.|$|\/)/.test(url.pathname);
  const isScannerApi = url.pathname === '/api/assistant/extract';
  const isPrivateHtml = /^\/(?:case|admin-cases|admin-funnel)(?:\.html)?\/?$/.test(url.pathname);

  newHeaders.set('X-Content-Type-Options', 'nosniff');
  newHeaders.set('X-Frame-Options', 'DENY');
  newHeaders.set('Referrer-Policy', 'no-referrer');
  if (isPrivateHtml) {
    newHeaders.set('X-Robots-Tag', 'noindex, nofollow, noarchive, nosnippet, noimageindex');
    newHeaders.set('Cache-Control', 'private, no-store, max-age=0');
  }

  if (isStandardHtml) {
    // Keep the policy HTTPS-only while allowing Google/Stripe and other HTTPS
    // dependencies used by the existing public application.
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
    output = new HTMLRewriter()
      // Remove stale/manual tags first. Only the policy-controlled tags below
      // may survive, preventing duplicate requests if source HTML drifts.
      .on('meta[name="google-adsense-account"]', { element(element) { element.remove(); } })
      .on('script[data-utt-adsense-bootstrap]', { element(element) { element.remove(); } })
      .on('script[src*="pagead2.googlesyndication.com/pagead/js/adsbygoogle.js"]', { element(element) { element.remove(); } })
      .on('script[custom-element="amp-auto-ads"]', { element(element) { element.remove(); } })
      .on('amp-auto-ads', { element(element) { element.remove(); } })
      .on('head', {
        element(element) {
          // Load the scanner request optimizer before body scripts. It compresses
          // oversized phone photos, converts supported HEIC uploads, and bounds
          // request time without changing the visible page structure.
          element.append(SCANNER_CLIENT_SCRIPT, { html: true });
          if (isAdsenseEligible) {
            element.append(ADSENSE_META, { html: true });
            element.append(ADSENSE_BOOTSTRAP, { html: true });
          }
          element.append(TRUST_BADGE_SCRIPT, { html: true });
        }
      }).transform(output);
  } else if (isAmpHtml) {
    // Sanitize every AMP document, including ineligible/fallback responses.
    // AMP requires its dedicated component and unit only on approved pages.
    output = new HTMLRewriter()
      .on('meta[name="google-adsense-account"]', { element(element) { element.remove(); } })
      .on('script[src*="pagead2.googlesyndication.com/pagead/js/adsbygoogle.js"]', { element(element) { element.remove(); } })
      .on('script[custom-element="amp-auto-ads"]', { element(element) { element.remove(); } })
      .on('amp-auto-ads', { element(element) { element.remove(); } })
      .on('head', {
        element(element) {
          if (isAdsenseEligible) {
            element.append(ADSENSE_META, { html: true });
            element.append(AMP_ADSENSE_SCRIPT, { html: true });
          }
        }
      })
      .on('body', {
        element(element) {
          if (isAdsenseEligible) element.prepend(AMP_ADSENSE_UNIT, { html: true });
        }
      })
      .transform(output);
  }

  return output;
}
