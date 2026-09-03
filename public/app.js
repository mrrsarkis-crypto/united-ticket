(function () {
  'use strict';

  var drop = document.getElementById('drop');
  var fileInput = document.getElementById('fileInput');
  var preview = document.getElementById('preview');
  var statusEl = document.getElementById('status');
  var caseForm = document.getElementById('caseForm');
  var submitBtn = document.getElementById('submitBtn');
  var currentImageDataUrl = null;
  var currentCaseId = null;
  var currentDlDataUrl = null;
  var dlPhotoInput = document.getElementById('f_dlPhoto');
  var dlPhotoNameEl = document.getElementById('dlPhotoName');
  if (dlPhotoInput && dlPhotoNameEl) {
    dlPhotoInput.addEventListener('change', function (e) {
      var file = e.target.files && e.target.files[0];
      if (!file) { currentDlDataUrl = null; dlPhotoNameEl.textContent = ''; return; }
      var reader = new FileReader();
      reader.onload = function (ev) {
        currentDlDataUrl = ev.target.result;
        dlPhotoNameEl.textContent = 'Uploaded: ' + file.name + ' (' + Math.round(file.size / 1024) + ' KB)';
      };
      reader.readAsDataURL(file);
    });
  }

  var navToggle = document.getElementById('navToggle');
  var navLinks = document.getElementById('navLinks');
  if (navToggle && navLinks) {
    navToggle.addEventListener('click', function () {
      var open = navLinks.classList.toggle('open');
      navToggle.classList.toggle('open', open);
      navToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
    navLinks.querySelectorAll('a').forEach(function (a) {
      a.addEventListener('click', function () {
        navLinks.classList.remove('open');
        navToggle.classList.remove('open');
        navToggle.setAttribute('aria-expanded', 'false');
      });
    });
  }

  drop.addEventListener('click', function () { fileInput.click(); });
  drop.addEventListener('dragover', function (e) { e.preventDefault(); drop.classList.add('drag'); });
  drop.addEventListener('dragleave', function () { drop.classList.remove('drag'); });
  drop.addEventListener('drop', function (e) {
    e.preventDefault(); drop.classList.remove('drag');
    if (e.dataTransfer.files.length) handleFile(e.dataTransfer.files[0]);
  });
  fileInput.addEventListener('change', function (e) {
    if (e.target.files.length) handleFile(e.target.files[0]);
  });

  function handleFile(file) {
    // Reject unsupported types early with a clear message.
    var typeOk = /^image\/(png|jpe?g|heic)$/i.test(file.type) || file.type === '';
    if (!typeOk) {
      statusEl.textContent = 'Unsupported file type. Please upload a JPG, PNG, or HEIC image.';
      statusEl.className = 'status';
      return;
    }
    var reader = new FileReader();
    reader.onload = function (e) {
      currentImageDataUrl = e.target.result;
      preview.src = currentImageDataUrl;
      preview.style.display = 'block';
      statusEl.textContent = 'Scanning ticket...';
      statusEl.className = 'status';
      var progress = document.getElementById('progress');
      var progressBar = document.getElementById('progressBar');
      if (progress && progressBar) {
        progress.style.display = 'block';
        progressBar.style.width = '8%';
      }
      Tesseract.recognize(currentImageDataUrl, 'eng', {
        logger: function (m) {
          if (progress && progressBar && m && typeof m.progress === 'number') {
            var pct = Math.round(m.progress * 100);
            progressBar.style.width = pct + '%';
            progress.setAttribute('aria-valuenow', pct);
          }
        }
      }).then(function (result) {
        setTimeout(function () {
          if (progress && progressBar) { progressBar.style.width = '100%'; progress.setAttribute('aria-valuenow', 100); }
          populateFields(result.data.text);
          statusEl.textContent = 'Scan complete. Review and correct the fields below.';
          statusEl.className = 'status ok';
          caseForm.style.display = 'block';
          window.__lastOcrText = result.data.text;
          refreshScore();
        }, 250);
      }).catch(function (err) {
        document.getElementById('f_citation').value = '';
        statusEl.textContent = 'Scan failed: ' + (err && err.message || 'unknown') + '. Fill fields manually below.';
        statusEl.className = 'status';
        caseForm.style.display = 'block';
        window.__lastOcrText = '';
        refreshScore();
      });
    };
    reader.readAsDataURL(file);
  }

  function extract(re, text) {
    var m = text.match(re);
    return m ? m[1].trim() : '';
  }

  function get(name) {
    var el = document.getElementById(name);
    return el ? el.value : '';
  }

  function populateFields(text) {
    document.getElementById('f_citation').value = extract(/citation\s*(?:no|number|#)?[:\s]*([A-Z0-9-]{5,})/i, text);
    document.getElementById('f_date').value = extract(/(?:violation\s*)?date[:\s]*([0-9]{1,2}[\/\-][0-9]{1,2}[\/\-][0-9]{2,4})/i, text);
    document.getElementById('f_court').value = extract(/court[:\s]*([A-Za-z0-9 ,.-]{4,40})/i, text);
    document.getElementById('f_code').value = extract(/(?:vc|section|code)[:\s#]*([0-9]{3,6}(?:\([a-z0-9]+\))?)/i, text);
    document.getElementById('f_bail').value = extract(/(?:bail|fine|amount)[:\s\$]*([0-9,.]{2,10})/i, text);
    var nameMatch = text.match(/name[:\s]*([A-Za-z ,.'-]{3,40})/i);
    if (nameMatch) {
      var parts = nameMatch[1].trim().split(/\s+/);
      document.getElementById('f_firstname').value = parts[0] || '';
      document.getElementById('f_lastname').value = parts.slice(1).join(' ') || '';
    }
  }

  // ---- Defect scoring engine (rules-based, client-side, no API key) ----
  // Produces a defensive "defect score" (0-100) + a High/Medium/Low rank and a
  // list of specific dismissible issues. Explicitly NOT a court-outcome probability.
  function scoreTicket(d) {
    var defects = [];
    var text = (d.ocrText || '').toUpperCase();

    // Citation number present?
    if (!d.citation || !d.citation.trim()) {
      defects.push({ s: 'No citation number captured — may be illegible or missing.', w: 18 });
    }
    // Missing court date
    if (!d.date && !text) {
      defects.push({ s: 'Missing violation / court date — an incomplete date field is a common procedural defect.', w: 14 });
    }
    // Courthouse / city
    if (!d.court || !d.court.trim()) {
      defects.push({ s: 'No court / city captured.', w: 8 });
    }
    // Radar/calibration: look for calibration or certification language on the slip
    if (text && !/(CALIBRAT|CERTIF|TEST DATE|RADAR|LASER|UNIT)/.test(text)) {
      defects.push({ s: 'No radar/laser unit or calibration info visible — unsupported speed evidence is a frequent dismissal trigger.', w: 16 });
    }
    // Officer ID / badge / traffic unit
    if (text && !/(BADGE|ID|OFFICER|UNIT|EMPLOYEE #|SIGNATURE)/.test(text)) {
      defects.push({ s: 'Officer identification or signature block appears blank.', w: 12 });
    }
    // Fine / bail vs. posted amount: flag if bail suspiciously low (common "clearance requested" error)
    var bailNum = parseFloat(String(d.bail || '').replace(/[^0-9.]/g, ''));
    if (!isNaN(bailNum) && bailNum > 0 && bailNum < 50) {
      defects.push({ s: 'Bail/fine amount looks unusually low — may be an undercharged or incorrect penalty.', w: 10 });
    }
    // VC code section present?
    if (d.code && !/^\s*[0-9]/.test(d.code)) {
      defects.push({ s: 'Violation code section looks incomplete or non-numeric — check for a typo.', w: 8 });
    }

    // Compute defect score: start at 100, subtract weights, floor at 5.
    var score = 100;
    defects.forEach(function (df) { score -= df.w; });
    if (score < 5) score = 5;

    var rank;
    if (score >= 75) rank = { label: 'High', cls: 'rank-high' };
    else if (score >= 45) rank = { label: 'Medium', cls: 'rank-med' };
    else rank = { label: 'Low', cls: 'rank-low' };

    return { score: score, rank: rank, defects: defects };
  }

  function renderScore(result, panel) {
    var rankEl = document.getElementById('scoreRank');
    var numEl = document.getElementById('scoreNum');
    var listEl = document.getElementById('scoreList');
    rankEl.textContent = result.rank.label + ' defense potential';
    rankEl.className = 'score-rank ' + result.rank.cls;
    numEl.textContent = result.score + '/100';
    listEl.innerHTML = '';
    var items = result.defects.length ? result.defects : [{ s: 'No clear dismissible defects auto-detected — your case may still have options worth a professional review.', w: 0 }];
    items.forEach(function (df) {
      var li = document.createElement('li');
      li.textContent = df.s;
      listEl.appendChild(li);
    });
    panel.style.display = 'block';
  }

  function collectTicketData() {
    return {
      citation: get('f_citation'), date: get('f_date'), court: get('f_court'),
      code: get('f_code'), bail: get('f_bail'),
      ocrText: window.__lastOcrText || ''
    };
  }

  function refreshScore() {
    if (!window.__scorePanel) window.__scorePanel = document.getElementById('scorePanel');
    if (!window.__scorePanel) return;
    var res = scoreTicket(collectTicketData());
    renderScore(res, window.__scorePanel);
  }

  ['f_citation', 'f_date', 'f_court', 'f_code', 'f_bail'].forEach(function (id) {
    var el = document.getElementById(id);
    if (el) el.addEventListener('input', refreshScore);
  });

  function buildDeclarationDraft(f) {
    var crid = (f.citation || '(citation not detected)').toUpperCase().replace(/\s+/g, ' ');
    return 'TRIAL BY WRITTEN DECLARATION (IN PRO PER — DRAFT FOR YOUR REVIEW)\n' +
      'Case reference: ' + f.trackingCode + '\n\n' +
      'TO THE CLERK OF THE COURT — ' + (f.court || '[COURT NOT DETECTED]') + ':\n\n' +
      'Defendant (in pro per): ' + (f.name || '[YOUR NAME]') + '\n' +
      'Mailing address: ' + (f.address || '[YOUR ADDRESS]') + '\n' +
      'Email: ' + (f.email || '(provided to court separately)') + '\n' +
      'Citation number: ' + crid + '\n' +
      'Violation date: ' + (f.date || '[DATE]') + '\n' +
      'Alleged violation: ' + (f.code || '[CODE SECTION]') + '\n\n' +
      'I am the defendant in this matter and am appearing in pro per. I hereby request trial by\n' +
      'written declaration pursuant to the vehicle code and court rules applicable to this citation.\n\n' +
      'DEFENSE STATEMENT:\n' +
      'I submit the following in defense of the above citation. I contend that the cited facts are\n' +
      'incorrect or that the citation should be dismissed for the following reason(s):\n\n' +
      '[YOUR STATEMENT — describe the facts in your own words. You must write this yourself. This\n' +
      'tool does not advise you on what to say, and you are responsible for the truth of every\n' +
      'statement under penalty of perjury.]\n\n' +
      'I declare under penalty of perjury under the laws of the State of California that the\n' +
      'foregoing is true and correct.\n\n' +
      'Executed on: __ / __ / ____\n' +
      'Citation number: ' + crid + '\n' +
      'Printed name: ' + (f.name || '[YOUR NAME]') + '\n' +
      'Signature: ______________________________\n\n' +
      '---\n' +
      'NOTE: This is a self-help draft. Verify every field and write your own defense statement.\n' +
      'This is not legal advice. Outcomes are not guaranteed. File it yourself with the clerk.';
  }

  caseForm.addEventListener('submit', async function (e) {
    e.preventDefault();
    var f = {
      citation: get('f_citation'), date: get('f_date'), court: get('f_court'),
      code: get('f_code'), bail: get('f_bail'),
      name: (get('f_firstname') + ' ' + get('f_lastname')).trim(),
      email: get('f_email'), address: get('f_address'), phone: get('f_phone'),
      dob: get('f_dob'), dl: get('f_dl'), notes: get('f_notes'), service: get('f_service'),
      dlPhoto: currentDlDataUrl || ''
    };

    // First and last name are both required; then only DL and DOB are strictly
    // required. Citation + court are required only when no ticket photo was
    // provided (no OCR scan to fall back on).
    if (!get('f_firstname') || !get('f_lastname')) {
      statusEl.textContent = 'Please fill in your first and last name.';
      statusEl.className = 'status';
      return;
    }
    if (!f.email) {
      statusEl.textContent = 'Please fill in your email.';
      statusEl.className = 'status';
      return;
    }
    if (!f.dob || !f.dl) {
      statusEl.textContent = 'Driver\'s license number and date of birth are required.';
      statusEl.className = 'status';
      return;
    }
    if (!currentImageDataUrl && (!f.citation || !f.court)) {
      statusEl.textContent = 'Without a ticket photo, please enter your citation number and courthouse/city.';
      statusEl.className = 'status';
      return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = 'Contacting secure payment...';

    try {
      var res = await fetch('/api/cases', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(f)
      });
      var data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Something went wrong');
      if (data.url) {
        window.location.href = data.url; // Stripe Checkout
      } else {
        statusEl.textContent = 'Case created (tracking ' + data.trackingCode + ') but payment link missing.';
        statusEl.className = 'status';
        submitBtn.disabled = false;
        submitBtn.textContent = 'Continue to secure payment';
      }
    } catch (err) {
      statusEl.textContent = 'Error: ' + err.message;
      statusEl.className = 'status';
      submitBtn.disabled = false;
      submitBtn.textContent = 'Continue to secure payment';
    }
  });

  document.getElementById('trackBtn').addEventListener('click', async function () {
    var code = document.getElementById('trackCode').value.trim();
    var out = document.getElementById('trackResult');
    if (!code) { out.innerHTML = '<p class="status">Enter a tracking code.</p>'; return; }
    try {
      var res = await fetch('/api/cases/' + encodeURIComponent(code));
      var data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Not found');
      var pills = (data.statusHistory || []).map(function (s) {
        return '<span class="pill active">' + escapeHtml(s) + '</span>';
      }).join('') || '<span class="pill">' + escapeHtml(data.status) + '</span>';
      out.innerHTML = '<div class="statusline">' + pills + '</div>' +
        '<p class="caseid">' + escapeHtml(data.trackingCode) + ' — ' + escapeHtml(data.status) + '</p>' +
        '<div class="doc">' + escapeHtml(data.summary || 'No summary yet.') + '</div>';
    } catch (err) {
      out.innerHTML = '<p class="status">' + escapeHtml(err.message) + '</p>';
    }
  });

  document.getElementById('downloadBtn').addEventListener('click', function () {
    var blob = new Blob([document.getElementById('docText').textContent], { type: 'text/plain' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = (currentCaseId || 'case') + '.txt';
    a.click();
  });

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  window.__buildDeclaration = buildDeclarationDraft;
  window.__esc = escapeHtml;
})();
