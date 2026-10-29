// Stage 04 "Reviewer workbench" — minimum viable version. A static,
// self-contained review page per pipeline run: every document, every
// reconciled fact, every flag, with its source citation, so an advocate can
// check the system's work before a report is issued. Read-only (no
// persistence of edits) — the honest scope for this phase; an editable
// workbench needs a backend and storage decision that hasn't been made yet
// (see the architecture plan's open questions).
//
// The page leads with what needs the reviewer's attention, then the title
// chain, parties, survey/extent, encumbrances and the per-document detail.
// Styles and scripts come from public/assets and are inlined, so the file
// also works when opened straight from disk after a CLI run.

const fs = require('fs');
const path = require('path');

const ASSETS_DIR = path.join(__dirname, '..', '..', 'public', 'assets');
const asset = (name) => fs.readFileSync(path.join(ASSETS_DIR, name), 'utf8');

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const plural = (n, word, many = `${word}s`) => `${n} ${n === 1 ? word : many}`;

function badge(text, tone = '') {
  return `<span class="badge${tone ? ` badge-${tone}` : ''}">${esc(text)}</span>`;
}

// "GENERAL_POWER_OF_ATTORNEY" / "GIFT DEED" -> "General power of attorney"
function sentenceCase(v) {
  const s = String(v ?? '').replace(/_/g, ' ').trim().toLowerCase();
  return s ? s[0].toUpperCase() + s.slice(1) : '';
}

// Readable names for extraction paths such as parties[2].aadhaarNumber.
const FIELD_NAMES = {
  oldSurveyNumber: 'old survey no.', newSurveyNumber: 'new survey no.', extentValue: 'extent', extentUnit: 'extent unit',
  fullName: 'name', panNumber: 'PAN', aadhaarNumber: 'Aadhaar', village: 'village', role: 'role',
  documentNumber: 'document no.', documentYear: 'document year', executionDate: 'execution date',
  stampDutyPaid: 'stamp duty', considerationAmount: 'consideration', poaDocumentNumber: 'power of attorney no.',
};
const GROUP_NAMES = { parties: 'Party', propertySchedules: 'Schedule' };
// Containers that add nothing to the label ("stamp.stampDutyPaid" is "stamp duty").
const SILENT_PARTS = new Set(['stamp', 'value', 'representedByPoa']);

function fieldLabel(fieldPath) {
  const parts = String(fieldPath ?? '').split('.').filter(Boolean);
  const kept = parts.length > 1 ? parts.filter((part) => !SILENT_PARTS.has(part)) : parts;
  const words = (kept.length ? kept : parts).map((part) => {
    const m = part.match(/^(\w+)\[(\d+)\]$/);
    if (m) return `${GROUP_NAMES[m[1]] || sentenceCase(m[1].replace(/([A-Z])/g, ' $1'))} ${Number(m[2]) + 1}`;
    return FIELD_NAMES[part] || part.replace(/([A-Z])/g, ' $1').toLowerCase().trim();
  });
  if (words.length === 1 && /^(Party|Schedule) \d+$/.test(words[0])) words.push('whole entry');
  const text = words.join(' · ');
  return text ? text[0].toUpperCase() + text.slice(1) : '';
}

// Warnings name fields by their extraction path; show the readable label.
const readablePaths = (text) => String(text ?? '').replace(/\b(?:parties|propertySchedules)\[\d+\](?:\.\w+)*/g, (p) => fieldLabel(p).replace(' · whole entry', ''));

// The "N fields differed" warning repeats the Fields to check table, which
// the review page already shows (the .docx report still needs it).
const reviewWarnings = (doc) => doc.warnings.filter((w) => !/differed between independent extraction runs/.test(w)).map(readablePaths);

const fileName = (doc) => String(doc.sourceFile).split(/[\\/]/).pop();

