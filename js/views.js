// Main views: Start, Dateien, Werkzeuge, Suche, Ich/Einstellungen.
import * as db from './db.js';
import { $, $$, h, esc, toast, formatSize, confirmDialog, debounce, choosePdfs, errorToast, pickFiles, showMenu } from './ui.js';
import { importFiles, emitChange, dropThumb } from './library.js';
import * as Tools from './tools/index.js';
import { applyTheme, currentTheme } from './theme.js';
import { officeMenu, oicon, kindOf, kindInfo, catOf, CATEGORIES, ACCEPT_ALL, openHash, KINDS } from './office/kinds.js';
import { fileRow, fileThumb, setRowTags } from './office/filerow.js';
import { NETWORK_ORIGIN } from './domains.js';
import { isNative } from './platform.js';
import { t } from './i18n/index.js';
import { simpleOn, setSimple, simpleHintHidden, dismissSimpleHint, followSimple, SIMPLE_HOME, CONVERT_MENU, NEW_MENU, SIMPLE_TOOLS, textSizeSeg, bindTextSize } from './simple.js';

const extrasHome = () => import('./extras/home.js');
const extrasRem = () => import('./extras/reminders.js');
const extrasOrg = () => import('./extras/organize.js');
async function loadTags() { try { const t = await (await extrasOrg()).listTags(); setRowTags(t); return t; } catch { return []; } }

