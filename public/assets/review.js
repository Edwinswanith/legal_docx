// Matter review page behaviour (inlined by src/pipeline/review-html.js):
// cited scan pages open in a side panel, attention links open the document
// they point at, the section menu tracks the scroll, and printing expands
// everything.
(function () {
  // Phone layout shows each cell with its column name (see review.css).
  document.querySelectorAll('table.stack').forEach((table) => {
    const labels = [...table.querySelectorAll('thead th')].map((th) => th.textContent.trim());
    table.querySelectorAll('tbody tr').forEach((tr) => {
      [...tr.children].forEach((td, i) => td.setAttribute('data-label', labels[i] || ''));
    });
  });

  const panel = document.getElementById('scanPanel');
  const body = document.getElementById('scanBody');
  const title = document.getElementById('scanTitle');
  const newTab = document.getElementById('scanNewTab');

  function openScan(href, label) {
    // A fresh frame each time: changing only the #page of the same PDF
    // doesn't move most built-in viewers.
    body.innerHTML = '';
    const frame = document.createElement('iframe');
    frame.title = label;
    // Fit the page to the panel width and hide the thumbnail strip.
    frame.src = `${href}${href.includes('#') ? '&' : '#'}view=FitH&navpanes=0`;
    body.appendChild(frame);
    title.textContent = label;
    newTab.href = href;
    panel.hidden = false;
    document.body.classList.add('scan-open');
  }

  function closeScan() {
    panel.hidden = true;
    body.innerHTML = '';
    document.body.classList.remove('scan-open');
  }

  document.addEventListener('click', (e) => {
    const link = e.target.closest('a[data-scan]');
    if (link && !(e.metaKey || e.ctrlKey || e.shiftKey)) {
      e.preventDefault();
      openScan(link.getAttribute('href'), link.dataset.scan);
      return;
    }
    const jump = e.target.closest('a[data-open]');
    if (jump) {
      const target = document.getElementById(jump.dataset.open);
      if (target && target.tagName === 'DETAILS') target.open = true;
    }
  });
  document.getElementById('scanClose').addEventListener('click', closeScan);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !panel.hidden) closeScan(); });

  // Highlight, in each matter's menu, the last section whose top has passed
  // under the sticky bars.
  const menus = [...document.querySelectorAll('.subnav')].map((nav) => ({
    links: [...nav.querySelectorAll('a[href^="#"]')],
    sections: [...nav.querySelectorAll('a[href^="#"]')].map((a) => document.getElementById(a.getAttribute('href').slice(1))),
  }));
  let scheduled = false;
  function markActive() {
    scheduled = false;
    menus.forEach(({ links, sections }) => {
      let current = 0;
      sections.forEach((el, i) => { if (el && el.getBoundingClientRect().top <= 140) current = i; });
      links.forEach((a, i) => a.classList.toggle('active', i === current));
    });
  }
  window.addEventListener('scroll', () => {
    if (!scheduled) { scheduled = true; requestAnimationFrame(markActive); }
  }, { passive: true });
  markActive();

  // Print the whole review, not just the expanded parts.
  let reopened = [];
  window.addEventListener('beforeprint', () => {
    reopened = [...document.querySelectorAll('details:not([open])')];
    reopened.forEach((d) => { d.open = true; });
  });
  window.addEventListener('afterprint', () => {
    reopened.forEach((d) => { d.open = false; });
    reopened = [];
  });
  document.querySelectorAll('[data-print]').forEach((btn) => btn.addEventListener('click', () => window.print()));
})();
