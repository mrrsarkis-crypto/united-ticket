import test from 'node:test';
import assert from 'node:assert/strict';
import { buildScanAssessment } from '../functions/api/assistant/_assessment.js';

function field(value, confident = true) {
  return { value, found: true, confident };
}

function strongTicket() {
  return {
    citationNumber: field('AB1234567'),
    violationCode: field('22350'),
    courtOrAgency: field('Los Angeles Superior Court'),
    dueDate: field('10/20/2026'),
    violationDate: field('09/01/2026'),
    legibility: 'good',
  };
}

test('clear image with complete confident fields remains a Strong read', () => {
  const result = buildScanAssessment(strongTicket(), {
    clientQuality: { grade: 'good', warnings: [] },
    validationWarnings: [],
  });
  assert.equal(result.label, 'Strong read');
  assert.equal(result.scanConfidencePercent, 100);
  assert.equal(result.rawScanConfidencePercent, 100);
  assert.equal(result.qualityAdjusted, true);
  assert.equal(result.needsManualReview, false);
});

test('fair image quality caps confidence below Strong read', () => {
  const result = buildScanAssessment(strongTicket(), {
    clientQuality: { grade: 'fair', warnings: ['low_resolution', 'possible_blur'] },
    validationWarnings: [],
  });
  assert.equal(result.label, 'Usable read');
  assert.ok(result.scanConfidencePercent <= 79);
  assert.equal(result.imageQualityGrade, 'fair');
  assert.ok(result.imageQualityPenalty >= 10);
  assert.equal(result.needsManualReview, true);
});

test('poor image quality cannot be presented as a usable or strong read', () => {
  const result = buildScanAssessment(strongTicket(), {
    clientQuality: { grade: 'poor', warnings: ['too_dark', 'low_contrast', 'possible_blur'] },
    validationWarnings: [],
  });
  assert.equal(result.label, 'Needs review');
  assert.ok(result.scanConfidencePercent <= 54);
});

test('format validation warnings reduce server confidence', () => {
  const clean = buildScanAssessment(strongTicket(), {
    clientQuality: { grade: 'good', warnings: [] },
    validationWarnings: [],
  });
  const warned = buildScanAssessment(strongTicket(), {
    clientQuality: { grade: 'good', warnings: [] },
    validationWarnings: ['citationNumber', 'dueDate'],
  });
  assert.equal(warned.validationWarningCount, 2);
  assert.equal(warned.validationPenalty, 6);
  assert.equal(warned.label, 'Needs review');
  assert.ok(warned.scanConfidencePercent <= 69);
  assert.ok(warned.scanConfidencePercent < clean.scanConfidencePercent);
});

test('missing or uncertain fields are surfaced for human verification', () => {
  const ticket = strongTicket();
  ticket.dueDate = { value: null, found: false, confident: false };
  ticket.courtDate = { value: null, found: false, confident: false };
  ticket.violationCode = field('22350', false);
  const result = buildScanAssessment(ticket, { clientQuality: { grade: 'good', warnings: [] } });
  assert.ok(result.missingKeyFields.includes('response/court date'));
  assert.ok(result.fieldsNeedingVerification.includes('violation code'));
  assert.equal(result.label, 'Needs review');
  assert.ok(result.scanConfidencePercent <= 69);
  assert.equal(result.needsManualReview, true);
});
