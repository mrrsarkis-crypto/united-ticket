// Cloudflare Pages Functions middleware

const ADSENSE_ACCOUNT = 'ca-pub-9943048295609395';
const CONSENT_DEFAULT_SCRIPT = '<script>(function(){var k="uttAdConsent",s=null;try{s=localStorage.getItem(k)}catch(e){}var v=(s==="granted")?"granted":"denied";window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments)}window.gtag=gtag;var c={ad_storage:v,ad_user_data:v,ad_personalization:v,analytics_storage:v,functionality_storage:v,personalization_storage:v,security_storage:v};if(s===null)c.wait_for_update=500;gtag("consent","default",c)})();</script>';
const CONSENT_BANNER_SCRIPT = '<script src="/consent-banner.js?v=20261004" defer></script>';
const CONSENT_MARKER = 'uttAdConsent';
const CONSENT_BANNER_MARKER = '/consent-banner.js';
const ADSENSE_META = '<meta name="google-adsense-account" content="' + ADSENSE_ACCOUNT + '">';
const SERVICE_VIEW_TRACKING_SCRIPT = '<script src="/service-view-tracking.js" defer></script>';
const SERVICE_VIEW_MARKER = '/service-view-tracking.js';
const SCANNER_SCRIPTS = [
  '/scanner-preprocess.js',
  '/scanner-client.js',
  '/score-ui.js',
  '/scan-stage.js',
  '/scan-pay.js',
  '/scan-progress.js',
  '/scanner-upload.js'
];
const TRUST_BADGE_SCRIPT = '<script src="/trust-badge.js?v=20260917" defer></script>';
const CONTRAST_STYLE = '<style id="utt-contrast-fix">.vs-card{color:#21304A}.vs-note{color:#3D4A61}.footer-legal{color:#C7CED8}.footer-legal a{color:#E4E9F1;font-weight:600;text-decoration:underline}</style>';

function isMonetizedPath(pathname) {
  let path = (pathname || '/').replace(/\/+$/, '') || '/';
  if (path === '/amp') return false;
  if (path.startsWith('/amp/')) path = path.slice(4) || '/';
  const adFree = path === '/404' || path === '/404.html' ||
    path === '/admin' || path === '/admin.html' || /^\/admin[\/-]/.test(path) ||
    path === '/bot-courthouse' || path === '/bot-courthouse.html';
  return !adFree;
}

function isScannerPage(pathname) {
  const path = (pathname || '/').replace(/\/+$/, '') || '/';
  return path === '/' || path === '/index.html' || path === '/assistant' || path === '/assistant.html';
}

function insertAfterHeadOpen(html, fragment) {
  return html.replace(/<head([^>]*)>/i, (m) => `${m}\n${fragment}`);
}

function insertBeforeHeadClose(html, fragment) {
  return html.replace(/<\/head\s*>/i, (m) => `${fragment}\n${m}`);
}

// Homepage scanner code is not needed for first paint. It starts loading when
// the scan section approaches the viewport or the visitor interacts with it.
const HOMEPAGE_SCANNER_LOADER = `<script>(function(){var loaded=false;function load(){if(loaded)return;loaded=true;var s=${JSON.stringify(SCANNER_SCRIPTS)};s.forEach(function(src){var e=document.createElement('script');e.src=src;e.defer=true;document.head.appendChild(e)});var t=document.createElement('script');t.src='/trust-badge.js?v=20260917';t.defer=true;document.head.appendChild(t)}function boot(){var target=document.getElementById('scan');if(!target)return;if('IntersectionObserver' in window){new IntersectionObserver(function(es,o){if(es.some(function(e){return e.isIntersecting})){o.disconnect();load()}} ,{rootMargin:'700px 0px'}).observe(target)}['pointerdown','touchstart','focusin','keydown'].forEach(function(ev){target.addEventListener(ev,load,{once:true,passive:ev!=='keydown'})})}if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});else boot()})();</script>`;

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
  const scannerPage = isScannerPage(url.pathname);

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

  if (context.request.method === 'OPTIONS') return new Response(null, { status: 204, headers: newHeaders });

  let output = new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: newHeaders
  });

  if (isStandardHtml) {
    let html = await output.text();

    // Static pages may contain an eager AdSense tag. Remove it at the edge and
    // retain the publisher meta tag so the initial page stays lightweight.
    html = html.replace(/<script[^>]+pagead\.googlesyndication\.com\/pagead\/js\/adsbygoogle\.js[^>]*><\/script>/gi, '');
    if (monetized && !html.includes('google-adsense-account')) html = insertAfterHeadOpen(html, ADSENSE_META);
    if (monetized && !html.includes(CONSENT_MARKER)) html = insertAfterHeadOpen(html, CONSENT_DEFAULT_SCRIPT);
    if (monetized && !html.includes(CONSENT_BANNER_MARKER)) html = insertBeforeHeadClose(html, CONSENT_BANNER_SCRIPT);
    if (monetized && !html.includes(SERVICE_VIEW_MARKER)) html = insertBeforeHeadClose(html, SERVICE_VIEW_TRACKING_SCRIPT);

    if (scannerPage) {
      if (url.pathname === '/' || url.pathname === '/index.html') {
        if (!html.includes('utt-homepage-scanner-loader')) {
          html = insertBeforeHeadClose(html, HOMEPAGE_SCANNER_LOADER.replace('<script>', '<script id="utt-homepage-scanner-loader">'));
        }
      } else {
        for (const src of SCANNER_SCRIPTS) {
          if (!html.includes(src)) html = insertBeforeHeadClose(html, `<script src="${src}" defer></script>`);
        }
        if (!html.includes('/trust-badge.js')) html = insertBeforeHeadClose(html, TRUST_BADGE_SCRIPT);
      }
    }

    if (!html.includes('utt-contrast-fix')) html = insertBeforeHeadClose(html, CONTRAST_STYLE);

    output = new Response(html, {
      status: output.status,
      statusText: output.statusText,
      headers: newHeaders
    });
  } else if (isAmp && monetized) {
    output = new HTMLRewriter().on('head', {
      element(element) { element.append(ADSENSE_META, { html: true }); }
    }).transform(output);
  }

  return output;
}
