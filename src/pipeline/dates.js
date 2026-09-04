// Deterministic, best-effort date parsing. Deed dates are free text
// ("23rd day of April 2021", "17.04.2002", "19/06/2024") — this never
// guesses a full date if it can't parse one; it always at least tries to
// recover the year, since chronological ordering only strictly needs that.

const MONTHS = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

function extractYear(text) {
  const match = String(text || '').match(/\b(19|20)\d{2}\b/);
  return match ? Number(match[0]) : null;
}

// Returns { year, month, day } with month/day possibly null.
function parseLooseDate(text) {
  const s = String(text || '').trim();
  if (!s) return null;

  const numeric = s.match(/(\d{1,2})[./-](\d{1,2})[./-](\d{4})/);
  if (numeric) {
    return { day: Number(numeric[1]), month: Number(numeric[2]), year: Number(numeric[3]) };
  }

  const prose = s.match(/(\d{1,2})\w{0,2}\s+(?:day\s+of\s+)?([A-Za-z]+)[,\s]+(\d{4})/i);
  if (prose) {
    const month = MONTHS[prose[2].slice(0, 3).toLowerCase()];
    if (month) return { day: Number(prose[1]), month, year: Number(prose[3]) };
  }

  const year = extractYear(s);
  return year ? { day: null, month: null, year } : null;
}

// Sort key: year * 10000 + month * 100 + day, missing parts zeroed so
// same-year entries with a parsed month/day sort ahead of same-year entries
// without one, which is a reasonable tie-break, not a claim of precision.
function sortKey(dateText, fallbackYear) {
  const parsed = parseLooseDate(dateText) || (fallbackYear ? { year: Number(fallbackYear), month: null, day: null } : null);
  if (!parsed || !parsed.year) return null;
  return parsed.year * 10000 + (parsed.month || 0) * 100 + (parsed.day || 0);
}

module.exports = { parseLooseDate, extractYear, sortKey };
