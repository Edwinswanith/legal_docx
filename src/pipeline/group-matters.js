// Stage 01/03 "matter boundary": a folder of uploaded documents is NOT
// necessarily one property. Grouping is inferred, not assumed — documents
// are linked into the same matter only when they share a survey number, or
// when one explicitly cites the other's exact document number/year (via a
// prior-document reference or an MODT-style schedule row). Anything left
// over becomes its own single-document matter rather than being folded into
// whichever group happened to run first.
//
// This exists because running all 7 reference documents through naive
// "one folder = one matter" grouping silently merged in an unrelated
// Sholinganallur property (Survey No.342, a different village and district)
// that had been bundled in as "ATCH...pdf" — a real finding worth encoding
// as a rule rather than a one-off fix.

const { normalizeUnit } = require('./units');

class UnionFind {
  constructor(ids) {
    this.parent = new Map(ids.map((id) => [id, id]));
  }
  find(x) {
    if (this.parent.get(x) !== x) this.parent.set(x, this.find(this.parent.get(x)));
    return this.parent.get(x);
  }
  union(a, b) {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent.set(ra, rb);
  }
}

// Survey numbers get combined/abbreviated differently deed to deed
// ("130/3" vs "130/6, 130/2" vs "T.S.No.8/2 & 8/3, 130/6") — comparing full
// strings misses real matches. Pull out the individual "NNN/NNN"-shaped
// tokens instead and scope them by village, so a bare "8" or "2" fragment
// from one property can't accidentally collide with an unrelated one.
function numberTokens(str) {
  if (!str) return [];
  return [...String(str).matchAll(/\d+\/\d+/g)].map((m) => m[0].replace(/^0+(?=\d)/, ''));
}

function surveyKeys(doc) {
  const schedules = doc.extraction?.propertySchedules || [];
  const village = schedules.map((s) => s.village).find(Boolean);
  const villageKey = village ? village.trim().toLowerCase().replace(/\s+village$/, '') : null;
  const tokens = new Set();
  schedules.forEach((s) => {
    numberTokens(s.oldSurveyNumber).forEach((t) => tokens.add(t));
    numberTokens(s.newSurveyNumber).forEach((t) => tokens.add(t));
  });
  return [...tokens].map((t) => (villageKey ? `${villageKey}::${t}` : t));
}

// Owner-type roles only (never POA agents/witnesses/banks) — a professional
// power agent can legitimately appear across many unrelated matters, but the
// same person as SETTLOR/VENDOR/PURCHASER/etc. in two documents is strong
// evidence they're the same matter, useful for documents (like a bare Power
// of Attorney with no repeated property schedule) that survey-matching alone
// can't place.
const OWNER_ROLES = ['SETTLOR', 'SETTLEE', 'VENDOR', 'PURCHASER', 'DONOR', 'DONEE', 'PRINCIPAL', 'EXECUTOR'];

function ownerIdentityKeys(doc) {
  return (doc.extraction?.parties || [])
    .filter((p) => OWNER_ROLES.some((r) => (p.role || '').toUpperCase().includes(r)))
    .flatMap((p) => [
      p.panNumber ? `pan:${p.panNumber.toUpperCase().replace(/\s/g, '')}` : null,
      p.aadhaarNumber ? `aadhaar:${p.aadhaarNumber.replace(/\D/g, '')}` : null,
    ])
    .filter(Boolean);
}

function groupIntoMatters(records) {
  const classified = records.filter((r) => r.extraction);
  const ids = classified.map((_, i) => i);
  const uf = new UnionFind(ids);

  const bySurveyKey = new Map();
  classified.forEach((r, i) => {
    surveyKeys(r).forEach((k) => {
      if (!bySurveyKey.has(k)) bySurveyKey.set(k, []);
      bySurveyKey.get(k).push(i);
    });
  });
  bySurveyKey.forEach((indices) => {
    for (let j = 1; j < indices.length; j += 1) uf.union(indices[0], indices[j]);
  });

  const byOwnerKey = new Map();
  classified.forEach((r, i) => {
    ownerIdentityKeys(r).forEach((k) => {
      if (!byOwnerKey.has(k)) byOwnerKey.set(k, []);
      byOwnerKey.get(k).push(i);
    });
  });
  byOwnerKey.forEach((indices) => {
    for (let j = 1; j < indices.length; j += 1) uf.union(indices[0], indices[j]);
  });

  // Deliberately NOT also unioning on priorDocumentReferences / MODT-style
  // deposited-title schedules: a single mortgage or a single bundled upload
  // can legitimately cite documents for an entirely different parcel (seen
  // directly in the reference set — an MODT covering two unrelated plots).
  // Survey-number overlap and shared owner-role identity are the signals
  // that actually mean "same matter"; a shared document-number citation
  // does not.

  const groups = new Map();
  ids.forEach((i) => {
    const root = uf.find(i);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(classified[i]);
  });

  const unclassified = records.filter((r) => !r.extraction);

  return {
    matters: [...groups.values()],
    unclassified,
  };
}

module.exports = { groupIntoMatters, normalizeUnit };
