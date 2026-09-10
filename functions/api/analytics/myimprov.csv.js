// GET /api/analytics/myimprov.csv?code=ADMIN_CODE — CSV export of every click
// with partner conversion columns joined from cvt: records.
import { unauthorizedIfNotAdmin, listRecords, csvResponse } from '../_shared.js';

const COLS = ['ts', 'day', 'click_id', 'c', 'device', 'ref_page', 'visitor_hash', 'converted', 'converted_at', 'amount'];

export async function onRequestGet(context) {
  const { request, env } = context;
  const denied = unauthorizedIfNotAdmin(request, env);
  if (denied) return denied;
  if (!env.CASES) return csvResponse([], COLS, 'myimprov-clicks.csv');

  let records = [];
  let conversions = [];
  try {
    [records, conversions] = await Promise.all([
      listRecords(env, 'clk:'),
      listRecords(env, 'cvt:'),
    ]);
  } catch (e) {
    return csvResponse([], COLS, 'myimprov-clicks.csv');
  }
  records.sort((a, b) => String(b.ts || '').localeCompare(String(a.ts || '')));

  const convByClick = new Map();
  for (const c of conversions) convByClick.set(c.click_id, c);

  const rows = records.map((r) => {
    const conv = convByClick.get('UTTD-' + (r.click_id || '')) || convByClick.get(r.click_id || '');
    return {
      ts: r.ts,
      day: r.day,
      click_id: 'UTTD-' + (r.click_id || ''),
      c: r.c,
      device: r.device,
      ref_page: r.ref_page || '',
      visitor_hash: r.visitor_hash || '',
      converted: conv && conv.ts ? 'yes' : 'no',
      converted_at: (conv && conv.ts) || '',
      amount: (conv && conv.amount != null) ? conv.amount : '',
    };
  });

  return csvResponse(rows, COLS, 'myimprov-clicks.csv');
}