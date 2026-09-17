(function () {
  'use strict';
  var CALIFORNIA_COUNTIES = ['alameda','alpine','amador','butte','calaveras','colusa','contra costa','del norte','el dorado','fresno','glenn','humboldt','imperial','inyo','kern','kings','lake','lassen','los angeles','madera','marin','mariposa','mendocino','merced','modoc','mono','monterey','napa','nevada','orange','placer','plumas','riverside','sacramento','san benito','san bernardino','san diego','san francisco','san joaquin','san luis obispo','san mateo','santa barbara','santa clara','santa cruz','shasta','sierra','siskiyou','solano','sonoma','stanislaus','sutter','tehama','trinity','tulare','tuolumne','ventura','yolo','yuba'];
  function value(field) { if (field && typeof field === 'object' && 'value' in field) return String(field.value || ''); return String(field || ''); }
  function context(extracted) {
    extracted = extracted || {};
    var jurisdiction = value(extracted.jurisdiction);
    var court = [value(extracted.courtOrAgency), value(extracted.courtDivision)].join(' ');
    var procedure = [value(extracted.procedureType), value(extracted.filingMethod), value(extracted.eligibilityNotes)].join(' ');
    var violation = [value(extracted.violationCode), value(extracted.violationDescription)].join(' ');
    var documentType = value(extracted.documentType || extracted.scanAssessment && extracted.scanAssessment.documentType || extracted.scanMeta && extracted.scanMeta.documentType);
    var jurisdictionText = (jurisdiction + ' ' + court).toLowerCase();
    var california = /\bcalifornia\b/i.test(jurisdiction) || /\bstate of california\b/i.test(court) || (/\bsuperior court\b/i.test(court) && CALIFORNIA_COUNTIES.some(function (county) { return jurisdictionText.indexOf(county) >= 0; }));
    var traffic = /traffic|citation|vehicle code|speed|red light|stop sign|moving violation/i.test(documentType + ' ' + procedure + ' ' + violation);
    var explicitWrittenDeclaration = /trial by written declaration|written declaration|\btbwd\b|tr-205|mycitations|online trial|online declaration/i.test(procedure);
    return { california: california, traffic: traffic, explicitWrittenDeclaration: explicitWrittenDeclaration };
  }
  window.UTTDScanOfferPolicy = { context: context };
  function install() {
    var result = document.getElementById('reviewPanel');
    if (!result || result.__uttPayInstalled) return;
    result.__uttPayInstalled = true;
    var offer = null;
    function removeOffer() { if (offer) offer.remove(); offer = null; }
    function openIntake() {
      var service = document.getElementById('f_service');
      var claim = document.getElementById('claimCta');
      var claimStep = document.getElementById('claimStep');
      if (service) service.value = '199';
      if (claim) claim.click();
      if (claimStep) claimStep.scrollIntoView({ behavior: 'smooth', block: 'center' });
      window.setTimeout(function () { var firstName = document.getElementById('c_firstname'); if (firstName) firstName.focus(); }, 0);
    }
    function render() {
      if (result.style.display === 'none') { removeOffer(); return; }
      var scan = window.__lastExtracted || {};
      if (scan.scanMeta && scan.scanMeta.preflightRejected === true) { removeOffer(); return; }
      var scanContext = context(scan);
      var tbd = scanContext.california && scanContext.traffic;
      removeOffer();
      offer = document.createElement('section');
      offer.id = 'scanPayOffer';
      offer.className = 'scan-pay-offer' + (tbd ? ' scan-pay-offer-tbd' : '');
      offer.setAttribute('aria-labelledby', 'scanPayTitle');
      offer.innerHTML = '<div class="scan-pay-copy"><p class="scan-pay-kicker">' + (tbd ? 'Potential TBD path detected' : 'Next step') + '</p><h3 id="scanPayTitle">' + (tbd ? 'Start your $199 TBD review' : 'Ready to start your case?') + '</h3><p>' + (tbd ? 'Your scan contains California traffic-ticket signals that can fit a Trial by Written Declaration workflow. Eligibility is court-specific, so we verify the citation and court before any filing step.' : 'Move from the free scan into the Standard Ticket service. Your submitted details are reviewed before anything is filed, and outcomes are never guaranteed.') + '</p>' + (tbd ? '<a class="scan-pay-link" href="/bot-courthouse?path=tbd">See the TBD workflow</a>' : '') + '</div><div class="scan-pay-action"><span class="scan-pay-price"><strong>$199</strong><small>' + (tbd ? 'TBD review' : 'Standard ticket') + '</small></span><button type="button" class="btn btn-amber scan-pay-button">Pay now <span aria-hidden="true">•</span> $199 <span aria-hidden="true">•</span> ' + (tbd ? 'Start TBD review' : 'Start my case') + ' <span aria-hidden="true">→</span></button><small class="scan-pay-legal">Document preparation and case tracking. Not legal advice. No court outcome is guaranteed.</small></div>';
      offer.querySelector('.scan-pay-button').addEventListener('click', openIntake);
      result.insertAdjacentElement('afterend', offer);
    }
    new MutationObserver(render).observe(result, { attributes: true, attributeFilter: ['style'] });
    render();
    window.UTTDScanOffer = { context: context, refresh: render };
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install); else install();
}());
