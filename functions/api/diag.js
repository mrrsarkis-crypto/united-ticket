// TEMP DIAGNOSTIC — GET /api/diag?s=<stage>&code=ADMIN_CODE
// Stage isolation for the custom-domain vs pages.dev 502 split.
// Gated by ADMIN_CODE (same as /api/cases/admin). Does not return secret values.
import { json, anthropic, anthropicText, unauthorizedIfNotAdmin } from './_shared.js';

const TIMEOUT_MS = 10000;

async function probe(url, options = {}, headers = {}) {
  const started = Date.now();
  try {
    const res = await fetch(url, { ...options, headers: { ...(options.headers || {}), ...headers }, signal: AbortSignal.timeout(TIMEOUT_MS) });
    const text = await res.text().catch(() => '');
    return { url, ok: res.ok, status: res.status, ms: Date.now() - started, thrown: null, slice: text.slice(0, 120) };
  } catch (e) {
    return { url, ok: false, status: null, ms: Date.now() - started, thrown: String(e && e.message || e).slice(0, 200), slice: null };
  }
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const denied = unauthorizedIfNotAdmin(request, env);
  if (denied) return denied;
  const stage = new URL(request.url).searchParams.get('s') || 'all';
  const out = { ts: new Date().toISOString(), stage, started: Date.now() };

  const finish = () => { out.ms = Date.now() - out.started; return json(out, 200); };

  if (stage === 'kvgetjson') {
    try { const v = await env.CASES.get('session:test-123', 'json'); out.kv = { ok: true, value: v }; }
    catch (e) { out.kv = { ok: false, err: String(e).slice(0, 200) }; }
    return finish();
  }

  if (stage === 'kvput') {
    try { await env.CASES.put('session:diagput', JSON.stringify({ a: 1 }), { expirationTtl: 300 }); out.kv = { ok: true }; }
    catch (e) { out.kv = { ok: false, err: String(e).slice(0, 200) }; }
    return finish();
  }

  if (stage === 'anthropic') {
    // Real anthropic() helper, empty-key shape like production.
    try {
      const data = await anthropic(env, { system: 'x', messages: [{ role: 'user', content: 'ping' }], max_tokens: 16, temperature: 0.2, tools: [{ name: 'check_next_steps', description: 'd', input_schema: { type: 'object', properties: {}, required: [] } }] });
      out.anthropic = { ok: true, text: anthropicText(data).slice(0, 120) };
    } catch (e) { out.anthropic = { ok: false, err: String(e && e.message || e).slice(0, 300) }; }
    return finish();
  }

  if (stage === 'postraw') {
    // Raw POST to Anthropic exactly like anthropic() with whatever key exists.
    const headers = { 'Content-Type': 'application/json', 'x-api-key': env.ANTHROPIC_API_KEY || '', 'anthropic-version': '2023-06-01' };
    if (env.ANTHROPIC_WORKSPACE_ID) headers['anthropic-workspace-id'] = env.ANTHROPIC_WORKSPACE_ID;
    const r = await probe('https://api.anthropic.com/v1/messages', { method: 'POST', body: JSON.stringify({ model: 'claude-3-5-sonnet-20241022', system: 'x', messages: [{ role: 'user', content: 'ping' }], max_tokens: 16, temperature: 0.2 }) }, headers);
    out.postraw = r;
    return finish();
  }

  if (stage === 'chat') {
    // Mirrors chat.js onRequestPost message-present path.
    out.envKeyLen = (env.ANTHROPIC_API_KEY || '').length;
    try {
      const prior = await env.CASES.get('session:test-123', 'json');
      out.historyLoaded = Array.isArray(prior);
    } catch (e) { out.historyErr = String(e).slice(0, 200); }
    const history = [{ role: 'user', content: 'ping' }];
    try {
      let data = await anthropic(env, { system: 'sys', messages: history, max_tokens: 1024, tools: [] });
      out.finalText = anthropicText(data).slice(0, 120);
    } catch (e) {
      console.error('Anthropic chat error', e);
      out.caught = String(e && e.message || e).slice(0, 300);
    }
    return finish();
  }

  if (stage === 'extract') {
    // Mirrors extract.js pipeline (no fetch thrown pre-key, anthropic throws).
    try {
      const data = await anthropic(env, {
        system: 'sys',
        max_tokens: 1500,
        temperature: 0,
        messages: [{ role: 'user', content: [{ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: 'AAAAAgAACgoKCgoKCgoKCgoKCgoKAAD/2Q==AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=' } }, { type: 'text', text: 'Read this citation. Output ONLY JSON.' }] }],
      });
      out.text = anthropicText(data).slice(0, 120);
    } catch (e) {
      console.error('Anthropic extract error', e);
      out.caught = String(e && e.message || e).slice(0, 300);
    }
    return finish();
  }

  // stage 'all' → the default health report.
  const kvResult = { present: !!env.CASES, read: null, listCount: null };
  if (env.CASES) {
    try {
      const v = await env.CASES.get('session:diag');
      kvResult.read = v === null ? 'null' : 'ok';
      const list = await env.CASES.list({ prefix: 'case:', limit: 1 });
      kvResult.listCount = Array.isArray(list.keys) ? list.keys.length : -1;
    } catch (e) { kvResult.read = 'threw: ' + String(e && e.message || e).slice(0, 120); }
  }

  const endpoints = [];
  endpoints.push(await probe('https://api.anthropic.com/v1/models', {}, { 'x-api-key': (env.ANTHROPIC_API_KEY || 'MISSING') }));
  endpoints.push(await probe('https://www.google.com/', {}, {}));
  endpoints.push(await probe('https://api.stripe.com/v1/prices?limit=1', {}, { 'Authorization': 'Bearer ' + (env.STRIPE_SECRET_KEY || 'MISSING') }));
  endpoints.push(await probe('https://api.resend.com/domains', {}, { 'Authorization': 'Bearer ' + (env.RESEND_API_KEY || 'MISSING') }));

  out.envPresent = {
    ANTHROPIC_API_KEY: !!env.ANTHROPIC_API_KEY,
    ANTHROPIC_WORKSPACE_ID: !!env.ANTHROPIC_WORKSPACE_ID,
    RESEND_API_KEY: !!env.RESEND_API_KEY,
    STRIPE_SECRET_KEY: !!env.STRIPE_SECRET_KEY,
    STRIPE_WEBHOOK_SECRET: !!env.STRIPE_WEBHOOK_SECRET,
    DEBUG_MODE: env.DEBUG_MODE,
    ADMIN_CODE: !!env.ADMIN_CODE,
    ADMIN_EMAIL: !!env.ADMIN_EMAIL,
    RESEND_FROM: env.RESEND_FROM || null,
    STRIPE_PRICE_199: !!env.STRIPE_PRICE_199,
    CASES: !!env.CASES,
    R2: !!env.R2,
  };
  out.kv = kvResult;
  out.endpoints = endpoints;
  return finish();
}