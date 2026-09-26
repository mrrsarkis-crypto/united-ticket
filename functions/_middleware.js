// Cloudflare Pages Functions middleware

const ADSENSE_ACCOUNT = 'ca-pub-9943048295609395';
// Google Consent Mode v2 default. MUST be emitted before ADSENSE_SCRIPT or the
// ad tag runs with no consent state, which is the exposure we are fixing.
// A returning visitor's stored choice is re-applied here as the *default*
// (not an update) so ads never briefly run denied before it resolves, and
// wait_for_update is only set for genuinely undecided visitors.
const CONSENT_DEFAULT_SCRIPT = '<script>(function(){var k="uttAdConsent",s=null;try{s=localStorage.getItem(k)}catch(e){}var v=(s==="granted")?"granted":"denied";window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments)}window.gtag=gtag;var c={ad_storage:v,ad_user_data:v,ad_personalization:v,analytics_storage:v,functionality_storage:v,personalization_storage:v,security_storage:v};if(s===null)c.wait_for_update=500;gtag("consent","default",c)})();</script>';
const CONSENT_BANNER_SCRIPT = '<script src="/consent-banner.js" defer></script>';
// Markers used to keep injection idempotent, because the static build
// (scripts/build-vercel.js) can inject AdSense into the same pages.
const ADSENSE_MARKER = 'pagead2.googlesyndication.com/pagead/js/adsbygoogle.js';
const CONSENT_MARKER = 'uttAdConsent';
const CONSENT_BANNER_MARKER = '/consent-banner.js';
const ADSENSE_SCRIPT = '<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=' + ADSENSE_ACCOUNT + '" crossorigin="anonymous"></script>';
const ADSENSE_META = '<meta name="google-adsense-account" content="' + ADSENSE_ACCOUNT + '">';
const AMP_ADSENSE_SCRIPT = '<script async custom-element="amp-auto-ads" src="https://cdn.ampproject.org/v0/amp-auto-ads-0.1.js"></script>';
const AMP_ADSENSE_UNIT = '<amp-auto-ads type="adsense" data-ad-client="' + ADSENSE_ACCOUNT + '"></amp-auto-ads>';
const SCANNER_PREPROCESS_SCRIPT = '<script src="/scanner-preprocess.js" defer></script>';
const SCANNER_CLIENT_SCRIPT = '<script src="/scanner-client.js" defer></script>';
const SCORE_UI_SCRIPT = '<script src="/score-ui.js" defer></script>';
const SCAN_STAGE_SCRIPT = '<script src="/scan-stage.js" defer></script>';
const SCAN_PAY_SCRIPT = '<script src="/scan-pay.js" defer></script>';
const SCAN_PROGRESS_SCRIPT = '<script src="/scan-progress.js" defer></script>';
const SCANNER_UPLOAD_SCRIPT = '<script src="/scanner-upload.js" defer></script>';
const TRUST_BADGE_SCRIPT = '<script src="/trust-badge.js?v=20260917" defer></script>';
const CONTRAST_STYLE = '<style id="utt-contrast-fix">.price .amount{color:#9A6900}.vs-card{color:#21304A}.vs-note{color:#3D4A61}.footer-legal{color:#C7CED8}.footer-legal a{color:#E4E9F1;font-weight:600;text-decoration:underline}</style>';

function isMonetizedPath(pathname) {
  let path = (pathname || '/').replace(/\/+$/, '') || '/';
  if (path === '/amp') return false;
  if (path.startsWith('/amp/')) path = path.slice(4) || '/';
  return path === '/resources' || path === '/resources.html' ||
    /^\/resources\/[^/]+(?:\.html)?$/.test(path) ||
    path === '/faq' || path === '/faq.html' ||
    path === '/ticket-quiz' || path === '/ticket-quiz.html' ||
    path === '/courthouses' || path === '/courthouses.html' ||
    path === '/all-courthouses' || path === '/all-courthouses.html' ||
    /^\/courthouses\/[^/]+(?:\.html)?$/.test(path);
}

function insertAfterHeadOpen(html, fragment) {
  return html.replace(/<head([^>]*)>/i, (m) => `${m}\n${fragment}`);
}

function insertBeforeHeadClose(html, fragment) {
  return html.replace(/<\/head\s*>/i, (m) => `${fragment}\n${m}`);
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
      "worker-src 'self' blob: https:",
      "img-src 'self' data: https:",
      "style-src 'self' 'unsafe-inline' https:",
      "connect-src 'self' https:",
      "frame-src 'self' https:"
    ];
    newHeaders.set('Content-Security-Policy', csp.join('; '));
    newHeaders.set('Permissions-Policy', 'geolocation=(), microphone=(), camera=(self)');
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
    // The consent default MUST reach the head before the AdSense tag. The
    // static build can already have injected AdSense into the same page, so
    // these pages are buffered and every injection is made idempotent rather
    // than assuming this middleware is the only thing touching <head>.
    if (monetized) {
      let html = await output.text();
      if (!html.includes(ADSENSE_MARKER)) {
        html = insertAfterHeadOpen(html, ADSENSE_META + CONSENT_DEFAULT_SCRIPT + ADSENSE_SCRIPT);
      } else if (!html.includes(CONSENT_MARKER)) {
        html = insertAfterHeadOpen(html, ADSENSE_META + CONSENT_DEFAULT_SCRIPT);
      }
      if (!html.includes(CONSENT_BANNER_MARKER)) {
        html = insertBeforeHeadClose(html, CONSENT_BANNER_SCRIPT);
      }
      output = new Response(html, { status: output.status, statusText: output.statusText, headers: newHeaders });
    }
    output = new HTMLRewriter().on('head', {
      element(element) {
        element.append(SCANNER_PREPROCESS_SCRIPT, { html: true });
        element.append(SCANNER_CLIENT_SCRIPT, { html: true });
        element.append(SCORE_UI_SCRIPT, { html: true });
        element.append(SCAN_STAGE_SCRIPT, { html: true });
        element.append(SCAN_PAY_SCRIPT, { html: true });
        element.append(SCAN_PROGRESS_SCRIPT, { html: true });
        element.append(SCANNER_UPLOAD_SCRIPT, { html: true });
        element.append(TRUST_BADGE_SCRIPT, { html: true });
        element.append(CONTRAST_STYLE, { html: true });
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