// Opens the uploaded scan at the cited page (served by server.js /files/:name)
// in the side panel. Falls back to plain text for CLI runs, where there is no
// server to link to.
function pageLink(doc, page) {
  const label = `p. ${esc(page ?? '?')}`;
  const n = Number.parseInt(page, 10);
  if (!doc.sourceFile || !Number.isInteger(n)) return label;
  const href = `/files/${encodeURIComponent(fileName(doc))}#page=${n}`;
  return `<a class="pagelink" href="${esc(href)}" data-scan="${esc(`${doc.label} — page ${n}`)}" target="_blank" rel="noopener">${label}</a>`;
}

// For flagged fields with no recorded citation we can't know the page, so link
// the scan itself rather than pointing at a page 1 that may be wrong.
function scanLink(doc, text = 'Open scan') {
  if (!doc.sourceFile) return '<span class="muted">—</span>';
  const href = `/files/${encodeURIComponent(fileName(doc))}`;
  return `<a class="pagelink" href="${esc(href)}" data-scan="${esc(doc.label)}" target="_blank" rel="noopener">${esc(text)}</a>`;
}

const KIND_LABEL = { conflict: 'Readings disagree', omitted: 'Missing in one reading', 'item-in-one-run': 'Found in one reading only' };

const docAnchor = (matterIdx, docIdx) => `m${matterIdx}-doc-${docIdx}`;
const docFlagged = (doc) => doc.confidence !== 'HIGH' || reviewWarnings(doc).length > 0 || doc.errors.length > 0
  || (doc.consensus?.disagreements?.length || 0) > 0;

// Everything the reviewer must look at before issuing the report, worst first.
function attentionItems(matter, matterIdx) {
  const items = [];
  const sec = (name) => `#m${matterIdx}-${name}`;
  const chain = matter.titleChain;

  if (!chain.meetsThirtyFiveYearRule) {
    items.push({ sev: 'danger', title: '35-year title history not covered', detail: `The documents trace the title from ${chain.earliestYear ?? '?'} to ${chain.latestYear ?? '?'}.`, href: sec('chain') });
  }
  matter.surveyExtent.parcels.filter((p) => !p.extentConsistent).forEach((p) => {
    items.push({ sev: 'danger', title: `Extent differs for survey no. ${p.oldSurveyNumber || p.newSurveyNumber || '—'}`, detail: extentSeen(p), href: sec('survey') });
  });
  matter.identities.clusters.filter((c) => c.panConflict || c.aadhaarConflict).forEach((c) => {
    items.push({ sev: 'danger', title: `Conflicting ${c.panConflict ? 'PAN' : 'Aadhaar'} for ${c.canonicalName}`, detail: 'Different numbers appear for the same person across documents.', href: sec('parties') });
  });
  matter.documents.forEach((doc, i) => {
    const anchor = docAnchor(matterIdx, i);
    doc.errors.forEach((e) => items.push({ sev: 'danger', title: doc.label, detail: readablePaths(e), href: `#${anchor}`, open: anchor }));
    const disagreements = doc.consensus?.disagreements || [];
    if (disagreements.length) {
      const fields = [...new Set(disagreements.map((d) => fieldLabel(d.path)))];
      items.push({
        sev: 'warn',
        title: `${doc.label}: ${plural(disagreements.length, 'field')} to check against the scan`,
        detail: fields.slice(0, 4).join(', ') + (fields.length > 4 ? ` and ${fields.length - 4} more` : ''),
        href: `#${anchor}`, open: anchor,
      });
    }
    if (doc.confidence !== 'HIGH') {
      items.push({ sev: 'warn', title: `${doc.label}: document type uncertain`, detail: `Identified as ${sentenceCase(doc.registryType)} with ${String(doc.confidence).toLowerCase()} confidence.`, href: `#${anchor}`, open: anchor });
    }
    reviewWarnings(doc).forEach((w) => items.push({ sev: 'warn', title: doc.label, detail: w, href: `#${anchor}`, open: anchor }));
  });
  if (chain.unverifiedLinks.length) {
    const list = chain.unverifiedLinks.map((l) => `${l.year ?? '?'} ${l.documentType || 'deed'} (${l.key})`);
    items.push({ sev: 'warn', title: `${plural(chain.unverifiedLinks.length, 'earlier deed')} referred to but not uploaded`, detail: list.join(', '), href: sec('chain') });
  }
  const dupes = matter.summary.possibleDuplicateIdentityCount || 0;
  if (dupes) {
    items.push({ sev: 'warn', title: `${plural(dupes, 'possible duplicate person', 'possible duplicate people')}`, detail: 'Similar names that may be the same person — confirm in the parties table.', href: sec('parties') });
  }
  return items;
}

