(function () {
  'use strict';

  if (window.__UTTD_SCANNER_PREPROCESS__) return;
  window.__UTTD_SCANNER_PREPROCESS__ = true;

  var nativeFetch = window.fetch.bind(window);
  // Preserve handwriting detail for ticket OCR. Modern phone photos can stay near
  // native resolution while remaining well below the scanner's 10 MB file limit.
  var MAX_DIMENSION = 4200;
  var MAX_PIXELS = 12000000;
  var TARGET_BYTES = 3000000;

  // Every scanner request previously had no timeout and no AbortController. If a
  // request stalled (mobile network drop, AI vision stall, KV/Stripe write hang)
  // the awaiting UI stayed disabled on "Scanning your document..." /
  // "Saving your results..." / "Contacting secure payment..." forever, with no
  // cancel and no error. This wrapper is the innermost fetch wrapper, so the
  // ceiling applies to every network call the scanner makes.
  var REQUEST_TIMEOUT_MS = 60000;

  function fetchWithTimeout(input, init) {
    var requestInit = Object.assign({}, init || {});

    // Honour a caller-supplied signal, and allow an explicit opt-out.
    if (requestInit.signal) return nativeFetch(input, requestInit);
    if (requestInit.timeout === 0) {
      delete requestInit.timeout;
      return nativeFetch(input, requestInit);
    }

    var controller = new AbortController();
    requestInit.signal = controller.signal;

    var timer = setTimeout(function () { controller.abort(); }, REQUEST_TIMEOUT_MS);

    return nativeFetch(input, requestInit).then(
      function (response) {
        clearTimeout(timer);
        return response;
      },
      function (error) {
        clearTimeout(timer);
        if (error && error.name === 'AbortError') {
          var seconds = Math.round(REQUEST_TIMEOUT_MS / 1000);
          var timeoutError = new Error(
            'The request timed out after ' + seconds + ' seconds. Check your connection and try again.'
          );
          timeoutError.name = 'TimeoutError';
          throw timeoutError;
        }
        throw error;
      }
    );
  }

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
      image.onerror = function () { reject(new Error('This image could not be opened. Try uploading it as a JPG or PNG.')); };
      image.src = dataUrl;
    });
  }

  function loadHeicConverter() {
    if (window.heic2any) return Promise.resolve(window.heic2any);
    if (!window.__uttPreprocessHeicPromise) {
      window.__uttPreprocessHeicPromise = new Promise(function (resolve, reject) {
        var script = document.createElement('script');
        var timer = setTimeout(function () {
          script.remove();
          reject(new Error('HEIC converter took too long to load'));
        }, 12000);
        script.src = 'https://cdnjs.cloudflare.com/ajax/libs/heic2any/0.0.4/heic2any.min.js';
        script.async = true;
        script.onload = function () {
          clearTimeout(timer);
          window.heic2any ? resolve(window.heic2any) : reject(new Error('HEIC converter did not initialize'));
        };
        script.onerror = function () {
          clearTimeout(timer);
          reject(new Error('HEIC converter failed to load'));
        };
        document.head.appendChild(script);
      }).catch(function (error) {
        window.__uttPreprocessHeicPromise = null;
        throw error;
      });
    }
    return window.__uttPreprocessHeicPromise;
  }

  async function convertHeic(dataUrl) {
    var response = await fetchWithTimeout(dataUrl);
    var sourceBlob = await response.blob();
    var converter = await loadHeicConverter();
    var converted = await converter({ blob: sourceBlob, toType: 'image/jpeg', quality: 0.94 });
    if (Array.isArray(converted)) converted = converted[0];
    if (!converted) throw new Error('No image was found in the HEIC file');
    return blobToDataUrl(converted);
  }

  function normalizeDataUrl(dataUrl) {
    var header = /^data:([^;,]*);base64,/i.exec(dataUrl);
    if (!header) return dataUrl;

    var type = header[1].toLowerCase();
    if (type && type !== 'application/octet-stream' && type !== 'binary/octet-stream') {
      return 'data:' + type + ';base64,' + dataUrl.slice(header[0].length);
    }

    // FileReader uses application/octet-stream when the picker supplies no MIME.
    var signature;
    try { signature = atob(dataUrl.slice(header[0].length, header[0].length + 64)); }
    catch (_) { return dataUrl; }
    if (signature.startsWith('%PDF-')) type = 'application/pdf';
    if (signature.startsWith('\xff\xd8\xff')) type = 'image/jpeg';
    if (signature.startsWith('\x89PNG\r\n\x1a\n')) type = 'image/png';
    if (signature.slice(4, 8) === 'ftyp' && /(?:heic|heix|hevc|hevx|heim|heis|mif1|msf1)/.test(signature.slice(8))) {
      type = 'image/heic';
    }
    return 'data:' + type + ';base64,' + dataUrl.slice(header[0].length);
  }

  function percentile(histogram, fraction, total) {
    var remaining = Math.max(1, Math.ceil(fraction * total));
    for (var i = 0; i < histogram.length; i++) {
      remaining -= histogram[i];
      if (remaining <= 0) return i;
    }
    return 255;
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
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, sampleWidth, sampleHeight);
    ctx.drawImage(image, 0, 0, sampleWidth, sampleHeight);

    var pixels;
    try { pixels = ctx.getImageData(0, 0, sampleWidth, sampleHeight).data; }
    catch (_) { return null; }

    var gray = new Float32Array(sampleWidth * sampleHeight);
    var histogram = new Uint32Array(256);
    var sum = 0;
    var sumSquares = 0;
    for (var i = 0; i < gray.length; i++) {
      var p = i * 4;
      var value = 0.299 * pixels[p] + 0.587 * pixels[p + 1] + 0.114 * pixels[p + 2];
      gray[i] = value;
      histogram[Math.round(value)]++;
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
    var darkPoint = percentile(histogram, 0.01, gray.length);
    var lightPoint = percentile(histogram, 0.99, gray.length);

    var largest = Math.max(width, height);
    var smallest = Math.min(width, height);
    var warnings = [];
    if (largest < 1000 || smallest < 500) warnings.push('low_resolution');
    if (brightness < 35) warnings.push('too_dark');
    if (brightness > 245 && darkPoint > 220) warnings.push('too_bright');
    if (contrast < 18) warnings.push('low_contrast');
    if (sharpness < 4.2) warnings.push('possible_blur');

    // Sparse text and tightly cropped photos can be readable even when averages
    // look white, dark, or low contrast. Only reject tiny or near-blank input.
    var hardReject = largest < 300 || smallest < 120 || (contrast < 1.5 && sharpness < 0.4);
    var grade = hardReject ? 'poor' : (warnings.length >= 2 ? 'fair' : 'good');

    return {
      width: width,
      height: height,
      brightness: Math.round(brightness),
      contrast: Math.round(contrast * 10) / 10,
      sharpness: Math.round(sharpness * 10) / 10,
      grade: grade,
      hardReject: hardReject,
      warnings: warnings.slice(0, 5),
      darkPoint: darkPoint,
      lightPoint: lightPoint
    };
  }

  function adjustTone(ctx, width, height, quality) {
    var range = quality.lightPoint - quality.darkPoint;
    if (range < 3) return false;

    // Unlike fixed contrast() and brightness() filters, this stretches the
    // visible marks around the tones actually present in this photo.
    var gain = Math.max(1, Math.min(5, 110 / range));
    var shift = 222 - quality.lightPoint * gain;
    var pixels;
    try { pixels = ctx.getImageData(0, 0, width, height); }
    catch (_) { return false; }
    for (var i = 0; i < pixels.data.length; i += 4) {
      var luminance = 0.299 * pixels.data[i] + 0.587 * pixels.data[i + 1] + 0.114 * pixels.data[i + 2];
      var delta = luminance * (gain - 1) + shift;
      pixels.data[i] += delta;
      pixels.data[i + 1] += delta;
      pixels.data[i + 2] += delta;
    }
    ctx.putImageData(pixels, 0, 0);
    return true;
  }

  function encodeJpeg(image, width, height, needsTone, quality) {
    var canvas = document.createElement('canvas');
    var scale = Math.min(1, MAX_DIMENSION / Math.max(width, height), Math.sqrt(MAX_PIXELS / (width * height)));
    var qualities = [0.94, 0.86, 0.78];
    var smallest = '';
    var toned = false;
    for (var attempt = 0; attempt < 3; attempt++) {
      canvas.width = Math.max(1, Math.floor(width * scale));
      canvas.height = Math.max(1, Math.floor(height * scale));
      var ctx = canvas.getContext('2d', { alpha: false, willReadFrequently: needsTone });
      if (!ctx) break;
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
      toned = needsTone && adjustTone(ctx, canvas.width, canvas.height, quality);

      for (var q = 0; q < qualities.length; q++) {
        var candidate = canvas.toDataURL('image/jpeg', qualities[q]);
        if (!candidate.startsWith('data:image/jpeg;base64,')) continue;
        if (dataUrlBytes(candidate) <= TARGET_BYTES) return { image: candidate, toned: toned };
        if (!smallest || candidate.length < smallest.length) smallest = candidate;
      }
      scale *= smallest ? Math.min(0.76, Math.sqrt(TARGET_BYTES / dataUrlBytes(smallest)) * 0.92) : 0.76;
    }
    return { image: smallest, toned: toned };
  }

  function uploadQuality(measured) {
    if (!measured) return null;
    var quality = Object.assign({}, measured);
    delete quality.darkPoint;
    delete quality.lightPoint;
    return quality;
  }

  async function preprocessImage(dataUrl, existingQuality) {
    if (typeof dataUrl !== 'string' || dataUrl.indexOf('data:') !== 0) {
      return { image: dataUrl, quality: existingQuality || null };
    }

    dataUrl = normalizeDataUrl(dataUrl);
    if (dataUrl.startsWith('data:application/pdf')) {
      return { image: dataUrl, quality: existingQuality || null };
    }
    if (!dataUrl.startsWith('data:image/')) {
      return { image: dataUrl, quality: existingQuality || null };
    }
    var isHeic = /^data:image\/hei[cf](?:-sequence)?[;,]/i.test(dataUrl);
    var image;
    try { image = await loadImage(dataUrl); }
    catch (error) {
      if (!isHeic) throw error;
      try {
        dataUrl = await convertHeic(dataUrl);
        image = await loadImage(dataUrl);
      } catch (_) {
        throw new Error('This HEIC photo could not be opened. Export it as a JPG or PNG and try again.');
      }
    }
    var before = measureImage(image);
    var width = image.naturalWidth || image.width;
    var height = image.naturalHeight || image.height;
    if (!width || !height) return { image: dataUrl, quality: existingQuality || null };

    var needsJpeg = !/^data:image\/(jpeg|png)[;,]/.test(dataUrl);
    var needsResize = Math.max(width, height) > MAX_DIMENSION || width * height > MAX_PIXELS || dataUrlBytes(dataUrl) > TARGET_BYTES;
    var needsTone = before && !before.hardReject && before.warnings.some(function (warning) {
      return ['too_dark', 'too_bright', 'low_contrast'].indexOf(warning) >= 0;
    });

    if (!needsResize && !needsTone && !needsJpeg) {
      return { image: dataUrl, quality: uploadQuality(before) || existingQuality || null };
    }

    var encoded = encodeJpeg(image, width, height, needsTone, before);
    if (!encoded.image || (!needsResize && !needsJpeg && !encoded.toned)) {
      return { image: dataUrl, quality: uploadQuality(before) || existingQuality || null };
    }
    var after = measureImage(await loadImage(encoded.image));
    if (encoded.toned && after && before && after.hardReject && !before.hardReject) {
      if (!needsResize && !needsJpeg) return { image: dataUrl, quality: uploadQuality(before) };
      encoded = encodeJpeg(image, width, height, false, before);
      if (!encoded.image) return { image: dataUrl, quality: uploadQuality(before) };
      after = measureImage(await loadImage(encoded.image));
    }
    return { image: encoded.image, quality: uploadQuality(after || before) || existingQuality || null };
  }

  window.UTTDPreprocessImage = preprocessImage;
  window.UTTDPrepareScannerFile = async function (file, options) {
    var originalImage = await blobToDataUrl(file);
    var result = await preprocessImage(originalImage);
    if (options && options.includeOriginal === true) result.originalImage = originalImage;
    return result;
  };

  window.fetch = async function (input, init) {
    if (!isScannerRequest(input)) return fetchWithTimeout(input, init);

    var requestInit = Object.assign({}, init || {});
    var prepared = requestInit.uttScannerPrepared === true;
    delete requestInit.uttScannerPrepared;
    if (prepared) return fetchWithTimeout(input, requestInit);
    if (typeof requestInit.body !== 'string') return fetchWithTimeout(input, requestInit);

    try {
      var body = JSON.parse(requestInit.body);
      if (!body || typeof body !== 'object' || typeof body.image !== 'string') {
        return fetchWithTimeout(input, requestInit);
      }

      var result = await preprocessImage(body.image, body.clientQuality);
      body.image = result.image;
      if (result.quality) body.clientQuality = result.quality;
      requestInit.body = JSON.stringify(body);
    } catch (error) {
      console.warn('scanner preprocessing skipped', error && error.message || error);
    }

    return fetchWithTimeout(input, requestInit);
  };
})();
