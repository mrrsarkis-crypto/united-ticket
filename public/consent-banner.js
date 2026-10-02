// Lightweight ad-consent banner (Google Consent Mode v2).
(function () {
  'use strict';
  if (window.__uttConsentBannerBooted) return;
  window.__uttConsentBannerBooted = true;

  var STORE_KEY = 'uttAdConsent';
  window.dataLayer = window.dataLayer || [];
  function gtag() { window.dataLayer.push(arguments); }

  function consentState(state) {
    var v = state === 'granted' ? 'granted' : 'denied';
    return {
      ad_storage: v,
      ad_user_data: v,
      ad_personalization: v,
      analytics_storage: v,
      functionality_storage: v,
      personalization_storage: v,
      security_storage: v
    };
  }

  function applyConsent(state) {
    gtag('consent', 'update', consentState(state));
    try { window.dispatchEvent(new CustomEvent('utt:ad-consent', { detail: { state: state } })); } catch (e) {}
  }

  function readStored() {
    try { return window.localStorage.getItem(STORE_KEY); } catch (e) { return null; }
  }

  function decide(state) {
    try { window.localStorage.setItem(STORE_KEY, state); } catch (e) {}
    applyConsent(state);
  }

  function removeBanner() {
    var el = document.getElementById('uttAdConsentBanner');
    if (el) el.remove();
  }

  function button(label, primary) {
    var b = document.createElement('button');
    b.type = 'button';
    b.textContent = label;
    b.style.cssText = 'flex:1 1 0;min-width:120px;min-height:48px;cursor:pointer;border-radius:8px;padding:10px 14px;' +
      'font:600 14px/1.2 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;' +
      (primary
        ? 'background:#1B6EF3;color:#fff;border:1px solid #1B6EF3;'
        : 'background:transparent;color:#D7DCE5;border:1px solid #3A4050;');
    return b;
  }

  function renderReopenControl() {
    if (document.getElementById('uttAdConsentReopen')) return;
    var btn = button('Ad preferences', false);
    btn.id = 'uttAdConsentReopen';
    btn.style.cssText = btn.style.cssText.replace('flex:1 1 0;min-width:120px;', 'flex:0 0 auto;');
    btn.style.cssText += 'position:fixed;left:12px;bottom:12px;z-index:2147482998;opacity:.75;';
    btn.setAttribute('aria-label', 'Change your advertising preferences');
    btn.addEventListener('click', function () {
      try { window.localStorage.removeItem(STORE_KEY); } catch (e) {}
      btn.remove();
      renderBanner();
    });
    document.body.appendChild(btn);
  }

  function renderBanner() {
    removeBanner();
    var el = document.createElement('div');
    el.id = 'uttAdConsentBanner';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-label', 'Cookie and advertising preferences');
    el.style.cssText = 'position:fixed;left:0;right:0;bottom:0;z-index:2147482999;' +
      'display:flex;flex-wrap:wrap;align-items:center;gap:16px;margin:0;padding:16px 20px;' +
      'background:#14181f;color:#C9CEDB;border-top:1px solid #3A4050;' +
      'box-shadow:0 -6px 24px rgba(0,0,0,.35);';

    var text = document.createElement('p');
    text.style.cssText = 'flex:1 1 320px;margin:0;font:400 14px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;';
    text.innerHTML = 'We use cookies and third-party advertising to measure traffic and show relevant ads. ' +
      'You can accept advertising cookies or continue with limited, non-personalized ads. ' +
      'See our <a href="/privacy" style="color:#8FB6FF;text-decoration:underline;">Privacy Policy</a>.';

    var actions = document.createElement('div');
    actions.style.cssText = 'display:flex;flex-wrap:wrap;gap:10px;flex:0 1 320px;';

    var accept = button('Accept', true);
    accept.addEventListener('click', function () { decide('granted'); removeBanner(); });

    var decline = button('Use limited ads', false);
    decline.addEventListener('click', function () { decide('denied'); removeBanner(); });

    actions.appendChild(decline);
    actions.appendChild(accept);
    el.appendChild(text);
    el.appendChild(actions);
    document.body.appendChild(el);
  }

  var stored = readStored();
  if (stored === 'granted' || stored === 'denied') {
    applyConsent(stored);
    renderReopenControl();
  } else {
    applyConsent('denied');
    renderBanner();
  }
})();

/* ---- UTT deferred AdSense library (all pages) ----
   adsbygoogle.js (~220KB) loads only after the page is interactive
   (window load + idle). Ad units reserve space via min-height, so deferred
   fill causes zero layout shift. push() calls queue in window.adsbygoogle
   and are processed when the library arrives. */