function attentionSection(items) {
  const rows = items.map((it) => `
      <li>
        <span class="sev">${it.sev === 'danger' ? badge('Problem', 'danger') : badge('Verify', 'warn')}</span>
        <span class="what"><b>${esc(it.title)}</b>${it.detail ? `<span class="detail">${esc(it.detail)}</span>` : ''}</span>
        <a class="go" href="${esc(it.href)}"${it.open ? ` data-open="${esc(it.open)}"` : ''}>View</a>
      </li>`).join('');
  return `<ul class="attention-list">${rows || '<li class="attention-empty">Nothing flagged. Still spot-check the key facts against the scans before issuing the report.</li>'}</ul>`;
}

// Long "executed by" lists collapse to the first two names.
function names(text) {
  const list = String(text ?? '').split(/,\s*/).map((s) => s.trim()).filter(Boolean);
  if (list.length <= 2) return esc(list.join(', ') || '—');
  return `<details class="names"><summary>${esc(list.slice(0, 2).join(', '))} <span class="more">+ ${list.length - 2} more</span></summary><div class="rest">${esc(list.slice(2).join(', '))}</div></details>`;
}

function flaggedFieldsTable(doc) {
  const rows = doc.consensus?.disagreements || [];
  if (!rows.length) return '';
  const show = (v) => (v == null ? '<span class="muted">not found</span>' : esc(v));
  return `<h4>Fields to check <span class="hint">— two independent readings of the scan did not agree</span></h4>
      <div class="table-wrap"><table class="data stack flag-table">
        <thead><tr><th>Field</th><th>Issue</th><th>Reading 1</th><th>Reading 2</th><th>Source</th></tr></thead>
        <tbody>${rows.map((d) => {
          const cite = doc.citations.find((c) => c.field === d.path);
          return `<tr class="${d.kind === 'conflict' ? 'has-problem' : 'needs-check'}"><td title="${esc(d.path)}">${esc(fieldLabel(d.path))}</td><td>${badge(KIND_LABEL[d.kind] || d.kind, d.kind === 'conflict' ? 'danger' : 'warn')}</td><td>${show(d.values[0])}</td><td>${show(d.values[1])}</td><td class="nowrap">${cite ? pageLink(doc, cite.page) : scanLink(doc)}</td></tr>`;
        }).join('')}</tbody>
      </table></div>`;
}

