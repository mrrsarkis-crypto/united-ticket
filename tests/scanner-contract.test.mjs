import test from 'node:test';
import assert from 'node:assert/strict';
import { __scannerTest } from '../functions/api/assistant/extract.js';
import { extractVisionDocument, __visionTest } from '../functions/api/assistant/_vision.js';

const {
  isAllowedScannerRequest,
  enforceScannerRateLimit,
  normalizeClientQuality,
  parseDocumentInput,
  normalizeExtraction,
  buildScanAssessment,
  extractJson,
  shouldAttemptPrecisionPass,
} = __scannerTest;
const SAMPLE_B64 = 'A'.repeat(80);

test('accepts same-origin scanner calls and rejects cross-site browser calls', () => {
  const sameOrigin = new Request('https://unitedtraffictickets.com/api/assistant/extract', {
    headers: { origin: 'https://unitedtraffictickets.com', 'sec-fetch-site': 'same-origin' },
  });
  const crossSite = new Request('https://unitedtraffictickets.com/api/assistant/extract', {
    headers: { origin: 'https://example.com', 'sec-fetch-site': 'cross-site' },
  });
  assert.equal(isAllowedScannerRequest(sameOrigin, {}), true);
  assert.equal(isAllowedScannerRequest(crossSite, {}), false);
});

test('allows explicit trusted scanner origins and non-browser server requests', () => {
  const configured = new Request('https://api.example.net/api/assistant/extract', {
    headers: { origin: 'capacitor://localhost' },
  });
  const serverRequest = new Request('https://unitedtraffictickets.com/api/assistant/extract');
  assert.equal(isAllowedScannerRequest(configured, { SCANNER_ALLOWED_ORIGINS: 'capacitor://localhost' }), true);
  assert.equal(isAllowedScannerRequest(serverRequest, {}), true);
});

test('rate limiter hashes client identity and stops bursts over the configured minute limit', async () => {
  const map = new Map();
  const CASES = {
    async get(key) { return map.get(key) || null; },
    async put(key, value) { map.set(key, value); },
  };
  const request = new Request('https://unitedtraffictickets.com/api/assistant/extract', {
    headers: { 'cf-connecting-ip': '203.0.113.44' },
  });
  const env = { CASES, SCANNER_RATE_LIMIT_PER_MINUTE: '5', SCANNER_RATE_LIMIT_SALT: 'test-salt' };
  for (let i = 0; i < 5; i++) {
    const result = await enforceScannerRateLimit(request, env);
    assert.equal(result.allowed, true);
    assert.equal(result.enforced, true);
  }
  const blocked = await enforceScannerRateLimit(request, env);
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.remaining, 0);
  assert.ok(blocked.retryAfter >= 1 && blocked.retryAfter <= 60);
  assert.equal([...map.keys()].some((key) => key.includes('203.0.113.44')), false);
});

test('rate limiter fails open if no shared store is bound', async () => {
  const request = new Request('https://unitedtraffictickets.com/api/assistant/extract', {
    headers: { 'x-forwarded-for': '203.0.113.10' },
  });
  const result = await enforceScannerRateLimit(request, {});
  assert.equal(result.allowed, true);
  assert.equal(result.enforced, false);
});

test('client quality metadata is bounded and unknown warnings are discarded', () => {
  const quality = normalizeClientQuality({
    width: 99999,
    height: 240,
    brightness: -2,
    contrast: 12.34,
    sharpness: 3.21,
    grade: 'poor',
    hardReject: true,
    warnings: ['low_resolution', 'possible_blur', 'made_up_warning'],
  });
  assert.equal(quality.width, 20000);
  assert.equal(quality.height, 240);
  assert.equal(quality.brightness, 0);
  assert.equal(quality.hardReject, true);
  assert.deepEqual(quality.warnings, ['low_resolution', 'possible_blur']);
});

test('accepts a bounded JPEG data URL and measures decoded size', () => {
  const parsed = parseDocumentInput('data:image/jpeg;base64,' + SAMPLE_B64);
  assert.equal(parsed.mediaType, 'image/jpeg');
  assert.equal(parsed.fileBytes, 60);
  assert.equal(parsed.error, undefined);
});

