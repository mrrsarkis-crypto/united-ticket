(function () {
  'use strict';

  if (window.__UTTD_SCANNER_CLIENT__) return;
  window.__UTTD_SCANNER_CLIENT__ = true;

  var originalFetch = window.fetch.bind(window);
  var MAX_DIMENSION = 2600;
  var JPEG_QUALITY = 0.92;
  var OPTIMIZE_ABOVE_BYTES = 1300000;
  var REQUEST_TIMEOUT_MS = 55000;
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

  window.fetch = async function (input, init) {
    if (!isExtractRequest(input)) return originalFetch(input, init);

    var options = Object.assign({}, init || {});
    try {
      if (typeof options.body === 'string') {
        var payload = JSON.parse(options.body);
        if (payload && typeof payload === 'object') {
          payload.docType = 'ticket';
          payload.source = 'public-scanner';
          if (typeof payload.image === 'string') payload.image = await optimizeImage(payload.image);
          options.body = JSON.stringify(payload);
        }
      }
    } catch (e) {
      console.warn('scanner request preparation skipped', e && e.message || e);
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
