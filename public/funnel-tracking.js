/* ============================================================
   FUNNEL CONVERSION TRACKING — United Traffic Tickets
   (all usable Google Ads accounts)

   Fires observation-only Website conversion events at each step
   of the ticket flow so every United account measures the funnel:

     891-901-0615  AW-18486315755  (new "United Traffic Tickets")
       Scan Started    2iVtCI3Q0YwdEOuV--5E
       Scan Completed  AaEECKng0YwdEOuV--5E
       Case Created    ZNKvCKPryIwdEOuV--5E
     586-971-9521  AW-18226751655  ("Google Ads account")
       Scan Started    caneCNbNzowdEKfRmPND
       Scan Completed  7_ImCNnNzowdEKfRmPND
       Case Created    shixCKPzowdEKfRmPND
     876-364-1932  AW-962316730    ("unitedtraffictickets.com")
       Scan Started    rx8ECJqz1owdELqT78oD
       Scan Completed  j-7bCJ2z1owdELqT78oD
       Case Created    Rz3PCKCz1owdELqT78oD

   Each event fires once per account (its own label).
   Scan Started/Completed trigger on POST /api/assistant/extract
   (request / success); Case Created on POST /api/cases success,
   with the tracking code as transaction_id for deduping.

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

  // Every usable United Google Ads account gets its own labeled
  // conversion for each funnel step.
  var DESTINATIONS = [
    { id: 'AW-18486315755', // 891-901-0615 (new)
      scanStarted: '2iVtCI3Q0YwdEOuV--5E',
      scanCompleted: 'AaEECKng0YwdEOuV--5E',
      caseCreated: 'ZNKvCKPryIwdEOuV--5E' },
    { id: 'AW-18226751655', // 586-971-9521
      scanStarted: 'caneCNbNzowdEKfRmPND',
      scanCompleted: '7_ImCNnNzowdEKfRmPND',
      caseCreated: 'shixCKPzowdEKfRmPND' },
    { id: 'AW-962316730', // 876-364-1932
      scanStarted: 'rx8ECJqz1owdELqT78oD',
      scanCompleted: 'j-7bCJ2z1owdELqT78oD',
      caseCreated: 'Rz3PCKCz1owdELqT78oD' }
  ];

  function gtagFn() {
    if (typeof window.gtag === 'function') return window.gtag;
    window.dataLayer = window.dataLayer || [];
    return function () { window.dataLayer.push(arguments); };
  }

  function fireConversion(which, extra) {
    try {
      var g = gtagFn();
      for (var i = 0; i < DESTINATIONS.length; i++) {
        var d = DESTINATIONS[i];
        var label = d[which];
        if (!label) continue;
        var params = { send_to: d.id + '/' + label, transport_type: 'beacon' };
        if (extra) {
          for (var k in extra) {
            if (Object.prototype.hasOwnProperty.call(extra, k)) params[k] = extra[k];
          }
        }
        g('event', 'conversion', params);
      }
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
