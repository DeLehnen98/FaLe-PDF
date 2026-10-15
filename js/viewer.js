// Document viewer built on the pdf.js viewer components.
import { pdfjsLib, loadPdf, renderPage, canvasToBlob, pageText, PasswordCancelled, knownPassword } from './pdfcore.js';
import { isNative, printPdf } from './platform.js';
import { EventBus, PDFLinkService, PDFFindController, PDFViewer, GenericL10n, LinkTarget } from '../vendor/pdfjs/pdf_viewer.mjs';
import * as db from './db.js';
import { icon } from './icons.js';
import { $, $$, h, esc, toast, errorToast, showMenu, debounce, downloadBlob, progress, pagesLabel } from './ui.js';
import { shareDoc, downloadDoc } from './components.js';
import { guardLinks, openExternal } from './security.js';

const trackStat = (e, n = 1) => { import('./extras/stats.js').then(m => m.track(e, n)).catch(() => {}); };
const seenPages = new Set();
import { ReadAloud, getVoices, onVoicesChanged, speechSupported } from './readaloud.js';

const root = () => document.getElementById('viewer');
const isSmall = () => window.matchMedia('(max-width: 720px)').matches;
const isCompact = () => window.matchMedia('(max-width: 900px)').matches;

let S = null; // singleton viewer components
let cur = null; // current document session
let openToken = 0;
let onCloseRequest = () => {};

export function setViewerCloseHandler(fn) { onCloseRequest = fn; }
let opening = 0; // documents still loading (e.g. waiting for a password)
export function viewerOpen() { return !!cur || opening > 0; }

function lsGet(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : v; } catch { return d; } }
function lsSet(k, v) { try { localStorage.setItem(k, v); } catch {} }

function buildDom() {
  const el = root();
  el.innerHTML = `
  <header class="vbar vbar-top">
    <button class="icon-btn" type="button" data-v="back" aria-label="Zurück">${icon('back')}</button>
    <div class="v-title"><strong data-v="title">Dokument</strong><span data-v="subtitle"></span></div>
    <div class="v-actions">
      <button class="icon-btn" type="button" data-v="reflow" aria-label="Lesemodus" title="Lesemodus (Text umbrechen)">${icon('book')}</button>
      <button class="icon-btn" type="button" data-v="mark" aria-label="Lesezeichen für diese Seite" aria-pressed="false" title="Lesezeichen setzen">${icon('bookmark')}</button>
      <button class="icon-btn" type="button" data-v="find" aria-label="Im Dokument suchen" aria-pressed="false">${icon('search')}</button>
      <button class="icon-btn" type="button" data-v="panel" aria-label="Seitenleiste mit Seiten und Gliederung" aria-pressed="false">${icon('panel')}</button>
      <span class="v-sep hide-sm"></span>
      <button class="icon-btn hide-sm" type="button" data-v="read" aria-label="Vorlesen">${icon('speaker')}</button>
      <button class="icon-btn hide-sm" type="button" data-v="rotate" aria-label="Ansicht drehen">${icon('rotate')}</button>
      <button class="icon-btn hide-sm" type="button" data-v="night" aria-label="Nachtmodus" aria-pressed="false">${icon('moon')}</button>
      <button class="icon-btn hide-sm" type="button" data-v="print" aria-label="Drucken">${icon('print')}</button>
      <button class="icon-btn hide-sm" type="button" data-v="download" aria-label="Herunterladen">${icon('download')}</button>
      <button class="icon-btn hide-sm" type="button" data-v="share" aria-label="Teilen">${icon('share')}</button>
      <button class="icon-btn" type="button" data-v="more" aria-label="Weitere Aktionen">${icon('more')}</button>
    </div>
  </header>
  <div class="findbar" data-v="findbar" hidden>
    <input class="input" type="search" data-v="findinput" placeholder="Im Dokument suchen …" aria-label="Suchbegriff" enterkeyhint="search">
    <span class="find-count" data-v="findcount" aria-live="polite"></span>
    <button class="icon-btn" type="button" data-v="findprev" aria-label="Vorheriger Treffer">${icon('chevronUp')}</button>
    <button class="icon-btn" type="button" data-v="findnext" aria-label="Nächster Treffer">${icon('chevronDown')}</button>
    <button class="icon-btn" type="button" data-v="findclose" aria-label="Suche schließen">${icon('close')}</button>
  </div>
  <div class="v-body">
    <aside class="v-panel" data-v="vpanel" hidden aria-label="Seitenleiste">
      <div class="tabs" role="tablist">
        <button class="tab" role="tab" type="button" data-ptab="thumbs" aria-selected="true">Seiten</button>
        <button class="tab" role="tab" type="button" data-ptab="outline" aria-selected="false">Gliederung</button>
        <button class="tab" role="tab" type="button" data-ptab="marks" aria-selected="false">Lesezeichen</button>
      </div>
      <div class="v-panel-body" data-v="panelbody"><div class="thumbs" data-v="thumbs"></div><div data-v="outline" hidden></div><div data-v="marks" hidden></div></div>
    </aside>
    <div class="v-scrim" data-v="scrim"></div>
    <div class="v-stage" data-v="stage">
      <div class="v-loading" data-v="loading"><div><span class="spinner dark" style="width:32px;height:32px"></span><span>Dokument wird geladen …</span></div></div>
      <div class="v-container" data-v="container" tabindex="0"><div class="pdfViewer" data-v="pdfviewer"></div></div>
    </div>
  </div>
  <div class="readbar" data-v="readbar" hidden>
    <button class="icon-btn read-play" type="button" data-v="readplay" aria-label="Pause">${icon('pause')}</button>
    <button class="icon-btn" type="button" data-v="readstop" aria-label="Vorlesen beenden">${icon('stop')}</button>
    <span class="read-status" data-v="readstatus"></span>
    <label class="sr-only" for="read-rate">Geschwindigkeit</label>
    <select class="select" id="read-rate" data-v="readrate">
      <option value="0.75">0,75×</option><option value="1" selected>1×</option><option value="1.25">1,25×</option><option value="1.5">1,5×</option><option value="2">2×</option>
    </select>
    <label class="sr-only" for="read-voice">Stimme</label>
    <select class="select" id="read-voice" data-v="readvoice" style="max-width:190px"></select>
    <button class="icon-btn" type="button" data-v="readclose" aria-label="Vorleseleiste schließen">${icon('close')}</button>
  </div>
  <footer class="vbar vbar-bottom">
    <button class="icon-btn" type="button" data-v="prev" aria-label="Vorherige Seite">${icon('chevronLeft')}</button>
    <span class="page-ind"><input type="text" inputmode="numeric" data-v="pagenum" aria-label="Seitennummer" value="1"><span>/ <span data-v="pagecount">1</span></span></span>
    <button class="icon-btn" type="button" data-v="next" aria-label="Nächste Seite">${icon('chevronRight')}</button>
    <span class="v-sep"></span>
    <button class="icon-btn" type="button" data-v="zoomout" aria-label="Verkleinern">${icon('zoomOut')}</button>
    <button class="zoom-val" type="button" data-v="zoomval" aria-label="Zoomstufe wählen">100 %</button>
    <button class="icon-btn" type="button" data-v="zoomin" aria-label="Vergrößern">${icon('zoomIn')}</button>
    <span class="v-sep hide-sm"></span>
    <button class="icon-btn hide-sm" type="button" data-v="fitwidth" aria-label="Seitenbreite">${icon('fitWidth')}</button>
    <button class="icon-btn hide-sm" type="button" data-v="fitpage" aria-label="Ganze Seite">${icon('fitPage')}</button>
  </footer>`;
}

