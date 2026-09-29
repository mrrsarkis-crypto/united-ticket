// Service-page view tracking for Google Ads / AdSense.
//
// Emits a `view_item` event when a visitor lands on one of the paid service
// pages, so remarketing audiences can be built from genuine engagement
// instead of a bare page_view. It deliberately does NOT emit `purchase`:
// checkout happens on Stripe's hosted page, so a browser-side purchase event
// could only be guessed at on the return trip and would report revenue that
// was never verified. Server-side purchase tracking belongs behind the Stripe
// webhook (checkout.session.completed), not here.
//
// Consent: Consent Mode v2 gates ad_personalization, so with the default
// `denied` state the event is buffered rather than lost, and Google replays it
// once the visitor grants consent. Nothing here writes or reads a new storage
// key, so it cannot disagree with the banner's stored choice.
//
// Pricing is keyed to the tiers the UI quotes ($199 standard ticket, $149
// suspended licence, $99 fix-it) and mirrors DEFAULT_PRICE_IDS in
// functions/api/_shared.js. Keep the two in step.
(function () {
  'use strict';
  if (window.__uttServiceViewTracked) return;
  window.__uttServiceViewTracked = true;

  // slug -> [item id, item name, price, price cents]
  var SERVICES = {
    'speeding-ticket': ['utt_svc_speeding', 'Speeding Ticket Defense', 199, 19900],
    'cdl-ticket': ['utt_svc_cdl', 'CDL Ticket Defense', 199, 19900],
    'suspended-license': ['utt_svc_suspended', 'Suspended License Defense', 149, 14900],
    'stop-sign-ticket': ['utt_svc_stop_sign', 'Stop Sign Ticket Defense', 199, 19900],
    'red-light-ticket': ['utt_svc_red_light', 'Red Light Ticket Defense', 199, 19900],
    'reckless-driving': ['utt_svc_reckless', 'Reckless Driving Defense', 199, 19900],
    'failure-to-appear': ['utt_svc_fta', 'Failure to Appear Help', 199, 19900],
    'fix-it-ticket': ['utt_svc_fix_it', 'Fix-It Ticket Help', 99, 9900],
    'cell-phone-ticket': ['utt_svc_cell_phone', 'Cell Phone Ticket Defense', 199, 19900]
  };

  var LIST_PAGE = 'services';
  var ITEM_LIST_NAME = 'Traffic Ticket Defense Services';

  window.dataLayer = window.dataLayer || [];
  function gtag() { window.dataLayer.push(arguments); }

  function currentSlug() {
    var p = window.location.pathname || '/';
    p = p.replace(/\/+$/, '');
    var parts = p.split('/').filter(Boolean);
    return parts.length ? parts[parts.length - 1].toLowerCase() : '';
  }

  // AMP pages carry no consent component, so an event fired there could not be
  // gated by Consent Mode. The middleware does not inject this script into
  // /amp/, but refuse it here too rather than relying on the injector alone.
  var path = window.location.pathname || '/';
  if (path === '/amp' || path.indexOf('/amp/') === 0) return;

  function inList() {
    var parts = (window.location.pathname || '/').split('/').filter(Boolean);
    if (!parts.length) return true; // homepage carries the service list
    return parts[parts.length - 1].toLowerCase() === LIST_PAGE;
  }

  var slug = currentSlug();
  var service = SERVICES[slug];

  if (service) {
    gtag('event', 'view_item', {
      currency: 'USD',
      value: service[3],
      items: [{
        item_id: service[0],
        item_name: service[1],
        price: service[2],
        quantity: 1,
        item_category: 'Legal Services'
      }]
    });
  } else if (inList()) {
    var items = Object.keys(SERVICES).map(function (key) {
      var s = SERVICES[key];
      return {
        item_id: s[0],
        item_name: s[1],
        price: s[2],
        quantity: 1,
        item_category: 'Legal Services'
      };
    });
    gtag('event', 'view_item_list', {
      item_list_name: ITEM_LIST_NAME,
      items: items
    });
  }
})();