function documentCard(doc, matterIdx, docIdx) {
  const flagged = docFlagged(doc);
  const docNo = [doc.documentNumber, doc.documentYear].filter(Boolean).join('/') || '—';
  return `
  <details class="doc-card${flagged ? ' flagged' : ''}" id="${docAnchor(matterIdx, docIdx)}">
    <summary>
      <span class="doc-title">${esc(doc.label)}</span>
      <span class="doc-type">${esc(sentenceCase(doc.registryType))}</span>
      ${flagged ? badge('Needs checking', 'warn') : badge('No issues', 'ok')}
      <span class="doc-meta">Doc. no. ${esc(docNo)} · ${esc(doc.executionDate || 'date not found')}</span>
    </summary>
    <div class="doc-body">
      <div class="doc-grid">
        <div>
          <h4>Parties</h4>
          <ul class="kv">
            ${doc.parties.map((p) => `<li><span class="role">${esc(sentenceCase(p.role))}</span>${esc(p.fullName)}${p.panNumber ? ` · PAN ${esc(p.panNumber)}` : ''}${p.aadhaarNumber ? ` · Aadhaar ${esc(p.aadhaarNumber)}` : ''}</li>`).join('') || '<li class="muted">None found</li>'}
          </ul>
        </div>
        <div>
          <h4>Property schedules</h4>
          <ul class="kv">
            ${doc.propertySchedules.map((s, i) => `<li><span class="role">${esc(s.scheduleLabel || `Schedule ${i + 1}`)}</span>Survey no. ${esc(s.oldSurveyNumber || '—')} → ${esc(s.newSurveyNumber || '—')} · ${esc(s.extentValue || '?')} ${esc(s.extentUnit || '')}</li>`).join('') || '<li class="muted">None found</li>'}
          </ul>
        </div>
      </div>
      ${flaggedFieldsTable(doc)}
      ${doc.errors.length ? `<h4>Problems</h4><ul class="issue-list bad">${doc.errors.map((w) => `<li>${esc(readablePaths(w))}</li>`).join('')}</ul>` : ''}
      ${reviewWarnings(doc).length ? `<h4>To verify</h4><ul class="issue-list warn">${reviewWarnings(doc).map((w) => `<li>${esc(w)}</li>`).join('')}</ul>` : ''}
      <details class="citations">
        <summary>Source citations (${doc.citations.length}) · ${scanLink(doc, 'open full scan')}</summary>
        <ul>
          ${doc.citations.map((c) => `<li><span class="field">${esc(fieldLabel(c.field))}</span> · ${pageLink(doc, c.page)} — <span class="quote">“${esc(c.quote)}”</span></li>`).join('') || '<li class="muted">None recorded</li>'}
        </ul>
      </details>
    </div>
  </details>`;
}

function chainRow(e) {
  return `<tr class="${e.uploaded ? '' : 'needs-check'}">
    <td class="nowrap">${esc(e.year ?? '?')}</td>
    <td>${esc(sentenceCase(e.documentType) || 'Type not stated')}</td>
    <td class="nowrap">${esc(e.key)}</td>
    <td>${names(e.executedBy)}</td>
    <td>${names(e.inFavourOf)}</td>
    <td class="nowrap">${e.uploaded ? badge('Uploaded', 'ok') : badge('Not uploaded', 'warn')}</td>
  </tr>`;
}

function identityRow(c) {
  const conflict = c.panConflict || c.aadhaarConflict;
  return `<tr class="${conflict ? 'has-problem' : ''}">
    <td>${esc(c.canonicalName)}</td>
    <td>${[...new Set(c.mentions.map((m) => sentenceCase(m.role)))].map(esc).join(', ')}</td>
    <td class="nowrap">${esc(c.pan || '—')}${c.panConflict ? ` ${badge('Conflict', 'danger')}` : ''}</td>
    <td class="nowrap">${esc(c.aadhaar || '—')}${c.aadhaarConflict ? ` ${badge('Conflict', 'danger')}` : ''}</td>
    <td class="num">${c.mentions.length}</td>
  </tr>`;
}

function extentSeen(p) {
  if (p.distinctExtentsCents.length) return p.distinctExtentsCents.map((c) => `${c} cents`).join(' vs ');
  // Partial/undivided-share mentions (e.g. "3/4th Undivided share") don't
  // convert to a comparable cents figure, but the raw value is still real
  // data worth showing rather than a blank cell.
  const raw = p.mentions.map((m) => `${m.extentValue || '?'} ${m.extentUnit || ''}`.trim()).filter(Boolean);
  return raw.length ? [...new Set(raw)].join(' / ') : '—';
}

function parcelRow(p) {
  const isReferenceOnly = !p.oldSurveyNumber && !p.newSurveyNumber;
  return `<tr class="${p.extentConsistent ? '' : 'has-problem'}">
    <td>${esc(p.oldSurveyNumber || '—')}</td>
    <td>${esc(p.newSurveyNumber || (isReferenceOnly ? 'Defined by reference to another schedule' : '—'))}</td>
    <td>${esc(p.village || '—')}</td>
    <td>${esc(extentSeen(p))}</td>
    <td class="nowrap">${p.extentConsistent ? badge('Consistent', 'ok') : badge('Differs', 'danger')}</td>
  </tr>`;
}