const q = name => root().querySelector(`[data-v="${name}"]`);

function init() {
  if (S) return S;
  buildDom();
  const eventBus = new EventBus();
  const linkService = new PDFLinkService({ eventBus, externalLinkTarget: LinkTarget.BLANK, externalLinkRel: 'noopener noreferrer nofollow' });
  const findController = new PDFFindController({ eventBus, linkService, updateMatchesCountOnProgress: true });
  const l10n = new GenericL10n();
  const pdfViewer = new PDFViewer({
    container: q('container'),
    viewer: q('pdfviewer'),
    eventBus, linkService, findController, l10n,
    textLayerMode: 1,
    annotationMode: pdfjsLib.AnnotationMode.ENABLE,
    annotationEditorMode: pdfjsLib.AnnotationEditorType.DISABLE,
    imageResourcesPath: './vendor/pdfjs/images/',
    maxCanvasPixels: isCompact() ? 2 ** 23 : 2 ** 25,
    enablePrintAutoRotate: true,
  });
  linkService.setViewer(pdfViewer);
  // Links inside PDFs are untrusted: pdf.js already drops javascript:/file: URLs and Launch actions;
  // every remaining external link (http/https/mailto/tel) asks before it leaves the app.
  guardLinks(q('container'), { source: 'Das Dokument enthält einen Link.' });

  // Center search matches instead of pinning them to the top edge (under the toolbars on phones).
  const origMatch = findController.scrollMatchIntoView.bind(findController);
  findController.scrollMatchIntoView = args => {
    const el = args && args.element;
    if (el) { const native = el.scrollIntoView; el.scrollIntoView = () => native.call(el, { block: 'center', inline: 'center' }); }
    try { origMatch(args); } finally { if (el) delete el.scrollIntoView; }
  };
  // On phones the toolbars overlay the document: keep page jumps clear of the top bar.
  const origScroll = pdfViewer.scrollPageIntoView.bind(pdfViewer);
  pdfViewer.scrollPageIntoView = params => {
    origScroll(params);
    if (!isSmall() || (params && params.destArray) || root().classList.contains('chrome-hidden')) return;
    let offset = root().querySelector('.vbar-top').offsetHeight;
    if (!q('findbar').hidden) offset += q('findbar').offsetHeight;
    const c = q('container');
    c.scrollTop = Math.max(0, c.scrollTop - offset - 6);
  };
  S = { eventBus, linkService, findController, pdfViewer, l10n };
  wire();
  return S;
}

