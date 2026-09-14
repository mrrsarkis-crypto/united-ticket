// Deterministic post-extraction classification for the documents the intake
// explicitly supports. Classification uses only fields actually read from the
// uploaded document and rejects unrelated images rather than guessing.

function usable(extracted, key) {
  const field = extracted && extracted[key];
  return !!(field && field.found === true && field.value);
}

export function documentSignals(extracted) {
  return {
    citation: usable(extracted, 'citationNumber'),
    violationCode: usable(extracted, 'violationCode'),
    violationDate: usable(extracted, 'violationDate'),
    violationDescription: usable(extracted, 'violationDescription'),
    bail: usable(extracted, 'bailAmount'),
    officer: usable(extracted, 'officerName') || usable(extracted, 'officerId'),
    court: usable(extracted, 'courtOrAgency'),
    courtDate: usable(extracted, 'courtDate'),
    dueDate: usable(extracted, 'dueDate'),
    dl: usable(extracted, 'drivingLicenseNumber'),
    dlState: usable(extracted, 'drivingLicenseState'),
    dob: usable(extracted, 'dateOfBirth'),
    name: usable(extracted, 'defendantName'),
    address: usable(extracted, 'mailingAddress'),
    plate: usable(extracted, 'vehiclePlate'),
  };
}

function looksLikeTicket(s) {
  const violationCore = s.violationCode && (s.citation || s.violationDate || s.bail || s.officer);
  const citationCore = s.citation && (s.violationDate || s.violationDescription || s.bail || s.officer);
  return !!(violationCore || citationCore);
}

function looksLikeLicense(s) {
  return !!(s.dl && (s.dlState || s.dob || s.name));
}

function looksLikeNotice(s) {
  const datedCourtNotice = s.court && (s.dueDate || s.courtDate);
  const referencedMatter = (s.court || s.citation) && (s.dueDate || s.courtDate) && (s.name || s.address || s.citation);
  return !!(datedCourtNotice || referencedMatter);
}

export function resolveDocumentType(requestedType, extracted) {
  const requested = ['auto', 'ticket', 'license', 'notice'].includes(String(requestedType || '').toLowerCase())
    ? String(requestedType || '').toLowerCase()
    : 'auto';
  const s = documentSignals(extracted);

  if (requested === 'ticket') return looksLikeTicket(s) ? 'ticket' : null;
  if (requested === 'license') return looksLikeLicense(s) ? 'license' : null;
  if (requested === 'notice') return looksLikeNotice(s) ? 'notice' : null;

  // A driver license has the most distinctive identity signature and should
  // not be mistaken for a citation merely because a plate-like value was read.
  if (looksLikeLicense(s) && !s.violationCode && !s.violationDate) return 'license';

  // Citation-specific fields outrank generic court/date fields that can also
  // appear on mailed court notices.
  if (looksLikeTicket(s)) return 'ticket';
  if (looksLikeNotice(s)) return 'notice';
  if (looksLikeLicense(s)) return 'license';

  return null;
}

export const __documentTypeTest = { usable, looksLikeTicket, looksLikeLicense, looksLikeNotice };
