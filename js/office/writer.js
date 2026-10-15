// Textverarbeitung: open/edit .docx, .txt, .md; save .docx/.txt/.md; export PDF.
// Seitenlayout- und Webansicht, Menüband (Start, Einfügen, Layout, Überprüfen, Sendungen, Ansicht + Tabelle/Bild),
// Formatvorlagen, Absatz-/Zeichenformat, Listen, Tabellenwerkzeuge, Bilder, Textfelder, Spalten, Änderungen
// nachverfolgen, Serienbrief, Suchen/Ersetzen mit Optionen, Versionen, Tastenkürzel.
import * as db from '../db.js';
import { $, $$, h, esc, toast, errorToast, openDialog, promptDialog, debounce, pickFiles, downloadBlob, shareBlob, confirmDialog } from '../ui.js';
import { createShell, exportPdfFlow, tb } from './shell.js';
import { officeMenu, oicon, KINDS, stripExt } from './kinds.js';
import { htmlToModel, modelToText, modelToMarkdown, textToHtml, markdownToHtml } from './docmodel.js';
import { DOC_TEMPLATES, buildDocTemplate } from './templates.js';
import { fileToDataUrl, decodeText } from './vendor.js';
import { speechSupported, ReadAloud, getVoices } from '../readaloud.js';
import { sanitizeDocHtml, sanitizeDocHtmlSync, purifyLoaded, openExternal } from '../security.js';
import { FONTS, fontCss, fontNameOf } from './fonts.js';
import { STYLE_ORDER, normalizeStyles, stylesCss, styleOfBlock } from './docstyles.js';
import * as F from './writer-format.js';
import { createTableTools, TABLE_STYLES, SHADES } from './writer-table.js';
import { createPageView, cleanEditorHtml, clearPagination, PAGE_GAP } from './pagelayout.js';
import { createHistory } from './whistory.js';
import { createTracker } from './trackchanges.js';
import { createRuler } from './ruler.js';
import { hfTexts, hfHas, isAdvanced, pageNumberOf } from './hfnorm.js';
import { hfEl } from './pagelayout.js';
import { createWriterExtras } from './writer-extras.js';
import { isCustomStyle, customStyleIds, CUSTOM_BASE } from './docstyles.js';
export { decodeText };

const PX = 96 / 72; // pt → css px
const STYLE_OPTS = [['p', 'normal', 'Standard'], ['title', 'title', 'Titel'], ['subtitle', 'subtitle', 'Untertitel'], ['h1', 'h1', 'Überschrift 1'], ['h2', 'h2', 'Überschrift 2'], ['h3', 'h3', 'Überschrift 3'], ['h4', 'h4', 'Überschrift 4'], ['h5', 'h5', 'Überschrift 5'], ['h6', 'h6', 'Überschrift 6'], ['blockquote', 'quote', 'Zitat'], ['caption', 'caption', 'Beschriftung'], ['pre', 'code', 'Code'], ['nospace', 'nospace', 'Kein Abstand']];
const VAL_OF_STYLE = Object.fromEntries(STYLE_OPTS.map(([v, id]) => [id, v]));
const STYLE_OF_VAL = Object.fromEntries(STYLE_OPTS.map(([v, id]) => [v, id]));
const HILITES = [['#FDE047', 'Gelb'], ['#A7F3D0', 'Mint'], ['#BFDBFE', 'Hellblau'], ['#FBCFE8', 'Rosa'], ['#FED7AA', 'Apricot'], ['#D9F99D', 'Hellgrün'], ['#E9D5FF', 'Flieder'], ['#D1D5DB', 'Grau']];
const SYMBOLS = ['€', '£', '$', '©', '®', '™', '§', '¶', '°', '±', '×', '÷', '≈', '≠', '≤', '≥', '→', '←', '↑', '↓', '✓', '✗', '•', '…', '–', '—', '„', '“', '‚', '‘', '»', '«', '½', '¼', '¾', 'µ', 'Σ', '∞', 'π', 'Ω', 'α', 'β', '♥', '★', '☐', '☑'];
const ZOOMS = [0.5, 0.75, 0.9, 1, 1.1, 1.25, 1.5, 2];
const SHAPES = {
  rect: ['Rechteck', '<rect x="4" y="4" width="152" height="92" rx="2"/>'],
  round: ['Abgerundetes Rechteck', '<rect x="4" y="4" width="152" height="92" rx="18"/>'],
  ellipse: ['Ellipse', '<ellipse cx="80" cy="50" rx="76" ry="46"/>'],
  arrow: ['Pfeil', '<path d="M4 34h104V8l48 42-48 42V66H4z"/>'],
  star: ['Stern', '<path d="M80 4l13 31 34 3-26 22 8 33-29-17-29 17 8-33-26-22 34-3z" transform="translate(0 -2) scale(1 0.98)"/>'],
  callout: ['Sprechblase', '<path d="M8 6h144v62H70l-30 26 6-26H8z"/>'],
};