function wire() {
  const { eventBus, pdfViewer } = S;
  const el = root();

  eventBus.on('pagechanging', ({ pageNumber }) => {
    if (!cur) return;
    q('pagenum').value = String(pageNumber);
    highlightThumb(pageNumber);
    saveLastPage(pageNumber);
    saveProgress(cur.doc.id, pageNumber, cur.pdf.numPages);
    const seenKey = `${cur.doc.id}:${pageNumber}`;
    if (!seenPages.has(seenKey)) { seenPages.add(seenKey); trackStat('pages_read'); }
    syncMarkButton();
    q('prev').disabled = pageNumber <= 1;
    q('next').disabled = pageNumber >= cur.pdf.numPages;
  });
  eventBus.on('scalechanging', ({ scale }) => { q('zoomval').textContent = `${Math.round(scale * 100)} %`; });
  eventBus.on('updatefindmatchescount', ({ matchesCount }) => renderFindCount(matchesCount));
  eventBus.on('updatefindcontrolstate', ({ state, matchesCount }) => {
    const c = q('findcount');
    if (state === 1) { c.textContent = 'Kein Treffer'; c.classList.add('notfound'); return; }
    c.classList.remove('notfound');
    if (matchesCount) renderFindCount(matchesCount);
  });

  q('back').addEventListener('click', () => onCloseRequest());
  q('prev').addEventListener('click', () => pdfViewer.previousPage());
  q('next').addEventListener('click', () => pdfViewer.nextPage());
  q('pagenum').addEventListener('change', e => {
    const n = parseInt(e.target.value, 10);
    if (cur && n >= 1 && n <= cur.pdf.numPages) pdfViewer.currentPageNumber = n;
    else { e.target.value = String(pdfViewer.currentPageNumber); toast('Diese Seite gibt es nicht.', 'error'); }
  });
  q('pagenum').addEventListener('focus', e => e.target.select());
  q('pagenum').addEventListener('keydown', e => { if (e.key === 'Enter') e.target.blur(); });
  q('zoomin').addEventListener('click', () => pdfViewer.increaseScale());
  q('zoomout').addEventListener('click', () => pdfViewer.decreaseScale());
  q('fitwidth').addEventListener('click', () => { pdfViewer.currentScaleValue = 'page-width'; });
  q('fitpage').addEventListener('click', () => { pdfViewer.currentScaleValue = 'page-fit'; });
  q('zoomval').addEventListener('click', e => {
    const set = v => () => { pdfViewer.currentScaleValue = v; };
    showMenu(e.currentTarget, [
      { label: 'Seitenbreite', icon: 'fitWidth', onClick: set('page-width') },
      { label: 'Ganze Seite', icon: 'fitPage', onClick: set('page-fit') },
      { label: 'Automatisch', icon: 'sparkle', onClick: set('auto') },
      '-',
      ...[0.5, 0.75, 1, 1.25, 1.5, 2, 3].map(z => ({ label: `${Math.round(z * 100)} %`, icon: 'zoomIn', onClick: set(String(z)) })),
    ], { label: 'Zoom' });
  });
  q('rotate').addEventListener('click', rotate);
  q('night').addEventListener('click', toggleNight);
  q('print').addEventListener('click', printDoc);
  q('download').addEventListener('click', () => cur && downloadDoc(cur.doc));
  q('share').addEventListener('click', () => cur && shareDoc(cur.doc));
  q('read').addEventListener('click', () => startReading());
  q('reflow').addEventListener('click', () => openReflowMode());
  q('mark').addEventListener('click', () => toggleMark());
  q('more').addEventListener('click', e => {
    if (!cur) return;
    const id = cur.doc.id;
    const anchor = e.currentTarget;
    showMenu(anchor, [
      { label: 'KI-Assistent', icon: 'sparkle', onClick: () => (location.hash = `#/ki?doc=${id}`) },
      { label: 'Lesemodus', icon: 'book', onClick: () => openReflowMode() },
      { label: isMarked(id, S.pdfViewer.currentPageNumber) ? 'Lesezeichen entfernen' : 'Lesezeichen setzen', icon: 'bookmark', onClick: () => toggleMark() },
      { label: 'Vorlesen', icon: 'speaker', onClick: () => startReading() },
      { label: 'Kommentieren', icon: 'highlight', onClick: () => (location.hash = `#/werkzeug/kommentieren?doc=${id}`) },
      { label: 'Ausfüllen & unterschreiben', icon: 'sign', onClick: () => (location.hash = `#/werkzeug/unterschreiben?doc=${id}`) },
      { label: 'PDF bearbeiten', icon: 'edit', onClick: () => (location.hash = `#/werkzeug/bearbeiten?doc=${id}`) },
      { label: 'Seiten verwalten', icon: 'pages', onClick: () => (location.hash = `#/werkzeug/seiten?doc=${id}`) },
      { label: 'Formular erstellen', icon: 'formAdd', onClick: () => (location.hash = `#/werkzeug/formular-erstellen?doc=${id}`) },
      { label: 'Seiten zuschneiden', icon: 'crop', onClick: () => (location.hash = `#/werkzeug/zuschneiden?doc=${id}`) },
      { label: 'PDF vergleichen', icon: 'compare', onClick: () => (location.hash = `#/werkzeug/vergleichen?doc=${id}`) },
      { label: 'Text erkennen (OCR)', icon: 'scan', onClick: () => (location.hash = `#/werkzeug/durchsuchbar?doc=${id}`) },
      { label: 'Konvertieren …', icon: 'export', onClick: () => setTimeout(() => convertMenu(anchor, id), 0) },
      { label: 'Komprimieren', icon: 'compress', onClick: () => (location.hash = `#/werkzeug/komprimieren?doc=${id}`) },
      { label: 'Schwärzen', icon: 'redact', onClick: () => (location.hash = `#/werkzeug/schwaerzen?doc=${id}`) },
      cur.doc.encrypted
        ? { label: 'Passwort entfernen', icon: 'unlock', onClick: () => (location.hash = `#/werkzeug/passwort-entfernen?doc=${id}`) }
        : { label: 'Passwort festlegen', icon: 'lock', onClick: () => (location.hash = `#/werkzeug/passwort?doc=${id}`) },
      '-',
      { label: 'Ansicht drehen', icon: 'rotate', onClick: rotate },
      { label: el.classList.contains('night') ? 'Nachtmodus aus' : 'Nachtmodus an', icon: 'moon', onClick: toggleNight },
      wakeLockSupported() ? { label: lsGet('fale-wakelock', '0') === '1' ? 'Bildschirm anlassen: an' : 'Bildschirm anlassen: aus', icon: 'sun', onClick: toggleWakeSetting } : null,
      { label: 'Seitenbreite', icon: 'fitWidth', onClick: () => { pdfViewer.currentScaleValue = 'page-width'; } },
      { label: 'Ganze Seite', icon: 'fitPage', onClick: () => { pdfViewer.currentScaleValue = 'page-fit'; } },
      '-',
      { label: 'Drucken', icon: 'print', onClick: printDoc },
      { label: 'Herunterladen', icon: 'download', onClick: () => downloadDoc(cur.doc) },
      { label: 'Teilen', icon: 'share', onClick: () => shareDoc(cur.doc) },
      { label: 'Sicher teilen', icon: 'link', onClick: () => (location.hash = `#/teilen/link?doc=${id}`) }, // js/share (E2E-encrypted link)
      { label: 'Unterschrift anfordern', icon: 'sign', onClick: () => (location.hash = `#/teilen/unterschrift?doc=${id}`) },
    ], { label: 'Weitere Aktionen' });
  });

  // find bar
  q('find').addEventListener('click', () => (q('findbar').hidden ? openFind() : closeFind()));
  q('findclose').addEventListener('click', closeFind);
  const runFind = debounce(() => dispatchFind(''), 250);
  q('findinput').addEventListener('input', runFind);
  q('findinput').addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); dispatchFind('again', e.shiftKey); }
    if (e.key === 'Escape') { e.preventDefault(); closeFind(); }
  });
  q('findnext').addEventListener('click', () => dispatchFind('again', false));
  q('findprev').addEventListener('click', () => dispatchFind('again', true));

  // side panel
  q('panel').addEventListener('click', () => togglePanel());
  q('scrim').addEventListener('click', () => togglePanel(false));
  $$('[data-ptab]', el).forEach(t => t.addEventListener('click', () => {
    $$('[data-ptab]', el).forEach(x => x.setAttribute('aria-selected', String(x === t)));
    q('thumbs').hidden = t.dataset.ptab !== 'thumbs';
    q('outline').hidden = t.dataset.ptab !== 'outline';
    q('marks').hidden = t.dataset.ptab !== 'marks';
    if (t.dataset.ptab === 'outline') buildOutline();
    if (t.dataset.ptab === 'marks') renderMarks();
  }));

  // read-aloud bar
  q('readplay').addEventListener('click', () => cur && cur.reader && cur.reader.toggle());
  q('readstop').addEventListener('click', () => stopReading());
  q('readclose').addEventListener('click', () => stopReading());
  q('readrate').addEventListener('change', e => cur && cur.reader && cur.reader.setRate(parseFloat(e.target.value)));
  q('readvoice').addEventListener('change', e => { lsSet('fale-voice', e.target.value); cur && cur.reader && cur.reader.setVoice(e.target.value); });
  onVoicesChanged(fillVoices);

  // auto-hiding chrome on phones
  const container = q('container');
  let lastTop = 0;
  let lastUserInput = 0;
  const markUser = () => { lastUserInput = Date.now(); };
  ['touchstart', 'touchmove', 'wheel', 'keydown'].forEach(ev => container.addEventListener(ev, markUser, { passive: true }));
  container.addEventListener('scroll', () => {
    const top = container.scrollTop;
    const dy = top - lastTop;
    // only react to scrolling the user did themselves (not jumps via search/thumbnails)
    if (isSmall() && q('findbar').hidden && Date.now() - lastUserInput < 800) {
      if (dy > 14 && top > 80) el.classList.add('chrome-hidden');
      else if (dy < -14) el.classList.remove('chrome-hidden');
    }
    lastTop = top;
  }, { passive: true });
  // taps: double-tap zooms; on phones the outer edges turn pages, the middle toggles the bars
  let lastTap = null, tapTimer = null, lastPointer = 'mouse';
  container.addEventListener('pointerdown', e => { lastPointer = e.pointerType || 'mouse'; }, { passive: true });
  container.addEventListener('click', e => {
    if (e.target.closest('a, .annotationLayer section, input, button')) return;
    const now = Date.now();
    // double-tap zoom is a touch gesture (a mouse double-click keeps selecting words)
    if (lastPointer !== 'mouse' && lastTap && now - lastTap.t < 320 && Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y) < 40) {
      clearTimeout(tapTimer); lastTap = null;
      try { window.getSelection().removeAllRanges(); } catch {}
      doubleTapZoom(e);
      return;
    }
    const sel = window.getSelection();
    if (sel && !sel.isCollapsed) return;
    lastTap = { t: now, x: e.clientX, y: e.clientY };
    if (!isSmall()) return;
    clearTimeout(tapTimer);
    tapTimer = setTimeout(() => {
      lastTap = null;
      const r = container.getBoundingClientRect();
      const fx = (e.clientX - r.left) / r.width;
      const zoomedIn = container.scrollWidth > container.clientWidth + 4;
      if (!zoomedIn && fx < 0.2) { pdfViewer.previousPage(); el.classList.add('chrome-hidden'); }
      else if (!zoomedIn && fx > 0.8) { pdfViewer.nextPage(); el.classList.add('chrome-hidden'); }
      else el.classList.toggle('chrome-hidden');
    }, 300);
  });
  // horizontal swipe turns pages (when the page fits the width)
  let swipe = null;
  container.addEventListener('touchstart', e => {
    swipe = e.touches.length === 1 ? { x: e.touches[0].clientX, y: e.touches[0].clientY, t: Date.now(), left: container.scrollLeft } : null;
  }, { passive: true });
  container.addEventListener('touchend', e => {
    if (!swipe || e.changedTouches.length !== 1) { swipe = null; return; }
    const t = e.changedTouches[0];
    const dx = t.clientX - swipe.x, dy = t.clientY - swipe.y, dt = Date.now() - swipe.t;
    const fits = container.scrollWidth <= container.clientWidth + 4;
    if (fits && dt < 600 && Math.abs(dx) > 70 && Math.abs(dy) < Math.abs(dx) * 0.5) {
      if (dx < 0) pdfViewer.nextPage(); else pdfViewer.previousPage();
      clearTimeout(tapTimer); lastTap = null;
    }
    swipe = null;
  }, { passive: true });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && cur) applyWakeLock(); });

  // pinch to zoom (touch) and ctrl+wheel (desktop)
  let pinch = null;
  const dist = t => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
  const mid = t => {
    const r = q('stage').getBoundingClientRect();
    return [(t[0].clientX + t[1].clientX) / 2 - r.left, (t[0].clientY + t[1].clientY) / 2 - r.top];
  };
  container.addEventListener('touchstart', e => { if (e.touches.length === 2) pinch = { d: dist(e.touches) }; }, { passive: true });
  container.addEventListener('touchmove', e => {
    if (!pinch || e.touches.length !== 2) return;
    e.preventDefault();
    const d = dist(e.touches);
    const f = d / pinch.d;
    if (Math.abs(f - 1) > 0.03) {
      pdfViewer.updateScale({ scaleFactor: f, drawingDelay: 300, origin: mid(e.touches) });
      pinch.d = d;
    }
  }, { passive: false });
  container.addEventListener('touchend', e => { if (e.touches.length < 2) pinch = null; }, { passive: true });
  container.addEventListener('wheel', e => {
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    const r = q('stage').getBoundingClientRect();
    pdfViewer.updateScale({ steps: e.deltaY < 0 ? 1 : -1, drawingDelay: 250, origin: [e.clientX - r.left, e.clientY - r.top] });
  }, { passive: false });

  // keyboard shortcuts while the viewer is open
  window.addEventListener('keydown', e => {
    if (!cur || root().hidden || document.querySelector('dialog[open]')) return;
    if (cur.reflow) { if (e.key === 'Escape') closeReflow(); return; }
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === 'f') { e.preventDefault(); openFind(); }
    else if (mod && (e.key === '+' || e.key === '=')) { e.preventDefault(); pdfViewer.increaseScale(); }
    else if (mod && e.key === '-') { e.preventDefault(); pdfViewer.decreaseScale(); }
    else if (mod && e.key.toLowerCase() === 'p') { e.preventDefault(); printDoc(); }
    else if (e.key === 'Escape' && !q('findbar').hidden) closeFind();
    else if (!mod && !e.target.closest('input, select, textarea')) {
      if (e.key === 'PageDown' || (e.key === 'ArrowRight' && !e.shiftKey)) { if (e.key === 'ArrowRight') { pdfViewer.nextPage(); e.preventDefault(); } }
      if (e.key === 'ArrowLeft' && !e.shiftKey) { pdfViewer.previousPage(); e.preventDefault(); }
    }
  });
}

