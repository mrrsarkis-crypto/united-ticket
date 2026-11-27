// Cloudflare Pages Functions middleware

const ADSENSE_ACCOUNT = 'ca-pub-9943048295609395';
const CONSENT_DEFAULT_SCRIPT = '<script>(function(){var k="uttAdConsent",s=null;try{s=localStorage.getItem(k)}catch(e){}var v=(s==="granted")?"granted":"denied";window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments)}window.gtag=gtag;var c={ad_storage:v,ad_user_data:v,ad_personalization:v,analytics_storage:v,functionality_storage:v,personalization_storage:v,security_storage:v};if(s===null)c.wait_for_update=500;gtag("consent","default",c)})();</script>';
const CONSENT_BANNER_SCRIPT = '<script src="/consent-banner.js?v=20261004" defer></script>';
const CONSENT_MARKER = 'uttAdConsent';
const CONSENT_BANNER_MARKER = '/consent-banner.js';
const ADSENSE_META = '<meta name="google-adsense-account" content="' + ADSENSE_ACCOUNT + '">';
const UET_SCRIPT = '<script>(function(w,d,t,r,u){var f,n,i;w[u]=w[u]||[];f=function(){var o={ti:"187285081",enableAutoSpaTracking:true};o.q=w[u];w[u]=new UET(o);w[u].push("pageLoad")};n=d.createElement(t);n.src=r;n.async=1;n.onload=n.onreadystatechange=function(){var s=this.readyState;if(s&&s!=="loaded"&&s!=="complete")return;f();n.onload=n.onreadystatechange=null};i=d.getElementsByTagName(t)[0];i.parentNode.insertBefore(n,i)})(window,document,"script","//bat.bing.com/bat.js","uetq");</script>';
const UET_MARKER = 'bat.bing.com/bat.js';
const POSTHOG_SCRIPT = '<script>!function(t,e){var o,n,p,r;e.__SV||(window.posthog&&window.posthog.__loaded)||(window.posthog=e,e._i=[],e.init=function(i,s,a){function g(t,e){var o=e.split(".");2==o.length&&(t=t[o[0]],e=o[1]),t[e]=function(){t.push([e].concat(Array.prototype.slice.call(arguments,0)))}}(p=t.createElement("script")).type="text/javascript",p.crossOrigin="anonymous",p.async=!0,p.src=s.api_host.replace(".i.posthog.com","-assets.i.posthog.com")+"/static/array.js",(r=t.getElementsByTagName("script")[0]).parentNode.insertBefore(p,r);var u=e;for(void 0!==a?u=e[a]=[]:a="posthog",u.people=u.people||[],u.toString=function(t){var e="posthog";return"posthog"!==a&&(e+="."+a),t||(e+=" (stub)"),e},u.people.toString=function(){return u.toString(1)+".people (stub)"},o="init capture register register_once register_for_session unregister unregister_for_session getFeatureFlag getFeatureFlagPayload isFeatureEnabled reloadFeatureFlags updateEarlyAccessFeatureEnrollment getEarlyAccessFeatures on onFeatureFlags onSessionId getSurveys getActiveMatchingSurveys renderSurvey canRenderSurvey getNextSurveyStep identify setPersonProperties group resetGroups setPersonPropertiesForFlags resetPersonPropertiesForFlags setGroupPropertiesForFlags resetGroupPropertiesForFlags reset get_distinct_id getGroups get_session_id get_session_replay_url alias set_config startSessionRecording stopSessionRecording sessionRecordingStarted captureException loadToolbar get_property getSessionProperty createPersonProfile opt_in_capturing opt_out_capturing has_opted_in_capturing has_opted_out_capturing clear_opt_in_out_capturing debug".split(" "),n=0;n<o.length;n++)g(u,o[n]);e._i.push([i,s,a])},e.__SV=1)}(document,window.posthog||[]);(function(){function mode(s){return s==="granted"?"localStorage+cookie":"memory"}var s=null;try{s=localStorage.getItem("uttAdConsent")}catch(e){}posthog.init("phc_rCdq4tSfQCTJCqHoxTkpApvZVKRBVSN6PtjZMDxCNqua",{api_host:"https://us.i.posthog.com",defaults:"2025-05-24",person_profiles:"identified_only",persistence:mode(s),session_recording:{maskAllInputs:true}});window.addEventListener("utt:ad-consent",function(e){posthog.set_config({persistence:mode(e&&e.detail&&e.detail.state)})})})();</script>';
const POSTHOG_MARKER = 'posthog.init(';
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

// Admin pages render customer case data, so they stay out of analytics and replay.
function isAnalyticsPath(pathname) {
  const path = (pathname || '/').replace(/\/+$/, '') || '/';
  return !(path === '/admin' || path === '/admin.html' || /^\/admin[\/-]/.test(path));
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
  const analytics = isAnalyticsPath(url.pathname);

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
    if (monetized && !html.includes(UET_MARKER)) html = insertAfterHeadOpen(html, UET_SCRIPT);
    if (analytics && !html.includes(POSTHOG_MARKER)) html = insertAfterHeadOpen(html, POSTHOG_SCRIPT);

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
