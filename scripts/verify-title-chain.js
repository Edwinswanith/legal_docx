#!/usr/bin/env node
// Phase 3 acceptance test from the build plan: "Rebuild the MODT's 18-document
// chain programmatically ... as the acceptance test for title-chain building."
// This compares the chain buildTitleChain() produces against the MODT
// document's own scheduleOfDepositedTitleDeeds, row by row.

const path = require('path');
try {
  process.loadEnvFile(path.join(__dirname, '..', '.env'));
} catch {
  // fine without one — this script makes no API calls
}

const { buildMattersFromRecords, loadExtractionRecords } = require('../src/pipeline/matter');

const EXTRACTIONS_DIR = path.join(__dirname, '..', 'output', 'extractions');

function keyOf(documentNumber, documentYear) {
  let num = String(documentNumber || '').trim();
  let year = documentYear ? String(documentYear).trim() : null;
  const ofMatch = num.match(/^(.+?)\s+of\s+(\d{4})$/i);
  if (ofMatch) {
    num = ofMatch[1].trim();
    year = year || ofMatch[2];
  } else {
    const slashMatch = num.match(/^(.+?)\/(\d{4})$/);
    if (slashMatch) {
      num = slashMatch[1].trim();
      year = year || slashMatch[2];
    }
  }
  return `${num.replace(/^0+(?=\d)/, '')}/${year || '?'}`;
}

function main() {
  const records = loadExtractionRecords(EXTRACTIONS_DIR);
  const modtRecord = records.find((r) => r.classification?.documentType === 'MEMORANDUM_OF_DEPOSIT_OF_TITLE_DEEDS');
  if (!modtRecord) {
    console.error('No MEMORANDUM_OF_DEPOSIT_OF_TITLE_DEEDS record found in output/extractions — run `npm run ingest:samples` first.');
    process.exit(1);
  }

  // Rows with no document number (e.g. a Patta — a revenue record, not a
  // registered instrument) were never going to have a chain key; they're
  // out of scope for this check the same way title-chain.js skips them.
  const groundTruth = (modtRecord.extraction.scheduleOfDepositedTitleDeeds || [])
    .filter((row) => row.documentNumber)
    .map((row) => keyOf(row.documentNumber, row.documentYear));

  const { matters } = buildMattersFromRecords(records);
  const matter = matters.find((m) => m.documents.some((d) => d.registryType === 'MEMORANDUM_OF_DEPOSIT_OF_TITLE_DEEDS'));
  const builtKeys = new Set(matter.titleChain.chain.map((e) => e.key));

  const missing = groundTruth.filter((k) => !builtKeys.has(k));
  const found = groundTruth.filter((k) => builtKeys.has(k));

  console.log(`MODT schedule (ground truth): ${groundTruth.length} rows`);
  console.log(`Reconciled title chain:       ${matter.titleChain.chain.length} entries`);
  console.log(`Ground-truth rows found in the built chain: ${found.length}/${groundTruth.length}`);
  if (missing.length) {
    console.log('Missing:');
    missing.forEach((k) => console.log(`  - ${k}`));
  }

  const pass = missing.length === 0;
  console.log(`\n${pass ? 'PASS' : 'FAIL'} — every row the MODT itself lists as a deposited title deed is present in the reconciled chain: ${pass}`);
  process.exit(pass ? 0 : 1);
}

main();
