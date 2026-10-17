// Merges several independent extractions of the same document into one, and
// reports where they disagreed. The stability check showed the dominant
// failure isn't a confident misreading but a silent omission (a PAN, a POA
// number, half a deed list present in one run and absent in another) plus the
// occasional real conflict (acres vs cents). A field the two runs agree on is
// far more trustworthy than either run alone; a field they don't is exactly
// what a human should look at.
//
// Policy, deliberately conservative:
//   - agree (after normalising formatting)      -> keep, no flag
//   - present in one run only                   -> take it, flag "omitted"
//   - both present but different                -> keep run A, flag "conflict"
//   - array item (party, schedule, …) in one run only -> keep it, flag
// Only CRITICAL_FIELDS are flagged; paraphrase variance in free text
// (descriptions, powers granted, relationship notes) is expected and ignored.

// Fields a wrong or missing value would silently corrupt the report with.
const CRITICAL_FIELDS = new Set([
  'fullName', 'panNumber', 'aadhaarNumber', 'documentNumber', 'documentYear', 'executionDate', 'date',
  'oldSurveyNumber', 'newSurveyNumber', 'extentValue', 'extentUnit', 'village',
  'value', 'role', 'poaDocumentNumber', 'stampDutyPaid',
]);

// Never merged or flagged: model commentary about the extraction itself.
const PASSTHROUGH_KEYS = new Set(['citations', 'notes', 'reasoning']);

// Properties that identify "the same item" across runs, in priority order.
const IDENTITY_KEYS = ['panNumber', 'aadhaarNumber', 'fullName', 'documentNumber', 'scheduleLabel', 'serialNumber'];

// Unicode-aware so Tamil text isn't stripped away along with punctuation.
const norm = (v) =>
  String(v)
    .toLowerCase()
    .replace(/\b(old|new)?\s*survey\s*no\b/g, ' ')
    .replace(/\bvillage\b/g, ' ')
    .replace(/\bof\b/g, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();

// For these, "33" vs "33 of 2023" or "POWER AGENT" vs "VENDORS' POWER AGENT" is
// the same fact written with more or less detail, not a disagreement. Survey
// numbers are excluded on purpose: 130/2 vs 130/2/1 is a materially different parcel.
const DETAIL_TOLERANT = new Set(['poaDocumentNumber', 'documentNumber', 'role', 'fullName']);
// Money: Indian "72,46,900" and "7246900" are the same amount.
const NUMERIC = new Set(['stampDutyPaid', 'value']);
const sameDigits = (a, b) => {
  const da = String(a).replace(/\D/g, '');
  return da !== '' && da === String(b).replace(/\D/g, '');
};
const sameOrMoreDetailed = (a, b) => {
  const [short, long] = norm(a).length <= norm(b).length ? [norm(a), norm(b)] : [norm(b), norm(a)];
  const longTokens = new Set(long.split(' '));
  return short.split(' ').every((t) => longTokens.has(t));
};

// The model occasionally runs a field on and dumps the rest of the page into it
// (seen: a whole deed tail inside `village`). No real identifier, date, survey
// number or name is this long, so such a value is treated as a failed read.
const MAX_CRITICAL_LEN = 200;
const isRunaway = (v) => typeof v === 'string' && v.length > MAX_CRITICAL_LEN;
const clip = (v) => (isRunaway(v) ? `${v.slice(0, 80)}… [${v.length} chars]` : v);

const isEmpty = (v) => v == null || (typeof v === 'string' && v.trim() === '') || (Array.isArray(v) && v.length === 0);
const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

function sameItem(a, b) {
  const keysOf = (o) => IDENTITY_KEYS.filter((k) => !isEmpty(o[k]));
  const shared = keysOf(a).filter((k) => !isEmpty(b[k]));
  return shared.some((k) => norm(a[k]) === norm(b[k]));
}

function mergeArrays(a, b, path, out) {
  if (!a.some(isObject) && !b.some(isObject)) {
    return a.length >= b.length ? a : b; // scalar lists are free text; keep the fuller one
  }
  const usedB = new Set();
  const merged = a.map((itemA, i) => {
    let j = b.findIndex((itemB, k) => !usedB.has(k) && isObject(itemA) && isObject(itemB) && sameItem(itemA, itemB));
    // Items with no identifying property at all fall back to position.
    if (j < 0 && isObject(itemA) && IDENTITY_KEYS.every((k) => isEmpty(itemA[k])) && b[i] && !usedB.has(i)) j = i;
    if (j < 0) {
      out.push({ path: `${path}[${i}]`, kind: 'item-in-one-run', values: [summarise(itemA), null], inRun: 'A' });
      return itemA;
    }
    usedB.add(j);
    return mergeValues(itemA, b[j], `${path}[${i}]`, out);
  });
  b.forEach((itemB, k) => {
    if (usedB.has(k)) return;
    out.push({ path: `${path}[${merged.length}]`, kind: 'item-in-one-run', values: [null, summarise(itemB)], inRun: 'B' });
    merged.push(itemB);
  });
  return merged;
}

function summarise(item) {
  if (!isObject(item)) return item;
  const key = IDENTITY_KEYS.find((k) => !isEmpty(item[k]));
  return key ? item[key] : JSON.stringify(item).slice(0, 80);
}

function mergeObjects(a, b, path, out) {
  const result = {};
  for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
    const childPath = path ? `${path}.${key}` : key;
    if (PASSTHROUGH_KEYS.has(key)) {
      result[key] = a[key] ?? b[key];
      continue;
    }
    result[key] = mergeValues(a[key], b[key], childPath, out, key);
  }
  return result;
}

