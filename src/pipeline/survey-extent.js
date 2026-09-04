// Stage 03 "Reconcile survey & extent": groups every property-schedule
// mention across the matter's documents into parcels keyed by survey
// number, correlates old<->new numbers, and flags conflicting extent
// figures. All arithmetic (unit conversion, comparison) is deterministic —
// see units.js.

const { toCents, normalizeUnit } = require('./units');

function parcelKey(sched) {
  const old = sched.oldSurveyNumber?.trim() || '';
  const nw = sched.newSurveyNumber?.trim() || '';
  if (!old && !nw) return null;
  return `${old}|${nw}`;
}

function isPartialShare(sched) {
  const text = `${sched.scheduleLabel || ''} ${sched.description || ''} ${sched.extentUnit || ''}`.toLowerCase();
  return text.includes('undivided share') || text.includes('share of');
}

function reconcileSurveyAndExtent(documents) {
  const mentions = [];
  documents.forEach((doc) => {
    (doc.propertySchedules || []).forEach((sched, idx) => {
      if (!sched.description && !sched.oldSurveyNumber && !sched.newSurveyNumber && !sched.extentValue) return; // empty/duplicate artifact, already flagged by validate.js
      mentions.push({ ...sched, sourceDocId: doc.id, sourceLabel: doc.label, scheduleIndex: idx });
    });
  });

  // old <-> new survey number correlation, with conflict detection
  const oldToNew = new Map();
  const newToOld = new Map();
  mentions.forEach((m) => {
    if (m.oldSurveyNumber && m.newSurveyNumber) {
      if (!oldToNew.has(m.oldSurveyNumber)) oldToNew.set(m.oldSurveyNumber, new Set());
      oldToNew.get(m.oldSurveyNumber).add(m.newSurveyNumber);
      if (!newToOld.has(m.newSurveyNumber)) newToOld.set(m.newSurveyNumber, new Set());
      newToOld.get(m.newSurveyNumber).add(m.oldSurveyNumber);
    }
  });
  // One old survey number splitting into several new ones is ordinary
  // subdivision (seen directly in the reference set: 130/2 -> 2/5 and 2/6),
  // not a conflict. The genuine red flag is the other direction — one
  // *current* survey number with two different claimed histories.
  const subdivisions = [];
  oldToNew.forEach((news, old) => {
    if (news.size > 1) subdivisions.push({ oldSurveyNumber: old, subdividedInto: [...news] });
  });
  const surveyConflicts = [];
  newToOld.forEach((olds, nw) => {
    if (olds.size > 1) surveyConflicts.push({ newSurveyNumber: nw, conflictingOldNumbers: [...olds] });
  });

  // group into parcels
  const parcels = new Map();
  mentions.forEach((m) => {
    const k = parcelKey(m) || `unspecified:${m.sourceDocId}:${m.scheduleIndex}`;
    if (!parcels.has(k)) parcels.set(k, []);
    parcels.get(k).push(m);
  });

  const parcelSummaries = [...parcels.entries()].map(([k, group]) => {
    const withCents = group.map((m) => ({ ...m, cents: toCents(m.extentValue, m.extentUnit) }));
    const fullMentions = withCents.filter((m) => !isPartialShare(m) && m.cents != null);
    const distinctCents = [...new Set(fullMentions.map((m) => m.cents))];
    return {
      parcelKey: k,
      oldSurveyNumber: group[0].oldSurveyNumber || null,
      newSurveyNumber: group[0].newSurveyNumber || null,
      village: group.find((m) => m.village)?.village || null,
      mentions: withCents.map((m) => ({
        sourceDocId: m.sourceDocId,
        sourceLabel: m.sourceLabel,
        extentValue: m.extentValue,
        extentUnit: m.extentUnit,
        normalizedCents: m.cents,
        isPartialShare: isPartialShare(m),
      })),
      extentConsistent: distinctCents.length <= 1,
      distinctExtentsCents: distinctCents,
    };
  });

  return {
    parcels: parcelSummaries,
    subdivisions,
    surveyConflicts,
  };
}

module.exports = { reconcileSurveyAndExtent };