function figure(label, value, hint, tone = '') {
  return `<div class="figure${tone ? ` is-${tone}` : ''}"><div class="f-label">${esc(label)}</div><div class="f-value">${esc(value)}</div>${hint ? `<div class="f-hint">${esc(hint)}</div>` : ''}</div>`;
}

function matterSection(matter, idx) {
  const s = matter.summary;
  const chain = matter.titleChain;
  const items = attentionItems(matter, idx);
  const id = (name) => `m${idx}-${name}`;
  const nav = [
    ['attention', 'Needs attention', `<span class="n${items.length ? '' : ' zero'}">${items.length}</span>`],
    ['chain', 'Title chain'], ['parties', 'Parties'], ['survey', 'Survey & extent'],
    ['encumbrances', 'Encumbrances'], ['documents', 'Documents'],
  ];
  return `
  <section class="matter" aria-labelledby="${id('title')}">
    <div class="matter-head">
      <h2 id="${id('title')}">${esc(matter.matterId)}</h2>
      <span class="review-meta">${plural(s.documentCount, 'document')} · generated ${esc(new Date(matter.generatedAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }))}</span>
    </div>

    <nav class="subnav" aria-label="${esc(matter.matterId)} sections">
      ${nav.map(([key, label, extra = '']) => `<a href="#${id(key)}">${label}${extra}</a>`).join('')}
    </nav>

    <section class="rsec" id="${id('attention')}">
      <div class="figures">
        ${figure('Title chain', `${chain.earliestYear ?? '?'}–${chain.latestYear ?? '?'}`, plural(chain.chain.length, 'transfer'))}
        ${figure('35-year history', chain.meetsThirtyFiveYearRule ? 'Covered' : 'Not covered', null, chain.meetsThirtyFiveYearRule ? 'ok' : 'bad')}
        ${figure('Items to verify', items.length, items.length ? 'listed below' : 'nothing flagged', items.length ? 'warn' : 'ok')}
        ${figure('Encumbrances', matter.encumbrances.length, matter.encumbrances.length ? 'conditions and charges' : 'none found')}
      </div>
      <p class="figure-line">${[
        plural(s.documentCount, 'document'),
        plural(s.surveyConflictCount, 'survey conflict'),
        `${plural(chain.unverifiedLinks.length, 'earlier deed')} not uploaded`,
        plural(s.possibleDuplicateIdentityCount || 0, 'possible duplicate person', 'possible duplicate people'),
      ].join(' · ')}</p>
      <div class="attention">
        <h3 class="section-title">Needs your attention <span class="count">${items.length}</span></h3>
        ${attentionSection(items)}
      </div>
    </section>

    <section class="rsec" id="${id('chain')}">
      <h3 class="section-title">Title chain <span class="count">earliest to latest</span></h3>
      <div class="table-wrap"><table class="data stack">
        <thead><tr><th>Year</th><th>Document</th><th>Doc. no./year</th><th>Executed by</th><th>In favour of</th><th>Status</th></tr></thead>
        <tbody>${chain.chain.map(chainRow).join('')}</tbody>
      </table></div>
    </section>

    <section class="rsec" id="${id('parties')}">
      <h3 class="section-title">Parties <span class="count">${matter.identities.clusters.length}</span></h3>
      <div class="table-wrap"><table class="data stack">
        <thead><tr><th>Name</th><th>Role</th><th>PAN</th><th>Aadhaar</th><th class="num">Mentions</th></tr></thead>
        <tbody>${matter.identities.clusters.map(identityRow).join('')}</tbody>
      </table></div>
    </section>

    <section class="rsec" id="${id('survey')}">
      <h3 class="section-title">Survey &amp; extent</h3>
      <div class="table-wrap"><table class="data stack">
        <thead><tr><th>Old survey no.</th><th>New survey no.</th><th>Village</th><th>Extent</th><th>Status</th></tr></thead>
        <tbody>${matter.surveyExtent.parcels.map(parcelRow).join('')}</tbody>
      </table></div>
    </section>

    <section class="rsec" id="${id('encumbrances')}">
      <h3 class="section-title">Encumbrances <span class="count">${matter.encumbrances.length}</span></h3>
      ${matter.encumbrances.length ? `<div class="table-wrap"><table class="data stack">
        <thead><tr><th>Type</th><th>Description</th><th>Source</th></tr></thead>
        <tbody>${matter.encumbrances.map((e) => `<tr><td class="nowrap">${esc(sentenceCase(e.type))}</td><td>${esc(e.description)}</td><td>${esc(e.sourceLabel)}</td></tr>`).join('')}</tbody>
      </table></div>` : '<p class="muted">None found.</p>'}
    </section>

    <section class="rsec" id="${id('documents')}">
      <h3 class="section-title">Documents <span class="count">${matter.documents.length}</span></h3>
      <div class="doc-list">${matter.documents.map((doc, i) => documentCard(doc, idx, i)).join('')}</div>
    </section>
  </section>`;
}

