const test = require('node:test');
const assert = require('node:assert');
const { projectCritical, scoreAgainstGold } = require('../src/eval/gold');

const extraction = {
  documentNumber: '2717', documentYear: '2024', executionDate: '27th DAY OF MARCH, 2024',
  considerationAmount: { value: '89484212' }, stamp: { stampDutyPaid: '7246900' },
  parties: [
    { role: 'VENDOR', fullName: 'Mrs.HARSHA VASANT', panNumber: 'AAYPH8475N', aadhaarNumber: '6927 3302 6449', age: '58' },
    { role: 'PURCHASER', fullName: 'Mr.C.KARTHIKEYAN', panNumber: 'BHYPK5605D', aadhaarNumber: null },
  ],
  propertySchedules: [{ oldSurveyNumber: '130/6', newSurveyNumber: 'T.S.No.8', village: 'Zamin Pallavaram', extentValue: '3206', extentUnit: 'sq.mtr', description: 'long text' }],
};

test('projectCritical keeps only critical fields', () => {
  const p = projectCritical(extraction);
  assert.strictEqual(p.documentNumber, '2717');
  assert.strictEqual(p.considerationAmount, '89484212');
  assert.deepStrictEqual(Object.keys(p.parties[0]).sort(), ['aadhaarNumber', 'fullName', 'panNumber', 'role']);
  assert.ok(!('description' in p.propertySchedules[0]));
});

test('a perfect extraction scores 100%', () => {
  const s = scoreAgainstGold(extraction, projectCritical(extraction));
  assert.strictEqual(s.overall.recall, 1);
  assert.strictEqual(s.overall.precision, 1);
  assert.deepStrictEqual(s.misses, []);
});

test('a wrong digit is both a miss and a wrong value', () => {
  const gold = projectCritical(extraction);
  gold.parties[0].aadhaarNumber = '6927 3302 6448';
  const s = scoreAgainstGold(extraction, gold);
  assert.ok(s.overall.recall < 1 && s.overall.precision < 1);
  assert.ok(s.misses.some((m) => m.field === 'aadhaarNumber' && m.kind === 'missing'));
  assert.ok(s.misses.some((m) => m.field === 'aadhaarNumber' && m.kind === 'wrong'));
});

test('an omitted value lowers recall but not precision', () => {
  const gold = projectCritical(extraction);
  const partial = structuredClone(extraction);
  partial.parties[0].panNumber = null;
  const s = scoreAgainstGold(partial, gold);
  assert.ok(s.overall.recall < 1);
  assert.strictEqual(s.overall.precision, 1);
});

test('formatting differences still match', () => {
  const gold = projectCritical(extraction);
  const alt = structuredClone(extraction);
  alt.stamp.stampDutyPaid = '72,46,900';
  alt.documentNumber = '2717 of 2024';
  assert.strictEqual(scoreAgainstGold(alt, gold).overall.recall, 1);
});

test('per-field breakdown is reported', () => {
  const s = scoreAgainstGold(extraction, projectCritical(extraction));
  assert.strictEqual(s.byField.panNumber.expected, 2);
});

test('survey wording, honorifics and role phrasing do not cause misses', () => {
  const gold = projectCritical(extraction);
  gold.parties[0].fullName = 'HARSHA VASANT';
  gold.parties[1].role = 'PURCHASER';
  gold.propertySchedules[0].newSurveyNumber = 'Part of T.S.No.8, Block No.20';
  assert.strictEqual(scoreAgainstGold(extraction, gold).overall.recall, 1);
});

test('an extra survey number is a mismatch', () => {
  const gold = projectCritical(extraction);
  const alt = structuredClone(extraction);
  alt.propertySchedules[0].newSurveyNumber = 'TSLR 130/6, T.S.No.8';
  assert.ok(scoreAgainstGold(alt, gold).overall.recall < 1);
});

test('survey shorthand "130/2&6" equals "130/2, 130/6"', () => {
  const gold = projectCritical(extraction);
  gold.propertySchedules[0].oldSurveyNumber = '130/2&6';
  const alt = structuredClone(extraction);
  alt.propertySchedules[0].oldSurveyNumber = 'Old Survey No.130/2 & 130/6';
  assert.strictEqual(scoreAgainstGold(alt, gold).byField.oldSurveyNumber.found, 1);
});

test('extent is compared in cents, so a unit error is caught', () => {
  const gold = projectCritical(extraction);
  gold.propertySchedules[0] = { ...gold.propertySchedules[0], extentValue: '0.48', extentUnit: 'Acre' };
  const ok = structuredClone(extraction);
  ok.propertySchedules[0] = { ...ok.propertySchedules[0], extentValue: '48', extentUnit: 'Cents' };
  const bad = structuredClone(extraction);
  bad.propertySchedules[0] = { ...bad.propertySchedules[0], extentValue: '0.48', extentUnit: 'Cents' };
  assert.strictEqual(scoreAgainstGold(ok, gold).byField.extent.found, 1);
  assert.strictEqual(scoreAgainstGold(bad, gold).byField.extent.found, 0);
});

test('fields listed in _skip are not scored', () => {
  const gold = { ...projectCritical(extraction), stampDutyPaid: null, _skip: ['stampDutyPaid'] };
  const s = scoreAgainstGold(extraction, gold);
  assert.strictEqual(s.byField.stampDutyPaid, undefined);
  assert.strictEqual(s.overall.precision, 1);
});
