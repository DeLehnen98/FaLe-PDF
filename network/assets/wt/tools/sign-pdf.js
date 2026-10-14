// Tool: sign PDFs. Create a signature by drawing, typing or photographing it (lib/sec-sig.js), place it,
// initials, a date, text and check marks by touch (lib/sec-placer.js), optionally on all pages. The
// result is burned into the page content (lib/sec-draw.js). Simple electronic signature – not qualified.
// Remembering a signature is opt-in and stays in this browser (IndexedDB); nothing is uploaded.
import { el, clear } from '../lib/dom.js';
import { loadPdfLib } from '../lib/pdf.js';
import { ensureCss, tr, ic, btn, userError, guardPrimary, statusLine, saveLikeSource, pdfBlob, watchUnlock, winAnsiSafe } from '../lib/sec-ui.js';
import { createPlacer, sizeText } from '../lib/sec-placer.js';
import { drawImageBox, drawTextBox, drawMark } from '../lib/sec-draw.js';

const S = { inputId: null, pdf: null, items: [], assets: new Map(), seq: 0, placer: null };
const KIND_LABEL = {
  signature: { de: 'Unterschrift', en: 'Signature' }, initials: { de: 'Initialen', en: 'Initials' },
  text: { de: 'Text', en: 'Text' }, check: { de: 'Haken', en: 'Check mark' }, cross: { de: 'Kreuz', en: 'Cross' },
};
const today = lang => new Date().toLocaleDateString(lang === 'de' ? 'de-DE' : 'en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' });

function addAsset(blob, w, h, kind) {
  const id = `a${++S.seq}`;
  S.assets.set(id, { id, blob, w, h, kind, url: URL.createObjectURL(blob), aspect: h / w });
  return S.assets.get(id);
}

