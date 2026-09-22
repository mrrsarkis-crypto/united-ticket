/* Local OCR resilience layer. Used only when /api/assistant/extract returns a server/provider 502 for an image. */
(() => {
  'use strict';

  const nativeFetch = window.fetch.bind(window);

  function field(value) {
    return { value: value || null, found: Boolean(value), confident: false };
  }

  function buildExtraction(raw) {
    const lines = String(raw || '').split('\n').map((x) => x.trim()).filter(Boolean);
    const findLine = (needle) => lines.find((x) => x.toLowerCase().includes(needle)) || '';
    const courtLine = findLine('superior court') || findLine('municipal court') || findLine('court of') || findLine('county of');
    const citationLine = findLine('citation') || findLine('cite no') || findLine('citation no');
    const caseLine = findLine('case no') || findLine('case number');
    const codeLine = findLine('vehicle code') || findLine('vc ');
    const nameLine = findLine('name:');
    const zipLine = lines.find((x) => /\b[A-Z]{2}\s+\d{5}(?:-\d{4})?\b/i.test(x)) || '';
    const citation = (citationLine.match(/[A-Z0-9-]{4,}$/i) || [])[0] || '';
    const caseNumber = (caseLine.match(/[A-Z0-9-]{4,}$/i) || [])[0] || '';
    const violationCode = (codeLine.match(/\b\d{3,6}\b/) || [])[0] || '';
    const defendantName = nameLine.replace(/^name\s*:\s*/i, '');
    const address = lines.find((x) => /^\d+\s+/.test(x) && /(street|st\.?|avenue|ave\.?|road|rd\.?|boulevard|blvd\.?|drive|dr\.?|way|court|ct\.?|highway|hwy\.?)/i.test(x)) || '';
    const keys = [
      'defendantName','drivingLicenseNumber','drivingLicenseState','dateOfBirth','mailingAddress',
      'citationNumber','caseNumber','violationDate','courtDate','violationCode','violationDescription',
      'courtOrAgency','courtStreetAddress','courtMailingAddress','courtCityStateZip','courtBranchName',
      'officerName','officerId','location','vehicleMake','vehicleModel','vehiclePlate',
      'bailAmount','bailDepositedAmount','dueDate','clerkMailedOrDeliveredDate','jurisdiction','courtDivision',
      'filingMethod','procedureType','eligibilityNotes'
    ];
    const out = {};
    keys.forEach((key) => { out[key] = field(''); });
    out.defendantName = field(defendantName);
    out.citationNumber = field(citation);
    out.caseNumber = field(caseNumber);
    out.violationCode = field(violationCode);
    out.courtOrAgency = field(courtLine);
    out.courtStreetAddress = field(address);
    out.courtMailingAddress = field(address);
    out.courtCityStateZip = field(zipLine);
    out.unknownFields = keys.filter((key) => !out[key].found);
    out.legibility = lines.length > 12 ? 'fair' : 'poor';
    out.scanMeta = {
      engineVersion: 'browser-ocr-fallback',
      scanId: 'browser-' + Date.now().toString(36),
      requestedDocumentType: 'auto',
      documentType: 'ticket',
      mediaType: 'image',
      inputBytes: 0,
      provider: 'browser-ocr',
      providerAttempts: 1,
      durationMs: 0,
      clientQuality: null,
      validationWarningCount: 0,
      requiresHumanVerification: true
    };
    out.nextSteps = [
      { title: 'Local browser OCR fallback', body: 'The cloud AI scanner was temporarily unavailable, so this image was read locally in your browser. Verify every field against the original citation.' },
      { title: 'Check the court block', body: 'Confirm the court name, street address, and city/state/ZIP against the top portion of the original document.' },
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

  window.UTTBrowserOCRFallback = async function(image) {
    const raw = await browserOcr(image);
    if (!raw.trim()) throw new Error('Browser OCR could not read enough text from this image.');
    return buildExtraction(raw);
  };

  async function browserOcr(image) {
    const Tesseract = await loadTesseract();
    const status = document.getElementById('astStatus');
    if (status) { status.textContent = 'AI providers are busy. Reading locally in your browser...'; status.className = 'ast-status'; }
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
      const result = await worker.recognize(image);
      return result.data && result.data.text ? result.data.text : '';
    } finally {
      await worker.terminate();
    }
  }

  window.fetch = async function(input, init) {
    const response = await nativeFetch(input, init);
    try {
      const url = typeof input === 'string' ? input : input && input.url;
      const path = url ? new URL(url, window.location.href).pathname : '';
      if (path !== '/api/assistant/extract' || response.status < 500 || response.status > 599) return response;

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
        const extracted = await window.UTTBrowserOCRFallback(image);
        return new Response(JSON.stringify({ ok: true, extracted }), {
          status: 200,
          headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store, private' }
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
