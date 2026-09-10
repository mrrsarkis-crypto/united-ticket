// POST /api/analytics/myimprov/convert?code=ADMIN_CODE
// Import IMPROV enrollment / conversion data. Two formats accepted:
//   1) JSON body: [{ click_id: "UTTD-abc", amount: 199, ts: "2026-09-10" }, ...]
//    or batch: { clicks: [...] }
//   2) CSV body  (Content-Type: text/csv): click_id,amount,ts
//      First row can optionally be a header row; it is skipped if the first
//      cell doesn't start with "UTTD".
// Stores each conversion as cvt:<click_id> in KV so the analytics GET endpoint
// can join clicks → conversions for the funnel view.
import { json, unauthorizedIfNotAdmin } from '../../_shared.js';

export async function onRequestPost(context) {
  const { request, env } = context;
  const denied = unauthorizedIfNotAdmin(request, env);
  if (denied) return denied;
  if (!env.CASES) return json({ error: 'Database not configured' }, 500);

  const ct = (request.headers.get('content-type') || '').toLowerCase();
  let rows = [];

  if (ct.includes('text/csv') || ct.includes('application/csv') || ct.includes('text/plain')) {
    // CSV import
    const raw = await request.text();
    const lines = raw.split(/\r?\n/).filter((l) => l.trim());
    for (const line of lines) {
      const cells = line.split(',').map((c) => c.replace(/^"|"$/g, '').trim());
      const clickId = cells[0];
      if (!clickId || clickId === 'click_id') continue; // skip header
      if (!clickId.startsWith('UTTD-')) continue;        // skip non-UTTD rows
      rows.push({
        click_id: clickId,
        amount: cells[1] ? Number(cells[1]) || 0 : 0,
        ts: cells[2] || '',
        source: 'csv_import',
      });
    }
  } else {
    // JSON import: array of rows, { clicks: [...] }, or a single row object.
    let body;
    try { body = await request.json(); } catch {
      return json({ error: 'Invalid JSON body' }, 400);
    }
    const incoming = Array.isArray(body)
      ? body
      : Array.isArray(body && body.clicks)
        ? body.clicks
        : body && typeof body === 'object'
          ? [body]
          : [];
    for (const r of incoming) {
      const id = (r && (r.click_id || r.ref || r.ref_id || r.id)) || '';
      if (!id.startsWith('UTTD-')) continue;
      rows.push({
        click_id: id,
        amount: Number(r.amount || r.revenue || r.fee) || 0,
        ts: r.ts || r.date || r.converted_at || r.timestamp || '',
        source: 'json_import',
      });
    }
  }

  if (!rows.length) return json({ imported: 0, message: 'No UTTD- records found in body' });

  let written = 0;
  const errors = [];
  for (const row of rows) {
    const key = 'cvt:' + row.click_id;
    const record = {
      click_id: row.click_id,
      amount: row.amount,
      ts: row.ts,
      source: row.source,
      imported_at: new Date().toISOString(),
    };
    try {
      // Merge with existing conversion record if one already exists (idempotent update)
      const existing = await env.CASES.get(key, 'json');
      if (existing) {
        existing.amount = row.amount || existing.amount;
        existing.ts = row.ts || existing.ts;
        existing.source = row.source || existing.source;
        existing.imported_at = record.imported_at;
        await env.CASES.put(key, JSON.stringify(existing));
      } else {
        await env.CASES.put(key, JSON.stringify(record));
      }
      written++;
    } catch (e) {
      errors.push(row.click_id + ': ' + (e.message || e));
    }
  }

  return json({ imported: written, errors: errors.length ? errors : undefined });
}
