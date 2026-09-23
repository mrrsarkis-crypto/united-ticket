// Deterministic scan-read confidence. This measures extraction reliability only.
// It is not a legal assessment, dismissal score, or probability of a court outcome.

const KEY_FIELD_GROUPS = {
  ticket: [
    { keys: ['citationNumber'], label: 'citation number' },
    { keys: ['violationCode'], label: 'violation code' },
    { keys: ['courtOrAgency'], label: 'court/agency' },
    { keys: ['dueDate', 'courtDate'], label: 'response/court date' },
    { keys: ['violationDate'], label: 'violation date' },
  ],
  license: [
    { keys: ['drivingLicenseNumber'], label: 'driver license number' },
    { keys: ['defendantName'], label: 'name' },
    { keys: ['dateOfBirth'], label: 'date of birth' },
    { keys: ['drivingLicenseState'], label: 'issuing state' },
  ],
  notice: [
    { keys: ['courtOrAgency'], label: 'court/agency' },
    { keys: ['dueDate', 'courtDate'], label: 'response/court date' },
    { keys: ['citationNumber'], label: 'citation/case reference' },
    { keys: ['defendantName', 'mailingAddress'], label: 'recipient identity' },
  ],
};

const QUALITY_WARNING_PENALTY = {
  low_resolution: 4,
  too_dark: 7,
  too_bright: 7,
  low_contrast: 5,
  possible_blur: 6,
};

function usableField(field) {
  return !!(field && field.found === true && field.value);
}

function readGroup(extracted, group) {
  const candidates = group.keys.map((key) => extracted && extracted[key]).filter(Boolean);
  const found = candidates.filter(usableField);
  return {
    found: found.length > 0,
    confident: found.some((field) => field.confident === true),
  };
}

function normalizedQuality(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const grade = ['good', 'fair', 'poor'].includes(raw.grade) ? raw.grade : null;
  const warnings = Array.isArray(raw.warnings)
    ? [...new Set(raw.warnings.filter((value) => Object.hasOwn(QUALITY_WARNING_PENALTY, value)))].slice(0, 5)
    : [];
  return { grade, warnings, hardReject: raw.hardReject === true };
}

export function buildScanAssessment(extracted, options = {}) {
  const documentType = ['ticket', 'license', 'notice'].includes(options.documentType)
    ? options.documentType
    : 'ticket';
  const keyFields = KEY_FIELD_GROUPS[documentType];
  const found = [];
  const missing = [];
  const verify = [];
  let confidentCount = 0;

  for (const group of keyFields) {
    const state = readGroup(extracted, group);
    if (state.found) {
      found.push(group.label);
      if (state.confident) confidentCount++;
      else verify.push(group.label);
    } else {
      missing.push(group.label);
    }
  }

  const legibility = ['good', 'fair', 'poor'].includes(extracted && extracted.legibility)
    ? extracted.legibility
    : 'fair';
  const legibilityPoints = legibility === 'good' ? 30 : legibility === 'fair' ? 18 : 5;
  const perFieldPoints = keyFields.length ? 50 / keyFields.length : 0;
  const perConfidencePoints = keyFields.length ? 20 / keyFields.length : 0;
  const rawConfidence = Math.max(0, Math.min(100, Math.round(
    legibilityPoints + (found.length * perFieldPoints) + (confidentCount * perConfidencePoints)
  )));

  const quality = normalizedQuality(options.clientQuality);
  let imageQualityPenalty = 0;
  if (quality) {
    for (const warning of quality.warnings) imageQualityPenalty += QUALITY_WARNING_PENALTY[warning] || 0;
    imageQualityPenalty = Math.min(20, imageQualityPenalty);
  }

  const validationWarnings = Array.isArray(options.validationWarnings) ? options.validationWarnings : [];
  const validationWarningCount = validationWarnings.length || Math.max(0, Number(options.validationWarningCount || 0));
  const validationPenalty = Math.min(12, validationWarningCount * 3);
  const criticalTicketFields = new Set(['citationNumber','violationCode','dueDate','courtDate','violationDate']);
  const criticalValidationWarning = documentType === 'ticket' && validationWarnings.some((warning) => {
    const field = typeof warning === 'string' ? warning : warning && warning.field;
    return criticalTicketFields.has(field);
  });
  const criticalVerificationNeeded = documentType === 'ticket' && verify.some((label) =>
    ['citation number','violation code','response/court date','violation date'].includes(label)
  );
  const criticalKeyConcern = criticalValidationWarning || criticalVerificationNeeded;

  let scanConfidencePercent = Math.max(0, rawConfidence - imageQualityPenalty - validationPenalty);
  if (quality && quality.grade === 'fair') scanConfidencePercent = Math.min(79, scanConfidencePercent);
  if (quality && quality.grade === 'poor') scanConfidencePercent = Math.min(54, scanConfidencePercent);
  if (criticalKeyConcern) scanConfidencePercent = Math.min(69, scanConfidencePercent);
  scanConfidencePercent = Math.round(scanConfidencePercent);

  const allKeyFieldsReliable = missing.length === 0 && verify.length === 0 && validationWarningCount === 0;

  let label = 'Needs review';
  if (
    scanConfidencePercent >= 80 &&
    legibility === 'good' &&
    allKeyFieldsReliable &&
    (!quality || quality.grade === 'good' || !quality.grade)
  ) {
    label = 'Strong read';
  } else if (
    scanConfidencePercent >= 55 &&
    legibility !== 'poor' &&
    !criticalKeyConcern &&
    (!quality || quality.grade !== 'poor')
  ) {
    label = 'Usable read';
  }

  const noun = documentType === 'license' ? 'license' : documentType === 'notice' ? 'notice' : 'ticket';
  const foundText = found.length
    ? 'Detected ' + found.join(', ') + '.'
    : 'Only limited ' + noun + ' details were detected.';
  const missingText = missing.length
    ? ' Double-check ' + missing.join(', ') + ' manually.'
    : ' All key ' + noun + ' fields were detected.';
  const verifyText = verify.length
    ? ' Verify ' + verify.join(', ') + ' because the scan was not fully confident.'
    : '';
  const qualityText = quality && quality.grade === 'fair'
    ? ' Photo quality was usable but not ideal.'
    : quality && quality.grade === 'poor'
      ? ' Photo quality was weak; a clearer photo is recommended.'
      : '';
  const validationText = validationWarningCount > 0
    ? ' One or more captured values were marked for human verification after format checks.'
    : '';

  return {
    label,
    documentType,
    legibility,
    scanConfidencePercent,
    rawScanConfidencePercent: rawConfidence,
    qualityAdjusted: true,
    imageQualityGrade: quality && quality.grade || null,
    imageQualityWarnings: quality ? quality.warnings : [],
    imageQualityPenalty,
    validationWarningCount,
    validationPenalty,
    keyFieldsDetected: found.length,
    keyFieldsExpected: keyFields.length,
    confidentKeyFields: confidentCount,
    missingKeyFields: missing,
    fieldsNeedingVerification: verify,
    needsManualReview: label !== 'Strong read',
    summary: foundText + missingText + verifyText + qualityText + validationText,
  };
}

export const __assessmentTest = {
  normalizedQuality,
  usableField,
  readGroup,
  QUALITY_WARNING_PENALTY,
  KEY_FIELD_GROUPS,
};