export default {
  options: [],

  mountStage(stage, state, ctx) {
    ensureCss();
    stage.classList.add('sec-stage');
    this._stage = stage; this._state = state; this._lang = ctx.lang;
    guardPrimary(stage, state, () => (S.items.length ? '' : tr(ctx.lang, 'Füge zuerst deine Unterschrift hinzu und platziere sie auf der Seite.', 'First add your signature and place it on the page.')),
      msg => { this._status?.set(msg, 'error'); this._status?.node.scrollIntoView({ block: 'center' }); });
    watchUnlock(stage, state, inputs => this.onInputs(inputs));
    this.onInputs(state.inputs.filter(i => !i.error && !i.locked));
  },

  async onInputs(inputs) {
    const stage = this._stage;
    if (!stage) return;
    const input = inputs.find(i => !i.locked);
    if (!input) { clear(stage); S.inputId = null; S.placer?.destroy(); S.items.length = 0; return; }
    if (S.inputId === input.id || this._loading === input.id) return;
    this._loading = input.id;
    let pdf;
    try { pdf = await input.pdfjs(); } catch { this._loading = null; return; }
    this._loading = null;
    S.placer?.destroy();
    S.inputId = input.id; S.pdf = pdf; S.items.length = 0;
    this._status = build(stage, this._state, this._lang);
  },

  async run(inputs, opts, ctx) {
    const input = inputs[0];
    if (!S.items.length || S.inputId !== input.id) throw userError('Platziere zuerst deine Unterschrift.', 'Place your signature first.');
    const PDFLib = await loadPdfLib();
    const doc = await input.pdfDoc();
    const pages = doc.getPages();
    const pdf = await input.pdfjs();
    const images = new Map();
    let font = null;
    const fontKeys = new Map();
    let lost = 0, k = 0;
    const byPage = [...S.items].sort((a, b) => a.page - b.page);
    for (const item of byPage) {
      ctx.progress(k++ / byPage.length, { de: `Seite ${item.page} wird unterschrieben …`, en: `Signing page ${item.page} …` });
      const vp = (await pdf.getPage(item.page)).getViewport({ scale: 1 });
      const page = pages[item.page - 1];
      const box = { cx: item.cx * vp.width, cy: item.cy * vp.height, w: item.w, h: item.h, rot: item.rot || 0 };
      if (item.kind === 'image') {
        if (!images.has(item.asset.id)) images.set(item.asset.id, await doc.embedPng(new Uint8Array(await item.asset.blob.arrayBuffer())));
        drawImageBox(PDFLib, page, vp, box, images.get(item.asset.id), `FaLeSig${item.asset.id}`);
      } else if (item.kind === 'text') {
        if (!font) font = await doc.embedFont(PDFLib.StandardFonts.Helvetica);
        if (!fontKeys.has(item.page)) fontKeys.set(item.page, page.node.newFontDictionary('FaLeHelv', font.ref));
        const safe = winAnsiSafe(font, item.text);
        lost += safe.lost;
        drawTextBox(PDFLib, page, vp, box, safe.text, { font, fontKey: fontKeys.get(item.page), size: item.fontPt, color: item.color, pad: 2 });
      } else {
        drawMark(PDFLib, page, vp, box, item.kind, item.color);
      }
      await ctx.tick();
    }
    ctx.progress(0.95, { de: 'Wird gespeichert …', en: 'Saving …' });
    const { bytes, protectedAgain } = await saveLikeSource(doc, input);
    const pagesUsed = new Set(S.items.map(i => i.page)).size;
    ctx.note({ de: 'Einfache elektronische Unterschrift: Sie ist fest in die Seite eingebrannt. Für Verträge mit gesetzlicher Schriftform ist eine qualifizierte elektronische Signatur nötig.',
      en: 'Simple electronic signature: it is burned into the page. Contracts that legally require a written form need a qualified electronic signature.' });
    if (lost) ctx.note({ de: 'Einige Zeichen außerhalb des westeuropäischen Zeichensatzes wurden durch „?“ ersetzt.', en: 'Some characters outside the Western European character set were replaced with “?”.' });
    if (protectedAgain) ctx.note({ de: 'Die Datei ist wieder mit demselben Passwort geschützt.', en: 'The file is protected again with the same password.' });
    const suffix = ctx.lang === 'de' ? ' (unterschrieben)' : ' (signed)';
    return { outputs: [{ name: ctx.fileName(input.name, suffix, 'pdf'), blob: pdfBlob(bytes), pages: doc.getPageCount(),
      note: ctx.t({ de: `${S.items.length} Element(e) auf ${pagesUsed} Seite(n)`, en: `${S.items.length} item(s) on ${pagesUsed} page(s)` }) }] };
  },
};

