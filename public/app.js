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
    var reader = new FileReader();
    reader.onload = function (e) {
      currentImageDataUrl = e.target.result;
      preview.src = currentImageDataUrl;
      preview.style.display = 'block';
      statusEl.textContent = 'Scanning ticket...';
      statusEl.className = 'status';
      Tesseract.recognize(currentImageDataUrl, 'eng').then(function (result) {
        populateFields(result.data.text);
        statusEl.textContent = 'Scan complete. Review and correct the fields below.';
        statusEl.className = 'status ok';
        caseForm.style.display = 'block';
      }).catch(function (err) {
        document.getElementById('f_citation').value = '';
        statusEl.textContent = 'Scan failed: ' + (err && err.message || 'unknown') + '. Fill fields manually below.';
        caseForm.style.display = 'block';
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
    document.getElementById('f_name').value = extract(/name[:\s]*([A-Za-z ,.'-]{3,40})/i, text);
  }

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
      'Signature: ______________________________\n' +
      'Printed name: ' + (f.name || '[YOUR NAME]') + '\n\n' +
      '---\n' +
      'NOTE: This is a self-help draft. Verify every field and write your own defense statement.\n' +
      'This is not legal advice. Outcomes are not guaranteed. File it yourself with the clerk.';
  }

  caseForm.addEventListener('submit', async function (e) {
    e.preventDefault();
    var f = {
      citation: get('f_citation'), date: get('f_date'), court: get('f_court'),
      code: get('f_code'), bail: get('f_bail'), name: get('f_name'),
      email: get('f_email'), address: get('f_address'), phone: get('f_phone'),
      notes: get('f_notes'), service: get('f_service')
    };

    if (!f.name || !f.email || !f.court) {
      statusEl.textContent = 'Please fill at least your full legal name, email, and court.';
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
