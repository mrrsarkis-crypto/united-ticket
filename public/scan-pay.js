/* Scanner post-result conversion bridge. Reuses the existing case + Stripe checkout flow. */
(function () {
  'use strict';
  var STYLE_ID = 'utt-scan-pay-style';
  var OFFER_ID = 'utt-scan-pay-offer';
  var inserted = false;
  var CA_COUNTIES = ['alameda','alpine','amador','butte','calaveras','colusa','contra costa','del norte','el dorado','fresno','glenn','humboldt','imperial','inyo','kern','kings','lake','lassen','los angeles','madera','marin','mariposa','mendocino','merced','modoc','mono','monterey','napa','nevada','orange','placer','plumas','riverside','sacramento','san benito','san bernardino','san diego','san francisco','san joaquin','san luis obispo','san mateo','santa barbara','santa clara','santa cruz','shasta','sierra','siskiyou','solano','sonoma','stanislaus','sutter','tehama','trinity','tulare','tuolumne','ventura','yolo','yuba'];
  function styles() {
    if (document.getElementById(STYLE_ID)) return;
    var style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = '\
      .utt-scan-pay{position:relative;margin:0 0 18px;padding:18px;border:1px solid rgba(242,168,0,.62);border-radius:18px;background:linear-gradient(145deg,#fffdf6,#fff6d9);box-shadow:0 14px 34px rgba(0,35,105,.13);overflow:hidden}\n      .utt-scan-pay:before{content:"";position:absolute;left:-35%;right:-35%;top:-70%;height:150%;background:radial-gradient(circle at center,rgba(242,168,0,.16),transparent 55%);pointer-events:none}\n      .utt-scan-pay-head{position:relative;display:flex;align-items:flex-start;justify-content:space-between;gap:14px}\n      .utt-scan-pay-kicker{font-size:10px;font-weight:950;letter-spacing:.15em;color:#9a6900;text-transform:uppercase;margin:0 0 6px}\n      .utt-scan-pay-title{font-size:23px;line-height:1.08;font-weight:950;color:#00266f;margin:0 0 6px;letter-spacing:-.02em}\n      .utt-scan-pay-copy{font-size:12.5px;line-height:1.48;color:#5c6b8f;margin:0;max-width:640px}\n      .utt-scan-pay-price{flex:0 0 auto;text-align:center;min-width:84px;padding:10px 12px;border-radius:12px;background:#0033a0;color:#fff;box-shadow:0 8px 20px rgba(0,51,160,.2)}\n      .utt-scan-pay-price strong{display:block;font-size:22px;line-height:1;color:#ffd76e}\n      .utt-scan-pay-price span{display:block;font-size:9px;letter-spacing:.1em;font-weight:850;margin-top:5px;color:rgba(255,255,255,.78)}\n      .utt-scan-pay-actions{position:relative;display:grid;grid-template-columns:1fr auto;gap:9px;margin-top:14px;align-items:center}\n      .utt-scan-pay-btn{appearance:none;border:1px solid #f2a800;border-radius:11px;padding:13px 16px;background:#f2a800;color:#001d58;font:inherit;font-size:14px;font-weight:950;cursor:pointer;box-shadow:0 8px 22px rgba(242,168,0,.27);transition:transform .15s,box-shadow .15s}\n      .utt-scan-pay-btn:hover{transform:translateY(-1px);box-shadow:0 12px 28px rgba(242,168,0,.34)}\n      .utt-scan-pay-btn:active{transform:translateY(0)}\n      .utt-scan-pay-secondary{font-size:11px;color:#0033a0;font-weight:800;text-decoration:none;padding:10px 6px;white-space:nowrap}\n      .utt-scan-pay-legal{position:relative;margin:10px 0 0;font-size:10.5px;line-height:1.4;color:#7a849d}\n      .utt-scan-pay.is-tbd{background:linear-gradient(145deg,#fffdf6,#fff3c5);border-width:1.5px}\n      .utt-scan-pay.is-tbd .utt-scan-pay-kicker{color:#8d5b00}\n      @media (max-width:620px){.utt-scan-pay-head{display:block}.utt-scan-pay-price{display:inline-block;margin-top:12px;min-width:92px}.utt-scan-pay-actions{grid-template-columns:1fr}.utt-scan-pay-secondary{text-align:center}}\n      @media (prefers-reduced-motion:reduce){.utt-scan-pay-btn{transition:none}}';
    document.head.appendChild(style);
  }
  function valueOf(field) {
    if (!field) return '';
    if (typeof field === 'string') return field.trim();
    return field.value && field.found !== false ? String(field.value).trim() : '';
  }
  function scanContext() {
    var ext = window.__lastExtracted || {};
    var jurisdiction = valueOf(ext.jurisdiction).toLowerCase();
    var court = valueOf(ext.courtOrAgency).toLowerCase();
    var code = valueOf(ext.violationCode).toLowerCase();
    var procedure = valueOf(ext.procedureType).toLowerCase();
    var filing = valueOf(ext.filingMethod).toLowerCase();
    var eligibility = valueOf(ext.eligibilityNotes).toLowerCase();
    var description = valueOf(ext.violationDescription).toLowerCase();
    var combined = [jurisdiction, court, code, procedure, filing, eligibility, description].join(' ');
    var explicitCalifornia = /\bcalifornia\b|\bca\b|state of california/.test(jurisdiction + ' ' + court);
    var countyCourt = /\bsuperior court\b/.test(court) && CA_COUNTIES.some(function (county) {
      return new RegExp('\\b' + county.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&') + '(?: county)?\\b').test(court);
    });
    var california = explicitCalifornia || countyCourt;
    var traffic = /\binfraction\b|traffic|vehicle code|\bvc\s*\d|speeding|stop sign|red light/.test(combined);
    var writtenDeclaration = /trial by written declaration|written declaration|tbwd|tr-205|mycitations|online trial|online declaration/.test(combined);
    return { california: california, traffic: traffic, writtenDeclaration: writtenDeclaration };
  }
  function ensureOffer() {
    if (inserted) return;
    var panel = document.getElementById('scorePanel');
    if (!panel || panel.style.display === 'none') return;
    var wrap = panel.parentNode;
    if (!wrap || document.getElementById(OFFER_ID)) return;
    var ctx = scanContext();
    var tbd = ctx.california && ctx.traffic && (ctx.writtenDeclaration || ctx.traffic);
    var offer = document.createElement('section');
    offer.id = OFFER_ID;
    offer.className = 'utt-scan-pay' + (tbd ? ' is-tbd' : '');
    offer.setAttribute('aria-label', 'Next service option');
    offer.innerHTML = '<div class="utt-scan-pay-head"><div><p class="utt-scan-pay-kicker">' + (tbd ? 'POTENTIAL TBD PATH DETECTED' : 'NEXT STEP') + '</p><h3 class="utt-scan-pay-title">' + (tbd ? 'Start your $199 TBD review' : 'Ready to start your case?') + '</h3><p class="utt-scan-pay-copy">' + (tbd ? 'Your scan contains California traffic-ticket signals that can fit a Trial by Written Declaration workflow. Eligibility is court-specific, so we verify the citation and court before any filing step.' : 'Move from the free scan into the Standard Ticket service. Your submitted details are reviewed before anything is filed, and outcomes are never guaranteed.') + '</p></div><div class="utt-scan-pay-price"><strong>$199</strong><span>' + (tbd ? 'TBD REVIEW' : 'STANDARD TICKET') + '</span></div></div><div class="utt-scan-pay-actions"><button type="button" class="utt-scan-pay-btn" id="uttScanPayBtn">' + (tbd ? 'PAY NOW • $199 • START TBD REVIEW →' : 'PAY NOW • $199 • START MY CASE →') + '</button>' + (tbd ? '<a class="utt-scan-pay-secondary" href="/bot-courthouse?path=tbd">See the TBD workflow</a>' : '') + '</div><p class="utt-scan-pay-legal">Secure checkout follows your existing case flow. This is document preparation and case tracking, not a law firm or court. No court-result promise is made.</p>';
    wrap.insertBefore(offer, panel.nextSibling);
    inserted = true;
    var button = document.getElementById('uttScanPayBtn');
    if (button) button.addEventListener('click', function () {
      var service = document.getElementById('f_service');
      if (service) service.value = '199';
      var claim = document.getElementById('claimCta');
      if (claim) {
        claim.click();
        setTimeout(function () {
          var step = document.getElementById('claimStep');
          if (step) step.scrollIntoView({ behavior: 'smooth', block: 'center' });
          var first = document.getElementById('c_firstname');
          if (first) first.focus();
        }, 80);
      } else {
        var form = document.getElementById('caseForm');
        if (form) form.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    });
  }
  function reset() {
    inserted = false;
    var existing = document.getElementById(OFFER_ID);
    if (existing) existing.remove();
  }
  function watch() {
    var score = document.getElementById('scorePanel');
    if (!score) return;
    var observer = new MutationObserver(function () {
      var visible = score.style.display !== 'none' && score.offsetParent !== null;
      if (visible) ensureOffer(); else reset();
    });
    observer.observe(score, { attributes: true, attributeFilter: ['style', 'class'] });
    ensureOffer();
  }
  function init() { styles(); watch(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
