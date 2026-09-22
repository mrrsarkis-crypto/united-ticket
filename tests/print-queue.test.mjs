import test from 'node:test';
import assert from 'node:assert/strict';
import { enqueuePrintJob, nextPrintJob, claimPrintJob, finishPrintJob } from '../functions/api/_print-queue.js';

function kv() {
  const m = new Map();
  return {
    async get(k, type) { const v = m.get(k); if (v == null) return null; return type === 'json' ? JSON.parse(v) : v; },
    async put(k, v) { m.set(k, String(v)); },
    async delete(k) { m.delete(k); },
    async list() { throw new Error('list() must not be used by print queue'); },
  };
}

test('print queue uses direct head/tail keys and advances after success', async () => {
  const CASES = kv(); const env = { CASES };
  const first = await enqueuePrintJob(env, { r2Key:'a.pdf', filename:'a.pdf', trackingCode:'A' });
  const second = await enqueuePrintJob(env, { r2Key:'b.pdf', filename:'b.pdf', trackingCode:'B' });
  assert.equal((await nextPrintJob(env)).id, first.id);
  const claimed = await claimPrintJob(env, first);
  assert.equal(claimed.status, 'claimed');
  await finishPrintJob(env, first.id, true);
  assert.equal((await nextPrintJob(env)).id, second.id);
});

test('failed print is requeued at the head', async () => {
  const CASES = kv(); const env = { CASES };
  const job = await enqueuePrintJob(env, { r2Key:'x.pdf', filename:'x.pdf', trackingCode:'X' });
  await claimPrintJob(env, job);
  await finishPrintJob(env, job.id, false, 'printer offline');
  const again = await nextPrintJob(env);
  assert.equal(again.id, job.id); assert.equal(again.status, 'queued');
});
