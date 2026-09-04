// Deterministic unit conversion — extent arithmetic never goes through
// Gemini. Everything normalizes to "cents" (the common Tamil Nadu land unit)
// for comparison purposes only; the original value/unit is always kept too.

const CENTS_PER = {
  acre: 100,
  acres: 100,
  cent: 1,
  cents: 1,
  ground: 5.51, // 2400 sq.ft
  grounds: 5.51,
  hectare: 247.105,
  hectares: 247.105,
  'sq.ft': 1 / 435.6,
  'sq ft': 1 / 435.6,
  'square feet': 1 / 435.6,
  'sq.m': 1 / 435.6 * 10.7639,
  'sq.mtr': 1 / 435.6 * 10.7639,
  'sq mtr': 1 / 435.6 * 10.7639,
  'sq.metre': 1 / 435.6 * 10.7639,
  'sq metre': 1 / 435.6 * 10.7639,
  'square metres': 1 / 435.6 * 10.7639,
  'square meters': 1 / 435.6 * 10.7639,
};

function normalizeUnit(unit) {
  return (unit || '')
    .trim()
    .toLowerCase()
    .replace(/\([^)]*\)/g, '')
    .trim()
    .replace(/\.$/, '');
}

// Returns cents, or null if the value/unit can't be parsed — callers must
// handle null rather than treating it as zero.
function toCents(value, unit) {
  const num = Number(String(value ?? '').replace(/[^0-9.]/g, ''));
  const factor = CENTS_PER[normalizeUnit(unit)];
  if (!Number.isFinite(num) || !factor) return null;
  return Math.round(num * factor * 1000) / 1000;
}

module.exports = { toCents, normalizeUnit };
