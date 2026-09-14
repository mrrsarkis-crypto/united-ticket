import test from 'node:test';
import assert from 'node:assert/strict';
import { __vercelScannerTest } from '../api/assistant/extract.js';

const { clientIdentity, configuredLimit, enforceLocalRateLimit, reset } = __vercelScannerTest;

test('Vercel limiter uses the first forwarded client IP', () => {
  const req = { headers: { 'x-forwarded-for': '203.0.113.9, 10.0.0.1' } };
  assert.equal(clientIdentity(req), '203.0.113.9');
});

test('Vercel limiter blocks bursts over the configured minute limit', () => {
  reset();
  const req = { headers: { 'x-forwarded-for': '203.0.113.44' } };
  const env = { SCANNER_RATE_LIMIT_PER_MINUTE: '5', SCANNER_RATE_LIMIT_SALT: 'test' };
  const now = Date.UTC(2026, 8, 14, 19, 0, 10);
  for (let i = 0; i < 5; i++) {
    const result = enforceLocalRateLimit(req, env, now);
    assert.equal(result.allowed, true);
    assert.equal(result.enforced, true);
  }
  const blocked = enforceLocalRateLimit(req, env, now);
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.remaining, 0);
  assert.ok(blocked.retryAfter >= 1 && blocked.retryAfter <= 60);
});

test('Vercel limiter isolates different client identities', () => {
  reset();
  const env = { SCANNER_RATE_LIMIT_PER_MINUTE: '5', SCANNER_RATE_LIMIT_SALT: 'test' };
  const now = Date.UTC(2026, 8, 14, 19, 0, 10);
  const first = { headers: { 'x-forwarded-for': '203.0.113.1' } };
  const second = { headers: { 'x-forwarded-for': '203.0.113.2' } };
  for (let i = 0; i < 5; i++) enforceLocalRateLimit(first, env, now);
  assert.equal(enforceLocalRateLimit(first, env, now).allowed, false);
  assert.equal(enforceLocalRateLimit(second, env, now).allowed, true);
});

test('Vercel limiter safely skips requests without a client identity', () => {
  reset();
  const result = enforceLocalRateLimit({ headers: {} }, {}, Date.now());
  assert.equal(result.allowed, true);
  assert.equal(result.enforced, false);
});

test('Vercel rate configuration is bounded', () => {
  assert.equal(configuredLimit({ SCANNER_RATE_LIMIT_PER_MINUTE: '1' }), 5);
  assert.equal(configuredLimit({ SCANNER_RATE_LIMIT_PER_MINUTE: '9999' }), 120);
  assert.equal(configuredLimit({ SCANNER_RATE_LIMIT_PER_MINUTE: '30' }), 30);
});
