// Expected step durations for the progress display, and a running correction
// learned from real runs. Each step's estimate is a baseline (from measured
// runs on the sample deeds) times a learned factor; after every step the factor
// moves 30% of the way toward actual/predicted. Factors persist to a small JSON
// file — on an ephemeral disk they simply reset to 1, which is harmless.

const fs = require('fs');
const path = require('path');

const DEFAULT_PAGES = 12;
const LEARNING_RATE = 0.3;
const FACTOR_BOUNDS = [0.3, 4];

// Seconds. Reading scales with page count; observed 40 s–5 min per deed with
// two parallel extraction runs on gemini-pro.
const BASELINE = {
  uploading: (pages) => 4 + 0.25 * pages,
  classifying: () => 12,
  extracting: (pages) => 45 + 4 * pages,
  checking: () => 2,
};
const finishingBaseline = (fileCount) => 4 + 2 * fileCount;

// Counts page objects in a PDF without a PDF library. Misses pages hidden in
// compressed object streams; then falls back to the page-tree /Count, then null.
function countPdfPages(buffer) {
  try {
    const text = buffer.toString('latin1');
    const pages = (text.match(/\/Type\s*\/Page(?![a-zA-Z])/g) || []).length;
    if (pages > 0) return pages;
    const counts = [...text.matchAll(/\/Count\s+(\d+)/g)].map((m) => Number(m[1]));
    return counts.length ? Math.max(...counts) : null;
  } catch {
    return null;
  }
}

function createTimings(filePath) {
  let factors = {};
  try {
    if (filePath && fs.existsSync(filePath)) factors = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    factors = {}; // a corrupt file only costs us the learned correction
  }

  const factor = (step) => factors[step] ?? 1;

  function expectedFor(pages) {
    const n = pages || DEFAULT_PAGES;
    return Object.fromEntries(Object.entries(BASELINE).map(([step, fn]) => [step, Math.round(fn(n) * factor(step))]));
  }

  const expectedFinishing = (fileCount) => Math.round(finishingBaseline(fileCount) * factor('finishing'));

  function record(step, actualSec, predictedSec) {
    if (!(actualSec > 0) || !(predictedSec > 0)) return;
    const ratio = actualSec / (predictedSec / factor(step)); // vs. the uncorrected baseline
    const next = factor(step) + LEARNING_RATE * (ratio - factor(step));
    factors = { ...factors, [step]: Math.min(FACTOR_BOUNDS[1], Math.max(FACTOR_BOUNDS[0], next)) };
    if (!filePath) return;
    try {
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, JSON.stringify(factors, null, 2));
    } catch (err) {
      console.warn('[timings] could not save learned timings:', err.message);
    }
  }

  return { expectedFor, expectedFinishing, record, factors: () => ({ ...factors }) };
}

module.exports = { createTimings, countPdfPages, DEFAULT_PAGES };
