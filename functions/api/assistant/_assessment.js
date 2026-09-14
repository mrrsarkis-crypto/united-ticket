// Deterministic scan-read confidence. This measures extraction reliability only.
// It is not a legal assessment, dismissal score, or probability of a court outcome.

const KEY_FIELDS = [
  ['citationNumber', 'citation number'],
  ['violationCode', 'violation code'],
  ['courtOrAgency', 'court/agency'],
  ['dueDate', 'response deadline'],
  ['violationDate', 'violation date'],
];

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

function normalizedQuality(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const grade = ['good', 'fair', 'poor'].includes(raw.grade) ? raw.grade : null;
  const warnings = Array.isArray(raw.warnings)
    ? [...new Set(raw.warnings.filter((value) => Object.hasOwn(QUALITY_WARNING_PENALTY, value)))].slice(0, 5)
    : [];
  return { grade, warnings, hardReject: raw.hardReject === true };
}

export function buildScanAssessment(extracted, options = {}) {
  const found = [];
  const missing = [];
  const verify = [];
  let confidentCount = 0;

  for (const [key, label] of KEY_FIELDS) {
    const field = extracted && extracted[key];
    if (usableField(field)) {
      found.push(label);
      if (field.confident === true) confidentCount++;
      else verify.push(label);
    } else {
      missing.push(label);
    }
  }

  const legibility = ['good', 'fair', 'poor'].includes(extracted && extracted.legibility)
    ? extracted.legibility
    : 'fair';
  const legibilityPoints = legibility === 'good' ? 30 : legibility === 'fair' ? 18 : 5;
  const rawConfidence = Math.max(0, Math.min(100,
    legibilityPoints + (found.length * 10) + (confidentCount * 4)
  ));

  const quality = normalizedQuality(options.clientQuality);
  let imageQualityPenalty = 0;
  if (quality) {
    for (const warning of quality.warnings) imageQualityPenalty += QUALITY_WARNING_PENALTY[warning] || 0;
    imageQualityPenalty = Math.min(20, imageQualityPenalty);
  }

  const validationWarningCount = Array.isArray(options.validationWarnings)
    ? options.validationWarnings.length
    : Math.max(0, Number(options.validationWarningCount || 0));
  const validationPenalty = Math.min(12, validationWarningCount * 3);

  let scanConfidencePercent = Math.max(0, rawConfidence - imageQualityPenalty - validationPenalty);
  if (quality && quality.grade === 'fair') scanConfidencePercent = Math.min(79, scanConfidencePercent);
  if (quality && quality.grade === 'poor') scanConfidencePercent = Math.min(54, scanConfidencePercent);
  scanConfidencePercent = Math.round(scanConfidencePercent);

  let label = 'Needs review';
  if (
    scanConfidencePercent >= 80 &&
    legibility === 'good' &&
    (!quality || quality.grade === 'good' || !quality.grade)
  ) {
    label = 'Strong read';
  } else if (
    scanConfidencePercent >= 55 &&
    legibility !== 'poor' &&
    (!quality || quality.grade !== 'poor')
  ) {
    label = 'Usable read';
  }

  const foundText = found.length
    ? 'Detected ' + found.join(', ') + '.'
    : 'Only limited ticket details were detected.';
  const missingText = missing.length
    ? ' Double-check ' + missing.join(', ') + ' manually.'
    : ' All key ticket fields were detected.';
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
    keyFieldsExpected: KEY_FIELDS.length,
    confidentKeyFields: confidentCount,
    missingKeyFields: missing,
    fieldsNeedingVerification: verify,
    needsManualReview: label !== 'Strong read',
    summary: foundText + missingText + verifyText + qualityText + validationText,
  };
}

export const __assessmentTest = { normalizedQuality, usableField, QUALITY_WARNING_PENALTY };
