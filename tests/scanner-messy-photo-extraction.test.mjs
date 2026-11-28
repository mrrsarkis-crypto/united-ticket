import test from 'node:test';
import assert from 'node:assert/strict';
import { onRequestPost } from '../functions/api/assistant/extract.js';
import { __visionTest, extractVisionDocument } from '../functions/api/assistant/_vision.js';

const MOCK_IMAGE_DATA = 'A'.repeat(80);

function visionReply(fields, confidentFields, legibility) {
  return {
    choices: [{ message: { content: JSON.stringify({
      ...fields,
      confidentFields,
      unknownFields: [],
      legibility,
    }) } }],
  };
}

function scanRequest(docType, clientQuality) {
  return new Request('https://scanner.example/api/assistant/extract', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      consent: true,
      docType,
      image: 'data:image/jpeg;base64,' + MOCK_IMAGE_DATA,
      clientQuality,
    }),
  });
}

test('weak readable photo gets one reread and disagreements remain unverified', async () => {
  const calls = [];
  const env = {
    SCANNER_VISION_PROVIDER: 'workersai',
    AI: { async run(_model, payload) {
      calls.push(payload);
      if (calls.length === 1) {
        return visionReply({
          citationNumber: 'ZZ0001',
          violationCode: '21453',
          violationDescription: 'Stop signal',
          vehiclePlate: 'DEMO77',
        }, ['citationNumber', 'vehiclePlate'], 'poor');
      }
      return visionReply({
        citationNumber: 'ZZ0002',
        violationCode: '21453',
        courtOrAgency: 'Example Traffic Court',
        violationDate: '10/03/2026',
        dueDate: '12/03/2026',
      }, ['citationNumber', 'violationCode', 'courtOrAgency', 'violationDate', 'dueDate'], 'good');
    } },
  };
  const response = await onRequestPost({
    request: scanRequest('ticket', { grade: 'poor', warnings: ['possible_blur'] }),
    env,
  });
  assert.equal(response.status, 200);
  const { extracted } = await response.json();
  assert.equal(calls.length, 2);
  assert.match(calls[1].messages[1].content[0].text, /original image.*shadowed/);
  assert.equal(extracted.citationNumber.value, 'ZZ0002');
  assert.equal(extracted.citationNumber.confident, false);
  assert.deepEqual(extracted.vehiclePlate, { value: 'DEMO77', found: true, confident: false });
  assert.equal(extracted.violationDescription.value, null);
  assert.ok(extracted.validationWarnings.some(({ field, reason }) =>
    field === 'citationNumber' && reason === 'precision_read_conflict'));
  assert.equal(extracted.scanAssessment.label, 'Needs review');
});

test('Workers AI notices and licenses get separate document fields', async () => {
  const cases = [
    {
      type: 'license',
      recognized: { drivingLicenseNumber: 'Z0000000', drivingLicenseState: 'CA', dateOfBirth: '01/01/1990', defendantName: 'EXAMPLE SAMPLE' },
      expectedField: 'dateOfBirth',
      excludedField: 'violationCode',
      instruction: /document discriminator/,
    },
    {
      type: 'notice',
      recognized: { courtOrAgency: 'EXAMPLE TRAFFIC COURT', caseNumber: 'DEMO-0001', dueDate: '12/03/2026', defendantName: 'EXAMPLE SAMPLE', courtStreetAddress: '100 EXAMPLE STREET' },
      expectedField: 'courtStreetAddress',
      excludedField: 'drivingLicenseNumber',
      instruction: /case and citation numbers/,
    },
  ];
  for (const fixture of cases) {
    let calls = 0;
    const env = { AI: { async run(_model, payload) {
      calls++;
      assert.match(payload.messages[1].content[0].text, fixture.instruction);
      assert.ok(payload.guided_json.required.includes(fixture.expectedField));
      assert.ok(!payload.guided_json.required.includes(fixture.excludedField));
      return visionReply(fixture.recognized, Object.keys(fixture.recognized), 'good');
    } } };
    const response = await onRequestPost({ request: scanRequest(fixture.type), env });
    assert.equal(response.status, 200);
    const { extracted } = await response.json();
    assert.equal(calls, 1);
    assert.equal(extracted.scanMeta.documentType, fixture.type);
    assert.equal(extracted[fixture.expectedField].value, fixture.recognized[fixture.expectedField]);
    assert.equal(extracted[fixture.excludedField].value, null);
  }
});

test('a failed precision attempt never retries or cascades to another provider', async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
    __visionTest.resetProviderCooldowns();
  });
  const urls = [];
  globalThis.fetch = async (url) => {
    urls.push(String(url));
    return new Response('{}', { status: 503 });
  };
  await assert.rejects(extractVisionDocument({ GEMINI_API_KEY: 'stub', OPENAI_API_KEY: 'stub' }, {
    base64: MOCK_IMAGE_DATA,
    mediaType: 'image/jpeg',
    preferredProvider: 'gemini',
    system: 'mock OCR',
    prompt: 'mock reread',
    precision: true,
  }), /503/);
  assert.equal(urls.length, 1);
  assert.match(urls[0], /generativelanguage\.googleapis\.com/);
});

test('an exhausted handler deadline sends no provider request', async () => {
  let calls = 0;
  await assert.rejects(extractVisionDocument({ AI: { async run() { calls++; } } }, {
    base64: MOCK_IMAGE_DATA,
    mediaType: 'image/jpeg',
    deadlineMs: Date.now() - 1,
  }), /total scanner deadline exhausted/);
  assert.equal(calls, 0);
});
