import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../public/scanner-browser-fallback.js', import.meta.url), 'utf8');
const app = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const image = 'data:image/png;base64,aW1hZ2U=';
const payload = { consent: true, image };
const init = (body = payload) => ({ method: 'POST', body: JSON.stringify(body) });
const jsonResponse = (value, status = 200) => new Response(JSON.stringify(value), {
  status, headers: { 'Content-Type': 'application/json' },
});

function harness(response, raw = '', consumeRequest = false) {
  let calls = 0;
  let terminated = 0;
  const window = {
    location: { href: 'https://example.test/assistant' },
    fetch: async (input) => {
      if (consumeRequest && input instanceof Request) await input.text();
      return response;
    },
    Tesseract: { createWorker: async () => ({
      recognize: async () => ({ data: { text: raw } }),
      terminate: async () => { terminated++; },
    }) },
  };
  const context = vm.createContext({ window, URL, Response, Request,
    console: { warn() {} }, document: { getElementById: () => null },
  });
  vm.runInContext(source, context);
  const realOcr = window.UTTBrowserOCRFallback;
  window.UTTBrowserOCRFallback = async () => {
    calls++;
    return { citationNumber: { value: 'TEST123', found: true, confident: false } };
  };
  return { window, context, realOcr, calls: () => calls, terminated: () => terminated };
}

test('browser OCR executes for an HTTP 200 cloud fallback request', async () => {
  const h = harness(jsonResponse({ ok: true, clientOcrFallback: true }));
  const response = await h.window.fetch('/api/assistant/extract', init());
  assert.equal((await response.json()).extracted.citationNumber.value, 'TEST123');
  assert.equal(h.calls(), 1);
  assert.match(response.headers.get('cache-control'), /no-store/);
});

test('browser OCR still handles a provider 503 response', async () => {
  const h = harness(new Response('provider busy', { status: 503 }));
  assert.equal((await h.window.fetch('/api/assistant/extract', init())).status, 200);
  assert.equal(h.calls(), 1);
});

test('successful cloud extraction passes through unchanged and remains readable', async () => {
  const response = jsonResponse({ ok: true, extracted: { legibility: 'good' } });
  const h = harness(response);
  const result = await h.window.fetch('/api/assistant/extract', init());
  assert.equal(result, response);
  assert.equal((await result.json()).extracted.legibility, 'good');
  assert.equal(h.calls(), 0);
});

for (const status of [400, 401, 403, 413, 422, 429]) {
  test('browser OCR preserves client/rate-limit response ' + status, async () => {
    const response = jsonResponse({ error: 'rejected' }, status);
    const h = harness(response);
    assert.equal(await h.window.fetch('/api/assistant/extract', init()), response);
    assert.equal(h.calls(), 0);
  });
}

test('browser OCR requires consent and an image', async () => {
  for (const body of [{ image }, { consent: false, image }, { consent: true, image: 'data:application/pdf;base64,AAAA' }]) {
    const response = jsonResponse({ clientOcrFallback: true });
    const h = harness(response);
    assert.equal(await h.window.fetch('/api/assistant/extract', init(body)), response);
    assert.equal(h.calls(), 0);
  }
});

test('browser OCR does not intercept other hosts, paths, GETs or canceled scans', async () => {
  for (const [url, options] of [
    ['https://other.test/api/assistant/extract', init()],
    ['/api/health', init()],
    ['/api/assistant/extract', { ...init(), method: 'GET' }],
    ['/api/assistant/extract', { ...init(), signal: AbortSignal.abort() }],
  ]) {
    const response = jsonResponse({ clientOcrFallback: true });
    const h = harness(response);
    assert.equal(await h.window.fetch(url, options), response);
    assert.equal(h.calls(), 0);
  }
});

test('browser OCR clones a Request before fetch consumes its body', async () => {
  const h = harness(jsonResponse({ clientOcrFallback: true }), '', true);
  const request = new Request('https://example.test/api/assistant/extract', init());
  const response = await h.window.fetch(request);
  assert.equal((await response.json()).extracted.citationNumber.value, 'TEST123');
  assert.equal(h.calls(), 1);
});

test('loading the OCR script twice does not wrap fetch twice', () => {
  const h = harness(jsonResponse({ clientOcrFallback: true }));
  const fetch = h.window.fetch;
  vm.runInContext(source, h.context);
  assert.equal(h.window.fetch, fetch);
});

test('failed local OCR preserves the original response', async () => {
  const response = jsonResponse({ clientOcrFallback: true });
  const h = harness(response);
  h.window.UTTBrowserOCRFallback = async () => { throw new Error('no readable text'); };
  const result = await h.window.fetch('/api/assistant/extract', init());
  assert.equal(result, response);
  assert.equal((await result.json()).clientOcrFallback, true);
});

test('local OCR does not invent citation IDs from labels or copy driver addresses to court fields', async () => {
  const h = harness(null, 'TRAFFIC CITATION\nName: SAMPLE DRIVER\n123 Main Street\nLos Angeles CA 90001');
  const result = await h.realOcr(image);
  assert.equal(result.citationNumber.value, null);
  assert.equal(result.courtStreetAddress.value, null);
  assert.equal(result.courtMailingAddress.value, null);
  assert.equal(result.courtCityStateZip.value, null);
  assert.equal(h.terminated(), 1);
});

test('local OCR keeps a labeled citation candidate unverified', async () => {
  const h = harness(null, 'Citation No: TEST123\nName: SAMPLE DRIVER');
  const result = await h.realOcr(image);
  assert.equal(result.citationNumber.value, 'TEST123');
  assert.equal(result.citationNumber.confident, false);
});

// Exercise the actual homepage request function, independently of its DOM UI.
function homepageRequest(response) {
  const start = app.indexOf('async function(t){var n=await fetch("/api/assistant/extract"');
  const end = app.indexOf('}(r).then', start);
  assert.ok(start >= 0 && end > start, 'Homepage scan request must be identifiable');
  const fn = new Function('fetch', 'e', 'u', 'return (' + app.slice(start, end + 1) + ')');
  return fn(async () => response, async (r) => r.json(), null);
}

test('homepage HTTP 200 fallback enters its existing local OCR error path', async () => {
  const scan = homepageRequest(jsonResponse({ ok: true, clientOcrFallback: true }));
  await assert.rejects(scan(image), (error) => error.status === 503);
});

test('homepage does not display scan complete when the response has no fields', async () => {
  const scan = homepageRequest(jsonResponse({ ok: true }));
  await assert.rejects(scan(image), (error) => error.status === 502);
});

test('homepage preserves a legitimate extraction and validation failures', async () => {
  const result = { citationNumber: { value: 'TEST123', confident: true } };
  assert.deepEqual(await homepageRequest(jsonResponse({ extracted: result }))(image), result);
  await assert.rejects(homepageRequest(jsonResponse({ error: 'consent required', code: 'consent' }, 403))(image),
    (error) => error.status === 403 && error.code === 'consent');
});
