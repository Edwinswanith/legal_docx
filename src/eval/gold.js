// Gold-set scoring. A "gold" file is a human-verified copy of the critical
// fields of one document; scoring compares the pipeline's extraction to it.
// Recall = how many gold values the pipeline found; precision = how many of
// the values it produced are right. Omission (recall) and wrong reads
// (precision) fail differently, which is why both are reported.

const { norm } = require('../pipeline/consensus');
const { normalizeName } = require('../pipeline/identity');
const { toCents } = require('../pipeline/units');

const DOC_FIELDS = ['documentNumber', 'documentYear', 'executionDate'];
const PARTY_FIELDS = ['role', 'fullName', 'panNumber', 'aadhaarNumber'];
const SCHEDULE_FIELDS = ['oldSurveyNumber', 'newSurveyNumber', 'village', 'extentValue', 'extentUnit'];

const present = (v) => v != null && String(v).trim() !== '';
const pick = (obj, keys) => Object.fromEntries(keys.map((k) => [k, obj?.[k] ?? null]));

// The shape a gold file has, and what an extraction is reduced to for scoring.
function projectCritical(extraction) {
  return {
    ...pick(extraction, DOC_FIELDS),
    considerationAmount: extraction.considerationAmount?.value ?? null,
    stampDutyPaid: extraction.stamp?.stampDutyPaid ?? null,
    // Witnesses attest; they aren't parties to the title. Gold sets leave them out.
    parties: (extraction.parties || []).filter((p) => !/witness/i.test(p.role || '')).map((p) => pick(p, PARTY_FIELDS)),
    propertySchedules: (extraction.propertySchedules || []).map((s) => pick(s, SCHEDULE_FIELDS)),
  };
}

// Digits-only for amounts and identity numbers; word-normalised for the rest.
const DIGITS = new Set(['considerationAmount', 'stampDutyPaid', 'aadhaarNumber', 'documentYear']);
const SURVEY = new Set(['oldSurveyNumber', 'newSurveyNumber']);

// "Part of T.S.No.8, Block 20" and "T.S.No.8" name the same survey number; a
// survey field is compared as its set of numbers (8, 130/6, ...). Wording
// around them doesn't matter, an extra or missing number does.
// Block and ward numbers locate the survey number; they aren't one.
// "130/2&6" is the deed's shorthand for 130/2 and 130/6.
const expandShorthand = (v) => String(v).replace(/(\d+)\/(\d+)\s*(?:&|and)\s*(\d+)(?![\d/])/gi, '$1/$2, $1/$3');
const surveyNumbers = (v) => [...new Set(expandShorthand(v).replace(/\b(block|ward)\s*no\.?\s*\w+/gi, ' ').match(/\d+(?:\/\d+[A-Z]?)*/gi) || [])].sort().join(',');

// The deed's own wording ("VENDORS' POWER AGENT", "Purchaser") reduced to the
// role the report cares about.
function canonicalRole(v) {
  const r = String(v).toLowerCase();
  if (/agent|attorney/.test(r)) return 'agent';
  const known = ['vendor', 'purchaser', 'settlor', 'settlee', 'donor', 'donee', 'principal', 'mortgagor', 'mortgagee', 'witness'];
  return known.find((k) => r.includes(k)) || norm(v);
}

function comparable(field, value) {
  if (field === 'documentNumber') return norm(value).split(' ')[0]; // "2717 of 2024" -> "2717"
  if (field === 'fullName') return normalizeName(value).replace(/\b(MR|MRS|MS|SMT|DR)\b/g, '').replace(/\s+/g, ' ').trim();
  if (field === 'role') return canonicalRole(value);
  if (SURVEY.has(field)) return surveyNumbers(value);
  return DIGITS.has(field) ? String(value).replace(/\D/g, '') : norm(value);
}

// Flatten to a multiset of (field, value): array order and party/schedule
// position don't matter to whether a value was read correctly.
function facts(projected) {
  const out = [];
  const add = (field, value) => {
    if (present(value)) out.push({ field, key: `${field}=${comparable(field, value)}`, value });
  };
  DOC_FIELDS.forEach((f) => add(f, projected[f]));
  add('considerationAmount', projected.considerationAmount);
  add('stampDutyPaid', projected.stampDutyPaid);
  (projected.parties || []).forEach((p) => PARTY_FIELDS.forEach((f) => add(f, p[f])));
  (projected.propertySchedules || []).forEach((s) => {
    ['oldSurveyNumber', 'newSurveyNumber', 'village'].forEach((f) => add(f, s[f]));
    // Value and unit only mean something together: "0.48 Cents" and "0.48 Acre"
    // differ 100x. Scored as one fact, in cents when the unit is convertible.
    if (present(s.extentValue)) {
      const cents = toCents(s.extentValue, s.extentUnit);
      const key = cents == null ? norm(`${s.extentValue} ${s.extentUnit || ''}`.replace(/(\d)(st|nd|rd|th)\b/gi, '$1')) : `${Math.round(cents * 10) / 10}c`;
      out.push({ field: 'extent', key: `extent=${key}`, value: `${s.extentValue} ${s.extentUnit || ''}`.trim() });
    }
  });
  return out;
}

function groupByKey(list) {
  const m = new Map();
  list.forEach((f) => m.set(f.key, [...(m.get(f.key) || []), f]));
  return m;
}

// gold._skip lists fields the labeller couldn't determine from the scan; they
// are left out on both sides rather than guessed.
function scoreAgainstGold(extraction, gold) {
  const skip = new Set(gold._skip || []);
  const expected = facts(gold).filter((f) => !skip.has(f.field));
  const produced = facts(projectCritical(extraction)).filter((f) => !skip.has(f.field));
  const expectedBy = groupByKey(expected);
  const producedBy = groupByKey(produced);

  const byField = {};
  const bump = (field, prop) => {
    byField[field] = byField[field] || { expected: 0, found: 0, produced: 0, correct: 0 };
    byField[field][prop] += 1;
  };
  const misses = [];

  expected.forEach((f) => bump(f.field, 'expected'));
  produced.forEach((f) => bump(f.field, 'produced'));

  for (const [key, list] of expectedBy) {
    const matched = Math.min(list.length, (producedBy.get(key) || []).length);
    list.slice(0, matched).forEach((f) => { bump(f.field, 'found'); bump(f.field, 'correct'); });
    list.slice(matched).forEach((f) => misses.push({ field: f.field, kind: 'missing', value: f.value }));
  }
  for (const [key, list] of producedBy) {
    const wanted = (expectedBy.get(key) || []).length;
    list.slice(wanted).forEach((f) => misses.push({ field: f.field, kind: 'wrong', value: f.value }));
  }

  const sum = (prop) => Object.values(byField).reduce((n, f) => n + f[prop], 0);
  const ratio = (a, b) => (b === 0 ? 1 : a / b);
  return {
    overall: { recall: ratio(sum('found'), sum('expected')), precision: ratio(sum('correct'), sum('produced')) },
    byField,
    misses,
  };
}

module.exports = { projectCritical, scoreAgainstGold, facts };
