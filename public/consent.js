/* Consent banner for cookies / advertising (AdSense).
   Stores user choice in localStorage. Loads advertising-related
   AdSense tags only after the user accepts. */
(function () {
  try {
    var KEY = 'utt_consent';
    var choice = null;
    try { choice = localStorage.getItem(KEY); } catch (e) {}

    function store(v) {
      try { localStorage.setItem(KEY, v); } catch (e) {}
    }
    function hide() {
      var b = document.getElementById('uttConsent');
      if (b) b.style.display = 'none';
    }
    function setChoice(v) {
      store(v);
      choice = v;
      hide();
      if (v === 'accepted') { enableAds(); }
      window.dispatchEvent(new Event('utt-consent'));
    }

    function cookieEnabled() {
      function test() {
        document.cookie = 'utt_ck=1;path=/;max-age=60';
        var ok = document.cookie.indexOf('utt_ck=1') !== -1;
        document.cookie = 'utt_ck=0;path=/;max-age=0';
        return ok;
      }
      try { return test(); } catch (e) { return false; }
    }

    window.__utt_consent = {
      choice: choice,
      cookieEnabled: cookieEnabled(),
    };

    function enableAds() {
      // Push any queued ad units created before consent (auto ads + manual).
      try {
        if (window.adsbygoogle) {
          (window.adsbygoogle = window.adsbygoogle || []).push({});
        }
      } catch (e) {}
    }

    if (choice === 'accepted') {
      hide();
      enableAds();
      return;
    }
    if (choice === 'essential') {
      hide();
      return;
    }

    // Show banner
    window.addEventListener('load', function () {
      var b = document.getElementById('uttConsent');
      if (b) { b.style.display = 'block'; }
    });
    document.addEventListener('DOMContentLoaded', function () {
      var el = document.getElementById('uttConsent');
      if (!el || el.dataset.bound) return;
      el.dataset.bound = '1';
      var ok = document.getElementById('uttConsentAccept');
      var dec = document.getElementById('uttConsentDecline');
      if (ok) ok.addEventListener('click', function () { setChoice('accepted'); });
      if (dec) dec.addEventListener('click', function () { setChoice('essential'); });
    });
  } catch (e) {
    // If anything fails, fail open for essential-only; no ads are forced.
  }
})();