function build(stage, state, L) {
  const bump = () => { state.values.signRev = (state.values.signRev || 0) + 1; renderSummary(); };
  const status = statusLine();
  const sigMod = import('../lib/sec-sig.js');

  // ------------------------------------------------ add chips
  const vpSize = () => S.placer?.viewport || { width: 595, height: 842 };
  const place = (item, { cy = 0.82 } = {}) => {
    item.id = `i${++S.seq}`;
    item.page = S.placer.page;
    item.cx = item.cx ?? 0.62; item.cy = item.cy ?? cy;
    item.rot = 0;
    S.placer.add(item);
    status.set('');
    bump();
  };
  const placeAsset = (asset, kind) => {
    const vp = vpSize();
    let w = kind === 'initials' ? Math.min(70, vp.width * 0.18) : Math.min(190, vp.width * 0.4);
    let h = w * asset.aspect;
    const maxH = kind === 'initials' ? 42 : 80;
    if (h > maxH) { h = maxH; w = h / asset.aspect; }
    place({ kind: 'image', sub: kind, asset, w, h });
  };
  async function create(kind, mode = 'draw') {
    const { createSignature, saveSig } = await sigMod;
    const res = await createSignature({ lang: L, kind, mode });
    if (!res) return;
    const asset = addAsset(res.blob, res.w, res.h, kind);
    if (res.remember) { const ok = await saveSig({ kind, blob: res.blob, w: res.w, h: res.h }); if (ok) renderSaved(); }
    placeAsset(asset, kind);
  }
  const chip = (iconName, text, onclick, primary = false) => el('button', { type: 'button', class: 'sec-chip' + (primary ? ' is-primary' : ''), onclick }, ic(iconName), text);
  const textItem = (text, fontPt = 11) => { const it = { kind: 'text', text, fontPt, color: '#111111' }; sizeText(it); return it; };
  const chips = el('div', { class: 'sec-chips' },
    chip('pen', tr(L, 'Unterschrift', 'Signature'), () => create('signature'), true),
    chip('pen', tr(L, 'Initialen', 'Initials'), () => create('initials')),
    chip('calendar', tr(L, 'Datum', 'Date'), () => place(textItem(today(L)), { cy: 0.88 })),
    chip('type', tr(L, 'Text', 'Text'), () => place(textItem(tr(L, 'Ort, Datum', 'Place, date')), { cy: 0.88 })),
    chip('checkmark', tr(L, 'Haken', 'Check'), () => place({ kind: 'check', w: 18, h: 18, color: '#111111' }, { cy: 0.5 })),
    chip('cross', tr(L, 'Kreuz', 'Cross'), () => place({ kind: 'cross', w: 16, h: 16, color: '#111111' }, { cy: 0.5 })));

  // saved signatures (this device)
  const savedBox = el('div', { class: 'sec-stage', hidden: true });
  async function renderSaved() {
    const { listSigs, deleteSig, clearSigs } = await sigMod;
    const list = await listSigs();
    clear(savedBox);
    savedBox.hidden = !list.length;
    if (!list.length) return;
    const row = el('div', { class: 'sec-saved' });
    for (const s of list) {
      const url = URL.createObjectURL(s.blob);
      const name = tr(L, s.kind === 'initials' ? 'Gespeicherte Initialen' : 'Gespeicherte Unterschrift', s.kind === 'initials' ? 'Saved initials' : 'Saved signature');
      row.append(el('div', { class: 'sec-saved-item' },
        el('button', { type: 'button', class: 'sec-saved-use', aria: { label: tr(L, `${name} einfügen`, `Insert ${name.toLowerCase()}`) }, onclick: () => placeAsset(addAsset(s.blob, s.w, s.h, s.kind), s.kind) }, el('img', { src: url, alt: '' })),
        el('button', { type: 'button', class: 'sec-saved-del', aria: { label: tr(L, `${name} von diesem Gerät löschen`, `Delete ${name.toLowerCase()} from this device`) },
          onclick: async () => { await deleteSig(s.id); URL.revokeObjectURL(url); renderSaved(); } }, el('span', {}, ic('close')))));
    }
    savedBox.append(el('p', { class: 'sec-small' }, tr(L, 'Auf diesem Gerät gemerkt – antippen zum Einfügen:', 'Remembered on this device – tap to insert:')), row,
      btn('trash', tr(L, 'Alle gemerkten löschen', 'Delete all remembered'), async () => { await clearSigs(); renderSaved(); }, { cls: 'wt-btn wt-btn-text wt-btn-sm' }));
  }
  renderSaved();

  // ------------------------------------------------ placer + selection toolbar
  const tb = el('div', { class: 'sec-toolbar', hidden: true });
  const textEdit = el('input', { id: 'sec-sign-text', class: 'wt-input', type: 'text', autocomplete: 'off', maxlength: '120' });
  const textRow = el('div', { class: 'wt-opt', hidden: true }, el('label', { for: 'sec-sign-text' }, tr(L, 'Text', 'Text')), textEdit);
  textEdit.addEventListener('input', () => { const it = S.placer.selected; if (it?.kind === 'text') { it.text = textEdit.value; sizeText(it); S.placer.update(it); bump(); } });
  const allPages = btn('pages', tr(L, 'Auf allen Seiten', 'On all pages'), () => {
    const it = S.placer.selected;
    if (!it) return;
    it.group = it.group || it.id;
    let n = 0;
    for (let p = 1; p <= S.pdf.numPages; p++) {
      if (S.items.some(x => x.group === it.group && x.page === p)) continue;
      S.items.push({ ...it, id: `i${++S.seq}`, page: p });
      n++;
    }
    S.placer.draw();
    bump();
    status.set(tr(L, `Auf ${n} weiteren Seiten eingefügt – an derselben Stelle.`, `Added to ${n} more pages – at the same position.`), 'ok');
  });
  const dup = btn('copy', tr(L, 'Duplizieren', 'Duplicate'), () => { const it = S.placer.selected; if (!it) return; const c = { ...it, id: `i${++S.seq}`, group: null, cy: Math.min(1, it.cy + 0.05) }; S.placer.add(c); bump(); });
  const smaller = btn('', '−', () => { const it = S.placer.selected; if (it) { S.placer.scale(it, 1 / 1.12); bump(); } }, { cls: 'wt-btn wt-btn-quiet wt-btn-sm', label: tr(L, 'Kleiner', 'Smaller') });
  const bigger = btn('plus', '', () => { const it = S.placer.selected; if (it) { S.placer.scale(it, 1.12); bump(); } }, { cls: 'wt-btn wt-btn-quiet wt-btn-sm', label: tr(L, 'Größer', 'Larger') });
  smaller.setAttribute('aria-label', tr(L, 'Kleiner', 'Smaller'));
  const rotL = btn('rotateL', '', () => { const it = S.placer.selected; if (it) { S.placer.rotate(it, -90); bump(); } }, { cls: 'wt-btn wt-btn-quiet wt-btn-sm', label: tr(L, 'Nach links drehen', 'Rotate left') });
  const del = btn('trash', tr(L, 'Löschen', 'Delete'), () => { const it = S.placer.selected; if (it) { S.placer.remove(it); bump(); } });
  tb.append(smaller, bigger, rotL, dup, allPages, del);

  S.placer = createPlacer({
    lang: L, pdf: S.pdf, items: S.items,
    onChange: () => bump(),
    onSelect: it => {
      tb.hidden = !it;
      textRow.hidden = it?.kind !== 'text';
      if (it?.kind === 'text') textEdit.value = it.text;
    },
    label: it => tr(L, KIND_LABEL[it.kind === 'image' ? it.sub : it.kind].de, KIND_LABEL[it.kind === 'image' ? it.sub : it.kind].en),
  });

  const summary = el('p', { class: 'sec-sub', aria: { live: 'polite' } });
  function renderSummary() {
    const n = S.items.length, p = new Set(S.items.map(i => i.page)).size;
    summary.textContent = n ? tr(L, `${n} ${n === 1 ? 'Element' : 'Elemente'} auf ${p} ${p === 1 ? 'Seite' : 'Seiten'}.`, `${n} item${n === 1 ? '' : 's'} on ${p} page${p === 1 ? '' : 's'}.`)
      : tr(L, 'Noch nichts platziert. Tippe auf „Unterschrift“.', 'Nothing placed yet. Tap “Signature”.');
  }
  renderSummary();

  clear(stage).append(
    el('div', { class: 'sec-card' }, el('h3', { class: 'sec-h' }, ic('pen'), tr(L, 'Hinzufügen', 'Add')), chips, savedBox),
    el('div', { class: 'sec-card' }, el('h3', { class: 'sec-h' }, ic('file'), tr(L, 'Platzieren', 'Place')), summary, tb, textRow, S.placer.root),
    status.node,
    el('p', { class: 'sec-info' }, ic('shield'), tr(L,
      'Das ist eine einfache elektronische Unterschrift – wie eine eingescannte Unterschrift. Für die meisten Formulare, Angebote und Bestätigungen reicht sie; wo das Gesetz Schriftform verlangt, braucht es eine qualifizierte Signatur.',
      'This is a simple electronic signature – like a scanned signature. It is fine for most forms, offers and confirmations; where the law requires written form, a qualified signature is needed.')));
  return status;
}
