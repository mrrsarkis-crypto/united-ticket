import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { priceFor } from '../functions/api/_shared.js';
import { onRequestGet as health } from '../functions/api/health.js';

import { checkoutAmountMatches, onRequestPost } from '../functions/api/cases/index.js';

const LIVE_PRICE_IDS = {
  '199': 'price_1U9tbmKjhWqVWzfLQQbTtSvD',
  '999': 'price_1U9tcuKjhWqVWzfLFHVN0IQC',
};

function healthEnv(extra = {}) {
  return {
    STRIPE_SECRET_KEY: 'sk_live_abc123',
    STRIPE_WEBHOOK_SECRET: 'whsec_abc123',
    CASES: {}, R2: {}, OPENAI_API_KEY: 'k',
    ...extra,
  };
}

async function healthBody(env) {
  const res = await health({ env, request: new Request('https://example.com/api/health') });
  return res.json();
}

function checkoutRequest(service) {
  return new Request('https://example.test/api/cases', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      service,
      name: 'Fixture Customer',
      email: 'customer@example.test',
      dob: '2000-01-01',
      dl: 'FIXTURE',
      tbdReviewed: true,
    }),
  });
}

test('checkout falls back to the known production price IDs when no override is set', () => {
  for (const [service, expected] of Object.entries(LIVE_PRICE_IDS)) {
    assert.equal(priceFor(service, {}), expected, service);
    assert.equal(priceFor(service, undefined), expected, service);
    assert.equal(priceFor(service, { STRIPE_PRICE_299: 'price_x' }), expected, service);
  }
});

test('an env override replaces the production price ID, which is what enables test mode', () => {
  assert.equal(priceFor('199', { STRIPE_PRICE_199: 'price_TESTMODE1' }), 'price_TESTMODE1');
  assert.equal(priceFor('999', { STRIPE_PRICE_999: 'price_TESTMODE2' }), 'price_TESTMODE2');
});

test('an override for one service does not leak into another', () => {
  const env = { STRIPE_PRICE_199: 'price_TESTMODE1' };
  assert.equal(priceFor('199', env), 'price_TESTMODE1');
  assert.equal(priceFor('999', env), LIVE_PRICE_IDS['999']);
});

test('blank or whitespace overrides are ignored in favour of the production default', () => {
  assert.equal(priceFor('199', { STRIPE_PRICE_199: '' }), LIVE_PRICE_IDS['199']);
  assert.equal(priceFor('999', { STRIPE_PRICE_999: '   ' }), LIVE_PRICE_IDS['999']);
});

test('unknown services are rejected rather than falling back to a price', () => {
  assert.equal(priceFor('299', {}), null);
  assert.equal(priceFor('', {}), null);
  assert.equal(priceFor('free', { STRIPE_PRICE_free: 'price_x' }), null);
  assert.equal(priceFor(undefined, {}), null);
  // A prototype key must not be treated as a real service.
  assert.equal(priceFor('toString', { STRIPE_PRICE_toString: 'price_x' }), null);
  assert.equal(priceFor('constructor', {}), null);
});

test('retired tiers never create a checkout even with a legacy override', async t => {
  const fetch = t.mock.method(globalThis, 'fetch', async () => {
    assert.fail('an unsupported tier must not call Stripe');
  });
  for (const service of ['99', '149']) {
    const env = { STRIPE_SECRET_KEY: 'sk_test_fixture', [`STRIPE_PRICE_${service}`]: 'price_RETIRED' };
    assert.equal(priceFor(service, env), null);
    const response = await onRequestPost({ env, request: checkoutRequest(service) });
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { error: 'Unknown service type' });
  }
  assert.equal(fetch.mock.callCount(), 0);
});

test('health accepts default prices without override bindings', async () => {
  const body = await healthBody(healthEnv());
  assert.equal(body.ok, true, 'a missing STRIPE_PRICE_* binding must not make health fail');
  assert.deepEqual(body.missing, []);
  assert.deepEqual(body.stripe.checkout.priceOverrides, {});
  assert.deepEqual(body.stripe.checkout.badPriceOverrides, []);
});

test('health surfaces valid price overrides so test mode is verifiable', async () => {
  const body = await healthBody(healthEnv({
    STRIPE_SECRET_KEY: 'sk_test_abc123',
    STRIPE_PRICE_199: 'price_TESTMODE1',
    STRIPE_PRICE_999: 'price_TESTMODE2',
  }));
  assert.equal(body.stripe.keyMode, 'test');
  assert.deepEqual(body.stripe.checkout.priceOverrides, {
    STRIPE_PRICE_199: 'price_TESTMODE1',
    STRIPE_PRICE_999: 'price_TESTMODE2',
  });
  assert.equal(body.ok, true);
});

test('health flags malformed overrides for supported tiers', async () => {
  const body = await healthBody(healthEnv({ STRIPE_PRICE_199: 'not-a-price', STRIPE_PRICE_999: 'not-a-price' }));
  assert.deepEqual([...body.stripe.checkout.badPriceOverrides].sort(), ['STRIPE_PRICE_199', 'STRIPE_PRICE_999']);
  assert.ok(body.missing.includes('invalid_stripe_price_override'));
  assert.equal(body.ok, false);
});

