// California traffic workflow helpers. Informational routing only; official court instructions control.
import { resendSend, caseAccessToken } from '../_shared.js';
import { daysUntil } from '../_deadline-utils.js';

export const CA_TBWD_VERSION = '2026.09.16';

const CALIFORNIA_COUNTIES = [
  'alameda', 'alpine', 'amador', 'butte', 'calaveras', 'colusa', 'contra costa', 'del norte',
  'el dorado', 'fresno', 'glenn', 'humboldt', 'imperial', 'inyo', 'kern', 'kings', 'lake',
  'lassen', 'los angeles', 'madera', 'marin', 'mariposa', 'mendocino', 'merced', 'modoc',
  'mono', 'monterey', 'napa', 'nevada', 'orange', 'placer', 'plumas', 'riverside', 'sacramento',
  'san benito', 'san bernardino', 'san diego', 'san francisco', 'san joaquin', 'san luis obispo',
  'san mateo', 'santa barbara', 'santa clara', 'santa cruz', 'shasta', 'sierra', 'siskiyou',
  'solano', 'sonoma', 'stanislaus', 'sutter', 'tehama', 'trinity', 'tulare', 'tuolumne',
  'ventura', 'yolo', 'yuba'
];

export function classifyCaliforniaWorkflow(data = {}) {
  const jurisdiction = String(data.jurisdiction || '').toLowerCase();
  const court = String(data.court || data.courtOrAgency || '').toLowerCase();
  const code = String(data.violationCode || data.code || '').toLowerCase();
  const procedureType = String(data.procedureType || '').toLowerCase();
  const filingMethod = String(data.filingMethod || '').toLowerCase();
  const eligibilityConfirmed = data.eligibilityConfirmed === true;
  const combined = jurisdiction + ' ' + court;
  const explicitCalifornia = /\bcalifornia\b|\bca\b|state of california/.test(combined);
  const californiaCountyCourt = /\bsuperior court\b/.test(court) && CALIFORNIA_COUNTIES.some((county) => {
    const escaped = county.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp('\\b' + escaped + '(?: county)?\\b').test(court);
  });
  const california = explicitCalifornia || californiaCountyCourt;
  const infractionHint = /\binfraction\b|traffic|vc\s*\d|vehicle code|speeding|stop sign|red light/.test((combined + ' ' + code).toLowerCase());
  if (!california) return { jurisdiction: 'unknown', procedure: 'jurisdiction_review', eligible: null, reason: 'California jurisdiction was not established.' };
  if (!infractionHint) return { jurisdiction: 'california', procedure: 'court_review', eligible: null, reason: 'The citation type needs court-specific review before a written-declaration path is selected.' };
  const myCitationsHint = /mycitations|online trial|online declaration/.test(combined + ' ' + procedureType + ' ' + filingMethod);
  const procedure = myCitationsHint ? 'online_trial_by_written_declaration' : 'trial_by_written_declaration';
  return {
    jurisdiction: 'california',
    procedure,
    eligible: eligibilityConfirmed ? true : null,
    reason: eligibilityConfirmed
      ? 'Eligibility was explicitly confirmed; continue to follow the court\'s current filing instructions and deadlines.'
      : myCitationsHint
        ? 'A potential online trial-by-declaration workflow was identified; verify citation eligibility and the court\'s current procedure.'
        : 'A potential California written-declaration workflow was identified; verify infraction-only status, mandatory-appearance restrictions, prior default history, deadlines, bail requirements, and current court procedures before filing.',
  };
}

export { daysUntil };

export async function sendWorkflowEmail(env, record, kind) {
  const email = String(record?.email || '').trim();
  if (!email || !env.RESEND_API_KEY) return { sent: false, skipped: true };
  const code = String(record.tracking_code || '').trim();
  const token = await caseAccessToken(env, code);
  const caseUrl = 'https://unitedtraffictickets.com/case?code=' + encodeURIComponent(code) + (token ? '&token=' + encodeURIComponent(token) : '');
  const firstName = String(record.name || '').trim().split(/\s+/)[0] || 'there';
  const templates = {
    workflow_identified: ['Potential California ticket workflow identified ' + code, 'Our system identified a potential California written-declaration path from the citation information on file. Court eligibility and current court instructions still need to be verified.'],
    deadline_7: ['Your California ticket deadline is 7 days away ' + code, 'Your case timeline shows a California court deadline in 7 days. Please review the date on your citation and Case Center and follow the court instructions.'],
    deadline_3: ['Your California ticket deadline is 3 days away ' + code, 'Your case timeline shows a California court deadline in 3 days. Please take action promptly and verify the official court deadline.'],
    package_ready: ['Your declaration package is ready to review ' + code, 'Your document package is ready for your review. Review the information carefully before authorizing any filing step.']
  };
  const t = templates[kind];
  if (!t) return { sent: false, error: 'Unknown workflow email' };
  const text = 'Hi ' + firstName + ',\n\n' + t[1] + '\n\nCase code: ' + code + '\nSecure Case Center: ' + caseUrl + '\n\nThese messages are informational. Court notices, orders, and filing confirmations are the authoritative record. United Traffic Tickets Defense is not the court and does not guarantee an outcome.';
  await resendSend(env, { to: email, subject: t[0], text, html: text.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\n/g,'<br>') });
  return { sent: true };
}