function convertMenu(anchor, id) {
  const go = t => () => (location.hash = `#/werkzeug/${t}?doc=${id}`);
  showMenu(anchor, [
    { label: 'PDF zu Word', icon: 'word', onClick: go('pdf-word') },
    { label: 'PDF zu PowerPoint', icon: 'slides', onClick: go('pdf-powerpoint') },
    { label: 'PDF zu Bild / Text', icon: 'image', onClick: go('exportieren') },
    { label: 'Wasserzeichen', icon: 'watermark', onClick: go('wasserzeichen') },
    { label: 'Seitenzahlen', icon: 'hash', onClick: go('seitenzahlen') },
    { label: 'Kopf- & Fußzeile', icon: 'header', onClick: go('kopfzeile') },
    { label: 'Seiten extrahieren', icon: 'extract', onClick: go('extrahieren') },
    { label: 'Lesezeichen bearbeiten', icon: 'outline', onClick: go('lesezeichen') },
    { label: 'QR-Code einfügen', icon: 'qr', onClick: () => (location.hash = `#/werkzeug/qr-erstellen?doc=${id}`) },
  ], { label: 'Konvertieren und mehr' });
}

function renderFindCount(m) {
  const c = q('findcount');
  if (!m || !m.total) { c.textContent = q('findinput').value ? 'Kein Treffer' : ''; c.classList.toggle('notfound', !!q('findinput').value); return; }
  c.classList.remove('notfound');
  c.textContent = `${m.current > 0 ? m.current : '–'} von ${m.total}${m.total >= 1000 ? '+' : ''}`;
}

