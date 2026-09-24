import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { onRequestPost } from '../functions/api/webhook.js';

const secret = 'whsec_local_test_only';
const timestamp = () => Math.floor(Date.now() / 1000);
const mac = (body, time) => createHmac('sha256', secret).update(time + '.' + body).digest('hex');
const noop = JSON.stringify({ id: 'evt_test', type: 'ping' });
function request(body, signature) {
  return new Request('https://example.test/api/webhook', {
    method: 'POST', body,
    headers: signature ? { 'stripe-signature': signature } : {},
  });
}
async function deliver(body = noop, signature, extra = {}) {
  return onRequestPost({
    request: request(body, signature),
    env: { STRIPE_WEBHOOK_SECRET: secret, ...extra },
  });
}

test('payment webhook rejects missing or invalid signatures', async () => {
  assert.equal((await deliver()).status, 400);
  assert.equal((await deliver(noop, 't=' + timestamp() + ',v1=' + '0'.repeat(64))).status, 400);
});

test('payment webhook accepts a valid current signature', async () => {
  const time = timestamp();
  assert.equal((await deliver(noop, 't=' + time + ',v1=' + mac(noop, time))).status, 200);
});

test('payment webhook accepts the matching signature anywhere during rotation', async () => {
  const time = timestamp();
  const valid = 'v1=' + mac(noop, time);
  const wrong = 'v1=' + '0'.repeat(64);
  for (const values of [[valid, wrong], [wrong, valid]]) {
    const result = await deliver(noop, ['t=' + time, ...values].join(', '));
    assert.equal(result.status, 200);
  }
});

test('payment webhook rejects stale, future and ambiguous timestamps', async () => {
  for (const time of [timestamp() - 601, timestamp() + 601]) {
    assert.equal((await deliver(noop, 't=' + time + ',v1=' + mac(noop, time))).status, 400);
  }
  const time = timestamp();
  assert.equal((await deliver(noop, 't=' + time + ',t=' + time + ',v1=' + mac(noop, time))).status, 400);
});

test('payment webhook verifies the unchanged raw request body', async () => {
  const time = timestamp();
  assert.equal((await deliver(noop + ' ', 't=' + time + ',v1=' + mac(noop, time))).status, 400);
});

for (const status of [undefined, null, 'unpaid', 'no_payment_required', 'requires_payment_method', 'unknown']) {
  test('payment webhook does not fulfill non-paid status: ' + String(status), async () => {
    let reads = 0;
    let writes = 0;
    const body = JSON.stringify({
      id: 'evt_test', type: 'checkout.session.completed',
      data: { object: { id: 'cs_test', payment_status: status } },
    });
    const time = timestamp();
    const response = await deliver(body, 't=' + time + ',v1=' + mac(body, time), {
      CASES: {
        get: async () => { reads++; return '1'; },
        put: async () => { writes++; },
      },
    });
    assert.equal(response.status, 200);
    assert.equal(reads, 0, 'Non-paid events must not enter fulfillment');
    assert.equal(writes, 0);
  });
}

test('payment webhook acknowledges an already processed paid event without repeating work', async () => {
  const body = JSON.stringify({
    id: 'evt_processed', type: 'checkout.session.async_payment_succeeded',
    data: { object: { id: 'cs_test', payment_status: 'paid' } },
  });
  const time = timestamp();
  const seen = [];
  const response = await deliver(body, 't=' + time + ',v1=' + mac(body, time), {
    CASES: {
      get: async (key) => { seen.push(key); return key === 'evt:evt_processed' ? '1' : null; },
      put: async () => { throw new Error('Duplicate event must not write'); },
    },
  });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).duplicate, true);
  assert.deepEqual(seen, ['evt:evt_processed']);
});
