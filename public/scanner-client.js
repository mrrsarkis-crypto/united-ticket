(function () {
  'use strict';

  if (window.__UTTD_SCANNER_CLIENT__) return;
  window.__UTTD_SCANNER_CLIENT__ = true;

  const extractionPath = '/api/assistant/extract';
  const readTimeout = 55000;
  const validTypes = new Set(['auto', 'ticket', 'license', 'notice']);
  const fetchWithPreprocessing = window.fetch.bind(window);

  function normalizeType(type) {
    const value = String(type || '').toLowerCase();
    return validTypes.has(value) ? value : 'auto';
  }

  function isScannerRequest(input) {
    try {
      const url = new URL(typeof input === 'string' ? input : input.url, window.location.href);
      return url.origin === window.location.origin && url.pathname === extractionPath;
    } catch (_) {
      return false;
    }
  }

  window.fetch = function (input, init) {
    if (!isScannerRequest(input) || typeof init?.body !== 'string') {
      return fetchWithPreprocessing(input, init);
    }

    let body;
    try {
      body = JSON.parse(init.body);
    } catch (_) {
      return fetchWithPreprocessing(input, init);
    }
    if (!body || typeof body.image !== 'string') return fetchWithPreprocessing(input, init);

    window.__lastExtracted = null;
    window.__lastOcrText = '';
    const panel = document.getElementById('scorePanel');
    if (panel) {
      panel.removeAttribute('data-utt-scan-signature');
      panel.style.display = 'none';
    }

    body.docType = normalizeType(body.docType);
    body.source = 'public-scanner';
    return fetchWithPreprocessing(input, { ...init, body: JSON.stringify(body) });
  };

  async function scan(file, requestedType, onProgress) {
    const docType = normalizeType(requestedType);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), readTimeout);
    let response;

    try {
      response = await window.fetch(extractionPath, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        uttScannerPrepared: file.prepared === true,
        body: JSON.stringify({ consent: true, docType, image: file.image, clientQuality: file.quality || undefined }),
      });
    } catch (error) {
      if (/^data:image\//i.test(file.image) && docType === 'ticket' &&
          typeof window.UTTBrowserOCRFallback === 'function') {
        onProgress('The online scan could not finish. Reading the photo on this device.');
        try {
          return await window.UTTBrowserOCRFallback(file.image);
        } catch (_) {
          // The upload stays available for a retake, retry, or manual review.
        }
      }
      throw new Error(error?.name === 'AbortError'
        ? 'The scan took too long. Try a sharper photo or enter the details by hand.'
        : 'The scanner could not connect. Try again or enter the details by hand.');
    } finally {
      clearTimeout(timeout);
    }

    let result;
    try {
      result = await response.json();
    } catch (_) {
      throw new Error('The scanner returned an unreadable response. Try again or enter the details by hand.');
    }
    if (!response.ok || !result?.ok || !result.extracted) {
      const message = typeof result?.error === 'string' ? result.error : 'The scanner could not read this file. Try another photo or enter the details by hand.';
      throw new Error(message);
    }
    return result.extracted;
  }

  window.UTTDScannerClient = { scan };
})();
