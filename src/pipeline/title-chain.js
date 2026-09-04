// Stage 03 "Build title chain": merges three sources of document references
// into one chronological chain —
//   (a) the documents actually uploaded,
//   (b) MODT-style schedules of deposited title deeds (often the single
//       richest source of chain history in a matter),
//   (c) each document's own `priorDocumentReferences`.
// Ordering and "is this independently verified" are both deterministic;
// nothing here is inferred by a model.

const { sortKey } = require('./dates');

// Different sources format the same document reference differently — one
// gives documentNumber="1905" + documentYear="1994", another (e.g. a prose
// prior-document reference) gives documentNumber="1905/1994" with no
// separate year, another gives documentNumber="1388 of 2002". Normalize all
// of these to the same key or every source produces its own duplicate row.
function key(documentNumber, documentYear) {
  let num = String(documentNumber || '').trim();
  let year = documentYear ? String(documentYear).trim() : null;
  if (!num && !year) return null;

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

  num = num.replace(/\s+/g, ' ').replace(/^0+(?=\d)/, '');
  return `${num || '?'}/${year || '?'}`;
}

function summarizeParties(doc, roles) {
  const names = (doc.parties || [])
    .filter((p) => roles.some((r) => (p.role || '').toUpperCase().includes(r)))
    .map((p) => p.fullName)
    .filter(Boolean);
  return names.join(', ') || null;
}

const GIVING_ROLES = ['SETTLOR', 'VENDOR', 'DONOR', 'EXECUTOR', 'PRINCIPAL'];
const RECEIVING_ROLES = ['SETTLEE', 'PURCHASER', 'DONEE', 'AGENT', 'BANK'];

function buildTitleChain(documents) {
  const entries = new Map(); // key -> merged entry

  function upsert(entryKey, partial, source) {
    if (!entryKey) return;
    const keyYear = entryKey.match(/\/(\d{4})$/)?.[1] || null;
    const existing = entries.get(entryKey) || {
      key: entryKey,
      documentType: null,
      date: null,
      year: keyYear,
      subRegistrarOffice: null,
      executedBy: null,
      inFavourOf: null,
      uploaded: false,
      sourceDocIds: [],
      sourceKinds: [],
      remarks: [],
    };
    entries.set(entryKey, {
      ...existing,
      documentType: existing.documentType || partial.documentType || null,
      date: existing.date || partial.date || null,
      year: existing.year || partial.year || null,
      subRegistrarOffice: existing.subRegistrarOffice || partial.subRegistrarOffice || null,
      executedBy: existing.executedBy || partial.executedBy || null,
      inFavourOf: existing.inFavourOf || partial.inFavourOf || null,
      uploaded: existing.uploaded || Boolean(partial.uploaded),
      sourceDocIds: [...new Set([...existing.sourceDocIds, ...(partial.sourceDocIds || [])])],
      sourceKinds: [...new Set([...existing.sourceKinds, source])],
      remarks: partial.remarks ? [...existing.remarks, partial.remarks] : existing.remarks,
    });
  }

  // (a) uploaded documents themselves
  documents.forEach((doc) => {
    const k = key(doc.documentNumber, doc.documentYear);
    upsert(
      k,
      {
        documentType: doc.registryType,
        date: doc.executionDate,
        year: doc.documentYear,
        subRegistrarOffice: doc.subRegistrarOffice,
        executedBy: summarizeParties(doc, GIVING_ROLES),
        inFavourOf: summarizeParties(doc, RECEIVING_ROLES),
        uploaded: true,
        sourceDocIds: [doc.id],
      },
      'uploaded',
    );
  });

  // (b) MODT-style schedule of deposited title deeds (or any type-specific
  // field with the same shape) — the richest single source when present.
  documents.forEach((doc) => {
    const schedule = doc.raw?.scheduleOfDepositedTitleDeeds;
    if (!Array.isArray(schedule)) return;
    schedule.forEach((row) => {
      const k = key(row.documentNumber, row.documentYear);
      upsert(
        k,
        {
          documentType: row.documentType,
          date: row.date,
          year: row.documentYear,
          subRegistrarOffice: row.subRegistrarOffice,
          executedBy: row.executedBy,
          inFavourOf: row.inFavourOf,
          sourceDocIds: [doc.id],
          remarks: row.remarks ? `${row.remarks} (per ${doc.label} schedule)` : null,
        },
        'modt-schedule',
      );
    });
  });

  // (c) each document's own references to earlier documents
  documents.forEach((doc) => {
    (doc.priorDocumentReferences || []).forEach((ref) => {
      const k = key(ref.documentNumber, ref.documentYear);
      upsert(
        k,
        {
          documentType: ref.documentType,
          date: ref.date,
          subRegistrarOffice: ref.subRegistrarOffice,
          executedBy: ref.executedBy,
          inFavourOf: ref.inFavourOf,
          sourceDocIds: [doc.id],
          remarks: `${ref.relationship} (per ${doc.label})`,
        },
        'prior-reference',
      );
    });
  });

  const chain = [...entries.values()]
    .filter((e) => e.key)
    .sort((x, y) => {
      const kx = sortKey(x.date, x.year) ?? Infinity;
      const ky = sortKey(y.date, y.year) ?? Infinity;
      return kx - ky;
    });

  const years = chain.map((e) => sortKey(e.date, e.year)).filter(Boolean).map((k) => Math.floor(k / 10000));
  const earliestYear = years.length ? Math.min(...years) : null;
  const latestYear = years.length ? Math.max(...years) : null;
  const currentYear = new Date().getFullYear();
  const spanYears = earliestYear ? currentYear - earliestYear : null;

  const unverifiedLinks = chain.filter((e) => !e.uploaded);

  return {
    chain,
    earliestYear,
    latestYear,
    spanYears,
    meetsThirtyFiveYearRule: spanYears != null ? spanYears >= 35 : null,
    unverifiedLinks: unverifiedLinks.map((e) => ({ key: e.key, documentType: e.documentType, year: e.year, mentionedVia: e.sourceKinds })),
  };
}

module.exports = { buildTitleChain };
