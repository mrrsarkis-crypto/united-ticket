// Deterministic plausibility checks for scanner output.
// These checks never invent or repair values. They only downgrade confidence
// when extracted text does not look structurally plausible for the field.

function valueOf(field) {
  return field && field.found === true && field.value != null ? String(field.value).trim() : '';
}

function downgrade(extracted, key, warnings, reason) {
  const field = extracted && extracted[key];
  if (!field || field.found !== true || !field.value) return;
  field.confident = false;
  warnings.push({ field: key, reason });
}

function clearField(extracted, key, warnings, reason) {
  const field = extracted && extracted[key];
  if (!field || field.found !== true || !field.value) return;
  field.value = null;
  field.found = false;
  field.confident = false;
  warnings.push({ field: key, reason });
}

function plausibleDate(value) {
  const text = String(value || '').trim();
  let match = /^(\d{1,2})[\/-](\d{1,2})[\/-](\d{2}|\d{4})$/.exec(text);
  if (match) {
    const month = Number(match[1]);
    const day = Number(match[2]);
    let year = Number(match[3]);
    if (year < 100) year += year >= 70 ? 1900 : 2000;
    if (month < 1 || month > 12 || day < 1 || day > 31 || year < 1990 || year > 2100) return false;
    const date = new Date(Date.UTC(year, month - 1, day));
    return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
  }
  match = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(text);
  if (match) {
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    if (year < 1990 || year > 2100 || month < 1 || month > 12 || day < 1 || day > 31) return false;
    const date = new Date(Date.UTC(year, month - 1, day));
    return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
  }
  return false;
}

function birthDateValueFromText(value) {
  const text = String(value || '').trim();
  let match = /^(\d{1,2})[\/-](\d{1,2})[\/-](\d{2}|\d{4})$/.exec(text);
  if (!match) {
    const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(text);
    if (!iso) return null;
    match = [iso[0], iso[2], iso[3], iso[1]];
  }
  const month = Number(match[1]);
  const day = Number(match[2]);
  let year = Number(match[3]);
  const now = new Date();
  const currentYear = now.getUTCFullYear();
  if (year < 100) {
    const currentTwoDigitYear = currentYear % 100;
    year += year <= currentTwoDigitYear ? 2000 : 1900;
  }
  if (month < 1 || month > 12 || day < 1 || day > 31 || year < currentYear - 120 || year > currentYear) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return date;
}

function plausibleBirthDate(value) {
  return birthDateValueFromText(value) !== null;
}

function plausibleCitation(value) {
  const text = String(value || '').trim();
  return text.length >= 4 && text.length <= 24 && /\d/.test(text) && /^[A-Za-z0-9\-\/ ]+$/.test(text);
}

function plausibleViolationCode(value) {
  const text = String(value || '').trim();
  if (text.length < 3 || text.length > 32 || !/\d{3}/.test(text)) return false;
  return /^[A-Za-z0-9 .()\-\/]+$/.test(text);
}

function plausibleMoney(value) {
  const text = String(value || '').trim();
  if (!/^\$?\s*\d{1,6}(?:,\d{3})*(?:\.\d{1,2})?$/.test(text)) return false;
  const amount = Number(text.replace(/[^0-9.]/g, ''));
  return Number.isFinite(amount) && amount >= 0 && amount <= 100000;
}

function plausibleLicense(value) {
  const text = String(value || '').trim();
  return text.length >= 3 && text.length <= 25 && /[A-Za-z0-9]/.test(text) && /^[A-Za-z0-9\- ]+$/.test(text);
}

function plausiblePlate(value) {
  const text = String(value || '').trim();
  return text.length >= 1 && text.length <= 12 && /[A-Za-z0-9]/.test(text) && /^[A-Za-z0-9\- ]+$/.test(text);
}

function plausibleOfficerId(value) {
  const text = String(value || '').trim();
  return text.length >= 1 && text.length <= 20 && /^[A-Za-z0-9\- ]+$/.test(text);
}

