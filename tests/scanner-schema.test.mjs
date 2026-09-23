import test from 'node:test';
import assert from 'node:assert/strict';
import { extractVisionDocument, __visionTest } from '../functions/api/assistant/_vision.js';
import { GEMINI_EXTRACTION_SCHEMA, EXTRACTION_FIELD_NAMES } from '../functions/api/assistant/_schema.js';

const SAMPLE_B64 = 'A'.repeat(80);

function completeExtraction(overrides = {}) {
  const data = {};
  for (const name of EXTRACTION_FIELD_NAMES) {
    data[name] = { value: null, found: false, confident: false };
  }
  return Object.assign(data, { unknownFields: [], legibility: 'good' }, overrides);
}

test('Gemini scanner request enforces the full structured extraction schema', async (t) => {
  const originalFetch = globalThis.fetch;
  let sentBody = null;
  t.after(() => { globalThis.fetch = originalFetch; });

  globalThis.fetch = async (url, init) => {
    assert.match(String(url), /generativelanguage\.googleapis\.com/);
    sentBody = JSON.parse(init.body);
    return new Response(JSON.stringify({
      candidates: [{ content: { parts: [{ text: '{"legibility":"good"}' }] } }],
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  };

  await extractVisionDocument(
    { GEMINI_API_KEY: 'test', SCANNER_PROVIDER_TIMEOUT_MS: '8000' },
    { system: 'system', base64: SAMPLE_B64, mediaType: 'image/jpeg', prompt: 'prompt', validateText: () => true }
  );

  assert.equal(sentBody.generationConfig.responseMimeType, 'application/json');
  const schema = sentBody.generationConfig.responseSchema;
  assert.equal(schema.type, 'OBJECT');
  assert.ok(schema.required.includes('citationNumber'));
  assert.ok(schema.required.includes('violationCode'));
  assert.ok(schema.required.includes('legibility'));
  assert.deepEqual(schema.properties.legibility.enum, ['good', 'fair', 'poor']);
  assert.deepEqual(schema.properties.citationNumber.required, ['value', 'found', 'confident']);
});

test('schema requires all extraction fields plus quality metadata', () => {
  assert.equal(GEMINI_EXTRACTION_SCHEMA.type, 'OBJECT');
  assert.ok(GEMINI_EXTRACTION_SCHEMA.required.length >= 20);
  for (const key of ['defendantName', 'citationNumber', 'caseNumber', 'courtOrAgency', 'courtStreetAddress', 'courtMailingAddress', 'courtCityStateZip', 'courtBranchName', 'bailAmount', 'bailDepositedAmount', 'unknownFields', 'legibility']) {
    assert.ok(GEMINI_EXTRACTION_SCHEMA.required.includes(key));
    assert.ok(GEMINI_EXTRACTION_SCHEMA.properties[key]);
  }
});

test('fallback validator rejects partial JSON and accepts a complete extraction contract', () => {
  assert.equal(__visionTest.validExtractionText('{"legibility":"good"}'), false);
  const complete = completeExtraction({
    citationNumber: { value: 'A1234567', found: true, confident: true },
  });
  assert.equal(__visionTest.validExtractionText(JSON.stringify(complete)), true);
});

test('transport validator accepts typed field flags for deterministic normalization', () => {
  const transportValid = completeExtraction({
    citationNumber: { value: null, found: false, confident: true },
  });
  assert.equal(__visionTest.validExtractionText(JSON.stringify(transportValid)), true);
});
