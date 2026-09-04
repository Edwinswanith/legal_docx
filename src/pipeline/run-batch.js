// Shared by the CLI (run.js) and the upload server (server.js): stages
// 02-05 end to end for a set of files into one output directory —
// ingest, reconcile into matter(s), map to template, generate reports and
// the reviewer page. One place for this so the two front ends can't drift.

const fs = require('fs');
const path = require('path');
const { runOnFiles, OUTPUT_DIR: DEFAULT_EXTRACTIONS_DIR } = require('./ingest');
const { buildMattersFromRecords, loadExtractionRecords } = require('./matter');
const { buildReportData } = require('./report-data');
const { generateReportFile } = require('./generate-report');
const { generateReviewHtml } = require('./review-html');

async function processBatch(entries, { outputDir, onProgress } = {}) {
  const extractionsDir = path.join(outputDir, 'extractions');
  fs.mkdirSync(extractionsDir, { recursive: true });

  const results = await runOnFiles(entries, { outputDir: extractionsDir, onProgress });

  const records = loadExtractionRecords(extractionsDir);
  const { matters, unclassified } = buildMattersFromRecords(records);

  for (const matter of matters) {
    fs.writeFileSync(path.join(outputDir, `${matter.matterId}.json`), JSON.stringify(matter, null, 2));
    const reportData = buildReportData(matter);
    await generateReportFile(reportData, path.join(outputDir, `Legal-Scrutiny-Report-${matter.matterId}.docx`));
  }

  const reviewHtml = generateReviewHtml({ matters, unclassified });
  const reviewPath = path.join(outputDir, 'matter-review.html');
  fs.writeFileSync(reviewPath, reviewHtml);

  return { results, matters, unclassified, reviewPath, extractionsDir };
}

module.exports = { processBatch, DEFAULT_EXTRACTIONS_DIR };
