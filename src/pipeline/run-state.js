// The single upload slot's live state, as the intake page sees it. Turns the
// pipeline's progress events into: which step each document is on, when that
// step started, how long each step is expected to take, and a plain-language
// summary when the run finishes. Every update replaces the state object; the
// server hands out snapshots, never the live one.

const TIMED_STEPS = ['uploading', 'classifying', 'extracting', 'checking'];

function createRunState({ timings, docTypeLabel = (id) => id, now = () => new Date() }) {
  let state = { status: 'idle', phase: null, startedAt: null, startedBy: null, files: [], matters: null, unclassified: null, error: null };

  const iso = () => now().toISOString();
  const secondsSince = (isoTime) => (now() - Date.parse(isoTime)) / 1000;

  const updateFile = (label, fn) => {
    state = { ...state, files: state.files.map((f) => (f.label === label ? fn(f) : f)) };
  };

  // Close out the step a file is leaving: teach the timings how long it took.
  function closeStep(file) {
    if (TIMED_STEPS.includes(file.stage) && file.stageStartedAt) {
      timings.record(file.stage, secondsSince(file.stageStartedAt), file.expected[file.stage]);
    }
  }

  function enterStep(file, stage, extra = {}) {
    closeStep(file);
    return { ...file, stage, stageStartedAt: iso(), ...extra };
  }

  return {
    get: () => structuredClone({ ...state, now: iso() }),
    isRunning: () => state.status === 'running',

    start(files, startedBy) {
      state = {
        status: 'running',
        phase: 'documents',
        startedAt: iso(),
        startedBy,
        finishingStartedAt: null,
        expectedFinishing: timings.expectedFinishing(files.length),
        files: files.map((f) => ({
          label: f.label,
          pages: f.pages || null,
          stage: 'queued',
          stageStartedAt: null,
          expected: { ...timings.expectedFor(f.pages), done: 0 },
          runsDone: 0,
          runsTotal: 0,
          documentType: null,
          documentTypeLabel: null,
          confidence: null,
          warnings: null,
          error: null,
        })),
        matters: null,
        unclassified: null,
        error: null,
      };
    },

    fileEvent(label, event, extra = {}) {
      updateFile(label, (f) => {
        switch (event) {
          case 'uploading':
          case 'classifying':
          case 'checking':
            return enterStep(f, event);
          case 'extracting':
            return enterStep(f, event, { runsDone: 0, runsTotal: extra.runsTotal || 1 });
          case 'extract-run-finished':
            return { ...f, runsDone: extra.finished, runsTotal: extra.total };
          case 'classified':
            return {
              ...f,
              documentType: extra.classification?.documentType || null,
              documentTypeLabel: extra.classification ? docTypeLabel(extra.classification.documentType) : null,
              confidence: extra.classification?.confidence || null,
            };
          case 'extracted':
            return { ...f, warnings: extra.validation ? extra.validation.warnings.length + extra.validation.errors.length : null };
          case 'done':
            return enterStep(f, 'done');
          case 'error':
            return { ...f, stage: 'error', stageStartedAt: iso(), error: extra.message || 'failed' };
          default:
            return f;
        }
      });
    },

    phase(name) {
      if (name === 'finishing') state = { ...state, phase: 'finishing', finishingStartedAt: iso() };
    },

    finish(matters, unclassified) {
      if (state.finishingStartedAt) {
        timings.record('finishing', secondsSince(state.finishingStartedAt), state.expectedFinishing);
      }
      state = {
        ...state,
        status: 'done',
        phase: 'done',
        finishedAt: iso(),
        matters: matters.map((m) => ({
          matterId: m.matterId,
          documentCount: m.documents.length,
          chainSpan: `${m.titleChain.earliestYear ?? '?'}–${m.titleChain.latestYear ?? '?'}`,
          meetsThirtyFiveYearRule: m.titleChain.meetsThirtyFiveYearRule,
          surveyConflicts: m.summary.surveyConflictCount,
          encumbrances: m.encumbrances.length,
          documentsToCheck: m.summary.flaggedDocumentCount,
        })),
        unclassified: unclassified.map((u) => ({ label: u.label, reasoning: u.classification?.reasoning || null })),
      };
    },

    fail(message) {
      state = { ...state, status: 'error', phase: 'done', error: message };
    },
  };
}

module.exports = { createRunState };
