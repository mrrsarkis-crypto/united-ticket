import test from 'node:test';
import assert from 'node:assert/strict';
import { applyFieldPlausibility, __plausibilityTest } from '../functions/api/assistant/_plausibility.js';

function field(value, confident = true) {
  return { value, found: true, confident };
}

test('valid common traffic-ticket formats keep confidence', () => {
  const extracted = {
    citationNumber: field('AB-123456'),
    violationCode: field('VC 22350'),
    violationDate: field('09/14/2026'),
    dueDate: field('2026-10-20'),
    bailAmount: field('$490.00'),
    drivingLicenseState: field('CA'),
    drivingLicenseNumber: field('A1234567'),
    vehiclePlate: field('8ABC123'),
    officerId: field('45721'),
    defendantName: field('Maria Garcia'),
  };
  const warnings = applyFieldPlausibility(extracted);
  assert.deepEqual(warnings, []);
  for (const value of Object.values(extracted)) assert.equal(value.confident, true);
});

test('impossible dates are preserved but downgraded for human verification', () => {
  const extracted = { violationDate: field('02/31/2026') };
  const warnings = applyFieldPlausibility(extracted);
  assert.equal(extracted.violationDate.value, '02/31/2026');
  assert.equal(extracted.violationDate.confident, false);
  assert.deepEqual(warnings, [{ field: 'violationDate', reason: 'date_format' }]);
});

test('obviously malformed identifiers and money lose confidence without being invented or repaired', () => {
  const extracted = {
    citationNumber: field('THIS IS DEFINITELY NOT A CITATION NUMBER 999999999999'),
    violationCode: field('speeding maybe'),
    bailAmount: field('$forty dollars'),
    vehiclePlate: field('PLATE VALUE THAT IS FAR TOO LONG'),
    drivingLicenseState: field('CALIFORNIA'),
  };
  const warnings = applyFieldPlausibility(extracted);
  assert.equal(warnings.length, 5);
  assert.equal(extracted.citationNumber.confident, false);
  assert.equal(extracted.violationCode.confident, false);
  assert.equal(extracted.bailAmount.confident, false);
  assert.equal(extracted.vehiclePlate.confident, false);
  assert.equal(extracted.drivingLicenseState.confident, false);
});

test('date parser rejects invalid calendar days and accepts leap day', () => {
  assert.equal(__plausibilityTest.plausibleDate('02/29/2028'), true);
  assert.equal(__plausibilityTest.plausibleDate('02/29/2027'), false);
  assert.equal(__plausibilityTest.plausibleDate('13/01/2026'), false);
});

test('semantic identifier collisions are downgraded without rewriting values', () => {
  const extracted = {
    citationNumber: field('A12345'),
    officerId: field('A-12 345'),
    vehiclePlate: field('A12345'),
  };
  const warnings = applyFieldPlausibility(extracted);
  assert.equal(extracted.citationNumber.value, 'A12345');
  assert.equal(extracted.officerId.value, 'A-12 345');
  assert.equal(extracted.vehiclePlate.value, 'A12345');
  assert.equal(extracted.citationNumber.confident, false);
  assert.equal(extracted.officerId.confident, false);
  assert.equal(extracted.vehiclePlate.confident, false);
  assert.equal(warnings.filter((w) => w.reason === 'identifier_collision').length, 4);
});

test('court-looking mailing addresses are flagged while the literal value is preserved', () => {
  const extracted = {
    mailingAddress: field('Los Angeles Superior Court, 111 North Hill Street, Los Angeles CA'),
  };
  const warnings = applyFieldPlausibility(extracted);
  assert.equal(extracted.mailingAddress.value, 'Los Angeles Superior Court, 111 North Hill Street, Los Angeles CA');
  assert.equal(extracted.mailingAddress.confident, false);
  assert.deepEqual(warnings, [{ field: 'mailingAddress', reason: 'possible_court_address' }]);
});

test('cross-field date checks downgrade impossible chronology without changing text', () => {
  const extracted = {
    violationDate: field('09/20/2026'),
    courtDate: field('09/19/2026'),
    dueDate: field('09/18/2026'),
    dateOfBirth: field('10/01/2026'),
  };
  const warnings = applyFieldPlausibility(extracted);
  assert.equal(extracted.courtDate.value, '09/19/2026');
  assert.equal(extracted.dueDate.value, '09/18/2026');
  assert.equal(extracted.dateOfBirth.value, '10/01/2026');
  assert.equal(extracted.courtDate.confident, false);
  assert.equal(extracted.dueDate.confident, false);
  assert.equal(extracted.dateOfBirth.confident, false);
  assert.deepEqual(warnings, [
    { field: 'courtDate', reason: 'before_violation_date' },
    { field: 'dueDate', reason: 'before_violation_date' },
    { field: 'dateOfBirth', reason: 'not_before_violation_date' },
    { field: 'dateOfBirth', reason: 'not_before_court_date' },
  ]);
});


test('VC 22350 rejects a description taken from another violation row', () => {
  const extracted = {
    violationCode: field('VC 22350'),
    violationDescription: field('CARRYING PASSENGERS'),
    legibility: 'good',
  };
  const warnings = applyFieldPlausibility(extracted);
  assert.equal(extracted.violationDescription.value, 'CARRYING PASSENGERS');
  assert.equal(extracted.violationDescription.confident, false);
  assert.deepEqual(warnings, [{ field: 'violationDescription', reason: 'code_description_mismatch' }]);
});

test('response due date duplicated from violation date requires verification', () => {
  const extracted = {
    violationDate: field('09/11/2020'),
    dueDate: field('09/11/2020'),
    legibility: 'good',
  };
  const warnings = applyFieldPlausibility(extracted);
  assert.equal(extracted.dueDate.value, '09/11/2020');
  assert.equal(extracted.dueDate.confident, false);
  assert.deepEqual(warnings, [{ field: 'dueDate', reason: 'same_as_violation_date' }]);
});

test('fair handwritten scan downgrades high-risk handwritten fields', () => {
  const extracted = {
    vehicleMake: field('BMW'),
    vehicleModel: field('328'),
    vehiclePlate: field('7YH1154'),
    violationDescription: field('Unsafe speed'),
    legibility: 'fair',
  };
  const warnings = applyFieldPlausibility(extracted);
  assert.equal(extracted.vehicleMake.confident, false);
  assert.equal(extracted.vehicleModel.confident, false);
  assert.equal(extracted.vehiclePlate.confident, false);
  assert.equal(extracted.violationDescription.confident, false);
  assert.equal(warnings.filter((w) => w.reason === 'fair_legibility_requires_verification').length, 4);
});
