import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveDocumentType, documentSignals } from '../functions/api/assistant/_document-type.js';
import { buildScanAssessment } from '../functions/api/assistant/_assessment.js';

function field(value, confident = true) {
  return { value, found: value != null, confident: value != null && confident };
}

function blank() {
  return { value: null, found: false, confident: false };
}

test('auto classifies a traffic citation from citation-specific fields', () => {
  const extracted = {
    citationNumber: field('AB1234567'),
    violationCode: field('22350'),
    violationDate: field('09/01/2026'),
    courtOrAgency: field('Los Angeles Superior Court'),
    dueDate: field('10/20/2026'),
  };
  assert.equal(resolveDocumentType('auto', extracted), 'ticket');
  assert.equal(resolveDocumentType('ticket', extracted), 'ticket');
});

test('auto classifies a driver license from identity fields', () => {
  const extracted = {
    drivingLicenseNumber: field('D1234567'),
    drivingLicenseState: field('CA'),
    dateOfBirth: field('01/26/1987'),
    defendantName: field('Sample Driver'),
    violationCode: blank(),
    violationDate: blank(),
  };
  assert.equal(resolveDocumentType('auto', extracted), 'license');
  assert.equal(resolveDocumentType('license', extracted), 'license');
  const assessment = buildScanAssessment({ ...extracted, legibility: 'good' }, {
    documentType: 'license',
    clientQuality: { grade: 'good', warnings: [] },
    validationWarnings: [],
  });
  assert.equal(assessment.documentType, 'license');
  assert.equal(assessment.label, 'Strong read');
  assert.equal(assessment.keyFieldsExpected, 4);
});

test('auto classifies a court or DMV notice from court and deadline fields', () => {
  const extracted = {
    courtOrAgency: field('Los Angeles Superior Court'),
    dueDate: field('10/20/2026'),
    courtDate: blank(),
    citationNumber: field('AB1234567'),
    defendantName: field('Sample Driver'),
    violationCode: blank(),
    violationDate: blank(),
  };
  assert.equal(resolveDocumentType('auto', extracted), 'notice');
  assert.equal(resolveDocumentType('notice', extracted), 'notice');
  const assessment = buildScanAssessment({ ...extracted, legibility: 'good' }, {
    documentType: 'notice',
    clientQuality: { grade: 'good', warnings: [] },
    validationWarnings: [],
  });
  assert.equal(assessment.documentType, 'notice');
  assert.equal(assessment.label, 'Strong read');
});

test('court notice date alternatives satisfy one deadline field group', () => {
  const extracted = {
    courtOrAgency: field('Superior Court'),
    dueDate: blank(),
    courtDate: field('11/02/2026'),
    citationNumber: field('ABC9988'),
    mailingAddress: field('123 Main St'),
    legibility: 'good',
  };
  const assessment = buildScanAssessment(extracted, {
    documentType: 'notice',
    clientQuality: { grade: 'good', warnings: [] },
  });
  assert.equal(assessment.missingKeyFields.includes('response/court date'), false);
});

test('auto rejects unrelated extraction instead of guessing a supported document', () => {
  const extracted = {
    defendantName: field('Store Customer'),
    mailingAddress: field('123 Main St'),
    citationNumber: blank(),
    violationCode: blank(),
    violationDate: blank(),
    drivingLicenseNumber: blank(),
    courtOrAgency: blank(),
    dueDate: blank(),
    courtDate: blank(),
  };
  assert.equal(resolveDocumentType('auto', extracted), null);
  assert.equal(documentSignals(extracted).name, true);
});

test('explicit document type rejects a mismatched document', () => {
  const license = {
    drivingLicenseNumber: field('D1234567'),
    drivingLicenseState: field('CA'),
    dateOfBirth: field('01/26/1987'),
    defendantName: field('Sample Driver'),
  };
  assert.equal(resolveDocumentType('ticket', license), null);
  assert.equal(resolveDocumentType('notice', license), null);
});
