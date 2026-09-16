import { buildRetainer, buildReceipt, buildTR205 } from '../_tr205.js';

const PACKAGE_VERSION = '2026.09.15-2';

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
  const fee = options.fee || record.paid_amount || '0.00';
  const date = options.date || (record.paid_at ? String(record.paid_at).slice(0, 10) : now.slice(0, 10));
  const safe = safeCode(code);
  const additions = [];
  let changedMetadata = false;

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
    const existingIndex = existing.findIndex((doc) => doc && doc.id === id);
    const normalized = {
      id,
      name: filename,
      type: 'application/pdf',
      size: bytes.byteLength || 0,
      uploadedAt: existingIndex >= 0 && existing[existingIndex].uploadedAt ? existing[existingIndex].uploadedAt : now,
      source: 'system',
      customerVisible,
      downloadPath: '/api/case-document?code=' + encodeURIComponent(code) + '&id=' + encodeURIComponent(id),
    };
    if (existingIndex >= 0) {
      const prior = existing[existingIndex];
      if (JSON.stringify({ ...prior, downloadPath: normalized.downloadPath }) !== JSON.stringify(normalized)) {
        existing[existingIndex] = { ...prior, ...normalized };
        changedMetadata = true;
      }
    } else {
      additions.push(normalized);
    }
  };

  const name = String(record.name || '').trim();
  const email = String(record.email || '').trim();
  const tracking = code;
  const dollars = typeof fee === 'number' ? fee.toFixed(2) : String(fee);

  const retainerName = 'Retainer_Agreement_' + safe + '.pdf';
  if (!existing.some((doc) => doc && doc.name === retainerName && doc.source === 'system' && doc.customerVisible === true)) {
    const bytes = buildRetainer({ name, email, tracking, service: record.service || 'Traffic ticket defense', fee: dollars, date });
    await putPdf('system-retainer-' + safe, retainerName, bytes, true);
  }

  const receiptName = 'Receipt_' + safe + '.pdf';
  if (!existing.some((doc) => doc && doc.name === receiptName && doc.source === 'system' && doc.customerVisible === true)) {
    const bytes = buildReceipt({ name, email, tracking, fee: dollars, date });
    await putPdf('system-receipt-' + safe, receiptName, bytes, true);
  }

  const internalName = 'Internal_TR205_' + safe + '.pdf';
  if (!existing.some((doc) => doc && doc.name === internalName && doc.source === 'system' && doc.customerVisible === false)) {
    const notes = record.notes && typeof record.notes === 'object' ? record.notes : {};
    const bytes = buildTR205({ name, citation: record.citation, court: record.court, dob: record.dob, dl: record.dl, notes: { ...notes, created_at: record.paid_at || record.created_at } });
    await putPdf('system-tr205-' + safe, internalName, bytes, false);
  }

  const documents = existing.concat(additions).slice(0, 100);
  const clientDocumentsReady = [retainerName, receiptName].every((filename) => documents.some((doc) => doc && doc.name === filename && (doc.source === 'customer' || doc.customerVisible === true)));
  const internalDraftReady = documents.some((doc) => doc && doc.name === internalName && doc.source === 'system' && doc.customerVisible === false);
  const priorPackage = record.package && typeof record.package === 'object' ? record.package : {};
  const packageData = {
    ...priorPackage,
    version: PACKAGE_VERSION,
    generatedAt: additions.length || changedMetadata ? now : (priorPackage.generatedAt || null),
    clientDocumentsReady,
    internalDraftReady,
  };

  const needsPersist = additions.length || changedMetadata || JSON.stringify(priorPackage) !== JSON.stringify(packageData);
  if (!needsPersist) return { ok: true, unchanged: true, documents, package: packageData };

  const updated = { ...record, documents, package: packageData, updated_at: now };
  await env.CASES.put('case:' + code, JSON.stringify(updated));
  return { ok: true, generated: additions.length, documents, package: packageData };
}

export function customerDocuments(record) {
  const docs = Array.isArray(record?.documents) ? record.documents : [];
  return docs.filter((doc) => doc && (doc.source === 'customer' || doc.customerVisible === true));
}
