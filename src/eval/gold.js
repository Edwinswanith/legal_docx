// Gold-set scoring. A "gold" file is a human-verified copy of the critical
// fields of one document; scoring compares the pipeline's extraction to it.
// Recall = how many gold values the pipeline found; precision = how many of
// the values it produced are right. Omission (recall) and wrong reads
// (precision) fail differently, which is why both are reported.

const { norm } = require('../pipeline/consensus');

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
    parties: (extraction.parties || []).map((p) => pick(p, PARTY_FIELDS)),
    propertySchedules: (extraction.propertySchedules || []).map((s) => pick(s, SCHEDULE_FIELDS)),
  };
}

// Digits-only for amounts and identity numbers; word-normalised for the rest.
const DIGITS = new Set(['considerationAmount', 'stampDutyPaid', 'aadhaarNumber', 'documentYear']);
function comparable(field, value) {
  if (field === 'documentNumber') return norm(value).split(' ')[0]; // "2717 of 2024" -> "2717"
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
  (projected.propertySchedules || []).forEach((s) => SCHEDULE_FIELDS.forEach((f) => add(f, s[f])));
  return out;
}

function groupByKey(list) {
  const m = new Map();
  list.forEach((f) => m.set(f.key, [...(m.get(f.key) || []), f]));
  return m;
}

function scoreAgainstGold(extraction, gold) {
  const expected = facts(gold);
  const produced = facts(projectCritical(extraction));
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
