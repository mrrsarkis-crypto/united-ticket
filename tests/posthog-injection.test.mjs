import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { onRequest } from '../functions/_middleware.js';

const PAGE = '<!doctype html><html><head><title>t</title></head><body></body></html>';

async function render(pathname, html = PAGE) {
  const response = await onRequest({
    request: new Request('https://unitedtraffictickets.com' + pathname),
    next: async () => new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8' } })
  });
  return response.text();
}

function posthogScript(html) {
  const match = html.match(/<script>(!function\(t,e\)[^]*?)<\/script>/);
  return match && match[1];
}

test('PostHog loads on public pages, including ad-free ones', async () => {
  for (const pathname of ['/', '/speeding-ticket', '/assistant', '/404', '/bot-courthouse']) {
    const html = await render(pathname);
    assert.ok(posthogScript(html), `${pathname} is missing the PostHog snippet`);
  }
});

test('PostHog stays off admin pages', async () => {
  for (const pathname of ['/admin', '/admin-cases', '/admin-funnel.html', '/admin/x']) {
    const html = await render(pathname);
    assert.equal(html.includes('posthog'), false, `${pathname} loads PostHog`);
  }
});

test('PostHog is not injected twice', async () => {
  const once = await render('/');
  const twice = await render('/', once);
  assert.equal(twice.split('posthog.init(').length - 1, 1);
});

// Runs the snippet in a stub browser and returns the queued init config,
// plus a function that fires the consent banner's event.
function boot(script, stored) {
  const listeners = {};
  const fakeScript = { parentNode: { insertBefore() {} } };
  const window = {
    addEventListener: (type, fn) => { listeners[type] = fn; }
  };
  window.window = window;
  window.document = { createElement: () => ({}), getElementsByTagName: () => [fakeScript] };
  window.localStorage = { getItem: (k) => (k === 'uttAdConsent' ? stored : null) };
  vm.runInNewContext(script, window);
  const posthog = window.posthog;
  return {
    config: posthog._i[0][1],
    token: posthog._i[0][0],
    consent: (state) => listeners['utt:ad-consent']({ detail: { state } }),
    queued: () => JSON.parse(JSON.stringify(posthog.filter((call) => call[0] === 'set_config').map((call) => call[1])))
  };
}

test('PostHog uses memory persistence until the visitor grants consent', async () => {
  const script = posthogScript(await render('/'));
  const fresh = boot(script, null);
  assert.match(fresh.token, /^phc_/);
  assert.equal(fresh.config.api_host, 'https://us.i.posthog.com');
  assert.equal(fresh.config.persistence, 'memory');
  assert.equal(fresh.config.session_recording.maskAllInputs, true);
  fresh.consent('granted');
  fresh.consent('denied');
  assert.deepEqual(fresh.queued(), [{ persistence: 'localStorage+cookie' }, { persistence: 'memory' }]);

  assert.equal(boot(script, 'granted').config.persistence, 'localStorage+cookie');
  assert.equal(boot(script, 'denied').config.persistence, 'memory');
});
