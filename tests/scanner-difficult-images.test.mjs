import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const preprocess = await readFile(new URL('../public/scanner-preprocess.js', import.meta.url), 'utf8');
const browserFallback = await readFile(new URL('../public/scanner-browser-fallback.js', import.meta.url), 'utf8');

function dataUrl(type, bytes) {
  return `data:${type};base64,${Buffer.from(bytes).toString('base64')}`;
}

test('scanner file preparation recognizes PDF bytes without changing their content', async () => {
  const file = { source: dataUrl('application/octet-stream', '%PDF-1.7 scanner fixture') };
  const window = { fetch: async () => assert.fail('A PDF should not trigger a preprocessing request') };
  class FileReader {
    readAsDataURL(blob) {
      this.result = blob.source;
      this.onload();
    }
  }
  vm.runInNewContext(preprocess, { window, FileReader, atob });

  const prepared = await window.UTTDPrepareScannerFile(file);
  assert.equal(prepared.image, file.source.replace('application/octet-stream', 'application/pdf'));
  assert.equal(prepared.quality, null);
  assert.equal(Object.hasOwn(prepared, 'originalImage'), false);
  const withOriginal = await window.UTTDPrepareScannerFile(file, { includeOriginal: true });
  assert.equal(withOriginal.originalImage, file.source);
});

test('native HEIC decoding avoids the converter and preserves faint printed detail', async () => {
  const input = dataUrl('application/octet-stream', '\x00\x00\x00\x18ftypheicfixture');
  const normalized = input.replace('application/octet-stream', 'image/heic');
  const output = dataUrl('image/jpeg', 'fixture');
  const observed = [];
  let renderedPixels;
  const width = 320;
  const height = 500;
  class Image {
    set src(source) {
      observed.push(source);
      this.naturalWidth = width;
      this.naturalHeight = height;
      this.enhanced = source === output;
      this.onload();
    }
  }
  const document = {
    createElement(tag) {
      assert.equal(tag, 'canvas');
      const canvas = {
        getContext() {
          let image;
          return {
            fillRect() {},
            drawImage(value) { image = value; },
            getImageData() {
              const pixels = new Uint8ClampedArray(canvas.width * canvas.height * 4);
              for (let i = 0; i < pixels.length; i += 4) {
                const ink = (i / 4) % 8 === 0;
                const value = image.enhanced ? (ink ? 172 : 222) : (ink ? 237 : 247);
                pixels.set([value, value, value, 255], i);
              }
              return { data: pixels };
            },
            putImageData(imageData) { renderedPixels = imageData.data; }
          };
        },
        toDataURL() { return output; }
      };
      return canvas;
    }
  };
  const window = { fetch: async () => assert.fail('A natively decoded HEIC should not load the converter') };
  vm.runInNewContext(preprocess, { window, document, Image, atob });

  const prepared = await window.UTTDPreprocessImage(input);
  assert.deepEqual(observed, [normalized, output]);
  assert.equal(prepared.image, output);
  assert.equal(prepared.quality.hardReject, false);
  assert.ok(renderedPixels[4] - renderedPixels[0] >= 40);
});