function dispatchFind(type, findPrevious = false) {
  const query = q('findinput').value;
  if (!query.trim()) { renderFindCount(null); S.eventBus.dispatch('findbarclose', { source: null }); return; }
  S.eventBus.dispatch('find', { source: null, type, query, caseSensitive: false, entireWord: false, highlightAll: true, findPrevious, matchDiacritics: false });
}

function openFind(query) {
  const el = root();
  q('findbar').hidden = false;
  q('find').setAttribute('aria-pressed', 'true');
  el.classList.add('has-find');
  el.classList.remove('chrome-hidden');
  if (typeof query === 'string') { q('findinput').value = query; dispatchFind(''); }
  setTimeout(() => q('findinput').focus(), 30);
}

function closeFind() {
  q('findbar').hidden = true;
  q('find').setAttribute('aria-pressed', 'false');
  root().classList.remove('has-find');
  q('findcount').textContent = '';
  S.eventBus.dispatch('findbarclose', { source: null });
}

function rotate() {
  if (!cur) return;
  S.pdfViewer.pagesRotation = (S.pdfViewer.pagesRotation + 90) % 360;
}

function toggleNight() {
  const on = root().classList.toggle('night');
  q('night').setAttribute('aria-pressed', String(on));
  lsSet('fale-night', on ? '1' : '0');
  toast(on ? 'Nachtmodus an' : 'Nachtmodus aus');
}

function togglePanel(force) {
  const p = q('vpanel');
  const open = typeof force === 'boolean' ? force : (isCompact() ? !p.classList.contains('open') : p.hidden);
  if (isCompact()) {
    p.hidden = false;
    requestAnimationFrame(() => p.classList.toggle('open', open));
  } else {
    p.hidden = !open;
    p.classList.toggle('open', open);
    lsSet('fale-panel', open ? '1' : '0');
  }
  q('panel').setAttribute('aria-pressed', String(open));
  if (open) { buildThumbs(); }
}

// ---- thumbnails (lazy) ----
function buildThumbs() {
  if (!cur || cur.thumbsBuilt) { if (cur) highlightThumb(S.pdfViewer.currentPageNumber, true); return; }
  cur.thumbsBuilt = true;
  const box = q('thumbs');
  box.innerHTML = '';
  const n = cur.pdf.numPages;
  const ratio = cur.firstRatio || 1.414;
  const io = new IntersectionObserver(entries => {
    entries.forEach(en => {
      if (!en.isIntersecting) return;
      io.unobserve(en.target);
      renderThumb(en.target);
    });
  }, { root: q('panelbody'), rootMargin: '300px 0px' });
  cur.thumbObserver = io;
  const frag = document.createDocumentFragment();
  for (let i = 1; i <= n; i++) {
    const b = h(`<button class="thumb-btn" type="button" data-page="${i}" aria-label="Seite ${i}"><span class="thumb-box" style="aspect-ratio:${1 / ratio}"></span><span>${i}</span></button>`);
    b.addEventListener('click', () => {
      S.pdfViewer.currentPageNumber = i;
      if (isCompact()) togglePanel(false);
    });
    frag.appendChild(b);
    io.observe(b);
  }
  box.appendChild(frag);
  highlightThumb(S.pdfViewer.currentPageNumber, true);
}

async function renderThumb(btn) {
  const session = cur;
  if (!session) return;
  try {
    const page = await session.pdf.getPage(+btn.dataset.page);
    if (session !== cur) return;
    const canvas = await renderPage(page, { width: 140, dpr: Math.min(2, window.devicePixelRatio || 1), rotation: S.pdfViewer.pagesRotation });
    const box = btn.querySelector('.thumb-box');
    box.style.aspectRatio = '';
    box.innerHTML = '';
    box.appendChild(canvas);
  } catch (e) { if (session === cur) console.warn('thumb', e); }
}

function highlightThumb(n, scroll = false) {
  const box = q('thumbs');
  $$('.thumb-btn.current', box).forEach(b => { b.classList.remove('current'); b.removeAttribute('aria-current'); });
  const b = box.querySelector(`[data-page="${n}"]`);
  if (b) {
    b.classList.add('current');
    b.setAttribute('aria-current', 'page');
    if (scroll || !q('vpanel').hidden) b.scrollIntoView({ block: 'nearest' });
  }
}

async function buildOutline() {
  if (!cur || cur.outlineBuilt) return;
  cur.outlineBuilt = true;
  const box = q('outline');
  box.innerHTML = '<p class="panel-empty">Lade Gliederung …</p>';
  let outline = null;
  try { outline = await cur.pdf.getOutline(); } catch {}
  if (!outline || !outline.length) { box.innerHTML = '<p class="panel-empty">Dieses Dokument hat keine Gliederung.</p>'; return; }
  const build = items => {
    const ul = document.createElement('ul');
    items.forEach(it => {
      const li = document.createElement('li');
      const b = h(`<button type="button">${esc(it.title || 'Ohne Titel')}</button>`);
      b.addEventListener('click', () => {
        if (it.dest) S.linkService.goToDestination(it.dest);
        else if (it.url) openExternal(it.url, { source: 'Der Gliederungseintrag ist ein Link.' });
        if (isCompact()) togglePanel(false);
      });
      li.appendChild(b);
      if (it.items && it.items.length) li.appendChild(build(it.items));
      ul.appendChild(li);
    });
    return ul;
  };
  box.innerHTML = '';
  const tree = build(outline);
  tree.className = 'outline-list';
  box.appendChild(tree);
}


// ---- reading progress ("Weiterlesen") ----
const PROGRESS_KEY = id => `fale-progress:${id}`;
function saveProgress(id, page, pages) {
  try { localStorage.setItem(PROGRESS_KEY(id), JSON.stringify({ page, pages, updatedAt: Date.now() })); } catch {}
}
/**
 * Last reading position of a document: {page, pages, updatedAt} or null (never opened in the viewer).
 * Synchronous (localStorage) so lists can show a "Weiterlesen" hint without waiting.
 */
