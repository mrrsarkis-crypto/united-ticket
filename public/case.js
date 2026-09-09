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

  var stages = {
    claimed: ['Saved', 'Your scan is saved. Complete the details to move forward.', 18, 'Finish case details', 'Confirm your details and choose a service.', '/'],
    payment_pending: ['Checkout ready', 'Your case is waiting for secure payment to begin the paid preparation workflow.', 42, 'Complete checkout', 'Finish secure payment to move your case into review.', '/'],
    paid: ['Payment received', 'Payment is recorded and your case is moving into the preparation and review workflow.', 60, 'Review case', 'Keep your phone and email available for case communications.', '/contact'],
    in_progress: ['In preparation', 'Your case is in the document-preparation workflow and is being reviewed.', 76, 'Contact your team', 'Use your case code whenever you contact us.', '/contact'],
    filed: ['Filed / submitted', 'Your prepared documents have been marked as filed or submitted in the case workflow.', 92, 'Keep your records', 'Watch for court communications and keep your case documents together.', '/contact'],
    completed: ['Completed', 'The workflow for this case is marked complete. Keep your records for reference.', 100, 'View documents', 'Your document center is the place for case files as they become available.', '/contact'],
    payment_error: ['Payment needs attention', 'We could not complete payment for this case yet.', 42, 'Try checkout again', 'Return to the secure checkout flow or contact us for help.', '/assistant'],
  };

  function esc(value) { return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) { return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; }); }
  function getCode() { return String(input.value || '').trim().toUpperCase(); }
  function stageFor(raw) { return stages[String(raw || '').toLowerCase()] || ['In progress', 'Your case is active. The latest available status is shown below.', 68, 'Need help?', 'Contact our team with your tracking code for the clearest next step.', '/contact']; }

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

  async function load(code) {
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
      try { history.replaceState(null, '', '/case?code=' + encodeURIComponent(code)); } catch (_) {}
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

  var params = new URLSearchParams(location.search);
  var initial = (params.get('code') || '').trim();
  if (initial) { input.value = initial; load(initial.toUpperCase()); }
})();
