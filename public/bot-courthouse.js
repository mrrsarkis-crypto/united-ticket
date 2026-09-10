/* Bot Courthouse — client logic + $199 TBD checkout funnel. */
(function () {
  'use strict';

  var DATA_URL = '/data/ca-counties.json';
  var SELFHELP = 'https://selfhelp.courts.ca.gov/traffic';
  var CASES_API = '/api/cases';

  var counties = [];
  var selectedCounty = null;
  var selectedPath = null;
  var pendingPath = null;
  var offerViewed = false;

  var els = {};

  function $(id) { return document.getElementById(id); }

  function qsParam(name) {
    try {
      return new URLSearchParams(window.location.search).get(name);
    } catch (e) {
      return null;
    }
  }

  function track(eventName, data) {
    try {
      if (typeof console !== 'undefined' && console.log) {
        console.log('[bc]', eventName, data || {});
      }
    } catch (e) { /* no-op */ }
    try {
      if (window.clarity && typeof window.clarity === 'function') {
        window.clarity('event', eventName);
      }
    } catch (e2) { /* no-op */ }
  }

  function setStep(n) {
    var items = document.querySelectorAll('.bc-steps li');
    items.forEach(function (li, i) {
      var step = i + 1;
      li.classList.toggle('is-active', step === n);
      li.classList.toggle('is-done', step < n);
    });
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function showSticky(on) {
    if (!els.stickyBar) return;
    if (on) {
      els.stickyBar.hidden = false;
      els.stickyBar.classList.add('is-visible');
      document.body.classList.add('bc-has-sticky');
    } else {
      els.stickyBar.hidden = true;
      els.stickyBar.classList.remove('is-visible');
      document.body.classList.remove('bc-has-sticky');
    }
  }

  function hideOfferCheckout() {
    if (els.offerPanel) {
      els.offerPanel.style.display = 'none';
      els.offerPanel.hidden = true;
    }
    if (els.checkoutPanel) {
      els.checkoutPanel.style.display = 'none';
      els.checkoutPanel.hidden = true;
    }
    showSticky(false);
  }

  function showOfferPanel() {
    if (!els.offerPanel) return;
    els.offerPanel.hidden = false;
    els.offerPanel.style.display = 'block';
    if (!offerViewed) {
      offerViewed = true;
      track('bc_tbd_offer_view', { county: selectedCounty && selectedCounty.slug, path: selectedPath });
    }
    showSticky(!!selectedCounty && !!selectedPath);
    prefillCourt();
  }

  function prefillCourt() {
    if (!els.court) return;
    if (selectedCounty && selectedCounty.courtName) {
      els.court.value = selectedCounty.courtName;
    } else {
      els.court.value = '';
    }
  }

  function openCheckout(from) {
    track('bc_tbd_cta_click', { from: from || 'cta', path: selectedPath, county: selectedCounty && selectedCounty.slug });
    showOfferPanel();
    if (els.checkoutPanel) {
      els.checkoutPanel.hidden = false;
      els.checkoutPanel.style.display = 'block';
    }
    prefillCourt();
    setTimeout(function () {
      if (els.checkoutPanel) {
        els.checkoutPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
      if (els.firstName) els.firstName.focus();
    }, 40);
  }

  function renderCounties(list) {
    var grid = els.countyGrid;
    if (!list.length) {
      grid.innerHTML = '';
      els.noMatch.style.display = 'block';
      return;
    }
    els.noMatch.style.display = 'none';
    grid.innerHTML = list.map(function (c) {
      var sel = selectedCounty && selectedCounty.slug === c.slug ? ' is-selected' : '';
      return '<button type="button" class="bc-county-btn' + sel + '" data-slug="' + escapeHtml(c.slug) + '" aria-pressed="' + (sel ? 'true' : 'false') + '">' +
        escapeHtml(c.name) + '</button>';
    }).join('');
  }

  function selectCounty(county, pushUrl) {
    selectedCounty = county;
    selectedPath = null;
    offerViewed = false;
    renderCounties(filterCounties(els.filter.value));
    els.selectedBar.classList.add('is-visible');
    els.selectedName.textContent = county.name + ' County';
    els.pathPanel.style.display = 'block';
    els.guidancePanel.style.display = 'none';
    els.draftPanel.classList.remove('is-visible');
    els.finalPanel.style.display = 'none';
    hideOfferCheckout();
    setStep(2);
    prefillCourt();

    if (pushUrl !== false) {
      try {
        var u = new URL(window.location.href);
        u.searchParams.set('county', county.slug);
        u.searchParams.delete('path');
        history.replaceState(null, '', u.pathname + '?' + u.searchParams.toString());
      } catch (e) { /* ignore */ }
    }

    setTimeout(function () {
      if (pendingPath && PATHS[pendingPath]) {
        var pk = pendingPath;
        pendingPath = null;
        selectPath(pk, { scrollToOffer: pk === 'tbd' || pk === 'fight' });
      } else {
        els.pathPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    }, 50);
  }

  function filterCounties(q) {
    q = (q || '').trim().toLowerCase();
    if (!q) return counties.slice();
    return counties.filter(function (c) {
      return c.name.toLowerCase().indexOf(q) > -1 ||
        c.slug.indexOf(q.replace(/\s+/g, '-')) > -1;
    });
  }

  var PATHS = {
    tbd: {
      title: 'Fight by TBD — $199',
      blurb: 'Trial by Written Declaration document prep.',
      html: function (c) {
        return '<h3>Trial by Written Declaration in ' + escapeHtml(c.name) + ' County</h3>' +
          '<ul>' +
          '<li><strong>What TBD is:</strong> California Vehicle Code <strong>§ 40902</strong> lets eligible drivers contest many infractions in writing using Judicial Council form <strong>TR-205</strong>. You usually deposit bail with the request; the court decides on the papers.</li>' +
          '<li><strong>Our $199 Standard Ticket package:</strong> AI scan of your citation, a prefilled TR-205 draft, California Certified Paralegal review, attorney review before filing, and case tracking. This is <em>document preparation</em> — not a law firm and not legal advice.</li>' +
          '<li><strong>If you lose the TBD:</strong> You generally may request a <strong>trial de novo</strong> (new in-person trial) within about <strong>20 days</strong> of the court’s decision notice — confirm the exact deadline on the decision form.</li>' +
          '<li><strong>Before you pay:</strong> Look up your citation on the county traffic site, note the due date, violation code, and fine. Missing a deadline can lead to a civil assessment or license hold.</li>' +
          '<li>Outcomes are <strong>never guaranteed</strong>. Statewide self-help: <a href="' + SELFHELP + '" target="_blank" rel="noopener">California Courts — Traffic</a>.</li>' +
          '</ul>';
      },
      showDraft: true,
      showOffer: true
    },
    fight: {
      title: 'Fight your ticket (contest)',
      blurb: 'Contest the citation in court or by written declaration.',
      html: function (c) {
        return '<h3>Contesting in ' + escapeHtml(c.name) + ' County</h3>' +
          '<ul>' +
          '<li><strong>Appearance / bail (Rule 4.105 &amp; VC 40519):</strong> For many infractions you can appear without posting bail, or appear by counsel, depending on how you plead. Check your citation and the court site for your county’s current rules.</li>' +
          '<li><strong>Trial by Written Declaration (TBD):</strong> California Vehicle Code <strong>§ 40902</strong> lets eligible drivers contest many infractions in writing using form <strong>TR-205</strong> (and related instructions). You usually deposit bail with the request; the court decides on the papers.</li>' +
          '<li><strong>Fastest paid path on this page:</strong> Our <strong>$199 TBD package</strong> (Standard Ticket) prepares a prefilled TR-205 with paralegal + attorney review and case tracking — see the offer below. Outcomes are never guaranteed.</li>' +
          '<li><strong>If you lose the TBD:</strong> You generally may request a <strong>trial de novo</strong> (new in-person trial) within about <strong>20 days</strong> of the court’s decision notice — confirm the exact deadline on the decision form.</li>' +
          '<li><strong>Before the due date:</strong> Look up your citation on the county traffic site, note the violation code, fine, and any court date. Missing a deadline can lead to a civil assessment or license hold.</li>' +
          '<li>Statewide self-help: <a href="' + SELFHELP + '" target="_blank" rel="noopener">California Courts — Traffic</a>.</li>' +
          '</ul>';
      },
      showDraft: true,
      showOffer: true
    },
    school: {
      title: 'Traffic school',
      blurb: 'Ask whether you can keep a conviction off your public driving record.',
      html: function (c) {
        return '<h3>Traffic school basics — ' + escapeHtml(c.name) + '</h3>' +
          '<ul>' +
          '<li>Many California courts allow eligible drivers with a qualifying infraction to complete traffic school so the conviction is masked on the public DMV record (insurance reporting can still differ).</li>' +
          '<li>Eligibility often depends on: violation type, CDL status, prior school within ~18 months, and court policy. The court — not a school vendor — grants permission.</li>' +
          '<li>Typical path: plead guilty/no contest (or be found guilty), pay the fine + school fee, complete an approved course by the deadline, and file the completion certificate as directed.</li>' +
          '<li>Confirm eligibility and deadlines on the <a href="' + escapeHtml(c.trafficUrl) + '" target="_blank" rel="noopener">' + escapeHtml(c.name) + ' traffic page</a> and at <a href="' + SELFHELP + '" target="_blank" rel="noopener">selfhelp.courts.ca.gov/traffic</a>.</li>' +
          '</ul>';
      },
      showDraft: false,
      showOffer: false
    },
    fixit: {
      title: 'Fix-it ticket',
      blurb: 'Correctable equipment / registration issues.',
      html: function (c) {
        return '<h3>Fix-it (correctable) citations — ' + escapeHtml(c.name) + '</h3>' +
          '<ul>' +
          '<li>If your citation is marked correctable (often called a “fix-it”), you usually must repair the issue, get proof signed by an authorized person (often law enforcement or an authorized inspection), and show that proof to the court by the due date.</li>' +
          '<li>Many courts dismiss the violation after proof of correction and payment of a small administrative fee — but policies and fees vary by county and by the exact Vehicle Code section.</li>' +
          '<li>Do not ignore the due date even if you fixed the car. Bring or mail proof as the court instructs, or use any online portal listed on the county site.</li>' +
          '<li>Official county traffic info: <a href="' + escapeHtml(c.trafficUrl) + '" target="_blank" rel="noopener">' + escapeHtml(c.courtName) + '</a>. Statewide: <a href="' + SELFHELP + '" target="_blank" rel="noopener">CA Courts Self-Help — Traffic</a>.</li>' +
          '</ul>';
      },
      showDraft: false,
      showOffer: false
    },
    afford: {
      title: "Can't afford the fine",
      blurb: 'Ability-to-pay and payment options.',
      html: function (c) {
        return '<h3>Inability to pay — ' + escapeHtml(c.name) + '</h3>' +
          '<ul>' +
          '<li>California courts may consider your ability to pay for many traffic fines. Ask the court about an <strong>ability-to-pay determination</strong>, installment plan, community service, or reduced fine — options differ by county.</li>' +
          '<li>Contact the court <em>before</em> the due date when possible. Ignoring a fine can lead to civil assessments, collections, or DMV holds.</li>' +
          '<li>Bring pay stubs, benefits letters, or other proof of income/hardship if the court asks for documentation.</li>' +
          '<li>Start with the county traffic page and <a href="' + SELFHELP + '" target="_blank" rel="noopener">selfhelp.courts.ca.gov/traffic</a> (look for ability-to-pay / traffic fine help).</li>' +
          '</ul>';
      },
      showDraft: false,
      showOffer: false
    },
    explain: {
      title: 'Explain my options',
      blurb: 'Plain-language overview of common paths.',
      html: function (c) {
        return '<h3>Common options in California — ' + escapeHtml(c.name) + '</h3>' +
          '<ul>' +
          '<li><strong>Pay the fine:</strong> Usually a guilty/no-contest plea; may add a point unless traffic school applies.</li>' +
          '<li><strong>Traffic school:</strong> If eligible, can mask the conviction on the public record after you complete the course and pay fees.</li>' +
          '<li><strong>Contest:</strong> Appear in court, or try <strong>Trial by Written Declaration</strong> (VC 40902 / TR-205). If you lose TBD, a <strong>trial de novo</strong> request is often due within ~20 days of the decision. Our paid <strong>$199 TBD package</strong> is available on this page when you choose Fight by TBD or Fight ticket.</li>' +
          '<li><strong>Fix-it:</strong> Correct the defect, show proof, and follow the court’s dismissal process.</li>' +
          '<li><strong>Can’t afford:</strong> Ask about ability-to-pay, payment plans, or community service.</li>' +
          '<li><strong>Rule 4.105 / VC 40519:</strong> Appearance and bail rules for infractions — read your notice and the court site carefully.</li>' +
          '<li>Courts never cold-text you demanding payment. Use only official court sites and phone numbers from <a href="' + escapeHtml(c.trafficUrl) + '" target="_blank" rel="noopener">your county</a> or <a href="' + SELFHELP + '" target="_blank" rel="noopener">CA Courts Self-Help</a>.</li>' +
          '</ul>';
      },
      showDraft: true,
      showOffer: false
    }
  };

  function selectPath(key, opts) {
    if (!selectedCounty) return;
    opts = opts || {};
    selectedPath = key;
    var path = PATHS[key];
    if (!path) return;

    document.querySelectorAll('.bc-path-btn').forEach(function (btn) {
      var on = btn.getAttribute('data-path') === key;
      btn.classList.toggle('is-selected', on);
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    });

    els.guidanceBody.innerHTML = path.html(selectedCounty);
    els.guidancePanel.style.display = 'block';
    els.guidancePanel.classList.add('is-visible');

    els.officialLinks.innerHTML =
      '<a class="bc-primary" href="' + escapeHtml(selectedCounty.trafficUrl) + '" target="_blank" rel="noopener">Open ' + escapeHtml(selectedCounty.name) + ' traffic site ↗</a>' +
      '<a href="' + SELFHELP + '" target="_blank" rel="noopener">CA Courts Self-Help — Traffic ↗</a>';

    if (path.showDraft) {
      els.draftPanel.classList.add('is-visible');
    } else {
      els.draftPanel.classList.remove('is-visible');
      els.preview.classList.remove('is-visible');
    }

    if (path.showOffer) {
      showOfferPanel();
    } else {
      hideOfferCheckout();
      // sticky only when county+path chosen for conversion paths
      showSticky(false);
    }

    els.finalPanel.style.display = 'block';
    els.backOfficial.href = selectedCounty.trafficUrl;
    els.backOfficial.textContent = 'Back to ' + selectedCounty.name + ' official site';

    try {
      var u = new URL(window.location.href);
      u.searchParams.set('county', selectedCounty.slug);
      u.searchParams.set('path', key);
      history.replaceState(null, '', u.pathname + '?' + u.searchParams.toString());
    } catch (e) { /* ignore */ }

    setStep(3);

    var scrollTarget = path.showOffer && els.offerPanel ? els.offerPanel : els.guidancePanel;
    if (opts.scrollToOffer && els.offerPanel) scrollTarget = els.offerPanel;
    setTimeout(function () {
      scrollTarget.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 50);
  }

  function buildDeclaration() {
    var name = (els.declName.value || '').trim() || '[Your full legal name]';
    var citation = (els.declCite.value || '').trim() || '[Citation / case number]';
    var date = (els.declDate.value || '').trim() || '[Date of violation]';
    var location = (els.declLoc.value || '').trim() || '[Location of stop]';
    var facts = (els.declFacts.value || '').trim() || '[Describe what happened in your own words. Stick to facts you personally observed.]';
    var county = selectedCounty ? selectedCounty.name : '[County]';

    var text =
      'DECLARATION OF ' + name.toUpperCase() + '\n' +
      '(Free rough draft for Trial by Written Declaration — for your review only)\n\n' +
      'I, ' + name + ', declare as follows:\n\n' +
      '1. I am the defendant in the matter of citation/case number ' + citation +
      ' in the Superior Court of California, County of ' + county + '.\n\n' +
      '2. The citation alleges a violation occurring on or about ' + date +
      ' at or near ' + location + '.\n\n' +
      '3. My statement of the facts, based on my personal knowledge:\n' +
      facts + '\n\n' +
      '4. For the reasons stated above, I respectfully request that the Court find me not guilty / dismiss the citation, or grant such other relief as the Court deems just.\n\n' +
      'I declare under penalty of perjury under the laws of the State of California that the foregoing is true and correct.\n\n' +
      'Executed on ______________ at __________________, California.\n\n' +
      '________________________________\n' +
      name + '\n\n' +
      '---\n' +
      'IMPORTANT: This is a free educational rough draft generated locally in your browser. It is not legal advice, not a filed document, and not a substitute for Judicial Council form TR-205 and your court’s instructions. For the $199 TBD package (prefilled TR-205 + reviews + tracking), use Pay $199 on this page. Review every word, attach required forms, and follow official filing rules. Outcomes are never guaranteed.';

    els.previewText.textContent = text;
    els.preview.classList.add('is-visible');
    setStep(4);
    setTimeout(function () {
      els.preview.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 40);
  }

  function setCheckoutStatus(msg, isError) {
    if (!els.checkoutStatus) return;
    els.checkoutStatus.textContent = msg || '';
    els.checkoutStatus.className = 'bc-checkout-status' + (isError ? ' is-error' : (msg ? ' is-info' : ''));
  }

  function submitCheckout(e) {
    if (e) e.preventDefault();
    if (!selectedCounty) {
      setCheckoutStatus('Please select a county first.', true);
      return;
    }

    var firstName = (els.firstName.value || '').trim();
    var lastName = (els.lastName.value || '').trim();
    var email = (els.email.value || '').trim();
    var phone = (els.phone.value || '').trim();
    var citation = (els.citation.value || '').trim();
    var dob = (els.dob.value || '').trim();
    var dl = (els.dl.value || '').trim();
    var court = (els.court.value || '').trim() || (selectedCounty.courtName || '');
    var code = (els.code.value || '').trim();
    var notesExtra = (els.notes.value || '').trim();
    var consent = els.consent && els.consent.checked;

    if (!consent) {
      setCheckoutStatus('Please confirm you understand this is document preparation, not legal advice.', true);
      return;
    }
    if (!firstName || !lastName) {
      setCheckoutStatus('Please enter your first and last name.', true);
      return;
    }
    if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      setCheckoutStatus('A valid email is required.', true);
      return;
    }
    if (!citation) {
      setCheckoutStatus('Citation / case number is required.', true);
      return;
    }
    if (!dob || !dl) {
      setCheckoutStatus("Driver's license number and date of birth are required.", true);
      return;
    }

    var notesParts = [
      'source: bot-courthouse-tbd',
      'county: ' + (selectedCounty.slug || ''),
      'path: ' + (selectedPath || 'tbd')
    ];
    if (notesExtra) notesParts.push(notesExtra);

    var payload = {
      firstName: firstName,
      lastName: lastName,
      email: email,
      phone: phone,
      citation: citation,
      dob: dob,
      dl: dl,
      court: court,
      code: code,
      service: '199',
      notes: notesParts.join(' | ')
    };

    track('bc_tbd_checkout_submit', { county: selectedCounty.slug, path: selectedPath });
    setCheckoutStatus('Creating your secure checkout...');
    if (els.checkoutSubmit) {
      els.checkoutSubmit.disabled = true;
      els.checkoutSubmit.textContent = 'Contacting secure payment...';
    }

    fetch(CASES_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify(payload)
    })
      .then(function (res) {
        return res.json().then(function (data) {
          return { ok: res.ok, status: res.status, data: data || {} };
        }).catch(function () {
          return { ok: res.ok, status: res.status, data: {} };
        });
      })
      .then(function (result) {
        if (!result.ok) {
          throw new Error(result.data.error || ('Could not create checkout (HTTP ' + result.status + ').'));
        }
        if (result.data.url) {
          track('bc_tbd_checkout_redirect', { county: selectedCounty.slug });
          window.location.href = result.data.url;
          return;
        }
        setCheckoutStatus('Case created' + (result.data.trackingCode ? ' (tracking ' + result.data.trackingCode + ')' : '') + ' but payment link is missing.', true);
        if (els.checkoutSubmit) {
          els.checkoutSubmit.disabled = false;
          els.checkoutSubmit.textContent = 'Continue to secure checkout';
        }
      })
      .catch(function (err) {
        setCheckoutStatus('Error: ' + (err && err.message ? err.message : 'Something went wrong'), true);
        if (els.checkoutSubmit) {
          els.checkoutSubmit.disabled = false;
          els.checkoutSubmit.textContent = 'Continue to secure checkout';
        }
      });
  }

  function wireEvents() {
    els.filter.addEventListener('input', function () {
      renderCounties(filterCounties(els.filter.value));
    });

    els.countyGrid.addEventListener('click', function (e) {
      var btn = e.target.closest('.bc-county-btn');
      if (!btn) return;
      var slug = btn.getAttribute('data-slug');
      var c = counties.find(function (x) { return x.slug === slug; });
      if (c) selectCounty(c, true);
    });

    els.changeBtn.addEventListener('click', function () {
      selectedCounty = null;
      selectedPath = null;
      offerViewed = false;
      els.selectedBar.classList.remove('is-visible');
      els.pathPanel.style.display = 'none';
      els.guidancePanel.style.display = 'none';
      els.draftPanel.classList.remove('is-visible');
      els.finalPanel.style.display = 'none';
      hideOfferCheckout();
      document.querySelectorAll('.bc-path-btn').forEach(function (b) {
        b.classList.remove('is-selected');
        b.setAttribute('aria-pressed', 'false');
      });
      renderCounties(filterCounties(els.filter.value));
      setStep(1);
      try {
        var u = new URL(window.location.href);
        u.searchParams.delete('county');
        u.searchParams.delete('path');
        history.replaceState(null, '', u.pathname + (u.searchParams.toString() ? '?' + u.searchParams.toString() : ''));
      } catch (e) { /* ignore */ }
      els.filter.focus();
    });

    document.querySelectorAll('.bc-path-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        selectPath(btn.getAttribute('data-path'));
      });
    });

    els.genDraft.addEventListener('click', function () {
      buildDeclaration();
    });

    els.printDraft.addEventListener('click', function () {
      if (!els.preview.classList.contains('is-visible')) buildDeclaration();
      window.print();
    });

    if (els.payCta) {
      els.payCta.addEventListener('click', function () { openCheckout('offer'); });
    }
    if (els.upsellPay) {
      els.upsellPay.addEventListener('click', function () { openCheckout('draft_upsell'); });
    }
    if (els.finalPay) {
      els.finalPay.addEventListener('click', function () { openCheckout('final'); });
    }
    if (els.stickyPay) {
      els.stickyPay.addEventListener('click', function () { openCheckout('sticky'); });
    }
    if (els.pageCtaPay) {
      els.pageCtaPay.addEventListener('click', function (e) {
        if (selectedCounty && (selectedPath === 'tbd' || selectedPath === 'fight')) {
          e.preventDefault();
          openCheckout('page_cta');
        } else if (selectedCounty) {
          e.preventDefault();
          selectPath('tbd', { scrollToOffer: true });
          setTimeout(function () { openCheckout('page_cta'); }, 80);
        }
        // else: let hash scroll to path panel
      });
    }

    if (els.checkoutForm) {
      els.checkoutForm.addEventListener('submit', submitCheckout);
    }
  }

  function applyPaidThanks() {
    if (qsParam('paid') !== '1') return;
    if (!els.paidThanks) return;
    els.paidThanks.style.display = 'block';
    els.paidThanks.textContent = 'Thanks — if your payment went through, check your email for next steps and your case tracking info. Outcomes are never guaranteed.';
  }

  function applyDeepLink() {
    var slug = (qsParam('county') || '').toLowerCase().trim();
    var pathKey = (qsParam('path') || '').toLowerCase().trim();
    if (pathKey && PATHS[pathKey]) {
      pendingPath = pathKey;
    }
    if (!slug) {
      applyPaidThanks();
      if (pendingPath) {
        setTimeout(function () {
          if (els.pathPanel) els.pathPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }, 80);
      }
      return;
    }
    var c = counties.find(function (x) { return x.slug === slug; });
    if (c) {
      els.filter.value = c.name;
      renderCounties(filterCounties(c.name));
      selectCounty(c, false); // may consume pendingPath
    }
    applyPaidThanks();
  }

  function init() {
    els.filter = $('bcFilter');
    els.countyGrid = $('bcCountyGrid');
    els.noMatch = $('bcNoMatch');
    els.selectedBar = $('bcSelectedBar');
    els.selectedName = $('bcSelectedName');
    els.changeBtn = $('bcChangeCounty');
    els.pathPanel = $('bcPathPanel');
    els.guidancePanel = $('bcGuidancePanel');
    els.guidanceBody = $('bcGuidanceBody');
    els.officialLinks = $('bcOfficialLinks');
    els.offerPanel = $('bcOfferPanel');
    els.checkoutPanel = $('bcCheckoutPanel');
    els.checkoutForm = $('bcCheckoutForm');
    els.checkoutStatus = $('bcCheckoutStatus');
    els.checkoutSubmit = $('bcCheckoutSubmit');
    els.payCta = $('bcPayCta');
    els.upsellPay = $('bcUpsellPay');
    els.finalPay = $('bcFinalPay');
    els.stickyBar = $('bcStickyBar');
    els.stickyPay = $('bcStickyPay');
    els.pageCtaPay = $('bcPageCtaPay');
    els.paidThanks = $('bcPaidThanks');
    els.firstName = $('bcFirstName');
    els.lastName = $('bcLastName');
    els.email = $('bcEmail');
    els.phone = $('bcPhone');
    els.citation = $('bcCitation');
    els.dob = $('bcDob');
    els.dl = $('bcDl');
    els.court = $('bcCourt');
    els.code = $('bcCode');
    els.notes = $('bcNotes');
    els.consent = $('bcConsent');
    els.draftPanel = $('bcDraftPanel');
    els.declName = $('bcDeclName');
    els.declCite = $('bcDeclCite');
    els.declDate = $('bcDeclDate');
    els.declLoc = $('bcDeclLoc');
    els.declFacts = $('bcDeclFacts');
    els.genDraft = $('bcGenDraft');
    els.printDraft = $('bcPrintDraft');
    els.preview = $('bcPreview');
    els.previewText = $('bcPreviewText');
    els.finalPanel = $('bcFinalPanel');
    els.backOfficial = $('bcBackOfficial');

    wireEvents();
    setStep(1);

    fetch(DATA_URL, { credentials: 'same-origin' })
      .then(function (r) {
        if (!r.ok) throw new Error('Failed to load counties');
        return r.json();
      })
      .then(function (data) {
        if (!Array.isArray(data) || data.length !== 58) {
          console.warn('Expected 58 counties, got', data && data.length);
        }
        counties = data.slice().sort(function (a, b) {
          return a.name.localeCompare(b.name);
        });
        renderCounties(counties);
        applyDeepLink();
      })
      .catch(function (err) {
        els.countyGrid.innerHTML = '';
        els.noMatch.style.display = 'block';
        els.noMatch.textContent = 'Could not load county list. Please refresh the page.';
        console.error(err);
      });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
