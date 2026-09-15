// /api/deadlines - calculate a case reminder schedule without exposing case data.
import { json } from '../_shared.js';
import { addDays, dateOnly, daysUntil, reminderSchedule } from '../_deadline-utils.js';

export async function onRequestPost(context) {
  const { request } = context;
  const type = request.headers.get('content-type') || '';
  if (!type.includes('application/json')) return json({ error: 'Expected JSON body' }, 415);
  let body;
  try { body = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }

  const deadline = body.deadline || body.dueDate;
  if (!deadline) return json({ error: 'deadline is required' }, 400);

  const normalized = dateOnly(deadline);
  if (!normalized) return json({ error: 'deadline must be a valid calendar date' }, 400);

  const offsets = Array.isArray(body.offsets)
    ? body.offsets.map(Number).filter((n) => Number.isFinite(n) && n >= 0 && n <= 365)
    : [14, 7, 3, 1, 0];
  const followUpDays = Number(body.followUpDays == null ? 1 : body.followUpDays);
  if (!Number.isFinite(followUpDays) || followUpDays < 0 || followUpDays > 365) {
    return json({ error: 'followUpDays must be between 0 and 365' }, 400);
  }

  return json({
    deadline: normalized,
    days_until_deadline: daysUntil(normalized),
    reminders: reminderSchedule(normalized, offsets),
    follow_up_date: dateOnly(addDays(normalized, followUpDays)),
  });
}
