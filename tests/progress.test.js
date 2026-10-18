const test = require('node:test');
const assert = require('node:assert');
const P = require('../public/assets/progress');

const T0 = Date.parse('2026-10-18T10:00:00Z');
const at = (sec) => T0 + sec * 1000;
const iso = (sec) => new Date(at(sec)).toISOString();
const expected = { uploading: 5, classifying: 10, extracting: 100, checking: 2, done: 0 };

test('within a step the bar eases up but never passes 95%', () => {
  assert.strictEqual(P.easeWithinStep(0, 100), 0);
  const atExpected = P.easeWithinStep(100, 100);
  assert.ok(atExpected > 0.75 && atExpected < 0.85);
  assert.strictEqual(P.easeWithinStep(10000, 100), 0.95);
  assert.ok(P.easeWithinStep(50, 100) < P.easeWithinStep(60, 100), 'keeps moving');
});

test('a file mid-extraction sits between the extraction step bounds', () => {
  const file = { stage: 'extracting', stageStartedAt: iso(0), expected };
  const early = P.fileProgress(file, at(5)).fraction;
  const late = P.fileProgress(file, at(500)).fraction;
  assert.ok(early > 0.15 && early < 0.25);
  assert.ok(late < 0.15 + 0.7, 'never reaches the next step on time alone');
  assert.ok(late > early);
});

test('remaining time never drops to zero while a step is running', () => {
  const file = { stage: 'extracting', stageStartedAt: iso(0), expected };
  assert.ok(P.fileProgress(file, at(400)).remainingSec >= 25);
});

test('overall progress averages files, reserves the last 10% for the report', () => {
  const state = {
    status: 'running', phase: 'documents',
    files: [{ stage: 'done', expected }, { stage: 'queued', expected }],
  };
  assert.strictEqual(P.overallProgress(state, at(0)).percent, 45);
  const finishing = { ...state, phase: 'finishing', finishingStartedAt: iso(0), expectedFinishing: 10, files: state.files.map((f) => ({ ...f, stage: 'done' })) };
  const p = P.overallProgress(finishing, at(5)).percent;
  assert.ok(p >= 90 && p < 100);
  assert.strictEqual(P.overallProgress({ ...finishing, status: 'done' }, at(5)).percent, 100);
});

test('remaining time reads as a plain range', () => {
  assert.strictEqual(P.formatRemaining([10, 40]), 'Less than a minute left');
  assert.strictEqual(P.formatRemaining([50, 100]), 'About 1–2 minutes left');
  assert.strictEqual(P.formatRemaining([170, 340]), 'About 3–6 minutes left');
  assert.strictEqual(P.formatRemaining([0, 0]), '');
});

test('patience note appears only when a step runs long', () => {
  const file = { stage: 'extracting', stageStartedAt: iso(0), expected };
  assert.strictEqual(P.patienceNote(file, at(30)), '');
  assert.match(P.patienceNote(file, at(70)), /Large or handwritten/);
  assert.match(P.patienceNote(file, at(200)), /longer than usual/);
});