function dateValue(field) {
  const text = valueOf(field);
  if (!text || !plausibleDate(text)) return null;
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(text);
  if (iso) return new Date(Date.UTC(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3])));
  const us = /^(\d{1,2})[\/-](\d{1,2})[\/-](\d{2}|\d{4})$/.exec(text);
  if (!us) return null;
  let year = Number(us[3]);
  if (year < 100) year += year >= 70 ? 1900 : 2000;
  return new Date(Date.UTC(year, Number(us[1]) - 1, Number(us[2])));
}

function plausiblePersonName(value) {
  const text = String(value || '').trim();
  return text.length >= 2 && text.length <= 80 && !/\d{3,}/.test(text) && /^[A-Za-zÀ-ÖØ-öø-ÿ .,'\-]+$/.test(text);
}

function looksLikeCourtAddress(value) {
  const text = String(value || '').trim();
  if (!text) return false;
  return /\b(superior court|municipal court|district court|traffic court|courthouse|court of|clerk of court|court clerk|judicial district|justice center)\b/i.test(text);
}

function normalizedViolationSection(value) {
  const text = String(value || '').toUpperCase().replace(/\s+/g, ' ').trim();
  const match = text.match(/\b(\d{3,5})(?:\s*\([A-Z0-9]+\))?/);
  return match ? match[1] : '';
}

function descriptionFitsKnownSection(code, description) {
  const section = normalizedViolationSection(code);
  const text = String(description || '').toLowerCase();
  if (!section || !text) return true;
  // California Vehicle Code 22350 is the basic speed law. A description from
  // a different violation row should never be paired with this section.
  if (section === '22350') return /\b(speed|speeding|safe|unsafe|reasonable|prudent)\b/i.test(text);
  return true;
}

function duplicateIdentifierFields(extracted, pairs, warnings) {
  for (const [left, right] of pairs) {
    const a = valueOf(extracted[left]);
    const b = valueOf(extracted[right]);
    if (a && b && a.toUpperCase().replace(/[^A-Z0-9]/g, '') === b.toUpperCase().replace(/[^A-Z0-9]/g, '')) {
      downgrade(extracted, left, warnings, 'identifier_collision');
      downgrade(extracted, right, warnings, 'identifier_collision');
    }
  }
}

export function applyFieldPlausibility(extracted) {
  const warnings = [];
  const dates = ['violationDate', 'courtDate', 'dueDate'];
  if (!extracted || typeof extracted !== 'object') return warnings;

  const citation = valueOf(extracted.citationNumber);
  if (citation && !plausibleCitation(citation)) downgrade(extracted, 'citationNumber', warnings, 'format');

  const code = valueOf(extracted.violationCode);
  if (code && !plausibleViolationCode(code)) downgrade(extracted, 'violationCode', warnings, 'format');
  const description = valueOf(extracted.violationDescription);
  if (code && description && !descriptionFitsKnownSection(code, description)) {
    clearField(extracted, 'violationDescription', warnings, 'code_description_mismatch');
  }

  for (const key of dates) {
    const value = valueOf(extracted[key]);
    if (value && !plausibleDate(value)) downgrade(extracted, key, warnings, 'date_format');
  }
  const dobText = valueOf(extracted.dateOfBirth);
  if (dobText && !plausibleBirthDate(dobText)) downgrade(extracted, 'dateOfBirth', warnings, 'date_format');

  const violationDate = dateValue(extracted.violationDate);
  const courtDate = dateValue(extracted.courtDate);
  const dueDate = dateValue(extracted.dueDate);
  const dob = birthDateValueFromText(dobText);
  if (violationDate && courtDate && courtDate < violationDate) {
    downgrade(extracted, 'courtDate', warnings, 'before_violation_date');
  }
  if (violationDate && dueDate && dueDate < violationDate) {
    downgrade(extracted, 'dueDate', warnings, 'before_violation_date');
  }
  if (violationDate && courtDate && courtDate.getTime() === violationDate.getTime()) {
    if (extracted.legibility === 'fair' || extracted.legibility === 'poor') {
      clearField(extracted, 'courtDate', warnings, 'same_as_violation_date');
    } else {
      downgrade(extracted, 'courtDate', warnings, 'same_as_violation_date');
    }
  }
  if (violationDate && dueDate && dueDate.getTime() === violationDate.getTime()) {
    if (extracted.legibility === 'fair' || extracted.legibility === 'poor') {
      clearField(extracted, 'dueDate', warnings, 'same_as_violation_date');
    } else {
      downgrade(extracted, 'dueDate', warnings, 'same_as_violation_date');
    }
  }
  if (dob && violationDate && dob >= violationDate) {
    downgrade(extracted, 'dateOfBirth', warnings, 'not_before_violation_date');
  }
  if (dob && courtDate && dob >= courtDate) {
    downgrade(extracted, 'dateOfBirth', warnings, 'not_before_court_date');
  }

  const bail = valueOf(extracted.bailAmount);
  if (bail && !plausibleMoney(bail)) downgrade(extracted, 'bailAmount', warnings, 'money_format');

  const state = valueOf(extracted.drivingLicenseState);
  if (state && !/^[A-Za-z]{2}$/.test(state)) downgrade(extracted, 'drivingLicenseState', warnings, 'state_format');

  const license = valueOf(extracted.drivingLicenseNumber);
  if (license && !plausibleLicense(license)) downgrade(extracted, 'drivingLicenseNumber', warnings, 'license_format');
  const normalizedState = state.toUpperCase();
  const compactLicense = license.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (license && normalizedState === 'CA' && !/^[A-Z][0-9]{7}$/.test(compactLicense)) {
    clearField(extracted, 'drivingLicenseNumber', warnings, 'california_license_format');
  }

  const plate = valueOf(extracted.vehiclePlate);
  if (plate && !plausiblePlate(plate)) downgrade(extracted, 'vehiclePlate', warnings, 'plate_format');

  const officerId = valueOf(extracted.officerId);
  if (officerId && !plausibleOfficerId(officerId)) downgrade(extracted, 'officerId', warnings, 'officer_id_format');

  const name = valueOf(extracted.defendantName);
  if (name && !plausiblePersonName(name)) downgrade(extracted, 'defendantName', warnings, 'name_format');

  const mailingAddress = valueOf(extracted.mailingAddress);
  if (mailingAddress && looksLikeCourtAddress(mailingAddress)) {
    downgrade(extracted, 'mailingAddress', warnings, 'possible_court_address');
  }

  // Handwritten fields on a globally fair scan can still be useful as a draft,
  // but they should not be presented as verified facts without a human check.
  if (extracted.legibility === 'fair') {
    for (const key of ['defendantName','drivingLicenseNumber','mailingAddress','violationDate','courtDate','dueDate','dateOfBirth','violationCode','violationDescription','officerName','officerId','location','vehicleMake','vehicleModel','vehiclePlate','bailAmount','bailDepositedAmount']) {
      const field = extracted[key];
      if (field && field.found === true && field.confident === true) {
        downgrade(extracted, key, warnings, 'fair_legibility_requires_verification');
      }
    }
  }

  // Vehicle make/model are low-value for case analysis but easy for vision models
  // to shift from neighboring handwritten boxes. On a fair/poor scan, prefer a
  // blank review field over a plausible-looking value that may belong elsewhere.
  if (extracted.legibility === 'fair' || extracted.legibility === 'poor') {
    clearField(extracted, 'vehicleMake', warnings, 'uncertain_vehicle_box_mapping');
    clearField(extracted, 'vehicleModel', warnings, 'uncertain_vehicle_box_mapping');
  }

  duplicateIdentifierFields(extracted, [
    ['citationNumber', 'officerId'],
    ['citationNumber', 'vehiclePlate'],
    ['drivingLicenseNumber', 'vehiclePlate'],
    ['drivingLicenseNumber', 'violationCode'],
  ], warnings);

  return warnings.slice(0, 20);
}

export const __plausibilityTest = {
  dateValue,
  plausibleDate,
  plausibleBirthDate,
  plausibleCitation,
  plausibleViolationCode,
  plausibleMoney,
  plausibleLicense,
  plausiblePlate,
  plausibleOfficerId,
  plausiblePersonName,
  looksLikeCourtAddress,
  normalizedViolationSection,
  descriptionFitsKnownSection,
};
