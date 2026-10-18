const test = require('node:test');
const assert = require('node:assert');
const { createRunState } = require('../src/pipeline/run-state');
const { createTimings, countPdfPages } = require('../src/pipeline/timings');

function clock(startIso) {
  let t = Date.parse(startIso);
  return { now: () => new Date(t), advance: (sec) => { t += sec * 1000; } };
}

test('events move a file through plain steps with start times', () => {
  const c = clock('2026-10-18T10:00:00Z');
  const run = createRunState({ timings: createTimings(null), docTypeLabel: () => 'Sale Deed', now: c.now });
  run.start([{ label: 'deed', pages: 10 }], 'priya');
  assert.strictEqual(run.get().files[0].stage, 'queued');
  assert.ok(run.get().files[0].expected.extracting > 0);

  run.fileEvent('deed', 'uploading');
  c.advance(5);
  run.fileEvent('deed', 'classifying');
  run.fileEvent('deed', 'classified', { classification: { documentType: 'SALE_DEED', confidence: 'HIGH' } });
  run.fileEvent('deed', 'extracting', { runsTotal: 2 });
  run.fileEvent('deed', 'extract-run-finished', { finished: 1, total: 2 });
  const f = run.get().files[0];
  assert.strictEqual(f.stage, 'extracting');
  assert.strictEqual(f.documentTypeLabel, 'Sale Deed');
  assert.deepStrictEqual([f.runsDone, f.runsTotal], [1, 2]);
  assert.strictEqual(f.stageStartedAt, '2026-10-18T10:00:05.000Z');
});

test('snapshots are copies, so callers cannot change the live state', () => {
  const run = createRunState({ timings: createTimings(null) });
  run.start([{ label: 'a' }], 'x');
  run.get().files[0].stage = 'done';
  assert.strictEqual(run.get().files[0].stage, 'queued');
});

test('finishing a run summarises matters in plain counts', () => {
  const run = createRunState({ timings: createTimings(null) });
  run.start([{ label: 'a' }], 'x');
  run.phase('finishing');
  run.finish([{
    matterId: 'MATTER-1', documents: [1, 2], encumbrances: [1],
    titleChain: { earliestYear: 1970, latestYear: 2025, meetsThirtyFiveYearRule: true },
    summary: { surveyConflictCount: 0, flaggedDocumentCount: 1 },
  }], []);
  const s = run.get();
  assert.strictEqual(s.status, 'done');
  assert.deepStrictEqual(s.matters[0], {
    matterId: 'MATTER-1', documentCount: 2, chainSpan: '1970–2025', meetsThirtyFiveYearRule: true,
    surveyConflicts: 0, encumbrances: 1, documentsToCheck: 1,
  });
});

test('timings learn: a slow step raises the next estimate', () => {
  const timings = createTimings(null);
  const before = timings.expectedFor(10).extracting;
  timings.record('extracting', before * 2, before);
  const after = timings.expectedFor(10).extracting;
  assert.ok(after > before && after < before * 2, `${before} -> ${after}`);
});

test('page counter reads page objects and returns null when it cannot', () => {
  const pdf = Buffer.from('%PDF-1.4 1 0 obj <</Type /Pages /Count 2>> 2 0 obj <</Type /Page>> 3 0 obj <</Type/Page>>');
  assert.strictEqual(countPdfPages(pdf), 2);
  assert.strictEqual(countPdfPages(Buffer.from('not a pdf')), null);
});
