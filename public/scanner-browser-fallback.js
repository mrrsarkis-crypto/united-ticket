/* Local OCR resilience layer. Runs only when cloud extraction asks for browser fallback. */
(() => {
  'use strict';

  if (window.__UTTD_BROWSER_OCR_FALLBACK__) return;
  window.__UTTD_BROWSER_OCR_FALLBACK__ = true;

  const nativeFetch = window.fetch.bind(window);
  const DATE_RE = /\b(?:0?[1-9]|1[0-2])[\/.,-](?:0?[1-9]|[12]\d|3[01])[\/.,-](?:\d{2}|\d{4})\b/;

  function field(value) {
    const clean = String(value || '').replace(/\s+/g, ' ').trim();
    return { value: clean || null, found: Boolean(clean), confident: false };
  }

  function normalizeDate(value) {
    return String(value || '').replace(/[.,-]/g, '/').replace(/\/+/g, '/').trim();
  }

  function firstDate(text) {
    const match = String(text || '').match(DATE_RE);
    return match ? normalizeDate(match[0]) : '';
  }

  function dateNear(text, labelRe) {
    const source = String(text || '');
    const match = labelRe.exec(source);
    if (!match) return '';
    // Do not borrow a neighboring field's date when this labeled box is blank.
    const remainder = source.slice(match.index + match[0].length).replace(/^[ :#-]+/, '');
    const lines = remainder.split(/\r?\n/);
    const candidate = lines[0].trim() || (lines[1] || '').trim();
    const date = firstDate(candidate);
    if (!date || /[A-Za-z]{3}/.test(candidate.replace(/\bdate\b/ig, '').split(date)[0])) return '';
    return date;
  }
  function likelyCitation(text) {
    const source = String(text || '').toUpperCase();
    // Only labeled identifiers qualify. Repeated words, plates, license numbers
    // and barcode guesses must never become a citation number.
    const match = /\b(?:CITATION|TICKET|NOTICE TO APPEAR)\s*(?:NUMBER|NO\.?|#)\s*[:#-]?\s*([A-Z0-9][A-Z0-9-]{3,19})\b/.exec(source);
    const value = match ? match[1] : '';
    return /\d/.test(value) ? value : '';
  }

  function likelyViolationCode(text) {
    const source = String(text || '');
    const anchor = /(?:code\s*\/\s*section|citation\s+details)/i.exec(source);
    if (!anchor) {
      const labeled = /\b(?:CVC|VC|vehicle\s+code|violation\s+code)\s*[:#-]?\s*(\d{4,6}(?:\([a-z0-9]+\))?)/i.exec(source);
      return labeled ? labeled[1] : '';
    }
    const segment = source.slice(anchor.index + anchor[0].length, anchor.index + 300);
    const matches = [...segment.matchAll(/(?:^|\n)\s*(?:(?:CVC|VC)\s*)?(\d{4,6}(?:\s*\([a-z0-9]+\))?)(?=\s|$)/gi)];
    for (const match of matches) {
      const value = match[1].replace(/\s+/g, '');
      const numeric = Number((value.match(/^\d+/) || [])[0]);
      if (numeric >= 1900 && numeric <= 2099) continue;
      return value;
    }
    return '';
  }
  function lineAfter(lines, labelRe) {
    for (let i = 0; i < lines.length; i++) {
      if (!labelRe.test(lines[i])) continue;
      const same = lines[i].replace(labelRe, '').replace(/^[:\s-]+/, '').trim();
      if (same && same.length > 2) return same;
      if (lines[i + 1]) return lines[i + 1].trim();
    }
    return '';
  }

  function descriptionForCode(text, code) {
    if (!code) return '';
    const lines = String(text || '').split('\n').map((x) => x.trim()).filter(Boolean);
    const line = lines.find((x) => x.includes(code));
    if (!line) return '';
    const after = line.slice(line.indexOf(code) + code.length).replace(/^\s*[-:]+\s*/, '').trim();
    if (!after || !/[A-Za-z]{3}/.test(after)) return '';
    if (/^(speed|radar|lidar|location|approx)/i.test(after)) return '';
    return after.slice(0, 160);
  }

  function buildExtraction(bundle) {
    const raw = String(bundle && bundle.text || '');
    const top = String(bundle && bundle.top || '');
    const violations = String(bundle && bundle.violations || '');
    const lines = raw.split('\n').map((x) => x.trim()).filter(Boolean);
    const findLine = (needle) => lines.find((x) => x.toLowerCase().includes(needle)) || '';
    const courtLine = findLine('superior court') || findLine('police department') ||
      findLine('municipal court') || findLine('court of') || findLine('county of');
    const citation = likelyCitation(top + '\n' + raw);
    const violationCode = likelyViolationCode(violations);
    const dueDate = dateNear(top, /respond\s+to\s+citation\s+before/i) ||
      dateNear(top, /respond[\s\S]{0,40}before/i);
    const violationDate = dateNear(top, /date\s+of\s+violation/i);
    const violationDescription = descriptionForCode(violations, violationCode);
    const defendantName = lineAfter(lines, /^(?:defendant\s+)?name\s*(?:\(first[^)]*\))?\s*:/i);
    const caseLine = findLine('case no') || findLine('case number');
    const caseNumber = (caseLine.match(/[A-Z0-9-]{4,}$/i) || [])[0] || '';
    const zipLine = lines.find((x) => /\b[A-Z]{2}\s+\d{5}(?:-\d{4})?\b/i.test(x)) || '';
    const address = lines.find((x) => /^\d+\s+/.test(x) &&
      /(street|st\.?|avenue|ave\.?|road|rd\.?|boulevard|blvd\.?|drive|dr\.?|way|court|ct\.?|highway|hwy\.?)/i.test(x)) || '';

    const keys = [
      'defendantName','drivingLicenseNumber','drivingLicenseState','dateOfBirth','mailingAddress',
      'citationNumber','caseNumber','violationDate','courtDate','violationCode','violationDescription',
      'courtOrAgency','courtStreetAddress','courtMailingAddress','courtCityStateZip','courtBranchName',
      'officerName','officerId','location','vehicleMake','vehicleModel','vehiclePlate',
      'bailAmount','bailDepositedAmount','dueDate','clerkMailedOrDeliveredDate','jurisdiction',
      'courtDivision','filingMethod','procedureType','eligibilityNotes'
    ];
    const out = {};
    keys.forEach((key) => { out[key] = field(''); });
    out.defendantName = field(defendantName);
    out.citationNumber = field(citation);
    out.caseNumber = field(caseNumber);
    out.violationDate = field(violationDate);
    out.violationCode = field(violationCode);
    out.violationDescription = field(violationDescription);
    out.dueDate = field(dueDate);
    out.courtOrAgency = field(courtLine);
    // Unlabeled addresses may belong to the driver, agency, or court. Leave
    // court address fields empty until the user verifies the original document.

    out.unknownFields = keys.filter((key) => !out[key].found);
    const criticalFound = ['citationNumber','violationCode','violationDate','dueDate']
      .filter((key) => out[key].found).length;
    out.legibility = criticalFound >= 3 ? 'fair' : (raw.length > 250 ? 'fair' : 'poor');
    out.validationWarnings = ['citationNumber','violationCode','violationDate','dueDate']
      .filter((key) => out[key].found)
      .map((key) => ({ field: key, reason: 'browser_ocr_requires_verification' }));

    out.scanMeta = {
      engineVersion: 'browser-ocr-fallback-20260923-2',
      scanId: 'browser-' + Date.now().toString(36),
      requestedDocumentType: 'auto',
      documentType: 'ticket',
      mediaType: 'image',
      inputBytes: 0,
      provider: 'browser-ocr',
      providerAttempts: 1,
      durationMs: 0,
      clientQuality: null,
      validationWarningCount: out.validationWarnings.length,
      requiresHumanVerification: true
    };
    out.nextSteps = [
      { title: 'Local browser OCR fallback', body: 'Cloud AI was temporarily unavailable, so this ticket was read locally in your browser. Verify every captured field against the original citation.' },
      { title: 'Check the response date', body: 'Confirm the response deadline and any court date directly against the original ticket before continuing.' },
      { title: 'Professional review', body: 'A professional review can check the citation and available response options. This is informational document preparation support, not legal advice.' }
    ];
    return out;
  }

  async function loadTesseract() {
    if (window.Tesseract) return window.Tesseract;
    await new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';
      script.async = true;
      script.onload = resolve;
      script.onerror = () => reject(new Error('Browser OCR could not load.'));
      document.head.appendChild(script);
    });
    if (!window.Tesseract) throw new Error('Browser OCR is unavailable.');
    return window.Tesseract;
  }

  function loadImage(dataUrl) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error('Could not prepare the ticket image for local OCR.'));
      image.src = dataUrl;
    });
  }

  function cropImage(image, x0, y0, x1, y1) {
    const sx = Math.max(0, Math.round(image.naturalWidth * x0));
    const sy = Math.max(0, Math.round(image.naturalHeight * y0));
    const sw = Math.max(2, Math.round(image.naturalWidth * (x1 - x0)));
    const sh = Math.max(2, Math.round(image.naturalHeight * (y1 - y0)));
    const scale = Math.min(1.8, Math.max(1.15, 2400 / Math.max(sw, sh)));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(sw * scale);
    canvas.height = Math.round(sh * scale);
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) return '';
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    if (typeof ctx.filter === 'string') ctx.filter = 'grayscale(1) contrast(1.55) brightness(1.04)';
    ctx.drawImage(image, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
    ctx.filter = 'none';
    return canvas.toDataURL('image/jpeg', 0.94);
  }
  async function recognize(worker, source, status, label) {
    if (!source) return '';
    if (status) status.textContent = label;
    const result = await worker.recognize(source);
    return result && result.data && result.data.text ? result.data.text : '';
  }

  async function browserOcr(image) {
    const Tesseract = await loadTesseract();
    const status = document.getElementById('astStatus');
    if (status) {
      status.textContent = 'AI providers are busy. Reading locally in your browser...';
      status.className = 'ast-status';
    }

    const worker = await Tesseract.createWorker('eng', 1, {
      workerPath: 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/worker.min.js',
      corePath: 'https://cdn.jsdelivr.net/npm/tesseract.js-core@5.1.1',
      langPath: 'https://tessdata.projectnaptha.com/4.0.0',
      logger: (m) => {
        if (status && m && m.status === 'recognizing text' && m.progress) {
          status.textContent = 'Reading locally... ' + Math.round(m.progress * 100) + '%';
        }
      }
    });

    try {
      await worker.setParameters({ tessedit_pageseg_mode: '11', preserve_interword_spaces: '1' });
      const full = await recognize(worker, image, status, 'Reading the full ticket locally...');
      let top = '';
      let violations = '';
      try {
        const sourceImage = await loadImage(image);
        const topCrop = cropImage(sourceImage, 0.00, 0.04, 1.00, 0.34);
        const violationCrop = cropImage(sourceImage, 0.00, 0.43, 1.00, 0.69);
        await worker.setParameters({ tessedit_pageseg_mode: '6', preserve_interword_spaces: '1' });
        top = await recognize(worker, topCrop, status, 'Reading dates and citation number locally...');
        violations = await recognize(worker, violationCrop, status, 'Reading the first violation row locally...');
      } catch (error) {
        console.warn('targeted browser OCR skipped', error && error.message || error);
      }
      return { text: full, top, violations };
    } finally {
      await worker.terminate();
    }
  }

  window.UTTBrowserOCRFallback = async function(image) {
    const bundle = await browserOcr(image);
    if (!String(bundle.text || '').trim() && !String(bundle.top || '').trim()) {
      throw new Error('Browser OCR could not read enough text from this image.');
    }
    return buildExtraction(bundle);
  };

  function fieldNeedsHelp(extracted, key) {
    const current = extracted && extracted[key];
    if (!current || !current.value || current.confident !== true) return true;
    const warnings = Array.isArray(extracted.validationWarnings) ? extracted.validationWarnings : [];
    return warnings.some((item) => item && item.field === key);
  }

  async function fallbackContext(response) {
    if (response.status >= 500 && response.status <= 599) return { needed: true, cloud: null };
    if (!response.ok) return { needed: false, cloud: null };
    const contentType = String(response.headers.get('content-type') || '').toLowerCase();
    if (!contentType.includes('application/json')) return { needed: false, cloud: null };
    try {
      const data = await response.clone().json();
      if (data && data.clientOcrFallback === true) return { needed: true, cloud: null };
      const cloud = data && data.extracted;
      if (!cloud) return { needed: false, cloud: null };
      const provider = String(cloud.scanMeta && cloud.scanMeta.provider || '').toLowerCase();
      const degradedProvider = /^(groq|gemini|dashscope)$/.test(provider);
      const weakDates = fieldNeedsHelp(cloud, 'dueDate') || fieldNeedsHelp(cloud, 'violationDate');
      return { needed: degradedProvider && weakDates, cloud };
    } catch (_) {
      return { needed: false, cloud: null };
    }
  }

  function mergeCloudAndLocal(cloud, local) {
    if (!cloud) return local;
    const out = JSON.parse(JSON.stringify(cloud));
    const cloudWarnings = Array.isArray(out.validationWarnings) ? out.validationWarnings : [];
    const localWarnings = [];

    for (const key of ['dueDate', 'violationDate']) {
      const candidate = local && local[key];
      if (candidate && candidate.value && fieldNeedsHelp(out, key)) {
        out[key] = candidate;
        localWarnings.push({ field: key, reason: 'browser_ocr_supplemented_verify' });
      }
    }
    for (const key of ['citationNumber', 'violationCode']) {
      const current = out[key];
      const candidate = local && local[key];
      if ((!current || !current.value) && candidate && candidate.value) {
        out[key] = candidate;
        localWarnings.push({ field: key, reason: 'browser_ocr_supplemented_verify' });
      }
    }

    out.validationWarnings = [...cloudWarnings, ...localWarnings].slice(0, 10);
    out.scanMeta = Object.assign({}, out.scanMeta || {}, {
      browserOcrSupplemented: localWarnings.length > 0,
      requiresHumanVerification: true
    });
    return out;
  }

  window.fetch = async function(input, init) {
    const response = await nativeFetch(input, init);
    try {
      const url = typeof input === 'string' ? input : input && input.url;
      const path = url ? new URL(url, window.location.href).pathname : '';
      if (path !== '/api/assistant/extract') return response;
      const context = await fallbackContext(response);
      if (!context.needed) return response;

      let bodyText = '';
      if (init && typeof init.body === 'string') {
        bodyText = init.body;
      } else if (input && typeof input.clone === 'function') {
        bodyText = await input.clone().text();
      }
      const payload = bodyText ? JSON.parse(bodyText) : null;
      const image = payload && typeof payload.image === 'string' ? payload.image : '';
      if (!image.startsWith('data:image/')) return response;

      try {
        const local = await window.UTTBrowserOCRFallback(image);
        const extracted = mergeCloudAndLocal(context.cloud, local);
        return new Response(JSON.stringify({ ok: true, extracted }), {
          status: 200,
          headers: {
            'Content-Type': 'application/json; charset=utf-8',
            'Cache-Control': 'no-store, private'
          }
        });
      } catch (error) {
        console.warn('browser OCR fallback failed', error);
        return response;
      }
    } catch (error) {
      console.warn('browser OCR fallback skipped', error);
      return response;
    }
  };
})();