test('browser OCR retries sideways documents and keeps labels at the top edge', async () => {
  const image = 'data:image/jpeg;base64,fixture';
  const rotated = 'data:image/jpeg;base64,rotated';
  const recognized = [];
  const cropOffsets = [];
  let terminated = false;
  let canvasCount = 0;
  class Image {
    set src(source) {
      this.naturalWidth = source === rotated ? 800 : 1200;
      this.naturalHeight = source === rotated ? 1200 : 800;
      this.onload();
    }
  }
  const document = {
    getElementById() { return null; },
    createElement() {
      const id = canvasCount++;
      return {
        getContext() {
          return {
            fillRect() {}, translate() {}, rotate() {},
            drawImage(...args) {
              if (args.length === 9) cropOffsets.push(args[2]);
            }
          };
        },
        toDataURL() { return id === 0 ? rotated : 'data:image/jpeg;base64,crop' + id; }
      };
    }
  };
  const localReads = new Map([
    [image, 'unreadable'],
    [rotated, 'NOTICE TO APPEAR\nSUPERIOR COURT\nCITATION NUMBER: TEST49812'],
    ['data:image/jpeg;base64,crop1', 'Respond to citation before: 12/18/2026'],
    ['data:image/jpeg;base64,crop2', 'Violation code: 22350']
  ]);
  const window = {
    fetch: async () => assert.fail('Local OCR should not post a document'),
    Tesseract: {
      async createWorker() {
        return {
          async setParameters() {},
          async recognize(source) {
            recognized.push(source);
            return { data: { text: localReads.get(source) } };
          },
          async terminate() { terminated = true; }
        };
      }
    }
  };
  vm.runInNewContext(browserFallback, { window, document, Image });

  const result = await window.UTTBrowserOCRFallback(image);
  assert.deepEqual(recognized.slice(0, 2), [image, rotated]);
  assert.equal(cropOffsets[0], 0);
  assert.equal(result.citationNumber.value, 'TEST49812');
  assert.equal(result.dueDate.value, '12/18/2026');
  assert.equal(result.violationCode.value, '22350');
  assert.equal(result.citationNumber.confident, false);
  assert.equal(terminated, true);
});

test('browser OCR leaves a violation blank when a code appears only in instructions', async () => {
  const image = 'data:image/jpeg;base64,fixture';
  const raw = 'NOTICE TO APPEAR\nSUPERIOR COURT\nCITATION NUMBER: TEST49812\nSee Vehicle Code 40519 for instructions.';
  class Image {
    set src(_) {
      this.naturalWidth = 800;
      this.naturalHeight = 1200;
      this.onload();
    }
  }
  const document = {
    getElementById() { return null; },
    createElement() {
      return {
        getContext() { return { fillRect() {}, drawImage() {}, translate() {}, rotate() {} }; },
        toDataURL() { return 'data:image/jpeg;base64,crop'; },
      };
    },
  };
  const window = {
    fetch: async () => assert.fail('Local OCR should not post a document'),
    Tesseract: {
      async createWorker() {
        return {
          async setParameters() {},
          async recognize(source) { return { data: { text: source === image ? raw : '' } }; },
          async terminate() {},
        };
      },
    },
  };
  vm.runInNewContext(browserFallback, { window, document, Image });
  const result = await window.UTTBrowserOCRFallback(image);
  assert.equal(result.citationNumber.value, 'TEST49812');
  assert.equal(result.violationCode.value, null);
});

test('browser OCR skips non-ticket uploads and preserves weak cloud values', async () => {
  let cloudResponse;
  let localAttempts = 0;
  const window = {
    location: { href: 'https://example.test/assistant' },
    fetch: async () => cloudResponse
  };
  vm.runInNewContext(browserFallback, { window, URL, Response });
  window.UTTBrowserOCRFallback = async () => {
    localAttempts++;
    return {
      citationNumber: { value: 'LOCAL99' },
      dueDate: { value: '12/31/2026' }
    };
  };
  const scan = (docType) => window.fetch('/api/assistant/extract', {
    body: JSON.stringify({ image: 'data:image/jpeg;base64,fixture', docType })
  });

  cloudResponse = new Response('Temporarily unavailable', { status: 503 });
  for (const type of ['license', 'notice', 'auto']) {
    assert.equal(await scan(type), cloudResponse);
  }
  assert.equal(localAttempts, 0);

  const extracted = {
    citationNumber: { value: 'CLOUD99', confident: true },
    legibility: 'poor',
    scanMeta: { documentType: 'ticket', provider: 'gemini' },
    scanAssessment: {},
    validationWarnings: []
  };
  cloudResponse = Response.json({ ok: true, extracted });
  const comparison = (await (await scan('auto')).json()).extracted;
  assert.deepEqual(comparison.citationNumber, { value: 'CLOUD99', confident: false });
  assert.equal(comparison.dueDate, undefined);
  assert.equal(comparison.scanAssessment.needsManualReview, true);
  assert.equal(localAttempts, 1);

  cloudResponse = Response.json({ ok: true, extracted: { ...extracted, citationNumber: {} } });
  assert.equal(await scan('ticket'), cloudResponse);
  assert.equal(localAttempts, 1);
});