export function getReadingProgress(docId) {
  try {
    const v = JSON.parse(localStorage.getItem(PROGRESS_KEY(docId)) || 'null');
    if (v && Number.isFinite(v.page)) return { page: v.page, pages: v.pages || null, updatedAt: v.updatedAt || 0 };
  } catch {}
  return null;
}

// ---- user bookmarks (per document, separate from the PDF outline) ----
const MARKS_KEY = id => `fale-marks:${id}`;
/** Page bookmarks the user set in the viewer: [{page, title, at}] sorted by page. */
export function getBookmarks(docId) {
  try { const v = JSON.parse(localStorage.getItem(MARKS_KEY(docId)) || '[]'); return Array.isArray(v) ? v : []; } catch { return []; }
}
function setBookmarks(docId, list) {
  try { localStorage.setItem(MARKS_KEY(docId), JSON.stringify(list.sort((a, b) => a.page - b.page))); } catch {}
}
function isMarked(docId, page) { return getBookmarks(docId).some(m => m.page === page); }
function syncMarkButton() {
  if (!cur) return;
  const on = isMarked(cur.doc.id, S.pdfViewer.currentPageNumber);
  const b = q('mark');
  b.setAttribute('aria-pressed', String(on));
  b.innerHTML = icon(on ? 'bookmarkOn' : 'bookmark');
  b.setAttribute('aria-label', on ? 'Lesezeichen entfernen' : 'Lesezeichen für diese Seite');
}
async function toggleMark() {
  if (!cur) return;
  const id = cur.doc.id, page = S.pdfViewer.currentPageNumber;
  let list = getBookmarks(id);
  if (list.some(m => m.page === page)) {
    list = list.filter(m => m.page !== page);
    toast(`Lesezeichen auf Seite ${page} entfernt`);
  } else {
    let title = `Seite ${page}`;
    try {
      if (!cur.texts) cur.texts = (await db.getText(id)) || [];
      const t = (cur.texts[page - 1] || '').split('\n').map(x => x.trim()).find(x => x.length > 3);
      if (t) title = t.length > 70 ? t.slice(0, 68) + ' …' : t;
    } catch {}
    list.push({ page, title, at: Date.now() });
    toast(`Lesezeichen auf Seite ${page} gesetzt`, 'success');
  }
  setBookmarks(id, list);
  syncMarkButton();
  if (!q('marks').hidden) renderMarks();
}
function renderMarks() {
  const box = q('marks');
  if (!cur) { box.innerHTML = ''; return; }
  const list = getBookmarks(cur.doc.id);
  box.innerHTML = '';
  const add = h(`<button class="btn btn-soft btn-sm btn-block" type="button">${icon('bookmark')} Aktuelle Seite merken</button>`);
  add.addEventListener('click', () => { if (!isMarked(cur.doc.id, S.pdfViewer.currentPageNumber)) toggleMark(); else toast('Diese Seite ist schon gemerkt.'); });
  box.appendChild(add);
  if (!list.length) { box.appendChild(h('<p class="panel-empty">Noch keine Lesezeichen. Tippe oben auf das Lesezeichen-Symbol, um dir eine Seite zu merken.</p>')); return; }
  const ul = h('<ul class="v-marks"></ul>');
  list.forEach(m => {
    const li = h(`<li><button type="button" class="v-mark-go"><span class="v-mark-p">S. ${m.page}</span><span class="v-mark-t">${esc(m.title || `Seite ${m.page}`)}</span></button>
      <button type="button" class="icon-btn" data-ren aria-label="Umbenennen">${icon('edit')}</button>
      <button type="button" class="icon-btn" data-del aria-label="Lesezeichen löschen">${icon('trash')}</button></li>`);
    li.querySelector('.v-mark-go').addEventListener('click', () => { S.pdfViewer.currentPageNumber = Math.min(m.page, cur.pdf.numPages); if (isCompact()) togglePanel(false); });
    li.querySelector('[data-del]').addEventListener('click', () => { setBookmarks(cur.doc.id, getBookmarks(cur.doc.id).filter(x => x.page !== m.page)); renderMarks(); syncMarkButton(); });
    li.querySelector('[data-ren]').addEventListener('click', async () => {
      const { promptDialog } = await import('./ui.js');
      const t = await promptDialog('Lesezeichen umbenennen', 'Name', m.title || '');
      if (t == null) return;
      setBookmarks(cur.doc.id, getBookmarks(cur.doc.id).map(x => (x.page === m.page ? { ...x, title: t.trim() || `Seite ${m.page}` } : x)));
      renderMarks();
    });
    ul.appendChild(li);
  });
  box.appendChild(ul);
}

// ---- double-tap zoom ----
function doubleTapZoom(e) {
  if (!cur) return;
  const pv = S.pdfViewer;
  const r = q('stage').getBoundingClientRect();
  const origin = [e.clientX - r.left, e.clientY - r.top];
  const container = q('container');
  const zoomed = container.scrollWidth > container.clientWidth + 4 || pv.currentScale > 1.6;
  if (zoomed) pv.currentScaleValue = isSmall() ? 'page-width' : (cur.zoomBefore || 'auto');
  else { cur.zoomBefore = pv.currentScaleValue; pv.updateScale({ scaleFactor: 2.2, origin }); }
}

// ---- keep the screen awake while reading (optional) ----
let wakeLock = null;
const wakeLockSupported = () => 'wakeLock' in navigator;
async function applyWakeLock() {
  if (!wakeLockSupported() || !cur || lsGet('fale-wakelock', '0') !== '1' || document.visibilityState !== 'visible') return;
  if (wakeLock && !wakeLock.released) return;
  try {
    wakeLock = await navigator.wakeLock.request('screen');
    wakeLock.addEventListener('release', () => { wakeLock = null; });
  } catch { wakeLock = null; }
}
function releaseWakeLock() { if (wakeLock) { wakeLock.release().catch(() => {}); wakeLock = null; } }
function toggleWakeSetting() {
  const on = lsGet('fale-wakelock', '0') !== '1';
  lsSet('fale-wakelock', on ? '1' : '0');
  if (on) { applyWakeLock(); toast('Der Bildschirm bleibt beim Lesen an.'); }
  else { releaseWakeLock(); toast('Der Bildschirm schaltet sich wieder normal ab.'); }
}

