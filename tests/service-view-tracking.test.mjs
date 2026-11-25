import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { runInNewContext } from 'node:vm';
import { fileURLToPath } from 'node:url';
import { priceFor } from '../functions/api/_shared.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tracking = fs.readFileSync(path.join(root, 'public', 'service-view-tracking.js'), 'utf8');
const middleware = fs.readFileSync(path.join(root, 'functions', '_middleware.js'), 'utf8');
const buildScript = fs.readFileSync(path.join(root, 'scripts', 'build-vercel.js'), 'utf8');

// Executable lines only: comments legitimately name things while explaining why
// they are avoided (e.g. "does NOT emit purchase").
const trackingCode = tracking
  .split('\n')
  .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
  .join('\n');

test('tracking emits view_item for service pages', () => {
  assert.match(trackingCode, /'event',\s*'view_item'/, 'missing view_item event');
});

test('tracking emits view_item_list for the services index', () => {
  assert.match(trackingCode, /'event',\s*'view_item_list'/, 'missing view_item_list event');
});

test('tracking never emits purchase or other revenue events', () => {
  // Checkout happens on Stripe's hosted page, so a browser-side purchase event
  // could only be guessed at on the return trip. Fabricated conversions are
  // worse than none, so this must never appear here.
  for (const forbidden of ['purchase', 'add_to_cart', 'begin_checkout', 'refund']) {
    assert.equal(
      new RegExp(`'event',\\s*'${forbidden}'`).test(trackingCode),
      false,
      `service-view-tracking.js emits a '${forbidden}' event; revenue events must not be guessed client-side`
    );
  }
});

test('tracking does not send per-user or PII fields', () => {
  // Match these only as payload *keys* (e.g. `email:`), so a service slug like
  // `utt_svc_cell_phone` or the item name is not mistaken for PII being sent.
  for (const pii of ['email', 'phone', 'user_data', 'user_properties', 'address']) {
    assert.equal(
      new RegExp(`['"]?${pii}['"]?\\s*:`, 'i').test(trackingCode),
      false,
      `service-view-tracking.js sends ${pii} as an event field; no PII may accompany an analytics event`
    );
  }
});

test('service views attach prices only for supported checkout tiers', () => {
  function eventFor(pathname) {
    const window = { location: { pathname }, dataLayer: [] };
    runInNewContext(tracking, { window });
    assert.equal(window.dataLayer.length, 1);
    return window.dataLayer[0];
  }

  const list = eventFor('/services');
  assert.equal(list[1], 'view_item_list');
  assert.equal(list[2].items.length, 9);
  const priced = list[2].items.filter(item => Object.hasOwn(item, 'price'));
  assert.equal(priced.length, 7);
  for (const item of priced) {
    assert.ok(priceFor(String(item.price), {}), `$${item.price} is not a supported checkout tier`);
  }

  for (const [pathname, id] of [
    ['/suspended-license', 'utt_svc_suspended'],
    ['/fix-it-ticket', 'utt_svc_fix_it'],
  ]) {
    const listItem = list[2].items.find(item => item.item_id === id);
    assert.ok(listItem, `${id} must stay in the service list`);
    assert.equal(Object.hasOwn(listItem, 'price'), false);
    const view = eventFor(pathname);
    assert.equal(view[1], 'view_item');
    assert.equal(view[2].items[0].item_id, id);
    assert.equal(Object.hasOwn(view[2].items[0], 'price'), false);
    assert.equal(Object.hasOwn(view[2], 'value'), false);
  }

  const pricedView = eventFor('/speeding-ticket');
  assert.equal(pricedView[2].items[0].price, 199);
  assert.equal(pricedView[2].currency, 'USD');
  assert.equal(pricedView[2].value, 199);
});

test('tracking is idempotent so a double include cannot double-count', () => {
  assert.match(trackingCode, /__uttServiceViewTracked/, 'missing re-entry guard');
});

test('tracking only reads the parsed location, never storage', () => {
  // Reading or writing a second storage key here could disagree with the
  // consent banner's stored choice.
  for (const storage of ['localStorage', 'sessionStorage', 'document.cookie']) {
    assert.equal(
      trackingCode.includes(storage),
      false,
      `service-view-tracking.js touches ${storage}; consent state belongs to the banner alone`
    );
  }
});

test('middleware injects tracking on monetized standard pages only', () => {
  assert.match(
    middleware,
    /SERVICE_VIEW_TRACKING_SCRIPT/,
    'middleware does not define the tracking script tag'
  );
  assert.match(
    middleware,
    /SERVICE_VIEW_MARKER/,
    'middleware has no idempotency marker for the tracking script'
  );

  // The injection must live inside the standard-HTML monetized branch, which is
  // where the consent default is emitted, and never in the AMP branch.
  const standardBranch = middleware.slice(
    middleware.indexOf('if (isStandardHtml) {'),
    middleware.indexOf('} else if (isAmp')
  );
  assert.match(
    standardBranch,
    /SERVICE_VIEW_TRACKING_SCRIPT/,
    'tracking is not injected in the standard monetized branch that carries the consent default'
  );

  const ampBranch = middleware.slice(middleware.indexOf('} else if (isAmp'));
  assert.equal(
    ampBranch.includes('SERVICE_VIEW_TRACKING_SCRIPT'),
    false,
    'tracking must not be injected into AMP pages, which have no consent component'
  );
});

test('tracking refuses to run on AMP paths', () => {
  // AMP has no consent component, so an event there could not be gated.
  assert.match(
    trackingCode,
    /path === '\/amp'|\/\/amp\//,
    'service-view-tracking.js has no AMP guard'
  );
});

test('build script also injects tracking for the static/Vercel path', () => {
  assert.match(buildScript, /serviceViewTrackingTag/, 'build-vercel.js missing the tag constant');
  assert.match(
    buildScript,
    /service-view-tracking\.js/,
    'build-vercel.js does not inject service-view-tracking.js'
  );
});
