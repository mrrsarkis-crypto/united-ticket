// GET /api/cases/:code — look up case status
import { json, statusSummary, statusHistory } from '../_shared.js';

export async function onRequestGet(context) {
  const { params, env } = context;
  const code = (params.code || '').trim();
  if (!code) return json({ error: 'Missing tracking code' }, 400);
  if (!env.CASES) return json({ error: 'Case database not configured' }, 500);

  const record = await env.CASES.get('case:' + code, 'json');
  if (!record) return json({ error: 'Case not found' }, 404);

  const notes = record.notes && typeof record.notes === 'object' ? record.notes : {};

  return json({
    trackingCode: record.tracking_code,
    status: record.status,
    paidAt: record.paid_at || null,
    createdAt: record.created_at,
    summary: statusSummary(record.status, notes),
    statusHistory: statusHistory(record.status),
  }, 200);
}
