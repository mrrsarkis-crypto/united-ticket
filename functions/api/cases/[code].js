// GET /api/cases/:code — look up case status
import { json, statusSummary, statusHistory, hasCaseAccess } from '../_shared.js';

export async function onRequestGet(context) {
  const { request, params, env } = context;
  const code = (params.code || '').trim();
  if (!code) return json({ error: 'Missing tracking code' }, 400);
  if (!env.CASES) return json({ error: 'Case database not configured' }, 500);

  const record = await env.CASES.get('case:' + code, 'json');
  if (!record) return json({ error: 'Case not found' }, 404);

  const notes = record.notes && typeof record.notes === 'object' ? record.notes : {};
  const workflow = record.workflow && typeof record.workflow === 'object' ? record.workflow : {};
  const privateAccess = await hasCaseAccess(request, env, code);

  const response = {
    trackingCode: record.tracking_code,
    status: record.status,
    paidAt: privateAccess ? (record.paid_at || null) : null,
    createdAt: privateAccess ? record.created_at : null,
    updatedAt: privateAccess ? (record.updated_at || null) : null,
    summary: statusSummary(record.status, notes),
    statusHistory: privateAccess && Array.isArray(record.status_history) && record.status_history.length
      ? record.status_history
      : statusHistory(record.status),
    access: { authenticated: privateAccess },
  };

  if (privateAccess) {
    response.caseDetails = {
      jurisdiction: record.jurisdiction || '',
      courtOrAgency: record.courtOrAgency || record.court || '',
      violationCode: record.violationCode || notes.code || '',
      violationDate: record.violation_date || '',
      dueDate: record.due_date || record.court_date || '',
    };
    response.workflow = {
      jurisdiction: workflow.jurisdiction || '',
      procedure: workflow.procedure || '',
      eligible: typeof workflow.eligible === 'boolean' ? workflow.eligible : null,
      reason: workflow.reason || '',
      dueDate: workflow.due_date || record.due_date || record.court_date || '',
      daysUntilDeadline: typeof workflow.days_until_deadline === 'number' ? workflow.days_until_deadline : null,
      filingMethod: workflow.filingMethod || '',
    };
    response.package = {
      clientDocumentsReady: workflow.client_documents_ready === true || record.package?.clientDocumentsReady === true,
      internalDraftReady: record.package?.internalDraftReady === true,
      generatedAt: record.package?.generatedAt || null,
      version: record.package?.version || null,
    };
  }

  return json(response, 200);
}
