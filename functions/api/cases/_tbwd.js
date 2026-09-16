// California traffic workflow helpers. Informational routing only; official court instructions control.
import { resendSend } from '../_shared.js';
import { daysUntil } from '../_deadline-utils.js';

export const CA_TBWD_VERSION = '2026.09.15';

export function classifyCaliforniaWorkflow(data = {}) {
  const jurisdiction = String(data.jurisdiction || '').toLowerCase();
  const court = String(data.court || data.courtOrAgency || '').toLowerCase();
  const code = String(data.violationCode || data.code || '').toLowerCase();
  const procedureType = String(data.procedureType || '').toLowerCase();
  const filingMethod = String(data.filingMethod || '').toLowerCase();
  const combined = jurisdiction + ' ' + court;
  const california = /california|\bca\b|superior court/.test(combined);
  const infractionHint = /\binfraction\b|traffic|vc\s*\d|vehicle code|speeding|stop sign|red light/.test((combined + ' ' + code).toLowerCase());
  if (!california) return { jurisdiction: 'unknown', procedure: 'jurisdiction_review', eligible: null, reason: 'California jurisdiction was not established.' };
  if (!infractionHint) return { jurisdiction: 'california', procedure: 'court_review', eligible: null, reason: 'The citation type needs court-specific review before a written-declaration path is selected.' };
  const myCitationsHint = /mycitations|online trial|online declaration/.test(combined + ' ' + procedureType + ' ' + filingMethod);
  return { jurisdiction: 'california', procedure: myCitationsHint ? 'online_trial_by_written_declaration' : 'trial_by_written_declaration', eligible: true, reason: myCitationsHint ? 'Online trial-by-declaration workflow indicated; verify that the citation and court are eligible.' : 'California traffic infraction appears compatible with a written-declaration workflow; verify eligibility with the court.' };
}

export { daysUntil };

export async function sendWorkflowEmail(env, record, kind) {
  const email = String(record?.email || '').trim();
  if (!email || !env.RESEND_API_KEY) return { sent: false, skipped: true };
  const code = String(record.tracking_code || '').trim();
  const caseUrl = 'https://unitedtraffictickets.com/case?code=' + encodeURIComponent(code);
  const firstName = String(record.name || '').trim().split(/\s+/)[0] || 'there';
  const templates = {
    workflow_identified: ['California ticket workflow identified ' + code, 'Your citation has been reviewed for the California written-declaration workflow. We identified a potential Trial by Written Declaration path, subject to court eligibility and current court instructions.'],
    deadline_7: ['Your California ticket deadline is 7 days away ' + code, 'Your case timeline shows a California court deadline in 7 days. Please review the date on your citation and Case Center and follow the court instructions.'],
    deadline_3: ['Your California ticket deadline is 3 days away ' + code, 'Your case timeline shows a California court deadline in 3 days. Please take action promptly and verify the official court deadline.'],
    package_ready: ['Your declaration package is ready to review ' + code, 'Your document package is ready for your review. Review the information carefully before authorizing any filing step.']
  };
  const t = templates[kind];
  if (!t) return { sent: false, error: 'Unknown workflow email' };
  const text = 'Hi ' + firstName + ',\n\n' + t[1] + '\n\nCase code: ' + code + '\nCase Center: ' + caseUrl + '\n\nThese messages are informational. Court notices, orders, and filing confirmations are the authoritative record. United Traffic Tickets Defense is not the court and does not guarantee an outcome.';
  await resendSend(env, { to: email, subject: t[0], text, html: text.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\n/g,'<br>') });
  return { sent: true };
}