// ---- Lesemodus (reflow) ----
async function openReflowMode() {
  if (!cur || cur.reflow || cur.reflowLoading) return;
  const session = cur;
  session.reflowLoading = true;
  try {
    const { openReflow } = await import('./tools/reader.js');
    if (session !== cur) return;
    const host = h('<div class="rf-overlay"></div>');
    root().appendChild(host);
    session.reflowHost = host;
    session.reflow = await openReflow(host, {
      pdf: session.pdf, docId: session.doc.id, title: session.doc.name,
      startPage: S.pdfViewer.currentPageNumber, onClose: p => closeReflow(p),
    });
  } catch (e) { errorToast(e, 'Der Lesemodus konnte nicht geöffnet werden.'); }
  finally { session.reflowLoading = false; }
}
function closeReflow(page) {
  const session = cur;
  if (!session || !session.reflow) return;
  session.reflow.destroy();
  session.reflow = null;
  if (session.reflowHost) { session.reflowHost.remove(); session.reflowHost = null; }
  if (page) S.pdfViewer.currentPageNumber = Math.min(page, session.pdf.numPages);
  q('container').focus({ preventScroll: true });
}

const saveLastPage = debounce(n => { if (cur) db.updateDoc(cur.doc.id, { lastPage: n }).catch(() => {}); }, 700);

// ---- print ----
// Android app: the WebView ignores window.print() → the PDF goes to the system print dialog
// (platform.printPdf). Web: pages are rendered to images so printing looks the same in every browser.
async function printDoc() {
  if (!cur) return;
  const session = cur;
  if (isNative()) { await printNative(session); return; }
  const n = session.pdf.numPages;
  if (n > 300) { toast('Zum Drucken sehr großer Dokumente bitte herunterladen und extern drucken.', 'error'); return; }
  const prog = progress('Druck wird vorbereitet …');
  const area = document.getElementById('print-area');
  area.innerHTML = '';
  const urls = [];
  try {
    for (let i = 1; i <= n; i++) {
      prog.set(`Druck wird vorbereitet … ${i}/${n}`);
      const page = await session.pdf.getPage(i);
      const canvas = await renderPage(page, { scale: 150 / 72 });
      const blob = await canvasToBlob(canvas, 'image/jpeg', 0.92);
      const url = URL.createObjectURL(blob);
      urls.push(url);
      const img = new Image();
      img.src = url;
      img.alt = '';
      area.appendChild(img);
      page.cleanup();
    }
    await Promise.all(Array.from(area.querySelectorAll('img')).map(img => img.decode().catch(() => {})));
    prog.done();
    const cleanup = () => { area.innerHTML = ''; urls.forEach(u => URL.revokeObjectURL(u)); window.removeEventListener('afterprint', cleanup); };
    window.addEventListener('afterprint', cleanup);
    window.print();
  } catch (e) {
    prog.done();
    area.innerHTML = '';
    urls.forEach(u => URL.revokeObjectURL(u));
    errorToast(e, 'Drucken fehlgeschlagen.');
  }
}

async function printNative(session) {
  const prog = progress('Druck wird vorbereitet …');
  try {
    // password-protected PDFs cannot be opened by the system print preview → print an unprotected image copy
    const bytes = knownPassword(session.doc.id)
      ? await imagePdf(session, (i, n) => prog.set(`Druck wird vorbereitet … ${i}/${n}`))
      : new Uint8Array(await (await db.getFile(session.doc.id)).arrayBuffer());
    prog.done();
    await printPdf(bytes, session.doc.name);
  } catch (e) {
    prog.done();
    errorToast(e, 'Drucken fehlgeschlagen.');
  }
}

/** PDF made of page images (150 dpi JPEG) – used to print protected documents. */
async function imagePdf(session, onPage) {
  const { loadPdfLib } = await import('./pdflib.js');
  const PDFLib = await loadPdfLib();
  const out = await PDFLib.PDFDocument.create();
  const n = session.pdf.numPages;
  if (n > 300) throw Object.assign(new Error('too many pages'), { userMessage: 'Zum Drucken sehr großer Dokumente bitte herunterladen und extern drucken.' });
  for (let i = 1; i <= n; i++) {
    onPage(i, n);
    const page = await session.pdf.getPage(i);
    const vp = page.getViewport({ scale: 1, rotation: page.rotate });
    const canvas = await renderPage(page, { scale: 150 / 72 });
    const jpg = await out.embedJpg(new Uint8Array(await (await canvasToBlob(canvas, 'image/jpeg', 0.92)).arrayBuffer()));
    canvas.width = canvas.height = 0;
    out.addPage([vp.width, vp.height]).drawImage(jpg, { x: 0, y: 0, width: vp.width, height: vp.height });
    page.cleanup();
  }
  return out.save();
}

// ---- read aloud ----
function fillVoices() {
  const sel = q('readvoice');
  if (!sel) return;
  const voices = getVoices();
  const saved = lsGet('fale-voice', '');
  sel.innerHTML = voices.length ? '' : '<option value="">Standardstimme</option>';
  voices.forEach(v => {
    const o = document.createElement('option');
    o.value = v.voiceURI;
    o.textContent = `${v.name} (${v.lang})`;
    if (v.voiceURI === saved) o.selected = true;
    sel.appendChild(o);
  });
}

async function startReading(fromPage) {
  if (!cur) return;
  if (!speechSupported) { toast('Vorlesen wird von diesem Browser nicht unterstützt.', 'error'); return; }
  const session = cur;
  if (!session.reader) {
    session.reader = new ReadAloud({
      numPages: session.pdf.numPages,
      getPageText: async p => {
        if (!session.texts) session.texts = (await db.getText(session.doc.id)) || [];
        if (typeof session.texts[p - 1] === 'string' && session.texts[p - 1]) return session.texts[p - 1];
        const page = await session.pdf.getPage(p);
        return pageText(page);
      },
      onPage: p => {
        if (session !== cur) return;
        $$('.page.reading', root()).forEach(x => x.classList.remove('reading'));
        S.pdfViewer.currentPageNumber = p;
        const pv = S.pdfViewer.getPageView(p - 1);
        if (pv && pv.div) pv.div.classList.add('reading');
      },
      onState: (state, p) => {
        if (session !== cur) return;
        const play = q('readplay');
        play.innerHTML = icon(state === 'playing' ? 'pause' : 'play');
        play.setAttribute('aria-label', state === 'playing' ? 'Pause' : 'Weiter vorlesen');
        q('readstatus').textContent = state === 'finished' ? 'Fertig gelesen' : `Seite ${p} von ${session.pdf.numPages}`;
        if (state === 'finished') { $$('.page.reading', root()).forEach(x => x.classList.remove('reading')); }
      },
    });
    session.reader.voiceURI = lsGet('fale-voice', '') || null;
    session.reader.rate = parseFloat(q('readrate').value) || 1;
  }
  fillVoices();
  q('readbar').hidden = false;
  root().classList.remove('chrome-hidden');
  try {
    await session.reader.start(fromPage || S.pdfViewer.currentPageNumber || 1);
  } catch (e) { errorToast(e, 'Vorlesen nicht möglich.'); }
}