export async function mountWriter(screen, { id = null, template = null }) {
  let meta = null, kind = 'docx', name = 'Dokument.docx', html = '<p><br></p>', page = null, baseSize = 11, hf = null, styles = null;
  screen.body.innerHTML = '<div class="v-loading"><div><span class="spinner dark" style="width:30px;height:30px"></span><span>Dokument wird geöffnet …</span></div></div>';
  if (id) {
    meta = await db.getDoc(id);
    if (!meta) throw Object.assign(new Error('missing'), { userMessage: 'Dokument nicht gefunden.' });
    kind = meta.kind; name = meta.name;
    const blob = await db.getFile(id);
    if (kind === 'docx') {
      const { docxToHtml } = await import('./docx-read.js');
      const r = await docxToHtml(await blob.arrayBuffer(), name);
      html = r.html; page = r.page; baseSize = r.baseSize || 11; hf = r.hf || null; styles = r.styles || null;
    } else {
      const text = await decodeText(blob);
      html = kind === 'md' ? markdownToHtml(text) : textToHtml(text);
    }
    db.updateDoc(id, { openedAt: Date.now() }).catch(() => {});
  } else {
    const t = buildDocTemplate(DOC_TEMPLATES.some(x => x.id === template) ? template : 'leer');
    html = t.html; page = t.page; hf = t.hf; if (t.styles) styles = t.styles;
    name = t.name + '.docx';
  }
  // imported documents are untrusted: DOMPurify (editor profile) on top of the escaping importers
  try { html = await sanitizeDocHtml(html); } catch (e) { console.warn('sanitizer unavailable', e); }
  if (screen.signal.aborted) return;
  page = page || { w: 595.3, h: 841.9, mt: 70.9, mr: 70.9, mb: 56.7, ml: 70.9 };
  const plain = kind === 'txt';
  const docNormalSize = styles && styles.normal && styles.normal.size;
  styles = normalizeStyles(styles);
  if (baseSize && baseSize !== 11 && !docNormalSize) styles.normal.size = baseSize;

  const shell = createShell(screen, {
    id, name, kind,
    serialize: () => serialize(kind),
    onSaved: m => { addVersionNow(m && m.id, 'Gespeichert'); },
    menu: () => [
      { label: 'Als PDF exportieren', icon: 'kpdf', onClick: exportPdf },
      { label: 'Word-Datei (.docx) herunterladen', icon: 'download', onClick: () => dl('docx') },
      { label: 'Als Text (.txt) herunterladen', icon: 'download', onClick: () => dl('txt') },
      { label: 'Als Markdown (.md) herunterladen', icon: 'download', onClick: () => dl('md') },
      kind !== 'docx' ? { label: 'Als Word-Dokument speichern', icon: 'kdoc', onClick: async () => { const b = await serialize('docx'); await shell.saveAsKind(b, 'docx'); } } : null,
      '-',
      { label: 'Neues Dokument aus Vorlage …', icon: 'template', onClick: () => { location.hash = '#/vorlagen/dokument'; } },
      { label: 'Suchen & ersetzen', icon: 'replace', onClick: () => openFind(true) },
      { label: 'Seite einrichten …', icon: 'pageSetup', onClick: () => pageSetup() },
      { label: 'Inhaltsverzeichnis einfügen', icon: 'toc', onClick: () => insertToc() },
      { label: 'Versionsverlauf …', icon: 'versions', onClick: () => versionsDialog() },
      { label: 'Wörter zählen …', icon: 'wordCount', onClick: () => wordCountDialog() },
      { label: autosaveOn ? 'Automatisch speichern: an' : 'Automatisch speichern: aus', icon: 'check', onClick: () => setAutosave(!autosaveOn) },
      speechSupported ? { label: 'Vorlesen', icon: 'speaker', onClick: () => readAloud() } : null,
      aiCaps.summarize ? { label: 'Zusammenfassen (auf dem Gerät)', icon: 'summary', onClick: () => import('../extras/ai.js').then(m => m.aiForText(ed.innerText, 'summarize', { title: shell.name })) } : null,
      aiCaps.translate ? { label: 'Übersetzen (auf dem Gerät)', icon: 'translate', onClick: () => import('../extras/ai.js').then(m => m.aiForText(ed.innerText, 'translate', { title: shell.name })) } : null,
      { label: 'KI-Schreibhilfe …', icon: 'sparkle', onClick: () => import('../ai/assist.js').then(m => m.writerAssist({ ed, range: savedRange, onChange: () => { shell.markDirty(); onInput(); } })) },
      { label: 'Tastenkürzel', icon: 'keyboard', onClick: () => shortcutsDialog() },
      '-',
      { label: 'Teilen', icon: 'share', onClick: async () => { const b = await serialize(kind); shareBlob(b, shell.name, KINDS[kind].mime); } },
      { label: 'Kopie speichern unter …', icon: 'copy', onClick: () => shell.save({ asCopy: true }) },
      { label: 'Umbenennen', icon: 'edit', onClick: () => shell.rename() },
    ],
  });

  // ---------- DOM ----------
  screen.body.innerHTML = '';
  screen.body.classList.add('office-body');
  const fontOpts = FONTS.map(f => `<option value="${esc(f.name)}">${esc(f.name)}</option>`).join('');
  const tbl = (icon, label, attrs) => `<button class="tb tb-l" type="button" aria-label="${esc(label)}" title="${esc(label)}" ${attrs}>${oicon(icon)}<span>${esc(label)}</span></button>`;
  const wrap = h(`<div class="writer">
    <div class="ribbon">
      <div class="rb-tabs" role="tablist" aria-label="Menüband">
        ${[['start', 'Start'], ['insert', 'Einfügen'], ['layout', 'Layout'], ['review', 'Überprüfen'], ['mailings', 'Sendungen'], ['view', 'Ansicht'], ['table', 'Tabelle'], ['image', 'Bild']].map(([k, l], i) => `<button class="rb-tab${k === 'table' || k === 'image' ? ' rb-ctx' : ''}" type="button" role="tab" data-rb="${k}" aria-selected="${i === 0}"${k === 'table' || k === 'image' ? ' hidden' : ''}>${l}</button>`).join('')}
      </div>
      <div class="office-toolbar" role="toolbar" aria-label="Formatierung" data-rbp="start">
        <div class="tb-group">${tb('undo', 'Rückgängig (Strg+Z)', 'data-cmd="undo"')}${tb('redo', 'Wiederholen (Strg+Y)', 'data-cmd="redo"')}${tb('pasteText', 'Als reinen Text einfügen (Strg+Umschalt+Alt+V)', 'data-x="paste-text"')}${tb('painter', 'Format übertragen (Strg+Umschalt+C / V)', 'data-x="painter"')}</div>
        <div class="tb-group">
          <label class="sr-only" for="w-block">Formatvorlage</label>
          <select class="tb-select tb-style" id="w-block" data-block title="Formatvorlage">${STYLE_OPTS.map(([v, , l]) => `<option value="${v}">${l}</option>`).join('')}</select>
          <label class="sr-only" for="w-font">Schriftart</label>
          <select class="tb-select tb-font" id="w-font" data-font title="Schriftart"><option value="">Schriftart</option>${fontOpts}</select>
          <label class="sr-only" for="w-size">Schriftgröße</label>
          <select class="tb-select tb-size" id="w-size" data-size title="Schriftgröße">
            <option value="">Größe</option>${F.SIZES.map(s => `<option value="${s}">${String(s).replace('.', ',')} pt</option>`).join('')}
          </select>
          ${tb('fontUp', 'Schrift vergrößern (Strg+Umschalt+>)', 'data-x="grow"')}${tb('fontDown', 'Schrift verkleinern (Strg+Umschalt+<)', 'data-x="shrink"')}
        </div>
        <div class="tb-group">${tb('bold', 'Fett (Strg+B)', 'data-cmd="bold"')}${tb('italic', 'Kursiv (Strg+I)', 'data-cmd="italic"')}${tb('underline', 'Unterstrichen (Strg+U)', 'data-cmd="underline"')}${tb('strike', 'Durchgestrichen', 'data-cmd="strikeThrough"')}${tb('superscript', 'Hochgestellt (Strg+Umschalt++)', 'data-cmd="superscript"')}${tb('subscript', 'Tiefgestellt (Strg+#)', 'data-cmd="subscript"')}
          <span class="tb-color">${tb('color', 'Textfarbe', 'data-color="fore"')}<span class="tb-swatch" data-swatch="fore" style="background:#C2410C"></span></span>
          <span class="tb-color">${tb('fill', 'Hervorheben', 'data-color="back"')}<span class="tb-swatch" data-swatch="back" style="background:#FDE047"></span></span>
          ${tb('changeCase', 'Groß-/Kleinschreibung (Umschalt+F3)', 'data-x="case"')}${tb('clearFormat', 'Formatierung löschen (Strg+Leertaste)', 'data-x="clear"')}
        </div>
        <div class="tb-group">${tb('alignLeft', 'Linksbündig (Strg+L)', 'data-cmd="justifyLeft"')}${tb('alignCenter', 'Zentriert (Strg+E)', 'data-cmd="justifyCenter"')}${tb('alignRight', 'Rechtsbündig (Strg+R)', 'data-cmd="justifyRight"')}${tb('alignJustify', 'Blocksatz (Strg+J)', 'data-cmd="justifyFull"')}${tb('lineSpacing', 'Zeilen- und Absatzabstand', 'data-x="spacing"')}</div>
        <div class="tb-group">${tb('listUl', 'Aufzählung', 'data-cmd="insertUnorderedList"')}${tb('listOl', 'Nummerierung', 'data-cmd="insertOrderedList"')}${tb('multilevel', 'Liste mit mehreren Ebenen', 'data-x="multilevel"')}${tb('indentDec', 'Einzug verkleinern (Strg+Umschalt+M)', 'data-x="outdent"')}${tb('indentInc', 'Einzug vergrößern (Strg+M)', 'data-x="indent"')}</div>
        <div class="tb-group w-gallery" role="group" aria-label="Formatvorlagen">${['normal', 'title', 'h1', 'h2', 'h3', 'quote'].map(s => `<button class="w-sty" type="button" data-sty="${s}" title="${esc(styles[s].name)}"><span class="w-sty-${s}">${esc(styles[s].name)}</span></button>`).join('')}${tb('wstyles', 'Formatvorlagen verwalten', 'data-x="styles"')}</div>
        <div class="tb-group">${tb('table', 'Tabelle', 'data-table')}${tb('image', 'Bild einfügen', 'data-image')}${tb('link', 'Link (Strg+K)', 'data-link')}${tb('pages', 'Seitenumbruch (Strg+Enter)', 'data-pagebreak')}</div>
        <div class="tb-group">${tb('outline', 'Gliederung', 'data-panel="outline"')}${tb('toc', 'Inhaltsverzeichnis einfügen', 'data-toc')}${tb('comment', 'Kommentar hinzufügen', 'data-comment')}${tb('footnote', 'Fußnote einfügen', 'data-footnote')}${tb('pageSetup', 'Seite einrichten: Format, Ränder, Kopf- und Fußzeile', 'data-pagesetup')}</div>
        <div class="tb-group">${tb('spell', 'Rechtschreibprüfung', 'data-spell')}${tb('mic', 'Diktieren', 'data-dictate hidden')}${tb('speaker', 'Vorlesen', 'data-read' + (speechSupported ? '' : ' hidden'))}${tb('replace', 'Suchen & ersetzen (Strg+F)', 'data-find')}</div>
      </div>
      <div class="office-toolbar" role="toolbar" aria-label="Einfügen" data-rbp="insert" hidden>
        <div class="tb-group">${tbl('table', 'Tabelle', 'data-x="ins-table"')}${tbl('image', 'Bild', 'data-x="ins-image"')}${tbl('shapes', 'Form', 'data-x="ins-shape"')}${tbl('textbox', 'Textfeld', 'data-x="ins-textbox"')}</div>
        <div class="tb-group">${tbl('link', 'Link', 'data-x="ins-link"')}${tbl('bookmark', 'Textmarke', 'data-x="ins-bookmark"')}${tbl('crossRef', 'Querverweis', 'data-x="ins-xref"')}</div>
        <div class="tb-group">${tbl('pages', 'Seitenumbruch', 'data-x="ins-pagebreak"')}${tbl('sectionBreak', 'Abschnittsumbruch', 'data-x="ins-section"')}</div>
        <div class="tb-group">${tbl('toc', 'Inhaltsverzeichnis', 'data-x="ins-toc"')}${tbl('footnote', 'Fußnote', 'data-x="ins-footnote"')}${tbl('endnote', 'Endnote', 'data-x="ins-endnote"')}${tbl('caption', 'Beschriftung', 'data-x="ins-caption"')}${tbl('comment', 'Kommentar', 'data-x="ins-comment"')}</div>
        <div class="tb-group">${tbl('header', 'Kopf- und Fußzeile', 'data-x="ins-hf"')}${tbl('hash', 'Seitenzahlen', 'data-x="ins-pn"')}${tbl('dateIns', 'Datum', 'data-x="ins-date"')}${tbl('sparkle', 'Symbol', 'data-x="ins-symbol"')}${tbl('dropCap', 'Initiale', 'data-x="ins-dropcap"')}</div>
      </div>
      <div class="office-toolbar" role="toolbar" aria-label="Layout" data-rbp="layout" hidden>
        <div class="tb-group">${tbl('pageSetup', 'Seitenränder', 'data-x="margins"')}${tbl('rotate', 'Ausrichtung', 'data-x="orient"')}${tbl('page', 'Format', 'data-x="size"')}</div>
        <div class="tb-group">${tbl('columns2', 'Spalten', 'data-x="columns"')}${tbl('sectionBreak', 'Umbrüche', 'data-x="breaks"')}</div>
        <div class="tb-group">${tbl('indentInc', 'Absatz …', 'data-x="para"')}${tbl('lineSpacing', 'Abstand', 'data-x="spacing2"')}${tbl('tabStops', 'Tabstopps', 'data-x="tabs"')}</div>
        <div class="tb-group">${tbl('header', 'Kopf- und Fußzeile', 'data-x="ins-hf"')}${tbl('hash', 'Seitenzahlen', 'data-x="ins-pn"')}${tbl('watermark', 'Wasserzeichen', 'data-x="watermark"')}</div>
        <div class="tb-group">${tbl('pageSetup', 'Seite einrichten …', 'data-x="pagesetup"')}</div>
      </div>
      <div class="office-toolbar" role="toolbar" aria-label="Überprüfen" data-rbp="review" hidden>
        <div class="tb-group">${tbl('spell', 'Rechtschreibung', 'data-x="spell"')}${tbl('language', 'Sprache', 'data-x="lang"')}${tbl('wordCount', 'Wörter zählen', 'data-x="wordcount"')}</div>
        <div class="tb-group">${tbl('comment', 'Neuer Kommentar', 'data-x="ins-comment2"')}${tbl('panel', 'Kommentare', 'data-x="comments"')}</div>
        <div class="tb-group">${tbl('track', 'Änderungen nachverfolgen', 'data-x="track"')}<label class="sr-only" for="w-markup">Markup-Anzeige</label><select class="tb-select" id="w-markup" data-markup title="Markup-Anzeige"><option value="all">Alle Markups</option><option value="final">Kein Markup</option><option value="original">Original</option></select>${tbl('panel', 'Änderungen', 'data-x="changes"')}</div>
        <div class="tb-group">${tb('chevronUp', 'Vorherige Änderung', 'data-x="tc-prev"')}${tb('chevronDown', 'Nächste Änderung', 'data-x="tc-next"')}${tbl('accept', 'Annehmen', 'data-x="accept"')}${tbl('reject', 'Ablehnen', 'data-x="reject"')}</div>
      </div>
      <div class="office-toolbar" role="toolbar" aria-label="Sendungen" data-rbp="mailings" hidden>
        <div class="tb-group">${tbl('contact', 'Empfänger wählen', 'data-x="mm-source"')}${tbl('mailMerge', 'Seriendruckfeld', 'data-x="mm-field"')}</div>
        <div class="tb-group">${tbl('eye', 'Vorschau', 'data-x="mm-preview"')}${tb('chevronLeft', 'Vorheriger Datensatz', 'data-x="mm-prev"')}<span class="mm-pos" data-mmpos>–</span>${tb('chevronRight', 'Nächster Datensatz', 'data-x="mm-next"')}</div>
        <div class="tb-group">${tbl('check', 'Fertigstellen', 'data-x="mm-finish"')}</div>
      </div>
      <div class="office-toolbar" role="toolbar" aria-label="Ansicht" data-rbp="view" hidden>
        <div class="tb-group">${tbl('pageView', 'Seitenlayout', 'data-x="view-page"')}${tbl('webView', 'Webansicht', 'data-x="view-web"')}${tbl('readMode', 'Lesemodus', 'data-x="view-read"')}${tbl('focusMode', 'Fokusmodus', 'data-x="view-focus"')}</div>
        <div class="tb-group">${tbl('ruler', 'Lineal', 'data-x="ruler"')}${tbl('outline', 'Navigation', 'data-x="nav"')}${tbl('text', 'Formatierungszeichen', 'data-x="marks"')}</div>
        <div class="tb-group">${tb('zoomOut', 'Verkleinern', 'data-x="zoom-out"')}<label class="sr-only" for="w-zoom">Zoom</label><select class="tb-select tb-zoom" id="w-zoom" data-zoom title="Zoom">${ZOOMS.map(z => `<option value="${z}">${Math.round(z * 100)} %</option>`).join('')}<option value="fit">Seitenbreite</option></select>${tb('zoomIn', 'Vergrößern', 'data-x="zoom-in"')}${tbl('fitWidth', 'Seitenbreite', 'data-x="zoom-fit"')}</div>
        <div class="tb-group">${tbl('gotoPage', 'Gehe zu Seite', 'data-x="goto"')}${tbl('versions', 'Versionen', 'data-x="versions"')}${tbl('check', 'Automatisch speichern', 'data-x="autosave"')}${tbl('keyboard', 'Tastenkürzel', 'data-x="keys"')}</div>
      </div>
      <div class="office-toolbar" role="toolbar" aria-label="Tabelle" data-rbp="table" hidden>
        <div class="tb-group">${tbl('rowAdd', 'Zeile oberhalb', 'data-t="row-above"')}${tbl('rowAdd', 'Zeile unterhalb', 'data-t="row-below"')}${tbl('colAdd', 'Spalte links', 'data-t="col-left"')}${tbl('colAdd', 'Spalte rechts', 'data-t="col-right"')}</div>
        <div class="tb-group">${tbl('rowDel', 'Zeile löschen', 'data-t="del-row"')}${tbl('colDel', 'Spalte löschen', 'data-t="del-col"')}${tbl('trash', 'Tabelle löschen', 'data-t="del-table"')}</div>
        <div class="tb-group">${tbl('cellMerge', 'Zellen verbinden', 'data-t="merge"')}${tbl('cellSplit', 'Zelle teilen', 'data-t="split"')}${tbl('fitWidth', 'Spalten verteilen', 'data-t="distribute"')}</div>
        <div class="tb-group">${tbl('shading', 'Schattierung', 'data-t="shade"')}${tbl('border', 'Rahmen', 'data-t="borders"')}${tbl('tableStyle', 'Tabellenformat', 'data-t="style"')}${tbl('headerRow', 'Überschriftenzeile', 'data-t="header"')}${tbl('settings', 'Eigenschaften', 'data-t="props"')}</div>
        <div class="tb-group">${tbl('sortAsc', 'Sortieren', 'data-t="sort"')}${tbl('fx', 'Formel', 'data-t="formula"')}${tbl('textToTable', 'In Text umwandeln', 'data-t="totext"')}${tbl('caption', 'Beschriftung', 'data-x="ins-caption"')}</div>
      </div>
      <div class="office-toolbar" role="toolbar" aria-label="Bild" data-rbp="image" hidden>
        <div class="tb-group">${tbl('wrapText', 'Textumbruch', 'data-i="wrap"')}${tbl('alignCenter', 'Ausrichten', 'data-i="align"')}</div>
        <div class="tb-group">${tbl('crop', 'Zuschneiden', 'data-i="crop"')}${tbl('rotateImg', 'Drehen', 'data-i="rotate"')}${tbl('resize', 'Größe …', 'data-i="size"')}</div>
        <div class="tb-group">${tbl('altText', 'Alternativtext', 'data-i="alt"')}${tbl('caption', 'Beschriftung', 'data-x="ins-caption"')}${tbl('trash', 'Löschen', 'data-i="delete"')}</div>
      </div>
    </div>
    <div class="findbar w-find" hidden>
      <input class="input" type="search" data-fq placeholder="Suchen …" aria-label="Suchbegriff">
      <span class="find-count" data-fcount aria-live="polite"></span>
      <button class="icon-btn" type="button" data-fprev aria-label="Vorheriger Treffer">${oicon('chevronUp')}</button>
      <button class="icon-btn" type="button" data-fnext aria-label="Nächster Treffer">${oicon('chevronDown')}</button>
      <input class="input" type="text" data-fr placeholder="Ersetzen durch …" aria-label="Ersetzen durch">
      <button class="btn btn-ghost btn-sm" type="button" data-frep>Ersetzen</button>
      <button class="btn btn-ghost btn-sm" type="button" data-freall>Alle</button>
      <label class="check find-opt" title="Groß-/Kleinschreibung beachten"><input type="checkbox" data-fcase> Aa</label>
      <label class="check find-opt" title="Nur ganze Wörter"><input type="checkbox" data-fword> Ganzes Wort</label>
      <label class="check find-opt" title="Reguläre Ausdrücke"><input type="checkbox" data-fregex> Regex</label>
      <button class="icon-btn" type="button" data-fclose aria-label="Suche schließen">${oicon('close')}</button>
    </div>
    <div class="w-ruler" hidden aria-hidden="true"></div>
    <div class="writer-main">
      <aside class="w-panel w-outline" hidden aria-label="Gliederung"><div class="w-panel-head"><strong>Gliederung</strong><button class="icon-btn" type="button" data-close-panel aria-label="Gliederung schließen">${oicon('close')}</button></div><nav class="w-outline-list"></nav></aside>
      <div class="writer-scroll"><div class="doc-sheet">
        <div class="pv-pages" aria-hidden="true"></div>
        <button class="doc-hf top" type="button" data-hf="header" hidden></button>
        <div class="doc-page${plain ? ' plain-text' : ''}" contenteditable="true" spellcheck="true" lang="de-DE" role="textbox" aria-multiline="true" aria-label="Dokumentinhalt"></div>
        <div class="doc-fn-area" hidden></div>
        <div class="doc-en-area" hidden></div>
        <button class="doc-hf bottom" type="button" data-hf="footer" hidden></button>
        <div class="img-handles" hidden><i data-h="nw"></i><i data-h="ne"></i><i data-h="sw"></i><i data-h="se"></i></div>
      </div></div>
      <aside class="w-panel w-comments" hidden aria-label="Kommentare"><div class="w-panel-head"><strong>Kommentare</strong><button class="icon-btn" type="button" data-close-panel aria-label="Kommentare schließen">${oicon('close')}</button></div><div class="w-cmt-list"></div></aside>
      <aside class="w-panel w-changes" hidden aria-label="Änderungen"><div class="w-panel-head"><strong>Änderungen</strong><button class="icon-btn" type="button" data-close-panel aria-label="Änderungen schließen">${oicon('close')}</button></div>
        <div class="w-tc-actions"><button class="btn btn-ghost btn-sm" type="button" data-tcall="accept">Alle annehmen</button><button class="btn btn-ghost btn-sm" type="button" data-tcall="reject">Alle ablehnen</button></div><div class="w-tc-list"></div></aside>
    </div>
    <div class="readbar w-readbar" hidden></div>
    <button class="w-modeexit" type="button" hidden>${oicon('close')}<span>Fokusmodus beenden</span></button>
    <div class="dictate-pill" hidden aria-live="polite"></div>
    <input type="color" class="sr-only" data-colorinput aria-label="Farbe wählen" tabindex="-1">
  </div>`);
  screen.body.appendChild(wrap);
  const ed = $('.doc-page', wrap);
  const sheet = $('.doc-sheet', wrap);
  const scrollBox = $('.writer-scroll', wrap);
  const pagesEl = $('.pv-pages', wrap);
  const styleEl = document.createElement('style');
  styleEl.className = 'w-doc-styles';
  wrap.prepend(styleEl);
  const applyStylesCss = () => { styleEl.textContent = plain ? '' : stylesCss(styles, '.writer .doc-page'); };
  applyStylesCss();
  ed.style.fontSize = `${baseSize}pt`;
  ed.innerHTML = html;
  stripBlockWhitespace(ed);
  try { document.execCommand('styleWithCSS', false, false); document.execCommand('defaultParagraphSeparator', false, 'p'); } catch {}

  const LS = { get: (k, d) => { try { const v = localStorage.getItem(k); return v === null ? d : v; } catch { return d; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch {} } };

  // ---------- status bar ----------
  const status = h('<button class="foot-info w-count" type="button" data-wordcount aria-live="off" title="Wörter zählen"></button>');
  const pageInfo = h('<span class="foot-info w-pageinfo" data-pageinfo></span>');
  const trackInfo = h('<span class="foot-info w-trackinfo" hidden>Nachverfolgung an</span>');
  const zoomBox = h(`<span class="w-zoombox"><button class="icon-btn" type="button" data-zf="-1" aria-label="Verkleinern">${oicon('minus')}</button><button class="w-zoomval" type="button" data-zf="0" title="Zoom zurücksetzen">100 %</button><button class="icon-btn" type="button" data-zf="1" aria-label="Vergrößern">${oicon('plus')}</button></span>`);
  screen.setFoot([], ' ');
  screen.foot.innerHTML = '';
  screen.foot.append(pageInfo, status, trackInfo, zoomBox);
  screen.foot.classList.add('office-foot', 'w-foot');
  screen.foot.hidden = false;
  status.addEventListener('click', () => wordCountDialog());

  let aiCaps = { summarize: false, translate: false };
  import('../extras/ai.js').then(m => m.aiCapabilities()).then(c => { aiCaps = c; }).catch(() => {});
  const textOf = root => { const c = root.cloneNode(true); c.querySelectorAll('del.tc, [data-toc], .img-handles').forEach(x => x.remove()); return c.innerText || c.textContent || ''; };
  const countText = text => ({
    words: (text.match(/[\p{L}\p{N}]+(?:['’\-.][\p{L}\p{N}]+)*/gu) || []).length,
    chars: text.replace(/\n/g, '').length,
    charsNoSpace: text.replace(/\s/g, '').length,
  });
  const countWords = () => {
    const c = countText(ed.innerText || '');
    status.textContent = `${c.words.toLocaleString('de-DE')} Wörter · ${c.chars.toLocaleString('de-DE')} Zeichen${kind !== 'docx' ? ` · ${KINDS[kind].label}` : ''}`;
  };
  countWords();

  // ---------- history (own undo stack) ----------
  const hist = createHistory(ed, { onRestore: () => { shell.markDirty(); afterChange(); } });
  const changed = () => { shell.markDirty(); updateState(); onInput(); };
  let extras = null;
  const capture = (k = 'op') => hist.capture(k);
  ed.addEventListener('beforeinput', e => {
    const t = e.inputType;
    if (t === 'historyUndo') { e.preventDefault(); doUndo(); return; }
    if (t === 'historyRedo') { e.preventDefault(); doRedo(); return; }
    if (/^insert(Text|ReplacementText|CompositionText)$/.test(t)) capture('type');
    else if (/^delete/.test(t)) capture('del');
    else capture('op');
  }, true);
  ed.addEventListener('compositionstart', () => capture('type'), true);
  function doUndo() { if (hist.undo()) toastQuiet(); }
  function doRedo() { hist.redo(); }
  const toastQuiet = () => {};

  const onInput = debounce(() => { F.convertSentinels(ed); liftBlocks(); countWords(); if (findOpen) runFind(false); refreshStructure(); pv.schedule(); ruler && rulerPaint(); }, 200);
  ed.addEventListener('input', () => { shell.markDirty(); onInput(); });
  function afterChange() { F.convertSentinels(ed); countWords(); refreshStructure(); pv.refresh(); updateState(); }

  // ---------- serialize / export ----------
  function modelNow() {
    const model = htmlToModel(ed, { baseSize, styles: plain ? null : styles });
    if (plain) model.tight = true;
    return model;
  }
  async function serialize(k) {
    if (mm.preview) mmPreview(false);
    const model = modelNow();
    if (k === 'docx') {
      const { modelToDocx } = await import('./docx-write.js');
      const blob = await modelToDocx(model, { title: stripExt(shell.name), page, hf, author: await authorName(), trackChanges: tracker.enabled });
      return new Blob([blob], { type: KINDS.docx.mime });
    }
    if (k === 'md') return new Blob([modelToMarkdown(model)], { type: 'text/markdown;charset=utf-8' });
    return new Blob([modelToText(model).replace(/\n/g, '\r\n')], { type: 'text/plain;charset=utf-8' });
  }
  async function dl(k) {
    try { downloadBlob(await serialize(k), stripExt(shell.name) + KINDS[k].ext); } catch (e) { errorToast(e, 'Export fehlgeschlagen.'); }
  }
  async function exportPdf() {
    const model = modelNow();
    const { modelToPdf } = await import('./docpdf.js');
    await exportPdfFlow(shell.name, onP => modelToPdf(model, { title: stripExt(shell.name), page, hf, onProgress: onP }));
  }

  // ---------- selection helpers ----------
  const tbEls = $$('.office-toolbar', wrap);
  const tbEl = tbEls[0];
  const ribbon = $('.ribbon', wrap);
  let savedRange = null;
  const saveSel = () => { const s = getSelection(); if (s.rangeCount && ed.contains(s.anchorNode)) savedRange = s.getRangeAt(0).cloneRange(); };
  const restoreSel = () => {
    const cur = getSelection();
    if (cur.rangeCount && ed.contains(cur.anchorNode)) { savedRange = cur.getRangeAt(0).cloneRange(); }
    ed.focus({ preventScroll: true });
    if (!savedRange) return;
    const s = getSelection(); s.removeAllRanges(); s.addRange(savedRange);
  };
  const curRange = () => { const s = getSelection(); return s.rangeCount && ed.contains(s.anchorNode) ? s.getRangeAt(0) : savedRange; };
  const selBlocks = () => F.blocksIn(ed, curRange());
  // keep the editor selection when tapping toolbar buttons
  ribbon.addEventListener('mousedown', e => { if (e.target.closest('button')) e.preventDefault(); });
  ribbon.addEventListener('pointerdown', saveSel, true);
  /** Run fn and put the selection back on the same text positions (DOM moves drop the live selection). */
  function keepSel(fn) {
    const s = getSelection();
    let a = null;
    if (s.rangeCount && ed.contains(s.anchorNode)) { const r = s.getRangeAt(0); a = [r.startContainer, r.startOffset, r.endContainer, r.endOffset]; }
    const res = fn();
    if (a && a[0].isConnected && a[2].isConnected && ed.contains(a[0]) && ed.contains(a[2])) {
      const len = n => (n.nodeType === 3 ? n.length : n.childNodes.length);
      try { const r = document.createRange(); r.setStart(a[0], Math.min(a[1], len(a[0]))); r.setEnd(a[2], Math.min(a[3], len(a[2]))); s.removeAllRanges(); s.addRange(r); } catch {}
    }
    return res;
  }
  /** Blocks nested in paragraphs (browser quirk with list commands / insertHTML) are moved out. */
  function liftBlocks() {
    const nested = $$(':is(p,h1,h2,h3,h4,h5,h6) > :is(ul,ol,table,blockquote,pre,div,h1,h2,h3,h4,h5,h6,p,hr)', ed).filter(x => !x.closest('td,th,[contenteditable="false"]'));
    if (!nested.length) return;
    keepSel(() => {
      for (const blk of nested) {
        const p = blk.parentElement;
        if (!p || !ed.contains(p)) continue;
        const after = p.cloneNode(false);
        while (blk.nextSibling) after.appendChild(blk.nextSibling);
        p.after(blk);
        const has = x => x.textContent.replace(/\u200b/g, '').trim() || x.querySelector('img,sup.fn,span.mf');
        if (has(after)) blk.after(after);
        if (!has(p)) p.remove();
      }
    });
  }
  const frag = html => { const t = document.createElement('template'); t.innerHTML = html; return t.content; };
  const placeCaret = (node, off) => { const r = document.createRange(); r.setStart(node, off); r.collapse(true); const s = getSelection(); s.removeAllRanges(); s.addRange(r); };
  /** Insert block content (table, break, text box …) at the caret: the paragraph is split there. */
  function insertBlock(html) {
    restoreSel();
    const s = getSelection();
    let r = s.rangeCount && ed.contains(s.anchorNode) ? s.getRangeAt(0) : null;
    if (r && !r.collapsed) { r.deleteContents(); r = s.getRangeAt(0); }
    const f = frag(html);
    const nodes = Array.from(f.childNodes);
    let blk = r ? F.blockOf(ed, r.startContainer) : null;
    if (blk && blk.tagName === 'LI') blk = null;
    if (!blk) {
      if (r && r.startContainer !== ed && ed.contains(r.startContainer)) { r.insertNode(f); }
      else ed.appendChild(f);
    } else {
      const empty = !blk.textContent.replace(/\u200b/g, '').trim() && !blk.querySelector('img,sup.fn,span.mf,table');
      if (empty) blk.before(f);
      else {
        const tail = document.createRange();
        tail.setStart(r.startContainer, r.startOffset);
        tail.setEndAfter(blk.lastChild);
        const rest = tail.extractContents();
        const nb = blk.cloneNode(false);
        nb.removeAttribute('id');
        nb.appendChild(rest);
        blk.after(f);
        const has = x => x.textContent.replace(/\u200b/g, '').trim() || x.querySelector('img,sup.fn,span.mf');
        if (has(nb)) nodes[nodes.length - 1].after(nb);
        if (!blk.firstChild) blk.appendChild(document.createElement('br'));
      }
    }
    // caret into the first paragraph after the inserted content (or into the content)
    const last = nodes[nodes.length - 1];
    let next = last && last.nextElementSibling;
    if (last && last.tagName === 'P' && !last.textContent.trim()) next = last;
    if (!next) { next = document.createElement('p'); next.innerHTML = '<br>'; (last || ed.lastChild).after(next); }
    placeCaret(next, 0);
    return nodes;
  }
  /** Insert inline content (image, field, footnote mark …) at the caret without browser style wrappers. */
  function insertInline(html) {
    restoreSel();
    const s = getSelection();
    let r = s.rangeCount && ed.contains(s.anchorNode) ? s.getRangeAt(0) : null;
    if (!r) { const p = ed.lastElementChild || ed; r = document.createRange(); r.selectNodeContents(p); r.collapse(false); }
    if (!r.collapsed) r.deleteContents();
    let c = r.startContainer;
    if (c === ed) { const p = document.createElement('p'); ed.insertBefore(p, ed.childNodes[r.startOffset] || null); r.setStart(p, 0); r.collapse(true); c = p; }
    // a lone <br> placeholder goes away
    if (c.nodeType === 1 && c.childNodes.length === 1 && c.firstChild.nodeName === 'BR') c.firstChild.remove();
    const f = frag(html);
    const nodes = Array.from(f.childNodes);
    r.insertNode(f);
    const last = nodes[nodes.length - 1];
    if (last) { const rr = document.createRange(); rr.setStartAfter(last); rr.collapse(true); s.removeAllRanges(); s.addRange(rr); }
    return nodes;
  }
  const exec = (cmd, val = null) => { restoreSel(); capture(); document.execCommand(cmd, false, val); liftBlocks(); changed(); };
  /** Run a DOM operation on the editor with undo support. */
  const op = fn => { restoreSel(); capture(); const r = keepSel(fn); liftBlocks(); changed(); pv.schedule(30); return r; };

  // ribbon tabs
  let ribbonTab = 'start';
  function showRibbon(k) {
    ribbonTab = k;
    $$('[data-rb]', wrap).forEach(b => b.setAttribute('aria-selected', String(b.dataset.rb === k)));
    $$('[data-rbp]', wrap).forEach(p => { p.hidden = p.dataset.rbp !== k; });
  }
  $$('[data-rb]', wrap).forEach(b => b.addEventListener('click', () => showRibbon(b.dataset.rb)));

  // ---------- toolbar actions ----------
  ribbon.addEventListener('click', async e => {
    const b = e.target.closest('button');
    if (!b || !ribbon.contains(b) || b.closest('.rb-tabs')) return;
    if (b.dataset.cmd) {
      if (b.dataset.cmd === 'undo') { ed.focus({ preventScroll: true }); doUndo(); return; }
      if (b.dataset.cmd === 'redo') { ed.focus({ preventScroll: true }); doRedo(); return; }
      if (b.dataset.cmd === 'insertUnorderedList' || b.dataset.cmd === 'insertOrderedList') { exec(b.dataset.cmd); return; }
      exec(b.dataset.cmd);
      return;
    }
    if (b.dataset.color) { pickColor(b.dataset.color); return; }
    if (b.hasAttribute('data-table')) { tableAction(b); return; }
    if (b.hasAttribute('data-image')) { insertImage(); return; }
    if (b.hasAttribute('data-link')) { insertLink(); return; }
    if (b.hasAttribute('data-pagebreak')) { insertPageBreak(); return; }
    if (b.hasAttribute('data-find')) { openFind(true); return; }
    if (b.dataset.panel) { togglePanel(b.dataset.panel); return; }
    if (b.hasAttribute('data-toc')) { insertToc(); return; }
    if (b.hasAttribute('data-comment')) { addComment(); return; }
    if (b.hasAttribute('data-footnote')) { insertFootnote(); return; }
    if (b.hasAttribute('data-pagesetup')) { pageSetup(); return; }
    if (b.hasAttribute('data-spell')) { setSpell(!spellOn); return; }
    if (b.hasAttribute('data-dictate')) { toggleDictation(); return; }
    if (b.hasAttribute('data-read')) { readAloud(); return; }
    if (b.dataset.sty) { setBlockStyle(b.dataset.sty); return; }
    if (b.dataset.x) { act(b.dataset.x, b); return; }
    if (b.dataset.t) { tableCmd(b.dataset.t, b); return; }
    if (b.dataset.i) { imageCmd(b.dataset.i, b); }
  });

  async function act(x, b) {
    switch (x) {
      case 'painter': return painterStart(false);
      case 'grow': case 'shrink': { const f = F.currentFmt(ed, curRange() && curRange().startContainer); return setFontSize(F.growFont(f && f.size, x === 'grow' ? 1 : -1)); }
      case 'case': return caseMenu(b);
      case 'clear': return clearFormatting();
      case 'spacing': case 'spacing2': return spacingMenu(b);
      case 'multilevel': return listMenu(b);
      case 'indent': return indent(1);
      case 'outdent': return indent(-1);
      case 'styles': return stylesDialog();
      case 'ins-table': return tableAction(b, true);
      case 'ins-image': return insertImage();
      case 'ins-shape': return shapeMenu(b);
      case 'ins-textbox': return insertTextbox();
      case 'ins-link': return insertLink();
      case 'ins-bookmark': return extras.bookmarkDialog();
      case 'ins-xref': return extras.crossRefDialog();
      case 'ins-endnote': return extras.insertEndnote();
      case 'ins-caption': return extras.captionDialog();
      case 'ins-dropcap': return extras.toggleDropCap();
      case 'tabs': return extras.tabsDialog();
      case 'paste-text': return pasteAsText();
      case 'lang': return languageMenu(b);
      case 'view-read': return setMode(mode === 'read' ? null : 'read');
      case 'view-focus': return setMode(mode === 'focus' ? null : 'focus');
      case 'ins-pagebreak': return insertPageBreak();
      case 'ins-section': return insertSectionBreak();
      case 'ins-toc': return tocMenu(b);
      case 'ins-footnote': return insertFootnote();
      case 'ins-comment': case 'ins-comment2': return addComment();
      case 'ins-hf': return editHf();
      case 'ins-pn': return pageNumberMenu(b);
      case 'watermark': return editWatermark();
      case 'pagesetup': return pageSetup();
      case 'ins-date': return insertDate(b);
      case 'ins-symbol': return symbolMenu(b);
      case 'margins': return marginsMenu(b);
      case 'orient': return orientMenu(b);
      case 'size': return sizeMenu(b);
      case 'columns': return columnsMenu(b);
      case 'breaks': return breaksMenu(b);
      case 'para': return paragraphDialog();
      case 'spell': return setSpell(!spellOn);
      case 'wordcount': return wordCountDialog();
      case 'comments': return togglePanel('comments');
      case 'track': return setTracking(!tracker.enabled);
      case 'changes': return togglePanel('changes');
      case 'tc-prev': return gotoChange(-1);
      case 'tc-next': return gotoChange(1);
      case 'accept': return reviewMenu(b, true);
      case 'reject': return reviewMenu(b, false);
      case 'mm-source': return mmSource();
      case 'mm-field': return mmField(b);
      case 'mm-preview': return mmPreview(!mm.preview);
      case 'mm-prev': return mmStep(-1);
      case 'mm-next': return mmStep(1);
      case 'mm-finish': return mmFinish();
      case 'view-page': return setView('page');
      case 'view-web': return setView('web');
      case 'ruler': return setRuler(!rulerOn);
      case 'nav': return togglePanel('outline');
      case 'marks': return setMarks(!marksOn);
      case 'zoom-in': return setZoom(nextZoom(1));
      case 'zoom-out': return setZoom(nextZoom(-1));
      case 'zoom-fit': return setZoom('fit');
      case 'goto': return gotoPageDialog();
      case 'versions': return versionsDialog();
      case 'autosave': return setAutosave(!autosaveOn);
      case 'keys': return shortcutsDialog();
      default: return null;
    }
  }

  // ---------- styles (Formatvorlagen) ----------
  const blockSel = $('[data-block]', wrap);
  blockSel.addEventListener('change', () => { const v = blockSel.value; const id = STYLE_OF_VAL[v] || (v.startsWith('us:') ? v.slice(3) : 'normal'); setBlockStyle(id); });
  function fillStyleSelect() {
    const custom = customStyleIds(styles);
    blockSel.innerHTML = STYLE_OPTS.map(([v, , l]) => `<option value="${v}">${esc(l)}</option>`).join('') + (custom.length ? `<optgroup label="Eigene Formatvorlagen">${custom.map(id => `<option value="us:${id}">${esc(styles[id].name || id)}</option>`).join('')}</optgroup>` : '');
  }
  fillStyleSelect();
  function setBlockStyle(id) {
    const nb = op(() => F.applyStyle(ed, selBlocks(), id));
    const s = getSelection();
    const inNew = s.rangeCount && nb.some(b => b.contains(s.anchorNode));
    if (nb.length && !inNew) { const r = document.createRange(); r.selectNodeContents(nb[0]); r.collapse(false); s.removeAllRanges(); s.addRange(r); updateState(); }
    ed.focus({ preventScroll: true });
  }
  async function stylesDialog() {
    const blk = F.blockOf(ed, curRange() && curRange().startContainer);
    const curId = blk ? styleOfBlock(blk) : 'normal';
    const ids = [...STYLE_ORDER, ...customStyleIds(styles)];
    const numbered = !!(styles.h1 && styles.h1.numbered);
    const r = await openDialog({
      title: 'Formatvorlagen', wide: true,
      body: `<div class="w-st-top"><button class="btn btn-ghost btn-sm" type="button" data-new>${oicon('styleNew')}<span>Neue Formatvorlage …</span></button>
        <label class="check"><input type="checkbox" data-hnum ${numbered ? 'checked' : ''}> Überschriften nummerieren (1 · 1.1 · 1.1.1)</label></div>
        <div class="w-stylelist">${ids.map(sid => `<div class="w-st-row${sid === curId ? ' on' : ''}"><span class="w-st-prev w-sty-${sid}">${esc(styles[sid].name || sid)}</span><span class="w-st-count muted small">${$$(selectorOf(sid), ed).length} ×</span>
        <span class="w-st-btns"><button class="btn btn-ghost btn-sm" type="button" data-apply="${sid}">Anwenden</button><button class="btn btn-ghost btn-sm" type="button" data-mod="${sid}">Ändern …</button><button class="btn btn-ghost btn-sm" type="button" data-upd="${sid}" title="Formatvorlage an die Formatierung des aktuellen Absatzes anpassen">Aus Markierung</button><button class="btn btn-ghost btn-sm" type="button" data-all="${sid}" title="Direkte Formatierung bei allen Absätzen dieser Formatvorlage entfernen">Alle angleichen</button>${isCustomStyle(sid) ? `<button class="btn btn-ghost btn-sm" type="button" data-delstyle="${sid}">Löschen</button>` : ''}</span></div>`).join('')}</div>
        <p class="hint">Formatvorlagen werden in der Word-Datei gespeichert (styles.xml) und beim Öffnen übernommen.</p>`,
      actions: [{ label: 'Schließen', value: 'cancel', kind: 'btn-primary' }],
      onMount: dlg => {
        let todo = null;
        dlg.addEventListener('click', e => {
          const x2 = e.target.closest('[data-apply],[data-mod],[data-upd],[data-all],[data-delstyle],[data-new]');
          if (!x2) return;
          todo = x2.dataset.apply ? ['apply', x2.dataset.apply] : x2.dataset.mod ? ['mod', x2.dataset.mod] : x2.dataset.upd ? ['upd', x2.dataset.upd] : x2.dataset.delstyle ? ['del', x2.dataset.delstyle] : x2.hasAttribute('data-new') ? ['new'] : ['all', x2.dataset.all];
          dlg.close();
        });
        $('[data-hnum]', dlg).addEventListener('change', e => { todo = ['hnum', e.target.checked]; dlg.close(); });
        return { collect: () => todo };
      },
    });
    const t = r.data;
    if (!t) return;
    const [what, sid] = t;
    if (what === 'apply') setBlockStyle(sid);
    else if (what === 'mod') {
      const ns = await F.styleModifyDialog(styles, sid);
      if (ns) { capture(); styles[sid] = { ...styles[sid], ...ns }; stylesChanged(); toast(`Formatvorlage „${styles[sid].name}“ geändert`, 'success'); }
    } else if (what === 'upd') {
      if (!blk) { toast('Setze den Cursor in einen Absatz.', 'info'); return; }
      capture();
      styles[sid] = F.styleFromBlock(blk, styles[sid]);
      F.resetDirectFormatting([blk]);
      stylesChanged();
      toast(`Formatvorlage „${styles[sid].name}“ angepasst`, 'success');
    } else if (what === 'all') {
      op(() => F.resetDirectFormatting($$(selectorOf(sid), ed)));
      toast('Absätze angeglichen', 'success');
    } else if (what === 'new') {
      const n = Math.max(0, ...customStyleIds(styles).map(id => +id.slice(1))) + 1;
      const id = `u${n}`;
      const baseSt = blk ? F.styleFromBlock(blk, { ...CUSTOM_BASE }) : { ...CUSTOM_BASE };
      styles[id] = { ...baseSt, name: '', custom: true };
      const ns = await F.styleModifyDialog(styles, id);
      if (!ns) { delete styles[id]; return; }
      capture();
      styles[id] = { ...ns, custom: true, name: ns.name || `Formatvorlage ${n}` };
      stylesChanged();
      if (blk) setBlockStyle(id);
      toast(`Formatvorlage „${styles[id].name}“ erstellt`, 'success');
    } else if (what === 'del') {
      capture();
      $$(`.us-${sid}`, ed).forEach(el => { el.classList.remove(`us-${sid}`); if (!el.getAttribute('class')) el.removeAttribute('class'); });
      const nm = styles[sid].name;
      delete styles[sid];
      stylesChanged();
      toast(`Formatvorlage „${nm}“ gelöscht`, 'success');
    } else if (what === 'hnum') {
      capture();
      for (const k of ['h1', 'h2', 'h3', 'h4']) styles[k] = { ...styles[k], numbered: !!sid };
      stylesChanged(); refreshStructure();
      toast(sid ? 'Überschriften werden nummeriert.' : 'Nummerierung der Überschriften aus.', 'success');
    }
  }
  const selectorOf = sid => ({ normal: 'p:not(.title):not(.subtitle):not(.quote):not(.nospace):not(.caption)', title: 'p.title', subtitle: 'p.subtitle', quote: 'p.quote, blockquote', code: 'pre', nospace: 'p.nospace', caption: 'p.caption' }[sid] || (isCustomStyle(sid) ? `p.us-${sid}` : sid));
  function stylesChanged() {
    fillStyleSelect();
    applyStylesCss();
    $$('.w-sty', wrap).forEach(b => { const s = styles[b.dataset.sty]; if (s) { b.title = s.name; b.firstElementChild.textContent = s.name; } });
    galleryCss();
    shell.markDirty(); pv.refresh(); updateState();
  }
  function galleryCss() {
    // previews in the gallery use the document's style fonts/colours (small)
    const css = ['normal', 'title', 'subtitle', 'h1', 'h2', 'h3', 'h4', 'quote', 'caption', 'code', 'nospace', ...customStyleIds(styles)].map(sid => {
      const s = styles[sid];
      return `.writer .w-sty-${sid}{font-family:${fontCss(s.font || styles.normal.font || 'Arial')};${s.color ? `color:${s.color};` : ''}font-weight:${s.b ? 700 : 400};font-style:${s.i ? 'italic' : 'normal'}}`;
    }).join('');
    styleEl.textContent = (plain ? '' : stylesCss(styles, '.writer .doc-page')) + css;
  }
  galleryCss();

  // ---------- fonts ----------
  const fontSel = $('[data-font]', wrap), sizeSel = $('[data-size]', wrap);
  fontSel.addEventListener('change', () => { const f = fontSel.value; if (!f) return; restoreSel(); capture(); F.applyInline(ed, { 'font-family': fontCss(f) }); changed(); });
  sizeSel.addEventListener('change', () => { const pt = +sizeSel.value; if (pt) setFontSize(pt); });
  function setFontSize(pt) { restoreSel(); capture(); F.applyInline(ed, { 'font-size': `${pt}pt` }); changed(); }

  const colorInput = $('[data-colorinput]', wrap);
  let colorMode = 'fore';
  function pickColor(mode) {
    colorMode = mode;
    const palette = mode === 'fore' ? ['#1A1A1A', '#C2410C', '#B91C1C', '#3B37A0', '#0B8F80', '#15803D', '#7E22CE', '#6B7194'] : HILITES.map(x => x[0]).concat(['#FFFFFF']);
    const anchor = $(`[data-color="${mode}"]`, wrap);
    officeMenu(anchor, [
      ...palette.map(c => ({ label: c === '#FFFFFF' ? 'Keine Hervorhebung' : mode === 'fore' ? colorName(c) : `Markieren: ${colorName(c)}`, icon: mode === 'fore' ? 'color' : 'fill', onClick: () => applyColor(c) })),
      '-',
      { label: 'Eigene Farbe …', icon: 'sparkle', onClick: () => { colorInput.value = '#3B37A0'; colorInput.click(); } },
    ], { label: mode === 'fore' ? 'Textfarbe' : 'Hervorheben' });
  }
  colorInput.addEventListener('change', () => applyColor(colorInput.value));
  function applyColor(c) {
    restoreSel(); capture();
    if (colorMode === 'fore') document.execCommand('foreColor', false, c);
    else { document.execCommand('styleWithCSS', false, true); document.execCommand('hiliteColor', false, c === '#FFFFFF' ? 'transparent' : c); document.execCommand('styleWithCSS', false, false); }
    $(`[data-swatch="${colorMode}"]`, wrap).style.background = c;
    changed();
  }
  function caseMenu(b) {
    officeMenu(b, [['sentence', 'Satzanfang groß'], ['lower', 'kleinbuchstaben'], ['upper', 'GROSSBUCHSTABEN'], ['title', 'Jedes Wort Groß'], ['toggle', 'gROSS/kLEIN umkehren']].map(([m, l]) => ({ label: l, icon: 'changeCase', onClick: () => doCase(m) })), { label: 'Groß-/Kleinschreibung' });
  }
  let caseCycle = 0;
  function doCase(m) { restoreSel(); const s = getSelection(); if (!s.rangeCount || s.isCollapsed) { toast('Markiere zuerst Text.', 'info'); return; } capture(); F.changeCase(ed, m); changed(); }
  function clearFormatting() {
    restoreSel();
    const s = getSelection();
    capture();
    if (s.rangeCount && !s.isCollapsed) F.clearCharFormat(ed);
    const blocks = selBlocks();
    F.resetDirectFormatting(blocks);
    F.applyStyle(ed, blocks.filter(x => x.tagName !== 'LI'), 'normal');
    changed();
  }
  // format painter
  let painter = null;
  function painterStart(sticky) {
    restoreSel();
    painter = F.copyFormat(ed);
    if (!painter) { toast('Setze den Cursor in den Text, dessen Format du übertragen möchtest.', 'info'); return; }
    painter.sticky = sticky;
    wrap.classList.add('painting');
    $('[data-x="painter"]', wrap).setAttribute('aria-pressed', 'true');
    toast('Markiere jetzt den Text, der das Format bekommen soll.', 'info');
  }
  function painterApply() {
    if (!painter) return;
    capture();
    F.pasteFormat(ed, painter);
    changed();
    if (!painter.sticky) { painter = null; wrap.classList.remove('painting'); $('[data-x="painter"]', wrap).setAttribute('aria-pressed', 'false'); }
  }
  ed.addEventListener('mouseup', () => { if (painter) setTimeout(painterApply, 0); });
  ed.addEventListener('touchend', () => { if (painter) setTimeout(() => { const s = getSelection(); if (s.rangeCount && !s.isCollapsed) painterApply(); }, 250); });
  $('[data-x="painter"]', wrap).addEventListener('dblclick', () => painterStart(true));

  // ---------- paragraph ----------
  function spacingMenu(b) {
    const blk = selBlocks()[0];
    const cur = F.paraProps(blk);
    officeMenu(b, [
      ...F.LINE_PRESETS.map(([v, l]) => ({ label: `${Math.abs((cur.line || 0) - v) < 0.03 ? '✓ ' : ''}Zeilenabstand ${l}`, icon: 'lineSpacing', onClick: () => op(() => F.applyPara(selBlocks(), { line: v })) })),
      '-',
      { label: cur.before > 0 ? 'Abstand vor Absatz entfernen' : 'Abstand vor Absatz hinzufügen (12 pt)', icon: 'lineSpacing', onClick: () => op(() => F.applyPara(selBlocks(), { before: cur.before > 0 ? 0 : 12 })) },
      { label: cur.after > 0 ? 'Abstand nach Absatz entfernen' : 'Abstand nach Absatz hinzufügen (8 pt)', icon: 'lineSpacing', onClick: () => op(() => F.applyPara(selBlocks(), { after: cur.after > 0 ? 0 : 8 })) },
      { label: 'Absatzoptionen …', icon: 'settings', onClick: () => paragraphDialog() },
    ], { label: 'Zeilen- und Absatzabstand' });
  }
  async function paragraphDialog() {
    saveSel();
    const blocks = selBlocks();
    if (!blocks.length) { toast('Setze den Cursor in einen Absatz.', 'info'); return; }
    const d = await F.paragraphDialog(F.paraProps(blocks[0]));
    if (!d) return;
    op(() => F.applyPara(selBlocks().length ? selBlocks() : blocks, d));
  }
  function indent(dir) {
    const s = getSelection();
    restoreSel();
    const inList = F.listOf(ed, s.anchorNode);
    if (inList) { exec(dir > 0 ? 'indent' : 'outdent'); return; }
    op(() => selBlocks().forEach(b => {
      const cur = b.style.marginLeft ? parseFloat(getComputedStyle(b).marginLeft) * 0.75 : 0;
      F.applyPara([b], { indent: Math.max(0, Math.round((cur + dir * 35.4) / 35.4) * 35.4) });
    }));
  }

  // ---------- lists ----------
  function listMenu(b) {
    const items = [
      ...F.BULLET_TYPES.map(([k, l]) => ({ label: `Aufzählung: ${l}`, icon: 'listUl', onClick: () => op(() => F.setListStyle(ed, { ordered: false, bullet: k })) })),
      '-',
      ...F.LIST_TYPES.map(([k, l]) => ({ label: `Nummerierung: ${l}`, icon: 'listOl', onClick: () => op(() => F.setListStyle(ed, { ordered: true, type: k })) })),
      '-',
      ...F.ML_TYPES.map(([k, l]) => ({ label: `Mehrstufig: ${l}`, icon: 'multilevel', onClick: () => op(() => F.setListStyle(ed, { ordered: true, ml: k })) })),
      '-',
      { label: 'Neu nummerieren (bei 1 beginnen)', icon: 'restore', onClick: () => op(() => F.restartNumbering(ed, curRange().startContainer, 1)) },
      { label: 'Nummerierung fortsetzen', icon: 'listOl', onClick: () => op(() => F.continueNumbering(ed, curRange().startContainer)) },
      { label: 'Nummerierungswert festlegen …', icon: 'hash', onClick: async () => { const v = await promptDialog('Nummerierungswert festlegen', 'Beginnen bei', '1', { okLabel: 'Übernehmen' }); const n = parseInt(v, 10); if (n > 0) op(() => F.restartNumbering(ed, curRange().startContainer, n)); } },
    ];
    officeMenu(b, items, { label: 'Listen' });
  }

  // ---------- toolbar state ----------
  function currentBlock() { return F.blockOf(ed, curRange() && curRange().startContainer); }
  function updateState() {
    for (const b of $$('[data-cmd]', wrap)) {
      const c = b.dataset.cmd;
      if (['bold', 'italic', 'underline', 'strikeThrough', 'superscript', 'subscript', 'insertUnorderedList', 'insertOrderedList', 'justifyCenter', 'justifyRight', 'justifyFull', 'justifyLeft'].includes(c)) {
        let on = false;
        try { on = document.queryCommandState(c); } catch {}
        b.setAttribute('aria-pressed', String(on));
      }
    }
    const s = getSelection();
    const blk = s.rangeCount && ed.contains(s.anchorNode) ? currentBlock() : null;
    if (blk) {
      const sid = styleOfBlock(blk);
      blockSel.value = VAL_OF_STYLE[sid] || (isCustomStyle(sid) && styles[sid] ? `us:${sid}` : 'p');
      $$('.w-sty', wrap).forEach(x => x.setAttribute('aria-pressed', String(x.dataset.sty === sid)));
      const f = F.currentFmt(ed, s.anchorNode);
      if (f) {
        sizeSel.value = F.SIZES.includes(f.size) ? String(f.size) : '';
        const fn = f.font && FONTS.find(x => x.name === f.font) ? f.font : '';
        fontSel.value = fn;
      }
    }
    // contextual tabs
    const td = tables.current();
    const tabT = $('[data-rb="table"]', wrap);
    tabT.hidden = !td;
    if (!td && ribbonTab === 'table') showRibbon('start');
    const tabI = $('[data-rb="image"]', wrap);
    tabI.hidden = !selImg;
    if (!selImg && ribbonTab === 'image') showRibbon('start');
    if (pv.on) pageInfo.textContent = `Seite ${pv.pageOf(s.rangeCount && ed.contains(s.anchorNode) ? s.anchorNode : null)} von ${pv.pages}`;
    if (rulerOn) rulerPaint();
  }
  const onSelChange = () => {
    const sel = getSelection();
    if (ed.contains(sel.anchorNode)) {
      saveSel(); tables.syncSelection();
      // the caret moved away from the selected picture → picture tools off
      if (selImg && selImg.isConnected) { const blk = F.blockOf(ed, selImg); if (!(blk && blk.contains(sel.anchorNode)) && sel.anchorNode !== selImg) { selectImage(null); return; } }
      updateState();
    }
  };
  document.addEventListener('selectionchange', onSelChange);

  // ---------- tables ----------
  const tables = createTableTools(ed, { capture, changed: () => { changed(); pv.schedule(30); } });
  async function tableAction(btn, forceInsert = false) {
    const td = tables.current() || (savedRange && (savedRange.startContainer.nodeType === 1 ? savedRange.startContainer : savedRange.startContainer.parentElement).closest('td,th'));
    if (td && ed.contains(td) && !forceInsert) {
      const table = td.closest('table');
      officeMenu(btn, [
        { label: 'Zeile oberhalb einfügen', icon: 'rowAdd', onClick: () => tables.insertRow(false) },
        { label: 'Zeile unterhalb einfügen', icon: 'rowAdd', onClick: () => tables.insertRow(true) },
        { label: 'Spalte links einfügen', icon: 'colAdd', onClick: () => tables.insertCol(false) },
        { label: 'Spalte rechts einfügen', icon: 'colAdd', onClick: () => tables.insertCol(true) },
        '-',
        { label: 'Zeile löschen', icon: 'rowDel', onClick: () => tables.deleteRows() },
        { label: 'Spalte löschen', icon: 'colDel', onClick: () => tables.deleteCols() },
        { label: 'Zellen verbinden', icon: 'cellMerge', onClick: () => tableCmd('merge') },
        { label: 'Zelle teilen …', icon: 'cellSplit', onClick: () => tableCmd('split') },
        { label: table.classList.contains('borderless') ? 'Rahmen anzeigen' : 'Rahmen ausblenden', icon: 'table', onClick: () => op(() => table.classList.toggle('borderless')) },
        { label: 'Tabelleneigenschaften …', icon: 'settings', onClick: () => tableCmd('props') },
        { label: 'Tabelle löschen', icon: 'trash', danger: true, onClick: () => tables.deleteTable() },
      ], { label: 'Tabelle bearbeiten' });
      return;
    }
    const t = await tables.insertDialog();
    if (!t) return;
    capture();
    insertBlock(t);
    changed();
  }
  const lastCell = () => { const r = savedRange; const el = r && (r.startContainer.nodeType === 1 ? r.startContainer : r.startContainer.parentElement); const td = el && el.closest('td,th'); return td && ed.contains(td) ? td : null; };
  async function tableCmd(t, b) {
    restoreSel();
    switch (t) {
      case 'row-above': return tables.insertRow(false);
      case 'row-below': return tables.insertRow(true);
      case 'col-left': return tables.insertCol(false);
      case 'col-right': return tables.insertCol(true);
      case 'del-row': return tables.deleteRows();
      case 'del-col': return tables.deleteCols();
      case 'del-table': return tables.deleteTable();
      case 'merge': { const ok = tables.merge(); if (!ok) toast('Markiere mehrere zusammenhängende Zellen (mit der Maus ziehen oder Umschalt+Pfeiltasten).', 'info'); return ok; }
      case 'split': {
        const td = tables.current();
        if (!td) return null;
        if ((td.colSpan || 1) > 1 || (td.rowSpan || 1) > 1) { tables.split(1, 1); return null; }
        const r = await openDialog({
          title: 'Zelle teilen',
          body: `<div class="field-row"><label class="field"><span class="field-label">Spalten</span><input class="input" type="number" min="1" max="10" value="2" name="c"></label><label class="field"><span class="field-label">Zeilen</span><input class="input" type="number" min="1" max="20" value="1" name="r"></label></div>`,
          actions: [{ label: 'Abbrechen', value: 'cancel' }, { label: 'Teilen', value: 'ok', kind: 'btn-primary', default: true }],
          onMount: dlg => ({ collect: () => ({ c: +$('[name=c]', dlg).value, r: +$('[name=r]', dlg).value }) }),
        });
        if (r.value === 'ok' && r.data) { restoreSel(); tables.split(Math.max(1, Math.min(10, r.data.c || 1)), Math.max(1, Math.min(20, r.data.r || 1))); }
        return null;
      }
      case 'distribute': return tables.distribute();
      case 'shade': return officeMenu(b, SHADES.map(c => ({ label: c === '#FFFFFF' ? 'Keine Füllung' : colorName(c), icon: 'shading', onClick: () => { restoreSel(); tables.shade(c); } })), { label: 'Schattierung' });
      case 'borders': return officeMenu(b, [['all', 'Alle Rahmenlinien'], ['outer', 'Rahmenlinien außen'], ['inner', 'Rahmenlinien innen'], ['none', 'Kein Rahmen'], ['top', 'Rahmenlinie oben'], ['bottom', 'Rahmenlinie unten'], ['left', 'Rahmenlinie links'], ['right', 'Rahmenlinie rechts'], ['thick-bottom', 'Dicke Rahmenlinie unten'], ['double-bottom', 'Doppelte Rahmenlinie unten'], ['all-table', 'Ganze Tabelle: alle Linien'], ['none-table', 'Ganze Tabelle: ohne Linien']].map(([k, l]) => ({ label: l, icon: 'border', onClick: () => { restoreSel(); tables.borders(k); } })), { label: 'Rahmen' });
      case 'style': return officeMenu(b, [['', 'Standard'], ...TABLE_STYLES].map(([k, l]) => ({ label: l, icon: 'tableStyle', onClick: () => { restoreSel(); tables.style(k); } })), { label: 'Tabellenformatvorlagen' });
      case 'header': { const on = tables.header(); toast(on ? 'Erste Zeile wird auf jeder Seite wiederholt.' : 'Überschriftenzeile aus.', 'info'); return null; }
      case 'props': { const td = tables.current(); if (!td) return null; capture(); if (await tables.propsDialog(td.closest('table'))) changed(); return null; }
      case 'sort': { const td = tables.current() || lastCell(); if (td) await extras.sortDialog(td); return null; }
      case 'formula': { const td = tables.current() || lastCell(); if (!td) { toast('Setze den Cursor in eine Tabellenzelle.', 'info'); return null; } await extras.formulaDialog(td); return null; }
      case 'totext': { const td = tables.current() || lastCell(); if (td) extras.tableToText(td.closest('table')); return null; }
      default: return null;
    }
  }

  // ---------- images / shapes / text boxes / links ----------
  async function insertImage(files) {
    const list = files || await pickFiles({ accept: 'image/*', multiple: false });
    if (!list || !list.length) return;
    try {
      const { url, w } = await fileToDataUrl(list[0], 1800);
      const maxW = Math.round((page.w - page.ml - page.mr) * PX);
      const width = Math.min(w, maxW);
      capture();
      insertInline(`<img src="${url}" alt="${esc(list[0].name || 'Bild')}" width="${width}">`);
      changed();
    } catch (e) { errorToast(e, 'Das Bild konnte nicht eingefügt werden.'); }
  }
  function shapeMenu(b) {
    officeMenu(b, Object.entries(SHAPES).map(([k, [l]]) => ({ label: l, icon: 'shapes', onClick: () => insertShape(k) })), { label: 'Form einfügen' });
  }
  function insertShape(k) {
    const [label, body] = SHAPES[k];
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="160" height="100" viewBox="0 0 160 100"><g fill="#E9E8FB" stroke="#3B37A0" stroke-width="3">${body}</g></svg>`;
    const url = 'data:image/svg+xml;base64,' + btoa(svg);
    capture();
    insertInline(`<img src="${url}" alt="${esc(label)}" width="160">`);
    changed();
  }
  function insertTextbox() {
    capture();
    const [box] = insertBlock('<div class="textbox" data-wrap="right" style="width:170pt;border-color:#8086A6"><p>Textfeld – hier schreiben</p></div>');
    if (box) { const r = document.createRange(); r.selectNodeContents(box.querySelector('p')); const s = getSelection(); s.removeAllRanges(); s.addRange(r); }
    changed();
  }
  async function insertLink() { return extras.linkDialog(); }
  function insertPageBreak() { capture(); insertBlock('<hr data-page-break>'); changed(); }
  function insertSectionBreak(orient = null) {
    capture(); insertBlock(`<hr data-page-break data-break="section"${orient ? ` data-orient="${orient}"` : ''}>`); changed();
    if (orient) toast(orient === 'landscape' ? 'Die folgenden Seiten werden im Querformat gedruckt (PDF und .docx-Datei).' : 'Die folgenden Seiten werden im Hochformat gedruckt (PDF und .docx-Datei).', 'info');
  }
  function insertDate(b) {
    const d = new Date();
    const fm = [d.toLocaleDateString('de-DE'), d.toLocaleDateString('de-DE', { day: 'numeric', month: 'long', year: 'numeric' }), d.toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }), d.toISOString().slice(0, 10), `${d.toLocaleDateString('de-DE')} ${d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}`];
    officeMenu(b, fm.map(t => ({ label: t, icon: 'calendar', onClick: () => { restoreSel(); capture(); document.execCommand('insertText', false, t); changed(); } })), { label: 'Datum einfügen' });
  }
  function symbolMenu(b) {
    officeMenu(b, SYMBOLS.map(c => ({ label: c, icon: 'text', onClick: () => { restoreSel(); capture(); document.execCommand('insertText', false, c); changed(); } })), { label: 'Symbol einfügen' });
  }

  // image selection + resize handles
  let selImg = null;
  const handles = $('.img-handles', wrap);
  const zoomScale = () => { const r = ed.getBoundingClientRect(); return ed.offsetWidth ? r.width / ed.offsetWidth : 1; };
  function placeHandles() {
    if (!selImg || !selImg.isConnected) { handles.hidden = true; return; }
    const z = zoomScale();
    const r = selImg.getBoundingClientRect(), sr = sheet.getBoundingClientRect();
    handles.hidden = false;
    Object.assign(handles.style, { left: `${(r.left - sr.left) / z}px`, top: `${(r.top - sr.top) / z}px`, width: `${r.width / z}px`, height: `${r.height / z}px` });
  }
  function selectImage(img) {
    $$('img.sel', ed).forEach(i => i.classList.remove('sel'));
    selImg = img;
    if (img) img.classList.add('sel');
    placeHandles();
    updateState();
  }
  handles.addEventListener('pointerdown', e => {
    const hd = e.target.closest('[data-h]');
    if (!hd || !selImg) return;
    e.preventDefault(); e.stopPropagation();
    const img = selImg, z = zoomScale();
    const w0 = img.getBoundingClientRect().width / z, h0 = img.getBoundingClientRect().height / z;
    const ratio = h0 / (w0 || 1), x0 = e.clientX;
    const dir = /w$/.test(hd.dataset.h) ? -1 : 1;
    const max = Math.round((page.w - page.ml - page.mr) * PX);
    capture();
    const mv = ev => { const w = Math.max(24, Math.min(max, Math.round(w0 + dir * (ev.clientX - x0) / z))); img.width = w; img.removeAttribute('height'); img.style.removeProperty('height'); placeHandles(); };
    const up = () => { window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up); changed(); pv.schedule(30); void ratio; };
    window.addEventListener('pointermove', mv); window.addEventListener('pointerup', up);
  });
  scrollBox.addEventListener('scroll', () => { if (selImg) placeHandles(); if (rulerOn) rulerPaint(); }, { passive: true });
  async function imageCmd(i, b) {
    const img = selImg;
    if (!img) return;
    if (i === 'crop') { await extras.cropDialog(img); return; }
    if (i === 'rotate') { await extras.rotateImage(img, 1); return; }
    if (i === 'wrap') {
      officeMenu(b, [['inline', 'Mit Text in Zeile'], ['left', 'Links, Text umfließt rechts'], ['right', 'Rechts, Text umfließt links'], ['center', 'Oben und unten']].map(([k, l]) => ({ label: `${(img.getAttribute('data-wrap') || 'inline') === k ? '✓ ' : ''}${l}`, icon: 'wrapText', onClick: () => op(() => { if (k === 'inline') img.removeAttribute('data-wrap'); else img.setAttribute('data-wrap', k); setTimeout(placeHandles, 30); }) })), { label: 'Textumbruch' });
    } else if (i === 'align') {
      officeMenu(b, [['left', 'Links'], ['center', 'Zentriert'], ['right', 'Rechts']].map(([k, l]) => ({ label: l, icon: k === 'left' ? 'alignLeft' : k === 'center' ? 'alignCenter' : 'alignRight', onClick: () => op(() => { img.removeAttribute('data-wrap'); const p = F.blockOf(ed, img); if (p) F.applyPara([p], { align: k }); setTimeout(placeHandles, 30); }) })), { label: 'Bild ausrichten' });
    } else if (i === 'size') {
      const cm = px => String(Math.round(px / PX / 28.35 * 100) / 100).replace('.', ',');
      const v = await promptDialog('Bildgröße', 'Breite in cm', cm(img.width || img.getBoundingClientRect().width), { okLabel: 'Übernehmen' });
      const n = parseFloat(String(v || '').replace(',', '.'));
      if (n > 0) op(() => { img.width = Math.round(Math.min(page.w - page.ml - page.mr, n * 28.35) * PX); img.removeAttribute('height'); setTimeout(placeHandles, 30); });
    } else if (i === 'alt') {
      const v = await promptDialog('Alternativtext', 'Beschreibung des Bildes (für Screenreader und Barrierefreiheit)', img.getAttribute('alt') || '', { okLabel: 'Übernehmen' });
      if (v != null) op(() => img.setAttribute('alt', v.trim()));
    } else if (i === 'delete') { op(() => img.remove()); selectImage(null); }
  }
  ed.addEventListener('click', e => {
    const img = e.target.closest('img');
    if (img && ed.contains(img)) {
      selectImage(img);
      const resize = f => op(() => { const cur = img.width || img.naturalWidth; const max = Math.round((page.w - page.ml - page.mr) * PX); img.width = Math.max(40, Math.min(max, Math.round(f === 'full' ? max : cur * f))); img.removeAttribute('height'); setTimeout(placeHandles, 30); });
      officeMenu(img, [
        { label: 'Kleiner', icon: 'zoomOut', onClick: () => resize(0.8) },
        { label: 'Größer', icon: 'zoomIn', onClick: () => resize(1.25) },
        { label: 'Volle Breite', icon: 'fitWidth', onClick: () => resize('full') },
        { label: 'Textumbruch …', icon: 'wrapText', onClick: () => { showRibbon('image'); imageCmd('wrap', $('[data-i="wrap"]', wrap)); } },
        { label: 'Zuschneiden …', icon: 'crop', onClick: () => imageCmd('crop') },
        { label: 'Um 90° drehen', icon: 'rotateImg', onClick: () => imageCmd('rotate') },
        { label: 'Alternativtext …', icon: 'altText', onClick: () => imageCmd('alt') },
        { label: 'Beschriftung einfügen …', icon: 'caption', onClick: () => extras.captionDialog() },
        { label: 'Bild löschen', icon: 'trash', danger: true, onClick: () => { op(() => img.remove()); selectImage(null); } },
      ], { label: 'Bild' });
      return;
    }
    if (selImg) selectImage(null);
    const a = e.target.closest('a');
    if (a && (e.ctrlKey || e.metaKey) && /^https?:/i.test(a.href)) openExternal(a.href, { source: 'Das Dokument enthält einen Link.' });
  });

  // ---------- columns / sections / page layout menus ----------
  function columnsMenu(b) {
    officeMenu(b, [[1, 'Eine Spalte'], [2, 'Zwei Spalten'], [3, 'Drei Spalten']].map(([n, l]) => ({ label: l, icon: 'columns2', onClick: () => setColumns(n) })), { label: 'Spalten' });
  }
  function setColumns(n) {
    op(() => {
      const r = curRange();
      const node = r && r.startContainer;
      const el = node && (node.nodeType === 1 ? node : node.parentElement);
      const sect = el && el.closest('.sect');
      if (sect && ed.contains(sect)) {
        if (n === 1) sect.replaceWith(...sect.childNodes);
        else sect.setAttribute('data-cols', String(n));
        return;
      }
      if (n === 1) return;
      const topOf = x => { let t = x && (x.nodeType === 1 ? x : x.parentElement); while (t && t.parentElement !== ed) t = t.parentElement; return t; };
      let a, z;
      if (!r || r.collapsed) { a = ed.firstElementChild; z = ed.lastElementChild; }
      else { a = topOf(r.startContainer); z = topOf(r.endContainer); }
      if (!a || !z) return;
      const div = document.createElement('div');
      div.className = 'sect'; div.setAttribute('data-cols', String(n)); div.setAttribute('data-gap', '18');
      a.before(div);
      let x = a;
      while (x) { const nx = x.nextElementSibling; div.appendChild(x); if (x === z) break; x = nx; }
      if (!div.nextElementSibling) div.after(Object.assign(document.createElement('p'), { innerHTML: '<br>' }));
    });
  }
  function breaksMenu(b) {
    officeMenu(b, [
      { label: 'Seitenumbruch', icon: 'pages', onClick: () => insertPageBreak() },
      { label: 'Abschnittsumbruch (nächste Seite)', icon: 'sectionBreak', onClick: () => insertSectionBreak() },
      { label: 'Abschnittsumbruch: folgende Seiten im Querformat', icon: 'rotate', onClick: () => insertSectionBreak('landscape') },
      { label: 'Abschnittsumbruch: folgende Seiten im Hochformat', icon: 'page', onClick: () => insertSectionBreak('portrait') },
      { label: 'Seitenumbruch oberhalb des Absatzes', icon: 'pages', onClick: () => op(() => selBlocks().forEach(x => x.toggleAttribute('data-pbb'))) },
      { label: 'Nicht vom nächsten Absatz trennen', icon: 'pages', onClick: () => op(() => selBlocks().forEach(x => x.toggleAttribute('data-keep-next'))) },
    ], { label: 'Umbrüche' });
  }
  const PAGE_FORMATS = { a4: [595.3, 841.9, 'A4'], a5: [419.5, 595.3, 'A5'], a3: [841.9, 1190.6, 'A3'], letter: [612, 792, 'US Letter'], legal: [612, 1008, 'US Legal'] };
  const MARGINS = { normal: [70.9, 70.9, 56.7, 70.9, 'Normal (2,5 cm)'], schmal: [36, 36, 36, 36, 'Schmal (1,27 cm)'], mittel: [72, 54, 72, 54, 'Mittel'], breit: [72, 90, 72, 90, 'Breit'], din: [48, 56.7, 56.7, 70.9, 'Brief nach DIN 5008'] };
  function setPage(p) { capture(); page = p; applyPage(); shell.markDirty(); pv.refresh(); }
  function marginsMenu(b) { officeMenu(b, [...Object.values(MARGINS).map(m => ({ label: m[4], icon: 'pageSetup', onClick: () => setPage({ ...page, mt: m[0], mr: m[1], mb: m[2], ml: m[3] }) })), '-', { label: 'Benutzerdefinierte Seitenränder …', icon: 'settings', onClick: () => pageSetup() }], { label: 'Seitenränder' }); }
  function orientMenu(b) {
    const land = page.w > page.h;
    officeMenu(b, [['hoch', 'Hochformat'], ['quer', 'Querformat']].map(([k, l]) => ({ label: `${(k === 'quer') === land ? '✓ ' : ''}${l}`, icon: 'rotate', onClick: () => { const pw = Math.min(page.w, page.h), ph = Math.max(page.w, page.h); setPage({ ...page, w: k === 'quer' ? ph : pw, h: k === 'quer' ? pw : ph }); } })), { label: 'Ausrichtung' });
  }
  function sizeMenu(b) {
    const land = page.w > page.h;
    officeMenu(b, Object.values(PAGE_FORMATS).map(([w, hh, l]) => ({ label: l, icon: 'page', onClick: () => setPage({ ...page, w: land ? hh : w, h: land ? w : hh }) })), { label: 'Format' });
  }

  // ---------- paste & drop ----------
  ed.addEventListener('paste', e => {
    const dt = e.clipboardData;
    if (!dt) return;
    const files = Array.from(dt.files || []).filter(f => /^image\//.test(f.type));
    if (files.length) { e.preventDefault(); insertImage(files); return; }
    const htmlData = dt.getData('text/html');
    e.preventDefault();
    capture();
    if (tracker.enabled) { tracker.insertText(dt.getData('text/plain')); changed(); return; }
    const asText = pasteTextOnce; pasteTextOnce = false;
    if (htmlData && !plain && !asText) {
      const clean0 = sanitizeHtml(htmlData);
      const clean = purifyLoaded() ? sanitizeDocHtmlSync(clean0) : clean0;
      document.execCommand('insertHTML', false, clean);
      changed();
      if (/<(b|strong|i|em|u|span|font|h[1-6]|table|ul|ol|a)\b|style=/i.test(clean)) setTimeout(() => extras.offerPasteOptions({ html: clean, text: dt.getData('text/plain'), at: Date.now() }), 30);
      return;
    }
    document.execCommand('insertText', false, dt.getData('text/plain'));
    changed();
  });
  ed.addEventListener('cut', () => capture());
  let pasteTextOnce = false;
  async function pasteAsText() {
    try {
      const t = await navigator.clipboard.readText();
      restoreSel(); capture();
      if (tracker.enabled) tracker.insertText(t); else document.execCommand('insertText', false, t);
      changed();
    } catch {
      pasteTextOnce = true;
      ed.focus({ preventScroll: true });
      toast('Füge jetzt mit Strg+V bzw. „Einfügen“ ein – es wird nur der Text übernommen.', 'info');
    }
  }
  screen.onDropFiles = files => {
    const imgs = files.filter(f => /^image\//.test(f.type));
    if (imgs.length) insertImage(imgs);
    else toast('Hier kannst du Bilder ablegen.', 'info');
  };

  // ---------- find & replace ----------
  const fb = $('.w-find', wrap);
  const fq = $('[data-fq]', fb), fr = $('[data-fr]', fb), fcount = $('[data-fcount]', fb);
  const fcase = $('[data-fcase]', fb), fword = $('[data-fword]', fb), fregex = $('[data-fregex]', fb);
  let findOpen = false, matches = [], cur = -1, findRe = null;
  const hl = typeof CSS !== 'undefined' && CSS.highlights && typeof Highlight !== 'undefined';
  function openFind(focus, replace = false) {
    findOpen = true; fb.hidden = false;
    $('[data-find]', tbEl).setAttribute('aria-pressed', 'true');
    const s = savedRange ? savedRange.toString() : '';
    if (s && s.length < 60 && !s.includes('\n')) fq.value = s;
    if (focus) setTimeout(() => { const el = replace && fq.value ? fr : fq; el.focus(); el.select(); }, 30);
    runFind(true);
  }
  function closeFind() {
    findOpen = false; fb.hidden = true; matches = []; cur = -1;
    $('[data-find]', tbEl).setAttribute('aria-pressed', 'false');
    if (hl) { CSS.highlights.delete('fale-find'); CSS.highlights.delete('fale-find-cur'); }
  }
  function buildRe(q) {
    let src = fregex.checked ? q : q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (fword.checked) src = `(?<![\\p{L}\\p{N}_])(?:${src})(?![\\p{L}\\p{N}_])`;
    try { return new RegExp(src, 'gu' + (fcase.checked ? '' : 'i')); } catch { return null; }
  }
  function runFind(jump) {
    const q = fq.value;
    matches = [];
    findRe = q ? buildRe(q) : null;
    fq.classList.toggle('bad', !!q && !findRe);
    if (findRe) {
      const nodes = [];
      const tw = document.createTreeWalker(ed, NodeFilter.SHOW_TEXT, { acceptNode: n => (n.parentElement && n.parentElement.closest('del.tc') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT) });
      let text = '';
      for (let n = tw.nextNode(); n; n = tw.nextNode()) { nodes.push({ n, start: text.length }); text += n.nodeValue; }
      const locate = off => { let lo = 0, hi = nodes.length - 1; while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (nodes[mid].start <= off) lo = mid; else hi = mid - 1; } return nodes[lo]; };
      findRe.lastIndex = 0;
      let m;
      while ((m = findRe.exec(text)) && matches.length < 5000) {
        if (!m[0].length) { findRe.lastIndex++; continue; }
        const i = m.index;
        const a = locate(i), b = locate(i + m[0].length - 1);
        const r = document.createRange();
        r.setStart(a.n, i - a.start);
        r.setEnd(b.n, i + m[0].length - b.start);
        r._text = m[0];
        matches.push(r);
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
      const cr = scrollBox.getBoundingClientRect();
      if (r.top < cr.top + 40 || r.bottom > cr.bottom - 40) scrollBox.scrollTop += r.top - cr.top - cr.height / 3;
    }
  }
  const step = d => { if (!matches.length) return; cur = (cur + d + matches.length) % matches.length; paintFind(true); };
  fq.addEventListener('input', () => runFind(true));
  [fcase, fword, fregex].forEach(c => c.addEventListener('change', () => runFind(true)));
  fq.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); step(e.shiftKey ? -1 : 1); } if (e.key === 'Escape') closeFind(); });
  fr.addEventListener('keydown', e => { if (e.key === 'Escape') closeFind(); });
  $('[data-fnext]', fb).addEventListener('click', () => step(1));
  $('[data-fprev]', fb).addEventListener('click', () => step(-1));
  $('[data-fclose]', fb).addEventListener('click', closeFind);
  const replacementFor = r => {
    if (!fregex.checked || !findRe) return fr.value;
    const one = new RegExp(findRe.source, findRe.flags.replace('g', ''));
    return (r._text || '').replace(one, fr.value);
  };
  const replaceRange = (r, text) => {
    const s = getSelection();
    s.removeAllRanges(); s.addRange(r);
    if (tracker.enabled) tracker.insertText(text);
    else document.execCommand('insertText', false, text);
  };
  $('[data-frep]', fb).addEventListener('click', () => {
    if (cur < 0 || !matches[cur]) return;
    ed.focus({ preventScroll: true });
    capture();
    replaceRange(matches[cur], replacementFor(matches[cur]));
    changed();
    runFind(false); paintFind(true);
  });
  $('[data-freall]', fb).addEventListener('click', () => {
    if (!matches.length) return;
    const n = matches.length;
    ed.focus({ preventScroll: true });
    capture();
    for (let i = matches.length - 1; i >= 0; i--) replaceRange(matches[i], replacementFor(matches[i]));
    changed();
    runFind(true);
    toast(`${n} Treffer ersetzt`, 'success');
  });

  // ---------- structure: outline, TOC, comments, footnotes, header/footer ----------
  const outlinePanel = $('.w-outline', wrap), cmtPanel = $('.w-comments', wrap), tcPanel = $('.w-changes', wrap);
  const fnArea = $('.doc-fn-area', wrap);
  const enArea = $('.doc-en-area', wrap);
  const hfTop = $('.doc-hf.top', wrap), hfBottom = $('.doc-hf.bottom', wrap);
  let profileName = null;
  async function authorName() {
    if (profileName === null) { try { const p = await (await import('../extras/profile.js')).getProfile(); profileName = p ? [p.vorname, p.nachname].filter(Boolean).join(' ') : ''; } catch { profileName = ''; } }
    return profileName || 'Ich';
  }
  authorName();
  const headings = (depth = 3) => $$('h1,h2,h3,h4,h5,h6', ed).filter(x => +x.tagName[1] <= depth && !x.closest('[data-toc]') && x.textContent.trim());
  const headText = hd => `${hd.getAttribute('data-hnum') ? `${hd.getAttribute('data-hnum')} ` : ''}${hd.textContent.replace(/\u200b/g, '').trim()}`;
  const captionsOf = label => $$('p.caption', ed).filter(c => { const sq = c.querySelector('span.seq'); return sq && (sq.getAttribute('data-seq') || 'Abbildung') === label && c.textContent.trim(); });
  function togglePanel(which, force) {
    const p = which === 'outline' ? outlinePanel : which === 'changes' ? tcPanel : cmtPanel;
    const open = force != null ? force : p.hidden;
    if (open && which !== 'outline') { const other = which === 'changes' ? cmtPanel : tcPanel; if (!other.hidden) { other.hidden = true; wrap.classList.remove(`has-${which === 'changes' ? 'comments' : 'changes'}`); } }
    p.hidden = !open;
    wrap.classList.toggle(`has-${which}`, open);
    const b = $(`[data-panel="${which}"]`, tbEl);
    if (b) b.setAttribute('aria-pressed', String(open));
    const bx = $(`[data-x="${which === 'outline' ? 'nav' : which}"]`, wrap);
    if (bx) bx.setAttribute('aria-pressed', String(open));
    if (which === 'outline') LS.set('fale-w-outline', open ? '1' : '0');
    refreshStructure();
    setTimeout(() => { if (rulerOn) rulerPaint(); }, 30);
  }
  $$('[data-close-panel]', wrap).forEach(b => b.addEventListener('click', () => togglePanel(b.closest('.w-outline') ? 'outline' : b.closest('.w-changes') ? 'changes' : 'comments', false)));
  function refreshStructure() {
    if (extras) { extras.updateFields(); extras.renderEndnotes(enArea); }
    refreshTocs();
    if (!outlinePanel.hidden) renderOutline();
    renderComments();
    renderFootnotes();
    renderChanges();
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
    const hs = headings(6);
    list.innerHTML = hs.length ? '' : '<p class="panel-empty">Noch keine Überschriften. Nutze „Überschrift 1–3“ im Absatzformat, dann erscheint hier die Gliederung.</p>';
    const curH = (() => { const r = curRange(); if (!r) return null; let found = null; for (const hd of hs) { if (r.comparePoint(hd, 0) <= 0 || hd.contains(r.startContainer)) found = hd; else break; } return found; })();
    hs.forEach(hd => {
      const lv = hd.tagName[1];
      const row = h(`<div class="w-ol-row l${lv}${hd === curH ? ' cur' : ''}"><button class="w-ol-item l${lv}" type="button"${pv.on ? ` data-pg="${pv.pageOf(hd)}"` : ''}>${esc(headText(hd).slice(0, 120))}</button>
        <span class="w-ol-acts"><button class="icon-btn" type="button" data-ol="up" aria-label="Abschnitt nach oben" title="Abschnitt nach oben">${oicon('chevronUp')}</button><button class="icon-btn" type="button" data-ol="down" aria-label="Abschnitt nach unten" title="Abschnitt nach unten">${oicon('chevronDown')}</button><button class="icon-btn" type="button" data-ol="promote" aria-label="Höher stufen" title="Höher stufen"${lv === '1' ? ' disabled' : ''}>${oicon('indentDec')}</button><button class="icon-btn" type="button" data-ol="demote" aria-label="Tiefer stufen" title="Tiefer stufen"${lv === '6' ? ' disabled' : ''}>${oicon('indentInc')}</button></span></div>`);
      $('.w-ol-item', row).addEventListener('click', () => jumpTo(hd));
      $('.w-ol-acts', row).addEventListener('click', e => {
        const b = e.target.closest('[data-ol]');
        if (!b) return;
        const k = b.dataset.ol;
        if (k === 'up' || k === 'down') { if (!extras.moveSection(hd, k === 'up' ? -1 : 1)) toast('Hier geht es nicht weiter.', 'info'); }
        else { const n = +hd.tagName[1] + (k === 'promote' ? -1 : 1); if (n >= 1 && n <= 6) op(() => F.applyStyle(ed, [hd], `h${n}`)); }
        refreshStructure();
      });
      list.appendChild(row);
    });
  }
  function refreshTocs() {
    const tocs = $$('[data-toc]', ed);
    if (!tocs.length) return;
    tocs.forEach(t => {
      t.setAttribute('contenteditable', 'false');
      const kind = t.getAttribute('data-toc-kind');
      const title = t.getAttribute('data-toc-title') || (kind ? TOC_TITLES[kind] || `${kind}sverzeichnis` : 'Inhaltsverzeichnis');
      const list = kind ? captionsOf(kind) : headings(+(t.getAttribute('data-toc-depth') || 3));
      const empty = kind ? `Noch keine Beschriftungen „${esc(kind)}“ – das Verzeichnis füllt sich automatisch.` : 'Noch keine Überschriften – das Verzeichnis füllt sich automatisch.';
      const html2 = `<p class="toc-title">${esc(title)}</p>` + (list.length ? list.map((el, i) => `<p class="toc-e l${kind ? 1 : el.tagName[1]}" data-toc-i="${i}"><span>${esc(kind ? el.textContent.replace(/\s+/g, ' ').trim() : headText(el))}</span>${pv.on ? `<b class="toc-pg">${tocPage(el)}</b>` : ''}</p>`).join('') : `<p class="toc-e muted">${empty}</p>`);
      if (t._html !== html2) { t.innerHTML = html2; t._html = html2; }
    });
  }
  const tocPage = el => { const i = pv.pageOf(el) - 1; return hf ? pageNumberOf(hf, i) : String(i + 1); };
  const TOC_TITLES = { Abbildung: 'Abbildungsverzeichnis', Tabelle: 'Tabellenverzeichnis', Gleichung: 'Gleichungsverzeichnis' };
  function tocMenu(b) {
    officeMenu(b, [
      { label: 'Inhaltsverzeichnis', icon: 'toc', onClick: () => insertToc() },
      { label: 'Abbildungsverzeichnis', icon: 'figures', onClick: () => insertToc('Abbildung') },
      { label: 'Tabellenverzeichnis', icon: 'figures', onClick: () => insertToc('Tabelle') },
    ], { label: 'Verzeichnis einfügen' });
  }
  function insertToc(kind = null) {
    if (plain) { toast('Ein Inhaltsverzeichnis gibt es nur in Word-Dokumenten.', 'info'); return; }
    capture();
    insertBlock(kind ? `<div class="toc" data-toc data-toc-kind="${esc(kind)}" data-toc-title="${esc(TOC_TITLES[kind] || `${kind}sverzeichnis`)}" contenteditable="false"></div>` : '<div class="toc" data-toc data-toc-title="Inhaltsverzeichnis" contenteditable="false"></div>');
    changed(); refreshStructure();
    toast(kind ? `${TOC_TITLES[kind] || 'Verzeichnis'} eingefügt – es aktualisiert sich automatisch.` : 'Inhaltsverzeichnis eingefügt – es aktualisiert sich automatisch.', 'success');
  }
  ed.addEventListener('click', e => {
    const toc = e.target.closest('[data-toc]');
    if (toc) {
      const ent = e.target.closest('[data-toc-i]');
      if (ent) { const kind = toc.getAttribute('data-toc-kind'); const el = (kind ? captionsOf(kind) : headings(+(toc.getAttribute('data-toc-depth') || 3)))[+ent.dataset.tocI]; if (el) { jumpTo(el); return; } }
      officeMenu(toc, [
        { label: 'Verzeichnis aktualisieren', icon: 'restore', onClick: () => { toc._html = null; refreshTocs(); toast('Aktualisiert'); } },
        { label: 'Verzeichnis entfernen', icon: 'trash', danger: true, onClick: () => op(() => toc.remove()) },
      ], { label: 'Inhaltsverzeichnis' });
      return;
    }
    const fn = e.target.closest('sup.fn');
    if (fn) { footnoteMenu(fn); return; }
    const en = e.target.closest('sup.en');
    if (en) { extras.endnoteMenu(en); return; }
    const tfx = e.target.closest('span.tf');
    if (tfx && !plain) { const td = tfx.closest('td,th'); if (td) { extras.formulaDialog(td, tfx); return; } }
    const xr = e.target.closest('span.xref');
    if (xr && (e.ctrlKey || e.metaKey)) { extras.gotoTarget(xr.getAttribute('data-ref')); return; }
    const ia = e.target.closest('a[href^="#"]');
    if (ia && (e.ctrlKey || e.metaKey)) { extras.gotoTarget(decodeURIComponent(ia.getAttribute('href').slice(1))); return; }
    const cm = e.target.closest('[data-cmt]');
    if (cm) { togglePanel('comments', true); focusComment(cm.getAttribute('data-cmt')); }
    const tc = e.target.closest('ins.tc, del.tc');
    if (tc && !tcPanel.hidden) focusChange(tc);
  });

  // comments
  function cmtGroups() {
    const map = new Map();
    $$('[data-cmt]', ed).forEach(sp => { const cid = sp.getAttribute('data-cmt'); if (!map.has(cid)) map.set(cid, []); map.get(cid).push(sp); });
    return map;
  }
  function renderComments() {
    const groups = cmtGroups();
    const btn = $('[data-comment]', tbEl);
    if (btn) btn.dataset.count = groups.size || '';
    if (cmtPanel.hidden) return;
    const list = $('.w-cmt-list', cmtPanel);
    list.innerHTML = groups.size ? '' : '<p class="panel-empty">Noch keine Kommentare. Markiere Text und tippe auf „Kommentar hinzufügen“.</p>';
    for (const [cid, spans] of groups) {
      const s0 = spans[0];
      const quote = spans.map(x => x.textContent).join(' ').replace(/\s+/g, ' ').trim();
      const d = s0.getAttribute('data-cmt-date');
      const dd = d ? new Date(d) : null;
      const card = h(`<article class="w-cmt" data-for="${esc(cid)}" tabindex="0">
        <blockquote>${esc(quote.length > 90 ? quote.slice(0, 88) + '…' : quote)}</blockquote>
        <p class="w-cmt-text">${esc(s0.getAttribute('data-cmt-text') || '')}</p>
        <div class="w-cmt-foot"><span class="muted small">${esc(s0.getAttribute('data-cmt-author') || 'Ich')}${dd && !isNaN(dd) ? ` · ${dd.toLocaleDateString('de-DE')}` : ''}</span>
          <span><button class="icon-btn" type="button" data-edit aria-label="Kommentar bearbeiten">${oicon('edit')}</button><button class="icon-btn" type="button" data-del aria-label="Kommentar löschen">${oicon('trash')}</button></span></div></article>`);
      card.addEventListener('click', e => {
        if (e.target.closest('[data-edit]')) { editComment(cid); return; }
        if (e.target.closest('[data-del]')) { deleteComment(cid); return; }
        focusComment(cid, true);
      });
      list.appendChild(card);
    }
  }
  function focusComment(cid, scrollTo = false) {
    $$('.cmt-focus', ed).forEach(x => x.classList.remove('cmt-focus'));
    const spans = cmtGroups().get(cid) || [];
    spans.forEach(x => x.classList.add('cmt-focus'));
    $$('.w-cmt', cmtPanel).forEach(c => c.classList.toggle('on', c.dataset.for === cid));
    if (scrollTo && spans[0]) { const r = spans[0].getBoundingClientRect(), cr = scrollBox.getBoundingClientRect(); scrollBox.scrollTop += r.top - cr.top - cr.height / 3; }
    const card = $(`.w-cmt[data-for="${CSS.escape(cid)}"]`, cmtPanel);
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
    capture();
    const cid = 'c' + Date.now().toString(36);
    const attrs = { 'data-cmt': cid, 'data-cmt-text': text, 'data-cmt-author': await authorName(), 'data-cmt-date': new Date().toISOString() };
    const mk = () => { const sp = document.createElement('span'); sp.className = 'cmt'; Object.entries(attrs).forEach(([k, v]) => sp.setAttribute(k, v)); return sp; };
    const blockOf = n => (n.nodeType === 1 ? n : n.parentElement).closest('p,li,h1,h2,h3,h4,h5,h6,td,th,blockquote,pre');
    ed.focus({ preventScroll: true });
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
    focusComment(cid);
    return cid;
  }
  async function editComment(cid) {
    const spans = cmtGroups().get(cid) || [];
    if (!spans.length) return;
    const t = await commentText('Kommentar bearbeiten', spans[0].getAttribute('data-cmt-text') || '');
    if (t == null) return;
    capture();
    spans.forEach(sp => sp.setAttribute('data-cmt-text', t));
    shell.markDirty(); renderComments();
  }
  function deleteComment(cid) {
    capture();
    (cmtGroups().get(cid) || []).forEach(sp => sp.replaceWith(...sp.childNodes));
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
    restoreSel(); capture();
    const sel = getSelection();
    if (sel.rangeCount && !sel.isCollapsed) sel.collapseToEnd();
    insertInline(`<sup class="fn" data-fn="${esc(text)}" contenteditable="false"></sup>&#8203;`);
    changed(); refreshStructure();
  }
  function footnoteMenu(fn) {
    officeMenu(fn, [
      { label: 'Fußnote bearbeiten', icon: 'edit', onClick: async () => { const t = await footnoteText('Fußnote bearbeiten', fn.getAttribute('data-fn') || ''); if (t != null) { capture(); fn.setAttribute('data-fn', t); shell.markDirty(); renderFootnotes(); } } },
      { label: 'Fußnote löschen', icon: 'trash', danger: true, onClick: () => { op(() => fn.remove()); renderFootnotes(); } },
    ], { label: 'Fußnote' });
  }
  function renderFootnotes() {
    const fns = $$('sup.fn', ed);
    fnArea.hidden = !fns.length;
    fnArea.innerHTML = fns.length ? `<ol>${fns.map(f => `<li>${esc(f.getAttribute('data-fn') || '')}</li>`).join('')}</ol>` : '';
  }

  // page setup + header/footer
  const mm2 = pt => Math.round(pt / 2.8346 * 10) / 10;
  function applyPage() {
    sheet.style.setProperty('--page-w', `${page.w * PX}px`);
    sheet.style.setProperty('--page-h', `${page.h * PX}px`);
    for (const el of [ed, sheet]) {
      el.style.setProperty('--pad-t', `${page.mt * PX}px`);
      el.style.setProperty('--pad-r', `${page.mr * PX}px`);
      el.style.setProperty('--pad-b', `${page.mb * PX}px`);
      el.style.setProperty('--pad-l', `${page.ml * PX}px`);
    }
    sheet.style.setProperty('--pv-stride', `${page.h * PX + PAGE_GAP}px`);
    renderHf();
  }
  function renderHf() {
    const ctx = { pages: pv.on ? pv.pages : null, title: stripExt(shell.name) };
    const H = hf && hfHas(hf) ? hf : null;
    // page view: page 1 as it will print; web view: the standard header/footer
    const kind = pv.on ? null : 'odd';
    const fill = (btn, zones) => {
      btn.replaceChildren(); btn.classList.remove('z3'); btn.style.textAlign = '';
      const el = hfEl(zones, 'x', 'span');
      if (!el) { btn.hidden = true; return; }
      btn.hidden = false;
      if (el.classList.contains('z3')) { btn.classList.add('z3'); btn.append(...Array.from(el.childNodes)); }
      else { btn.textContent = el.textContent; btn.style.textAlign = el.style.textAlign; }
    };
    fill(hfTop, H ? hfTexts(H, 0, 'h', ctx, kind) : ['', '', '']);
    fill(hfBottom, H ? hfTexts(H, 0, 'f', ctx, kind) : ['', '', '']);
    hfTop.title = hfBottom.title = 'Kopf- und Fußzeile bearbeiten';
  }
  [hfTop, hfBottom].forEach(b => b.addEventListener('click', () => editHf()));
  pagesEl.addEventListener('click', e => { if (e.target.closest('.pv-hf')) editHf(); });
  async function editHf() {
    if (plain) { toast('Kopf- und Fußzeilen gibt es nur in .docx-Dokumenten.', 'info'); return; }
    const { hfDialog } = await import('./writer-hf.js');
    const v = await hfDialog(hf);
    if (v === undefined) return;
    capture(); hf = v; applyPage(); pv.refresh(); shell.markDirty();
  }
  async function editWatermark() {
    if (plain) { toast('Wasserzeichen gibt es nur in .docx-Dokumenten.', 'info'); return; }
    const { watermarkDialog } = await import('./writer-hf.js');
    const v = await watermarkDialog(hf && hf.watermark);
    if (v === undefined) return;
    capture();
    const next = { ...(hf || {}) };
    if (v) next.watermark = v; else delete next.watermark;
    hf = hfHas(next) ? next : null;
    if (!pv.on && v) setView('page');
    applyPage(); pv.refresh(); shell.markDirty();
    toast(v ? 'Wasserzeichen eingefügt – sichtbar in der Seitenansicht.' : 'Wasserzeichen entfernt', 'success');
  }
  function pageNumberMenu(b) {
    const set = (where, align, fmt) => {
      capture();
      if (!hf || !isAdvanced(hf)) hf = { ...(hf || {}), pageNumbers: where ? `${where}-${align}` : 'none', pageFormat: fmt || 'n' };
      else {
        const strip = z => z.map(t => t.replace(/(\s*·\s*)?(Seite \{SEITE\} von \{SEITEN\}|\{SEITE\})/g, '').trim());
        for (const set2 of [hf.zones, hf.first, hf.even].filter(Boolean)) { set2.h = strip(set2.h); set2.f = strip(set2.f); }
        if (where) { const k = { left: 0, center: 1, right: 2 }[align]; const z = hf.zones[where === 'header' ? 'h' : 'f']; const lab = fmt === 'n-of-m' ? 'Seite {SEITE} von {SEITEN}' : '{SEITE}'; z[k] = z[k] ? `${z[k]} · ${lab}` : lab; }
      }
      if (!hfHas(hf)) hf = hf && hf.watermark ? { watermark: hf.watermark } : null;
      applyPage(); pv.refresh(); shell.markDirty();
    };
    officeMenu(b, [
      { label: 'Unten mittig', icon: 'hash', onClick: () => set('footer', 'center', 'n') },
      { label: 'Unten rechts', icon: 'hash', onClick: () => set('footer', 'right', 'n') },
      { label: 'Oben rechts', icon: 'hash', onClick: () => set('header', 'right', 'n') },
      { label: '„Seite X von Y“ unten mittig', icon: 'hash', onClick: () => set('footer', 'center', 'n-of-m') },
      '-',
      { label: 'Format und Startwert …', icon: 'settings', onClick: () => editHf() },
      { label: 'Seitenzahlen entfernen', icon: 'trash', onClick: () => set(null) },
    ], { label: 'Seitenzahlen' });
  }
  async function pageSetup() {
    if (plain) { toast('Seitenformat gibt es nur in Word-Dokumenten.', 'info'); return; }
    const land = page.w > page.h;
    const pw = Math.min(page.w, page.h), ph = Math.max(page.w, page.h);
    const fmt = Object.entries(PAGE_FORMATS).find(([, v]) => Math.abs(v[0] - pw) < 3 && Math.abs(v[1] - ph) < 3);
    const mar = Object.entries(MARGINS).find(([, v]) => [page.mt, page.mr, page.mb, page.ml].every((x, i) => Math.abs(x - v[i]) < 1.5));
    const H = hf || {};
    const adv = isAdvanced(hf);
    let wantAdv = false;
    const r = await openDialog({
      title: 'Seite einrichten', wide: true,
      body: `<div class="ps-dlg">
        <div class="field-row"><label class="field"><span class="field-label">Format</span><select class="select" name="fmt">${Object.entries(PAGE_FORMATS).map(([k, v]) => `<option value="${k}" ${fmt && fmt[0] === k ? 'selected' : ''}>${v[2]}</option>`).join('')}${fmt ? '' : '<option value="keep" selected>Wie im Dokument</option>'}</select></label>
          <div class="field"><span class="field-label">Ausrichtung</span><div class="seg" role="group" aria-label="Ausrichtung"><button type="button" data-or="hoch" aria-pressed="${!land}">Hochformat</button><button type="button" data-or="quer" aria-pressed="${land}">Querformat</button></div></div></div>
        <label class="field"><span class="field-label">Ränder</span><select class="select" name="mar">${Object.entries(MARGINS).map(([k, v]) => `<option value="${k}" ${mar && mar[0] === k ? 'selected' : ''}>${v[4]}</option>`).join('')}<option value="custom" ${mar ? '' : 'selected'}>Eigene (mm)</option></select></label>
        <div class="ps-custom" ${mar ? 'hidden' : ''}><div class="ps-grid">${[['mt', 'Oben'], ['mb', 'Unten'], ['ml', 'Links'], ['mr', 'Rechts']].map(([k, l]) => `<label class="field"><span class="field-label">${l}</span><input class="input" name="${k}" inputmode="decimal" value="${String(mm2(page[k])).replace('.', ',')}"></label>`).join('')}</div></div>
        <h3 class="ps-h">Kopf- und Fußzeile</h3>
        ${adv ? `<p class="hint">Erweitert eingerichtet (drei Bereiche, Felder oder andere erste/gerade Seiten).</p>` : `<div class="ps-simple">
        <div class="field-row"><label class="field"><span class="field-label">Kopfzeile</span><input class="input" name="header" value="${esc(H.header || '')}" placeholder="z. B. Projektbericht"></label>
          <label class="field"><span class="field-label">Ausrichtung</span><select class="select" name="headerAlign">${[['left', 'Links'], ['center', 'Mitte'], ['right', 'Rechts']].map(([k, l]) => `<option value="${k}" ${(H.headerAlign || 'left') === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label></div>
        <div class="field-row"><label class="field"><span class="field-label">Fußzeile</span><input class="input" name="footer" value="${esc(H.footer || '')}" placeholder="z. B. Vertraulich"></label>
          <label class="field"><span class="field-label">Ausrichtung</span><select class="select" name="footerAlign">${[['left', 'Links'], ['center', 'Mitte'], ['right', 'Rechts']].map(([k, l]) => `<option value="${k}" ${(H.footerAlign || 'left') === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label></div>
        <div class="field-row"><label class="field"><span class="field-label">Seitenzahlen</span><select class="select" name="pn">${[['none', 'Keine'], ['footer-center', 'Unten mittig'], ['footer-right', 'Unten rechts'], ['header-right', 'Oben rechts']].map(([k, l]) => `<option value="${k}" ${(H.pageNumbers || 'none') === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
          <label class="field"><span class="field-label">Schreibweise</span><select class="select" name="pf"><option value="n" ${H.pageFormat !== 'n-of-m' ? 'selected' : ''}>1, 2, 3 …</option><option value="n-of-m" ${H.pageFormat === 'n-of-m' ? 'selected' : ''}>Seite 1 von 3</option></select></label></div>
        <label class="check"><input type="checkbox" name="first" ${H.firstPage === false ? 'checked' : ''}> Nicht auf der ersten Seite (Deckblatt)</label></div>`}
        <button type="button" class="btn btn-ghost btn-sm" data-hfadv>${oicon('header')}<span>${adv ? 'Kopf- und Fußzeile bearbeiten …' : 'Mehr Optionen: drei Bereiche, Felder, gerade Seiten …'}</span></button>
      </div>`,
      actions: [{ label: 'Abbrechen', value: 'cancel' }, { label: 'Übernehmen', value: 'ok', kind: 'btn-primary', default: true }],
      onMount: dlg => {
        let orient = land ? 'quer' : 'hoch';
        $$('[data-or]', dlg).forEach(b => b.addEventListener('click', () => { orient = b.dataset.or; $$('[data-or]', dlg).forEach(x => x.setAttribute('aria-pressed', String(x === b))); }));
        $('[name=mar]', dlg).addEventListener('change', e => { $('.ps-custom', dlg).hidden = e.target.value !== 'custom'; });
        $('[data-hfadv]', dlg).addEventListener('click', () => { wantAdv = true; const ok = $('button[value=ok]', dlg); if (ok) ok.click(); });
        const v = n => { const el = $(`[name=${n}]`, dlg); return el ? el.value : ''; };
        return { collect: () => ({ fmt: v('fmt'), orient, mar: v('mar'), mt: v('mt'), mb: v('mb'), ml: v('ml'), mr: v('mr'), header: v('header').trim(), headerAlign: v('headerAlign'), footer: v('footer').trim(), footerAlign: v('footerAlign'), pn: v('pn') || 'none', pf: v('pf'), first: !!($('[name=first]', dlg) || {}).checked }) };
      },
    });
    if (r.value !== 'ok' || !r.data) return;
    const d = r.data;
    let [w, hh] = d.fmt === 'keep' ? [pw, ph] : PAGE_FORMATS[d.fmt];
    if (d.orient === 'quer') [w, hh] = [hh, w];
    const toPt = x => { const n = parseFloat(String(x).replace(',', '.')); return Number.isFinite(n) ? Math.max(0, Math.min(80, n)) * 2.8346 : 70.9; };
    const m = d.mar === 'custom' ? [toPt(d.mt), toPt(d.mr), toPt(d.mb), toPt(d.ml)] : MARGINS[d.mar].slice(0, 4);
    capture();
    page = { w, h: hh, mt: m[0], mr: m[1], mb: m[2], ml: m[3] };
    if (!adv) {
      const wm = hf && hf.watermark;
      hf = d.header || d.footer || d.pn !== 'none' ? { header: d.header, headerAlign: d.headerAlign, footer: d.footer, footerAlign: d.footerAlign, pageNumbers: d.pn, pageFormat: d.pf, firstPage: d.first ? false : undefined } : null;
      if (wm) hf = { ...(hf || {}), watermark: wm };
    }
    applyPage();
    pv.refresh();
    shell.markDirty();
    if (wantAdv) { editHf(); return; }
    toast('Seite eingerichtet', 'success');
  }

  // ---------- page layout view, zoom, ruler, formatting marks ----------
  const pv = createPageView({ ed, pagesEl, getPage: () => page, getHf: () => hf, getTitle: () => stripExt(shell.name), getStyles: () => styles, onLayout: n => { renderHf(); updatePageInfo(n); } });
  let view = 'web', zoom = 1, zoomFit = false;
  function updatePageInfo(n) { pageInfo.textContent = pv.on ? `Seite ${pv.pageOf(curRange() && curRange().startContainer)} von ${n}` : ''; }
  function setView(v) {
    view = v;
    LS.set('fale-w-view', v);
    const on = v === 'page';
    sheet.classList.toggle('pv', on);
    wrap.classList.toggle('w-pv', on);
    $('[data-x="view-page"]', wrap).setAttribute('aria-pressed', String(on));
    $('[data-x="view-web"]', wrap).setAttribute('aria-pressed', String(!on));
    applyZoom();
    pv.enable(on);
    renderHf();
    if (!on) pageInfo.textContent = '';
    if (rulerOn) rulerPaint();
    setTimeout(placeHandles, 30);
  }
  const zoomSel = $('[data-zoom]', wrap), zoomVal = $('.w-zoomval', zoomBox);
  function fitZoom() { const avail = scrollBox.clientWidth - (matchMedia('(max-width: 720px)').matches ? 16 : 40); return Math.max(0.25, Math.min(3, avail / (page.w * PX))); }
  function applyZoom() {
    const z = view === 'page' ? (zoomFit ? fitZoom() : zoom) : 1;
    sheet.style.zoom = z === 1 ? '' : String(z);
    pv.setZoom(z);
    zoomVal.textContent = `${Math.round(z * 100)} %`;
    zoomSel.value = zoomFit ? 'fit' : (ZOOMS.includes(zoom) ? String(zoom) : '');
    zoomBox.hidden = view !== 'page';
    if (rulerOn) rulerPaint();
    placeHandles();
  }
  function setZoom(z) {
    if (z === 'fit') { zoomFit = true; }
    else { zoomFit = false; zoom = Math.max(0.25, Math.min(4, z)); }
    if (view !== 'page') setView('page'); else applyZoom();
    LS.set('fale-w-zoom', zoomFit ? 'fit' : String(zoom));
  }
  const nextZoom = d => { const cz = zoomFit ? fitZoom() : zoom; if (d > 0) return ZOOMS.find(x => x > cz + 0.01) || Math.min(4, cz + 0.5); const s = ZOOMS.filter(x => x < cz - 0.01); return s.length ? s[s.length - 1] : Math.max(0.25, cz - 0.1); };
  zoomSel.addEventListener('change', () => setZoom(zoomSel.value === 'fit' ? 'fit' : +zoomSel.value));
  zoomBox.addEventListener('click', e => { const b = e.target.closest('[data-zf]'); if (!b) return; const d = +b.dataset.zf; setZoom(d === 0 ? 1 : nextZoom(d)); });
  const onResize = debounce(() => { if (zoomFit && view === 'page') applyZoom(); if (rulerOn) rulerPaint(); placeHandles(); }, 120);
  window.addEventListener('resize', onResize);
  ed.addEventListener('load', e => { if (e.target.tagName === 'IMG') pv.schedule(60); }, true);

  // ruler
  const rulerEl = $('.w-ruler', wrap);
  let rulerOn = false;
  const ruler = createRuler(rulerEl, {
    getPage: () => page,
    getZoom: () => (view === 'page' ? (zoomFit ? fitZoom() : zoom) : 1),
    getBlocks: () => selBlocks(),
    getPageRect: () => { const r = sheet.getBoundingClientRect(); return r.width ? r : null; },
    getContentRect: () => { const r = ed.getBoundingClientRect(); const z = zoomScale(); const cs = getComputedStyle(ed); return { left: r.left + parseFloat(cs.paddingLeft) * z, right: r.right - parseFloat(cs.paddingRight) * z }; },
    capture: () => capture(),
    onChange: p => { const blocks = selBlocks(); if (p.tabs) blocks.forEach(b => { if (p.tabs.length) b.setAttribute('data-tabs', p.tabs.join(',')); else b.removeAttribute('data-tabs'); }); else F.applyPara(blocks, p); },
    onDone: () => { shell.markDirty(); pv.schedule(30); },
  });
  function rulerPaint() { if (rulerOn) ruler.paint(); }
  function setRuler(on) {
    rulerOn = on; rulerEl.hidden = !on; LS.set('fale-w-ruler', on ? '1' : '0');
    $('[data-x="ruler"]', wrap).setAttribute('aria-pressed', String(on));
    if (on) rulerPaint();
  }
  let marksOn = false;
  function setMarks(on) { marksOn = on; ed.classList.toggle('show-marks', on); $('[data-x="marks"]', wrap).setAttribute('aria-pressed', String(on)); }

  // ---------- track changes ----------
  const tracker = createTracker(ed, { author: () => profileName || 'Ich', onChange: () => { shell.markDirty(); onInput(); } });
  function setTracking(on) {
    tracker.enabled = on;
    $('[data-x="track"]', wrap).setAttribute('aria-pressed', String(on));
    trackInfo.hidden = !on;
    toast(on ? 'Änderungen werden nachverfolgt.' : 'Nachverfolgung aus.', 'info');
    if (on && !tracker.list().length) togglePanel('changes', !matchMedia('(max-width: 900px)').matches);
  }
  const markupSel = $('[data-markup]', wrap);
  markupSel.addEventListener('change', () => { ed.classList.toggle('tc-final', markupSel.value === 'final'); ed.classList.toggle('tc-original', markupSel.value === 'original'); pv.schedule(30); });
  function renderChanges() {
    const list = tracker.list();
    const b = $('[data-x="changes"]', wrap);
    if (b) b.dataset.count = list.length || '';
    if (tcPanel.hidden) return;
    const box = $('.w-tc-list', tcPanel);
    box.innerHTML = list.length ? '' : '<p class="panel-empty">Keine nachverfolgten Änderungen. Schalte unter „Überprüfen“ die Nachverfolgung ein – Einfügungen und Löschungen werden dann markiert.</p>';
    list.forEach((c, i) => {
      const d = c.date ? new Date(c.date) : null;
      const card = h(`<article class="w-tc ${c.kind}" tabindex="0"><div class="w-tc-head"><strong>${c.kind === 'ins' ? 'Eingefügt' : 'Gelöscht'}</strong><span class="muted small">${esc(c.author || '')}${d && !isNaN(d) ? ` · ${d.toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}` : ''}</span></div>
        <p class="w-tc-text">${esc(c.text.length > 120 ? c.text.slice(0, 118) + '…' : c.text)}</p>
        <div class="w-tc-foot"><button class="btn btn-ghost btn-sm" type="button" data-acc>Annehmen</button><button class="btn btn-ghost btn-sm" type="button" data-rej>Ablehnen</button></div></article>`);
      card.addEventListener('click', e => {
        if (e.target.closest('[data-acc]')) { op(() => tracker.accept(c.el)); return; }
        if (e.target.closest('[data-rej]')) { op(() => tracker.reject(c.el)); return; }
        focusChange(c.el);
      });
      card._el = c.el; card.dataset.i = i;
      box.appendChild(card);
    });
  }
  $$('[data-tcall]', tcPanel).forEach(b => b.addEventListener('click', () => { const acc = b.dataset.tcall === 'accept'; const n = tracker.list().length; if (!n) return; op(() => (acc ? tracker.acceptAll() : tracker.rejectAll())); toast(acc ? `${n} Änderung${n === 1 ? '' : 'en'} angenommen` : `${n} Änderung${n === 1 ? '' : 'en'} abgelehnt`, 'success'); }));
  function focusChange(el) {
    $$('.tc-focus', ed).forEach(x => x.classList.remove('tc-focus'));
    el.classList.add('tc-focus');
    const r = el.getBoundingClientRect(), cr = scrollBox.getBoundingClientRect();
    if (r.top < cr.top + 30 || r.bottom > cr.bottom - 30) scrollBox.scrollTop += r.top - cr.top - cr.height / 3;
    const rg = document.createRange(); rg.selectNode(el);
    const s = getSelection(); s.removeAllRanges(); s.addRange(rg);
    $$('.w-tc', tcPanel).forEach(c => c.classList.toggle('on', c._el === el));
    setTimeout(() => el.classList.remove('tc-focus'), 1200);
  }
  function gotoChange(d) {
    const all = tracker.all();
    if (!all.length) { toast('Keine Änderungen im Dokument.', 'info'); return; }
    const r = curRange();
    let i;
    if (!r) i = d > 0 ? 0 : all.length - 1;
    else if (d > 0) { i = all.findIndex(x => r.comparePoint(x, 0) > 0 && !x.contains(r.startContainer)); if (i < 0) i = 0; }
    else { const before = all.filter(x => r.comparePoint(x, 0) < 0 && !x.contains(r.startContainer)); i = before.length ? all.indexOf(before[before.length - 1]) : all.length - 1; }
    focusChange(all[i]);
  }
  function reviewMenu(b, acc) {
    officeMenu(b, [
      { label: acc ? 'Diese Änderung annehmen' : 'Diese Änderung ablehnen', icon: acc ? 'accept' : 'reject', onClick: () => { const l = tracker.atSelection(); if (!l.length) { toast('Setze den Cursor in eine Änderung.', 'info'); return; } op(() => l.forEach(x => (acc ? tracker.accept(x) : tracker.reject(x)))); } },
      { label: acc ? 'Annehmen und weiter' : 'Ablehnen und weiter', icon: acc ? 'accept' : 'reject', onClick: () => { const l = tracker.atSelection(); if (l.length) op(() => l.forEach(x => (acc ? tracker.accept(x) : tracker.reject(x)))); gotoChange(1); } },
      { label: acc ? 'Alle Änderungen annehmen' : 'Alle Änderungen ablehnen', icon: acc ? 'accept' : 'reject', onClick: () => { const n = tracker.list().length; op(() => (acc ? tracker.acceptAll() : tracker.rejectAll())); toast(acc ? `${n} Änderung${n === 1 ? '' : 'en'} angenommen` : `${n} Änderung${n === 1 ? '' : 'en'} abgelehnt`, 'success'); } },
    ], { label: acc ? 'Annehmen' : 'Ablehnen' });
  }
  if (tracker.list().length) setTimeout(() => toast('Das Dokument enthält nachverfolgte Änderungen (Überprüfen → Änderungen).', 'info'), 400);

  // ---------- mail merge (Serienbrief) ----------
  const mm = { data: null, idx: 0, preview: false };
  const mmPos = $('[data-mmpos]', wrap);
  function mmPaint() {
    mmPos.textContent = mm.data ? `${mm.idx + 1} / ${mm.data.records.length}` : '–';
    $('[data-x="mm-preview"]', wrap).setAttribute('aria-pressed', String(mm.preview));
  }
  async function mmSource() {
    const { chooseRecipients } = await import('./mailmerge.js');
    const d = await chooseRecipients();
    if (!d) return;
    mm.data = d; mm.idx = 0;
    mmPaint();
    toast(`${d.records.length} Empfänger · Felder: ${d.fields.slice(0, 6).join(', ')}${d.fields.length > 6 ? ' …' : ''}`, 'success');
  }
  async function mmField(b) {
    if (!mm.data) { await mmSource(); if (!mm.data) return; }
    const { fieldHtml } = await import('./mailmerge.js');
    officeMenu(b, mm.data.fields.map(f => ({ label: f, icon: 'mailMerge', onClick: () => { capture(); insertInline(fieldHtml(f)); changed(); if (mm.preview) mmPreview(true); } })), { label: 'Seriendruckfeld einfügen' });
  }
  async function mmPreview(on) {
    if (on && !mm.data) { await mmSource(); if (!mm.data) return; }
    const { previewFields } = await import('./mailmerge.js');
    mm.preview = on;
    previewFields(ed, on ? mm.data.records[mm.idx] : null);
    mmPaint(); pv.schedule(30);
  }
  function mmStep(d) {
    if (!mm.data) return;
    mm.idx = (mm.idx + d + mm.data.records.length) % mm.data.records.length;
    mmPaint();
    if (mm.preview) mmPreview(true); else mmPreview(true);
  }
  async function mmFinish() {
    if (!mm.data) { await mmSource(); if (!mm.data) return; }
    if (!$('span.mf', ed)) { toast('Füge zuerst Seriendruckfelder ein (Sendungen → Seriendruckfeld).', 'info'); return; }
    const wasPreview = mm.preview;
    if (wasPreview) await mmPreview(false);
    const { finishMerge } = await import('./mailmerge.js');
    await finishMerge({ ed, data: mm.data, title: shell.name, baseSize, page, hf, styles: plain ? null : styles, author: await authorName() });
    if (wasPreview) mmPreview(true);
  }

  // ---------- word count, go to page, versions, autosave, shortcuts ----------
  async function wordCountDialog() {
    const s = getSelection();
    const selText = s.rangeCount && ed.contains(s.anchorNode) && !s.isCollapsed ? s.toString() : '';
    const all = textOf(ed);
    const c = countText(all);
    const paras = $$('p,h1,h2,h3,h4,h5,h6,li,pre', ed).filter(x => !x.closest('[data-toc]') && x.textContent.trim() && !x.querySelector('p,li')).length;
    const sentences = (all.match(/[^.!?…]+[.!?…]+/g) || []).length || (c.words ? 1 : 0);
    const pages = pv.on ? pv.pages : Math.max(1, Math.round(ed.scrollHeight / (page.h * PX - (page.mt + page.mb) * PX) * (ed.clientWidth / Math.max(1, page.w * PX)) * 10) / 10);
    const sc = selText ? countText(selText) : null;
    const row = (l, v) => `<tr><th>${l}</th><td>${typeof v === 'number' ? v.toLocaleString('de-DE') : esc(String(v))}</td></tr>`;
    await openDialog({
      title: 'Wörter zählen',
      body: `<table class="w-stats">${row(pv.on ? 'Seiten' : 'Seiten (ca.)', pages)}${row('Wörter', c.words)}${row('Zeichen (ohne Leerzeichen)', c.charsNoSpace)}${row('Zeichen (mit Leerzeichen)', c.chars)}${row('Absätze', paras)}${row('Sätze', sentences)}${row('Wörter pro Satz (Ø)', sentences ? String(Math.round(c.words / sentences * 10) / 10).replace('.', ',') : '–')}${row('Lesezeit (ca.)', `${Math.max(1, Math.round(c.words / 200))} min`)}</table>
        ${sc ? `<h3 class="ps-h">Markierung</h3><table class="w-stats">${row('Wörter', sc.words)}${row('Zeichen (ohne Leerzeichen)', sc.charsNoSpace)}${row('Zeichen (mit Leerzeichen)', sc.chars)}</table>` : ''}`,
      actions: [{ label: 'Schließen', value: 'ok', kind: 'btn-primary', default: true }],
    });
  }
  async function gotoPageDialog() {
    if (!pv.on) setView('page');
    const v = await promptDialog('Gehe zu Seite', `Seite (1–${pv.pages})`, String(pv.pageOf(curRange() && curRange().startContainer)), { okLabel: 'Gehe zu' });
    const n = parseInt(v, 10);
    if (!n) return;
    gotoPage(n);
  }
  function gotoPage(n) {
    const z = zoomScale();
    const y = pv.pageTop(n) * z;
    const sr = sheet.getBoundingClientRect(), cr = scrollBox.getBoundingClientRect();
    scrollBox.scrollTop += sr.top - cr.top + y - 12;
    // caret to the first block on that page
    const target = pv.pageTop(n) + page.mt * PX;
    const blocks = $$('p,h1,h2,h3,h4,h5,h6,li,pre,td', ed);
    const er = ed.getBoundingClientRect();
    const b = blocks.find(x => (x.getBoundingClientRect().bottom - er.top) / z > target);
    if (b) { const r = document.createRange(); r.selectNodeContents(b); r.collapse(true); const s = getSelection(); s.removeAllRanges(); s.addRange(r); ed.focus({ preventScroll: true }); }
    updateState();
  }

  let autosaveOn = LS.get('fale-w-autosave', '0') === '1';
  let autosaveTimer = 0;
  function setAutosave(on) {
    autosaveOn = on; LS.set('fale-w-autosave', on ? '1' : '0');
    $('[data-x="autosave"]', wrap).setAttribute('aria-pressed', String(on));
    toast(on ? 'Automatisches Speichern ist an (alle 30 Sekunden bei Änderungen).' : 'Automatisches Speichern ist aus.', 'info');
    armAutosave();
  }
  function armAutosave() {
    clearInterval(autosaveTimer);
    if (!autosaveOn) return;
    autosaveTimer = setInterval(() => { if (autosaveOn && screen.isDirty && screen.isDirty() && shell.id && !document.querySelector('dialog[open]')) shell.save({ quiet: true }); }, 30000);
  }
  async function addVersionNow(docId, label) {
    if (!docId) return;
    try {
      const { addVersion } = await import('./versions.js');
      await addVersion({ docId, html: cleanEditorHtml(ed), page: { ...page }, hf: hf ? { ...hf } : null, styles: JSON.parse(JSON.stringify(styles)), words: countText(ed.innerText || '').words, label, name: shell.name });
    } catch (e) { console.warn('version', e); }
  }
  async function versionsDialog() {
    const docId = shell.id;
    if (!docId) { toast('Speichere das Dokument zuerst – danach werden Versionen bei jedem Speichern angelegt.', 'info'); return; }
    const { listVersions } = await import('./versions.js');
    const list = await listVersions(docId);
    const r = await openDialog({
      title: 'Versionsverlauf', wide: true,
      body: `<p class="hint">Bei jedem Speichern wird eine Version auf diesem Gerät abgelegt (die letzten 20).</p>
        <div class="w-versions">${list.length ? list.map((v, i) => `<div class="w-ver"><div><strong>${esc(new Date(v.at).toLocaleString('de-DE'))}</strong><span class="muted small"> · ${esc(v.label || '')} · ${(v.words || 0).toLocaleString('de-DE')} Wörter</span></div><button class="btn btn-ghost btn-sm" type="button" data-restore="${i}">Wiederherstellen</button></div>`).join('') : '<p class="panel-empty">Noch keine Versionen.</p>'}</div>`,
      actions: [{ label: 'Schließen', value: 'cancel', kind: 'btn-primary' }],
      onMount: dlg => { let pick = null; dlg.addEventListener('click', e => { const b = e.target.closest('[data-restore]'); if (b) { pick = +b.dataset.restore; dlg.close(); } }); return { collect: () => pick }; },
    });
    if (r.data == null) return;
    const v = list[r.data];
    if (!v) return;
    if (!(await confirmDialog('Version wiederherstellen', `Den Stand vom ${new Date(v.at).toLocaleString('de-DE')} wiederherstellen? Der aktuelle Stand kann mit „Rückgängig“ zurückgeholt werden.`, { okLabel: 'Wiederherstellen' }))) return;
    capture();
    let clean = v.html;
    try { clean = await sanitizeDocHtml(v.html); } catch {}
    ed.innerHTML = clean;
    if (v.page) page = v.page;
    hf = v.hf || null;
    if (v.styles) { styles = normalizeStyles(v.styles); stylesChanged(); }
    applyPage();
    changed(); afterChange();
    toast('Version wiederhergestellt', 'success');
  }

  const SHORTCUTS = [
    ['Strg+B / I / U', 'Fett / Kursiv / Unterstrichen'], ['Strg+Z / Strg+Y', 'Rückgängig / Wiederholen'], ['Strg+F / Strg+H', 'Suchen / Ersetzen'], ['Strg+K', 'Link einfügen'],
    ['Strg+Enter', 'Seitenumbruch'], ['Strg+Umschalt+1 … 4', 'Überschrift 1 … 4'], ['Strg+Umschalt+N', 'Formatvorlage Standard'], ['Strg+L / E / R / J', 'Links / Zentriert / Rechts / Blocksatz'],
    ['Strg+1 / 5 / 2', 'Zeilenabstand 1 / 1,5 / 2'], ['Strg+M / Strg+Umschalt+M', 'Einzug vergrößern / verkleinern'], ['Strg+Umschalt+L', 'Aufzählung'], ['Strg+Umschalt+> / <', 'Schrift größer / kleiner'],
    ['Strg+Umschalt++ / Strg+#', 'Hochgestellt / Tiefgestellt'], ['Strg+Leertaste', 'Zeichenformat löschen'], ['Strg+Umschalt+C / V', 'Format kopieren / übertragen'], ['Umschalt+F3', 'Groß-/Kleinschreibung wechseln'],
    ['Strg+G', 'Gehe zu Seite'], ['Strg+Alt+M', 'Kommentar'], ['Strg+Alt+F / Strg+Alt+D', 'Fußnote / Endnote'], ['Strg+Umschalt+F5', 'Textmarke'], ['Strg+Umschalt+Alt+V', 'Als reinen Text einfügen'], ['Esc', 'Fokus- oder Lesemodus beenden'], ['Strg+Umschalt+E', 'Änderungen nachverfolgen'], ['Tab / Umschalt+Tab', 'Nächste Zelle · Listenebene · Tabulator'], ['Strg+S', 'Speichern'], ['F1', 'Diese Übersicht'],
  ];
  function shortcutsDialog() {
    openDialog({
      title: 'Tastenkürzel', wide: true,
      body: `<div class="w-keys">${SHORTCUTS.map(([k, l]) => `<div><kbd>${esc(k)}</kbd></div><div>${esc(l)}</div>`).join('')}</div>`,
      actions: [{ label: 'Schließen', value: 'ok', kind: 'btn-primary', default: true }],
    });
  }

  // ---------- keyboard ----------
  ed.addEventListener('keydown', e => {
    const mod = e.ctrlKey || e.metaKey;
    const k = e.key.toLowerCase();
    if (e.key === 'Tab' && !mod && !e.altKey) {
      e.preventDefault();
      if (tables.current()) { tables.tabKey(e); return; }
      if (F.listOf(ed, getSelection().anchorNode)) { exec(e.shiftKey ? 'outdent' : 'indent'); return; }
      if (!e.shiftKey) { capture('type'); if (tracker.enabled) tracker.insertText('\t'); else document.execCommand('insertText', false, '\t'); changed(); }
      return;
    }
    if (e.key === 'F3' && e.shiftKey) { e.preventDefault(); const modes = ['upper', 'lower', 'title']; doCase(modes[caseCycle++ % 3]); return; }
    if (e.key === 'Escape' && painter) { painter = null; wrap.classList.remove('painting'); $('[data-x="painter"]', wrap).setAttribute('aria-pressed', 'false'); return; }
    if (!mod) return;
    const sh = e.shiftKey;
    const run = fn => { e.preventDefault(); fn(); };
    if (!sh && k === 'z') return run(doUndo);
    if ((!sh && k === 'y') || (sh && k === 'z')) return run(doRedo);
    if (!sh && !e.altKey && ['b', 'i', 'u'].includes(k)) return run(() => exec(k === 'b' ? 'bold' : k === 'i' ? 'italic' : 'underline'));
    if (!sh && k === 'k') return run(() => { saveSel(); insertLink(); });
    if (e.key === 'Enter' && !sh) return run(insertPageBreak);
    if (sh && /^Digit[1-4]$/.test(e.code)) return run(() => setBlockStyle(`h${e.code.slice(-1)}`));
    if (e.altKey && /^Digit[1-3]$/.test(e.code)) return run(() => setBlockStyle(`h${e.code.slice(-1)}`));
    if (sh && k === 'n') return run(() => setBlockStyle('normal'));
    if (!sh && !e.altKey && k === 'l') return run(() => exec('justifyLeft'));
    if (!sh && k === 'e') return run(() => exec('justifyCenter'));
    if (!sh && k === 'r') return run(() => exec('justifyRight'));
    if (!sh && k === 'j') return run(() => exec('justifyFull'));
    if (!sh && !e.altKey && (e.code === 'Digit1' || e.code === 'Digit2' || e.code === 'Digit5')) return run(() => op(() => F.applyPara(selBlocks(), { line: e.code === 'Digit1' ? 1 : e.code === 'Digit2' ? 2 : 1.5 })));
    if (k === 'm' && !e.altKey) return run(() => indent(sh ? -1 : 1));
    if (sh && k === 'l') return run(() => exec('insertUnorderedList'));
    if ((sh && (e.key === '>' || e.code === 'Period')) || (!sh && e.key === ']')) return run(() => act('grow'));
    if ((sh && (e.key === '<' || e.code === 'Comma')) || (!sh && e.key === '[')) return run(() => act('shrink'));
    if ((sh && (e.key === '+' || e.code === 'Equal')) || (!sh && e.key === '+')) return run(() => exec('superscript'));
    if ((!sh && (e.key === '=' || e.key === '#'))) return run(() => exec('subscript'));
    if (e.code === 'Space' && !sh) return run(() => { restoreSel(); capture(); F.clearCharFormat(ed); changed(); });
    if (sh && k === 'c') return run(() => { painter = F.copyFormat(ed); if (painter) toast('Format kopiert (Strg+Umschalt+V zum Übertragen)', 'info'); });
    if (sh && k === 'v') return run(() => { if (painter) { const p = painter; painter = { ...p, sticky: true }; painterApply(); painter = p; } });
    if (!sh && k === 'g') return run(gotoPageDialog);
    const altGr = e.getModifierState && e.getModifierState('AltGraph');
    if (e.altKey && !altGr && !sh && k === 'f') return run(() => insertFootnote());
    if (e.altKey && !altGr && !sh && k === 'd') return run(() => extras.insertEndnote());
    if (sh && e.key === 'F5') return run(() => extras.bookmarkDialog());
    if (sh && e.altKey && !altGr && k === 'v') return run(() => pasteAsText());
    if (e.altKey && k === 'm') return run(() => addComment());
    if (sh && k === 'e') return run(() => setTracking(!tracker.enabled));
    return undefined;
  });
  const onKey = e => {
    if (!wrap.isConnected) return;
    const mod = e.ctrlKey || e.metaKey;
    if (mod && !e.shiftKey && (e.key === 'f' || e.key === 'h')) { e.preventDefault(); saveSel(); openFind(true, e.key === 'h'); }
    if (e.key === 'F1') { e.preventDefault(); shortcutsDialog(); }
    if (e.key === 'Escape' && mode && !document.querySelector('dialog[open]') && !document.querySelector('.menu-layer .menu')) { setMode(null); }
    const t = e.target;
    if (mod && !e.altKey && /^[zy]$/i.test(e.key) && !(t.closest && t.closest('input,textarea,select,[contenteditable="true"],dialog')) && !document.querySelector('dialog[open]')) {
      e.preventDefault();
      if (e.key.toLowerCase() === 'y' || e.shiftKey) doRedo(); else doUndo();
    }
  };
  document.addEventListener('keydown', onKey);

  // spellcheck
  let spellOn = LS.get('fale-spell', '1') === '1';
  function setSpell(on) {
    spellOn = on;
    ed.spellcheck = on;
    ed.setAttribute('spellcheck', String(on));
    LS.set('fale-spell', on ? '1' : '0');
    $('[data-spell]', tbEl).setAttribute('aria-pressed', String(on));
    const x = $('[data-x="spell"]', wrap); if (x) x.setAttribute('aria-pressed', String(on));
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
          restoreSel(); capture('op');
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

  // ---------- focus / reading mode ----------
  let mode = null, viewBeforeRead = null;
  const modeExit = $('.w-modeexit', wrap);
  modeExit.addEventListener('click', () => setMode(null));
  function setMode(m) {
    const was = mode;
    mode = m;
    wrap.classList.toggle('w-focus', m === 'focus');
    wrap.classList.toggle('w-read', m === 'read');
    screen.root.classList.toggle('w-immersive', !!m);
    ed.setAttribute('contenteditable', m === 'read' ? 'false' : 'true');
    modeExit.hidden = !m;
    $('span', modeExit).textContent = m === 'read' ? 'Lesemodus beenden' : 'Fokusmodus beenden';
    $('[data-x="view-read"]', wrap).setAttribute('aria-pressed', String(m === 'read'));
    $('[data-x="view-focus"]', wrap).setAttribute('aria-pressed', String(m === 'focus'));
    if (m === 'read' && was !== 'read') { viewBeforeRead = view; if (view !== 'web') setView('web'); }
    if (was === 'read' && m !== 'read' && viewBeforeRead && viewBeforeRead !== view) setView(viewBeforeRead);
    if (m) { extras.placeFbar(); toast(m === 'read' ? 'Lesemodus – Esc oder „Lesemodus beenden“ zum Bearbeiten.' : 'Fokusmodus – Esc beendet ihn.', 'info'); }
    if (m === 'focus') setTimeout(() => ed.focus({ preventScroll: true }), 30);
  }

  // ---------- language (spell checking) ----------
  const LANGS = [['de-DE', 'Deutsch (Deutschland)'], ['de-AT', 'Deutsch (Österreich)'], ['de-CH', 'Deutsch (Schweiz)'], ['en-US', 'Englisch (USA)'], ['en-GB', 'Englisch (Großbritannien)'], ['fr-FR', 'Französisch'], ['es-ES', 'Spanisch'], ['it-IT', 'Italienisch'], ['nl-NL', 'Niederländisch'], ['pl-PL', 'Polnisch'], ['tr-TR', 'Türkisch']];
  function languageMenu(b) {
    const r = curRange();
    const selBl = r && !r.collapsed ? selBlocks() : [];
    officeMenu(b, LANGS.map(([k, l]) => ({ label: `${(selBl.length ? selBl[0].lang || ed.lang : ed.lang) === k ? '✓ ' : ''}${l}`, icon: 'language', onClick: () => {
      if (selBl.length) { op(() => selBl.forEach(x2 => { if (k === ed.lang) x2.removeAttribute('lang'); else x2.setAttribute('lang', k); })); toast(`Sprache der Markierung: ${l}`, 'success'); }
      else { ed.lang = k; LS.set('fale-w-lang', k); setSpell(spellOn); toast(`Dokumentsprache: ${l} – die Rechtschreibprüfung deines Geräts prüft in dieser Sprache.`, 'success'); }
    } })), { label: selBl.length ? 'Sprache der Markierung' : 'Sprache des Dokuments' });
  }
  ed.lang = LS.get('fale-w-lang', 'de-DE');

  // ---------- floating format bar ----------
  function fbarAction(k, b) {
    switch (k) {
      case 'bold': case 'italic': case 'underline': return exec(k);
      case 'hilite': colorMode = 'back'; return applyColor('#FDE047');
      case 'color': return officeMenu(b, ['#1A1A1A', '#C2410C', '#B91C1C', '#3B37A0', '#0B8F80', '#15803D', '#7E22CE', '#6B7194'].map(c => ({ label: colorName(c), icon: 'color', onClick: () => { colorMode = 'fore'; applyColor(c); } })), { label: 'Textfarbe' });
      case 'style': return officeMenu(b, [['normal', 'Standard'], ['h1', 'Überschrift 1'], ['h2', 'Überschrift 2'], ['h3', 'Überschrift 3'], ['quote', 'Zitat'], ['title', 'Titel']].map(([id, l]) => ({ label: l, icon: 'heading', onClick: () => setBlockStyle(id) })), { label: 'Formatvorlage' });
      case 'list': return exec('insertUnorderedList');
      case 'link': return insertLink();
      case 'comment': return addComment();
      case 'clear': return clearFormatting();
      default: return null;
    }
  }
  extras = createWriterExtras({
    ed, wrap, plain, capture, changed, op, insertBlock, insertInline, restoreSel, saveSel, curRange, selBlocks, toast,
    get pv() { return pv; }, getHf: () => hf, getStyles: () => styles, jumpTo, refresh: () => refreshStructure(), undo: () => doUndo(),
    getSelImg: () => selImg, placeHandles: () => placeHandles(), contentWidthPx: () => Math.round((page.w - page.ml - page.mr) * PX), fbarAction,
  });

  // ---------- start ----------
  applyPage();
  setSpell(spellOn);
  const phone = matchMedia('(max-width: 720px)').matches;
  const zl = LS.get('fale-w-zoom', '1');
  if (zl === 'fit') zoomFit = true; else zoom = Math.max(0.25, Math.min(4, parseFloat(zl) || 1));
  setView(phone ? 'web' : (LS.get('fale-w-view', 'page') === 'web' ? 'web' : 'page'));
  setRuler(LS.get('fale-w-ruler', '0') === '1' && !phone);
  $('[data-x="autosave"]', wrap).setAttribute('aria-pressed', String(autosaveOn));
  armAutosave();
  if (LS.get('fale-w-outline', '0') === '1' && !matchMedia('(max-width: 900px)').matches && !plain) togglePanel('outline', true);
  refreshStructure();
  mmPaint();
  (async () => { try { const { pruneVersions } = await import('./versions.js'); const ids = [...(await db.listFiles()), ...(await db.listTrash())].map(d => d.id); pruneVersions(ids); } catch {} })();
  wrap._writerApi = {
    ed, hf: () => hf, page: () => page, styles: () => styles, setHf: v => { hf = v; renderHf(); pv.refresh(); shell.markDirty(); }, setPage: v => { page = v; applyPage(); pv.refresh(); shell.markDirty(); },
    addComment, insertToc, insertFootnote, refresh: refreshStructure, pv, view: () => view, setView, setZoom, tables, tracker, setTracking, hist, undo: doUndo, redo: doRedo,
    setStyle: setBlockStyle, setStyles: (sid, v) => { styles[sid] = { ...styles[sid], ...v }; stylesChanged(); refreshStructure(); }, model: modelNow, serialize, mm, mmPreview, gotoPage, act, F,
    extras, setMode, mode: () => mode, insertToc, tableCmd, imageCmd, selectImage, exportPdf, editHf,
  };

  if (screen._query) { fq.value = screen._query; openFind(false); }
  if (!id) setTimeout(() => { ed.focus(); }, 50);

  return () => {
    if (reader) { try { reader.stop(); } catch {} }
    if (dictating) { dictating = false; try { rec && rec.stop(); } catch {} }
    clearInterval(autosaveTimer);
    tracker.destroy();
    extras.destroy();
    document.removeEventListener('selectionchange', onSelChange);
    document.removeEventListener('keydown', onKey);
    window.removeEventListener('resize', onResize);
    if (hl) { CSS.highlights.delete('fale-find'); CSS.highlights.delete('fale-find-cur'); }
    screen.officeCleanup && screen.officeCleanup();
  };
}

const COLOR_NAMES = { '#1A1A1A': 'Schwarz', '#C2410C': 'Orange', '#B91C1C': 'Rot', '#3B37A0': 'Indigo', '#0B8F80': 'Petrol', '#15803D': 'Grün', '#7E22CE': 'Violett', '#6B7194': 'Grau', '#FDE047': 'Gelb', '#A7F3D0': 'Mint', '#BFDBFE': 'Hellblau', '#FBCFE8': 'Rosa', '#FED7AA': 'Apricot', '#D9F99D': 'Hellgrün', '#E9D5FF': 'Flieder', '#D1D5DB': 'Grau', '#F3F4F8': 'Hellgrau', '#E9E8FB': 'Lavendel', '#DCEBFF': 'Himmelblau', '#DFF5EA': 'Mintgrün', '#FFF4CC': 'Vanille', '#FDE2E1': 'Rosé', '#D5D8E6': 'Silber', '#1B1E33': 'Nachtblau' };
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
const STYLE_KEEP = ['color', 'background-color', 'font-weight', 'font-style', 'text-decoration', 'text-decoration-line', 'text-align', 'font-size', 'font-family'];
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
      for (const p of STYLE_KEEP) {
        let v = c.style.getPropertyValue(p);
        if (!v || /var\(|url\(|expression/i.test(v)) continue;
        if (p === 'font-family') { const n = fontNameOf(v); if (!n) continue; v = fontCss(n); }
        st.push(`${p}:${v}`);
      }
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
void clearPagination;
