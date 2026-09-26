// Lightweight ad-consent banner (Google Consent Mode v2).
//
// Only loads on monetized pages, where AdSense runs (see isMonetizedPath in
// functions/_middleware.js). The consent *default* is set by a small inline
// script in the middleware, before the AdSense tag, so this file only has to:
//
//   1. show the banner when the visitor has not decided yet, and
//   2. push gtag('consent','update') once they accept or decline.
//
// A returning visitor's stored choice is re-applied as the *default* on the
// next page load, so they are never asked twice and never see a flash of
// denied consent before the ad tag runs.
(function () {
  'use strict';
  if (window.__uttConsentBannerBooted) return;
  window.__uttConsentBannerBooted = true;

  var STORE_KEY = 'uttAdConsent'; // 'granted' | 'denied'
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
  }

  function readStored() {
    try { return window.localStorage.getItem(STORE_KEY); } catch (e) { return null; }
  }

  function decide(state) {
    try { window.localStorage.setItem(STORE_KEY, state); } catch (e) { /* ignore */ }
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
      try { window.localStorage.removeItem(STORE_KEY); } catch (e) { /* ignore */ }
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
