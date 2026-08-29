// Shared helpers for /api routes
export function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export function priceFor(service) {
  if (service === '199') return 'STRIPE_PRICE_199';
  if (service === '299') return 'STRIPE_PRICE_299';
  if (service === '999') return 'STRIPE_PRICE_999';
  return null;
}

export function rand(n) {
  let s = '';
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  for (let i = 0; i < n; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

export function statusSummary(status, notes = {}) {
  switch (status) {
    case 'payment_pending': return 'Payment not yet completed. Your case is queued and will be drafted once payment clears.';
    case 'payment_complete': return 'Payment received. Your declaration paperwork is being prepared.';
    case 'submitted': return 'Your paperwork has been prepared and is ready for review/submission.';
    case 'awaiting_court': return 'Awaiting the court decision. This can take several months.';
    case 'decided': return 'The court has returned a decision. Details are being sent to your email.';
    default: return 'Status: ' + status;
  }
}

export function statusHistory(status) {
  const map = {
    payment_pending: ['Payment', 'Pending'],
    payment_complete: ['Payment', 'Drafting'],
    submitted: ['Payment', 'Drafting', 'Submitted'],
    awaiting_court: ['Payment', 'Drafting', 'Submitted', 'Awaiting Court'],
    decided: ['Payment', 'Drafting', 'Submitted', 'Court Decision'],
  };
  return map[status] || [status];
}
