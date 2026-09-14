import test from 'node:test';
import assert from 'node:assert/strict';
import { __scannerTest } from '../functions/api/assistant/extract.js';
import { extractVisionDocument } from '../functions/api/assistant/_vision.js';

const { parseDocumentInput, normalizeExtraction, buildScanAssessment, extractJson } = __scannerTest;
const SAMPLE_B64 = 'A'.repeat(80);

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

test('PDF scan refuses an Anthropic-only configuration instead of sending PDF as image', async () => {
  await assert.rejects(
    extractVisionDocument({ ANTHROPIC_API_KEY: 'test' }, { system: 'x', base64: SAMPLE_B64, mediaType: 'application/pdf', prompt: 'x' }),
    /PDF scanning requires a configured Gemini vision provider/
  );
});

test('Gemini JSON response is returned with provider metadata', async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async () => new Response(JSON.stringify({
    candidates: [{ content: { parts: [{ text: '{"legibility":"good"}' }] } }],
  }), { status: 200, headers: { 'content-type': 'application/json' } });

  const result = await extractVisionDocument(
    { GEMINI_API_KEY: 'test', SCANNER_PROVIDER_TIMEOUT_MS: '8000' },
    { system: 'x', base64: SAMPLE_B64, mediaType: 'image/jpeg', prompt: 'x' }
  );
  assert.equal(result.provider, 'gemini');
  assert.equal(result.attempts, 1);
  assert.equal(result.text, '{"legibility":"good"}');
});
