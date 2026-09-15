// Short, non-legal welcome email sent when a client supplied an email address.
import { resendSend } from './_shared.js';

export async function sendClientWelcomeEmail(env, caseData) {
  const email = String(caseData && caseData.email || '').trim();
  if (!email || !env.RESEND_API_KEY) return { ok: false, skipped: true };

  const code = caseData.tracking_code || '';
  const caseUrl = 'https://unitedtraffictickets.com/case?code=' + encodeURIComponent(code);
  const firstName = String(caseData.name || '').trim().split(/\s+/)[0] || 'there';
  const subject = 'Welcome to United Traffic Tickets Defense';
  const text =
    'Hi ' + firstName + ',\n\n' +
    'Welcome to United Traffic Tickets Defense. We received your case information and will keep you updated as your case moves forward.\n\n' +
    'Your case code: ' + (code || '—') + '\n' +
    'Case Center: ' + caseUrl + '\n\n' +
    'Please keep your case code for your records. If you have additional documents or information, use your Case Center when available.\n\n' +
    'Thank you,\nUnited Traffic Tickets Defense';

  await resendSend(env, {
    to: email,
    subject,
    text,
    html: text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>'),
  });
  return { ok: true, sent: true };
}
