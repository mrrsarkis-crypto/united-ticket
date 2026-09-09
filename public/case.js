(function () {
  'use strict';
  var form = document.getElementById('caseLookup');
  var input = document.getElementById('caseCode');
  var status = document.getElementById('caseStatus');
  var content = document.getElementById('caseContent');
  var codeOut = document.getElementById('caseCodeOut');
  var statusTitle = document.getElementById('caseStatusTitle');
  var pill = document.getElementById('casePill');
  var summary = document.getElementById('caseSummary');
  var progress = document.getElementById('caseProgress');
  var nextTitle = document.getElementById('caseNextTitle');
  var nextText = document.getElementById('caseNextText');
  var action = document.getElementById('caseAction');
  var created = document.getElementById('caseCreated');
  var timeline = document.getElementById('caseTimeline');
  var copy = document.getElementById('copyCode');
  var remember = document.getElementById('rememberCase');
  var forget = document.getElementById('forgetCase');
  var documentUpload = document.getElementById('documentUpload');
  var documentInput = document.getElementById('caseDocument');
  var uploadDocument = document.getElementById('uploadDocument');
  var documentStatus = document.getElementById('documentStatus');
  var documentList = document.getElementById('documentList');
  var documentHelp = document.getElementById('documentHelp');
  var rememberedKey = 'utt_case_code';
  var accessToken = '';
  var currentCode = '';

  var stages = {
    claimed: ['Saved', 'Your scan is saved. Complete the remaining details to move forward.', 18, 'Finish case details', 'Confirm your details and choose a service.', '/'],
    payment_pending: ['Checkout ready', 'Your case is queued and waiting for secure payment before paid preparation begins.', 42, 'Complete checkout', 'Finish secure payment to move your case into review.', '/'],
    payment_complete: ['Payment received', 'Payment is recorded and your case is moving through preparation and professional review.', 60, 'Review your case', 'Keep your phone and email available for case communications.', '/contact'],
    submitted: ['Prepared / submitted', 'Your paperwork has been prepared and marked submitted in the case workflow.', 82, 'Keep your records', 'Watch your email and keep the case documents together.', '/contact'],
    awaiting_court: ['Awaiting court', 'Your paperwork is in the court-response stage. Keep your case reference for any follow-up.', 92, 'Track updates', 'Check this Case Center for the latest status and watch for court communications.', '/contact'],
    decided: ['Decision recorded', 'A court decision has been recorded for this case. Check your case communications for details.', 100, 'Get help', 'Keep your records and contact the team if you need help understanding the next administrative step.', '/contact'],
    payment_error: ['Payment needs attention', 'We could not complete payment for this case yet.', 42, 'Try again', 'Return to secure checkout or contact us for help.', '/assistant'],
  };

  function esc(value) { return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) { return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; }); }
  function getCode() { return String(input.value || '').trim().toUpperCase(); }
  function stageFor(raw) {
    var key = String(raw || '').toLowerCase();
    return stages[key] || ['In progress', 'Your case is active. The latest available status is shown below.', 68, 'Need help?', 'Contact our team with your tracking code for the clearest next step.', '/contact'];
  }

  function renderTimeline(items, current) {
    timeline.innerHTML = '';
    var labels = items && items.length ? items : [current || 'in progress'];
    labels.forEach(function (label, i) {
      var li = document.createElement('li');
      li.className = 'case-timeline-item active';
      li.innerHTML = '<span class="timeline-dot" aria-hidden="true"></span><div><strong>' + esc(pretty(label)) + '</strong><small>Recorded in your case history</small></div>';
      timeline.appendChild(li);
    });
  }
  function pretty(value) {
    return String(value || '').replace(/[_-]+/g, ' ').replace(/\b\w/g, function (m) { return m.toUpperCase(); });
  }

  function renderDocuments(docs) {
    if (!documentList) return;
    documentList.innerHTML = '';
    if (!docs || !docs.length) {
      documentList.innerHTML = '<p class="document-empty">No documents yet. Your case files will appear here as they are added.</p>';
      return;
    }
    docs.forEach(function (doc) {
      var row = document.createElement('div');
      row.className = 'document-row';
      var size = doc.size ? Math.max(1, Math.round(doc.size / 1024)) + ' KB' : '';
      row.innerHTML = '<div><strong>' + esc(doc.name || 'Case document') + '</strong><small>' + esc(size) + ' · ' + esc(doc.source === 'customer' ? 'Uploaded by you' : 'Added to case') + '</small></div><a class="document-download" href="' + esc(doc.downloadPath) + '&token=' + encodeURIComponent(accessToken) + '">Download</a>';
      documentList.appendChild(row);
    });
  }

  async function loadDocuments() {
    if (!accessToken || !currentCode || !documentList) return;
    try {
      var res = await fetch('/api/case-documents?code=' + encodeURIComponent(currentCode) + '&token=' + encodeURIComponent(accessToken), { headers: { 'Accept': 'application/json' } });
      var data = await res.json();
      if (!res.ok) throw new Error(data && data.error || 'Could not load documents');
      renderDocuments(data.documents || []);
    } catch (err) {
      documentList.innerHTML = '<p class="document-empty">Document center is unavailable right now. Your case status is still available above.</p>';
    }
  }

  async function load(code) {
    currentCode = code;
    status.textContent = 'Loading your case…';
    status.className = 'case-status loading';
    try {
      var res = await fetch('/api/cases/' + encodeURIComponent(code), { headers: { 'Accept': 'application/json' } });
      var data = await res.json();
      if (!res.ok) throw new Error(data && data.error || 'Case not found');
      var stage = stageFor(data.status);
      codeOut.textContent = data.trackingCode || code;
      statusTitle.textContent = stage[0];
      pill.textContent = stage[0];
      pill.className = 'case-pill ' + String(data.status || '').toLowerCase().replace(/[^a-z_]/g, '');
      summary.textContent = data.summary || stage[1];
      progress.style.width = stage[2] + '%';
      nextTitle.textContent = stage[3];
      nextText.textContent = stage[4];
      action.href = stage[5];
      created.textContent = data.createdAt ? 'Opened ' + new Date(data.createdAt).toLocaleDateString() : 'Case reference';
      renderTimeline(data.statusHistory, data.status);
      content.hidden = false;
      status.textContent = 'Case loaded securely.';
      status.className = 'case-status ok';
      if (remember && remember.checked) {
        try { localStorage.setItem(rememberedKey, code); } catch (_) {}
      } else {
        try { localStorage.removeItem(rememberedKey); } catch (_) {}
      }
      if (documentUpload) documentUpload.hidden = !accessToken;
      if (!accessToken && documentHelp) documentHelp.textContent = 'Use the secure Case Center link from your confirmation email to access your private document area.';
      loadDocuments();
      try {
        history.replaceState(null, '', '/case?code=' + encodeURIComponent(code));
      } catch (_) {}
    } catch (err) {
      content.hidden = true;
      status.textContent = err.message || 'We could not load that case.';
      status.className = 'case-status error';
    }
  }

  form.addEventListener('submit', function (e) { e.preventDefault(); var code = getCode(); if (!code) { status.textContent = 'Enter your tracking code.'; status.className = 'case-status error'; input.focus(); return; } load(code); });
  copy.addEventListener('click', async function () {
    var value = codeOut.textContent.trim();
    if (!value || value === '—') return;
    try { await navigator.clipboard.writeText(value); copy.textContent = 'Copied'; setTimeout(function () { copy.textContent = 'Copy code'; }, 1400); } catch (_) { copy.textContent = value; }
  });

  if (uploadDocument) uploadDocument.addEventListener('click', async function () {
    if (!accessToken || !currentCode || !documentInput || !documentInput.files.length) {
      if (documentStatus) documentStatus.textContent = 'Choose a PDF, JPG, PNG, or WEBP file first.';
      return;
    }
    var file = documentInput.files[0];
    if (file.size > 10 * 1024 * 1024) {
      documentStatus.textContent = 'Files must be 10 MB or smaller.';
      return;
    }
    documentStatus.textContent = 'Uploading securely…';
    uploadDocument.disabled = true;
    try {
      var formData = new FormData();
      formData.append('file', file);
      var res = await fetch('/api/case-documents?code=' + encodeURIComponent(currentCode) + '&token=' + encodeURIComponent(accessToken), { method: 'POST', body: formData });
      var data = await res.json();
      if (!res.ok) throw new Error(data && data.error || 'Upload failed');
      documentInput.value = '';
      documentStatus.textContent = 'Document uploaded securely.';
      await loadDocuments();
    } catch (err) {
      documentStatus.textContent = err.message || 'Upload failed. Please try again.';
    } finally {
      uploadDocument.disabled = false;
    }
  });
  if (forget) forget.addEventListener('click', function () {
    try {
      localStorage.removeItem(rememberedKey);
      if (currentCode) sessionStorage.removeItem('utt_case_token:' + currentCode.toUpperCase());
    } catch (_) {}
    accessToken = '';
    if (remember) remember.checked = false;
    if (documentUpload) documentUpload.hidden = true;
    status.textContent = 'This browser will no longer remember the case code.';
    status.className = 'case-status ok';
  });

  var params = new URLSearchParams(location.search);
  var urlToken = (params.get('token') || '').trim();
  var initial = (params.get('code') || '').trim();
  if (urlToken) {
    accessToken = urlToken;
    try { sessionStorage.setItem('utt_case_token:' + initial.toUpperCase(), accessToken); } catch (_) {}
  } else if (initial) {
    try { accessToken = sessionStorage.getItem('utt_case_token:' + initial.toUpperCase()) || ''; } catch (_) {}
  }
  if (!initial) {
    try { initial = (localStorage.getItem(rememberedKey) || '').trim(); if (initial && remember) remember.checked = true; } catch (_) {}
    if (initial && !accessToken) {
      try { accessToken = sessionStorage.getItem('utt_case_token:' + initial.toUpperCase()) || ''; } catch (_) {}
    }
  }
  if (initial) { input.value = initial; load(initial.toUpperCase()); }
})();
