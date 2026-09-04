const fs = require('fs');
const path = require('path');
const { createClient, uploadDocument, classifyDocument, extractFields } = require('../gemini/client');
const { validateExtraction } = require('./validate');

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

  if (classification.documentType !== 'UNCLASSIFIED') {
    progress('extracting');
    extraction = await extractFields(client, file, classification.documentType);
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
    validation,
    needsReview:
      classification.documentType === 'UNCLASSIFIED' ||
      classification.confidence !== 'HIGH' ||
      Boolean(validation && (!validation.isClean || validation.warnings.length > 0)),
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
  console.log(`  needs review: ${needsReview ? 'yes' : 'no'}`);
}

module.exports = { runOnFile, runOnFiles, outputPathFor, OUTPUT_DIR };
