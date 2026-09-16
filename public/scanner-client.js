(function () {
  'use strict';

  if (window.__UTTD_SCANNER_CLIENT__) return;
  window.__UTTD_SCANNER_CLIENT__ = true;

  var originalFetch = window.fetch.bind(window);
  var MAX_DIMENSION = 2600;
  var JPEG_QUALITY = 0.92;
  var OPTIMIZE_ABOVE_BYTES = 1300000;
  var REQUEST_TIMEOUT_MS = 55000;
  var QUALITY_SAMPLE_MAX = 256;
  var HEIC2ANY_URL = 'https://cdnjs.cloudflare.com/ajax/libs/heic2any/0.0.4/heic2any.min.js';

  function isExtractRequest(input) {
    try {
      var raw = typeof input === 'string' ? input : input && input.url;
      if (!raw) return false;
      return new URL(raw, window.location.href).pathname === '/api/assistant/extract';
    } catch (e) {
      return false;
    }
  }

  function dataUrlBytes(dataUrl) {
    var comma = String(dataUrl || '').indexOf(',');
    if (comma < 0) return 0;
    var b64 = dataUrl.slice(comma + 1).replace(/\s+/g, '');
    var padding = b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0;
    return Math.max(0, Math.floor(b64.length * 3 / 4) - padding);
  }

  function blobToDataUrl(blob) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () { resolve(reader.result); };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }

  function loadHeic2Any() {
    if (window.heic2any) return Promise.resolve(window.heic2any);
    if (window.__uttHeicPromise) return window.__uttHeicPromise;
    window.__uttHeicPromise = new Promise(function (resolve, reject) {
      var script = document.createElement('script');
      script.src = HEIC2ANY_URL;
      script.async = true;
      script.onload = function () { resolve(window.heic2any); };
      script.onerror = function () { reject(new Error('HEIC converter failed to load')); };
      document.head.appendChild(script);
    });
    return window.__uttHeicPromise;
  }

  async function convertHeic(dataUrl) {
    var response = await originalFetch(dataUrl);
    var blob = await response.blob();
    var heic2any = await loadHeic2Any();
    var converted = await heic2any({ blob: blob, toType: 'image/jpeg', quality: JPEG_QUALITY });
    if (Array.isArray(converted)) converted = converted[0];
    return blobToDataUrl(converted);
  }

  function resizeImage(dataUrl) {
    return new Promise(function (resolve) {
      var image = new Image();
      image.onload = function () {
        var width = image.naturalWidth || image.width;
        var height = image.naturalHeight || image.height;
        if (!width || !height) return resolve(dataUrl);

        var scale = Math.min(1, MAX_DIMENSION / Math.max(width, height));
        if (scale === 1 && dataUrlBytes(dataUrl) < OPTIMIZE_ABOVE_BYTES) return resolve(dataUrl);

        var canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(width * scale));
        canvas.height = Math.max(1, Math.round(height * scale));
        var ctx = canvas.getContext('2d', { alpha: false });
        if (!ctx) return resolve(dataUrl);
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(image, 0, 0, canvas.width, canvas.height);

        var optimized = canvas.toDataURL('image/jpeg', JPEG_QUALITY);
        resolve(optimized && optimized.length < dataUrl.length ? optimized : dataUrl);
      };
      image.onerror = function () { resolve(dataUrl); };
      image.src = dataUrl;
    });
  }

  function inspectImageQuality(dataUrl) {
    return new Promise(function (resolve) {
      var image = new Image();
      image.onload = function () {
        var width = image.naturalWidth || image.width;
        var height = image.naturalHeight || image.height;
        if (!width || !height) return resolve(null);

        var scale = Math.min(1, QUALITY_SAMPLE_MAX / Math.max(width, height));
        var sw = Math.max(2, Math.round(width * scale));
        var sh = Math.max(2, Math.round(height * scale));
        var canvas = document.createElement('canvas');
        canvas.width = sw;
        canvas.height = sh;
        var ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (!ctx) return resolve(null);
        ctx.drawImage(image, 0, 0, sw, sh);

        var pixels;
        try { pixels = ctx.getImageData(0, 0, sw, sh).data; }
        catch (e) { return resolve(null); }

        var gray = new Float32Array(sw * sh);
        var sum = 0;
        var sumSq = 0;
        var i;
        for (i = 0; i < gray.length; i++) {
          var p = i * 4;
          var g = pixels[p] * 0.299 + pixels[p + 1] * 0.587 + pixels[p + 2] * 0.114;
          gray[i] = g;
          sum += g;
          sumSq += g * g;
        }
        var mean = sum / gray.length;
        var variance = Math.max(0, sumSq / gray.length - mean * mean);
        var contrast = Math.sqrt(variance);
        var edgeSum = 0;
        var edgeCount = 0;
        for (var y = 1; y < sh; y++) {
          for (var x = 1; x < sw; x++) {
            var idx = y * sw + x;
            edgeSum += Math.abs(gray[idx] - gray[idx - 1]);
            edgeSum += Math.abs(gray[idx] - gray[idx - sw]);
            edgeCount += 2;
          }
        }
        var sharpness = edgeCount ? edgeSum / edgeCount : 0;
        var maxSide = Math.max(width, height);
        var minSide = Math.min(width, height);
        var warnings = [];
        if (maxSide < 1000 || minSide < 500) warnings.push('low_resolution');
        if (mean < 35) warnings.push('too_dark');
        if (mean > 245) warnings.push('too_bright');
        if (contrast < 18) warnings.push('low_contrast');
        if (sharpness < 4.2) warnings.push('possible_blur');

        var hardReject = maxSide < 500 || minSide < 250 || mean < 12 || mean > 253 || contrast < 6;
        var grade = hardReject ? 'poor' : warnings.length >= 2 ? 'fair' : 'good';
        resolve({
          width: width,
          height: height,
          brightness: Math.round(mean),
          contrast: Math.round(contrast * 10) / 10,
          sharpness: Math.round(sharpness * 10) / 10,
          grade: grade,
          hardReject: hardReject,
          warnings: warnings.slice(0, 5)
        });
      };
      image.onerror = function () { resolve(null); };
      image.src = dataUrl;
    });
  }

  async function optimizeImage(dataUrl) {
    if (typeof dataUrl !== 'string' || dataUrl.indexOf('data:') !== 0) return dataUrl;
    var lower = dataUrl.slice(0, 40).toLowerCase();
    if (lower.indexOf('application/pdf') >= 0) return dataUrl;
    try {
      if (lower.indexOf('image/heic') >= 0 || lower.indexOf('image/heif') >= 0) {
        dataUrl = await convertHeic(dataUrl);
      }
      if (dataUrl.indexOf('data:image/') === 0) return await resizeImage(dataUrl);
    } catch (e) {
      console.warn('scanner client optimization skipped', e && e.message || e);
    }
    return dataUrl;
  }

  function preflightRejectedResponse(quality) {
    var extracted = {
      legibility: 'poor',
      unknownFields: [],
      validationWarnings: ['The uploaded photo is too weak for dependable automated reading.'],
      scanMeta: {
        engineVersion: 'client-preflight',
        scanId: 'preflight-' + Date.now().toString(36),
        requestedDocumentType: 'auto',
        documentType: 'auto',
        mediaType: 'image',
        inputBytes: 0,
        provider: 'none',
        providerAttempts: 0,
        durationMs: 0,
        clientQuality: quality,
        validationWarningCount: 1,
        preflightRejected: true,
        requiresHumanVerification: true
      },
      nextSteps: [{
        title: 'Retake the photo',
        body: 'Use good light, keep the full document in frame, avoid glare, and move close enough that the printed text is sharp.'
      }]
    };
    return new Response(JSON.stringify({ ok: true, extracted: extracted }), {
      status: 200,
      headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }
    });
  }

  window.fetch = async function (input, init) {
    if (!isExtractRequest(input)) return originalFetch(input, init);

    window.__lastExtracted = null;
    window.__lastOcrText = '';
    var previousPanel = document.getElementById('scorePanel');
    if (previousPanel) {
      previousPanel.removeAttribute('data-utt-scan-signature');
      previousPanel.style.display = 'none';
    }

    var options = Object.assign({}, init || {});
    var preflightQuality = null;
    try {
      if (typeof options.body === 'string') {
        var payload = JSON.parse(options.body);
        if (payload && typeof payload === 'object') {
          payload.docType = ['auto', 'ticket', 'license', 'notice'].indexOf(String(payload.docType || '').toLowerCase()) >= 0
            ? String(payload.docType).toLowerCase()
            : 'auto';
          payload.source = 'public-scanner';
          if (typeof payload.image === 'string') {
            payload.image = await optimizeImage(payload.image);
            if (payload.image.indexOf('data:image/') === 0) {
              payload.clientQuality = await inspectImageQuality(payload.image);
              preflightQuality = payload.clientQuality;
              window.__UTTD_LAST_CLIENT_QUALITY__ = payload.clientQuality;
            }
          }
          options.body = JSON.stringify(payload);
        }
      }
    } catch (e) {
      console.warn('scanner request preparation skipped', e && e.message || e);
    }

    if (preflightQuality && preflightQuality.hardReject) {
      return preflightRejectedResponse(preflightQuality);
    }

    if (options.signal || typeof AbortController === 'undefined') {
      return originalFetch(input, options);
    }

    var controller = new AbortController();
    var timer = setTimeout(function () { controller.abort(); }, REQUEST_TIMEOUT_MS);
    options.signal = controller.signal;
    try {
      return await originalFetch(input, options);
    } finally {
      clearTimeout(timer);
    }
  };
})();
