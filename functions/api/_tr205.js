// _tr205.js - official California Judicial Council TR-205 template filler.
// The repository stores a normalized copy of the current official form so the
// Worker can safely populate its real form fields with pdf-lib.
import { PDFDocument } from 'pdf-lib';

const TR205_TEMPLATE_URL = 'https://unitedtraffictickets.com/assets/tr205-template.pdf';

function escapePdfText(s) {
  return String(s == null ? '' : s)
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)');
}

function mm2pdf(x) { return Math.round(x * 72 / 25.4); }

export async function buildTR205(data, options = {}) {
  data = data || {};
  const notes = data.notes && typeof data.notes === 'object' ? data.notes : {};
  const templateUrl = options.templateUrl || data.templateUrl || TR205_TEMPLATE_URL;
  let templateBytes = options.templateBytes || data.templateBytes || null;

  if (!templateBytes) {
    const response = await fetch(templateUrl, { cf: { cacheTtl: 86400, cacheEverything: true } });
    if (!response.ok) throw new Error('TR-205 official template fetch failed: HTTP ' + response.status);
    templateBytes = new Uint8Array(await response.arrayBuffer());
  }

  const pdfDoc = await PDFDocument.load(templateBytes);
  const form = pdfDoc.getForm();

  const prefix = 'TR-205[0].';
  const field = (path) => prefix + path;
  const values = {
    citation: ['Page1[0].P1Caption[0].CitationNumber[0].CitationNumber[0]', data.citation],
    caseNumber: ['Page1[0].P1Caption[0].CaseNumber[0].CaseNumber[0]', data.caseNumber],
    courtName: ['Page1[0].P1Caption[0].AttyPartyInfo[0].Name[0]', data.court],
    courtStreetAddress: ['Page1[0].P1Caption[0].AttyPartyInfo[0].CrtStreet[0]', data.courtStreetAddress],
    courtMailingAddress: ['Page1[0].P1Caption[0].AttyPartyInfo[0].CrtMailingAdd[0]', data.courtMailingAddress],
    courtCityStateZip: ['Page1[0].P1Caption[0].AttyPartyInfo[0].CityZip_ft[0]', data.courtCityStateZip],
    courtBranchName: ['Page1[0].P1Caption[0].AttyPartyInfo[0].CrtBranch[0]', data.courtBranchName],
    defendant: ['Page1[0].P1Caption[0].CourtInfo[0].Party1[0]', data.name],
    dueDate: ['Page1[0].List1[0].Lia[0].FillText1[0]', notes.dueDate || data.dueDate],
    bailAmount: ['Page1[0].List1[0].Lib[0].TextFieldbail[0]', notes.bail || data.bailAmount],
    bailDeposited: ['Page1[0].List1[0].Lic[0].DecimalField1[0]', notes.bailDepositedAmount || data.bailDepositedAmount],
    clerkDate: ['Page1[0].List1[0].Lid[0].TextField2[0]', notes.clerkMailedOrDeliveredDate || data.clerkMailedOrDeliveredDate],
    clerkSpecify: ['Page1[0].List1[0].Lie[0].FillText109[0]', notes.clerkOfCourtSpecify || data.clerkOfCourtSpecify],
    clerkMailingAddress: ['Page1[0].List1[0].Lie[0].FillText125[0]', notes.clerkMailingAddress || data.courtMailingAddress],
    photoCount: ['Page1[0].List2[0].Li5[0].SubList5[0].Lia[0].FillText109[0]', notes.evidencePhotographsCount],
    otherEvidence: ['Page1[0].List2[0].Li5[0].SubList5[0].Lih[0].FillText11[0]', notes.evidenceOtherSpecify],
    defendantPage2: ['Page2[0].PxCaption[0].TitlePartyName[0].Party1[0]', data.name],
    casePage2: ['Page2[0].PxCaption[0].CaseNumber[0].CaseNumber[0]', data.caseNumber],
    namePage2: ['Page2[0].List2[0].Li6[0].TextField1[0]', data.name],
    mailingAddressPage2: ['Page2[0].List2[0].Li6[0].FillText19[0]', data.mailingAddress],
    statementFacts: ['Page2[0].List2[0].Li6[0].FillText20[0]', notes.statementOfFacts || data.statementOfFacts],
    pagesAttached: ['Page2[0].List2[0].Li7[0].DateofHearing_dt[0]', notes.pagesAttached || data.pagesAttached],
    signatureDate: ['Page2[0].Sign[0].SigDate[0]', data.signatureDate],
    signatureName: ['Page2[0].Sign[0].SigName[0]', data.name],
  };

  for (const [key, [path, value]] of Object.entries(values)) {
    if (value == null || String(value).trim() === '') continue;
    try { form.getTextField(field(path)).setText(String(value).trim()); }
    catch (error) { throw new Error('TR-205 field mapping failed for ' + key + ': ' + String(error.message || error)); }
  }

  const evidence = notes.evidence && typeof notes.evidence === 'object' ? notes.evidence : {};
  const checks = {
    photographs: 'Page1[0].List2[0].Li5[0].SubList5[0].Lia[0].Choice1[0]',
    medicalRecord: 'Page1[0].List2[0].Li5[0].SubList5[0].Lib[0].Choice9[0]',
    registrationDocuments: 'Page1[0].List2[0].Li5[0].SubList5[0].Lic[0].Choice3[0]',
    inspectionCertificate: 'Page1[0].List2[0].Li5[0].SubList5[0].Lid[0].Choice4[0]',
    diagram: 'Page1[0].List2[0].Li5[0].SubList5[0].Lie[0].Choice5[0]',
    carRepairReceipt: 'Page1[0].List2[0].Li5[0].SubList5[0].Lif[0].Choice6[0]',
    insuranceDocuments: 'Page1[0].List2[0].Li5[0].SubList5[0].Lig[0].Choice7[0]',
    other: 'Page1[0].List2[0].Li5[0].SubList5[0].Lih[0].Choice8[0]',
  };
  for (const [key, path] of Object.entries(checks)) {
    if (evidence[key] === true) form.getCheckBox(field(path)).check();
  }

  form.updateFieldAppearances();
  if (options.flatten !== false) form.flatten({ updateFieldAppearances: false });
  return await pdfDoc.save({ useObjectStreams: false });
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

// Build a client Retainer Agreement PDF (confidential work product NOT included).
// The client signs this to engage services. Fee is itemized.
export function buildRetainer(data) {
  data = data || {};
  const name = data.name || '';
  const email = data.email || '';
  const tracking = data.tracking || '';
  const service = data.service || '';
  const fee = data.fee || '0.00';
  const date = data.date || '';

  const W = 215.9, H = 279.4, M = 18;
  const rows = [];
  const push = (x, y, text, size, font) => {
    rows.push({ x, y, text: escapePdfText(text), size: size || 10, font: font || 'Helvetica' });
  };

  push(M, H - 22, 'RETAINER AGREEMENT', 13, 'Helvetica-Bold');
  push(M, H - 28, 'United Traffic Tickets Defense  -  unitedtraffictickets.com  -  (818) 205-8271', 8, 'Helvetica');
  push(M, H - 34, 'Case reference: ' + tracking, 9, 'Helvetica');

  push(M, H - 50, 'THIS RETAINER AGREEMENT ("Agreement") is entered into as of this ' + (date || '____ day of ________, 20__') + ',', 9);
  push(M + 4, H - 58, 'by and between United Traffic Tickets Defense ("Firm") and the client named below ("Client"):', 9);

  push(M, H - 74, 'Client name: ' + (name || '[NAME]'), 10, 'Helvetica-Bold');
  push(M, H - 80, 'Client email: ' + (email || '[EMAIL]'), 10);
  push(M, H - 86, 'Selected services: ' + (service || '[service]'), 10);

  push(M, H - 100, '1. SERVICES', 9, 'Helvetica-Bold');
  push(M + 4, H - 106, 'The Firm will analyze the subject traffic citation, prepare the applicable declaration and', 9);
  push(M + 4, H - 112, 'defense materials for the Client\u2019s review, and assist as described in the selected service tier.', 9);

  push(M, H - 126, '2. FEE', 9, 'Helvetica-Bold');
  push(M + 4, H - 132, 'Client agrees to pay the Firm a fee of $' + fee + ' for the selected services. This fee covers', 9);
  push(M + 4, H - 138, 'the work described above. Payment has been (or will be) processed via the Firm\u2019s secure checkout.', 9);

  push(M, H - 152, '3. SCOPE / NO GUARANTEE', 9, 'Helvetica-Bold');
  push(M + 4, H - 158, 'The Firm does not guarantee any particular outcome. No legal advice is given through this', 9);
  push(M + 4, H - 164, 'self-help service. Client is solely responsible for the accuracy of all information provided and', 9);
  push(M + 4, H - 170, 'for reviewing and filing any documents as applicable.', 9);

  push(M, H - 184, '4. SIGNATURE', 9, 'Helvetica-Bold');
  push(M + 4, H - 190, 'By signing below, Client agrees to the terms of this retainer and confirms the information provided.', 9);

  push(M, H - 206, 'Client printed name: ' + (name || '______________________'), 10);
  push(M, H - 214, 'Date: ______________________', 10);
  push(M, H - 226, 'Client signature: ______________________________________', 10);

  return renderPdf(rows, W, H, M);
}

// Build a Payment Receipt PDF for the client (never includes confidential work product).
export function buildReceipt(data) {
  data = data || {};
  const name = data.name || '';
  const email = data.email || '';
  const tracking = data.tracking || '';
  const fee = data.fee || '0.00';
  const date = data.date || new Date().toISOString().slice(0, 10);

  const W = 215.9, H = 279.4, M = 18;
  const rows = [];
  const push = (x, y, text, size, font) => {
    rows.push({ x, y, text: escapePdfText(text), size: size || 10, font: font || 'Helvetica' });
  };

  push(M, H - 22, 'PAYMENT RECEIPT', 13, 'Helvetica-Bold');
  push(M, H - 28, 'United Traffic Tickets Defense  -  (818) 205-8271', 8, 'Helvetica');

  push(M, H - 44, 'Receipt', 10, 'Helvetica-Bold');
  push(M, H - 52, 'Date: ' + date, 10);
  push(M, H - 58, 'Case reference (tracking): ' + tracking, 10);
  push(M, H - 64, 'Billed to: ' + name + '  (' + email + ')', 10);

  push(M, H - 80, 'Description', 10, 'Helvetica-Bold');
  push(M + 90, H - 80, 'Amount', 10, 'Helvetica-Bold');
  push(M, H - 88, 'Traffic ticket defense services', 10);
  push(M + 90, H - 88, '$' + fee, 10);
  push(M, H - 96, 'Total paid', 10, 'Helvetica-Bold');
  push(M + 90, H - 96, '$' + fee, 10, 'Helvetica-Bold');

  push(M, H - 116, 'This receipt confirms payment received. Your signed retainer is provided separately.', 9);
  push(M + 4, H - 122, 'For questions contact (818) 205-8271 or the case tracking page.', 9);

  push(M, H - 140, 'Thank you for your business.', 10, 'Helvetica-Oblique');

  return renderPdf(rows, W, H, M);
}
