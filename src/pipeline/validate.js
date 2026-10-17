// Deterministic, non-LLM checks. These never call Gemini — arithmetic,
// format checks, and presence checks are things plain code does exactly,
// per the architecture's "keep Gemini out of arithmetic" principle.

const PAN_RE = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
const AADHAAR_RE = /^\d{4}\s?\d{4}\s?\d{4}$/;
const KNOWN_EXTENT_UNITS = [
  'acre', 'acres', 'cent', 'cents', 'sq.ft', 'sq ft', 'square feet',
  'sq.m', 'sq.mtr', 'sq mtr', 'sq.metre', 'sq metre', 'square metres', 'square meters',
  'hectare', 'hectares', 'ground', 'grounds', 'undivided share',
];

function normalize(unit) {
  return (unit || '')
    .trim()
    .toLowerCase()
    .replace(/\([^)]*\)/g, '') // strip qualifiers like "(1/2 Undivided share)"
    .trim()
    .replace(/\.$/, '');
}

function validateExtraction(extraction) {
  const warnings = [];
  const errors = [];

  if (!extraction.parties || extraction.parties.length === 0) {
    errors.push('No parties extracted — every document in this registry should name at least one party.');
  }
  if (!extraction.propertySchedules || extraction.propertySchedules.length === 0) {
    warnings.push('No property schedule extracted — expected for a title document; confirm the source pages were legible.');
  }
  if (!extraction.citations || extraction.citations.length === 0) {
    warnings.push('No citations returned — extracted values cannot be traced back to a source page.');
  }

  (extraction.parties || []).forEach((party, i) => {
    if (party.panNumber && !PAN_RE.test(party.panNumber.replace(/\s/g, ''))) {
      warnings.push(`parties[${i}].panNumber ("${party.panNumber}") does not match the standard PAN format.`);
    }
    if (party.aadhaarNumber && !AADHAAR_RE.test(party.aadhaarNumber.trim())) {
      warnings.push(`parties[${i}].aadhaarNumber ("${party.aadhaarNumber}") does not match the standard 12-digit Aadhaar format.`);
    }
    if (!party.fullName) {
      errors.push(`parties[${i}] is missing fullName.`);
    }
  });

  (extraction.propertySchedules || []).forEach((sched, i) => {
    const isEffectivelyEmpty =
      !sched.description && !sched.oldSurveyNumber && !sched.newSurveyNumber && !sched.extentValue;
    if (isEffectivelyEmpty) {
      warnings.push(
        `propertySchedules[${i}] has only a scheduleLabel and no other data — likely a duplicate/partial extraction of another schedule entry; check against the source before trusting it.`,
      );
    }
    if (sched.extentUnit && !KNOWN_EXTENT_UNITS.includes(normalize(sched.extentUnit))) {
      warnings.push(`propertySchedules[${i}].extentUnit ("${sched.extentUnit}") is not in the known unit list — check for a transcription issue or add it to KNOWN_EXTENT_UNITS.`);
    }
    // Tamil Nadu deeds write "Acre 0.47 Cents" for 0.47 acre (= 47 cents). The
    // model has repeatedly recorded that as 0.47 *cents* — a 100x error. No
    // land parcel in a title deed is under one cent, so flag it.
    const centsValue = Number(String(sched.extentValue ?? '').replace(/[^0-9.]/g, ''));
    if (/^cents?$/.test(normalize(sched.extentUnit || '')) && centsValue > 0 && centsValue < 1) {
      warnings.push(`propertySchedules[${i}].extent "${sched.extentValue} ${sched.extentUnit}" is under one cent — almost certainly "Acre ${sched.extentValue} Cents" (= ${Math.round(centsValue * 100)} cents) misread. Verify against the scan.`);
    }
    if (sched.extentValue && Number.isNaN(Number(String(sched.extentValue).replace(/[^0-9.]/g, '')))) {
      warnings.push(`propertySchedules[${i}].extentValue ("${sched.extentValue}") is not numeric.`);
    }
    if (!sched.oldSurveyNumber && !sched.newSurveyNumber) {
      warnings.push(`propertySchedules[${i}] has neither an old nor a new survey number — needed for Section 4 (survey correlation) of the report.`);
    }
  });

  if (!extraction.documentNumber || !extraction.documentYear) {
    warnings.push('documentNumber/documentYear incomplete — needed to place this document in the title chain unambiguously.');
  }

  return { warnings, errors, isClean: errors.length === 0 };
}

module.exports = { validateExtraction };
