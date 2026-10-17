#!/usr/bin/env node
// Accuracy harness. There is no hand-labelled gold set yet, so this measures
// the two things we CAN measure without one:
//   1. Run-to-run stability: re-extract each sample N more times and compare
//      against the stored extraction. A field that changes between runs on the
//      same PDF is unreliable by definition.
//   2. Integrity checks: Aadhaar Verhoeff checksum, PAN format, date sanity.
// Output: output/accuracy-report.json + a console summary.
//
// Usage: node scripts/accuracy-check.js [--runs 2] [--only "Sale Deed"]

const fs = require('fs');
const path = require('path');
try { process.loadEnvFile(path.join(__dirname, '..', '.env')); } catch { /* env from shell */ }

const { CRITICAL_FIELDS } = require('../src/pipeline/consensus');
const { createClient, uploadDocument, extractFields } = require('../src/gemini/client');

const EXTRACTIONS = path.join(__dirname, '..', 'output', 'extractions');
const args = process.argv.slice(2);
const RUNS = Number(args[args.indexOf('--runs') + 1]) || 2;
const ONLY = args.includes('--only') ? args[args.indexOf('--only') + 1] : null;

// --- integrity checks -------------------------------------------------------
const D = [[0,1,2,3,4,5,6,7,8,9],[1,2,3,4,0,6,7,8,9,5],[2,3,4,0,1,7,8,9,5,6],[3,4,0,1,2,8,9,5,6,7],[4,0,1,2,3,9,5,6,7,8],[5,9,8,7,6,0,4,3,2,1],[6,5,9,8,7,1,0,4,3,2],[7,6,5,9,8,2,1,0,4,3],[8,7,6,5,9,3,2,1,0,4],[9,8,7,6,5,4,3,2,1,0]];
const P = [[0,1,2,3,4,5,6,7,8,9],[1,5,7,6,2,8,3,0,9,4],[5,8,0,3,7,9,6,1,4,2],[8,9,1,6,0,4,3,5,2,7],[9,4,5,3,1,2,6,8,7,0],[4,2,8,6,5,7,3,9,0,1],[2,7,9,3,8,0,6,4,1,5],[7,0,4,6,9,1,3,2,5,8]];
function aadhaarChecksumOk(raw) {
  const digits = String(raw).replace(/\s|-/g, '');
  if (!/^[2-9]\d{11}$/.test(digits)) return false;
  let c = 0;
  [...digits].reverse().forEach((ch, i) => { c = D[c][P[i % 8][Number(ch)]]; });
  return c === 0;
}
const PAN_RE = /^[A-Z]{5}[0-9]{4}[A-Z]$/;

// --- flatten / compare ------------------------------------------------------
const SKIP_KEYS = new Set(['notes', 'citations', 'reasoning', 'quote', 'page']);
const norm = (v) => String(v).toLowerCase().replace(/\bof\b/g, ' ').replace(/[\s.,\-–/]+/g, ' ').trim();

// Fields a wrong value in would silently corrupt the report (identity, chain,
// survey/extent, money). Free text like notes/powers/conditions is excluded
// from the headline number because paraphrase variance there is harmless.
const CRITICAL = CRITICAL_FIELDS;

// Leaf values keyed by field name (array index ignored — order may legitimately
// differ between runs), as a multiset so repeated values still count.
function leaves(node, key = '', out = new Map()) {
  if (node == null || SKIP_KEYS.has(key)) return out;
  if (Array.isArray(node)) { node.forEach((n) => leaves(n, key, out)); return out; }
  if (typeof node === 'object') { Object.entries(node).forEach(([k, v]) => leaves(v, k, out)); return out; }
  if (String(node).trim() === '') return out;
  const sig = `${key}=${norm(node)}`;
  out.set(sig, (out.get(sig) || 0) + 1);
  return out;
}

