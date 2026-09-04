(function () {
  'use strict';

  var els = {};
  ['stage1', 'stage2', 'stage3', 'astDrop', 'astFile', 'astPreview', 'astConsentBool',
    'astScan', 'astStatus', 'astFields', 'astSteps', 'astContinue', 'astStatus2',
    'astChat', 'astChatForm', 'astChatMsg', 'astChatStatus', 'astApprove',
    'astCheckout', 'astCheckoutStatus']
    .forEach(function (id) { els[id] = document.getElementById(id); });

  var extracted = null;      // parsed JSON from /api/assistant/extract
  var base64Data = null;     // "data:mime;base64,...."
  var sessionId = (function () {
    try {
      var s = sessionStorage.getItem('ast_session');
      if (s) return s;
      s = 'ast-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
      sessionStorage.setItem('ast_session', s);
      return s;
    } catch (e) { return 'ast-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8); }
  })();

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function setStatus(el, msg, isErr) {
    if (!el) return;
    el.textContent = msg || '';
    el.className = 'ast-status' + (isErr ? ' err' : '');
  }

  function show(id) {
    ['stage1', 'stage2', 'stage3'].forEach(function (s) { els[s].style.display = (s === id) ? 'block' : 'none'; });
    window.scrollTo({ top: (els[id] ? els[id].offsetTop - 90 : 0), behavior: 'smooth' });
  }

  // UPLOAD ---------------------------------------------------------------
  els.astDrop.addEventListener('click', function () { els.astFile.click(); });
  els.astDrop.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); els.astFile.click(); }
  });
  els.astDrop.addEventListener('dragover', function (e) { e.preventDefault(); els.astDrop.classList.add('drag'); });
  els.astDrop.addEventListener('dragleave', function () { els.astDrop.classList.remove('drag'); });
  els.astDrop.addEventListener('drop', function (e) {
    e.preventDefault(); els.astDrop.classList.remove('drag');
    if (e.dataTransfer.files.length) handleFile(e.dataTransfer.files[0]);
  });
  els.astFile.addEventListener('change', function (e) {
    if (e.target.files.length) handleFile(e.target.files[0]);
  });

  function handleFile(file) {
    if (!/^image\/(png|jpe?g|heic)$/i.test(file.type) && file.type !== '') {
      setStatus(els.astStatus, 'Unsupported file type. Please upload a JPG, PNG, or HEIC image.', true);
      return;
    }
    var reader = new FileReader();
    reader.onload = function (e) {
      base64Data = e.target.result;
      els.astPreview.src = base64Data;
      els.astPreview.style.display = 'block';
      setStatus(els.astStatus, '');
    };
    reader.readAsDataURL(file);
  }

  // SCAN ----------------------------------------------------------------
  els.astScan.addEventListener('click', async function () {
    if (!base64Data) { setStatus(els.astStatus, 'Please upload a photo of your ticket first.', true); return; }
    // Consent gate: require the explicit AI-consent checkbox.
    if (!els.astConsentBool.checked) {
      setStatus(els.astStatus, 'Please check the consent box so we can send your ticket image to the AI service.', true);
      return;
    }
    setStatus(els.astStatus, 'Reading your ticket and explaining your options...');
    els.astScan.disabled = true;
    try {
      var res = await fetch('/api/assistant/extract', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ consent: true, image: base64Data })
      });
      var data = await res.json();
      if (!res.ok) throw new Error(data.error || 'The scan failed. Please try a clearer photo.');
      extracted = data.extracted || {};
      renderVerify(extracted);
      renderSteps(extracted.nextSteps);
      show('stage2');
      setStatus(els.astStatus, '');
    } catch (err) {
      setStatus(els.astStatus, err.message, true);
    } finally {
      els.astScan.disabled = false;
    }
  });

  // RENDER VERIFICATION FORM -------------------------------------------
  // Only render a curated set of human-meaningful fields in an EDITABLE form.
  function fieldDefs() {
    return [
      { key: 'citationNumber', label: 'Citation number' },
      { key: 'violationCode', label: 'Violation code (e.g. VC 22350)' },
      { key: 'violationDescription', label: 'Violation description' },
      { key: 'violationDate', label: 'Violation date' },
      { key: 'courtOrAgency', label: 'Court / agency' },
      { key: 'dueDate', label: 'Response / court due date' },
      { key: 'location', label: 'Location' },
      { key: 'officerName', label: 'Officer name' },
      { key: 'officerId', label: 'Officer / badge ID' },
      { key: 'vehicleMake', label: 'Vehicle make/model' },
      { key: 'vehiclePlate', label: 'Vehicle plate (state + number)' },
      { key: 'defendantName', label: 'Defendant name (on ticket)' },
      { key: 'bailAmount', label: 'Bail / fine amount' }
    ];
  }

  function valAt(obj, key) {
    if (!obj || !obj[key]) return '';
    var v = obj[key];
    // Values come as { value, found, confident }
    return (v && typeof v === 'object') ? String(v.value == null ? '' : v.value) : String(v);
  }

  function renderVerify(obj) {
    var html = '<div class="ast-fieldrow"><label>Violation code (display)</label><input type="text" value="' + esc(valAt(obj, 'violationCode')) + '" data-k="violationCode"></div>';
    var items = fieldDefs().filter(function (f) { return f.key !== 'violationCode'; });
    items.forEach(function (f) {
      var v = valAt(obj, f.key);
      html += '<div class="ast-fieldrow"><label>' + esc(f.label) + '</label><input type="text" value="' + esc(v) + '" data-k="' + f.key + '" placeholder="' + (v ? '' : 'Not detected — enter manually') + '"></div>';
    });
    els.astFields.innerHTML = html;

    var leg = (obj.legibility || 'fair');
    var note = 'The assistant rated this image\'s legibility as <strong>' + esc(leg) + '</strong>. ' +
      (leg === 'good' ? '' : 'Blurry or partial images may miss fields — please correct anything that looks wrong.') +
      ' You must verify the details below before anything is prepared.';
    els.astFields.insertAdjacentHTML('beforeend', '<p class="ast-legibility">' + note + '</p>');
  }

  function collectVerified() {
    var out = {};
    var inputs = els.astFields.querySelectorAll('input[data-k]');
    inputs.forEach(function (inp) { out[inp.getAttribute('data-k')] = inp.value.trim(); });
    return out;
  }

  function renderSteps(steps) {
    if (!Array.isArray(steps) || !steps.length) {
      els.astSteps.innerHTML = '<p class="muted">No specific options could be generated for this image. A professional review of your citation may help identify options.</p>';
      return;
    }
    els.astSteps.innerHTML = steps.map(function (s) {
      return '<div class="ast-step"><strong>' + esc(s.title) + '</strong><p>' + esc(s.body) + '</p></div>';
    }).join('');
  }

  // CONTINUE TO CHAT ------------------------------------------------------
  els.astContinue.addEventListener('click', function () {
    // Persist verified data to our live conversation context so the chat has it.
    if (!extracted) extracted = {};
    extracted._verified = collectVerified();
    // Seed the assistant with the verified basics so it can answer accurately.
    var v = extracted._verified;
    console.info('Verified ticket summary:', v);
    setupChat();
    show('stage3');
  });

  // CHAT ------------------------------------------------------------------
  var pendingVerified = false; // sent with the first chat message to seed the model context

  function setupChat() {
    pendingVerified = (extracted && extracted._verified) ? extracted._verified : null;
    // Greeting that references the verified ticket without overclaiming.
    var v = pendingVerified || {};
    var cite = v.citationNumber || '(citation not detected)';
    addChat('assistant', 'I\'ve noted your verified ticket details (citation ' + (cite || 'unknown') + '). ' +
      'Ask me about your options, deadlines, traffic school, or how a prepared document would work. ' +
      'I can explain and draft a preview, but I never file or send anything — that only happens after you approve and check out.');
  }

  function addChat(who, text) {
    var row = document.createElement('div');
    row.className = 'ast-msg ' + (who === 'user' ? 'user' : 'assistant');
    row.innerHTML = (who === 'user')
      ? '<div class="bubble">' + esc(text) + '</div>'
      : '<div class="bubble">' + renderMsg(text) + '</div>';
    els.astChat.appendChild(row);
    els.astChat.scrollTop = els.astChat.scrollHeight;
  }

  // Basic newline handling for assistant text (model may return \n).
  function renderMsg(text) {
    return esc(text).replace(/\n/g, '<br>');
  }

  els.astChatForm.addEventListener('submit', async function (e) {
    e.preventDefault();
    var msg = els.astChatMsg.value.trim();
    if (!msg) return;
    addChat('user', msg);
    els.astChatMsg.value = '';
    setStatus(els.astChatStatus, 'Thinking...');
    try {
      var body = { sessionId: sessionId, message: msg };
      if (pendingVerified) { body.verified = pendingVerified; pendingVerified = null; }
      var res = await fetch('/api/assistant/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      var data = await res.json();
      if (!res.ok) throw new Error(data.error || 'The assistant could not respond. Please try again.');
      addChat('assistant', data.reply || '(no response)');
      setStatus(els.astChatStatus, '');
    } catch (err) {
      setStatus(els.astChatStatus, err.message, true);
    }
  });

  // APPROVE + CHECKOUT ---------------------------------------------------
  els.astCheckout.addEventListener('click', async function () {
    // Validate contact form first.
    var first = (document.getElementById('c_first').value || '').trim();
    var last = (document.getElementById('c_last').value || '').trim();
    var email = (document.getElementById('c_email').value || '').trim();
    var dl = (document.getElementById('c_dl').value || '').trim();
    var dob = (document.getElementById('c_dob').value || '').trim();
    var phone = (document.getElementById('c_phone').value || '').trim();
    var address = (document.getElementById('c_address').value || '').trim();

    if (!els.astApprove.checked) {
      setStatus(els.astCheckoutStatus, 'Please check the approval box to confirm you verified the details and authorize document preparation.', true);
      return;
    }
    if (!first || !last) { setStatus(els.astCheckoutStatus, 'Please enter your first and last name.', true); return; }
    if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { setStatus(els.astCheckoutStatus, 'A valid email is required.', true); return; }
    if (!dl) { setStatus(els.astCheckoutStatus, 'Your driver\'s license number is required.', true); return; }
    if (!dob) { setStatus(els.astCheckoutStatus, 'Your date of birth is required.', true); return; }

    var v = collectVerified();
    var payload = {
      name: first + ' ' + last,
      email: email,
      court: v.courtOrAgency || v.location || '',
      citation: v.citationNumber || '',
      service: '199',
      dob: dob,
      dl: dl,
      address: address,
      phone: phone,
      dlPhoto: base64Data || '',
      notes: {
        date: v.violationDate || '',
        code: v.violationCode || '',
        bail: v.bailAmount || '',
        address: address,
        phone: phone,
        notes: 'Submitted via AI Ticket Document Assistant. Verified citation summary: ' +
          JSON.stringify(v) + '. Session: ' + sessionId
      }
    };

    setStatus(els.astCheckoutStatus, 'Creating your secure checkout...');
    els.astCheckout.disabled = true;
    try {
      var res = await fetch('/api/cases', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      var data = await res.json();
      if (!res.ok) {
        setStatus(els.astCheckoutStatus, data.error || 'Could not create checkout. Please try again.', true);
        els.astCheckout.disabled = false;
        return;
      }
      if (data.url) window.location.href = data.url; // Stripe Checkout
      else {
        setStatus(els.astCheckoutStatus, 'Case created (tracking ' + (data.trackingCode || '') + ') but the payment link is missing.', true);
        els.astCheckout.disabled = false;
      }
    } catch (err) {
      setStatus(els.astCheckoutStatus, 'Error: ' + err.message, true);
      els.astCheckout.disabled = false;
    }
  });
})();
