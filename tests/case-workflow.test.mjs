import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyCaliforniaWorkflow, daysUntil } from '../functions/api/cases/_tbwd.js';
import { customerDocuments } from '../functions/api/cases/_package.js';

test('California traffic citation routes to written-declaration review', () => {
  const result = classifyCaliforniaWorkflow({
    jurisdiction: 'California',
    courtOrAgency: 'Superior Court of Los Angeles County',
    violationCode: 'VC 22350',
  });
  assert.equal(result.jurisdiction, 'california');
  assert.equal(result.procedure, 'trial_by_written_declaration');
  assert.equal(result.eligible, true);
});

test('Unknown jurisdiction stays in review', () => {
  const result = classifyCaliforniaWorkflow({
    jurisdiction: 'Ontario',
    courtOrAgency: 'Provincial Offences Court',
    violationCode: '123',
  });
  assert.equal(result.jurisdiction, 'unknown');
  assert.equal(result.eligible, null);
});

test('Deadline helper returns calendar-day distance', () => {
  const now = new Date('2026-09-15T12:00:00Z');
  assert.equal(daysUntil('2026-09-22', now), 7);
  assert.equal(daysUntil('2026-09-15', now), 0);
});

test('Customer document filter excludes internal work product', () => {
  const docs = customerDocuments({
    documents: [
      { id: 'client', source: 'system', customerVisible: true },
      { id: 'upload', source: 'customer' },
      { id: 'internal', source: 'system', customerVisible: false },
    ],
  });
  assert.deepEqual(docs.map((d) => d.id), ['client', 'upload']);
});
