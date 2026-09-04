// Stage 05 "Map to template": the Template Registry. This is the token map
// the architecture promised — every value the generated .docx needs, keyed
// exactly the way generate-report.js expects to consume it, computed only
// from the Matter Knowledge Store (never re-reading a scan, never calling
// Gemini). Findings text is assembled from data, not written by a model —
// this is a legal deliverable, so the system states facts and flags gaps;
// it never asserts the opinion itself. Every section says so.

const DRAFT_NOTE =
  'SYSTEM-GENERATED DRAFT — assembled from the uploaded documents\' extracted data. An advocate must verify every figure against the original documents before this is issued.';

function fmtDate(d = new Date()) {
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' });
}

// Some deeds' own survey fields already carry the "Old Survey No." /
// "New T.S.No." label as part of the extracted string; the report template
// adds its own "Old ... → New ..." labels, so strip any embedded ones first
// or they'd double up.
function cleanSurveyValue(v) {
  return v ? v.replace(/^(old|new)\s+(survey\s*no\.?|t\.?s\.?\s*no\.?)\s*:?\s*/i, '').trim() : v;
}

function joinNames(list) {
  const names = [...new Set((list || []).filter(Boolean))];
  return names.length ? names.join('; ') : null;
}

function mostRecentUploadedConveyance(matter) {
  const conveyanceTypes = ['SALE_DEED', 'GIFT_DEED', 'SETTLEMENT_DEED'];
  return matter.documents
    .filter((d) => conveyanceTypes.includes(d.registryType))
    .sort((a, b) => Number(b.documentYear || 0) - Number(a.documentYear || 0))[0] || null;
}

function partiesByRole(doc, roleSubstrings) {
  return (doc?.parties || []).filter((p) => roleSubstrings.some((r) => (p.role || '').toUpperCase().includes(r)));
}

function currentPrincipal(matter) {
  const modt = matter.documents.find((d) => d.registryType === 'MEMORANDUM_OF_DEPOSIT_OF_TITLE_DEEDS');
  if (modt) {
    const executor = partiesByRole(modt, ['EXECUTOR', 'PRINCIPAL']);
    if (executor.length) return { name: joinNames(executor.map((p) => p.fullName)), source: modt.label, basis: 'executor of the deposited-title-deeds memorandum' };
  }
  const latestPoa = matter.documents
    .filter((d) => d.registryType === 'GENERAL_POWER_OF_ATTORNEY')
    .sort((a, b) => Number(b.documentYear || 0) - Number(a.documentYear || 0))[0];
  if (latestPoa) {
    const principal = partiesByRole(latestPoa, ['PRINCIPAL']);
    if (principal.length) return { name: joinNames(principal.map((p) => p.fullName)), source: latestPoa.label, basis: 'principal in the most recent Power of Attorney' };
  }
  return null;
}

function propertyDescription(matter) {
  const parcels = matter.surveyExtent.parcels.filter((p) => p.oldSurveyNumber || p.newSurveyNumber);
  if (!parcels.length) return '[PROPERTY ADDRESS AND SCHEDULE OF PROPERTY — not determinable from uploaded documents]';
  const village = matter.documents
    .flatMap((d) => d.propertySchedules)
    .map((s) => s.village)
    .find(Boolean);
  const lines = parcels.map((p) => {
    const extent = p.distinctExtentsCents.length ? `${p.distinctExtentsCents.join('/')} cent(s)` : 'extent not extracted';
    return `Old Survey No. ${cleanSurveyValue(p.oldSurveyNumber) || '[not stated]'} — New Survey No. ${cleanSurveyValue(p.newSurveyNumber) || '[not stated]'} (${extent})`;
  });
  return `${village ? `Situated at ${village}. ` : ''}${lines.join('; ')}.`;
}

function surveyNoLine(matter) {
  const parcels = matter.surveyExtent.parcels.filter((p) => p.oldSurveyNumber || p.newSurveyNumber);
  if (!parcels.length) return '[OLD SURVEY NO.] / [NEW SURVEY NO.]';
  return parcels.map((p) => `${cleanSurveyValue(p.oldSurveyNumber) || '—'} → ${cleanSurveyValue(p.newSurveyNumber) || '—'}`).join('; ');
}