const { TOOLS } = Tools;
const viewEl = name => document.getElementById(`view-${name}`);
const lsGet = (k, d) => { try { const v = localStorage.getItem(k); return v === null ? d : v; } catch { return d; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch {} };

export async function openPdfFromDevice() {
  const files = await choosePdfs();
  if (!files.length) return;
  const docs = await importFiles(files, { source: 'Gerät' });
  if (docs.length === 1) location.hash = `#/ansicht/${docs[0].id}`;
}

/** Import any supported files from the device (system picker → also cloud providers on phones). */
// browsers with the File System Access API (desktop Chrome/Edge): keep the file handles, so edits can later be
// written back into the original file (js/origin.js). Everywhere else: the normal file input.
const pickerTypes = () => [{ description: t('PDF, Dokumente, Tabellen, Präsentationen, Bilder'), accept: {
  'application/pdf': ['.pdf'],
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'],
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'],
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': ['.pptx'],
  'text/csv': ['.csv'], 'text/plain': ['.txt'], 'text/markdown': ['.md', '.markdown'],
  'image/*': ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp'],
} }];
async function pickWithHandles() {
  if (isNative() || typeof window.showOpenFilePicker !== 'function') return null;
  // automated test browsers keep the classic <input type=file> (their file-chooser hooks) unless a test asks for it
  try { if (navigator.webdriver && localStorage.getItem('fale-fsa-force') !== '1') return null; } catch { return null; }
  try {
    const handles = await window.showOpenFilePicker({ multiple: true, types: pickerTypes() });
    const { tagFile } = await import('./origin.js');
    return Promise.all(handles.map(async fh => tagFile(await fh.getFile(), { type: 'web', handle: fh, name: fh.name })));
  } catch (e) {
    if (e && e.name === 'AbortError') return [];
    console.warn('showOpenFilePicker', e);
    return null; // e.g. blocked in an iframe → classic input
  }
}

export async function importFromDevice() {
  const files = (await pickWithHandles()) || await pickFiles({ accept: ACCEPT_ALL, multiple: true });
  if (!files.length) return;
  const docs = await importFiles(files, { source: 'Gerät', any: true });
  if (docs.length === 1) location.hash = openHash(docs[0]);
}

function scanTool() { return TOOLS.find(t => t.id === 'scannen') || TOOLS.find(t => t.group === 'scannen'); }

const CREATE = [
  { id: 'doc', label: 'Dokument', icon: 'kdoc', color: KINDS.docx.color, href: '#/vorlagen/dokument' },
  { id: 'sheet', label: 'Tabelle', icon: 'ksheet', color: KINDS.xlsx.color, href: '#/vorlagen/tabelle' },
  { id: 'slides', label: 'Präsentation', icon: 'kslides', color: KINDS.pptx.color, href: '#/neu/praesentation' },
  { id: 'images', label: 'PDF aus Bildern', icon: 'image', color: KINDS.image.color, href: '#/werkzeug/bilder' },
  { id: 'scan', label: 'Scannen', icon: 'camera', color: KINDS.pdf.color, href: null },
];
function createHref(c) { if (c.id !== 'scan') return c.href; const t = scanTool(); return t ? `#/werkzeug/${t.id}` : '#/werkzeug/bilder'; }

export function showNewMenu(anchor) {
  officeMenu(anchor, [
    { label: 'Neues Dokument', icon: 'kdoc', onClick: () => { location.hash = '#/vorlagen/dokument'; } },
    { label: 'Neue Tabelle', icon: 'ksheet', onClick: () => { location.hash = '#/vorlagen/tabelle'; } },
    { label: 'Neue Präsentation', icon: 'kslides', onClick: () => { location.hash = '#/neu/praesentation'; } },
    { label: 'Aus Vorlage …', icon: 'template', onClick: () => { location.hash = '#/vorlagen'; } },
    '-',
    { label: 'PDF aus Bildern', icon: 'image', onClick: () => { location.hash = '#/werkzeug/bilder'; } },
    { label: 'Dokument scannen', icon: 'camera', onClick: () => { location.hash = createHref({ id: 'scan' }); } },
    '-',
    { label: 'Aus Gerät importieren', icon: 'upload', onClick: () => importFromDevice() },
  ], { label: 'Neu erstellen oder importieren' });
}

export function toolClick(tool) {
  if (tool.soon) {
    toast(`„${tool.title}“ ist bald verfügbar.`, 'info', { timeout: 4500 });
    return;
  }
  location.hash = `#/werkzeug/${tool.id}`;
}

function greeting() {
  const hr = new Date().getHours();
  if (hr < 5) return 'Gute Nacht';
  if (hr < 11) return 'Guten Morgen';
  if (hr < 18) return 'Guten Tag';
  return 'Guten Abend';
}

function searchForm(id, placeholder, onSubmit, onInput) {
  const f = h(`<form class="search-box top-search" role="search">${oicon('search')}<label class="sr-only" for="${id}">${esc(placeholder)}</label>
    <input class="input" type="search" id="${id}" placeholder="${esc(placeholder)}" enterkeyhint="search" autocomplete="off"></form>`);
  const input = $('input', f);
  f.addEventListener('submit', e => { e.preventDefault(); onSubmit(input.value.trim()); });
  if (onInput) input.addEventListener('input', debounce(() => onInput(input.value.trim()), 150));
  return f;
}

// ---------------- Start ----------------
const QUICK = ['unterschreiben', 'scannen', 'pdf-word', 'pdf-excel', 'word-pdf', 'zusammenfuegen', 'kommentieren', 'komprimieren', 'bearbeiten', 'bilder', 'seiten', 'passwort', 'exportieren', 'vorlesen'];
let homeTab = lsGet('fale-home-tab', 'recent');

export async function renderHome() {
  const el = viewEl('start');
  if (!el.dataset.built) {
    el.dataset.built = '1';
    el.innerHTML = `
      <div class="hero">
        <div class="hero-art" aria-hidden="true"><span class="ha-sheet s1"></span><span class="ha-sheet s2"></span><span class="ha-sheet s3"><i></i><i></i><i></i><i></i></span><span class="ha-ribbon"></span></div>
        <div class="hero-text">
          <div class="hero-badge">${oicon('shield')} Privat · Offline · Ohne Konto</div>
          <h1><span data-greet>${greeting()}!</span><span data-greet-name hidden></span></h1>
          <p>PDFs, Dokumente, Tabellen und Präsentationen – alles bleibt auf deinem Gerät.</p>
        </div>
        <div class="hero-actions">
          <button class="btn btn-primary" type="button" data-action="open-file">${oicon('upload')} Datei öffnen</button>
          <button class="btn btn-glass" type="button" data-action="new-menu" aria-haspopup="menu">${oicon('plus')} Neu</button>
        </div>
      </div>
      <div data-search></div>
      <div class="simple-hint card" data-simple-hint hidden></div>
      <div class="rem-start" data-rem hidden></div>
      <div class="sm-start" data-smart-start hidden></div>
      <section class="simple-home" data-simple-home hidden aria-labelledby="simple-home-title"></section>
      <h2 class="section-title" data-home="create">Neu erstellen <a class="btn btn-sm btn-ghost" href="#/vorlagen">${oicon('template')} Vorlagen</a></h2>
      <div class="create-row" role="list"></div>
      <div class="quick-chips" role="list" aria-label="Schnell erledigt">
        <a class="lt-chip" role="listitem" href="#/schreiben/kuendigung?art=handy">${oicon('letter')}<span>Kündigung schreiben</span></a>
        <a class="lt-chip" role="listitem" href="#/schreiben/rechnung">${oicon('euro')}<span>Rechnung</span></a>
        <a class="lt-chip" role="listitem" href="#/fristen?neu=1">${oicon('bell')}<span>Frist eintragen</span></a>
        <a class="lt-chip" role="listitem" href="#/schreiben">${oicon('notes')}<span>Alle Briefe</span></a>
        <a class="lt-chip" role="listitem" href="#/tresor">${oicon('vault')}<span>Tresor</span></a>
      </div>
      <div class="continue-box" data-continue hidden></div>
      <h2 class="section-title" data-home="tools">Werkzeuge <a class="btn btn-sm btn-ghost" href="#/werkzeuge">Alle anzeigen</a></h2>
      <div class="tiles" role="list"></div>
      <h2 class="section-title simple-only" data-home="files">Meine Dateien</h2>
      <div class="tabs" role="tablist" aria-label="Dateilisten">
        <button class="tab" role="tab" type="button" data-tab="recent">Zuletzt</button>
        <button class="tab" role="tab" type="button" data-tab="starred">Markiert</button>
        <button class="tab" role="tab" type="button" data-tab="all">Auf diesem Gerät</button>
      </div>
      <div class="doc-list" data-list role="tabpanel"></div>
      <div class="home-more">
        <div class="ai-start" data-ai-start hidden></div>
        <div class="sh-start" data-share-start hidden></div>
      </div>
      <div class="acct-start" data-acct-start hidden></div>
      <div class="free-card card" data-free hidden>
        <span class="free-ic">${oicon('gift')}</span>
        <div><strong>Alles gratis – auch die Pro-Funktionen</strong><span>Kein Abo nötig, keine Werbebanner, kein Konto. Deine Dateien bleiben auf deinem Gerät – die Cloud-KI nutzt du nur, wenn du möchtest.</span></div>
        <button class="icon-btn" type="button" data-free-close aria-label="Hinweis ausblenden">${oicon('close')}</button>
      </div>
      <div class="month-box" data-month hidden></div>`;
    import('./ai/entry.js').then(m => m.renderStartCard($('[data-ai-start]', el))).catch(() => {}); // KI-Assistent card (no network)
    import('./share/entry.js').then(m => m.renderStartCard($('[data-share-start]', el))).catch(() => {}); // Teilen & Übertragen (no network)
    $('[data-search]', el).appendChild(searchForm('home-search', 'Dateien und Inhalte durchsuchen', q => { location.hash = q ? `#/suche?q=${encodeURIComponent(q)}` : '#/suche'; }));
    const free = $('[data-free]', el);
    free.hidden = lsGet('fale-free-card', '') === 'hidden';
    $('[data-free-close]', el).addEventListener('click', () => { free.hidden = true; lsSet('fale-free-card', 'hidden'); });
    const row = $('.create-row', el);
    CREATE.forEach(c => {
      const a = h(`<a class="create-btn" role="listitem" href="${createHref(c)}" data-create="${c.id}"><span class="create-ic" style="--kc:${c.color}">${oicon(c.icon)}</span><span>${esc(c.label)}</span></a>`);
      row.appendChild(a);
    });
    const tiles = $('.tiles', el);
    const quick = QUICK.map(id => TOOLS.find(t => t.id === id)).filter(Boolean);
    TOOLS.forEach(t => { if (!quick.includes(t) && quick.length < 12) quick.push(t); });
    quick.forEach(t => {
      const b = h(`<button class="tile ${t.soon ? 'soon' : ''} g-${t.group || ''}" type="button" role="listitem" data-tool="${t.id}">
        <span class="tile-ic">${oicon(t.icon)}</span><span class="tile-label">${esc(t.tile || t.title)}</span>${t.soon ? '<span class="badge">Bald</span>' : t.pro ? '<span class="badge pro-badge" title="Bei anderen Apps kostenpflichtig">Pro</span>' : ''}</button>`);
      b.addEventListener('click', () => toolClick(t));
      tiles.appendChild(b);
    });
    $$('[data-tab]', el).forEach(b => b.addEventListener('click', () => {
      homeTab = b.dataset.tab;
      lsSet('fale-home-tab', homeTab);
      renderHomeList();
    }));
    renderSimpleHome(el);
    followSimple(el, renderSimpleHome);
  }
  $('[data-greet]', el).textContent = `${greeting()}!`;
  greetName(el);
  await renderHomeList();
  renderHomeExtras(el);
}

// „Einfache Ansicht“ (js/simple.js): large tiles for the essentials + the hint card that offers the mode.
// Built only while needed, so the normal start screen has no duplicate controls.
function renderSimpleHome(el) {
  const on = simpleOn();
  const hint = $('[data-simple-hint]', el);
  hint.hidden = on || simpleHintHidden();
  if (!hint.hidden && !hint.firstChild) {
    hint.append(...h(`<div><span class="simple-hint-ic">${oicon('eye')}</span>
      <div class="simple-hint-text"><strong>Lieber übersichtlich?</strong><span>Die einfache Ansicht zeigt nur das Wichtigste in großen Kacheln. Alle Funktionen bleiben über die Suche erreichbar.</span></div>
      <div class="simple-hint-actions"><button class="btn btn-soft" type="button" data-simple-on>Einfache Ansicht einschalten</button>
      <button class="icon-btn" type="button" data-simple-hint-close aria-label="Hinweis ausblenden">${oicon('close')}</button></div></div>`).childNodes);
    $('[data-simple-on]', hint).addEventListener('click', () => { setSimple(true); toast('Einfache Ansicht ist an.', 'success'); $('#main').scrollTop = 0; });
    $('[data-simple-hint-close]', hint).addEventListener('click', () => { dismissSimpleHint(); hint.hidden = true; });
  }
  const search = $('#home-search', el);
  if (search) search.placeholder = t(on ? 'Dateien suchen' : 'Dateien und Inhalte durchsuchen');
  const box = $('[data-simple-home]', el);
  box.hidden = !on;
  if (!on || box.firstChild) return;
  box.append(...h(`<div><h2 class="section-title" id="simple-home-title">Was möchtest du tun?</h2><div class="s-tiles" role="list"></div>
    <div class="simple-foot"><a class="btn btn-ghost" href="#/werkzeuge" data-simple-tools>${oicon('tools')} Alle Werkzeuge</a>
    <button class="btn btn-ghost" type="button" data-simple-off>${oicon('sliders')} Alle Funktionen zeigen</button></div></div>`).childNodes);
  const grid = $('.s-tiles', box);
  SIMPLE_HOME.forEach(c => {
    const inner = `<span class="tile-ic">${oicon(c.icon)}</span><span class="s-tile-text"><strong>${esc(c.label)}</strong><span>${esc(c.sub)}</span></span>`;
    const tile = c.href
      ? h(`<a class="s-tile g-${c.group}" role="listitem" href="${c.href}" data-simple="${c.id}">${inner}</a>`)
      : h(`<button class="s-tile g-${c.group}" type="button" role="listitem" data-simple="${c.id}"${c.menu ? ' aria-haspopup="menu"' : ''}>${inner}</button>`);
    if (c.action === 'open-file') tile.addEventListener('click', () => importFromDevice());
    const menu = list => list.map(m => ({ label: m.label, icon: m.icon, onClick: () => { location.hash = m.href; } }));
    if (c.menu === 'new') tile.addEventListener('click', () => officeMenu(tile, menu(NEW_MENU), { label: 'Neu erstellen' }));
    if (c.menu === 'convert') tile.addEventListener('click', () => officeMenu(tile, menu(CONVERT_MENU), { label: 'In PDF umwandeln' }));
    grid.appendChild(tile);
  });
  $('[data-simple-off]', box).addEventListener('click', () => { setSimple(false); toast('Alle Funktionen werden wieder angezeigt.', 'success'); });
}

// personal greeting: "Guten Tag, Alex!" when a first name is saved in „Meine Daten" (on this device only)
function greetName(el) {
  import('./extras/profile.js').then(m => m.getProfile()).then(p => {
    const name = p && p.vorname ? String(p.vorname).trim().split(/\s+/)[0] : '';
    const g = $('[data-greet]', el), n = $('[data-greet-name]', el);
    if (!g || !n) return;
    g.textContent = name ? greeting() : `${greeting()}!`;
    n.textContent = name ? `, ${name}!` : '';
    n.hidden = !name;
  }).catch(() => {});
}

async function renderHomeExtras(el) {
  try { await (await extrasRem()).renderStartCards($('[data-rem]', el)); } catch (e) { console.warn(e); }
  try { await (await import('./smart/entry.js')).renderStartCard($('[data-smart-start]', el)); } catch (e) { console.warn(e); } // Assistenten (local only)
  try { await (await extrasHome()).renderContinue($('[data-continue]', el)); } catch (e) { console.warn(e); }
  try { (await extrasHome()).renderMonthCard($('[data-month]', el)); } catch (e) { console.warn(e); }
  // optional FaLe-Konto: one dismissible hint once there are ≥ 5 files (never when signed in or dismissed)
  if (lsGet('fale-acct-hint', '') !== 'hidden' && lsGet('fale-acct', '') !== '1') {
    try { (await import('./account/entry.js')).renderStartHint($('[data-acct-start]', el), (await db.listFiles()).length); } catch (e) { console.warn(e); }
  } else { const b = $('[data-acct-start]', el); if (b) b.hidden = true; }
}

async function renderHomeList() {
  const el = viewEl('start');
  await loadTags();
  const docs = await db.listFiles();
  const starred = docs.filter(d => d.starred);
  const counts = { recent: Math.min(docs.length, 30), starred: starred.length, all: docs.length };
  $$('[data-tab]', el).forEach(b => {
    b.setAttribute('aria-selected', String(b.dataset.tab === homeTab));
    const label = { recent: 'Zuletzt', starred: 'Markiert', all: 'Auf diesem Gerät' }[b.dataset.tab];
    b.innerHTML = `${label}<span class="count">${counts[b.dataset.tab] || ''}</span>`;
  });
  let list = docs;
  if (homeTab === 'recent') list = docs.slice(0, 30);
  if (homeTab === 'starred') list = starred;
  if (homeTab === 'all') list = [...docs].sort((a, b) => a.name.localeCompare(b.name, 'de', { numeric: true }));
  const box = $('[data-list]', el);
  box.innerHTML = '';
  if (!list.length) {
    const empty = homeTab === 'starred'
      ? h(`<div class="empty" style="grid-column:1/-1"><div class="empty-art">${oicon('star')}</div><h3>Noch nichts markiert</h3><p>Tippe auf den Stern neben einer Datei, um sie hier zu sammeln.</p></div>`)
      : h(`<div class="empty" style="grid-column:1/-1"><div class="empty-art">${oicon('file')}</div><h3>Noch keine Dateien</h3>
          <p>Öffne eine PDF, ein Word-Dokument, eine Tabelle oder Präsentation – oder ziehe sie hierher. Deine Dateien werden nur auf diesem Gerät gespeichert.</p>
          <button class="btn btn-primary" type="button" data-action="open-file">${oicon('upload')} Datei öffnen</button></div>`);
    box.appendChild(empty);
    return;
  }
  list.forEach(d => box.appendChild(fileRow(d)));
}

// ---------------- Werkzeuge ----------------
const GROUP_FALLBACK = { unterschreiben: 'bearbeiten', seiten: 'organisieren', zusammenfuegen: 'organisieren', bilder: 'konvertieren', komprimieren: 'organisieren', exportieren: 'konvertieren', vorlesen: 'lesen', passwort: 'sicherheit' };
const GROUPS = Tools.GROUPS || [
  { id: 'bearbeiten', title: 'Bearbeiten & Unterschreiben' }, { id: 'konvertieren', title: 'Konvertieren' }, { id: 'organisieren', title: 'Seiten & Dateien' },
  { id: 'scannen', title: 'Scannen' }, { id: 'sicherheit', title: 'Schutz & Sicherheit' }, { id: 'lesen', title: 'Lesen' },
];

function toolCard(t) {
  const b = h(`<button class="tool-card" type="button" data-tool="${t.id}"><span class="tile-ic">${oicon(t.icon)}</span>
    <span class="tc-text"><h3>${esc(t.title)}</h3><p>${esc(t.desc)}</p>${t.soon ? '<span class="badge inline-badge">Bald verfügbar</span>' : t.pro ? '<span class="badge pro-badge inline-badge" title="Bei anderen Apps nur im Abo">Pro · gratis</span>' : ''}</span></button>`);
  b.addEventListener('click', () => toolClick(t));
  return b;
}

export function renderTools(initialQ = null) {
  const el = viewEl('werkzeuge');
  if (!el.dataset.built) {
    el.dataset.built = '1';
    el.innerHTML = `<div class="page-head"><div><h1 class="page-title">Werkzeuge</h1><p class="page-sub">Alle Werkzeuge arbeiten lokal – nichts wird hochgeladen, außer du nutzt bewusst die Cloud-KI. Auch die Pro-Funktionen sind kostenlos.</p></div></div>
      <div data-search></div>
      <section class="simple-sec" data-section="simple" data-simple-tools hidden></section>
      <section class="tool-section" data-section="office"><h2 class="section-title">Office</h2><div class="tool-grid office-grid"></div></section>
      <section class="tool-section" data-section="alltag"><h2 class="section-title">Alltag &amp; Organisation</h2><div class="tool-grid alltag-grid"></div></section>
      <section class="tool-section" data-section="assistenten" data-smart-section hidden></section>
      <section class="tool-section" data-section="teilen" data-share-section hidden></section>
      <section class="tool-section" data-section="ki" data-ai-section hidden></section>
      <div data-groups></div>
      <p class="panel-empty" data-noresult hidden>Kein Werkzeug gefunden.</p>`;
    const officeCards = [
      { id: 'o-doc', title: 'Neues Dokument', desc: 'Leer oder mit Vorlage: Brief, Lebenslauf, Rechnung, Hausarbeit … – als .docx oder PDF.', icon: 'kdoc', href: '#/vorlagen/dokument' },
      { id: 'o-sheet', title: 'Neue Tabelle', desc: 'Leer oder mit Vorlage: Haushaltsbuch, Urlaubsplaner, Rechnungen … – als .xlsx.', icon: 'ksheet', href: '#/vorlagen/tabelle' },
      { id: 'o-slides', title: 'Neue Präsentation', desc: 'Folien mit eigenen Designs erstellen und präsentieren – als .pptx.', icon: 'kslides', href: '#/neu/praesentation' },
      { id: 'o-tpl', title: 'Vorlagen', desc: 'Lebenslauf, Anschreiben, Brief nach DIN 5008, Rechnung und mehr.', icon: 'template', href: '#/vorlagen' },
    ];
    const og = $('.office-grid', el);
    officeCards.forEach(c => {
      const a = h(`<a class="tool-card" href="${c.href}" data-tool="${c.id}"><span class="tile-ic office-ic">${oicon(c.icon)}</span><span><h3>${esc(c.title)}</h3><p>${esc(c.desc)}</p></span></a>`);
      og.appendChild(a);
    });
    const alltag = [
      { id: 'x-schreiben', title: 'Schreiben & Vorlagen', desc: 'Kündigung, Widerruf, Rechnung, Vollmacht, Bewerbung – in einer Minute fertig.', icon: 'letter', href: '#/schreiben' },
      { id: 'x-kuendigung', title: 'Kündigung schreiben', desc: 'Handy, Fitnessstudio, Strom, Versicherung, Wohnung und mehr.', icon: 'notes', href: '#/schreiben/kuendigung?art=handy' },
      { id: 'x-fristen', title: 'Fristen & Erinnerungen', desc: 'Ablaufdaten und Kündigungsfristen rechtzeitig im Blick.', icon: 'bell', href: '#/fristen' },
      { id: 'x-tresor', title: 'Privater Tresor', desc: 'Ausweis-Scans und Verträge verschlüsselt mit eigener PIN.', icon: 'vault', href: '#/tresor' },
      { id: 'x-gliederung', title: 'Folien aus Gliederung', desc: 'Stichpunkte einfügen – fertige Präsentation mit Design erhalten.', icon: 'kslides', href: '#/gliederung' },
      { id: 'x-duplikate', title: 'Duplikate finden', desc: 'Identische Dateien aufspüren und Speicher freigeben.', icon: 'duplicate', href: '#/duplikate' },
    ];
    const ag = $('.alltag-grid', el);
    alltag.forEach(c => ag.appendChild(h(`<a class="tool-card" href="${c.href}" data-tool="${c.id}"><span class="tile-ic alltag-ic">${oicon(c.icon)}</span><span class="tc-text"><h3>${esc(c.title)}</h3><p>${esc(c.desc)}</p></span></a>`)));
    const groupsBox = $('[data-groups]', el);
    const byGroup = new Map(GROUPS.map(g => [g.id, []]));
    TOOLS.forEach(t => {
      const g = t.group || GROUP_FALLBACK[t.id] || 'bearbeiten';
      if (!byGroup.has(g)) byGroup.set(g, []);
      byGroup.get(g).push(t);
    });
    for (const [g, list] of byGroup) {
      if (!list.length) continue;
      const title = (GROUPS.find(x => x.id === g) || { title: g }).title;
      const sec = h(`<section class="tool-section" data-section="${g}"><h2 class="section-title">${esc(title)}</h2><div class="tool-grid"></div></section>`);
      list.forEach(t => $('.tool-grid', sec).appendChild(toolCard(t)));
      groupsBox.appendChild(sec);
    }
    const filter = q => {
      const n = q.toLocaleLowerCase('de');
      el.classList.toggle('st-q', !!n); // simple mode: a search always looks through every tool
      let any = false;
      $$('.tool-section', el).forEach(sec => {
        let vis = 0;
        $$('.tool-card', sec).forEach(c => { const m = !n || c.textContent.toLocaleLowerCase('de').includes(n) || (c.dataset.kw || '').includes(n); c.hidden = !m; if (m) vis++; });
        sec.hidden = !vis;
        if (vis) any = true;
      });
      $('[data-noresult]', el).hidden = any;
    };
    const form = searchForm('tool-search', 'Werkzeug suchen, z. B. „Word“ oder „Passwort“', filter, filter);
    $('[data-search]', el).appendChild(form);
    el._filter = filter;
    import('./ai/entry.js').then(m => m.renderToolSection($('[data-ai-section]', el))).catch(() => {}); // KI-Assistent section
    import('./share/entry.js').then(m => m.renderToolSection($('[data-share-section]', el))).catch(() => {}); // Teilen & Unterschreiben
    import('./smart/entry.js').then(m => m.renderToolSection($('[data-smart-section]', el))).catch(() => {}); // Assistenten
    // FaleNetwork web tools (opened in a frame, js/webtools/host.js): into the matching groups + own sections
    import('./webtools/list.js').then(m => {
      m.renderWebTools(el);
      const q = $('#tool-search', el) && $('#tool-search', el).value;
      if (q) filter(q);
      updateSimpleCount(el);
    }).catch(e => console.warn('web tools', e));
    renderSimpleTools(el);
    followSimple(el, renderSimpleTools);
  }
  if (initialQ != null) { $('#tool-search', el).value = initialQ; el._filter(initialQ); }
}

// „Einfache Ansicht“: a short list first; „Alle Werkzeuge anzeigen“ expands to every section (CSS: html.simple)
let simpleToolsAll = false;
function renderSimpleTools(el) {
  const sec = $('[data-simple-tools]', el);
  const on = simpleOn();
  const search = $('#tool-search', el);
  if (search) search.placeholder = t(on ? 'Werkzeug suchen' : 'Werkzeug suchen, z. B. „Word“ oder „Passwort“');
  sec.hidden = !on;
  el.classList.toggle('st-all', on && simpleToolsAll);
  if (!on || sec.firstChild) { updateSimpleCount(el); return; }
  sec.append(...h(`<div><h2 class="section-title">Die wichtigsten Werkzeuge</h2><div class="tool-grid simple-grid"></div>
    <div class="simple-more"><button class="btn btn-primary" type="button" data-simple-all aria-expanded="false"><span data-simple-all-label>Alle Werkzeuge anzeigen</span><span class="count" data-simple-count></span></button>
    <span class="muted small simple-more-note">Oder oben suchen – die Suche findet jedes Werkzeug.</span></div></div>`).childNodes);
  const grid = $('.simple-grid', sec);
  SIMPLE_TOOLS.map(id => TOOLS.find(x => x.id === id)).filter(Boolean).forEach(tool => {
    const c = toolCard(tool);
    c.classList.add(`g-${tool.group || 'bearbeiten'}`);
    grid.appendChild(c);
  });
  $('[data-simple-all]', sec).addEventListener('click', () => {
    simpleToolsAll = !simpleToolsAll;
    el.classList.toggle('st-all', simpleToolsAll);
    updateSimpleCount(el);
  });
  updateSimpleCount(el);
}
function updateSimpleCount(el) {
  const btn = $('[data-simple-all]', el);
  if (!btn) return;
  const all = simpleToolsAll && simpleOn();
  btn.setAttribute('aria-expanded', String(all));
  $('[data-simple-all-label]', btn).textContent = all ? 'Weniger anzeigen' : 'Alle Werkzeuge anzeigen';
  const n = $$('.tool-section:not([data-section="simple"]):not([data-section="ki"]) .tool-card', el).length;
  $('[data-simple-count]', btn).textContent = all || !n ? '' : String(n);
}

// ---------------- Dateien ----------------
let filesSort = lsGet('fale-files-sort', 'date');
let filesCat = 'all';
let filesQuery = '';
let filesFolder = null;
let filesTag = null;
let filesSmart = null; // Assistenten-Filter (#/dateien?smart=briefe|offen|belege)
export async function renderFiles(params) {
  const el = viewEl('dateien');
  if (params && params.get('typ')) {
    const t = params.get('typ');
    filesCat = CATEGORIES.some(c => c.id === t) ? t : 'all';
  }
  if (params) { filesFolder = params.get('ordner') || null; filesTag = params.get('tag') || null; filesSmart = params.get('smart') || null; }
  if (!el.dataset.built) {
    el.dataset.built = '1';
    el.innerHTML = `<div class="page-head"><div><h1 class="page-title">Dateien</h1><p class="page-sub">Alles, was du auf diesem Gerät gespeichert hast.</p></div>
        <div class="head-actions"><button class="btn btn-ghost" type="button" data-action="new-menu">${oicon('plus')} Neu</button>
        <button class="btn btn-primary" type="button" data-action="open-file">${oicon('upload')} Aus Gerät importieren</button></div></div>
      <div data-search></div>
      <nav class="folder-crumbs" data-crumbs aria-label="Ordnerpfad" hidden></nav>
      <div class="folder-row" data-folders role="list" aria-label="Ordner"></div>
      <div class="tag-filter" data-tagchips role="group" aria-label="Nach Tag filtern" hidden></div>
      <div class="sm-file-chips" data-smartchips role="group" aria-label="Assistenten-Filter" hidden></div>
      <div class="files-bar">
        <div class="chips" role="tablist" aria-label="Dateityp"></div>
        <label class="sr-only" for="files-sort">Sortieren nach</label>
        <select class="select sort-select" id="files-sort">
          <option value="date">Zuletzt geöffnet</option><option value="name">Name</option><option value="size">Größe</option><option value="type">Typ</option>
        </select>
      </div>
      <div class="doc-list" data-files></div>
      <div class="dropzone desktop-only" data-dropzone>${oicon('upload')}<span><strong>Dateien hierher ziehen</strong> – PDF, Word, Excel, PowerPoint, CSV, Text und Bilder</span></div>
      <h2 class="section-title">Aufräumen &amp; schützen</h2>
      <div class="manage-grid" data-manage>
        <a class="action-card" href="#/papierkorb" data-m="trash"><span class="tile-ic">${oicon('trash')}</span><span><strong>Papierkorb</strong><span class="muted small" data-trashcount>Gelöschtes 30 Tage zurückholen</span></span></a>
        <a class="action-card" href="#/duplikate"><span class="tile-ic">${oicon('duplicate')}</span><span><strong>Duplikate finden</strong><span class="muted small">Identische Dateien aufspüren</span></span></a>
        <a class="action-card" href="#/tresor"><span class="tile-ic">${oicon('vault')}</span><span><strong>Privater Tresor</strong><span class="muted small">Verschlüsselt mit eigener PIN</span></span></a>
        <a class="action-card" href="#/fristen"><span class="tile-ic">${oicon('bell')}</span><span><strong>Fristen</strong><span class="muted small">Ablaufdaten im Blick</span></span></a>
      </div>
      <div class="card cloud-card">
        <span class="tile-ic">${oicon('cloud')}</span>
        <div><strong>Google Drive, OneDrive, Dropbox &amp; Co.</strong>
        <p>Auf dem Handy erscheinen diese Dienste direkt in der Dateiauswahl deines Systems: Tippe auf „Aus Gerät importieren“ und wähle links im Menü den Dienst aus. FaLe meldet sich bei keinem Dienst an – die Datei wird nur auf dieses Gerät kopiert. Zum Zurückspeichern nutze „Teilen“ und wähle die App des Dienstes.</p></div>
      </div>
      <h2 class="section-title">Speicher auf diesem Gerät</h2>
      <div class="card card-pad" data-storage></div>`;
    $('[data-search]', el).appendChild(searchForm('files-search', 'Dateien nach Namen filtern', q => { filesQuery = q; renderFiles(); }, q => { filesQuery = q; renderFiles(); }));
    const sortSel = $('#files-sort', el);
    sortSel.value = filesSort;
    sortSel.addEventListener('change', e => { filesSort = e.target.value; lsSet('fale-files-sort', filesSort); renderFiles(); });
  }
  const [docs, tags, folders] = await Promise.all([db.listFiles(), loadTags(), extrasOrg().then(m => m.listFolders()).catch(() => [])]);
  if (filesFolder && !folders.some(f => f.id === filesFolder)) filesFolder = null;
  if (filesTag && !tags.some(t => t.id === filesTag)) filesTag = null;
  const known = new Set(folders.map(f => f.id));
  const inFolder = d => (filesFolder ? d.folder === filesFolder : !d.folder || !known.has(d.folder));
  const searching = !!(filesQuery || filesTag || filesSmart);
  const scope = searching ? docs : docs.filter(inFolder);
  renderFolders(el, folders, docs, searching);
  renderTagChips(el, tags, docs);
  import('./smart/entry.js').then(m => m.renderFileChips($('[data-smartchips]', el), filesSmart)).catch(() => {});
  // chips with counts
  const chips = $('.chips', el);
  chips.innerHTML = '';
  CATEGORIES.forEach(c => {
    const n = c.id === 'all' ? scope.length : scope.filter(d => catOf(d) === c.id).length;
    const b = h(`<button class="chip" type="button" role="tab" aria-selected="${filesCat === c.id}" data-cat="${c.id}">${esc(c.label)}${n ? `<span class="count">${n}</span>` : ''}</button>`);
    b.addEventListener('click', () => { filesCat = c.id; renderFiles(); });
    chips.appendChild(b);
  });
  let list = scope.filter(d => filesCat === 'all' || catOf(d) === filesCat);
  if (filesTag) list = list.filter(d => (d.tags || []).includes(filesTag));
  if (filesSmart) { const ids = await import('./smart/entry.js').then(m => m.smartDocIds(filesSmart)).catch(() => null); if (ids) list = list.filter(d => ids.has(d.id)); }
  if (filesQuery) { const q = filesQuery.toLocaleLowerCase('de'); list = list.filter(d => d.name.toLocaleLowerCase('de').includes(q)); }
  if (filesSort === 'name') list.sort((a, b) => a.name.localeCompare(b.name, 'de', { numeric: true }));
  if (filesSort === 'size') list.sort((a, b) => b.size - a.size);
  if (filesSort === 'type') list.sort((a, b) => kindInfo(a).label.localeCompare(kindInfo(b).label, 'de') || a.name.localeCompare(b.name, 'de'));
  const box = $('[data-files]', el);
  box.innerHTML = '';
  if (!list.length) {
    const inF = filesFolder && !searching;
    box.appendChild(h(`<div class="empty" style="grid-column:1/-1"><div class="empty-art">${oicon('folder')}</div><h3>${inF ? 'Dieser Ordner ist leer' : docs.length ? 'Keine passenden Dateien' : 'Noch keine Dateien'}</h3>
      <p>${inF ? 'Verschiebe Dateien über ihr Menü (⋮ → „In Ordner verschieben“) hierher.' : docs.length ? 'Ändere den Filter oder die Suche.' : 'Importiere Dateien von deinem Gerät oder erstelle ein neues Dokument.'}</p></div>`));
  }
  list.forEach(d => box.appendChild(fileRow(d)));
  renderStorage($('[data-storage]', el), docs);
  db.listTrash().then(t => { const c = $('[data-trashcount]', el); if (c) c.textContent = t.length ? `${t.length} Datei${t.length === 1 ? '' : 'en'} · 30 Tage wiederherstellbar` : 'Gelöschtes 30 Tage zurückholen'; }).catch(() => {});
}

function renderFolders(el, folders, docs, searching) {
  const row = $('[data-folders]', el), crumbs = $('[data-crumbs]', el);
  row.innerHTML = '';
  const cur = filesFolder ? folders.find(f => f.id === filesFolder) : null;
  crumbs.hidden = !cur;
  if (cur) {
    const parent = cur.parent ? folders.find(f => f.id === cur.parent) : null;
    crumbs.innerHTML = `<a href="#/dateien">${oicon('home')} Alle Dateien</a>${parent ? ` <span aria-hidden="true">›</span> <a href="#/dateien?ordner=${esc(parent.id)}">${esc(parent.name)}</a>` : ''} <span aria-hidden="true">›</span> <strong aria-current="page">${esc(cur.name)}</strong>`;
  }
  if (searching) { row.hidden = true; return; }
  row.hidden = false;
  const subs = folders.filter(f => (f.parent || null) === (filesFolder || null)).sort((a, b) => a.name.localeCompare(b.name, 'de', { numeric: true }));
  const countIn = id => { const ids = new Set([id, ...folders.filter(f => f.parent === id).map(f => f.id)]); return docs.filter(d => ids.has(d.folder)).length; };
  subs.forEach(f => {
    const n = countIn(f.id);
    const t = h(`<div class="folder-tile" role="listitem" data-folder="${esc(f.id)}"><a class="ft-open" href="#/dateien?ordner=${esc(f.id)}"><span class="ft-ic">${oicon('folder')}</span><span class="ft-txt"><strong>${esc(f.name)}</strong><span>${n === 1 ? '1 Datei' : `${n} Dateien`}</span></span></a>
      <button class="icon-btn" type="button" aria-label="Aktionen für Ordner ${esc(f.name)}">${oicon('more')}</button></div>`);
    $('button', t).addEventListener('click', e => folderMenu(e.currentTarget, f));
    row.appendChild(t);
  });
  if (!cur || !cur.parent) {
    const add = h(`<button class="folder-tile add" type="button" data-newfolder>${oicon('folderPlus')}<span>${cur ? 'Unterordner' : 'Neuer Ordner'}</span></button>`);
    add.addEventListener('click', async () => {
      const name = await promptDialogLazy(cur ? 'Neuer Unterordner' : 'Neuer Ordner');
      if (!name) return;
      try { await (await extrasOrg()).createFolder(name, filesFolder); toast('Ordner angelegt', 'success'); } catch (e) { errorToast(e, 'Ordner konnte nicht angelegt werden.'); }
    });
    row.appendChild(add);
  }
}
async function promptDialogLazy(title, value = '') {
  const { promptDialog } = await import('./ui.js');
  const v = await promptDialog(title, 'Name', value, { okLabel: 'Speichern' });
  return v && v.trim() ? v.trim() : null;
}
function folderMenu(anchor, f) {
  showMenu(anchor, [
    { label: 'Umbenennen', icon: 'edit', onClick: async () => { const n = await promptDialogLazy('Ordner umbenennen', f.name); if (n) (await extrasOrg()).renameFolder(f.id, n); } },
    { label: 'Ordner löschen', icon: 'trash', danger: true, onClick: async () => {
      if (!await confirmDialog('Ordner löschen?', `„${f.name}“ wird entfernt. Die Dateien darin bleiben erhalten und wandern eine Ebene nach oben.`, { okLabel: 'Ordner löschen', danger: true })) return;
      await (await extrasOrg()).deleteFolder(f.id);
      if (filesFolder === f.id) location.hash = '#/dateien';
      toast('Ordner gelöscht');
    } },
  ], { label: `Ordner ${f.name}` });
}
function renderTagChips(el, tags, docs) {
  const box = $('[data-tagchips]', el);
  box.innerHTML = '';
  const used = tags.filter(t => docs.some(d => (d.tags || []).includes(t.id)));
  box.hidden = !used.length;
  used.forEach(t => {
    const on = filesTag === t.id;
    const b = h(`<button class="tchip" type="button" style="--tc:${t.color}" aria-pressed="${on}">${esc(t.name)}</button>`);
    b.addEventListener('click', () => { location.hash = on ? (filesFolder ? `#/dateien?ordner=${filesFolder}` : '#/dateien') : `#/dateien?tag=${t.id}`; });
    box.appendChild(b);
  });
}

async function renderStorage(box, docs) {
  const total = docs.reduce((s, d) => s + (d.size || 0), 0);
  let usage = null, quota = null, persisted = false;
  try {
    if (navigator.storage && navigator.storage.estimate) ({ usage, quota } = await navigator.storage.estimate());
    if (navigator.storage && navigator.storage.persisted) persisted = await navigator.storage.persisted();
  } catch {}
  const pct = usage && quota ? Math.max(0.5, Math.min(100, (usage / quota) * 100)) : 0;
  const byCat = CATEGORIES.slice(1).map(c => ({ c, n: docs.filter(d => catOf(d) === c.id).length })).filter(x => x.n);
  box.innerHTML = `
    <div class="stat-row"><span><b>${docs.length}</b> Datei${docs.length === 1 ? '' : 'en'}</span><span><b>${formatSize(total)}</b> Dateigröße</span>
      ${usage != null ? `<span><b>${formatSize(usage)}</b> von ${formatSize(quota)} belegt</span>` : ''}</div>
    ${usage != null ? `<div class="meter" role="progressbar" aria-label="Speichernutzung" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct.toFixed(1)}"><span style="width:${pct}%"></span></div>` : ''}
    ${byCat.length ? `<div class="stat-row small">${byCat.map(x => `<span>${esc(x.c.label)}: <b>${x.n}</b></span>`).join('')}</div>` : ''}
    <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;margin-top:10px">
      <span class="muted small" data-persist-state>${persisted ? '✓ Speicher ist dauerhaft – der Browser löscht deine Dateien nicht automatisch.' : 'Der Browser darf Daten bei Speichermangel entfernen.'}</span>
      ${persisted ? '' : `<button class="btn btn-soft btn-sm" type="button" data-persist>${oicon('shield')} Speicher dauerhaft machen</button>`}
    </div>`;
  const pb = $('[data-persist]', box);
  if (pb) pb.addEventListener('click', requestPersist);
}

export async function requestPersist() {
  try {
    if (!navigator.storage || !navigator.storage.persist) { toast('Dieser Browser unterstützt dauerhaften Speicher nicht.', 'error'); return; }
    const ok = await navigator.storage.persist();
    toast(ok ? 'Speicher ist jetzt dauerhaft.' : 'Der Browser hat die Anfrage abgelehnt. Installiere die App, um die Chance zu erhöhen.', ok ? 'success' : 'info', { timeout: 5000 });
    emitChange();
  } catch (e) { errorToast(e, 'Anfrage fehlgeschlagen.'); }
}

export async function deleteAllConfirm() {
  const ok = await confirmDialog('Alles löschen?', 'Alle Dateien, Texte und gespeicherten Unterschriften werden unwiderruflich von diesem Gerät entfernt.', { okLabel: 'Alles löschen', danger: true });
  if (!ok) return;
  const docs = await db.listFiles();
  docs.forEach(d => dropThumb(d.id));
  await db.clearAll({ keepSettings: true });
  toast('Alle Daten wurden gelöscht.', 'success');
  emitChange();
}

// ---------------- Suche ----------------
function norm(s) {
  // lower-case + strip diacritics, keeping a map to original indices
  const out = [];
  const map = [];
  for (let i = 0; i < s.length; i++) {
    const n = s[i].normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
    for (const ch of n) { out.push(ch); map.push(i); }
  }
  return { text: out.join(''), map };
}

let searchSeq = 0;
export function renderSearch(initialQuery) {
  const el = viewEl('suche');
  if (!el.dataset.built) {
    el.dataset.built = '1';
    el.innerHTML = `<div class="page-head"><div><h1 class="page-title">Suche</h1><p class="page-sub">Durchsucht Namen und Inhalt aller Dateien auf diesem Gerät – PDFs, Dokumente, Tabellen und Präsentationen.</p></div></div>
      <div class="search-box">${oicon('search')}<input class="input" type="search" id="global-search" placeholder="Wonach suchst du?" aria-label="In allen Dateien suchen" enterkeyhint="search" autocomplete="off"></div>
      <div class="search-summary" aria-live="polite"></div>
      <div class="sm-search-answer" data-smart-answer hidden></div>
      <div class="search-results"></div>`;
    const input = $('#global-search', el);
    input.addEventListener('input', debounce(() => runSearch(input.value), 220));
    input.addEventListener('keydown', e => { if (e.key === 'Enter') runSearch(input.value); });
  }
  const input = $('#global-search', el);
  if (initialQuery != null && initialQuery !== input.value) input.value = initialQuery;
  if (input.value) runSearch(input.value); else renderSearchEmpty();
  setTimeout(() => { if (!window.matchMedia('(max-width: 720px)').matches || initialQuery) input.focus(); }, 60);
}

async function renderSearchEmpty() {
  const el = viewEl('suche');
  const docs = await db.listFiles();
  const pending = docs.filter(d => !d.textReady).length;
  $('.search-summary', el).textContent = docs.length ? `${docs.length} Datei${docs.length === 1 ? '' : 'en'} durchsuchbar${pending ? ` (${pending} wird noch indexiert)` : ''}.` : 'Noch keine Dateien vorhanden.';
  $('.search-results', el).innerHTML = '';
  const ans = $('[data-smart-answer]', el);
  if (ans) { ans.replaceChildren(); ans.hidden = true; }
}

function hitLabel(doc, idx) {
  const k = kindOf(doc);
  if (k === 'pdf') return `S. ${idx + 1}`;
  if (k === 'xlsx' || k === 'csv') return `Blatt ${idx + 1}`;
  if (k === 'pptx') return `Folie ${idx + 1}`;
  return kindInfo(doc).short;
}

async function runSearch(raw) {
  const el = viewEl('suche');
  const query = raw.trim();
  const seq = ++searchSeq;
  if (query.length < 2) { renderSearchEmpty(); return; }
  import('./smart/entry.js').then(m => (seq === searchSeq ? m.renderSearchAnswer($('[data-smart-answer]', el), query) : null)).catch(() => {}); // Dokumenten-Gedächtnis (offline)
  const nq = norm(query).text;
  const [docs, texts] = await Promise.all([db.listFiles(), db.allTexts()]);
  if (seq !== searchSeq) return;
  const byId = new Map(docs.map(d => [d.id, d]));
  const textIds = new Set(texts.map(t => t.id));
  const groups = [];
  let total = 0;
  for (const t of texts) {
    const doc = byId.get(t.id);
    if (!doc) continue;
    const hits = [];
    let count = 0;
    (t.pages || []).forEach((pageTextRaw, pi) => {
      if (!pageTextRaw) return;
      const { text, map } = norm(pageTextRaw);
      let idx = text.indexOf(nq);
      while (idx !== -1) {
        count++;
        if (hits.length < 6) {
          const s = map[idx];
          const e = (map[idx + nq.length - 1] ?? s) + 1;
          const a = Math.max(0, s - 60), b = Math.min(pageTextRaw.length, e + 80);
          hits.push({ page: pi + 1, label: hitLabel(doc, pi), pre: (a > 0 ? '…' : '') + pageTextRaw.slice(a, s), match: pageTextRaw.slice(s, e), post: pageTextRaw.slice(e, b) + (b < pageTextRaw.length ? '…' : '') });
        }
        idx = text.indexOf(nq, idx + nq.length);
      }
    });
    if (count) { groups.push({ doc, hits, count }); total += count; }
  }
  // file names (also for files without text, e.g. images)
  const nameHits = docs.filter(d => norm(d.name).text.includes(nq) && !groups.some(g => g.doc.id === d.id));
  groups.sort((a, b) => b.count - a.count);
  const summary = total || nameHits.length ? `${total} Treffer in ${groups.length} Datei${groups.length === 1 ? '' : 'en'}${nameHits.length ? ` · ${nameHits.length} passende${nameHits.length === 1 ? 'r' : ''} Dateiname${nameHits.length === 1 ? '' : 'n'}` : ''}` : `Keine Treffer für „${query}“.`;
  $('.search-summary', el).textContent = summary;
  const box = $('.search-results', el);
  box.innerHTML = '';
  const openAt = (doc, page) => {
    if (kindOf(doc) === 'pdf') location.hash = `#/ansicht/${doc.id}?seite=${page}&q=${encodeURIComponent(query)}`;
    else location.hash = `${openHash(doc)}?q=${encodeURIComponent(query)}`;
  };
  groups.forEach(g => {
    const card = h(`<section class="card result-group"><div class="result-head">${fileThumb(g.doc)}<div><strong>${esc(g.doc.name)}</strong>
      <span class="muted small">${g.count} Treffer</span></div></div></section>`);
    g.hits.forEach(hit => {
      const b = h(`<button class="result-hit" type="button"><span class="hit-page">${esc(hit.label)}</span>
        <span class="hit-snippet">${esc(hit.pre.replace(/\s+/g, ' '))}<mark>${esc(hit.match)}</mark>${esc(hit.post.replace(/\s+/g, ' '))}</span></button>`);
      b.addEventListener('click', () => openAt(g.doc, hit.page));
      card.appendChild(b);
    });
    if (g.count > g.hits.length) {
      const more = h(`<button class="result-hit" type="button"><span class="hit-snippet">+ ${g.count - g.hits.length} weitere Treffer in der Datei anzeigen</span></button>`);
      more.addEventListener('click', () => openAt(g.doc, g.hits[0].page));
      card.appendChild(more);
    }
    box.appendChild(card);
  });
  if (nameHits.length) {
    const sec = h('<section class="card result-group"><div class="result-head"><div><strong>Dateinamen</strong></div></div><div class="doc-list name-hits"></div></section>');
    nameHits.forEach(d => $('.name-hits', sec).appendChild(fileRow(d)));
    box.appendChild(sec);
  }
  void textIds;
}