(function () {
  if (window.__uttAdsenseLoaderBooted) return;
  window.__uttAdsenseLoaderBooted = true;
  var CLIENT = 'ca-pub-9943048295609395';

  function pushUnits() {
    var units = document.querySelectorAll('.adsbygoogle');
    for (var i = 0; i < units.length; i++) {
      try { (window.adsbygoogle = window.adsbygoogle || []).push({}); } catch (e) {}
    }
  }
  // Defined at eval time (this is a deferred script, so before
  // DOMContentLoaded) so the manual-units block below can push immediately;
  // calls queue safely until the library loads.
  window.__uttLoadAdsense = pushUnits;

  function loadLibrary() {
    if (window.__uttAdsenseLoaded) return;
    window.__uttAdsenseLoaded = true;
    var s = document.createElement('script');
    s.async = true;
    s.src = 'https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=' + CLIENT;
    s.crossOrigin = 'anonymous';
    s.addEventListener('load', pushUnits, { once: true });
    document.head.appendChild(s);
  }
  function scheduleLibrary() {
    // Only fetch the library on pages that actually show ads.
    var hasUnits = document.querySelectorAll('.adsbygoogle').length > 0;
    var hasAutoAds = !!document.querySelector('meta[name="google-adsense-account"]');
    if (!hasUnits && !hasAutoAds) return;
    if ('requestIdleCallback' in window) window.requestIdleCallback(loadLibrary, { timeout: 3000 });
    else setTimeout(loadLibrary, 2000);
  }
  if (document.readyState === 'complete') scheduleLibrary();
  else window.addEventListener('load', scheduleLibrary, { once: true });
})();

/* ---- UTT manual AdSense units: every page except the homepage ---- */
(function () {
  var path = location.pathname.replace(/\/$/, '') || '/';
  if (path === '/' || path === '/index.html') return;
  if (/^\/thank-you/.test(path) || /^\/admin-/.test(path)) return;

  function makeIns(slot, format) {
    var ins = document.createElement('ins');
    ins.className = 'adsbygoogle';
    ins.style.display = 'block';
    ins.setAttribute('data-ad-client', 'ca-pub-9943048295609395');
    ins.setAttribute('data-ad-slot', slot);
    if (format) ins.setAttribute('data-ad-format', format);
    return ins;
  }
  function wrap(el) {
    var d = document.createElement('div');
    d.className = 'wrap';
    d.style.margin = '2rem auto';
    d.appendChild(el);
    return d;
  }
  function run() {
    var hero = document.querySelector('main .hero, main .sub-hero, main section');
    if (hero && hero.parentNode) hero.parentNode.insertBefore(wrap(makeIns('3445149853')), hero.nextSibling);
    var footer = document.querySelector('footer.site-footer, footer');
    if (footer && footer.parentNode) footer.parentNode.insertBefore(wrap(makeIns('5026833996', 'autorelaxed')), footer);
    if (window.__uttLoadAdsense) window.__uttLoadAdsense();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run);
  else run();
})();

/* Google tag: Consent Mode v2 — config queues in dataLayer immediately
   (default denied until visitor consents); the gtag.js LIBRARY loads only
   after the page is interactive, so it never competes with first paint.
   No ad cookies fire until 'granted'. */
(function () {
  if (window.__uttGoogleTagLoaderBooted) return;
  window.__uttGoogleTagLoaderBooted = true;
  var ADS_ID = 'AW-18226751655';

  window.dataLayer = window.dataLayer || [];
  window.gtag = window.gtag || function () { window.dataLayer.push(arguments); };
  // Default everything to denied BEFORE the library loads (Consent Mode v2).
  window.gtag('consent', 'default', {
    ad_storage: 'denied',
    ad_user_data: 'denied',
    ad_personalization: 'denied',
    analytics_storage: 'denied',
    functionality_storage: 'denied',
    personalization_storage: 'denied',
    security_storage: 'granted',
    wait_for_update: 500
  });
  window.gtag('js', new Date());
  window.gtag('config', ADS_ID);
  window.gtag('config', 'AW-18486315755');
  window.gtag('config', 'AW-962316730');
  window.gtag('config', 'AW-18486707638');

  // If the visitor already granted, lift to granted immediately.
  try {
    if (window.localStorage.getItem('uttAdConsent') === 'granted') {
      window.gtag('consent', 'update', {
        ad_storage: 'granted',
        ad_user_data: 'granted',
        ad_personalization: 'granted',
        analytics_storage: 'granted',
        functionality_storage: 'granted',
        personalization_storage: 'granted',
        security_storage: 'granted'
      });
    }
  } catch (e) {}

  // Listen for the banner's consent decision and update accordingly.
  window.addEventListener('utt:ad-consent', function (ev) {
    var st = (ev && ev.detail && ev.detail.state === 'granted') ? 'granted' : 'denied';
    window.gtag('consent', 'update', {
      ad_storage: st,
      ad_user_data: st,
      ad_personalization: st,
      analytics_storage: st,
      functionality_storage: st,
      personalization_storage: st,
      security_storage: 'granted'
    });
  });

  // Deferred library load: only after the page is interactive (window load +
  // idle). Every gtag() call above and below queues in dataLayer and replays
  // in order when the library arrives, so Consent Mode semantics are unchanged.
  function loadGoogleTagLibrary() {
    if (window.__uttGoogleTagLoaded) return;
    window.__uttGoogleTagLoaded = true;
    var s = document.createElement('script');
    s.async = true;
    s.src = 'https://www.googletagmanager.com/gtag/js?id=' + encodeURIComponent(ADS_ID);
    document.head.appendChild(s);
  }
  function scheduleGoogleTagLibrary() {
    if ('requestIdleCallback' in window) window.requestIdleCallback(loadGoogleTagLibrary, { timeout: 3000 });
    else setTimeout(loadGoogleTagLibrary, 1500);
  }
  if (document.readyState === 'complete') scheduleGoogleTagLibrary();
  else window.addEventListener('load', scheduleGoogleTagLibrary, { once: true });
})();