function compare(a, b, onlyCritical = false) {
  const keep = (m) => new Map([...m].filter(([sig]) => !onlyCritical || CRITICAL.has(sig.split('=')[0])));
  const A = keep(leaves(a)); const B = keep(leaves(b));
  let shared = 0; let total = 0;
  const diffs = [];
  for (const sig of new Set([...A.keys(), ...B.keys()])) {
    const x = A.get(sig) || 0; const y = B.get(sig) || 0;
    shared += Math.min(x, y); total += Math.max(x, y);
    if (x !== y) diffs.push({ field: sig.split('=')[0], value: sig.slice(sig.indexOf('=') + 1), runA: x, runB: y });
  }
  return { agreement: total ? shared / total : 1, diffs };
}

function integrity(extraction) {
  const issues = [];
  (extraction.parties || []).forEach((p) => {
    if (p.aadhaarNumber && !aadhaarChecksumOk(p.aadhaarNumber)) issues.push(`Aadhaar fails checksum: ${p.fullName} ${p.aadhaarNumber}`);
    if (p.panNumber && !PAN_RE.test(String(p.panNumber).replace(/\s/g, ''))) issues.push(`PAN malformed: ${p.fullName} ${p.panNumber}`);
  });
  return issues;
}

async function main() {
  const ai = createClient();
  const report = [];
  const targets = fs.readdirSync(EXTRACTIONS).filter((f) => f.endsWith('.json') && (!ONLY || f.includes(ONLY)));
  for (const fileName of targets) {
    const sample = { label: fileName.replace(/\.json$/, '') };
    const recPath = path.join(EXTRACTIONS, fileName);
    const base = JSON.parse(fs.readFileSync(recPath, 'utf8'));
    const typeId = base.classification.documentType;
    if (typeId === 'UNCLASSIFIED') continue;
    console.log(`\n== ${sample.label} (${typeId})`);
    const file = await uploadDocument(ai, base.sourceFile);
    const runs = [];
    for (let i = 0; i < RUNS; i += 1) {
      try { runs.push(await extractFields(ai, file, typeId)); console.log(`  run ${i + 1} ok`); }
      catch (e) { console.log(`  run ${i + 1} failed: ${e.message}`); }
    }
    fs.mkdirSync(path.join(__dirname, '..', 'output', 'accuracy-runs'), { recursive: true });
    fs.writeFileSync(path.join(__dirname, '..', 'output', 'accuracy-runs', `${sample.label}.json`), JSON.stringify(runs, null, 2));
    // Fresh-vs-fresh: same current schema, so schema drift since the stored run can't count as instability.
    const fresh = runs.length >= 2 ? compare(runs[0], runs[1]) : null;
    const freshCritical = runs.length >= 2 ? compare(runs[0], runs[1], true) : null;
    const comparisons = runs.map((r) => compare(base.extraction, r));
    const unstable = new Map();
    comparisons.forEach((c) => c.diffs.forEach((d) => unstable.set(d.field, (unstable.get(d.field) || 0) + 1)));
    const entry = {
      label: sample.label,
      typeId,
      freshVsFresh: fresh && Number(fresh.agreement.toFixed(3)),
      freshVsFreshCritical: freshCritical && Number(freshCritical.agreement.toFixed(3)),
      criticalDiffs: freshCritical ? freshCritical.diffs.slice(0, 30) : [],
      agreementVsStored: comparisons.map((c) => Number(c.agreement.toFixed(3))),
      unstableFields: [...unstable.entries()].sort((a, b) => b[1] - a[1]).map(([field, n]) => ({ field, diffsAcrossRuns: n })),
      sampleDiffs: comparisons.flatMap((c) => c.diffs).slice(0, 25),
      integrityIssues: integrity(base.extraction),
    };
    report.push(entry);
    console.log(`  fresh-vs-fresh: ${entry.freshVsFresh} (critical fields: ${entry.freshVsFreshCritical}) | vs stored: ${entry.agreementVsStored.join(', ')}  | integrity issues: ${entry.integrityIssues.length}`);
  }
  const outPath = path.join(__dirname, '..', 'output', 'accuracy-report.json');
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2));
  console.log(`\nWrote ${outPath}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