const THEME_ICON = `<svg class="sun" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>
      <svg class="moon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5z"/></svg>`;

function generateReviewHtml({ matters, unclassified }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Matter review — Title Scrutiny</title>
<script>try{if(localStorage.getItem('ts-theme')==='dark')document.documentElement.dataset.theme='dark'}catch(e){}</script>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600&display=swap">
<style>
${asset('app.css')}
${asset('review.css')}
</style>
</head>
<body>
<header class="topbar"><div class="topbar-inner">
  <a class="brand" href="/"><span class="brand-mark" aria-hidden="true">TS</span><span class="brand-name">Title Scrutiny</span></a>
  <nav class="topnav" aria-label="Main">
    <a href="/">New review</a>
    <a href="/admin" class="hidden" data-admin-only>Users</a>
  </nav>
  <div class="topbar-end">
    <button class="icon-btn theme-toggle" type="button" data-theme-toggle aria-label="Dark mode" aria-pressed="false">
      ${THEME_ICON}
    </button>
    <span class="who hidden" data-signed-in>Signed in as <b data-me></b></span>
    <button class="signout hidden" type="button" data-signed-in data-logout>Sign out</button>
  </div>
</div></header>

<main class="page review-main">
  <div class="page-head page-head-row">
    <div>
      <h1>Matter review</h1>
      <p class="lede">Read-only draft. Check every item under “Needs your attention” against the source scan before the report is issued. Page references open the scan beside this page.</p>
    </div>
    <div class="btn-row no-print">
      <button class="btn" type="button" data-print>Print review</button>
    </div>
  </div>

  ${unclassified.length ? `<div class="alert alert-warn"><b>${plural(unclassified.length, 'document')} not recognised</b> and left out of this review:<ul class="issue-list">${unclassified.map((u) => `<li>${esc(u.label)} — ${esc(u.classification?.reasoning || 'no matching document type')}</li>`).join('')}</ul></div>` : ''}

  ${matters.map(matterSection).join('')}
</main>

<aside class="scan-panel" id="scanPanel" hidden aria-label="Source scan">
  <div class="scan-head">
    <span class="scan-title" id="scanTitle"></span>
    <a class="btn btn-sm" id="scanNewTab" href="#" target="_blank" rel="noopener">Open in new tab</a>
    <button class="icon-btn" type="button" id="scanClose" aria-label="Close scan">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>
    </button>
  </div>
  <div class="scan-body" id="scanBody"></div>
</aside>

<script>
${asset('shell.js')}
${asset('review.js')}
</script>
</body>
</html>`;
}

module.exports = { generateReviewHtml, attentionItems, fieldLabel };