function mergeValues(a, b, path, out, key = path.split('.').pop().replace(/\[\d+\]$/, '')) {
  if (isEmpty(a) && isEmpty(b)) return a ?? b;
  if (Array.isArray(a) || Array.isArray(b)) {
    return mergeArrays(Array.isArray(a) ? a : [], Array.isArray(b) ? b : [], path, out);
  }
  if (isObject(a) || isObject(b)) {
    return mergeObjects(isObject(a) ? a : {}, isObject(b) ? b : {}, path, out);
  }
  // scalars
  const critical = CRITICAL_FIELDS.has(key);
  if (isEmpty(a) || isEmpty(b)) {
    const value = isEmpty(a) ? b : a;
    if (critical) out.push({ path, kind: 'omitted', values: [isEmpty(a) ? null : clip(a), isEmpty(b) ? null : clip(b)], inRun: isEmpty(a) ? 'B' : 'A' });
    return value;
  }
  if (critical && (isRunaway(a) || isRunaway(b)) && !(isRunaway(a) && isRunaway(b))) {
    out.push({ path, kind: 'conflict', values: [clip(a), clip(b)] });
    return isRunaway(a) ? b : a;
  }
  const agree = norm(a) === norm(b) || (NUMERIC.has(key) && sameDigits(a, b)) || (DETAIL_TOLERANT.has(key) && sameOrMoreDetailed(a, b));
  if (!agree && critical) {
    out.push({ path, kind: 'conflict', values: [a, b] });
  }
  return a;
}

// runs: array of extraction objects (failed runs already removed).
// Returns { merged, disagreements }; never mutates its input.
function mergeRuns(runs) {
  if (runs.length === 0) throw new Error('mergeRuns needs at least one extraction run.');
  const disagreements = [];
  let merged = structuredClone(runs[0]);
  for (let i = 1; i < runs.length; i += 1) {
    const out = [];
    merged = mergeValues(merged, structuredClone(runs[i]), '', out);
    disagreements.push(...out);
  }
  return { merged, disagreements };
}

module.exports = { mergeRuns, CRITICAL_FIELDS };
