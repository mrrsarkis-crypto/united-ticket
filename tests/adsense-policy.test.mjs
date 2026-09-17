import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { access } from 'node:fs/promises';
import { test } from 'node:test';
import {
  ADSENSE_ACCOUNT,
  ADSENSE_AMP_PATHS,
  ADSENSE_INFORMATIONAL_PATHS,
  isAdsenseEligiblePath
} from '../public/adsense-policy.js';

test('allows only reviewed informational routes', () => {
  for (const path of [
    '/resources',
    '/resources.html',
    '/resources/speeding-ticket-deadlines',
    '/faq',
    '/courthouses/',
    '/courthouses/van-nuys.html',
    '/all-courthouses',
    '/amp/courthouses.html'
  ]) assert.equal(isAdsenseEligiblePath(path), true, path);
});

test('fails closed for sensitive, transactional, legal, and unknown routes', () => {
  for (const path of [
    '/', '/assistant', '/case', '/admin-cases', '/privacy', '/terms',
    '/contact', '/services', '/resources/one/two', '/unknown', '/%E0%A4%A',
    '/resources/not-a-real-page', '/courthouses/not-a-real-court',
    '/amp/resources', '/amp/faq', '/amp/courthouses/not-a-real-court',
    '/resources/%2e%2e/case', '/resources%2Fcase', '/resources\\case'
  ]) assert.equal(isAdsenseEligiblePath(path), false, path);
});

test('every approved route maps to a real source document', async () => {
  for (const path of [...ADSENSE_INFORMATIONAL_PATHS, ...ADSENSE_AMP_PATHS]) {
    await access(new URL(`../public${path}.html`, import.meta.url));
  }
});

test('ads.txt declares the configured Google publisher directly', async () => {
  const ads = await readFile(new URL('../public/ads.txt', import.meta.url), 'utf8');
  assert.equal(ads.trim(), `google.com, ${ADSENSE_ACCOUNT.replace('ca-', '')}, DIRECT, f08c47fec0942fa0`);
});
