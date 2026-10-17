#!/usr/bin/env node
// Gold-set workflow.
//   node scripts/gold.js init  [extractionsDir]   create gold/<doc>.json templates
//   node scripts/gold.js score [extractionsDir]   score every VERIFIED gold file
//
// `init` pre-fills each template from the pipeline's own extraction so you only
// have to correct it. That saves typing but invites rubber-stamping: check each
// value against the SCAN, not against what's already written. Nothing is scored
// until you flip "_verified" to true.
//
// gold/ is git-ignored — it holds PAN/Aadhaar numbers from real deeds.

const fs = require('fs');
const path = require('path');
const { projectCritical, scoreAgainstGold } = require('../src/eval/gold');

const ROOT = path.join(__dirname, '..');
const GOLD_DIR = path.join(ROOT, 'gold');
const [command, dirArg] = process.argv.slice(2);
const extractionsDir = path.resolve(dirArg || path.join(ROOT, 'output', 'extractions'));

const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const pct = (n) => `${(n * 100).toFixed(1)}%`;

function init() {
  fs.mkdirSync(GOLD_DIR, { recursive: true });
  for (const file of fs.readdirSync(extractionsDir).filter((f) => f.endsWith('.json'))) {
    const target = path.join(GOLD_DIR, file);
    if (fs.existsSync(target)) { console.log(`keep   ${file} (already exists)`); continue; }
    const record = readJson(path.join(extractionsDir, file));
    if (!record.extraction) { console.log(`skip   ${file} (no extraction)`); continue; }
    const template = {
      _verified: false,
      _instructions: 'Correct every value against the scan. Delete wrong ones, add missing ones, then set _verified to true.',
      _source: record.sourceFile,
      ...projectCritical(record.extraction),
    };
    fs.writeFileSync(target, JSON.stringify(template, null, 2));
    console.log(`wrote  gold/${file}`);
  }
}

function score() {
  if (!fs.existsSync(GOLD_DIR)) { console.log('No gold/ directory — run `init` first.'); return; }
  const results = [];
  for (const file of fs.readdirSync(GOLD_DIR).filter((f) => f.endsWith('.json'))) {
    const gold = readJson(path.join(GOLD_DIR, file));
    if (!gold._verified) { console.log(`skip ${file} (not verified)`); continue; }
    const recPath = path.join(extractionsDir, file);
    if (!fs.existsSync(recPath)) { console.log(`skip ${file} (no extraction in ${extractionsDir})`); continue; }
    const record = readJson(recPath);
    if (!record.extraction) continue;
    results.push({ doc: file.replace(/\.json$/, ''), ...scoreAgainstGold(record.extraction, gold) });
  }
  if (!results.length) { console.log('\nNothing verified yet — set "_verified": true in a gold file once checked.'); return; }

  const totals = {};
  results.forEach((r) => {
    console.log(`\n${r.doc}: recall ${pct(r.overall.recall)} · precision ${pct(r.overall.precision)}`);
    r.misses.forEach((m) => console.log(`   ${m.kind === 'missing' ? '− missing' : '+ wrong  '} ${m.field}: ${m.value}`));
    Object.entries(r.byField).forEach(([f, c]) => {
      totals[f] = totals[f] || { expected: 0, found: 0, produced: 0, correct: 0 };
      Object.keys(c).forEach((k) => { totals[f][k] += c[k]; });
    });
  });

  console.log('\nBy field (all verified documents)');
  console.log('field'.padEnd(22), 'recall'.padStart(8), 'precision'.padStart(10), '  n');
  Object.entries(totals).sort((a, b) => a[1].found / a[1].expected - b[1].found / b[1].expected).forEach(([f, c]) => {
    const recall = c.expected ? c.found / c.expected : 1;
    const precision = c.produced ? c.correct / c.produced : 1;
    console.log(f.padEnd(22), pct(recall).padStart(8), pct(precision).padStart(10), ` ${c.expected}`);
  });

  fs.writeFileSync(path.join(ROOT, 'output', 'gold-report.json'), JSON.stringify({ results, totals }, null, 2));
}

if (command === 'init') init();
else if (command === 'score') score();
else { console.error('Usage: node scripts/gold.js <init|score> [extractionsDir]'); process.exit(1); }
