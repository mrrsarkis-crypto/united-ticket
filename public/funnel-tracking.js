/* ============================================================
   FUNNEL CONVERSION TRACKING — Google Ads account 891-901-0615
   ("United Traffic Tickets")

   Fires observation-only Website conversion events at each step
   of the ticket flow so Google Ads can measure the full funnel:

     Scan Started   -> AW-18486315755/2iVtCI3Q0YwdEOuV--5E
                       fired when the browser POSTs to
                       /api/assistant/extract (the scan request)
     Scan Completed -> AW-18486315755/AaEECKng0YwdEOuV--5E
                       fired when the extract call succeeds
     Case Created   -> AW-18486315755/ZNKvCKPryIwdEOuV--5E
                       fired when POST /api/cases succeeds;
                       the case tracking code is sent as
                       transaction_id so Google dedupes

   The purchase conversion itself lives on /thank-you.html and is
   intentionally NOT duplicated here.

   How it hooks in: a thin fetch() wrapper. No dependency on the
   scanner's internal functions or DOM ids, so scanner rewrites
   don't silently break tracking.

   Consent: events route through window.gtag / dataLayer set up by
   consent-banner.js, so Consent Mode v2 applies (events are
   buffered while consent is denied, honoring the visitor's choice).

   transport_type 'beacon' is set so the Case Created event survives
   the immediate redirect to Stripe checkout.
   ============================================================ */
(function () {
  'use strict';
  if (window.__uttFunnelTracked) return;
  window.__uttFunnelTracked = true;

  var ADS_ID = 'AW-18486315755';
  var SEND_TO = {
    scanStarted:   ADS_ID + '/2iVtCI3Q0YwdEOuV--5E',
    scanCompleted: ADS_ID + '/AaEECKng0YwdEOuV--5E',
    caseCreated:   ADS_ID + '/ZNKvCKPryIwdEOuV--5E'
  };

  function gtagFn() {
    if (typeof window.gtag === 'function') return window.gtag;
    window.dataLayer = window.dataLayer || [];
    return function () { window.dataLayer.push(arguments); };
  }

  function fireConversion(which, extra) {
    try {
      var params = { send_to: SEND_TO[which], transport_type: 'beacon' };
      if (extra) {
        for (var k in extra) {
          if (Object.prototype.hasOwnProperty.call(extra, k)) params[k] = extra[k];
        }
      }
      gtagFn()('event', 'conversion', params);
    } catch (e) { /* tracking must never break the flow */ }
  }

  function urlOf(input) {
    if (typeof input === 'string') return input;
    if (input && typeof input.url === 'string') return input.url;
    return '';
  }

  function methodOf(input, init) {
    if (init && init.method) return String(init.method).toUpperCase();
    if (input && typeof input !== 'string' && input.method) return String(input.method).toUpperCase();
    return 'GET';
  }

  var origFetch = window.fetch;
  if (typeof origFetch !== 'function') return;

  window.fetch = function (input, init) {
    var url = urlOf(input);
    var method = methodOf(input, init);
    var isExtract = url.indexOf('/api/assistant/extract') !== -1 && method === 'POST';
    var isCaseCreate = url.indexOf('/api/cases') !== -1 && method === 'POST' &&
                       url.indexOf('/api/cases/') === -1;

    if (isExtract) fireConversion('scanStarted');

    var promise;
    try {
      promise = origFetch.apply(this, arguments);
    } catch (e) {
      throw e;
    }
    if (!isExtract && !isCaseCreate) return promise;

    return promise.then(function (resp) {
      try {
        if (!resp) return resp;
        if (isExtract && resp.ok) {
          fireConversion('scanCompleted');
        } else if (isCaseCreate && resp.ok) {
          try {
            resp.clone().json().then(function (d) {
              var code = d && (d.trackingCode || d.tracking_code || d.code);
              fireConversion('caseCreated', code ? { transaction_id: String(code) } : null);
            }, function () {
              fireConversion('caseCreated');
            });
          } catch (e) {
            fireConversion('caseCreated');
          }
        }
      } catch (e) { /* never break the app */ }
      return resp;
    });
  };
})();
