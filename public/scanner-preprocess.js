(function () {
  'use strict';

  if (window.__UTTD_SCANNER_PREPROCESS__) return;
  window.__UTTD_SCANNER_PREPROCESS__ = true;

  var nativeFetch = window.fetch.bind(window);
  var MAX_DIMENSION = 2600;
  var TARGET_BYTES = 1300000;

  function isScannerRequest(input) {
    try {
      var url = typeof input === 'string' ? input : input && input.url;
      return !!url && new URL(url, window.location.href).pathname === '/api/assistant/extract';
    } catch (_) {
      return false;
    }
  }

  function dataUrlBytes(dataUrl) {
    var comma = String(dataUrl || '').indexOf(',');
    if (comma < 0) return 0;
    var b64 = String(dataUrl).slice(comma + 1).replace(/\s+/g, '');
    var padding = b64.endsWith('==') ? 2 : (b64.endsWith('=') ? 1 : 0);
    return Math.max(0, Math.floor((b64.length * 3) / 4) - padding);
  }

  function blobToDataUrl(blob) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () { resolve(reader.result); };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }

  function loadImage(dataUrl) {
    return new Promise(function (resolve, reject) {
      var image = new Image();
      image.onload = function () { resolve(image); };
      image.onerror = reject;
      image.src = dataUrl;
    });
  }

  function loadHeicConverter() {
    if (window.heic2any) return Promise.resolve(window.heic2any);
    if (!window.__uttPreprocessHeicPromise) {
      window.__uttPreprocessHeicPromise = new Promise(function (resolve, reject) {
        var script = document.createElement('script');
        script.src = 'https://cdnjs.cloudflare.com/ajax/libs/heic2any/0.0.4/heic2any.min.js';
        script.async = true;
        script.onload = function () {
          window.heic2any ? resolve(window.heic2any) : reject(new Error('HEIC converter did not initialize'));
        };
        script.onerror = function () { reject(new Error('HEIC converter failed to load')); };
        document.head.appendChild(script);
      });
    }
    return window.__uttPreprocessHeicPromise;
  }

  async function convertHeic(dataUrl) {
    var lower = String(dataUrl || '').slice(0, 48).toLowerCase();
    if (lower.indexOf('image/heic') < 0 && lower.indexOf('image/heif') < 0) return dataUrl;

    var response = await nativeFetch(dataUrl);
    var sourceBlob = await response.blob();
    var converter = await loadHeicConverter();
    var converted = await converter({ blob: sourceBlob, toType: 'image/jpeg', quality: 0.94 });
    if (Array.isArray(converted)) converted = converted[0];
    return blobToDataUrl(converted);
  }

  function measureImage(image) {
    var width = image.naturalWidth || image.width || 0;
    var height = image.naturalHeight || image.height || 0;
    if (!width || !height) return null;

    var scale = Math.min(1, 256 / Math.max(width, height));
    var sampleWidth = Math.max(2, Math.round(width * scale));
    var sampleHeight = Math.max(2, Math.round(height * scale));
    var canvas = document.createElement('canvas');
    canvas.width = sampleWidth;
    canvas.height = sampleHeight;
    var ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(image, 0, 0, sampleWidth, sampleHeight);

    var pixels;
    try { pixels = ctx.getImageData(0, 0, sampleWidth, sampleHeight).data; }
    catch (_) { return null; }

    var gray = new Float32Array(sampleWidth * sampleHeight);
    var sum = 0;
    var sumSquares = 0;
    for (var i = 0; i < gray.length; i++) {
      var p = i * 4;
      var value = 0.299 * pixels[p] + 0.587 * pixels[p + 1] + 0.114 * pixels[p + 2];
      gray[i] = value;
      sum += value;
      sumSquares += value * value;
    }

    var brightness = sum / gray.length;
    var variance = Math.max(0, sumSquares / gray.length - brightness * brightness);
    var contrast = Math.sqrt(variance);
    var edgeSum = 0;
    var edgeCount = 0;
    for (var y = 1; y < sampleHeight; y++) {
      for (var x = 1; x < sampleWidth; x++) {
        var index = y * sampleWidth + x;
        edgeSum += Math.abs(gray[index] - gray[index - 1]);
        edgeSum += Math.abs(gray[index] - gray[index - sampleWidth]);
        edgeCount += 2;
      }
    }
    var sharpness = edgeCount ? edgeSum / edgeCount : 0;

    var largest = Math.max(width, height);
    var smallest = Math.min(width, height);
    var warnings = [];
    if (largest < 1000 || smallest < 500) warnings.push('low_resolution');
    if (brightness < 35) warnings.push('too_dark');
    if (brightness > 245) warnings.push('too_bright');
    if (contrast < 18) warnings.push('low_contrast');
    if (sharpness < 4.2) warnings.push('possible_blur');

    var hardReject = largest < 500 || smallest < 250 || brightness < 12 || brightness > 253 || contrast < 6;
    var grade = hardReject ? 'poor' : (warnings.length >= 2 ? 'fair' : 'good');

    return {
      width: width,
      height: height,
      brightness: Math.round(brightness),
      contrast: Math.round(contrast * 10) / 10,
      sharpness: Math.round(sharpness * 10) / 10,
      grade: grade,
      hardReject: hardReject,
      warnings: warnings.slice(0, 5)
    };
  }

  async function preprocessImage(dataUrl, existingQuality) {
    if (typeof dataUrl !== 'string' || dataUrl.indexOf('data:') !== 0) {
      return { image: dataUrl, quality: existingQuality || null };
    }

    var prefix = dataUrl.slice(0, 48).toLowerCase();
    if (prefix.indexOf('application/pdf') >= 0) {
      return { image: dataUrl, quality: existingQuality || null };
    }

    dataUrl = await convertHeic(dataUrl);
    if (dataUrl.indexOf('data:image/') !== 0) {
      return { image: dataUrl, quality: existingQuality || null };
    }

    var image = await loadImage(dataUrl);
    var before = measureImage(image);
    if (!before) return { image: dataUrl, quality: existingQuality || null };

    var needsResize = Math.max(before.width, before.height) > MAX_DIMENSION || dataUrlBytes(dataUrl) > TARGET_BYTES;
    var needsTone = before.warnings.indexOf('too_dark') >= 0 ||
      before.warnings.indexOf('too_bright') >= 0 ||
      before.warnings.indexOf('low_contrast') >= 0;

    if (!needsResize && !needsTone) {
      return { image: dataUrl, quality: before };
    }

    var scale = Math.min(1, MAX_DIMENSION / Math.max(before.width, before.height));
    var canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(before.width * scale));
    canvas.height = Math.max(1, Math.round(before.height * scale));
    var ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) return { image: dataUrl, quality: before };

    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    if (typeof ctx.filter === 'string' && needsTone) {
      var contrastBoost = before.contrast < 18 ? 1.22 : 1.12;
      var brightnessBoost = before.brightness < 55 ? 1.08 : (before.brightness > 230 ? 0.96 : 1);
      ctx.filter = 'contrast(' + contrastBoost + ') brightness(' + brightnessBoost + ')';
    }

    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    ctx.filter = 'none';

    var enhanced = canvas.toDataURL('image/jpeg', 0.94);
    if (!enhanced) return { image: dataUrl, quality: before };

    var finalImage = await loadImage(enhanced);
    var after = measureImage(finalImage) || before;

    return { image: enhanced, quality: after };
  }

  window.fetch = async function (input, init) {
    if (!isScannerRequest(input)) return nativeFetch(input, init);

    var requestInit = Object.assign({}, init || {});
    if (typeof requestInit.body !== 'string') return nativeFetch(input, requestInit);

    try {
      var body = JSON.parse(requestInit.body);
      if (!body || typeof body !== 'object' || typeof body.image !== 'string') {
        return nativeFetch(input, requestInit);
      }

      var result = await preprocessImage(body.image, body.clientQuality);
      body.image = result.image;
      if (result.quality) body.clientQuality = result.quality;
      requestInit.body = JSON.stringify(body);
    } catch (error) {
      console.warn('scanner preprocessing skipped', error && error.message || error);
    }

    return nativeFetch(input, requestInit);
  };
})();