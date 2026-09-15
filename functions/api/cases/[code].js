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
  const workflow = record.workflow && typeof record.workflow === 'object' ? record.workflow : {};

  return json({
    trackingCode: record.tracking_code,
    status: record.status,
    paidAt: record.paid_at || null,
    createdAt: record.created_at,
    updatedAt: record.updated_at || null,
    summary: statusSummary(record.status, notes),
    statusHistory: Array.isArray(record.status_history) && record.status_history.length
      ? record.status_history
      : statusHistory(record.status),
    caseDetails: {
      jurisdiction: record.jurisdiction || '',
      courtOrAgency: record.courtOrAgency || record.court || '',
      violationCode: record.violationCode || notes.code || '',
      violationDate: record.violation_date || '',
      dueDate: record.due_date || record.court_date || '',
    },
    workflow: {
      jurisdiction: workflow.jurisdiction || '',
      procedure: workflow.procedure || '',
      eligible: typeof workflow.eligible === 'boolean' ? workflow.eligible : null,
      reason: workflow.reason || '',
      dueDate: workflow.due_date || record.due_date || record.court_date || '',
      daysUntilDeadline: typeof workflow.days_until_deadline === 'number' ? workflow.days_until_deadline : null,
      filingMethod: workflow.filingMethod || '',
    },
  }, 200);
}
