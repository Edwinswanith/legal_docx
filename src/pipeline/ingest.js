const fs = require('fs');
const path = require('path');
const { createClient, uploadDocument, classifyDocument, extractFields } = require('../gemini/client');
const { validateExtraction } = require('./validate');
const { mergeRuns } = require('./consensus');

// Independent extractions per document, merged by consensus.js. 1 disables it.
const CONSENSUS_RUNS = Math.max(1, Number(process.env.CONSENSUS_RUNS) || 2);

// Runs extraction CONSENSUS_RUNS times in parallel. A run that fails is
// dropped (the document still extracts from the survivors, flagged as single-
// run); only all runs failing is an error.
async function extractWithConsensus(client, file, typeId, progress = () => {}) {
  let finished = 0;
  const settled = await Promise.allSettled(Array.from({ length: CONSENSUS_RUNS }, () =>
    extractFields(client, file, typeId).finally(() => {
      finished += 1;
      progress('extract-run-finished', { finished, total: CONSENSUS_RUNS });
    })));
  const runs = settled.filter((r) => r.status === 'fulfilled').map((r) => r.value);
  if (runs.length === 0) throw settled[0].reason;
  const { merged, disagreements } = mergeRuns(runs);
  return {
    extraction: merged,
    consensus: { runsRequested: CONSENSUS_RUNS, runsSucceeded: runs.length, disagreements },
  };
}

const OUTPUT_DIR = path.join(__dirname, '..', '..', 'output', 'extractions');

function outputPathFor(filePath, outputDir) {
  const base = path.basename(filePath, path.extname(filePath)).replace(/[^a-z0-9-_ ]/gi, '').trim().replace(/\s+/g, '-');
  return path.join(outputDir, `${base}.json`);
}

// Runs stages 02 (per-document understanding) of the pipeline for one file:
// upload -> classify -> extract (if classified) -> validate -> persist.
// Returns the same record it writes to disk. `onProgress(stage, extra)` is
// optional — the CLI ignores it (console output already shows progress),
// the upload server uses it to report live per-file status.
async function runOnFile(filePath, { ai, label, outputDir = OUTPUT_DIR, onProgress } = {}) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`);
  }
  const client = ai || createClient();
  const startedAt = new Date().toISOString();
  const progress = onProgress || (() => {});

  progress('uploading');
  const file = await uploadDocument(client, filePath);
  progress('classifying');
  const classification = await classifyDocument(client, file);
  progress('classified', { classification });

  let extraction = null;
  let validation = null;
  let consensus = null;

  if (classification.documentType !== 'UNCLASSIFIED') {
    progress('extracting', { runsTotal: CONSENSUS_RUNS });
    ({ extraction, consensus } = await extractWithConsensus(client, file, classification.documentType, progress));
    progress('checking');
    validation = validateExtraction(extraction);
    progress('extracted', { validation });
  }

  const record = {
    sourceFile: filePath,
    label: label || path.basename(filePath),
    startedAt,
    finishedAt: new Date().toISOString(),
    geminiFile: { name: file.name, uri: file.uri, mimeType: file.mimeType },
    classification,
    extraction,
    consensus,
    validation,
    needsReview:
      classification.documentType === 'UNCLASSIFIED' ||
      classification.confidence !== 'HIGH' ||
      Boolean(validation && (!validation.isClean || validation.warnings.length > 0)) ||
      Boolean(consensus && (consensus.disagreements.length > 0 || consensus.runsSucceeded < consensus.runsRequested)),
  };

  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(outputPathFor(filePath, outputDir), JSON.stringify(record, null, 2));
  progress('done', { record });

  return record;
}

async function runOnFiles(entries, { outputDir = OUTPUT_DIR, onProgress } = {}) {
  const client = createClient();
  const results = [];
  for (const entry of entries) {
    const filePath = typeof entry === 'string' ? entry : entry.file;
    const label = typeof entry === 'string' ? undefined : entry.label;
    process.stdout.write(`\n→ ${label || filePath}\n`);
    try {
      const record = await runOnFile(filePath, {
        ai: client,
        label,
        outputDir,
        onProgress: onProgress && ((stage, extra) => onProgress(label || filePath, stage, extra)),
      });
      results.push(record);
      printSummary(record);
    } catch (err) {
      console.error(`  ✗ failed: ${err.message}`);
      if (onProgress) onProgress(label || filePath, 'error', { message: err.message });
      results.push({ sourceFile: filePath, label, error: err.message });
    }
  }
  return results;
}

function printSummary(record) {
  const { classification, validation, needsReview } = record;
  console.log(`  type: ${classification.documentType} (${classification.confidence})`);
  if (classification.languagesObserved?.length) {
    console.log(`  languages: ${classification.languagesObserved.join(', ')}`);
  }
  if (validation) {
    console.log(`  validation: ${validation.errors.length} error(s), ${validation.warnings.length} warning(s)`);
    validation.errors.forEach((e) => console.log(`    ✗ ${e}`));
    validation.warnings.forEach((w) => console.log(`    ! ${w}`));
  }
  if (record.consensus) {
    const c = record.consensus;
    console.log(`  consensus: ${c.runsSucceeded}/${c.runsRequested} runs, ${c.disagreements.length} flagged field(s)`);
    c.disagreements.slice(0, 10).forEach((d) => console.log(`    ~ ${d.kind} ${d.path}: ${JSON.stringify(d.values)}`));
  }
  console.log(`  needs review: ${needsReview ? 'yes' : 'no'}`);
}

module.exports = { runOnFile, runOnFiles, outputPathFor, OUTPUT_DIR };
