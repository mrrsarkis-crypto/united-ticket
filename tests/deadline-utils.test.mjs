import test from 'node:test';
import assert from 'node:assert/strict';
import { addDays, dateOnly, daysUntil, reminderSchedule } from '../functions/api/_deadline-utils.js';

test('dateOnly normalizes a date', () => {
  assert.equal(dateOnly('2026-10-15'), '2026-10-15');
});

test('addDays advances calendar days', () => {
  assert.equal(dateOnly(addDays('2026-10-15', 7)), '2026-10-22');
});

test('daysUntil calculates whole calendar days', () => {
  assert.equal(daysUntil('2026-10-15', new Date('2026-10-10T12:00:00')), 5);
});

test('reminderSchedule creates requested offsets', () => {
  assert.deepEqual(reminderSchedule('2026-10-15', [7, 1, 0]), [
    { days_before: 7, send_on: '2026-10-08' },
    { days_before: 1, send_on: '2026-10-14' },
    { days_before: 0, send_on: '2026-10-15' },
  ]);
});