// ---------------- Ich / Einstellungen ----------------
export async function renderSettings() {
  const el = viewEl('einstellungen');
  const zoom = await db.getSetting('defaultZoom', 'auto');
  const docs = await db.listFiles();
  let profile = null, trashN = 0, remN = 0, vaultN = 0;
  try { profile = await (await import('./extras/profile.js')).getProfile(); } catch {}
  try { trashN = (await db.listTrash()).length; remN = (await db.listReminders()).filter(r => !r.done).length; vaultN = (await db.listVault()).length; } catch {}
  const stats = await import('./extras/stats.js');
  const pName = profile ? [profile.vorname, profile.nachname].filter(Boolean).join(' ') : '';
  el.innerHTML = `<div class="page-head"><div><h1 class="page-title">Ich</h1><p class="page-sub">Deine Daten, Einstellungen und Infos – ganz ohne Konto.</p></div></div>
    <a class="card me-card me-link" href="#/profil" data-profile-link>
      <span class="me-avatar">${pName ? esc(pName.split(' ').map(x => x[0]).join('').slice(0, 2).toUpperCase()) : oicon('user')}</span>
      <div><strong>${pName ? esc(pName) : 'Meine Daten'}</strong><span>${profile ? (lsGet('fale-acct', '') === '1' ? 'Für Briefe und Formulare – auf deinem Gerät gespeichert.' : 'Für Briefe und Formulare – nur auf diesem Gerät gespeichert.') : 'Optional: Name und Adresse für automatisch ausgefüllte Briefe hinterlegen.'}</span></div>
      <span class="me-go">${oicon('chevronRight')}</span>
    </a>
    <div class="acct-me-box" data-account-me></div>
    <div class="me-links">
      <a class="action-card" href="#/tresor"><span class="tile-ic">${oicon('vault')}</span><span><strong>Privater Tresor</strong><span class="muted small">${vaultN ? `${vaultN} verschlüsselte Datei${vaultN === 1 ? '' : 'en'}` : 'Mit eigener PIN schützen'}</span></span></a>
      <a class="action-card" href="#/fristen"><span class="tile-ic">${oicon('bell')}</span><span><strong>Fristen & Erinnerungen</strong><span class="muted small">${remN ? `${remN} aktive Frist${remN === 1 ? '' : 'en'}` : 'Nie wieder etwas verpassen'}</span></span></a>
      <a class="action-card" href="#/schreiben"><span class="tile-ic">${oicon('letter')}</span><span><strong>Schreiben & Vorlagen</strong><span class="muted small">Kündigung, Rechnung, Vollmacht …</span></span></a>
      <a class="action-card" href="#/papierkorb"><span class="tile-ic">${oicon('trash')}</span><span><strong>Papierkorb</strong><span class="muted small">${trashN ? `${trashN} Datei${trashN === 1 ? '' : 'en'}` : 'Leer'}</span></span></a>
    </div>
    <div data-install-me></div>
    <div data-ai-me></div>
    <div class="month-box" data-month-me></div>
    <h2 class="section-title">Einstellungen</h2>
    <div class="card settings-group">
      <div class="settings-row"><div class="label"><strong>Erscheinungsbild</strong><span>Automatisch folgt deinem System.</span></div>
        <div class="seg" role="group" aria-label="Erscheinungsbild">
          <button type="button" data-theme-opt="auto">Auto</button><button type="button" data-theme-opt="light">Hell</button><button type="button" data-theme-opt="dark">Dunkel</button>
        </div></div>
      <div class="settings-row" data-simple-row><div class="label"><strong>Einfache Ansicht</strong><span>Nur das Wichtigste in großen Kacheln. Alle anderen Funktionen findest du über „Alle Werkzeuge anzeigen“ und die Suche.</span></div>
        <label class="switch"><input type="checkbox" data-simple-toggle ${simpleOn() ? 'checked' : ''}><span class="switch-ui" aria-hidden="true"></span><span class="sr-only">Einfache Ansicht</span></label></div>
      <div class="settings-row ts-row" data-textsize-row><div class="label"><strong>Schriftgröße</strong><span>Macht Texte und Knöpfe in FaLe größer. Gilt nur auf diesem Gerät.</span></div>
        ${textSizeSeg()}</div>
      <div class="settings-row"><div class="label"><strong>Standard-Zoom</strong><span>Zoomstufe beim Öffnen einer PDF.</span></div>
        <select class="select" id="set-zoom" aria-label="Standard-Zoom">
          <option value="auto">Automatisch</option><option value="page-width">Seitenbreite</option><option value="page-fit">Ganze Seite</option>
          <option value="0.75">75 %</option><option value="1">100 %</option><option value="1.25">125 %</option><option value="1.5">150 %</option>
        </select></div>
      <div class="settings-row"><div class="label"><strong>Hinweis „Alles gratis“</strong><span>Die Info-Karte auf der Startseite wieder anzeigen.</span></div>
        <button class="btn btn-ghost btn-sm" type="button" data-free-reset>Wieder anzeigen</button></div>
      <div class="settings-row"><div class="label"><strong>„Dein Monat“</strong><span>Kleine Statistik auf der Startseite. Wird nur auf diesem Gerät gezählt.</span></div>
        <label class="switch"><input type="checkbox" data-stats-toggle ${stats.statsEnabled() ? 'checked' : ''}><span class="switch-ui" aria-hidden="true"></span><span class="sr-only">„Dein Monat“ anzeigen</span></label></div>
      <div class="settings-row"><div class="label"><strong>Einführung</strong><span>Die kurze Tour vom ersten Start noch einmal ansehen.</span></div>
        <button class="btn btn-ghost btn-sm" type="button" data-onboarding>Ansehen</button></div>
      <div class="settings-row"><div class="label"><strong>Dauerhafter Speicher</strong><span>Verhindert, dass der Browser deine Dateien automatisch löscht.</span></div>
        <button class="btn btn-soft btn-sm" type="button" data-persist>${oicon('shield')} Anfordern</button></div>
      <div class="settings-row"><div class="label"><strong>Daten löschen</strong><span>Entfernt alle Dateien und Unterschriften.</span></div>
        <button class="btn btn-danger-ghost btn-sm" type="button" data-clear>${oicon('trash')} Alles löschen</button></div>
    </div>
    <h2 class="section-title">Speicher</h2>
    <div class="card card-pad" data-storage-me></div>
    <h2 class="section-title">Über FaLe PDF</h2>
    <div class="card card-pad">
      <div class="privacy"><span class="tile-ic">${oicon('shield')}</span><div>
        <strong>Alles bleibt auf deinem Gerät.</strong>
        <p class="muted" style="margin-top:4px">FaLe PDF funktioniert offline. Du brauchst kein Konto, es gibt keine Werbebanner und kein Tracking. Deine Dateien werden im Speicher dieses Geräts abgelegt – nur wenn du das freiwillige FaLe-Konto mit FaLe Sync nutzt, zusätzlich Ende-zu-Ende-verschlüsselt in der Cloud. Nur wenn du die optionale Cloud-KI nutzt, wird der dafür ausgewählte Text nach deiner Zustimmung verarbeitet. Alle Funktionen – auch die, für die andere Apps ein Abo verlangen – sind kostenlos.</p>
      </div></div>
      <p class="muted small" style="margin-top:12px">Version 2.0.0 · Ein Projekt von FaLe.dev</p>
      <strong>Open-Source-Komponenten</strong>
      <ul class="license-list">
        <li>PDF.js 6.2.108 – Mozilla Foundation, Apache-2.0 (<a href="vendor/pdfjs/LICENSE" target="_blank" rel="noopener">Lizenz</a>)</li>
        <li>pdf-lib 1.17.1 – Andrew Dillon, MIT (<a href="vendor/pdf-lib/LICENSE.md" target="_blank" rel="noopener">Lizenz</a>, <a href="vendor/pdf-lib/THIRD_PARTY_LICENSES.txt" target="_blank" rel="noopener">enthaltene Pakete</a>)</li>
        <li>JSZip 3.10.1 – Stuart Knightley u. a., MIT oder GPLv3, hier unter MIT genutzt; enthält pako (MIT/Zlib) (<a href="vendor/jszip/LICENSE.markdown" target="_blank" rel="noopener">Lizenz</a>)</li>
        <li>docx 9.7.1 – Dolan Miu, MIT (<a href="vendor/docx/LICENSE" target="_blank" rel="noopener">Lizenz</a>)</li>
        <li>PptxGenJS 4.0.1 – Brent Ely, MIT; enthält JSZip (<a href="vendor/pptxgenjs/LICENSE" target="_blank" rel="noopener">Lizenz</a>)</li>
        <li>Standard-Schriften (Foxit, Liberation) und Decoder (OpenJPEG, JBIG2, QCMS) laut Lizenzdateien im Ordner vendor/pdfjs</li>
        <li>Bricolage Grotesque – The Bricolage Grotesque Project Authors, SIL Open Font License 1.1 (<a href="vendor/fonts/bricolage-grotesque/OFL.txt" target="_blank" rel="noopener">Lizenz</a>)</li>
      </ul>
    </div>
    <h2 class="section-title">Mehr von FaLe</h2>
    <a class="card me-card me-link" href="${NETWORK_ORIGIN}/" target="_blank" rel="noopener" data-fale-network>
      <span class="me-avatar">${oicon('heart')}</span>
      <div><strong>FaleNetwork</strong><span>Weitere freie Apps ohne Konto und ohne Tracking – zum Beispiel bald FaLe Clean für Windows.</span></div>
      <span class="me-go">${oicon('chevronRight')}</span>
    </a>
    <h2 class="section-title">Rechtliches</h2>
    <div class="card settings-group legal-group">
      <a class="settings-row legal-row" href="datenschutz.html" target="_blank" rel="noopener" data-privacy-link><div class="label"><strong>Datenschutzerklärung</strong><span>Was FaLe speichert – und was nicht.</span></div>${oicon('chevronRight')}</a>
      <a class="settings-row legal-row" href="impressum.html" target="_blank" rel="noopener" data-impressum><div class="label"><strong>Impressum</strong><span>Anbieterangaben nach § 5 DDG.</span></div>${oicon('chevronRight')}</a>
      <div class="settings-row"><div class="label"><strong>Vorlagen &amp; Briefe</strong><span>Formulierungshilfen ohne Gewähr – keine Rechtsberatung.</span></div></div>
    </div>`;
  $$('[data-privacy-link], [data-impressum]', el).forEach(a => a.addEventListener('click', e => {
    e.preventDefault();
    import('./platform.js').then(m => m.openLegalPage(a.getAttribute('href'))).catch(() => window.open(a.href, '_blank', 'noopener'));
  }));
  const theme = currentTheme();
  $$('[data-theme-opt]', el).forEach(b => {
    b.setAttribute('aria-pressed', String(b.dataset.themeOpt === theme));
    b.addEventListener('click', () => {
      applyTheme(b.dataset.themeOpt);
      $$('[data-theme-opt]', el).forEach(x => x.setAttribute('aria-pressed', String(x === b)));
      document.querySelectorAll('[data-action="toggle-theme"]').forEach(t => { t.innerHTML = oicon(document.documentElement.dataset.theme === 'dark' || (!document.documentElement.dataset.theme && matchMedia('(prefers-color-scheme: dark)').matches) ? 'sun' : 'moon'); });
    });
  });
  $('[data-simple-toggle]', el).addEventListener('change', e => {
    setSimple(e.target.checked);
    toast(e.target.checked ? 'Einfache Ansicht ist an.' : 'Alle Funktionen werden wieder angezeigt.', 'success');
  });
  bindTextSize($('[data-textsize-row]', el), size => toast(size === 'xl' ? 'Schrift ist jetzt sehr groß.' : size === 'l' ? 'Schrift ist jetzt groß.' : 'Schrift ist wieder normal groß.', 'success'));
  const zs = $('#set-zoom', el);
  zs.value = zoom;
  zs.addEventListener('change', async () => { await db.setSetting('defaultZoom', zs.value); toast('Gespeichert', 'success'); });
  $('[data-persist]', el).addEventListener('click', requestPersist);
  $('[data-clear]', el).addEventListener('click', deleteAllConfirm);
  $('[data-free-reset]', el).addEventListener('click', () => {
    lsSet('fale-free-card', '');
    const card = document.querySelector('#view-start [data-free]');
    if (card) card.hidden = false;
    toast('Wird auf der Startseite wieder angezeigt.', 'success');
  });
  renderStorage($('[data-storage-me]', el), docs);
  const home = await import('./extras/home.js');
  home.renderMonthCard($('[data-month-me]', el), { compact: true });
  $('[data-stats-toggle]', el).addEventListener('change', e => {
    stats.setStatsEnabled(e.target.checked);
    home.renderMonthCard($('[data-month-me]', el), { compact: true });
    const m = document.querySelector('#view-start [data-month]');
    if (m) home.renderMonthCard(m);
    toast(e.target.checked ? '„Dein Monat“ wird angezeigt' : '„Dein Monat“ ausgeblendet – es wird nichts mehr gezählt.', 'success');
  });
  $('[data-onboarding]', el).addEventListener('click', async () => { (await import('./extras/onboarding.js')).showOnboarding(); });
  import('./install.js').then(m => m.renderMeCard($('[data-install-me]', el))).catch(() => {}); // web only: install on this PC/Mac/phone
  import('./ai/entry.js').then(m => m.renderMeCard($('[data-ai-me]', el))).catch(() => {}); // KI-Assistent status (cached only)
  import('./account/entry.js').then(m => m.renderMeCard($('[data-account-me]', el))).catch(() => {}); // optional FaLe-Konto
  // OCR: "OCR-Daten für offline laden" (status, size) + licences of tesseract.js, -core, tessdata_fast
  import('./ocr/settings.js').then(m => m.mountOcrSettings(el)).catch(() => {});
}