function stopReading() {
  if (cur && cur.reader) cur.reader.stop();
  q('readbar').hidden = true;
  $$('.page.reading', root()).forEach(x => x.classList.remove('reading'));
}

// ---- open / close ----
export async function openViewer(id, opts = {}) {
  opening++;
  try { return await openViewerInner(id, opts); } finally { opening--; }
}

async function openViewerInner(id, { page = null, query = null, read = false } = {}) {
  init();
  import('./tools/common.js').then(m => m.ensureCss()).catch(() => {});
  const token = ++openToken;
  if (cur && cur.doc.id === id) {
    // same document: just navigate
    if (page) S.pdfViewer.currentPageNumber = Math.min(page, cur.pdf.numPages);
    if (query) openFind(query);
    if (read) startReading();
    return;
  }
  await closeViewer({ keepVisible: true });
  const el = root();
  el.hidden = false;
  el.classList.remove('chrome-hidden', 'has-find');
  el.classList.toggle('night', lsGet('fale-night', '0') === '1');
  q('night').setAttribute('aria-pressed', String(el.classList.contains('night')));
  q('loading').hidden = false;
  q('findbar').hidden = true;
  q('readbar').hidden = true;
  q('findinput').value = '';
  q('title').textContent = 'Dokument';
  q('subtitle').textContent = '';

  const doc = await db.getDoc(id);
  if (token !== openToken) return;
  if (!doc) { toast('Dokument nicht gefunden.', 'error'); onCloseRequest(); return; }
  q('title').textContent = doc.name;
  q('subtitle').textContent = pagesLabel(doc.pages);
  document.title = `${doc.name} – FaLe PDF`;
  db.updateDoc(id, { openedAt: Date.now() }).catch(() => {});

  let pdf;
  try {
    const blob = await db.getFile(id);
    if (!blob) throw Object.assign(new Error('missing'), { userMessage: 'Die Datei fehlt im Speicher.' });
    const buf = await blob.arrayBuffer();
    ({ pdf } = await loadPdf(buf, { name: doc.name, key: id }));
  } catch (e) {
    if (token !== openToken) return;
    errorToast(e, 'Das Dokument konnte nicht geöffnet werden.');
    onCloseRequest();
    return;
  }
  if (token !== openToken) { pdf.destroy(); return; }

  cur = { doc, pdf, thumbsBuilt: false, outlineBuilt: false, reader: null, texts: null };
  try {
    const p1 = await pdf.getPage(1);
    const vp = p1.getViewport({ scale: 1 });
    cur.firstRatio = vp.height / vp.width;
  } catch {}
  q('pagecount').textContent = String(pdf.numPages);
  q('subtitle').textContent = pagesLabel(pdf.numPages);
  q('thumbs').innerHTML = '';
  q('outline').innerHTML = '';
  $$('[data-ptab]', root()).forEach(x => x.setAttribute('aria-selected', String(x.dataset.ptab === 'thumbs')));
  q('thumbs').hidden = false;
  q('outline').hidden = true;
  q('marks').hidden = true;
  q('marks').innerHTML = '';

  const defaultZoom = await db.getSetting('defaultZoom', 'auto');
  const prog = getReadingProgress(id);
  const startPage = Math.min(page || doc.lastPage || (prog && prog.page) || 1, pdf.numPages);
  const onInit = () => {
    S.eventBus.off('pagesinit', onInit);
    if (!cur || cur.pdf !== pdf) return;
    S.pdfViewer.currentScaleValue = defaultZoom;
    if (startPage > 1) S.pdfViewer.currentPageNumber = startPage;
    q('loading').hidden = true;
    syncMarkButton();
    // image-only PDF (scan/photo): offer the text recognition
    import('./ocr/banner.js').then(m => m.showScanBanner(q('stage'), { docId: id, pdf, isCurrent: () => !!cur && cur.pdf === pdf })).catch(() => {});
    saveProgress(id, startPage, pdf.numPages);
    applyWakeLock();
    if (query) openFind(query);
    if (read) startReading(startPage);
  };
  S.eventBus.on('pagesinit', onInit);
  S.pdfViewer.setDocument(pdf);
  S.linkService.setDocument(pdf, null);
  q('pagenum').value = String(startPage);

  // side panel default: open on desktop if remembered
  const p = q('vpanel');
  if (!isCompact() && lsGet('fale-panel', '0') === '1') { p.hidden = false; p.classList.add('open'); q('panel').setAttribute('aria-pressed', 'true'); buildThumbs(); }
  else { p.classList.remove('open'); p.hidden = !isCompact() ? true : false; q('panel').setAttribute('aria-pressed', 'false'); }
  setTimeout(() => q('container').focus({ preventScroll: true }), 50);
}

export async function closeViewer({ keepVisible = false } = {}) {
  const el = root();
  if (cur) {
    const session = cur;
    cur = null;
    if (session.reader) session.reader.stop();
    if (session.reflow) { try { session.reflow.destroy(); } catch {} session.reflow = null; }
    if (session.reflowHost) { session.reflowHost.remove(); session.reflowHost = null; }
    releaseWakeLock();
    if (session.thumbObserver) session.thumbObserver.disconnect();
    try {
      // pdf.js fetches all pages right after the first one is rendered; destroying the document
      // in the middle of that logs errors. Wait for it (briefly) once it has started.
      const pv = S.pdfViewer;
      const first = pv._pages && pv._pages[0];
      if (pv.pagesPromise && first && first.renderingState === 3) {
        await Promise.race([pv.pagesPromise.catch(() => {}), new Promise(r => setTimeout(r, 2000))]);
      }
    } catch {}
    try {
      S.pdfViewer.setDocument(null);
      S.linkService.setDocument(null);
    } catch (e) { console.warn(e); }
    try { await session.pdf.destroy(); } catch {}
  }
  if (S) {
    q('stage').querySelectorAll('.ocr-banner').forEach(b => b.remove());
    q('thumbs').innerHTML = '';
    q('outline').innerHTML = '';
    q('marks').innerHTML = '';
    q('readbar').hidden = true;
  }
  if (!keepVisible) {
    ++openToken;
    el.hidden = true;
    document.title = 'FaLe PDF';
  }
}

export function currentDocId() { return cur ? cur.doc.id : null; }