function section1(matter) {
  const lines = matter.documents.map((d) => {
    const parties = d.parties.map((p) => `${p.role}: ${p.fullName}`).join('; ');
    return `• ${d.registryType.replace(/_/g, ' ')} — Doc. No. ${d.documentNumber || '[?]'}/${d.documentYear || '[?]'}, executed ${d.executionDate || '[date not extracted]'} at ${d.subRegistrarOffice || '[SRO not extracted]'}. Parties — ${parties || '[none extracted]'}. Registered (document/book number present): ${d.documentNumber ? 'Yes' : 'Not confirmed'}.`;
  });
  return [DRAFT_NOTE, '', `${matter.documents.length} document(s) reviewed in this set:`, ...lines].join('\n');
}

function section2(matter) {
  const chain = matter.titleChain;
  const verifiedCount = chain.chain.length - chain.unverifiedLinks.length;
  const lines = [
    DRAFT_NOTE,
    '',
    `Reconstructed chain: ${chain.chain.length} document(s) spanning ${chain.earliestYear ?? '?'}–${chain.latestYear ?? '?'} (${chain.spanYears ?? '?'} years). 35-year continuity requirement: ${chain.meetsThirtyFiveYearRule ? 'met' : 'NOT met based on documents reviewed'}.`,
    `${verifiedCount} of ${chain.chain.length} chain entries are backed by an uploaded document; ${chain.unverifiedLinks.length} are known only by reference (cited in another document but not independently supplied) and should be independently verified.`,
    '',
    'Chain (earliest to latest):',
    ...chain.chain.map((e) => `  ${e.year || '?'} — ${e.documentType || '[type not stated]'} (${e.key}), ${e.executedBy || '[?]'} → ${e.inFavourOf || '[?]'}${e.uploaded ? '' : '  [referenced only — not independently verified]'}`),
  ];
  return lines.join('\n');
}

function section3(matter) {
  const lines = matter.identities.clusters.map((c) => {
    const roles = [...new Set(c.mentions.map((m) => m.role))].join(', ');
    const conflict = c.panConflict ? `  ⚠ PAN CONFLICT across mentions: ${c.panConflict.join(', ')}` : '';
    return `• ${c.canonicalName} — role(s): ${roles}; PAN: ${c.pan || '[not extracted]'}; Aadhaar: ${c.aadhaar || '[not extracted]'}.${conflict}`;
  });
  const dupNote = matter.identities.possibleDuplicates.length
    ? `\n\n${matter.identities.possibleDuplicates.length} pair(s) of party records share a name fragment but were not auto-merged (no shared PAN/Aadhaar/exact name) — advocate to confirm whether any are the same person.`
    : '';
  return [DRAFT_NOTE, '', 'Parties identified across all documents in this matter:', ...lines].join('\n') + dupNote;
}

function section4(matter) {
  const { parcels, subdivisions, surveyConflicts } = matter.surveyExtent;
  const lines = parcels
    .filter((p) => p.oldSurveyNumber || p.newSurveyNumber)
    .map((p) => `• Old ${cleanSurveyValue(p.oldSurveyNumber) || '—'} → New ${cleanSurveyValue(p.newSurveyNumber) || '—'}${p.village ? ` (${p.village})` : ''}`);
  const subdivLines = subdivisions.map((s) => `  Subdivision: Old ${s.oldSurveyNumber} was subdivided into ${s.subdividedInto.join(', ')}.`);
  const conflictLines = surveyConflicts.map(
    (c) => `  ⚠ CONFLICT: New survey ${c.newSurveyNumber} is given two different old-number histories: ${c.conflictingOldNumbers.join(' vs ')}.`,
  );
  return [DRAFT_NOTE, '', 'Survey number correlation:', ...lines, ...subdivLines, ...(conflictLines.length ? ['', 'Conflicts requiring resolution:', ...conflictLines] : [])].join('\n');
}

