// Textverarbeitung: open/edit .docx, .txt, .md; save .docx/.txt/.md; export PDF.
import * as db from '../db.js';
import { $, $$, h, esc, toast, errorToast, showMenu, openDialog, promptDialog, debounce, pickFiles, downloadBlob, shareBlob, confirmDialog } from '../ui.js';
import { createShell, exportPdfFlow, tb } from './shell.js';
import { officeMenu, oicon, KINDS, stripExt } from './kinds.js';
import { htmlToModel, modelToText, modelToMarkdown, textToHtml, markdownToHtml } from './docmodel.js';
import { DOC_TEMPLATES } from './templates.js';
import { fileToDataUrl, decodeText } from './vendor.js';
import { speechSupported, ReadAloud, getVoices } from '../readaloud.js';
export { decodeText };

const PX = 96 / 72; // pt → css px

export async function mountWriter(screen, { id = null, template = null }) {
  let meta = null, kind = 'docx', name = 'Dokument.docx', html = '<p><br></p>', page = null, baseSize = 11, hf = null;
  screen.body.innerHTML = '<div class="v-loading"><div><span class="spinner dark" style="width:30px;height:30px"></span><span>Dokument wird geöffnet …</span></div></div>';
  if (id) {
    meta = await db.getDoc(id);
    if (!meta) throw Object.assign(new Error('missing'), { userMessage: 'Dokument nicht gefunden.' });
    kind = meta.kind; name = meta.name;
    const blob = await db.getFile(id);
    if (kind === 'docx') {
      const { docxToHtml } = await import('./docx-read.js');
      const r = await docxToHtml(await blob.arrayBuffer(), name);
      html = r.html; page = r.page; baseSize = r.baseSize || 11; hf = r.hf || null;
    } else {
      const text = await decodeText(blob);
      html = kind === 'md' ? markdownToHtml(text) : textToHtml(text);
    }
    db.updateDoc(id, { openedAt: Date.now() }).catch(() => {});
  } else {
    const t = DOC_TEMPLATES.find(x => x.id === template) || DOC_TEMPLATES[0];
    html = t.html();
    name = (t.id === 'leer' ? 'Neues Dokument' : t.title.replace(/ – /g, ' ')) + '.docx';
  }
  if (screen.signal.aborted) return;
  page = page || { w: 595.3, h: 841.9, mt: 70.9, mr: 70.9, mb: 56.7, ml: 70.9 };
  const plain = kind === 'txt';

  const shell = createShell(screen, {
    id, name, kind,
    serialize: () => serialize(kind),
    menu: () => [
      { label: 'Als PDF exportieren', icon: 'kpdf', onClick: exportPdf },
      { label: 'Word-Datei (.docx) herunterladen', icon: 'download', onClick: () => dl('docx') },
      { label: 'Als Text (.txt) herunterladen', icon: 'download', onClick: () => dl('txt') },
      { label: 'Als Markdown (.md) herunterladen', icon: 'download', onClick: () => dl('md') },
      kind !== 'docx' ? { label: 'Als Word-Dokument speichern', icon: 'kdoc', onClick: async () => { const b = await serialize('docx'); await shell.saveAsKind(b, 'docx'); } } : null,
      '-',
      { label: 'Suchen & ersetzen', icon: 'replace', onClick: () => openFind(true) },
      { label: 'Seite einrichten …', icon: 'pageSetup', onClick: () => pageSetup() },
      { label: 'Inhaltsverzeichnis einfügen', icon: 'toc', onClick: () => insertToc() },
      speechSupported ? { label: 'Vorlesen', icon: 'speaker', onClick: () => readAloud() } : null,
      aiCaps.summarize ? { label: 'Zusammenfassen (auf dem Gerät)', icon: 'summary', onClick: () => import('../extras/ai.js').then(m => m.aiForText(ed.innerText, 'summarize', { title: shell.name })) } : null,
      aiCaps.translate ? { label: 'Übersetzen (auf dem Gerät)', icon: 'translate', onClick: () => import('../extras/ai.js').then(m => m.aiForText(ed.innerText, 'translate', { title: shell.name })) } : null,
      '-',
      { label: 'Teilen', icon: 'share', onClick: async () => { const b = await serialize(kind); shareBlob(b, shell.name, KINDS[kind].mime); } },
      { label: 'Kopie speichern unter …', icon: 'copy', onClick: () => shell.save({ asCopy: true }) },
      { label: 'Umbenennen', icon: 'edit', onClick: () => shell.rename() },
    ],
  });

  // ---------- DOM ----------
  screen.body.innerHTML = '';
  screen.body.classList.add('office-body');
  const wrap = h(`<div class="writer">
    <div class="office-toolbar" role="toolbar" aria-label="Formatierung">
      <div class="tb-group">${tb('undo', 'Rückgängig', 'data-cmd="undo"')}${tb('redo', 'Wiederholen', 'data-cmd="redo"')}</div>
      <div class="tb-group">
        <label class="sr-only" for="w-block">Absatzformat</label>
        <select class="tb-select" id="w-block" data-block title="Absatzformat">
          <option value="p">Text</option><option value="h1">Überschrift 1</option><option value="h2">Überschrift 2</option><option value="h3">Überschrift 3</option><option value="subtitle">Untertitel</option><option value="blockquote">Zitat</option>
        </select>
        <label class="sr-only" for="w-size">Schriftgröße</label>
        <select class="tb-select tb-size" id="w-size" data-size title="Schriftgröße">
          <option value="">Größe</option>${[8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 36].map(s => `<option value="${s}">${s} pt</option>`).join('')}
        </select>
      </div>
      <div class="tb-group">${tb('bold', 'Fett (Strg+B)', 'data-cmd="bold"')}${tb('italic', 'Kursiv (Strg+I)', 'data-cmd="italic"')}${tb('underline', 'Unterstrichen (Strg+U)', 'data-cmd="underline"')}${tb('strike', 'Durchgestrichen', 'data-cmd="strikeThrough"')}
        <span class="tb-color">${tb('color', 'Textfarbe', 'data-color="fore"')}<span class="tb-swatch" data-swatch="fore" style="background:#C2410C"></span></span>
        <span class="tb-color">${tb('fill', 'Hervorheben', 'data-color="back"')}<span class="tb-swatch" data-swatch="back" style="background:#FDE047"></span></span>
      </div>
      <div class="tb-group">${tb('alignLeft', 'Linksbündig', 'data-cmd="justifyLeft"')}${tb('alignCenter', 'Zentriert', 'data-cmd="justifyCenter"')}${tb('alignRight', 'Rechtsbündig', 'data-cmd="justifyRight"')}${tb('alignJustify', 'Blocksatz', 'data-cmd="justifyFull"')}</div>
      <div class="tb-group">${tb('listUl', 'Aufzählung', 'data-cmd="insertUnorderedList"')}${tb('listOl', 'Nummerierung', 'data-cmd="insertOrderedList"')}</div>
      <div class="tb-group">${tb('table', 'Tabelle', 'data-table')}${tb('image', 'Bild einfügen', 'data-image')}${tb('link', 'Link', 'data-link')}${tb('pages', 'Seitenumbruch', 'data-pagebreak')}</div>
      <div class="tb-group">${tb('outline', 'Gliederung', 'data-panel="outline"')}${tb('toc', 'Inhaltsverzeichnis einfügen', 'data-toc')}${tb('comment', 'Kommentar hinzufügen', 'data-comment')}${tb('footnote', 'Fußnote einfügen', 'data-footnote')}${tb('pageSetup', 'Seite einrichten: Format, Ränder, Kopf- und Fußzeile', 'data-pagesetup')}</div>
      <div class="tb-group">${tb('spell', 'Rechtschreibprüfung', 'data-spell')}${tb('mic', 'Diktieren', 'data-dictate hidden')}${tb('speaker', 'Vorlesen', 'data-read' + (speechSupported ? '' : ' hidden'))}${tb('replace', 'Suchen & ersetzen (Strg+F)', 'data-find')}</div>
    </div>
    <div class="findbar w-find" hidden>
      <input class="input" type="search" data-fq placeholder="Suchen …" aria-label="Suchbegriff">
      <span class="find-count" data-fcount aria-live="polite"></span>
      <button class="icon-btn" type="button" data-fprev aria-label="Vorheriger Treffer">${oicon('chevronUp')}</button>
      <button class="icon-btn" type="button" data-fnext aria-label="Nächster Treffer">${oicon('chevronDown')}</button>
      <input class="input" type="text" data-fr placeholder="Ersetzen durch …" aria-label="Ersetzen durch">
      <button class="btn btn-ghost btn-sm" type="button" data-frep>Ersetzen</button>
      <button class="btn btn-ghost btn-sm" type="button" data-freall>Alle</button>
      <button class="icon-btn" type="button" data-fclose aria-label="Suche schließen">${oicon('close')}</button>
    </div>
    <div class="writer-main">
      <aside class="w-panel w-outline" hidden aria-label="Gliederung"><div class="w-panel-head"><strong>Gliederung</strong><button class="icon-btn" type="button" data-close-panel aria-label="Gliederung schließen">${oicon('close')}</button></div><nav class="w-outline-list"></nav></aside>
      <div class="writer-scroll"><div class="doc-sheet">
        <button class="doc-hf top" type="button" data-hf="header" hidden></button>
        <div class="doc-page${plain ? ' plain-text' : ''}" contenteditable="true" spellcheck="true" lang="de-DE" role="textbox" aria-multiline="true" aria-label="Dokumentinhalt"></div>
        <div class="doc-fn-area" hidden></div>
        <button class="doc-hf bottom" type="button" data-hf="footer" hidden></button>
      </div></div>
      <aside class="w-panel w-comments" hidden aria-label="Kommentare"><div class="w-panel-head"><strong>Kommentare</strong><button class="icon-btn" type="button" data-close-panel aria-label="Kommentare schließen">${oicon('close')}</button></div><div class="w-cmt-list"></div></aside>
    </div>
    <div class="readbar w-readbar" hidden></div>
    <div class="dictate-pill" hidden aria-live="polite"></div>
    <input type="color" class="sr-only" data-colorinput aria-label="Farbe wählen" tabindex="-1">
  </div>`);
  screen.body.appendChild(wrap);
  const ed = $('.doc-page', wrap);
  const sheet = $('.doc-sheet', wrap);
  sheet.style.setProperty('--page-w', `${page.w * PX}px`);
  ed.style.setProperty('--pad-t', `${page.mt * PX}px`);
  ed.style.setProperty('--pad-r', `${page.mr * PX}px`);
  ed.style.setProperty('--pad-b', `${page.mb * PX}px`);
  ed.style.setProperty('--pad-l', `${page.ml * PX}px`);
  ed.style.fontSize = `${baseSize}pt`;
  ed.innerHTML = html;
  stripBlockWhitespace(ed);
  try { document.execCommand('styleWithCSS', false, false); document.execCommand('defaultParagraphSeparator', false, 'p'); } catch {}

  const status = h('<span class="foot-info" data-wordcount aria-live="off"></span>');
  screen.setFoot([], ' ');
  screen.foot.innerHTML = '';
  screen.foot.appendChild(status);
  screen.foot.classList.add('office-foot');
  screen.foot.hidden = false;

  let aiCaps = { summarize: false, translate: false };
  import('../extras/ai.js').then(m => m.aiCapabilities()).then(c => { aiCaps = c; }).catch(() => {});
  const countWords = () => {
    const text = ed.innerText || '';
    const words = (text.match(/[\p{L}\p{N}]+(?:['’\-.][\p{L}\p{N}]+)*/gu) || []).length;
    const chars = text.replace(/\n/g, '').length;
    status.textContent = `${words.toLocaleString('de-DE')} Wörter · ${chars.toLocaleString('de-DE')} Zeichen${kind !== 'docx' ? ` · ${KINDS[kind].label}` : ''}`;
  };
  countWords();
  const onInput = debounce(() => { countWords(); if (findOpen) runFind(false); refreshStructure(); }, 250);
  ed.addEventListener('input', () => { shell.markDirty(); onInput(); });

  // ---------- serialize / export ----------
  async function serialize(k) {
    const model = htmlToModel(ed, { baseSize });
    if (plain) model.tight = true;
    if (k === 'docx') {
      const { modelToDocx } = await import('./docx-write.js');
      const blob = await modelToDocx(model, { title: stripExt(shell.name), page, hf, author: await authorName() });
      return new Blob([blob], { type: KINDS.docx.mime });
    }
    if (k === 'md') return new Blob([modelToMarkdown(model)], { type: 'text/markdown;charset=utf-8' });
    return new Blob([modelToText(model).replace(/\n/g, '\r\n')], { type: 'text/plain;charset=utf-8' });
  }
  async function dl(k) {
    try { downloadBlob(await serialize(k), stripExt(shell.name) + KINDS[k].ext); } catch (e) { errorToast(e, 'Export fehlgeschlagen.'); }
  }
  async function exportPdf() {
    const model = htmlToModel(ed, { baseSize });
    if (plain) model.tight = true;
    const { modelToPdf } = await import('./docpdf.js');
    await exportPdfFlow(shell.name, onP => modelToPdf(model, { title: stripExt(shell.name), page, hf, onProgress: onP }));
  }

  // ---------- toolbar ----------
  const tbEl = $('.office-toolbar', wrap);
  let savedRange = null;
  const saveSel = () => { const s = getSelection(); if (s.rangeCount && ed.contains(s.anchorNode)) savedRange = s.getRangeAt(0).cloneRange(); };
  const restoreSel = () => {
    const cur = getSelection();
    if (cur.rangeCount && ed.contains(cur.anchorNode)) { savedRange = cur.getRangeAt(0).cloneRange(); }
    ed.focus();
    if (!savedRange) return;
    const s = getSelection(); s.removeAllRanges(); s.addRange(savedRange);
  };
  // keep the editor selection when tapping toolbar buttons
  tbEl.addEventListener('mousedown', e => { if (e.target.closest('button')) e.preventDefault(); });
  tbEl.addEventListener('pointerdown', saveSel, true);
  const exec = (cmd, val = null) => { restoreSel(); document.execCommand(cmd, false, val); shell.markDirty(); updateState(); onInput(); };

  tbEl.addEventListener('click', async e => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.cmd) {
      if (b.dataset.cmd === 'undo' || b.dataset.cmd === 'redo') { ed.focus(); document.execCommand(b.dataset.cmd); onInput(); updateState(); return; }
      exec(b.dataset.cmd);
    }
    if (b.dataset.color) pickColor(b.dataset.color);
    if (b.hasAttribute('data-table')) tableAction(b);
    if (b.hasAttribute('data-image')) insertImage();
    if (b.hasAttribute('data-link')) insertLink();
    if (b.hasAttribute('data-pagebreak')) { restoreSel(); document.execCommand('insertHTML', false, '<hr data-page-break><p><br></p>'); shell.markDirty(); }
    if (b.hasAttribute('data-find')) openFind(true);
    if (b.dataset.panel) togglePanel(b.dataset.panel);
    if (b.hasAttribute('data-toc')) insertToc();
    if (b.hasAttribute('data-comment')) addComment();
    if (b.hasAttribute('data-footnote')) insertFootnote();
    if (b.hasAttribute('data-pagesetup')) pageSetup();
    if (b.hasAttribute('data-spell')) setSpell(!spellOn);
    if (b.hasAttribute('data-dictate')) toggleDictation();
    if (b.hasAttribute('data-read')) readAloud();
  });
  const blockSel = $('[data-block]', wrap);
  blockSel.addEventListener('change', () => {
    const v = blockSel.value;
    restoreSel();
    if (v === 'subtitle') {
      document.execCommand('formatBlock', false, 'p');
      const blk = currentBlock();
      if (blk) blk.classList.add('subtitle');
    } else {
      const blk = currentBlock();
      if (blk) blk.classList.remove('subtitle');
      document.execCommand('formatBlock', false, v);
    }
    shell.markDirty(); updateState();
  });
  const sizeSel = $('[data-size]', wrap);
  sizeSel.addEventListener('change', () => {
    const pt = sizeSel.value;
    if (!pt) return;
    restoreSel();
    document.execCommand('fontSize', false, '7');
    $$('font[size="7"]', ed).forEach(f => {
      const span = document.createElement('span');
      span.style.fontSize = `${pt}pt`;
      while (f.firstChild) span.appendChild(f.firstChild);
      f.replaceWith(span);
    });
    shell.markDirty(); updateState();
  });
  const colorInput = $('[data-colorinput]', wrap);
  let colorMode = 'fore';
  function pickColor(mode) {
    colorMode = mode;
    const palette = mode === 'fore' ? ['#1A1A1A', '#C2410C', '#B91C1C', '#3B37A0', '#0B8F80', '#15803D', '#7E22CE', '#6B7194'] : ['#FDE047', '#A7F3D0', '#BFDBFE', '#FBCFE8', '#FED7AA', '#FFFFFF'];
    const anchor = $(`[data-color="${mode}"]`, wrap);
    officeMenu(anchor, [
      ...palette.map(c => ({ label: c === '#FFFFFF' ? 'Keine Hervorhebung' : mode === 'fore' ? colorName(c) : `Markieren: ${colorName(c)}`, icon: mode === 'fore' ? 'color' : 'fill', onClick: () => applyColor(c) })),
      '-',
      { label: 'Eigene Farbe …', icon: 'sparkle', onClick: () => { colorInput.value = '#3B37A0'; colorInput.click(); } },
    ], { label: mode === 'fore' ? 'Textfarbe' : 'Hervorheben' });
  }
  colorInput.addEventListener('change', () => applyColor(colorInput.value));
  function applyColor(c) {
    restoreSel();
    if (colorMode === 'fore') document.execCommand('foreColor', false, c);
    else { document.execCommand('styleWithCSS', false, true); document.execCommand('hiliteColor', false, c === '#FFFFFF' ? 'transparent' : c); document.execCommand('styleWithCSS', false, false); }
    $(`[data-swatch="${colorMode}"]`, wrap).style.background = c;
    shell.markDirty();
  }

  function currentBlock() {
    const s = getSelection();
    let n = s.rangeCount ? s.anchorNode : null;
    while (n && n !== ed) {
      if (n.nodeType === 1 && /^(P|H[1-6]|LI|BLOCKQUOTE|PRE|DIV|TD)$/.test(n.tagName)) return n;
      n = n.parentNode;
    }
    return null;
  }

  function updateState() {
    for (const b of $$('[data-cmd]', tbEl)) {
      const c = b.dataset.cmd;
      if (['bold', 'italic', 'underline', 'strikeThrough', 'insertUnorderedList', 'insertOrderedList', 'justifyCenter', 'justifyRight', 'justifyFull'].includes(c)) {
        let on = false;
        try { on = document.queryCommandState(c); } catch {}
        b.setAttribute('aria-pressed', String(on));
      }
    }
    const blk = currentBlock();
    if (blk) {
      let v = 'p';
      const hd = blk.closest('h1,h2,h3,blockquote');
      if (hd && ed.contains(hd)) v = hd.tagName.toLowerCase();
      else if (blk.classList.contains('subtitle')) v = 'subtitle';
      blockSel.value = ['h1', 'h2', 'h3', 'blockquote', 'subtitle'].includes(v) ? v : 'p';
      const fs = parseFloat(getComputedStyle(blk.nodeType === 1 ? (getSelection().anchorNode.parentElement || blk) : blk).fontSize) * 0.75;
      const opt = Math.round(fs);
      sizeSel.value = [8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 36].includes(opt) ? String(opt) : '';
    }
  }
  const onSelChange = () => { if (ed.contains(getSelection().anchorNode)) { saveSel(); updateState(); } };
  document.addEventListener('selectionchange', onSelChange);

  // ---------- tables ----------
  function cellOfSelection() {
    const s = getSelection();
    const n = s.rangeCount ? s.anchorNode : null;
    const el = n && (n.nodeType === 1 ? n : n.parentElement);
    const td = el && el.closest('td,th');
    return td && ed.contains(td) ? td : null;
  }
  async function tableAction(btn) {
    const td = cellOfSelection() || (savedRange && (savedRange.startContainer.nodeType === 1 ? savedRange.startContainer : savedRange.startContainer.parentElement).closest('td,th'));
    if (td && ed.contains(td)) {
      const tr = td.parentElement, table = td.closest('table');
      const ci = Array.from(tr.cells).indexOf(td);
      const newCell = () => { const c = document.createElement('td'); c.innerHTML = '<p><br></p>'; return c; };
      const op = fn => { fn(); shell.markDirty(); };
      officeMenu(btn, [
        { label: 'Zeile oberhalb einfügen', icon: 'rowAdd', onClick: () => op(() => { const r = tr.cloneNode(false); Array.from(tr.cells).forEach(() => r.appendChild(newCell())); tr.before(r); }) },
        { label: 'Zeile unterhalb einfügen', icon: 'rowAdd', onClick: () => op(() => { const r = tr.cloneNode(false); Array.from(tr.cells).forEach(() => r.appendChild(newCell())); tr.after(r); }) },
        { label: 'Spalte links einfügen', icon: 'colAdd', onClick: () => op(() => { Array.from(table.rows).forEach(r => { const c = r.cells[Math.min(ci, r.cells.length - 1)]; c ? c.before(newCell()) : r.appendChild(newCell()); }); table.querySelector('colgroup')?.remove(); }) },
        { label: 'Spalte rechts einfügen', icon: 'colAdd', onClick: () => op(() => { Array.from(table.rows).forEach(r => { const c = r.cells[Math.min(ci, r.cells.length - 1)]; c ? c.after(newCell()) : r.appendChild(newCell()); }); table.querySelector('colgroup')?.remove(); }) },
        '-',
        { label: 'Zeile löschen', icon: 'rowDel', onClick: () => op(() => { if (table.rows.length > 1) tr.remove(); else table.remove(); }) },
        { label: 'Spalte löschen', icon: 'colDel', onClick: () => op(() => { Array.from(table.rows).forEach(r => { const c = r.cells[Math.min(ci, r.cells.length - 1)]; if (c) c.remove(); }); table.querySelector('colgroup')?.remove(); if (!table.rows[0] || !table.rows[0].cells.length) table.remove(); }) },
        { label: table.classList.contains('borderless') ? 'Rahmen anzeigen' : 'Rahmen ausblenden', icon: 'table', onClick: () => op(() => table.classList.toggle('borderless')) },
        { label: 'Tabelle löschen', icon: 'trash', danger: true, onClick: () => op(() => table.remove()) },
      ], { label: 'Tabelle bearbeiten' });
      return;
    }
    const r = await openDialog({
      title: 'Tabelle einfügen',
      body: `<div class="field-row"><label class="field"><span class="field-label">Zeilen</span><input class="input" type="number" min="1" max="200" value="3" name="rows"></label>
        <label class="field"><span class="field-label">Spalten</span><input class="input" type="number" min="1" max="20" value="3" name="cols"></label></div>
        <label class="check"><input type="checkbox" name="head" checked> Erste Zeile als Kopfzeile hervorheben</label>`,
      actions: [{ label: 'Abbrechen', value: 'cancel' }, { label: 'Einfügen', value: 'ok', kind: 'btn-primary', default: true }],
      onMount: dlg => ({ collect: () => ({ rows: +$('[name=rows]', dlg).value, cols: +$('[name=cols]', dlg).value, head: $('[name=head]', dlg).checked }) }),
    });
    if (r.value !== 'ok') return;
    const rows = Math.max(1, Math.min(200, r.data.rows || 3)), cols = Math.max(1, Math.min(20, r.data.cols || 3));
    let t = '<table><tbody>';
    for (let i = 0; i < rows; i++) {
      t += '<tr>' + Array.from({ length: cols }, () => (i === 0 && r.data.head ? '<td style="background-color:#E9E8FB"><p><strong><br></strong></p></td>' : '<td><p><br></p></td>')).join('') + '</tr>';
    }
    t += '</tbody></table><p><br></p>';
    restoreSel();
    document.execCommand('insertHTML', false, t);
    shell.markDirty();
  }

  // ---------- images / links ----------
  async function insertImage(files) {
    const list = files || await pickFiles({ accept: 'image/*', multiple: false });
    if (!list || !list.length) return;
    try {
      const { url, w } = await fileToDataUrl(list[0], 1800);
      const maxW = Math.round((page.w - page.ml - page.mr) * PX);
      const width = Math.min(w, maxW);
      restoreSel();
      document.execCommand('insertHTML', false, `<img src="${url}" alt="${esc(list[0].name || 'Bild')}" width="${width}">`);
      shell.markDirty();
    } catch (e) { errorToast(e, 'Das Bild konnte nicht eingefügt werden.'); }
  }
  async function insertLink() {
    const s = savedRange ? savedRange.toString() : '';
    const url = await promptDialog('Link einfügen', 'Adresse (https://…)', 'https://', { okLabel: 'Einfügen' });
    if (!url || url === 'https://') return;
    const href = /^(https?:|mailto:|tel:)/i.test(url) ? url : `https://${url}`;
    restoreSel();
    if (s) document.execCommand('createLink', false, href);
    else document.execCommand('insertHTML', false, `<a href="${esc(href)}">${esc(url)}</a>&nbsp;`);
    shell.markDirty();
  }
  ed.addEventListener('click', e => {
    const img = e.target.closest('img');
    if (img && ed.contains(img)) {
      $$('img.sel', ed).forEach(i => i.classList.remove('sel'));
      img.classList.add('sel');
      const resize = f => { const cur = img.width || img.naturalWidth; const max = Math.round((page.w - page.ml - page.mr) * PX); img.width = Math.max(40, Math.min(max, Math.round(f === 'full' ? max : cur * f))); img.removeAttribute('height'); shell.markDirty(); };
      officeMenu(img, [
        { label: 'Kleiner', icon: 'zoomOut', onClick: () => resize(0.8) },
        { label: 'Größer', icon: 'zoomIn', onClick: () => resize(1.25) },
        { label: 'Volle Breite', icon: 'fitWidth', onClick: () => resize('full') },
        { label: 'Bild löschen', icon: 'trash', danger: true, onClick: () => { img.remove(); shell.markDirty(); } },
      ], { label: 'Bild' });
      return;
    }
    const a = e.target.closest('a');
    if (a && (e.ctrlKey || e.metaKey) && /^https?:/i.test(a.href)) window.open(a.href, '_blank', 'noopener');
  });

  // ---------- paste & drop ----------
  ed.addEventListener('paste', e => {
    const dt = e.clipboardData;
    if (!dt) return;
    const files = Array.from(dt.files || []).filter(f => /^image\//.test(f.type));
    if (files.length) { e.preventDefault(); insertImage(files); return; }
    const htmlData = dt.getData('text/html');
    e.preventDefault();
    if (htmlData && !plain) document.execCommand('insertHTML', false, sanitizeHtml(htmlData));
    else document.execCommand('insertText', false, dt.getData('text/plain'));
    shell.markDirty();
  });
  screen.onDropFiles = files => {
    const imgs = files.filter(f => /^image\//.test(f.type));
    if (imgs.length) insertImage(imgs);
    else toast('Hier kannst du Bilder ablegen.', 'info');
  };

  // ---------- find & replace ----------
  const fb = $('.w-find', wrap);
  const fq = $('[data-fq]', fb), fr = $('[data-fr]', fb), fcount = $('[data-fcount]', fb);
  let findOpen = false, matches = [], cur = -1;
  const hl = typeof CSS !== 'undefined' && CSS.highlights && typeof Highlight !== 'undefined';
  function openFind(focus) {
    findOpen = true; fb.hidden = false;
    $('[data-find]', tbEl).setAttribute('aria-pressed', 'true');
    const s = savedRange ? savedRange.toString() : '';
    if (s && s.length < 60 && !s.includes('\n')) fq.value = s;
    if (focus) setTimeout(() => { fq.focus(); fq.select(); }, 30);
    runFind(true);
  }
  function closeFind() {
    findOpen = false; fb.hidden = true; matches = []; cur = -1;
    $('[data-find]', tbEl).setAttribute('aria-pressed', 'false');
    if (hl) { CSS.highlights.delete('fale-find'); CSS.highlights.delete('fale-find-cur'); }
  }
  function runFind(jump) {
    const q = fq.value;
    matches = [];
    if (q) {
      const nodes = [];
      const tw = document.createTreeWalker(ed, NodeFilter.SHOW_TEXT);
      let text = '';
      for (let n = tw.nextNode(); n; n = tw.nextNode()) { nodes.push({ n, start: text.length }); text += n.nodeValue; }
      const hay = text.toLocaleLowerCase('de'), needle = q.toLocaleLowerCase('de');
      let i = hay.indexOf(needle);
      const locate = off => { let lo = 0, hi = nodes.length - 1; while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (nodes[mid].start <= off) lo = mid; else hi = mid - 1; } return nodes[lo]; };
      while (i !== -1 && matches.length < 5000) {
        const a = locate(i), b = locate(i + needle.length - 1);
        const r = document.createRange();
        r.setStart(a.n, i - a.start);
        r.setEnd(b.n, i + needle.length - b.start);
        matches.push(r);
        i = hay.indexOf(needle, i + needle.length);
      }
    }
    if (cur >= matches.length) cur = matches.length - 1;
    if (jump || cur < 0) cur = matches.length ? 0 : -1;
    paintFind(jump);
  }
  function paintFind(scroll) {
    fcount.textContent = fq.value ? (matches.length ? `${cur + 1} von ${matches.length}` : 'Keine Treffer') : '';
    fcount.classList.toggle('notfound', !!fq.value && !matches.length);
    if (hl) {
      CSS.highlights.set('fale-find', new Highlight(...matches));
      if (cur >= 0) CSS.highlights.set('fale-find-cur', new Highlight(matches[cur])); else CSS.highlights.delete('fale-find-cur');
    }
    if (scroll && cur >= 0) {
      const r = matches[cur].getBoundingClientRect();
      const sc = $('.writer-scroll', wrap);
      const cr = sc.getBoundingClientRect();
      if (r.top < cr.top + 40 || r.bottom > cr.bottom - 40) sc.scrollTop += r.top - cr.top - cr.height / 3;
    }
  }
  const step = d => { if (!matches.length) return; cur = (cur + d + matches.length) % matches.length; paintFind(true); };
  fq.addEventListener('input', () => runFind(true));
  fq.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); step(e.shiftKey ? -1 : 1); } if (e.key === 'Escape') closeFind(); });
  $('[data-fnext]', fb).addEventListener('click', () => step(1));
  $('[data-fprev]', fb).addEventListener('click', () => step(-1));
  $('[data-fclose]', fb).addEventListener('click', closeFind);
  const replaceRange = (r, text) => {
    const s = getSelection();
    s.removeAllRanges(); s.addRange(r);
    document.execCommand('insertText', false, text);
  };
  $('[data-frep]', fb).addEventListener('click', () => {
    if (cur < 0 || !matches[cur]) return;
    ed.focus();
    replaceRange(matches[cur], fr.value);
    shell.markDirty();
    runFind(false); paintFind(true);
  });
  $('[data-freall]', fb).addEventListener('click', () => {
    if (!matches.length) return;
    const n = matches.length;
    ed.focus();
    for (let i = matches.length - 1; i >= 0; i--) replaceRange(matches[i], fr.value);
    shell.markDirty();
    runFind(true);
    toast(`${n} Treffer ersetzt`, 'success');
  });

  // ---------- structure: outline, TOC, comments, footnotes, header/footer ----------
  const outlinePanel = $('.w-outline', wrap), cmtPanel = $('.w-comments', wrap);
  const scrollBox = $('.writer-scroll', wrap);
  const fnArea = $('.doc-fn-area', wrap);
  const hfTop = $('.doc-hf.top', wrap), hfBottom = $('.doc-hf.bottom', wrap);
  const LS = { get: (k, d) => { try { const v = localStorage.getItem(k); return v === null ? d : v; } catch { return d; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch {} } };
  let profileName = null;
  async function authorName() {
    if (profileName === null) { try { const p = await (await import('../extras/profile.js')).getProfile(); profileName = p ? [p.vorname, p.nachname].filter(Boolean).join(' ') : ''; } catch { profileName = ''; } }
    return profileName || 'Ich';
  }
  const headings = () => $$('h1,h2,h3', ed).filter(x => !x.closest('[data-toc]') && x.textContent.trim());
  function togglePanel(which, force) {
    const p = which === 'outline' ? outlinePanel : cmtPanel;
    const open = force != null ? force : p.hidden;
    p.hidden = !open;
    wrap.classList.toggle(`has-${which}`, open);
    $(`[data-panel="${which}"]`, tbEl) && $(`[data-panel="${which}"]`, tbEl).setAttribute('aria-pressed', String(open));
    if (which === 'outline') LS.set('fale-w-outline', open ? '1' : '0');
    refreshStructure();
  }
  $$('[data-close-panel]', wrap).forEach(b => b.addEventListener('click', () => togglePanel(b.closest('.w-outline') ? 'outline' : 'comments', false)));
  function refreshStructure() {
    refreshTocs();
    if (!outlinePanel.hidden) renderOutline();
    renderComments();
    renderFootnotes();
  }
  function jumpTo(el) {
    const r = el.getBoundingClientRect(), cr = scrollBox.getBoundingClientRect();
    scrollBox.scrollTop += r.top - cr.top - 24;
    const range = document.createRange(); range.selectNodeContents(el); range.collapse(true);
    const sel = getSelection(); sel.removeAllRanges(); sel.addRange(range);
    ed.focus({ preventScroll: true });
    el.classList.add('flash'); setTimeout(() => el.classList.remove('flash'), 900);
    if (matchMedia('(max-width: 900px)').matches) togglePanel('outline', false);
  }
  function renderOutline() {
    const list = $('.w-outline-list', outlinePanel);
    const hs = headings();
    list.innerHTML = hs.length ? '' : '<p class="panel-empty">Noch keine Überschriften. Nutze „Überschrift 1–3“ im Absatzformat, dann erscheint hier die Gliederung.</p>';
    hs.forEach(hd => {
      const b = h(`<button class="w-ol-item l${hd.tagName[1]}" type="button">${esc(hd.textContent.trim().slice(0, 120))}</button>`);
      b.addEventListener('click', () => jumpTo(hd));
      list.appendChild(b);
    });
  }
  function refreshTocs() {
    const tocs = $$('[data-toc]', ed);
    if (!tocs.length) return;
    const hs = headings();
    tocs.forEach(t => {
      t.setAttribute('contenteditable', 'false');
      const title = t.getAttribute('data-toc-title') || 'Inhaltsverzeichnis';
      const html = `<p class="toc-title">${esc(title)}</p>` + (hs.length ? hs.map((hd, i) => `<p class="toc-e l${hd.tagName[1]}" data-toc-i="${i}"><span>${esc(hd.textContent.trim())}</span></p>`).join('') : '<p class="toc-e muted">Noch keine Überschriften – das Verzeichnis füllt sich automatisch.</p>');
      if (t._html !== html) { t.innerHTML = html; t._html = html; }
    });
  }
  function insertToc() {
    if (plain) { toast('Ein Inhaltsverzeichnis gibt es nur in Word-Dokumenten.', 'info'); return; }
    restoreSel();
    document.execCommand('insertHTML', false, '<div class="toc" data-toc data-toc-title="Inhaltsverzeichnis" contenteditable="false"></div><p><br></p>');
    shell.markDirty(); refreshStructure();
    toast('Inhaltsverzeichnis eingefügt – es aktualisiert sich automatisch.', 'success');
  }
  ed.addEventListener('click', e => {
    const toc = e.target.closest('[data-toc]');
    if (toc) {
      const ent = e.target.closest('[data-toc-i]');
      if (ent) { const hd = headings()[+ent.dataset.tocI]; if (hd) { jumpTo(hd); return; } }
      officeMenu(toc, [
        { label: 'Verzeichnis aktualisieren', icon: 'restore', onClick: () => { toc._html = null; refreshTocs(); toast('Aktualisiert'); } },
        { label: 'Verzeichnis entfernen', icon: 'trash', danger: true, onClick: () => { toc.remove(); shell.markDirty(); } },
      ], { label: 'Inhaltsverzeichnis' });
      return;
    }
    const fn = e.target.closest('sup.fn');
    if (fn) { footnoteMenu(fn); return; }
    const cm = e.target.closest('[data-cmt]');
    if (cm) { togglePanel('comments', true); focusComment(cm.getAttribute('data-cmt')); }
  });

  // comments
  function cmtGroups() {
    const map = new Map();
    $$('[data-cmt]', ed).forEach(sp => { const id = sp.getAttribute('data-cmt'); if (!map.has(id)) map.set(id, []); map.get(id).push(sp); });
    return map;
  }
  function renderComments() {
    const groups = cmtGroups();
    const btn = $('[data-comment]', tbEl);
    if (btn) btn.dataset.count = groups.size || '';
    if (cmtPanel.hidden) return;
    const list = $('.w-cmt-list', cmtPanel);
    list.innerHTML = groups.size ? '' : '<p class="panel-empty">Noch keine Kommentare. Markiere Text und tippe auf „Kommentar hinzufügen“.</p>';
    for (const [id, spans] of groups) {
      const s0 = spans[0];
      const quote = spans.map(x => x.textContent).join(' ').replace(/\s+/g, ' ').trim();
      const d = s0.getAttribute('data-cmt-date');
      const dd = d ? new Date(d) : null;
      const card = h(`<article class="w-cmt" data-for="${esc(id)}" tabindex="0">
        <blockquote>${esc(quote.length > 90 ? quote.slice(0, 88) + '…' : quote)}</blockquote>
        <p class="w-cmt-text">${esc(s0.getAttribute('data-cmt-text') || '')}</p>
        <div class="w-cmt-foot"><span class="muted small">${esc(s0.getAttribute('data-cmt-author') || 'Ich')}${dd && !isNaN(dd) ? ` · ${dd.toLocaleDateString('de-DE')}` : ''}</span>
          <span><button class="icon-btn" type="button" data-edit aria-label="Kommentar bearbeiten">${oicon('edit')}</button><button class="icon-btn" type="button" data-del aria-label="Kommentar löschen">${oicon('trash')}</button></span></div></article>`);
      card.addEventListener('click', e => {
        if (e.target.closest('[data-edit]')) { editComment(id); return; }
        if (e.target.closest('[data-del]')) { deleteComment(id); return; }
        focusComment(id, true);
      });
      list.appendChild(card);
    }
  }
  function focusComment(id, scrollTo = false) {
    $$('.cmt-focus', ed).forEach(x => x.classList.remove('cmt-focus'));
    const spans = cmtGroups().get(id) || [];
    spans.forEach(x => x.classList.add('cmt-focus'));
    $$('.w-cmt', cmtPanel).forEach(c => c.classList.toggle('on', c.dataset.for === id));
    if (scrollTo && spans[0]) { const r = spans[0].getBoundingClientRect(), cr = scrollBox.getBoundingClientRect(); scrollBox.scrollTop += r.top - cr.top - cr.height / 3; }
    const card = $(`.w-cmt[data-for="${CSS.escape(id)}"]`, cmtPanel);
    if (card) card.scrollIntoView({ block: 'nearest' });
  }
  async function commentText(title, value = '') {
    const r = await openDialog({
      title, body: `<label class="field"><span class="field-label">Kommentar</span><textarea class="input w-cmt-ta" name="t" rows="4" autofocus>${esc(value)}</textarea></label>`,
      actions: [{ label: 'Abbrechen', value: 'cancel' }, { label: 'Speichern', value: 'ok', kind: 'btn-primary', default: true }],
      onMount: dlg => ({ collect: () => $('[name=t]', dlg).value.trim() }),
    });
    return r.value === 'ok' && r.data ? r.data : null;
  }
  async function addComment(textArg) {
    if (plain) { toast('Kommentare gibt es nur in Word-Dokumenten.', 'info'); return null; }
    const sel = getSelection();
    let range = sel.rangeCount && ed.contains(sel.anchorNode) && !sel.isCollapsed ? sel.getRangeAt(0).cloneRange() : (savedRange && !savedRange.collapsed ? savedRange.cloneRange() : null);
    if (!range || !range.toString().trim()) { toast('Markiere zuerst den Text, den du kommentieren möchtest.', 'info'); return null; }
    const text = textArg != null ? textArg : await commentText('Kommentar hinzufügen');
    if (!text) return null;
    const id = 'c' + Date.now().toString(36);
    const attrs = { 'data-cmt': id, 'data-cmt-text': text, 'data-cmt-author': await authorName(), 'data-cmt-date': new Date().toISOString() };
    const mk = () => { const sp = document.createElement('span'); sp.className = 'cmt'; Object.entries(attrs).forEach(([k, v]) => sp.setAttribute(k, v)); return sp; };
    const blockOf = n => (n.nodeType === 1 ? n : n.parentElement).closest('p,li,h1,h2,h3,h4,h5,h6,td,th,blockquote,pre');
    ed.focus();
    sel.removeAllRanges(); sel.addRange(range);
    if (blockOf(range.startContainer) === blockOf(range.endContainer)) {
      const sp = mk();
      sp.appendChild(range.extractContents());
      range.insertNode(sp);
    } else {
      const MARK = 'rgb(255, 254, 1)';
      document.execCommand('styleWithCSS', false, true);
      document.execCommand('hiliteColor', false, MARK);
      document.execCommand('styleWithCSS', false, false);
      $$('span', ed).forEach(sp => {
        if (sp.style.backgroundColor !== MARK) return;
        sp.style.backgroundColor = '';
        if (!sp.getAttribute('style')) sp.removeAttribute('style');
        sp.classList.add('cmt');
        Object.entries(attrs).forEach(([k, v]) => sp.setAttribute(k, v));
      });
    }
    sel.removeAllRanges();
    shell.markDirty();
    togglePanel('comments', true);
    focusComment(id);
    return id;
  }
  async function editComment(id) {
    const spans = cmtGroups().get(id) || [];
    if (!spans.length) return;
    const t = await commentText('Kommentar bearbeiten', spans[0].getAttribute('data-cmt-text') || '');
    if (t == null) return;
    spans.forEach(sp => sp.setAttribute('data-cmt-text', t));
    shell.markDirty(); renderComments();
  }
  function deleteComment(id) {
    (cmtGroups().get(id) || []).forEach(sp => sp.replaceWith(...sp.childNodes));
    ed.normalize();
    shell.markDirty(); renderComments();
    toast('Kommentar gelöscht');
  }

  // footnotes
  async function footnoteText(title, value = '') {
    const r = await openDialog({
      title, body: `<label class="field"><span class="field-label">Text der Fußnote</span><textarea class="input w-cmt-ta" name="t" rows="3" autofocus>${esc(value)}</textarea></label>`,
      actions: [{ label: 'Abbrechen', value: 'cancel' }, { label: 'Übernehmen', value: 'ok', kind: 'btn-primary', default: true }],
      onMount: dlg => ({ collect: () => $('[name=t]', dlg).value.trim() }),
    });
    return r.value === 'ok' && r.data ? r.data : null;
  }
  async function insertFootnote(textArg) {
    if (plain) { toast('Fußnoten gibt es nur in Word-Dokumenten.', 'info'); return; }
    const text = textArg != null ? textArg : await footnoteText('Fußnote einfügen');
    if (!text) return;
    restoreSel();
    const sel = getSelection();
    if (sel.rangeCount && !sel.isCollapsed) sel.collapseToEnd();
    document.execCommand('insertHTML', false, `<sup class="fn" data-fn="${esc(text)}" contenteditable="false"></sup>&#8203;`);
    shell.markDirty(); refreshStructure();
  }
  function footnoteMenu(fn) {
    officeMenu(fn, [
      { label: 'Fußnote bearbeiten', icon: 'edit', onClick: async () => { const t = await footnoteText('Fußnote bearbeiten', fn.getAttribute('data-fn') || ''); if (t != null) { fn.setAttribute('data-fn', t); shell.markDirty(); renderFootnotes(); } } },
      { label: 'Fußnote löschen', icon: 'trash', danger: true, onClick: () => { fn.remove(); shell.markDirty(); renderFootnotes(); } },
    ], { label: 'Fußnote' });
  }
  function renderFootnotes() {
    const fns = $$('sup.fn', ed);
    fnArea.hidden = !fns.length;
    fnArea.innerHTML = fns.length ? `<ol>${fns.map(f => `<li>${esc(f.getAttribute('data-fn') || '')}</li>`).join('')}</ol>` : '';
  }

  // page setup + header/footer
  const PAGE_FORMATS = { a4: [595.3, 841.9, 'A4'], a5: [419.5, 595.3, 'A5'], letter: [612, 792, 'US Letter'], legal: [612, 1008, 'US Legal'] };
  const MARGINS = { normal: [70.9, 70.9, 56.7, 70.9, 'Normal (2,5 cm)'], schmal: [36, 36, 36, 36, 'Schmal (1,27 cm)'], breit: [72, 90, 72, 90, 'Breit'], din: [48, 56.7, 56.7, 70.9, 'Brief nach DIN 5008'] };
  const mm = pt => Math.round(pt / 2.8346 * 10) / 10;
  function applyPage() {
    sheet.style.setProperty('--page-w', `${page.w * PX}px`);
    sheet.style.setProperty('--page-h', `${page.h * PX}px`);
    ed.style.setProperty('--pad-t', `${page.mt * PX}px`);
    ed.style.setProperty('--pad-r', `${page.mr * PX}px`);
    ed.style.setProperty('--pad-b', `${page.mb * PX}px`);
    ed.style.setProperty('--pad-l', `${page.ml * PX}px`);
    sheet.style.setProperty('--pad-t', `${page.mt * PX}px`);
    sheet.style.setProperty('--pad-l', `${page.ml * PX}px`);
    sheet.style.setProperty('--pad-r', `${page.mr * PX}px`);
    renderHf();
  }
  function renderHf() {
    const pn = hf && hf.pageNumbers && hf.pageNumbers !== 'none' ? (hf.pageFormat === 'n-of-m' ? 'Seite 1 von N' : '1') : '';
    const head = [hf && hf.header, pn && hf.pageNumbers.startsWith('header') ? pn : ''].filter(Boolean).join(' · ');
    const foot = [hf && hf.footer, pn && hf.pageNumbers.startsWith('footer') ? pn : ''].filter(Boolean).join(' · ');
    hfTop.hidden = !head; hfBottom.hidden = !foot;
    hfTop.textContent = head; hfBottom.textContent = foot;
    hfTop.style.textAlign = (hf && hf.header ? hf.headerAlign : hf && hf.pageNumbers ? hf.pageNumbers.split('-')[1] : 'left') || 'left';
    hfBottom.style.textAlign = (hf && hf.footer ? hf.footerAlign : hf && hf.pageNumbers ? hf.pageNumbers.split('-')[1] : 'left') || 'left';
    hfTop.title = hfBottom.title = 'Kopf- und Fußzeile bearbeiten';
  }
  [hfTop, hfBottom].forEach(b => b.addEventListener('click', () => pageSetup()));
  async function pageSetup() {
    if (plain) { toast('Seitenformat gibt es nur in Word-Dokumenten.', 'info'); return; }
    const land = page.w > page.h;
    const pw = Math.min(page.w, page.h), ph = Math.max(page.w, page.h);
    const fmt = Object.entries(PAGE_FORMATS).find(([, v]) => Math.abs(v[0] - pw) < 3 && Math.abs(v[1] - ph) < 3);
    const mar = Object.entries(MARGINS).find(([, v]) => [page.mt, page.mr, page.mb, page.ml].every((x, i) => Math.abs(x - v[i]) < 1.5));
    const H = hf || {};
    const r = await openDialog({
      title: 'Seite einrichten', wide: true,
      body: `<div class="ps-dlg">
        <div class="field-row"><label class="field"><span class="field-label">Format</span><select class="select" name="fmt">${Object.entries(PAGE_FORMATS).map(([k, v]) => `<option value="${k}" ${fmt && fmt[0] === k ? 'selected' : ''}>${v[2]}</option>`).join('')}${fmt ? '' : '<option value="keep" selected>Wie im Dokument</option>'}</select></label>
          <div class="field"><span class="field-label">Ausrichtung</span><div class="seg" role="group" aria-label="Ausrichtung"><button type="button" data-or="hoch" aria-pressed="${!land}">Hochformat</button><button type="button" data-or="quer" aria-pressed="${land}">Querformat</button></div></div></div>
        <label class="field"><span class="field-label">Ränder</span><select class="select" name="mar">${Object.entries(MARGINS).map(([k, v]) => `<option value="${k}" ${mar && mar[0] === k ? 'selected' : ''}>${v[4]}</option>`).join('')}<option value="custom" ${mar ? '' : 'selected'}>Eigene (mm)</option></select></label>
        <div class="ps-custom" ${mar ? 'hidden' : ''}><div class="ps-grid">${[['mt', 'Oben'], ['mb', 'Unten'], ['ml', 'Links'], ['mr', 'Rechts']].map(([k, l]) => `<label class="field"><span class="field-label">${l}</span><input class="input" name="${k}" inputmode="decimal" value="${String(mm(page[k])).replace('.', ',')}"></label>`).join('')}</div></div>
        <h3 class="ps-h">Kopf- und Fußzeile</h3>
        <div class="field-row"><label class="field"><span class="field-label">Kopfzeile</span><input class="input" name="header" value="${esc(H.header || '')}" placeholder="z. B. Projektbericht"></label>
          <label class="field"><span class="field-label">Ausrichtung</span><select class="select" name="headerAlign">${[['left', 'Links'], ['center', 'Mitte'], ['right', 'Rechts']].map(([k, l]) => `<option value="${k}" ${(H.headerAlign || 'left') === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label></div>
        <div class="field-row"><label class="field"><span class="field-label">Fußzeile</span><input class="input" name="footer" value="${esc(H.footer || '')}" placeholder="z. B. Vertraulich"></label>
          <label class="field"><span class="field-label">Ausrichtung</span><select class="select" name="footerAlign">${[['left', 'Links'], ['center', 'Mitte'], ['right', 'Rechts']].map(([k, l]) => `<option value="${k}" ${(H.footerAlign || 'left') === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label></div>
        <div class="field-row"><label class="field"><span class="field-label">Seitenzahlen</span><select class="select" name="pn">${[['none', 'Keine'], ['footer-center', 'Unten mittig'], ['footer-right', 'Unten rechts'], ['header-right', 'Oben rechts']].map(([k, l]) => `<option value="${k}" ${(H.pageNumbers || 'none') === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
          <label class="field"><span class="field-label">Schreibweise</span><select class="select" name="pf"><option value="n" ${H.pageFormat !== 'n-of-m' ? 'selected' : ''}>1, 2, 3 …</option><option value="n-of-m" ${H.pageFormat === 'n-of-m' ? 'selected' : ''}>Seite 1 von 3</option></select></label></div>
        <label class="check"><input type="checkbox" name="first" ${H.firstPage === false ? 'checked' : ''}> Nicht auf der ersten Seite (Deckblatt)</label>
      </div>`,
      actions: [{ label: 'Abbrechen', value: 'cancel' }, { label: 'Übernehmen', value: 'ok', kind: 'btn-primary', default: true }],
      onMount: dlg => {
        let orient = land ? 'quer' : 'hoch';
        $$('[data-or]', dlg).forEach(b => b.addEventListener('click', () => { orient = b.dataset.or; $$('[data-or]', dlg).forEach(x => x.setAttribute('aria-pressed', String(x === b))); }));
        $('[name=mar]', dlg).addEventListener('change', e => { $('.ps-custom', dlg).hidden = e.target.value !== 'custom'; });
        const v = n => $(`[name=${n}]`, dlg).value;
        return { collect: () => ({ fmt: v('fmt'), orient, mar: v('mar'), mt: v('mt'), mb: v('mb'), ml: v('ml'), mr: v('mr'), header: v('header').trim(), headerAlign: v('headerAlign'), footer: v('footer').trim(), footerAlign: v('footerAlign'), pn: v('pn'), pf: v('pf'), first: $('[name=first]', dlg).checked }) };
      },
    });
    if (r.value !== 'ok' || !r.data) return;
    const d = r.data;
    let [w, hh] = d.fmt === 'keep' ? [pw, ph] : PAGE_FORMATS[d.fmt];
    if (d.orient === 'quer') [w, hh] = [hh, w];
    const toPt = x => { const n = parseFloat(String(x).replace(',', '.')); return Number.isFinite(n) ? Math.max(0, Math.min(80, n)) * 2.8346 : 70.9; };
    const m = d.mar === 'custom' ? [toPt(d.mt), toPt(d.mr), toPt(d.mb), toPt(d.ml)] : MARGINS[d.mar].slice(0, 4);
    page = { w, h: hh, mt: m[0], mr: m[1], mb: m[2], ml: m[3] };
    hf = d.header || d.footer || d.pn !== 'none' ? { header: d.header, headerAlign: d.headerAlign, footer: d.footer, footerAlign: d.footerAlign, pageNumbers: d.pn, pageFormat: d.pf, firstPage: d.first ? false : undefined } : null;
    applyPage();
    shell.markDirty();
    toast('Seite eingerichtet', 'success');
  }

  // spellcheck
  let spellOn = LS.get('fale-spell', '1') === '1';
  function setSpell(on) {
    spellOn = on;
    ed.spellcheck = on;
    ed.setAttribute('spellcheck', String(on));
    LS.set('fale-spell', on ? '1' : '0');
    $('[data-spell]', tbEl).setAttribute('aria-pressed', String(on));
    // re-attach so the browser re-runs (or clears) the spelling marks
    const sel = getSelection(); const keep = sel.rangeCount && ed.contains(sel.anchorNode) ? sel.getRangeAt(0).cloneRange() : null;
    ed.blur(); if (keep) { ed.focus({ preventScroll: true }); sel.removeAllRanges(); sel.addRange(keep); }
  }

  // dictation (Web Speech API – only where the browser offers it)
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const dictBtn = $('[data-dictate]', tbEl), pill = $('.dictate-pill', wrap);
  if (SR && !plain) dictBtn.hidden = false;
  let rec = null, dictating = false;
  const VOICE = [[/\s*\bneuer absatz\b\s*/gi, '\n\n'], [/\s*\bneue zeile\b\s*/gi, '\n'], [/\s*\bpunkt\b/gi, '.'], [/\s*\bkomma\b/gi, ','], [/\s*\bfragezeichen\b/gi, '?'], [/\s*\bausrufezeichen\b/gi, '!'], [/\s*\bdoppelpunkt\b/gi, ':'], [/\s*\bsemikolon\b/gi, ';']];
  async function toggleDictation() {
    if (dictating) { dictating = false; try { rec && rec.stop(); } catch {} return; }
    let local = false;
    try { if (SR.available) local = (await SR.available({ langs: ['de-DE'], processLocally: true })) === 'available'; } catch {}
    if (!local && LS.get('fale-dictate-ok', '') !== '1') {
      const ok = await openDialog({
        title: 'Diktieren',
        body: `<p>Die Spracherkennung stellt dein Browser bzw. Betriebssystem bereit. Je nach Gerät wird die Sprache dafür an dessen Anbieter (z. B. Google oder Apple) übertragen – FaLe selbst speichert und sendet nichts.</p><p class="hint">Sprachbefehle: „Punkt“, „Komma“, „Fragezeichen“, „neue Zeile“, „neuer Absatz“.</p>`,
        actions: [{ label: 'Abbrechen', value: 'cancel' }, { label: 'Verstanden, diktieren', value: 'ok', kind: 'btn-primary', default: true }],
      });
      if (ok.value !== 'ok') return;
      LS.set('fale-dictate-ok', '1');
    }
    rec = new SR();
    rec.lang = 'de-DE'; rec.continuous = true; rec.interimResults = true;
    if (local) { try { rec.processLocally = true; } catch {} }
    rec.onresult = e => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const t = e.results[i][0].transcript;
        if (e.results[i].isFinal) {
          let txt = t.trim();
          for (const [re, rpl] of VOICE) txt = txt.replace(re, rpl);
          restoreSel();
          txt.split(/(\n\n|\n)/).forEach(part => {
            if (part === '\n\n') document.execCommand('insertParagraph');
            else if (part === '\n') document.execCommand('insertLineBreak');
            else if (part) document.execCommand('insertText', false, part + (/[\s]$/.test(part) ? '' : ' '));
          });
          shell.markDirty(); onInput();
        } else interim += t;
      }
      pill.textContent = interim ? `🎙 ${interim}` : '🎙 Ich höre zu …';
    };
    rec.onerror = e => {
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') toast('Kein Zugriff auf das Mikrofon. Bitte erlaube den Zugriff in den Einstellungen.', 'error');
      else if (e.error === 'network') toast('Die Spracherkennung dieses Browsers braucht eine Internetverbindung.', 'error');
      else if (e.error === 'language-not-supported') toast('Deutsch wird von der Spracherkennung hier nicht unterstützt.', 'error');
      if (e.error !== 'no-speech') dictating = false;
    };
    rec.onend = () => { if (dictating) { try { rec.start(); return; } catch {} } dictating = false; dictBtn.setAttribute('aria-pressed', 'false'); dictBtn.classList.remove('rec'); pill.hidden = true; };
    try { rec.start(); } catch (err) { errorToast(err, 'Diktieren konnte nicht gestartet werden.'); return; }
    dictating = true;
    dictBtn.setAttribute('aria-pressed', 'true'); dictBtn.classList.add('rec');
    pill.hidden = false; pill.textContent = '🎙 Ich höre zu …';
  }

  // read aloud (speech synthesis, on-device voices)
  const readbar = $('.w-readbar', wrap);
  let reader = null;
  function readAloud() {
    if (!speechSupported) { toast('Vorlesen wird von diesem Browser nicht unterstützt.', 'error'); return; }
    if (reader) { stopReading(); return; }
    const blocks = $$('p,h1,h2,h3,h4,h5,h6,li,td,blockquote,pre', ed).filter(b => !b.closest('[data-toc]') && !b.querySelector('p,li,td') && b.innerText.trim());
    if (!blocks.length) { toast('Das Dokument ist leer.', 'info'); return; }
    const s0 = getSelection();
    let start = 1;
    if (s0.rangeCount && ed.contains(s0.anchorNode)) { const i = blocks.findIndex(b => b.contains(s0.anchorNode)); if (i > 0) start = i + 1; }
    readbar.hidden = false;
    readbar.innerHTML = `<button class="icon-btn read-play" type="button" data-rp aria-label="Pause">${oicon('pause')}</button>
      <button class="icon-btn" type="button" data-rs aria-label="Vorlesen beenden">${oicon('stop')}</button>
      <label class="sr-only" for="w-rate">Geschwindigkeit</label><select class="select w-rate" id="w-rate">${[0.8, 1, 1.2, 1.5].map(r => `<option value="${r}" ${r === 1 ? 'selected' : ''}>${String(r).replace('.', ',')}×</option>`).join('')}</select>
      <span class="small muted" data-rinfo></span>`;
    reader = new ReadAloud({
      numPages: blocks.length,
      getPageText: p => blocks[p - 1].innerText,
      onPage: p => { $$('.reading', ed).forEach(x => x.classList.remove('reading')); const b = blocks[p - 1]; b.classList.add('reading'); const r = b.getBoundingClientRect(), cr = scrollBox.getBoundingClientRect(); if (r.top < cr.top || r.bottom > cr.bottom - 60) scrollBox.scrollTop += r.top - cr.top - cr.height / 3; $('[data-rinfo]', readbar).textContent = `Absatz ${p} von ${blocks.length}`; },
      onState: st => { const b = $('[data-rp]', readbar); if (b) { b.innerHTML = oicon(st === 'playing' ? 'pause' : 'play'); b.setAttribute('aria-label', st === 'playing' ? 'Pause' : 'Weiter'); } if (st === 'finished') stopReading(); },
    });
    $('[data-rp]', readbar).addEventListener('click', () => reader && reader.toggle());
    $('[data-rs]', readbar).addEventListener('click', stopReading);
    $('#w-rate', readbar).addEventListener('change', e => reader && reader.setRate(+e.target.value));
    $('[data-read]', tbEl).setAttribute('aria-pressed', 'true');
    reader.start(start).catch(e => { errorToast(e, 'Vorlesen nicht möglich.'); stopReading(); });
    void getVoices;
  }
  function stopReading() {
    if (reader) { reader.stop(); reader = null; }
    readbar.hidden = true; readbar.innerHTML = '';
    $$('.reading', ed).forEach(x => x.classList.remove('reading'));
    $('[data-read]', tbEl).setAttribute('aria-pressed', 'false');
  }

  applyPage();
  setSpell(spellOn);
  if (LS.get('fale-w-outline', '0') === '1' && !matchMedia('(max-width: 900px)').matches && !plain) togglePanel('outline', true);
  refreshStructure();
  wrap._writerApi = { ed, hf: () => hf, page: () => page, setHf: v => { hf = v; renderHf(); shell.markDirty(); }, setPage: v => { page = v; applyPage(); shell.markDirty(); }, addComment, insertToc, insertFootnote, refresh: refreshStructure };

  const onKey = e => {
    if ((e.ctrlKey || e.metaKey) && (e.key === 'f' || e.key === 'h')) { e.preventDefault(); openFind(true); }
  };
  document.addEventListener('keydown', onKey);

  if (screen._query) { fq.value = screen._query; openFind(false); }
  if (!id) setTimeout(() => { ed.focus(); }, 50);

  return () => {
    if (reader) { try { reader.stop(); } catch {} }
    if (dictating) { dictating = false; try { rec && rec.stop(); } catch {} }
    document.removeEventListener('selectionchange', onSelChange);
    document.removeEventListener('keydown', onKey);
    if (hl) { CSS.highlights.delete('fale-find'); CSS.highlights.delete('fale-find-cur'); }
    screen.officeCleanup && screen.officeCleanup();
  };
}

const COLOR_NAMES = { '#1A1A1A': 'Schwarz', '#C2410C': 'Orange', '#B91C1C': 'Rot', '#3B37A0': 'Indigo', '#0B8F80': 'Petrol', '#15803D': 'Grün', '#7E22CE': 'Violett', '#6B7194': 'Grau', '#FDE047': 'Gelb', '#A7F3D0': 'Mint', '#BFDBFE': 'Hellblau', '#FBCFE8': 'Rosa', '#FED7AA': 'Apricot' };
const colorName = c => COLOR_NAMES[c] || c;

/** Whitespace-only text between blocks would show up as empty lines (white-space: pre-wrap). */
function stripBlockWhitespace(root) {
  const blocky = /^(DIV|UL|OL|TABLE|TBODY|THEAD|TR|COLGROUP|BLOCKQUOTE)$/;
  const walk = el => {
    for (const c of Array.from(el.childNodes)) {
      if (c.nodeType === 3 && !c.nodeValue.trim() && (el === root || blocky.test(el.tagName))) c.remove();
      else if (c.nodeType === 1 && (blocky.test(c.tagName) || c.tagName === 'TD' || c.tagName === 'TH' || c.tagName === 'LI')) walk(c);
    }
  };
  walk(root);
}

// ---------- paste sanitizer ----------
const ALLOWED = new Set(['P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'UL', 'OL', 'LI', 'TABLE', 'TBODY', 'THEAD', 'TR', 'TD', 'TH', 'B', 'STRONG', 'I', 'EM', 'U', 'S', 'STRIKE', 'SUP', 'SUB', 'A', 'IMG', 'BR', 'SPAN', 'BLOCKQUOTE', 'PRE', 'CODE', 'HR', 'DIV']);
const STYLE_KEEP = ['color', 'background-color', 'font-weight', 'font-style', 'text-decoration', 'text-decoration-line', 'text-align', 'font-size'];
export function sanitizeHtml(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const walk = el => {
    for (const c of Array.from(el.childNodes)) {
      if (c.nodeType === 8) { c.remove(); continue; }
      if (c.nodeType !== 1) continue;
      if (['SCRIPT', 'STYLE', 'META', 'LINK', 'TITLE', 'XML', 'svg', 'SVG', 'IFRAME', 'OBJECT', 'NOSCRIPT'].includes(c.tagName) || c.tagName.includes(':')) { c.remove(); continue; }
      walk(c);
      if (!ALLOWED.has(c.tagName)) { c.replaceWith(...c.childNodes); continue; }
      const keep = {};
      if (c.tagName === 'A' && /^(https?:|mailto:|tel:)/i.test(c.getAttribute('href') || '')) keep.href = c.getAttribute('href');
      if (c.tagName === 'IMG' && /^data:image\//.test(c.getAttribute('src') || '')) { keep.src = c.getAttribute('src'); if (c.getAttribute('width')) keep.width = c.getAttribute('width'); }
      if (c.tagName === 'IMG' && !keep.src) { c.remove(); continue; }
      if (c.tagName === 'TD' || c.tagName === 'TH') { ['colspan', 'rowspan'].forEach(a => { if (c.getAttribute(a)) keep[a] = c.getAttribute(a); }); }
      const st = [];
      for (const p of STYLE_KEEP) { const v = c.style.getPropertyValue(p); if (v && !/var\(/.test(v)) st.push(`${p}:${v}`); }
      for (const a of Array.from(c.attributes)) c.removeAttribute(a.name);
      Object.entries(keep).forEach(([k, v]) => c.setAttribute(k, v));
      if (st.length) c.setAttribute('style', st.join(';'));
      if (c.tagName === 'DIV') {
        if (Array.from(c.children).some(k => /^(P|H\d|UL|OL|TABLE|BLOCKQUOTE|PRE|HR|DIV)$/.test(k.tagName))) c.replaceWith(...c.childNodes);
        else { const p = doc.createElement('p'); while (c.firstChild) p.appendChild(c.firstChild); c.replaceWith(p); }
      }
    }
  };
  walk(doc.body);
  return doc.body.innerHTML;
}
