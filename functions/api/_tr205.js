// _tr205.js — build a prefilled California TR-205 "Request for Trial by Written
// Declaration (Traffic)" document as a PDF, pure Workers JS (no external deps).
// Uses Helvetica (built-in base-14 font) with uncompressed content streams so no
// deflate is required. Produces a clean, printable, prefilled declaration.

function escapePdfText(s) {
  return String(s == null ? '' : s)
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)');
}

function mm2pdf(x) { return Math.round(x * 72 / 25.4); }

// Build a single-page (or multi-page) PDF given page content blocks.
// Each block: { y_baseline_mm, font, size, lines:[{text, x_mm}] }
// For simplicity we render text lines onto a Helvetica canvas per page.
export function buildTR205(data) {
  data = data || {};
  const name = data.name || '';
  const citation = data.citation || '';
  const court = data.court || '';
  const dob = data.dob || '';
  const dl = data.dl || '';
  const notes = data.notes || {};
  const date = notes.date || '';
  const code = notes.code || '';
  const today = notes.created_at ? new Date(notes.created_at).toISOString().slice(0, 10) : '';

  // MM/dd/yyyy military-style file date for filename is handled by caller.
  const rows = [];
  const push = (x, y, text, size, font) => {
    rows.push({ x, y, text: escapePdfText(text), size: size || 10, font: font || 'Helvetica' });
  };

  // Page size: US Letter 215.9mm x 279.4mm
  const W = 215.9, H = 279.4;
  const M = 18;

  // Header
  push(M, H - 22, 'REQUEST FOR TRIAL BY WRITTEN DECLARATION', 13, 'Helvetica-Bold');
  push(M, H - 28, '(Trial by Written Declaration - Traffic)  Vehicle Code, sec. 40902', 9, 'Helvetica');
  push(M, H - 34, 'Form TR-205  -  prefilled draft for your review', 8, 'Helvetica-Oblique');

  // Court-use block
  push(M, H - 48, 'NAME OF COURT:', 9, 'Helvetica-Bold');
  push(M + 40, H - 48, court || '[COURTHOUSE / CITY]', 10);
  push(M, H - 56, 'CITATION NUMBER:', 9, 'Helvetica-Bold');
  push(M + 40, H - 56, citation || '[CITATION #]', 10);
  push(M, H - 64, 'CASE NUMBER:', 9, 'Helvetica-Bold');
  push(M + 40, H - 64, '', 10);

  // Parties block
  push(M, H - 80, 'PEOPLE OF THE STATE OF CALIFORNIA', 10);
  push(M, H - 86, '  vs.  DEFENDANT:  ' + name, 10);
  push(M, H - 92, 'Defendant DL #:  ' + dl + '     DOB:  ' + dob, 10);

  // Request
  push(M, H - 106, 'REQUEST FOR TRIAL', 11, 'Helvetica-Bold');
  push(M + 4, H - 114, 'I request a trial by written declaration pursuant to Vehicle Code section 40902.', 10);
  push(M + 4, H - 122, 'I have reviewed the Instructions to Defendant (form TR-200).', 10);
  push(M + 4, H - 130, 'The facts in the Declaration of Facts are personally known to me and are true and correct.', 10);

  // Declaration of facts
  push(M, H - 148, 'DECLARATION OF FACTS', 11, 'Helvetica-Bold');
  push(M + 4, H - 156, 'On ' + (date || '[violation date]') + ' I received citation number ' + (citation || '[citation #]') + '.', 10);
  push(M + 4, H - 164, 'I submit this written declaration. Alleged violation code/section: ' + (code || '[section]') + '.', 10);
  push(M + 4, H - 172, 'Please see the attached statement and any evidence for the full facts of my case.', 10);

  // Signature block — Date, then citation, then printed name, then signature.
  push(M, H - 200, 'I declare under penalty of perjury under the laws of the State of California that the', 9.5);
  push(M + 4, H - 208, 'foregoing is true and correct.', 9.5);
  push(M, H - 220, 'Date: ' + today, 10, 'Helvetica-Bold');
  push(M + 40, H - 220, 'Citation number: ' + citation, 10, 'Helvetica-Bold');
  push(M, H - 228, 'Printed name: ' + name, 10);
  push(M, H - 236, 'Signature: ______________________________________', 10);

  return renderPdf(rows, W, H, M);
}

// Render text rows into a minimal single-page PDF (uncompressed Helvetica).
function renderPdf(rows, W, H, M) {
  const bw = Math.round(W * 72 / 25.4);   // page width in points
  const bh = Math.round(H * 72 / 25.4);   // page height in points
  const m = Math.round(M * 72 / 25.4);

  // Build content stream: set font, then for each row place text.
  let stream = 'BT\n';
  let lastState = null;
  for (const r of rows) {
    const fontKey = r.font === 'Helvetica' ? 'F1' : (r.font === 'Helvetica-Bold' ? 'F2' : 'F1');
    const state = fontKey + ' ' + Math.round(r.size * 72 / 25.4);
    if (state !== lastState) {
      stream += '/' + state + ' Tf\n';
      lastState = state;
    }
    const x = Math.round(r.x * 72 / 25.4);
    // y is measured from top (mm). Convert to PDF baseline from bottom.
    const y = bh - Math.round(r.y * 72 / 25.4) - Math.round(r.size * 72 / 25.4 * 0.2);
    stream += '1 0 0 1 ' + x + ' ' + y + ' Tm\n';
    stream += '(' + r.text + ') Tj\n';
  }
  stream += 'ET';

  const objects = [];
  objects.push([1, 0, '<< /Type /Catalog /Pages 2 0 R >>', '']);
  objects.push([2, 0, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>', '']);
  const contentObjId = 5;
  const contentRef = contentObjId + ' 0 R';
  objects.push([3, 0,
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + bw + ' ' + bh + '] /Resources << /Font << /F1 6 0 R /F2 7 0 R >> >> /Contents ' + contentRef + ' >>',
    '']);
  objects.push([contentObjId, 0, '<< /Length ' + stream.length + ' >>', stream]);
  objects.push([6, 0, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>', '']);
  objects.push([7, 0, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>', '']);

  let pdf = '%PDF-1.4\n';
  const offsets = [];
  for (const [id, gen, header, body] of objects) {
    offsets[id] = pdf.length;
    pdf += id + ' ' + gen + ' obj\n' + header + '\n';
    if (body) pdf += body + '\n';
    pdf += 'endobj\n';
  }
  const xrefPos = pdf.length;
  const count = objects.length + 1;
  pdf += 'xref\n0 ' + count + '\n0000000000 65535 f \n';
  for (let i = 1; i < count; i++) {
    pdf += String(offsets[i]).padStart(10, '0') + ' 00000 n \n';
  }
  pdf += 'trailer\n<< /Size ' + count + ' /Root 1 0 R >>\nstartxref\n' + xrefPos + '\n%%EOF';

  return new TextEncoder().encode(pdf);
}
