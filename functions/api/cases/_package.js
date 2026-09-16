import { buildRetainer, buildReceipt, buildTR205 } from '../_tr205.js';

function safeCode(value) {
  return String(value || 'case').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 80) || 'case';
}

export async function ensureClientPackage(env, record, options = {}) {
  if (!env.CASES || !env.R2 || !record || !record.tracking_code) {
    return { ok: false, skipped: true, reason: 'Package storage is not configured or case is missing.' };
  }

  const code = String(record.tracking_code).trim();
  const now = new Date().toISOString();
  const existing = Array.isArray(record.documents) ? record.documents.slice() : [];
  const has = (name) => existing.some((doc) => doc && doc.name === name && doc.source === 'system');
  const fee = options.fee || record.paid_amount || '0.00';
  const date = options.date || (record.paid_at ? String(record.paid_at).slice(0, 10) : now.slice(0, 10));
  const safe = safeCode(code);
  const additions = [];

  const putPdf = async (id, filename, bytes, customerVisible) => {
    if (!bytes || !filename) return;
    const key = 'cases/' + code + '/' + id + '.pdf';
    await env.R2.put(key, bytes, {
      httpMetadata: {
        contentType: 'application/pdf',
        contentDisposition: 'attachment; filename="' + filename.replace(/"/g, '') + '"',
      },
      customMetadata: { tracking_code: code, document_id: id, original_name: filename, visibility: customerVisible ? 'customer' : 'internal' },
    });
    if (!existing.some((doc) => doc && doc.id === id)) {
      additions.push({
        id,
        name: filename,
        type: 'application/pdf',
        size: bytes.byteLength || 0,
        uploadedAt: now,
        source: 'system',
        customerVisible,
        downloadPath: '/api/case-document?code=' + encodeURIComponent(code) + '&id=' + encodeURIComponent(id),
      });
    }
  };

  const name = String(record.name || '').trim();
  const email = String(record.email || '').trim();
  const tracking = code;
  const dollars = typeof fee === 'number' ? fee.toFixed(2) : String(fee);

  if (!has('Retainer_Agreement_' + safe + '.pdf')) {
    const bytes = buildRetainer({ name, email, tracking, service: record.service || 'Traffic ticket defense', fee: dollars, date });
    await putPdf('system-retainer-' + safe, 'Retainer_Agreement_' + safe + '.pdf', bytes, true);
  }

  if (!has('Receipt_' + safe + '.pdf')) {
    const bytes = buildReceipt({ name, email, tracking, fee: dollars, date });
    await putPdf('system-receipt-' + safe, 'Receipt_' + safe + '.pdf', bytes, true);
  }

  // Internal work product stays in the same private R2 vault but is explicitly
  // marked customerVisible=false and is filtered from the customer-facing API.
  if (!has('Internal_TR205_' + safe + '.pdf')) {
    const notes = record.notes && typeof record.notes === 'object' ? record.notes : {};
    const bytes = buildTR205({ name, citation: record.citation, court: record.court, dob: record.dob, dl: record.dl, notes: { ...notes, created_at: record.paid_at || record.created_at } });
    await putPdf('system-tr205-' + safe, 'Internal_TR205_' + safe + '.pdf', bytes, false);
  }

  if (!additions.length) return { ok: true, unchanged: true, documents: existing };
  const documents = existing.concat(additions).slice(0, 100);
  const updated = { ...record, documents, package: { ...(record.package || {}), version: '2026.09.15-1', generatedAt: now, clientDocumentsReady: additions.some((d) => d.customerVisible === true), internalDraftReady: additions.some((d) => d.customerVisible === false) }, updated_at: now };
  await env.CASES.put('case:' + code, JSON.stringify(updated));
  return { ok: true, generated: additions.length, documents };
}

export function customerDocuments(record) {
  const docs = Array.isArray(record?.documents) ? record.documents : [];
  return docs.filter((doc) => doc && doc.customerVisible !== false && doc.source === 'system' || doc && doc.customerVisible === true || doc && doc.source === 'customer');
}
