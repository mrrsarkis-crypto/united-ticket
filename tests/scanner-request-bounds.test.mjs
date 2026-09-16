import test from 'node:test';
import assert from 'node:assert/strict';
import { onRequestPost } from '../functions/api/assistant/extract.js';
import { __visionTest, extractVisionDocument } from '../functions/api/assistant/_vision.js';
const endpoint = 'https://unitedtraffictickets.com/api/assistant/extract';
test('invalid JSON shapes return 400 instead of crashing', async () => {
  for (const body of ['null', '[]', '"hello"', '42']) {
    const response = await onRequestPost({ env: {}, request: new Request(endpoint, {method:'POST', headers:{'content-type':'application/json'}, body}) });
    assert.equal(response.status, 400);
  }
});
test('streamed oversized JSON is rejected without Content-Length', async () => {
  let cancelled = false;
  const body = new ReadableStream({ start(c) { c.enqueue(new Uint8Array(15 * 1024 * 1024 + 1)); }, cancel() { cancelled = true; } });
  const response = await onRequestPost({ env:{}, request:new Request(endpoint, {method:'POST', headers:{'content-type':'application/json'}, body, duplex:'half'}) });
  assert.equal(response.status, 413);
  assert.equal(cancelled, true);
});
test('provider deadline covers a stalled response body', async (t) => {
  const original = globalThis.fetch; t.after(() => { globalThis.fetch = original; });
  globalThis.fetch = async () => ({ok:true,status:200,text:() => new Promise(() => {})});
  await assert.rejects(__visionTest.fetchWithDeadline('https://example.test', {}, 25), /timed out/);
});
test('non-retryable provider errors are attempted only once', async (t) => {
  const original = globalThis.fetch; t.after(() => { globalThis.fetch = original; });
  let calls=0; globalThis.fetch=async()=>{calls++;return new Response('invalid API key',{status:401});};
  await assert.rejects(extractVisionDocument({GEMINI_API_KEY:'test'}, {system:'x',base64:'AAAA',mediaType:'image/jpeg',prompt:'x'}), /401/);
  assert.equal(calls,1);
});
