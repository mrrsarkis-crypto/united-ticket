// Shared date/deadline utilities for case workflows.
const DAY = 86400000;

export function parseDate(value) {
  if (!value) return null;
  const s = String(value).trim();
  const d = /^\\d{4}-\\d{2}-\\d{2}$/.test(s) ? new Date(s + 'T00:00:00') : new Date(s);
  return Number.isNaN(d.getTime()) ? null : startDay(d);
}

export function addDays(value, days) {
  const d = parseDate(value);
  return d ? new Date(d.getTime() + Number(days || 0) * DAY) : null;
}

export function dateOnly(value) {
  const d = value instanceof Date ? value : parseDate(value);
  return d ? d.toISOString().slice(0, 10) : null;
}

export function daysUntil(value, now = new Date()) {
  const target = parseDate(value);
  if (!target) return null;
  const current = startDay(now);
  return Math.ceil((target.getTime() - current.getTime()) / DAY);
}

export function reminderSchedule(deadline, offsets = [14, 7, 3, 1, 0]) {
  const due = parseDate(deadline);
  if (!due) return [];
  return offsets.map((daysBefore) => ({
    days_before: daysBefore,
    send_on: dateOnly(new Date(due.getTime() - Number(daysBefore) * DAY)),
  }));
}

function startDay(value) {
  const d = value instanceof Date ? value : new Date(value);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}
