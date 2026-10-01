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
    b.style.cssText = 'flex:1 1 0;min-width:120px;cursor:pointer;border-radius:8px;padding:10px 14px;' +
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

/* Google tag: load only for visitors who granted advertising consent. */
(function () {
  if (window.__uttGoogleTagLoaderBooted) return;
  window.__uttGoogleTagLoaderBooted = true;
  var ADS_ID = 'AW-18226751655';

  function load() {
    if (window.__uttGoogleTagLoaded) return;
    var granted = false;
    try { granted = window.localStorage.getItem('uttAdConsent') === 'granted'; } catch (e) {}
    if (!granted) return;
    window.__uttGoogleTagLoaded = true;
    window.dataLayer = window.dataLayer || [];
    window.gtag = window.gtag || function () { window.dataLayer.push(arguments); };
    window.gtag('js', new Date());
    window.gtag('config', ADS_ID);
    window.gtag('config', 'AW-18486315755');
    window.gtag('config', 'AW-962316730');
    var s = document.createElement('script');
    s.async = true;
    s.src = 'https://www.googletagmanager.com/gtag/js?id=' + encodeURIComponent(ADS_ID);
    document.head.appendChild(s);
  }

  function schedule() {
    if (window.requestIdleCallback) requestIdleCallback(load, { timeout: 3000 });
    else setTimeout(load, 2500);
  }

  window.addEventListener('utt:ad-consent', schedule);
  window.addEventListener('load', schedule, { once: true });
  try {
    if (window.localStorage.getItem('uttAdConsent') === 'granted') schedule();
  } catch (e) {}
})();
