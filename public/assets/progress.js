// Progress estimation for the intake page. Gemini gives no progress signal
// inside a call, so the bar is built from what we do know: which step each
// document is on, when that step started, and how long it usually takes.
// Within a step the bar eases toward (never past) 95% of that step's share,
// so it keeps moving without ever claiming to be done early.
//
// Loaded by the browser as a plain script (window.IntakeProgress) and by the
// tests via require().

(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.IntakeProgress = api;
}(typeof self !== 'undefined' ? self : this, () => {
  // Share of one document's bar per step; reading the deed dominates.
  const STEPS = [
    { id: 'uploading', weight: 0.05, label: 'Uploading securely' },
    { id: 'classifying', weight: 0.10, label: 'Identifying the document' },
    { id: 'extracting', weight: 0.70, label: 'Reading the deed' },
    { id: 'checking', weight: 0.10, label: 'Double-checking the details' },
    { id: 'done', weight: 0.05, label: 'Done' },
  ];
  const DOCS_SHARE = 0.9; // the rest is building the title chain and the report
  const MAX_WITHIN_STEP = 0.95;

  const stepIndex = (id) => STEPS.findIndex((s) => s.id === id);

  // 0 at the start, ~0.8 at the expected time, approaching (capped at) 0.95.
  function easeWithinStep(elapsedSec, expectedSec) {
    if (!(expectedSec > 0) || !(elapsedSec > 0)) return 0;
    return Math.min(MAX_WITHIN_STEP, 1 - Math.exp(-1.6 * (elapsedSec / expectedSec)));
  }

  const elapsedSince = (iso, nowMs) => (iso ? Math.max(0, (nowMs - Date.parse(iso)) / 1000) : 0);

  // Fraction (0..1) of one document's work done, plus seconds expected left.
  function fileProgress(file, nowMs) {
    if (file.stage === 'done' || file.stage === 'error') return { fraction: 1, remainingSec: 0 };
    const expected = file.expected || {};
    if (file.stage === 'queued') {
      return { fraction: 0, remainingSec: STEPS.reduce((n, s) => n + (expected[s.id] || 0), 0) };
    }
    const idx = Math.max(0, stepIndex(file.stage));
    const before = STEPS.slice(0, idx).reduce((n, s) => n + s.weight, 0);
    const elapsed = elapsedSince(file.stageStartedAt, nowMs);
    const current = expected[file.stage] || 0;
    const within = easeWithinStep(elapsed, current);
    const later = STEPS.slice(idx + 1).reduce((n, s) => n + (expected[s.id] || 0), 0);
    // Past the estimate, assume a little more rather than "0 s left".
    const currentLeft = Math.max(current - elapsed, Math.min(30, current * 0.25));
    return { fraction: before + STEPS[idx].weight * within, remainingSec: currentLeft + later };
  }

  // Whole-run view: percent, a remaining-time range, and which file is active.
  function overallProgress(state, nowMs) {
    const files = state.files || [];
    if (state.status === 'done') return { percent: 100, remaining: [0, 0], active: null };
    const perFile = files.map((f) => fileProgress(f, nowMs));
    const docs = files.length ? perFile.reduce((n, p) => n + p.fraction, 0) / files.length : 0;

    let finishing = 0;
    let finishingLeft = state.expectedFinishing || 10;
    if (state.phase === 'finishing') {
      const elapsed = elapsedSince(state.finishingStartedAt, nowMs);
      finishing = easeWithinStep(elapsed, state.expectedFinishing || 10);
      finishingLeft = Math.max((state.expectedFinishing || 10) - elapsed, 3);
    }
    const docsDone = state.phase === 'finishing' ? 1 : docs;
    const percent = Math.min(99, Math.round(100 * (DOCS_SHARE * docsDone + (1 - DOCS_SHARE) * finishing)));

    // Documents are processed one after another, so time left adds up.
    const docsLeft = state.phase === 'finishing' ? 0 : perFile.reduce((n, p) => n + p.remainingSec, 0);
    const left = docsLeft + finishingLeft;
    const active = files.find((f) => !['queued', 'done', 'error'].includes(f.stage)) || null;
    return { percent, remaining: [left * 0.7, left * 1.4], active };
  }

  function formatRemaining([lo, hi]) {
    if (hi <= 0) return '';
    if (hi < 60) return 'Less than a minute left';
    const a = Math.max(1, Math.round(lo / 60));
    const b = Math.max(a + 1, Math.round(hi / 60));
    return a === 1 && b <= 2 ? 'About 1–2 minutes left' : `About ${a}–${b} minutes left`;
  }

  // Reassurance when a step runs long — plain language, never technical.
  function patienceNote(file, nowMs) {
    if (!file || !file.stageStartedAt) return '';
    const elapsed = elapsedSince(file.stageStartedAt, nowMs);
    const expected = (file.expected || {})[file.stage] || 0;
    if (expected && elapsed > expected * 1.5 && elapsed > 45) return 'Taking a little longer than usual — still working on it.';
    if (file.stage === 'extracting' && elapsed > 60) return 'Large or handwritten scans take longer to read. Still working.';
    return '';
  }

  return { STEPS, easeWithinStep, fileProgress, overallProgress, formatRemaining, patienceNote };
}));
