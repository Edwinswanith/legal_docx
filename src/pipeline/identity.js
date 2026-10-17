// Stage 03 "Resolve identities": exact match on PAN/Aadhaar first
// (deterministic, cheap, unambiguous); a normalized-name exact match next;
// anything left over is surfaced as a *possible* duplicate for a human — or,
// optionally, for a bounded Gemini pass — rather than guessed at silently.

const HONORIFICS = /^(mr|mrs|miss|ms|smt|shri|sri|kum|dr|thiru|tmt)\.?\s+/i;

function normalizeName(name) {
  return String(name || '')
    .toUpperCase()
    .replace(HONORIFICS, '')
    .replace(/[^A-Z ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizePan(pan) {
  return String(pan || '').toUpperCase().replace(/\s/g, '') || null;
}

function normalizeAadhaar(aadhaar) {
  const digits = String(aadhaar || '').replace(/\D/g, '');
  return digits.length === 12 ? digits : null;
}

class UnionFind {
  constructor() {
    this.parent = new Map();
  }
  find(x) {
    if (!this.parent.has(x)) this.parent.set(x, x);
    if (this.parent.get(x) !== x) this.parent.set(x, this.find(this.parent.get(x)));
    return this.parent.get(x);
  }
  union(a, b) {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent.set(ra, rb);
  }
}

// mentions: [{ fullName, panNumber, aadhaarNumber, role, sourceDocId, ... }]
function resolveIdentities(mentions) {
  const uf = new UnionFind();
  mentions.forEach((m, i) => {
    uf.find(i); // register
    const pan = normalizePan(m.panNumber);
    const aadhaar = normalizeAadhaar(m.aadhaarNumber);
    const name = normalizeName(m.fullName);
    if (pan) uf.union(i, `pan:${pan}`);
    if (aadhaar) uf.union(i, `aadhaar:${aadhaar}`);
    if (name) uf.union(i, `name:${name}`);
  });

  const groups = new Map();
  mentions.forEach((m, i) => {
    const root = uf.find(i);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(m);
  });

  const clusters = [...groups.values()].map((group, idx) => {
    const pans = [...new Set(group.map((m) => normalizePan(m.panNumber)).filter(Boolean))];
    const aadhaars = [...new Set(group.map((m) => normalizeAadhaar(m.aadhaarNumber)).filter(Boolean))];
    const names = [...new Set(group.map((m) => m.fullName).filter(Boolean))];
    const canonicalName = names.sort((a, b) => b.length - a.length)[0] || 'UNKNOWN';
    return {
      clusterId: `P${idx + 1}`,
      canonicalName,
      namesSeen: names,
      pan: pans[0] || null,
      panConflict: pans.length > 1 ? pans : null,
      aadhaar: aadhaars[0] || null,
      aadhaarConflict: aadhaars.length > 1 ? aadhaars : null,
      mentions: group.map((m) => ({ role: m.role, sourceDocId: m.sourceDocId, fullName: m.fullName })),
    };
  });

  // Possible-duplicate detection: clusters that didn't merge but share a
  // surname-ish token — a candidate list for a reviewer (or a bounded
  // Gemini same-person check) rather than an automatic merge.
  const possibleDuplicates = [];
  for (let i = 0; i < clusters.length; i += 1) {
    for (let j = i + 1; j < clusters.length; j += 1) {
      const a = normalizeName(clusters[i].canonicalName).split(' ');
      const b = normalizeName(clusters[j].canonicalName).split(' ');
      const shared = a.filter((tok) => tok.length > 2 && b.includes(tok));
      // A bare shared surname is how every family in a deed looks — flagging
      // each pair buries the real candidates. Different PANs/Aadhaar mean
      // different people; otherwise require two shared tokens, or one name
      // fully contained in the other (e.g. "KUMUD VASANT" in "KUMUD KISHORE VASANT").
      const bothHave = (x, y) => x && y;
      const differentIds =
        (bothHave(clusters[i].pan, clusters[j].pan) && clusters[i].pan !== clusters[j].pan) ||
        (bothHave(clusters[i].aadhaar, clusters[j].aadhaar) && clusters[i].aadhaar !== clusters[j].aadhaar);
      const contained = a.every((tok) => b.includes(tok)) || b.every((tok) => a.includes(tok));
      if (!differentIds && (shared.length >= 2 || (shared.length > 0 && contained))) {
        possibleDuplicates.push({ a: clusters[i].clusterId, b: clusters[j].clusterId, sharedTokens: shared });
      }
    }
  }

  return { clusters, possibleDuplicates };
}

// Optional Gemini-assisted pass for the leftover ambiguous pairs only —
// exact-match identity resolution above never needs this; it exists for the
// cases deterministic matching genuinely can't decide.
async function resolveAmbiguousWithGemini(ai, clusters, possibleDuplicates) {
  const { GoogleGenAI } = require('@google/genai');
  const byId = Object.fromEntries(clusters.map((c) => [c.clusterId, c]));
  const results = [];
  for (const pair of possibleDuplicates) {
    const a = byId[pair.a];
    const b = byId[pair.b];
    const prompt = `Two name clusters were extracted from Indian property documents and did not share a PAN, Aadhaar, or exact normalized name, but do share a name token. Decide if they refer to the SAME person.

Cluster A: ${JSON.stringify({ names: a.namesSeen, mentions: a.mentions })}
Cluster B: ${JSON.stringify({ names: b.namesSeen, mentions: b.mentions })}

Consider spelling variants, transliteration differences, and whether roles/relations are consistent with being the same person.`;
    const response = await ai.models.generateContent({
      model: process.env.GEMINI_CLASSIFY_MODEL || 'gemini-flash-latest',
      contents: prompt,
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: 'OBJECT',
          properties: {
            samePerson: { type: 'BOOLEAN' },
            confidence: { type: 'STRING', enum: ['HIGH', 'MEDIUM', 'LOW'] },
            reasoning: { type: 'STRING' },
          },
          required: ['samePerson', 'confidence', 'reasoning'],
        },
      },
    });
    results.push({ ...pair, ...JSON.parse(response.text) });
  }
  return results;
}

module.exports = { resolveIdentities, resolveAmbiguousWithGemini, normalizeName };