test('health ignores price overrides for retired and unsupported tiers', async () => {
  const body = await healthBody(healthEnv({
    STRIPE_PRICE_99: 'price_RETIRED',
    STRIPE_PRICE_149: 'not-a-price',
    STRIPE_PRICE_299: 'price_UNSUPPORTED',
  }));
  assert.deepEqual(body.stripe.checkout.priceOverrides, {});
  assert.deepEqual(body.stripe.checkout.badPriceOverrides, []);
  assert.equal(body.ok, true);
});

test('missing Stripe configuration makes health and checkout unavailable', async t => {
  const fetch = t.mock.method(globalThis, 'fetch', async () => {
    assert.fail('missing Stripe credentials must not call Stripe');
  });
  t.mock.method(console, 'warn', () => {});
  t.mock.method(console, 'error', () => {});

  const response = await health({
    env: healthEnv({ STRIPE_SECRET_KEY: undefined, STRIPE_ALLOW_LIVE_PAYMENT_LINK_FALLBACK: 'true' }),
    request: new Request('https://example.test/api/health'),
  });
  const body = await response.json();
  assert.equal(response.status, 503);
  assert.equal(body.ok, false);
  assert.ok(body.missing.includes('required_runtime_configuration'));
  assert.equal(body.stripe.checkout.apiConfigured, false);
  assert.equal(body.stripe.checkout.paymentLinkFallbackEnabled, false);

  const checkout = await onRequestPost({
    env: { STRIPE_ALLOW_LIVE_PAYMENT_LINK_FALLBACK: 'true' }, request: checkoutRequest('199'),
  });
  assert.equal(checkout.status, 503);
  assert.deepEqual(await checkout.json(), { error: 'Payments are temporarily unavailable. Please contact us to complete your order.' });
  assert.equal(fetch.mock.callCount(), 0);
});

test('checkout refuses to return a URL when Stripe resolves a different amount', () => {
  const source = fs.readFileSync(path.join(process.cwd(), 'functions/api/cases/index.js'), 'utf8');
  assert.match(
    source,
    /Stripe session price mismatch[\s\S]*?Refusing to hand the customer a checkout URL/,
    'a price that resolves to a different total must be refused before the customer can pay it'
  );
  assert.match(
    source,
    /Payment configuration error\. Please contact us to complete your order\./,
    'a price mismatch must surface a safe 503 rather than a checkout URL'
  );
  // The guard must run only on the success branch, so a failed session still
  // reaches the fallback logic rather than being masked as a mismatch.
  const guardIndex = source.indexOf('Stripe session price mismatch');
  const successIndex = source.indexOf('sessionUrl = session.url;');
  assert.ok(guardIndex < successIndex, 'the guard must precede the point where the URL is returned');
  assert.ok(
    source.slice(0, guardIndex).includes('if (!stripeRes.ok)'),
    'the guard must sit inside the successful-response branch'
  );
});

test('checkoutAmountMatches accepts only the exact quoted amount', () => {
  assert.equal(checkoutAmountMatches('199.00', 19900), true);
  assert.equal(checkoutAmountMatches('999.00', 99900), true);
});

test('checkoutAmountMatches rejects a price that resolves to a different amount', () => {
  assert.equal(
    checkoutAmountMatches('199.00', 9900),
    false,
    'a $199 service resolving to $99 must be refused'
  );
  assert.equal(checkoutAmountMatches('199.00', 14900), false);
  assert.equal(checkoutAmountMatches('199.00', 29900), false);
  assert.equal(checkoutAmountMatches('199.00', 19901), false, 'a one-cent drift must be refused');
  assert.equal(checkoutAmountMatches('199.00', 0), false, 'a zero total must be refused');
  assert.equal(checkoutAmountMatches('999.00', 19900), false);
});

test('checkoutAmountMatches treats an unusable Stripe amount as a mismatch', () => {
  assert.equal(checkoutAmountMatches('199.00', undefined), false);
  assert.equal(checkoutAmountMatches('199.00', null), false);
  assert.equal(checkoutAmountMatches('199.00', 'not-a-number'), false);
  assert.equal(checkoutAmountMatches('199.00', NaN), false);
  assert.equal(checkoutAmountMatches('not-a-price', 19900), false);
});

test('checkout returns a URL only for the exact supported service total', async t => {
  const checkoutUrl = 'https://example.test/payment';
  let total;
  const fetch = t.mock.method(globalThis, 'fetch', async () => Response.json({ amount_total: total, url: checkoutUrl }));
  t.mock.method(console, 'warn', () => {});
  t.mock.method(console, 'error', () => {});
  const env = {
    STRIPE_SECRET_KEY: 'sk_test_fixture',
    STRIPE_PRICE_199: 'price_TESTMODE1',
    STRIPE_PRICE_999: 'price_TESTMODE2',
  };

  for (const [service, returnedTotal, expectedStatus] of [
    ['199', 14900, 503],
    ['999', 9900, 503],
    ['199', 19900, 200],
    ['999', 99900, 200],
  ]) {
    total = returnedTotal;
    const response = await onRequestPost({ env, request: checkoutRequest(service) });
    const body = await response.json();
    const [url, request] = fetch.mock.calls.at(-1).arguments;
    assert.equal(url, 'https://api.stripe.com/v1/checkout/sessions');
    assert.equal(request.body.get('line_items[0][price]'), env[`STRIPE_PRICE_${service}`]);
    assert.equal(response.status, expectedStatus);
    assert.equal(body.url, expectedStatus === 200 ? checkoutUrl : undefined);
  }
  assert.equal(fetch.mock.callCount(), 4);
});