test('rejects malformed base64 and unsupported media', () => {
  assert.equal(parseDocumentInput('data:image/jpeg;base64,%%%%').status, 400);
  assert.equal(parseDocumentInput('data:image/gif;base64,' + SAMPLE_B64).status, 415);
});

test('normalizes fields and scrubs unrelated shopping content', () => {
  const result = normalizeExtraction({
    citationNumber: { value: ' AB-12345 ', found: true, confident: true },
    violationCode: '22350',
    violationDescription: { value: 'AliExpress product listing', found: true, confident: true },
    legibility: 'good',
    unknownFields: ['officerName', 'dropshipping item'],
  });
  assert.deepEqual(result.citationNumber, { value: 'AB-12345', found: true, confident: true });
  assert.deepEqual(result.violationCode, { value: '22350', found: true, confident: false });
  assert.deepEqual(result.violationDescription, { value: null, found: false, confident: false });
  assert.deepEqual(result.unknownFields, ['officerName']);
});

test('scan confidence is quality confidence, not a win probability', () => {
  const normalized = normalizeExtraction({
    citationNumber: { value: 'A1234567', found: true, confident: true },
    violationCode: { value: '22350', found: true, confident: true },
    courtOrAgency: { value: 'Los Angeles Superior Court', found: true, confident: true },
    dueDate: { value: '10/20/2026', found: true, confident: true },
    violationDate: { value: '09/01/2026', found: true, confident: true },
    legibility: 'good',
  });
  const assessment = buildScanAssessment(normalized);
  assert.equal(assessment.label, 'Strong read');
  assert.equal(assessment.scanConfidencePercent, 100);
  assert.equal(assessment.needsManualReview, false);
});

test('poor or incomplete reads never become Strong read', () => {
  const normalized = normalizeExtraction({
    citationNumber: { value: 'A1234567', found: true, confident: false },
    violationCode: { value: '22350', found: true, confident: false },
    legibility: 'poor',
  });
  const assessment = buildScanAssessment(normalized);
  assert.equal(assessment.label, 'Needs review');
  assert.ok(assessment.scanConfidencePercent < 55);
});

test('extractJson isolates the first complete JSON object', () => {
  const text = 'prefix ```json\n{"citationNumber":{"value":"A1","found":true,"confident":true},"note":"brace } inside string"}\n``` suffix';
  const parsed = JSON.parse(extractJson(text));
  assert.equal(parsed.citationNumber.value, 'A1');
});

test('vision pipeline fails closed when no provider is configured', async () => {
  await assert.rejects(
    extractVisionDocument({}, { system: 'x', base64: SAMPLE_B64, mediaType: 'image/jpeg', prompt: 'x' }),
    /No scanner vision provider configured/
  );
});

test('all-provider failure exposes only safe fallback diagnostics', async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async () => new Response(JSON.stringify({ error: { message: 'invalid API key' } }), {
    status: 401,
    headers: { 'content-type': 'application/json' },
  });
  await assert.rejects(
    extractVisionDocument(
      { GEMINI_API_KEY: 'test-gemini', SCANNER_PROVIDER_TIMEOUT_MS: '4000' },
      { system: 'x', base64: SAMPLE_B64, mediaType: 'image/jpeg', prompt: 'x' }
    ),
    (error) => {
      assert.deepEqual(error.fallbacks, [{ provider: 'gemini', category: 'auth', status: 401 }]);
      return /All configured scanner vision providers failed/.test(String(error.message));
    }
  );
});

test('PDF scan refuses an Anthropic-only configuration instead of sending PDF as image', async () => {
  await assert.rejects(
    extractVisionDocument({ ANTHROPIC_API_KEY: 'test' }, { system: 'x', base64: SAMPLE_B64, mediaType: 'application/pdf', prompt: 'x' }),
    /PDF scanning requires a configured OpenAI, Gemini, or AI Gateway provider/
  );
});

