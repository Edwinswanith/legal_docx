const test = require('node:test');
const assert = require('node:assert');
const { mergeRuns } = require('../src/pipeline/consensus');

const party = (over) => ({ role: 'VENDOR', fullName: 'Mrs.HARSHA VASANT', panNumber: 'AAYPH8475N', ...over });

test('identical runs produce no disagreements', () => {
  const run = { documentNumber: '2717 of 2024', parties: [party()] };
  const { merged, disagreements } = mergeRuns([run, structuredClone(run)]);
  assert.deepStrictEqual(merged, run);
  assert.deepStrictEqual(disagreements, []);
});

test('formatting-only differences are not disagreements', () => {
  const a = { documentNumber: '1388 of 2002', propertySchedules: [{ village: 'Zamin Pallavaram' }] };
  const b = { documentNumber: '1388/2002', propertySchedules: [{ village: 'Zamin Pallavaram village' }] };
  assert.deepStrictEqual(mergeRuns([a, b]).disagreements, []);
});

test('a critical field present in only one run is filled in and flagged', () => {
  const a = { parties: [party({ aadhaarNumber: null })] };
  const b = { parties: [party({ aadhaarNumber: '8995 2253 1729' })] };
  const { merged, disagreements } = mergeRuns([a, b]);
  assert.strictEqual(merged.parties[0].aadhaarNumber, '8995 2253 1729');
  assert.deepStrictEqual(disagreements.map((d) => [d.path, d.kind]), [['parties[0].aadhaarNumber', 'omitted']]);
});

test('conflicting critical values keep run A and record both', () => {
  const a = { propertySchedules: [{ extentValue: '24', extentUnit: 'cents' }] };
  const b = { propertySchedules: [{ extentValue: '1.2', extentUnit: 'acre' }] };
  const { merged, disagreements } = mergeRuns([a, b]);
  assert.strictEqual(merged.propertySchedules[0].extentValue, '24');
  const d = disagreements.find((x) => x.path === 'propertySchedules[0].extentValue');
  assert.deepStrictEqual([d.kind, d.values], ['conflict', ['24', '1.2']]);
  assert.ok(disagreements.some((x) => x.path === 'propertySchedules[0].extentUnit'));
});

test('free-text paraphrase differences are ignored', () => {
  const a = { parties: [party({ relationName: 'late Kishore G Vasant' })], description: 'vacant land' };
  const b = { parties: [party({ relationName: 'Late Kishore Vasant' })], description: 'a vacant plot' };
  assert.deepStrictEqual(mergeRuns([a, b]).disagreements, []);
});

test('array items are matched by identity, not position', () => {
  const x = party({ fullName: 'A ONE', panNumber: 'AAAAA1111A' });
  const y = party({ fullName: 'B TWO', panNumber: 'BBBBB2222B' });
  const { disagreements } = mergeRuns([{ parties: [x, y] }, { parties: [y, x] }]);
  assert.deepStrictEqual(disagreements, []);
});

test('an array item found in only one run is appended and flagged', () => {
  const a = { priorDocumentReferences: [{ documentNumber: '1 of 2000' }] };
  const b = { priorDocumentReferences: [{ documentNumber: '1 of 2000' }, { documentNumber: '5 of 2001' }] };
  const { merged, disagreements } = mergeRuns([a, b]);
  assert.strictEqual(merged.priorDocumentReferences.length, 2);
  assert.deepStrictEqual(disagreements.map((d) => d.kind), ['item-in-one-run']);
});

test('a single run passes through untouched', () => {
  const run = { documentNumber: '1 of 2000' };
  assert.deepStrictEqual(mergeRuns([run]), { merged: run, disagreements: [] });
});

test('inputs are not mutated', () => {
  const a = { parties: [party({ aadhaarNumber: null })] };
  const b = { parties: [party({ aadhaarNumber: '8995 2253 1729' })] };
  const snapshot = JSON.stringify([a, b]);
  mergeRuns([a, b]);
  assert.strictEqual(JSON.stringify([a, b]), snapshot);
});

test('a more detailed form of the same value is not a conflict', () => {
  const a = { parties: [party({ representedByPoa: { poaDocumentNumber: '33' } })] };
  const b = { parties: [party({ representedByPoa: { poaDocumentNumber: '33 of 2023' } })] };
  assert.deepStrictEqual(mergeRuns([a, b]).disagreements, []);
});

test('survey numbers that differ by a sub-division are still a conflict', () => {
  const a = { propertySchedules: [{ oldSurveyNumber: '130/2' }] };
  const b = { propertySchedules: [{ oldSurveyNumber: '130/2/1' }] };
  assert.strictEqual(mergeRuns([a, b]).disagreements.length, 1);
});

test('quote style and "Old Survey No." prefixes do not cause false flags', () => {
  const a = { propertySchedules: [{ scheduleLabel: 'SCHEDULE “A”', oldSurveyNumber: 'Old Survey No.130/2' }] };
  const b = { propertySchedules: [{ scheduleLabel: 'SCHEDULE "A"', oldSurveyNumber: '130/2' }] };
  assert.deepStrictEqual(mergeRuns([a, b]).disagreements, []);
});

test('a runaway value in a critical field loses to the sane run', () => {
  const runaway = 'ZAMIN PALLAVARAM VILLAGE ' + 'bounded on the north by channel '.repeat(20);
  const a = { propertySchedules: [{ village: runaway }] };
  const b = { propertySchedules: [{ village: 'ZAMIN PALLAVARAM VILLAGE' }] };
  const { merged, disagreements } = mergeRuns([a, b]);
  assert.strictEqual(merged.propertySchedules[0].village, 'ZAMIN PALLAVARAM VILLAGE');
  assert.strictEqual(disagreements[0].kind, 'conflict');
  assert.ok(disagreements[0].values[0].length < 200, 'flagged value is truncated for display');
});

test('amounts differing only in digit grouping agree', () => {
  const a = { stamp: { stampDutyPaid: '7246900' } };
  const b = { stamp: { stampDutyPaid: '72,46,900' } };
  assert.deepStrictEqual(mergeRuns([a, b]).disagreements, []);
});
