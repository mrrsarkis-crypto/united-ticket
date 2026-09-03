// GET /api/cases/admin?code=ADMIN_CODE  — list all submissions (private)
// GET /api/cases/admin.csv?code=ADMIN_CODE — CSV export
import { json } from '../../_shared.js';

export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const provided = (url.searchParams.get('code') || '').trim();
  const allowed = (env.ADMIN_CODE || '').trim();
  if (!allowed || provided !== allowed) {
    return json({ error: 'Unauthorized' }, 401);
  }
  if (!env.CASES) return json({ error: 'Case database not configured' }, 500);

  let records = [];
  try {
    const list = await env.CASES.list({ prefix: 'case:' });
    records = [];
    for (const item of list.keys) {
      const r = await env.CASES.get(item.name, 'json');
      if (r) records.push(r);
    }
  } catch (e) {
    return json({ error: 'Failed to read cases: ' + String(e && e.message) }, 500);
  }

  records.sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));

  if (url.pathname.endsWith('.csv')) {
    return csv(records);
  }

  return json({ count: records.length, cases: records }, 200);
}

function csv(records) {
  const cols = ['tracking_code', 'created_at', 'status', 'paid_at', 'name', 'email', 'court', 'citation', 'service', 'dob', 'dl', 'notes'];
  const esc = (v) => {
    if (v == null) return '';
    const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
    return '"' + s.replace(/"/g, '""') + '"';
  };
  const rows = [
    cols.map((c) => esc(c)).join(','),
    ...records.map((r) => cols.map((c) => esc(r[c])).join(',')),
  ];
  return new Response('\uFEFF' + rows.join('\n'), {
    status: 200,
    headers: { 'Content-Type': 'text/csv; charset=utf-8' },
  });
}