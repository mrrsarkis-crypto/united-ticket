// Lightweight ad-consent banner (Google Consent Mode v2).
// Loads only on informational pages where AdSense may run
// (see functions/_middleware.js isMonetizedPath / public/nav.js).
(function () {
  'use strict';
  if (window.__uttConsentBannerBooted) return;
  window.__uttConsentBannerBooted = true;

  var STORE_KEY = 'uttAdConsent'; // 'granted' | 'denied'
  window.dataLayer = window.dataLayer || [];
  function gtag() { window.dataLayer.push(arguments); }

  function applyConsent(state) {
    var g = state === 'granted';
    gtag('consent', 'update', {
      ad_storage: g ? 'granted' : 'denied',
      ad_user_data: g ? 'granted' : 'denied',
      ad_personalization: g ? 'granted' : 'denied',
      analytics_storage: g ? 'granted' : 'denied'
    });
  }

  function readStored() {
    try { return window.localStorage.getItem(STORE_KEY); } catch (e) { return null; }
  }

  function save(state) {
    try { window.localStorage.setItem(STORE_KEY, state); } catch (e) { /* ignore */ }
    applyConsent(state);
  }

  function renderReopenControl() {
    if (document.getElementById('uttAdConsentReopen')) return;
    var btn = document.createElement('button');
    btn.id = 'uttAdConsentReopen';
    btn.type = 'button';
    btn.title = 'Ad preferences';
    btn.setAttribute('aria-label', 'Change ad preferences');
    btn.textContent = 'Ad preferences';
    btn.style.cssText = 'position:fixed;left:12px;bottom:12px;z-index:2147482999;' +
      'background:#14181f;color:#c9cedb;border:1px solid #3a4050;border-radius:20px;' +
      'padding:6px 12px;font:600 11px/1 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;' +
      'cursor:pointer;opacity:.75';
    btn.addEventListener('click', function () {
      try { window.localStorage.removeItem(STORE_KEY); } catch (e) { /* ignore */ }
      btn.remove();
      renderBanner();
    });
    document.body.appendChild(btn);
  }