function section5(matter) {
  const lines = matter.surveyExtent.parcels
    .filter((p) => p.mentions.length)
    .map((p) => {
      const mentionLines = p.mentions
        .map((m) => `    - ${m.sourceLabel}: ${m.extentValue} ${m.extentUnit}${m.normalizedCents != null ? ` (≈ ${m.normalizedCents} cents)` : ''}${m.isPartialShare ? ' [partial/undivided share]' : ''}`)
        .join('\n');
      return `• Old ${cleanSurveyValue(p.oldSurveyNumber) || '—'} / New ${cleanSurveyValue(p.newSurveyNumber) || '—'} — extent ${p.extentConsistent ? 'consistent' : 'DIFFERS'} across mentions:\n${mentionLines}`;
    });
  return [DRAFT_NOTE, '', lines.join('\n\n') || 'No property-schedule extent data extracted.'].join('\n');
}

function conclusion(matter) {
  const chain = matter.titleChain;
  const survey = matter.surveyExtent;
  const identity = matter.identities;

  const answer = (ok, caveat) => (ok ? `Likely Yes — ${caveat}` : `Needs attention — ${caveat}`);

  return [
    {
      question: 'Whether the title flow is continuous and complete for the past 35 years.',
      systemSuggested: answer(
        chain.meetsThirtyFiveYearRule && chain.unverifiedLinks.length === 0,
        `chain spans ${chain.earliestYear ?? '?'}–${chain.latestYear ?? '?'}, ${chain.unverifiedLinks.length} link(s) unverified — see Section 2.`,
      ),
    },
    {
      question: 'Whether the present Vendor has absolute and marketable title.',
      systemSuggested: '[Advocate to confirm — requires legal judgment beyond the extracted facts.]',
    },
    {
      question: 'Whether the identity of the property is clearly established.',
      systemSuggested: answer(survey.surveyConflicts.length === 0, `${survey.surveyConflicts.length} survey-number conflict(s) found — see Section 4.`),
    },
    {
      question: 'Whether the Old and New Survey Numbers are properly correlated.',
      systemSuggested: answer(survey.surveyConflicts.length === 0, `${survey.parcels.length} parcel(s) correlated, ${survey.subdivisions.length} known subdivision(s), ${survey.surveyConflicts.length} conflict(s).`),
    },
    {
      question: 'Whether the extent and boundaries are consistent throughout the title records.',
      systemSuggested: answer(
        survey.parcels.every((p) => p.extentConsistent),
        `${survey.parcels.filter((p) => !p.extentConsistent).length} parcel(s) with differing extent figures across mentions — see Section 5.`,
      ),
    },
    {
      question: 'Whether there are any encumbrances, charges, litigations, claims, or defects affecting the property.',
      systemSuggested: `${matter.encumbrances.length} item(s) found — see Encumbrances. ${identity.possibleDuplicateIdentityCount || identity.possibleDuplicates.length} possible-duplicate identity pair(s) also flagged for confirmation.`,
    },
    {
      question: 'Whether the property is legally fit for purchase, mortgage, development, or registration.',
      systemSuggested: '[Advocate to confirm — final legal opinion, not auto-generated.]',
    },
  ];
}

function buildReportData(matter) {
  const conveyance = mostRecentUploadedConveyance(matter);
  const vendors = conveyance ? joinNames(partiesByRole(conveyance, ['VENDOR', 'SETTLOR', 'DONOR']).map((p) => p.fullName)) : null;
  const principal = currentPrincipal(matter);

  return {
    referenceNo: matter.matterId,
    dateOfReport: fmtDate(),
    clientPurchaser: principal ? `${principal.name}  [system-suggested from ${principal.basis} — confirm]` : '[CLIENT / PURCHASER NAME]',
    vendors: vendors || '[VENDOR NAME(S)]',
    propertySchedule: propertyDescription(matter),
    surveyNo: surveyNoLine(matter),
    sections: {
      section1: section1(matter),
      section2: section2(matter),
      section3: section3(matter),
      section4: section4(matter),
      section5: section5(matter),
    },
    conclusion: conclusion(matter),
    overallOpinion: `${DRAFT_NOTE}\n\nSummary: ${matter.documents.length} document(s) reviewed, chain reconstructed across ${matter.titleChain.chain.length} entries (${matter.titleChain.unverifiedLinks.length} unverified), ${matter.surveyExtent.surveyConflicts.length} survey conflict(s), ${matter.encumbrances.length} encumbrance item(s). This draft does not constitute a legal opinion.`,
  };
}

module.exports = { buildReportData, DRAFT_NOTE };
