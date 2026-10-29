const test = require('node:test');
const assert = require('node:assert');
const { generateReviewHtml, attentionItems, fieldLabel } = require('../src/pipeline/review-html');

function matter(overrides = {}) {
  return {
    matterId: 'MATTER-1',
    generatedAt: '2026-10-18T10:00:00Z',
    documents: [{
      label: 'Gift <Deed>', sourceFile: '/x/uploads/gift deed.pdf', registryType: 'GIFT_DEED', confidence: 'HIGH',
      documentNumber: '246', documentYear: '2024', executionDate: '11 Jan 2024',
      parties: [{ role: 'DONOR', fullName: 'KISHAN D VASANT' }],
      propertySchedules: [{ oldSurveyNumber: '130/2', newSurveyNumber: '2', extentValue: '48', extentUnit: 'Cents' }],
      warnings: [], errors: [],
      citations: [{ field: 'propertySchedules[0].extentValue', page: '3', quote: 'Acre 0.48 Cents' }],
      consensus: { disagreements: [] },
    }],
    identities: { clusters: [{ canonicalName: 'KISHAN D VASANT', pan: null, aadhaar: null, mentions: [{ role: 'DONOR' }] }] },
    titleChain: { earliestYear: 1994, latestYear: 2024, meetsThirtyFiveYearRule: true, unverifiedLinks: [], chain: [
      { year: 2024, documentType: 'GIFT_DEED', key: '246/2024', executedBy: 'A, B, C, D', inFavourOf: 'E', uploaded: true },
    ] },
    surveyExtent: { parcels: [{ oldSurveyNumber: '130/2', newSurveyNumber: '2', village: 'Pallavaram', distinctExtentsCents: [48], extentConsistent: true, mentions: [] }] },
    encumbrances: [],
    summary: { documentCount: 1, flaggedDocumentCount: 0, surveyConflictCount: 0, possibleDuplicateIdentityCount: 0 },
    ...overrides,
  };
}

test('field paths read as plain labels', () => {
  assert.strictEqual(fieldLabel('parties[2].aadhaarNumber'), 'Party 3 · Aadhaar');
  assert.strictEqual(fieldLabel('propertySchedules[0].oldSurveyNumber'), 'Schedule 1 · old survey no.');
  assert.strictEqual(fieldLabel('stamp.stampDutyPaid'), 'Stamp duty');
  assert.strictEqual(fieldLabel('propertySchedules[1]'), 'Schedule 2 · whole entry');
});

test('the consensus warning is not repeated, and paths in warnings are readable', () => {
  const m = matter();
  m.documents[0].warnings = ['2 field(s) differed between independent extraction runs — verify', 'propertySchedules[1] has no survey number'];
  const items = attentionItems(m, 0);
  assert.strictEqual(items.length, 1);
  assert.strictEqual(items[0].detail, 'Schedule 2 has no survey number');
});

test('a clean matter has nothing needing attention', () => {
  assert.deepStrictEqual(attentionItems(matter(), 0), []);
});

test('problems are listed before items to verify', () => {
  const m = matter({
    titleChain: { ...matter().titleChain, meetsThirtyFiveYearRule: false, unverifiedLinks: [{ key: '1905/1994', year: '1994', documentType: 'Sale Deed' }] },
  });
  m.documents[0].consensus = { disagreements: [{ path: 'propertySchedules[0].extentValue', kind: 'omitted', values: ['48', null] }] };
  const items = attentionItems(m, 0);
  assert.deepStrictEqual(items.map((i) => i.sev), ['danger', 'warn', 'warn']);
  assert.match(items[0].title, /35-year/);
  assert.match(items[1].detail, /Schedule 1 · extent/);
  assert.strictEqual(items[1].open, 'm0-doc-0');
});

test('the page escapes extracted text and links cited pages to the scan panel', () => {
  const html = generateReviewHtml({ matters: [matter()], unclassified: [] });
  assert.ok(html.startsWith('<!doctype html>'));
  assert.ok(html.includes('Gift &lt;Deed&gt;'));
  assert.ok(!html.includes('Gift <Deed>'));
  assert.ok(html.includes('href="/files/gift%20deed.pdf#page=3" data-scan='));
  assert.ok(html.includes('+ 2 more'), 'long name lists collapse');
  assert.ok(html.includes('--accent:'), 'shared styles are inlined');
});
