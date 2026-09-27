import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { priceFor } from '../functions/api/_shared.js';
import { onRequestGet as health } from '../functions/api/health.js';

import { checkoutAmountMatches } from '../functions/api/cases/index.js';

const LIVE_PRICE_IDS = {
  '199': 'price_1UHw68LMSqKARRUqlhvD82xl',
  '149': 'price_1UHw6DLMSqKARRUqDTK6w7LB',
  '99': 'price_1UHw6FLMSqKARRUqJ8vVNoCr',
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

test('checkout falls back to the known production price IDs when no override is set', () => {
  for (const [service, expected] of Object.entries(LIVE_PRICE_IDS)) {
    assert.equal(priceFor(service, {}), expected, service);
    assert.equal(priceFor(service, undefined), expected, service);
    assert.equal(priceFor(service, { STRIPE_PRICE_299: 'price_x' }), expected, service);
  }
});

test('an env override replaces the production price ID, which is what enables test mode', () => {
  assert.equal(priceFor('199', { STRIPE_PRICE_199: 'price_TESTMODE1' }), 'price_TESTMODE1');
  assert.equal(priceFor('149', { STRIPE_PRICE_149: 'price_TESTMODE2' }), 'price_TESTMODE2');
  assert.equal(priceFor('99', { STRIPE_PRICE_99: 'price_TESTMODE3' }), 'price_TESTMODE3');
});

test('an override for one service does not leak into another', () => {
  const env = { STRIPE_PRICE_199: 'price_TESTMODE1' };
  assert.equal(priceFor('199', env), 'price_TESTMODE1');
  assert.equal(priceFor('149', env), LIVE_PRICE_IDS['149']);
  assert.equal(priceFor('99', env), LIVE_PRICE_IDS['99']);
});

test('blank or whitespace overrides are ignored in favour of the production default', () => {
  assert.equal(priceFor('199', { STRIPE_PRICE_199: '' }), LIVE_PRICE_IDS['199']);
  assert.equal(priceFor('199', { STRIPE_PRICE_199: '   ' }), LIVE_PRICE_IDS['199']);
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

test('health does not require price bindings that checkout never reads', async () => {
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
  }));
  assert.equal(body.stripe.keyMode, 'test');
  assert.deepEqual(body.stripe.checkout.priceOverrides, { STRIPE_PRICE_199: 'price_TESTMODE1' });
  assert.equal(body.ok, true);
});

test('health flags a malformed price override instead of silently ignoring it', async () => {
  const body = await healthBody(healthEnv({ STRIPE_PRICE_149: 'not-a-price' }));
  assert.deepEqual(body.stripe.checkout.badPriceOverrides, ['STRIPE_PRICE_149']);
  assert.ok(body.missing.includes('invalid_stripe_price_override'));
  assert.equal(body.ok, false);
});

test('health no longer references the price binding names that never existed', async () => {
  const body = await healthBody(healthEnv());
  const serialized = JSON.stringify(body);
  assert.equal(serialized.includes('STRIPE_PRICE_299'), false);
  assert.equal(serialized.includes('STRIPE_PRICE_999'), false);
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
  assert.equal(checkoutAmountMatches('149.00', 14900), true);
  assert.equal(checkoutAmountMatches('99.00', 9900), true);
});

test('checkoutAmountMatches rejects a price that resolves to a different amount', () => {
  assert.equal(
    checkoutAmountMatches('199.00', 9900),
    false,
    'a $199 service resolving to $99 must be refused'
  );
  assert.equal(checkoutAmountMatches('199.00', 29900), false);
  assert.equal(checkoutAmountMatches('199.00', 19901), false, 'a one-cent drift must be refused');
  assert.equal(checkoutAmountMatches('199.00', 0), false, 'a zero total must be refused');
});

test('checkoutAmountMatches treats an unusable Stripe amount as a mismatch', () => {
  assert.equal(checkoutAmountMatches('199.00', undefined), false);
  assert.equal(checkoutAmountMatches('199.00', null), false);
  assert.equal(checkoutAmountMatches('199.00', 'not-a-number'), false);
  assert.equal(checkoutAmountMatches('199.00', NaN), false);
  assert.equal(checkoutAmountMatches('not-a-price', 19900), false);
});
