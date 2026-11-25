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
// Include prices only for views tied to a supported online checkout tier.
// An informational service view can still be tracked without a price.
(function () {
  'use strict';
  if (window.__uttServiceViewTracked) return;
  window.__uttServiceViewTracked = true;

  // slug -> [item id, item name, optional price in USD]
  var SERVICES = {
    'speeding-ticket': ['utt_svc_speeding', 'Speeding Ticket Defense', 199],
    'cdl-ticket': ['utt_svc_cdl', 'CDL Ticket Defense', 199],
    'suspended-license': ['utt_svc_suspended', 'Suspended License Defense'],
    'stop-sign-ticket': ['utt_svc_stop_sign', 'Stop Sign Ticket Defense', 199],
    'red-light-ticket': ['utt_svc_red_light', 'Red Light Ticket Defense', 199],
    'reckless-driving': ['utt_svc_reckless', 'Reckless Driving Defense', 199],
    'failure-to-appear': ['utt_svc_fta', 'Failure to Appear Help', 199],
    'fix-it-ticket': ['utt_svc_fix_it', 'Fix-It Ticket Help'],
    'cell-phone-ticket': ['utt_svc_cell_phone', 'Cell Phone Ticket Defense', 199]
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

  function serviceItem(service) {
    var item = {
      item_id: service[0],
      item_name: service[1],
      quantity: 1,
      item_category: 'Legal Services'
    };
    if (typeof service[2] === 'number') item.price = service[2];
    return item;
  }

  var slug = currentSlug();
  var service = SERVICES[slug];

  if (service) {
    var item = serviceItem(service);
    var event = { items: [item] };
    if (typeof item.price === 'number') {
      event.currency = 'USD';
      event.value = item.price * item.quantity;
    }
    gtag('event', 'view_item', event);
  } else if (inList()) {
    var items = Object.keys(SERVICES).map(function (key) {
      return serviceItem(SERVICES[key]);
    });
    gtag('event', 'view_item_list', {
      item_list_name: ITEM_LIST_NAME,
      items: items
    });
  }
})();
