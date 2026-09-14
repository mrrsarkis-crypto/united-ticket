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

function plausiblePersonName(value) {
  const text = String(value || '').trim();
  return text.length >= 2 && text.length <= 80 && !/\d{3,}/.test(text) && /^[A-Za-zÀ-ÖØ-öø-ÿ .,'\-]+$/.test(text);
}

export function applyFieldPlausibility(extracted) {
  const warnings = [];
  if (!extracted || typeof extracted !== 'object') return warnings;

  const citation = valueOf(extracted.citationNumber);
  if (citation && !plausibleCitation(citation)) downgrade(extracted, 'citationNumber', warnings, 'format');

  const code = valueOf(extracted.violationCode);
  if (code && !plausibleViolationCode(code)) downgrade(extracted, 'violationCode', warnings, 'format');

  for (const key of ['violationDate', 'courtDate', 'dueDate', 'dateOfBirth']) {
    const value = valueOf(extracted[key]);
    if (value && !plausibleDate(value)) downgrade(extracted, key, warnings, 'date_format');
  }

  const bail = valueOf(extracted.bailAmount);
  if (bail && !plausibleMoney(bail)) downgrade(extracted, 'bailAmount', warnings, 'money_format');

  const state = valueOf(extracted.drivingLicenseState);
  if (state && !/^[A-Za-z]{2}$/.test(state)) downgrade(extracted, 'drivingLicenseState', warnings, 'state_format');

  const license = valueOf(extracted.drivingLicenseNumber);
  if (license && !plausibleLicense(license)) downgrade(extracted, 'drivingLicenseNumber', warnings, 'license_format');

  const plate = valueOf(extracted.vehiclePlate);
  if (plate && !plausiblePlate(plate)) downgrade(extracted, 'vehiclePlate', warnings, 'plate_format');

  const officerId = valueOf(extracted.officerId);
  if (officerId && !plausibleOfficerId(officerId)) downgrade(extracted, 'officerId', warnings, 'officer_id_format');

  const name = valueOf(extracted.defendantName);
  if (name && !plausiblePersonName(name)) downgrade(extracted, 'defendantName', warnings, 'name_format');

  return warnings.slice(0, 20);
}

export const __plausibilityTest = {
  plausibleDate,
  plausibleCitation,
  plausibleViolationCode,
  plausibleMoney,
  plausibleLicense,
  plausiblePlate,
  plausibleOfficerId,
  plausiblePersonName,
};
