import { ADSENSE_ACCOUNT, isAdsenseEligiblePath } from './adsense-policy.js';

// Privacy-first AdSense bootstrap. The same route policy is used in the build,
// edge middleware, and browser so every delivery layer fails closed.
(function () {
  'use strict';

  if (window.__uttAdsenseBooted) return;

  var productionHosts = ['unitedtraffictickets.com', 'www.unitedtraffictickets.com'];
  if (productionHosts.indexOf(window.location.hostname) === -1) return;

  // Defense in depth: even an accidental script include on a customer or legal
  // page cannot start an advertising request.
  if (!isAdsenseEligiblePath(window.location.pathname)) return;

  // Do not initiate an advertising request when the browser expresses GPC.
  if (navigator.globalPrivacyControl === true) return;

  window.__uttAdsenseBooted = true;
  document.documentElement.setAttribute('data-utt-ads', 'informational-only');

  function addPreconnect(href) {
    if (document.querySelector('link[rel="preconnect"][href="' + href + '"]')) return;
    var link = document.createElement('link');
    link.rel = 'preconnect';
    link.href = href;
    link.crossOrigin = 'anonymous';
    document.head.appendChild(link);
  }

  addPreconnect('https://pagead2.googlesyndication.com');
  addPreconnect('https://googleads.g.doubleclick.net');

  if (document.querySelector('script[src*="pagead2.googlesyndication.com/pagead/js/adsbygoogle.js"]')) return;

  var script = document.createElement('script');
  script.async = true;
  script.crossOrigin = 'anonymous';
  script.referrerPolicy = 'strict-origin-when-cross-origin';
  script.src = 'https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=' + encodeURIComponent(ADSENSE_ACCOUNT);
  script.setAttribute('data-utt-adsense', 'informational-pages');
  script.addEventListener('error', function () {
    document.documentElement.setAttribute('data-utt-ads', 'unavailable');
  }, { once: true });
  document.head.appendChild(script);
})();
