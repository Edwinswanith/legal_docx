#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

try {
  process.loadEnvFile(path.join(__dirname, '.env'));
} catch {
  // No .env file — fall back to whatever is already in process.env.
}

const { runOnFile, OUTPUT_DIR } = require('./src/pipeline/ingest');
const { processBatch } = require('./src/pipeline/run-batch');
const SAMPLE_FILES = require('./src/registry/sample-files');

const OUTPUT_ROOT = path.join(__dirname, 'output');

function usage() {
  console.log(`Usage:
  node run.js --samples          Run the 7 reference documents, then reconcile + generate reports
  node run.js --matter <dir>     Run every PDF in <dir> as one intake batch, then reconcile + generate reports
  node run.js --reconcile        Skip ingest — reconcile + generate reports from output/extractions/ already on disk
  node run.js <path-to-pdf>      Ingest a single document only (no reconciliation)
  node run.js --serve            Start the local upload UI (see server.js)
  node run.js --list             List the configured sample documents and exit

Per-document ingest output: ${path.relative(process.cwd(), OUTPUT_DIR)}/
Per-matter output: ${path.relative(process.cwd(), OUTPUT_ROOT)}/MATTER-*.json, Legal-Scrutiny-Report-MATTER-*.docx
Reviewer workbench: ${path.relative(process.cwd(), OUTPUT_ROOT)}/matter-review.html`);
}

function pdfsIn(dir) {
  return fs
    .readdirSync(dir)
    .filter((f) => f.toLowerCase().endsWith('.pdf'))
    .map((f) => ({ label: path.basename(f, '.pdf'), file: path.join(dir, f) }));
}

async function runBatchAndReport(entries) {
  const { matters, unclassified, reviewPath } = await processBatch(entries, { outputDir: OUTPUT_ROOT });
  matters.forEach((matter) => {
    console.log(`\n${matter.matterId}: ${matter.documents.length} document(s), chain ${matter.titleChain.earliestYear ?? '?'}-${matter.titleChain.latestYear ?? '?'}, ${matter.summary.surveyConflictCount} survey conflict(s)`);
    console.log(`  -> ${path.relative(process.cwd(), path.join(OUTPUT_ROOT, `${matter.matterId}.json`))}`);
    console.log(`  -> ${path.relative(process.cwd(), path.join(OUTPUT_ROOT, `Legal-Scrutiny-Report-${matter.matterId}.docx`))}`);
  });
  console.log(`\nReviewer workbench: ${path.relative(process.cwd(), reviewPath)}`);
  if (unclassified.length) {
    console.log(`\n${unclassified.length} document(s) did not match any registered type — see the reviewer page.`);
  }
}

// --reconcile skips ingest and rebuilds matters/reports/review from
// whatever's already in output/extractions/ (no API calls).
async function reconcileOnly() {
  const { buildMattersFromRecords, loadExtractionRecords } = require('./src/pipeline/matter');
  const { buildReportData } = require('./src/pipeline/report-data');
  const { generateReportFile } = require('./src/pipeline/generate-report');
  const { generateReviewHtml } = require('./src/pipeline/review-html');

  const records = loadExtractionRecords(OUTPUT_DIR);
  const { matters, unclassified } = buildMattersFromRecords(records);
  for (const matter of matters) {
    fs.writeFileSync(path.join(OUTPUT_ROOT, `${matter.matterId}.json`), JSON.stringify(matter, null, 2));
    const reportData = buildReportData(matter);
    await generateReportFile(reportData, path.join(OUTPUT_ROOT, `Legal-Scrutiny-Report-${matter.matterId}.docx`));
    console.log(`\n${matter.matterId}: ${matter.documents.length} document(s), chain ${matter.titleChain.earliestYear ?? '?'}-${matter.titleChain.latestYear ?? '?'}, ${matter.summary.surveyConflictCount} survey conflict(s)`);
    console.log(`  -> output/${matter.matterId}.json`);
    console.log(`  -> output/Legal-Scrutiny-Report-${matter.matterId}.docx`);
  }
  const reviewPath = path.join(OUTPUT_ROOT, 'matter-review.html');
  fs.writeFileSync(reviewPath, generateReviewHtml({ matters, unclassified }));
  console.log(`\nReviewer workbench: output/matter-review.html`);
}

async function main() {
  const [arg, second] = process.argv.slice(2);

  if (!arg || arg === '--help' || arg === '-h') {
    usage();
    return;
  }

  if (arg === '--list') {
    SAMPLE_FILES.forEach((s) => console.log(`- ${s.label}\n    ${s.file}`));
    return;
  }

  if (arg === '--serve') {
    require('./server');
    return;
  }

  if (arg === '--samples' || arg === '--matter') {
    if (arg === '--matter' && !second) {
      console.error('Usage: node run.js --matter <directory-of-pdfs>');
      process.exit(1);
    }
    const entries = arg === '--samples' ? SAMPLE_FILES : pdfsIn(second);
    await runBatchAndReport(entries);
    return;
  }

  if (arg === '--reconcile') {
    await reconcileOnly();
    return;
  }

  const record = await runOnFile(arg);
  console.log(JSON.stringify(record, null, 2));
}

main().catch((err) => {
  console.error(`\n${err.message}`);
  process.exit(1);
});