test('OpenAI Astra is selected first when configured and preserves strict extraction', async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  let requestUrl;
  let requestBody;
  globalThis.fetch = async (url, init) => {
    requestUrl = String(url);
    requestBody = JSON.parse(init.body);
    return new Response(JSON.stringify({
      output_text: '{"legibility":"good"}',
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  };

  const result = await extractVisionDocument(
    {
      OPENAI_API_KEY: 'test-openai',
      GEMINI_API_KEY: 'test-gemini',
      SCANNER_PROVIDER_TIMEOUT_MS: '8000',
    },
    {
      system: 'x',
      base64: SAMPLE_B64,
      mediaType: 'image/jpeg',
      prompt: 'x',
      validateText: () => true,
    }
  );
  assert.equal(result.provider, 'openai');
  assert.equal(result.attempts, 1);
  assert.match(requestUrl, /api\.openai\.com\/v1\/responses$/);
  assert.equal(requestBody.model, 'gpt-5.6-luna');
  assert.equal(requestBody.reasoning.effort, 'low');
  assert.equal(requestBody.text.format.type, 'json_schema');
  assert.equal(requestBody.text.format.strict, true);
});

test('precision pass can reuse the provider that already succeeded', async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  let requestUrl;
  globalThis.fetch = async (url) => {
    requestUrl = String(url);
    return new Response(JSON.stringify({ choices: [{ message: { content: '{\"legibility\":\"good\"}' } }] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };
  const result = await extractVisionDocument(
    { OPENAI_API_KEY: 'test-openai', GROQ_API_KEY: 'test-groq', SCANNER_PROVIDER_TIMEOUT_MS: '8000' },
    { system: 'x', base64: SAMPLE_B64, mediaType: 'image/jpeg', prompt: 'x', preferredProvider: 'groq', validateText: () => true }
  );
  assert.equal(result.provider, 'groq');
  assert.match(requestUrl, /api\.groq\.com\/openai\/v1\/chat\/completions$/);
});

test('OpenAI Astra sends PDFs as Responses API input_file content', async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  let requestBody;
  globalThis.fetch = async (_url, init) => {
    requestBody = JSON.parse(init.body);
    return new Response(JSON.stringify({ output_text: '{"legibility":"good"}' }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };
  const result = await extractVisionDocument(
    { OPENAI_API_KEY: 'test-openai', SCANNER_PROVIDER_TIMEOUT_MS: '8000' },
    { system: 'x', base64: SAMPLE_B64, mediaType: 'application/pdf', prompt: 'x', validateText: () => true }
  );
  const filePart = requestBody.input[0].content.find((part) => part.type === 'input_file');
  assert.equal(result.provider, 'openai');
  assert.equal(filePart.filename, 'traffic-document.pdf');
  assert.equal(filePart.file_data, SAMPLE_B64);
});

test('rate-limited provider is cooled down for the next request', async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
    __visionTest.resetProviderCooldowns();
  });
  __visionTest.resetProviderCooldowns();
  let openAiCalls = 0;
  let groqCalls = 0;
  globalThis.fetch = async (url) => {
    const target = String(url);
    if (target.includes('api.openai.com')) {
      openAiCalls++;
      return new Response(JSON.stringify({ error: { message: 'rate limit reached' } }), {
        status: 429,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (target.includes('api.groq.com')) {
      groqCalls++;
      return new Response(JSON.stringify({ choices: [{ message: { content: '{"legibility":"good"}' } }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    throw new Error('unexpected provider URL');
  };

  const env = {
    OPENAI_API_KEY: 'test-openai',
    GROQ_API_KEY: 'test-groq',
    SCANNER_PROVIDER_TIMEOUT_MS: '8000',
  };
  const input = {
    system: 'x',
    base64: SAMPLE_B64,
    mediaType: 'image/jpeg',
    prompt: 'x',
    validateText: () => true,
  };

  const first = await extractVisionDocument(env, input);
  const second = await extractVisionDocument(env, input);

  assert.equal(first.provider, 'groq');
  assert.deepEqual(first.fallbacks, [{ provider: 'openai', category: 'rate_limit', status: 429 }]);
  assert.equal(second.provider, 'groq');
  assert.deepEqual(second.fallbacks, [{ provider: 'openai', category: 'rate_limit', status: 429, cooldown: true }]);
  assert.equal(openAiCalls, 1);
  assert.equal(groqCalls, 2);
});

test('Cloudflare Workers AI OCR uses the native binding before external fallbacks', async () => {
  let model;
  let payload;
  const env = {
    AI: {
      run: async (name, input) => {
        model = name;
        payload = input;
        return { answer: '{"legibility":"good"}' };
      },
    },
    GROQ_API_KEY: 'test-groq',
    SCANNER_PROVIDER_TIMEOUT_MS: '8000',
  };
  const result = await extractVisionDocument(
    env,
    {
      system: 'literal OCR',
      base64: SAMPLE_B64,
      mediaType: 'image/jpeg',
      prompt: 'extract',
      validateText: () => true,
    }
  );
  assert.equal(result.provider, 'workersai');
  assert.equal(model, '@cf/moondream/moondream3.1-9B-A2B');
  assert.equal(payload.task, 'query');
  assert.match(payload.image, /^data:image\/jpeg;base64,/);
  assert.equal(payload.reasoning, false);
  assert.equal(payload.stream, false);
});

test('Gemini transport response is returned with provider metadata', async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async () => new Response(JSON.stringify({
    candidates: [{ content: { parts: [{ text: '{"legibility":"good"}' }] } }],
  }), { status: 200, headers: { 'content-type': 'application/json' } });

  const result = await extractVisionDocument(
    { GEMINI_API_KEY: 'test', SCANNER_PROVIDER_TIMEOUT_MS: '8000' },
    { system: 'x', base64: SAMPLE_B64, mediaType: 'image/jpeg', prompt: 'x', validateText: () => true }
  );
  assert.equal(result.provider, 'gemini');
  assert.equal(result.attempts, 1);
  assert.equal(result.text, '{"legibility":"good"}');
});

test('Groq fallback requests strict schema output', async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  let requestBody;
  globalThis.fetch = async (_url, init) => {
    requestBody = JSON.parse(init.body);
    return new Response(JSON.stringify({ choices: [{ message: { content: '{"legibility":"good"}' } }] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };

  const result = await extractVisionDocument(
    { GROQ_API_KEY: 'test-groq', SCANNER_PROVIDER_TIMEOUT_MS: '8000' },
    { system: 'x', base64: SAMPLE_B64, mediaType: 'image/jpeg', prompt: 'x', validateText: () => true }
  );
  assert.equal(result.provider, 'groq');
  assert.equal(requestBody.response_format.type, 'json_schema');
  assert.equal(requestBody.response_format.json_schema.strict, true);
  assert.equal(requestBody.max_completion_tokens, 1800);
  assert.equal(requestBody.response_format.json_schema.schema.additionalProperties, false);
});

test('default fallback prefers Groq before slower DashScope when OpenAI is unavailable', async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  let requestUrl;
  globalThis.fetch = async (url) => {
    requestUrl = String(url);
    return new Response(JSON.stringify({ choices: [{ message: { content: '{\"legibility\":\"good\"}' } }] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };
  const result = await extractVisionDocument(
    { GROQ_API_KEY: 'test-groq', GEMINI_API_KEY: 'test-gemini', DASHSCOPE_API_KEY: 'test-dashscope', SCANNER_PROVIDER_TIMEOUT_MS: '8000' },
    { system: 'x', base64: SAMPLE_B64, mediaType: 'image/jpeg', prompt: 'x', validateText: () => true }
  );
  assert.equal(result.provider, 'groq');
  assert.match(requestUrl, /api\.groq\.com\/openai\/v1\/chat\/completions$/);
});

test('DashScope OCR uses the current OCR model and Base64 image input', async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  let requestUrl;
  let requestBody;
  globalThis.fetch = async (url, init) => {
    requestUrl = String(url);
    requestBody = JSON.parse(init.body);
    return new Response(JSON.stringify({
      choices: [{ message: { content: '{"legibility":"good"}' } }],
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  };

  const result = await extractVisionDocument(
    {
      DASHSCOPE_API_KEY: 'test-dashscope',
      SCANNER_VISION_PROVIDER: 'dashscope',
      SCANNER_PROVIDER_TIMEOUT_MS: '8000',
    },
    { system: 'literal OCR', base64: SAMPLE_B64, mediaType: 'image/jpeg', prompt: 'extract', validateText: () => true }
  );
  assert.equal(result.provider, 'dashscope');
  assert.equal(requestBody.model, 'qwen3.5-ocr');
  assert.match(requestUrl, /dashscope-us\.aliyuncs\.com\/compatible-mode\/v1\/chat\/completions$/);
  assert.match(requestBody.messages[0].content[0].image_url.url, /^data:image\/jpeg;base64,/);
  assert.equal(requestBody.max_tokens, 2200);
});

test('invalid Gemini extraction automatically falls back to Anthropic', async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async (url) => {
    if (String(url).includes('generativelanguage.googleapis.com')) {
      return new Response(JSON.stringify({
        candidates: [{ content: { parts: [{ text: 'not valid json' }] } }],
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (String(url).includes('api.anthropic.com')) {
      return new Response(JSON.stringify({
        content: [{ type: 'text', text: '{"legibility":"fair"}' }],
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    throw new Error('unexpected provider URL');
  };

  const result = await extractVisionDocument(
    {
      GEMINI_API_KEY: 'test-gemini',
      ANTHROPIC_API_KEY: 'test-anthropic',
      SCANNER_PROVIDER_TIMEOUT_MS: '8000',
    },
    {
      system: 'x',
      base64: SAMPLE_B64,
      mediaType: 'image/jpeg',
      prompt: 'x',
      validateText: (text) => text === '{"legibility":"fair"}',
    }
  );
  assert.equal(result.provider, 'anthropic');
  assert.equal(result.attempts, 2);
  assert.equal(result.text, '{"legibility":"fair"}');
  assert.deepEqual(result.fallbacks, [{ provider: 'gemini', category: 'invalid_response', status: null }]);
});


test('precision pass only triggers for ambiguous ticket reads', () => {
  const weak = { legibility: 'good', citationNumber: { value: null, found: false, confident: false }, violationCode: { value: null, found: false, confident: false }, courtOrAgency: { value: 'Court', found: true, confident: true }, violationDate: { value: null, found: false, confident: false } };
  const clear = { legibility: 'good', citationNumber: { value: 'ABC1234', found: true, confident: true }, violationCode: { value: '22350', found: true, confident: true }, courtOrAgency: { value: 'Court', found: true, confident: true }, violationDate: { value: '09/15/2026', found: true, confident: true }, courtDate: { value: '10/15/2026', found: true, confident: true }, dueDate: { value: '09/30/2026', found: true, confident: true }, bailAmount: { value: '$100', found: true, confident: true } };
  assert.equal(__scannerTest.shouldRunPrecisionPass('ticket', weak), true);
  assert.equal(__scannerTest.shouldRunPrecisionPass('ticket', clear), false);
  assert.equal(__scannerTest.shouldRunPrecisionPass('license', weak), false);
});

test('quota-sensitive fallback providers skip duplicate precision calls', () => {
  const weak = { legibility: 'good', citationNumber: { value: null, found: false, confident: false }, violationCode: { value: null, found: false, confident: false }, courtOrAgency: { value: 'Court', found: true, confident: true }, violationDate: { value: null, found: false, confident: false } };
  assert.equal(shouldAttemptPrecisionPass('groq', 2500, 'ticket', weak), false);
  assert.equal(shouldAttemptPrecisionPass('dashscope', 2500, 'ticket', weak), false);
  assert.equal(shouldAttemptPrecisionPass('openai', 2500, 'ticket', weak), true);
  assert.equal(shouldAttemptPrecisionPass('gemini', 9000, 'ticket', weak), false);
});

test('precision pass prefers the extraction with more reliable key fields', () => {
  const base = (cite, code) => ({ legibility: 'good', citationNumber: { value: cite, found: !!cite, confident: !!cite }, violationCode: { value: code, found: !!code, confident: !!code }, courtOrAgency: { value: 'Court', found: true, confident: true }, violationDate: { value: '09/15/2026', found: true, confident: true }, unknownFields: [] });
  assert.equal(__scannerTest.preferExtraction(base('ABC1234','22350'), [], base(null,null), [], 'ticket'), true);
});
