import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { liveFallbackAllowed } from '../functions/api/cases/index.js';

const CASES_SOURCE = fs.readFileSync(
  path.join(process.cwd(), 'functions/api/cases/index.js'),
  'utf8'
);

const LIVE_KEY = 'sk_live_abc123';
const TEST_KEY = 'sk_test_abc123';

test('live Payment Link fallback is denied unless explicitly enabled', () => {
  assert.equal(
    liveFallbackAllowed({}, '199', LIVE_KEY),
    false,
    'a missing flag must never permit a real charge'
  );
  assert.equal(
    liveFallbackAllowed({ STRIPE_ALLOW_LIVE_PAYMENT_LINK_FALLBACK: 'false' }, '199', LIVE_KEY),
    false
  );
  assert.equal(
    liveFallbackAllowed({ STRIPE_ALLOW_LIVE_PAYMENT_LINK_FALLBACK: '1' }, '199', LIVE_KEY),
    false,
    'only the literal string "true" may enable real charges'
  );
});

test('live Payment Link fallback requires a live key even when enabled', () => {
  assert.equal(
    liveFallbackAllowed({ STRIPE_ALLOW_LIVE_PAYMENT_LINK_FALLBACK: 'true' }, '199', TEST_KEY),
    false,
    'a test key must never be routed to a live Payment Link'
  );
  assert.equal(
    liveFallbackAllowed({ STRIPE_ALLOW_LIVE_PAYMENT_LINK_FALLBACK: 'true' }, '199', ''),
    false
  );
  assert.equal(
    liveFallbackAllowed({ STRIPE_ALLOW_LIVE_PAYMENT_LINK_FALLBACK: 'true' }, '199', 'not-a-stripe-key'),
    false
  );
});

test('live Payment Link fallback only applies to services that have a link', () => {
  assert.equal(
    liveFallbackAllowed({ STRIPE_ALLOW_LIVE_PAYMENT_LINK_FALLBACK: 'true' }, '199', LIVE_KEY),
    true
  );
  assert.equal(
    liveFallbackAllowed({ STRIPE_ALLOW_LIVE_PAYMENT_LINK_FALLBACK: 'true' }, '149', LIVE_KEY),
    false,
    'no fallback link is configured for the 149 service'
  );
  assert.equal(
    liveFallbackAllowed({ STRIPE_ALLOW_LIVE_PAYMENT_LINK_FALLBACK: 'true' }, '99', LIVE_KEY),
    false
  );
});

test('flag comparison tolerates case and surrounding whitespace', () => {
  assert.equal(
    liveFallbackAllowed({ STRIPE_ALLOW_LIVE_PAYMENT_LINK_FALLBACK: '  TRUE  ' }, '199', LIVE_KEY),
    true
  );
});

test('no code path assigns the live Payment Link URL without the gate', () => {
  const assignments = CASES_SOURCE.match(/sessionUrl\s*=\s*fallbackUrl\.toString\(\)/g) || [];
  assert.equal(assignments.length, 2, 'expected exactly two guarded fallback assignments');
  assert.equal(
    (CASES_SOURCE.match(/if \(!fallbackAllowed\)/g) || []).length,
    2,
    'both fallback assignments must be preceded by an explicit !fallbackAllowed guard'
  );
});

test('an unavailable secret fails loudly instead of falling back silently', () => {
  assert.match(
    CASES_SOURCE,
    /Stripe API secret is unavailable and the live Payment Link fallback is disabled; refusing to charge/,
    'an unusable key must return a 503 rather than routing to a real payment link'
  );
  assert.match(
    CASES_SOURCE,
    /Stripe checkout API failed with[\s\S]*?live Payment Link fallback is disabled; refusing to charge a real card/,
    'a failed Checkout Session must return a 503 rather than routing to a real payment link'
  );
});

test('the disabled fallback still reports a 503 to the client', () => {
  const refusals = CASES_SOURCE.match(/Payments are temporarily unavailable\. Please contact us to complete your order\./g) || [];
  assert.equal(refusals.length, 2, 'both blocked paths must surface the same safe error');
});

test('health never advertises the live fallback as available without the flag', async () => {
  const { onRequestGet: health } = await import('../functions/api/health.js');

  const response = await health({
    env: {
      STRIPE_SECRET_KEY: LIVE_KEY,
      STRIPE_WEBHOOK_SECRET: 'whsec_test',
      STRIPE_PRICE_199: 'p', STRIPE_PRICE_299: 'p', STRIPE_PRICE_999: 'p',
      CASES: {}, R2: {}, OPENAI_API_KEY: 'k',
    },
    request: new Request('https://example.com/api/health'),
  });
  const body = await response.json();
  assert.equal(body.stripe.checkout.paymentLinkFallbackConfigured, false);
  assert.equal(body.stripe.checkout.paymentLinkFallbackEnabled, false);

  const enabled = await health({
    env: {
      STRIPE_SECRET_KEY: LIVE_KEY,
      STRIPE_WEBHOOK_SECRET: 'whsec_test',
      STRIPE_PRICE_199: 'p', STRIPE_PRICE_299: 'p', STRIPE_PRICE_999: 'p',
      STRIPE_ALLOW_LIVE_PAYMENT_LINK_FALLBACK: 'true',
      CASES: {}, R2: {}, OPENAI_API_KEY: 'k',
    },
    request: new Request('https://example.com/api/health'),
  });
  const enabledBody = await enabled.json();
  assert.equal(enabledBody.stripe.checkout.paymentLinkFallbackEnabled, true);
});

test('health keeps the live fallback disabled when only a test key is present', async () => {
  const { onRequestGet: health } = await import('../functions/api/health.js');

  const response = await health({
    env: {
      STRIPE_SECRET_KEY: TEST_KEY,
      STRIPE_WEBHOOK_SECRET: 'whsec_test',
      STRIPE_PRICE_199: 'p', STRIPE_PRICE_299: 'p', STRIPE_PRICE_999: 'p',
      STRIPE_ALLOW_LIVE_PAYMENT_LINK_FALLBACK: 'true',
      CASES: {}, R2: {}, OPENAI_API_KEY: 'k',
    },
    request: new Request('https://example.com/api/health'),
  });
  const body = await response.json();
  assert.equal(
    body.stripe.checkout.paymentLinkFallbackEnabled,
    false,
    'a test key must never be reported as live-fallback capable'
  );
});
