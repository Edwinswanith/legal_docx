#!/usr/bin/env node
// The upload UI: a small local/deployed server around the same pipeline
// the CLI uses (src/pipeline/run-batch.js). Single-slot by design — this is
// a testing tool, not a multi-tenant service: each new upload wipes and
// replaces whatever was there before (uploaded source files AND generated
// output), rather than accumulating a history of runs. That also makes it
// a good fit for a free host's ephemeral disk — nothing here is meant to
// survive a redeploy or restart.

const fs = require('fs');
const path = require('path');

try {
  process.loadEnvFile(path.join(__dirname, '.env'));
} catch {
  // fall back to whatever is already in process.env (e.g. a platform's env UI)
}

const express = require('express');
const multer = require('multer');
const { processBatch } = require('./src/pipeline/run-batch');
const { DOC_TYPES } = require('./src/registry/doc-types');

const PORT = process.env.PORT || 4174;
const CURRENT_DIR = path.join(__dirname, 'output', 'current');
const UPLOADS_DIR = path.join(CURRENT_DIR, 'uploads');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 40 * 1024 * 1024, files: 20 } });

// The one and only run's state — overwritten every time, never appended to.
let state = {
  status: 'idle', // idle | running | done | error
  startedAt: null,
  files: [],
  matters: null,
  unclassified: null,
  error: null,
};

function resetState(files) {
  state = {
    status: 'running',
    startedAt: new Date().toISOString(),
    files: files.map((f) => ({ label: f.label, stage: 'queued', error: null })),
    matters: null,
    unclassified: null,
    error: null,
  };
}

function fileStageUpdate(label, stage, extra) {
  const entry = state.files.find((f) => f.label === label);
  if (!entry) return;
  entry.stage = stage;
  if (stage === 'classified' && extra?.classification) {
    entry.documentType = extra.classification.documentType;
    entry.confidence = extra.classification.confidence;
  }
  if (stage === 'extracted' && extra?.validation) {
    entry.warnings = extra.validation.warnings.length;
    entry.errors = extra.validation.errors.length;
  }
  if (stage === 'error') entry.error = extra?.message || 'failed';
}

// Wipe everything from the previous run before starting a new one — the
// overwrite semantics the tool is built around, not just "write on top of".
function clearCurrentDir() {
  fs.rmSync(CURRENT_DIR, { recursive: true, force: true });
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

async function runPipeline(entries) {
  try {
    const { matters, unclassified } = await processBatch(entries, {
      outputDir: CURRENT_DIR,
      onProgress: (label, stage, extra) => fileStageUpdate(label, stage, extra),
    });
    state.matters = matters.map((m) => ({
      matterId: m.matterId,
      documentCount: m.documents.length,
      chainSpan: `${m.titleChain.earliestYear ?? '?'}–${m.titleChain.latestYear ?? '?'}`,
      meetsThirtyFiveYearRule: m.titleChain.meetsThirtyFiveYearRule,
      surveyConflicts: m.summary.surveyConflictCount,
      encumbrances: m.encumbrances.length,
    }));
    state.unclassified = unclassified.map((u) => ({ label: u.label, reasoning: u.classification?.reasoning || null }));
    state.status = 'done';
  } catch (err) {
    state.status = 'error';
    state.error = err.message;
  }
}

const app = express();
app.use(express.json());

app.get('/api/registry', (_req, res) => {
  res.json(DOC_TYPES.map((t) => ({ id: t.id, label: t.label, description: t.description })));
});

app.post('/api/run', upload.array('files', 20), (req, res) => {
  if (!req.files?.length) {
    return res.status(400).json({ error: 'No files uploaded.' });
  }
  if (state.status === 'running') {
    return res.status(409).json({ error: 'A run is already in progress — wait for it to finish before starting another.' });
  }

  const labeled = req.files.map((f) => ({
    label: path.basename(f.originalname, path.extname(f.originalname)),
    buffer: f.buffer,
    originalname: f.originalname,
  }));

  clearCurrentDir();
  resetState(labeled);

  const entries = labeled.map((f) => {
    const filePath = path.join(UPLOADS_DIR, f.originalname);
    fs.writeFileSync(filePath, f.buffer);
    return { label: f.label, file: filePath };
  });

  runPipeline(entries); // fire and forget — client polls /api/status
  res.json({ ok: true });
});

app.get('/api/status', (_req, res) => {
  res.json(state);
});

app.get('/review', (_req, res) => {
  const reviewPath = path.join(CURRENT_DIR, 'matter-review.html');
  if (!fs.existsSync(reviewPath)) return res.status(404).send('No review available yet — run the pipeline first.');
  res.sendFile(reviewPath);
});

app.get('/reports/:matterId.docx', (req, res) => {
  const reportPath = path.join(CURRENT_DIR, `Legal-Scrutiny-Report-${req.params.matterId}.docx`);
  if (!fs.existsSync(reportPath)) return res.status(404).send('Report not found.');
  res.download(reportPath, `Legal-Scrutiny-Report-${req.params.matterId}.docx`);
});

app.get('/', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Upload UI running at http://localhost:${PORT}`);
  });
}

module.exports = app;
