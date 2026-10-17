#!/usr/bin/env node
// Scores extraction configurations against the verified gold set.
//   node scripts/benchmark.js [--models pro,flash] [--runs 2]
// For each verified gold document and each model: extract `runs` times in
// parallel, then score run 1 alone ("single") and the consensus merge of all
// runs ("consensus"). Reports recall/precision and wall-clock per document.
// Raw runs are saved so a scoring change can be re-applied without new API calls.

const fs = require('fs');
const path = require('path');
try { process.loadEnvFile(path.join(__dirname, '..', '.env')); } catch { /* env from shell */ }

const { createClient, uploadDocument, extractFields } = require('../src/gemini/client');
const { mergeRuns } = require('../src/pipeline/consensus');
const { scoreAgainstGold } = require('../src/eval/gold');

const ROOT = path.join(__dirname, '..');
const GOLD_DIR = path.join(ROOT, 'gold');
const EXTRACTIONS = path.join(ROOT, 'output', 'extractions');
const MODELS = { pro: 'gemini-pro-latest', flash: 'gemini-flash-latest' };

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
};
const models = arg('models', 'pro,flash').split(',');
const RUNS = Number(arg('runs', 2));

const pct = (n) => `${(n * 100).toFixed(1)}%`;
const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));

// Pools fact counts across documents so the summary is a true micro-average.
function pool(scores) {
  const t = { expected: 0, found: 0, produced: 0, correct: 0 };
  scores.forEach((s) => Object.values(s.byField).forEach((f) => Object.keys(t).forEach((k) => { t[k] += f[k]; })));
  return { recall: t.found / t.expected, precision: t.correct / t.produced };
}

async function main() {
  const ai = createClient();
  const docs = fs.readdirSync(GOLD_DIR).filter((f) => f.endsWith('.json'))
    .map((f) => ({ file: f, gold: readJson(path.join(GOLD_DIR, f)) }))
    .filter((d) => d.gold._verified);
  const results = [];

  for (const { file, gold } of docs) {
    const typeId = readJson(path.join(EXTRACTIONS, file)).classification.documentType;
    console.log(`\n== ${file} (${typeId})`);
    const uploaded = await uploadDocument(ai, gold._source);
    for (const key of models) {
      const started = Date.now();
      const settled = await Promise.allSettled(
        Array.from({ length: RUNS }, () => extractFields(ai, uploaded, typeId, { model: MODELS[key] })),
      );
      const seconds = (Date.now() - started) / 1000;
      const runs = settled.filter((r) => r.status === 'fulfilled').map((r) => r.value);
      settled.filter((r) => r.status === 'rejected').forEach((r) => console.log(`   ${key}: run failed — ${r.reason.message.slice(0, 120)}`));
      if (!runs.length) { results.push({ doc: file, model: key, seconds, failed: true }); continue; }
      const single = scoreAgainstGold(runs[0], gold);
      const consensus = scoreAgainstGold(mergeRuns(runs).merged, gold);
      const flagged = mergeRuns(runs).disagreements.length;
      results.push({ doc: file, model: key, seconds, runsOk: runs.length, single, consensus, flagged, runs });
      console.log(`   ${key.padEnd(5)} ${seconds.toFixed(0).padStart(4)}s  single R ${pct(single.overall.recall)} P ${pct(single.overall.precision)}  | consensus R ${pct(consensus.overall.recall)} P ${pct(consensus.overall.precision)}  | ${flagged} flagged`);
    }
  }

  console.log('\n== Summary (micro-averaged over all verified facts)');
  for (const key of models) {
    const ok = results.filter((r) => r.model === key && !r.failed);
    if (!ok.length) continue;
    const s = pool(ok.map((r) => r.single));
    const c = pool(ok.map((r) => r.consensus));
    const avgSec = ok.reduce((n, r) => n + r.seconds, 0) / ok.length;
    console.log(`${key.padEnd(5)} single R ${pct(s.recall)} P ${pct(s.precision)} | consensus R ${pct(c.recall)} P ${pct(c.precision)} | avg ${avgSec.toFixed(0)}s/doc for ${RUNS} parallel runs`);
  }

  const out = path.join(ROOT, 'output', `benchmark-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  fs.writeFileSync(out, JSON.stringify(results, null, 2));
  console.log(`\nWrote ${out}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
