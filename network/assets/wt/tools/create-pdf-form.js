// Tool: create a fillable PDF form. Place real AcroForm fields on any PDF – text, multi-line text, check box,
// option group, drop-down list, date and signature field – by tapping a chip and dragging/resizing on the page,
// or let "Felder erkennen" find them (underlines, "Label:" gaps, drawn boxes and lines, ☐ glyphs).
// Field detection and the writer are the app's own code (js/tools/formfields.js → lib/shared/formfields.js).
// Everything runs in the browser; nothing is uploaded.
import { el, clear } from '../lib/dom.js';
import { loadPdfLib, loadPdfjs } from '../lib/pdf.js';
import { ensureCss, tr, ic, btn, userError, guardPrimary, statusLine, saveLikeSource, pdfBlob, watchUnlock } from '../lib/sec-ui.js';
import { createPlacer } from '../lib/sec-placer.js';

const TYPES = [
  { id: 'text', icon: 'textbox', w: 170, h: 22, de: 'Textfeld', en: 'Text field' },
  { id: 'multiline', icon: 'textarea', w: 240, h: 72, de: 'Mehrzeilig', en: 'Multi-line', nameDe: 'Textbereich', nameEn: 'Text area' },
  { id: 'check', icon: 'checkmark', w: 14, h: 14, de: 'Kästchen', en: 'Check box', nameDe: 'Kontrollkästchen', nameEn: 'Check box' },
  { id: 'radio', icon: 'radio', w: 130, h: 57, de: 'Optionen', en: 'Options', nameDe: 'Auswahl', nameEn: 'Choice' },
  { id: 'dropdown', icon: 'dropdown', w: 150, h: 22, de: 'Auswahlliste', en: 'Drop-down', nameDe: 'Auswahlliste', nameEn: 'Drop-down' },
  { id: 'date', icon: 'calendar', w: 100, h: 22, de: 'Datum', en: 'Date' },
  { id: 'sign', icon: 'pen', w: 190, h: 46, de: 'Unterschrift', en: 'Signature' },
];
const TYPE = Object.fromEntries(TYPES.map(t => [t.id, t]));
const RADIO_ROW = 19;
const S = { inputId: null, pdf: null, items: [], seq: 0, placer: null, existing: [] };

const baseName = (t, L) => (L === 'de' ? t.nameDe || t.de : t.nameEn || t.en);
const defaultOptions = (L, type) => (type === 'radio' ? (L === 'de' ? ['Ja', 'Nein', 'Weiß nicht'] : ['Yes', 'No', 'Not sure']) : (L === 'de' ? ['Option 1', 'Option 2', 'Option 3'] : ['Option 1', 'Option 2', 'Option 3']));
const cleanName = s => String(s || '').replace(/[.\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);

/** Unique field names – within the new fields and against the fields the PDF already has (pdf-lib refuses duplicates). */
export function uniqueNames(fields, taken = []) {
  const used = new Set(taken.map(n => n.toLowerCase()));
  for (const f of fields) {
    const base = cleanName(f.name) || 'Feld';
    let name = base, i = 2;
    while (used.has(name.toLowerCase())) name = `${base} ${i++}`;
    f.name = name;
    used.add(name.toLowerCase());
  }
  return fields;
}

export default {
  options: [],
  labels: { back_to_files: { de: 'Zurück zum Formular', en: 'Back to the form' } },

  mountStage(stage, state, ctx) {
    ensureCss();
    stage.classList.add('sec-stage');
    this._stage = stage; this._state = state; this._lang = ctx.lang;
    guardPrimary(stage, state, () => (S.items.length ? '' : tr(ctx.lang, 'Setz zuerst mindestens ein Feld auf die Seite – oder lass Felder erkennen.', 'First place at least one field on the page – or let fields be detected.')),
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
    // fields the PDF already has (kept unchanged; their names must not be reused)
    const existing = [];
    try {
      for (let n = 1; n <= pdf.numPages; n++) {
        const annots = await (await pdf.getPage(n)).getAnnotations({ intent: 'display' });
        annots.filter(a => a.subtype === 'Widget' && a.fieldName).forEach(a => existing.push(a.fieldName));
      }
    } catch { /* no annotations */ }
    this._loading = null;
    S.placer?.destroy();
    S.inputId = input.id; S.pdf = pdf; S.items.length = 0; S.existing = [...new Set(existing)];
    this._status = build(stage, this._state, this._lang);
  },

  async run(inputs, opts, ctx) {
    const input = inputs[0];
    if (!S.items.length || S.inputId !== input.id) throw userError('Setz zuerst mindestens ein Feld auf die Seite.', 'Place at least one field on the page first.');
    const PDFLib = await loadPdfLib();
    const { writeFields } = await import('../lib/shared/formfields.js');
    ctx.progress(0.2, { de: 'Felder werden angelegt …', en: 'Creating fields …' });
    const doc = await input.pdfDoc();
    const pdf = await input.pdfjs();
    const pageInfos = [];
    for (let n = 1; n <= pdf.numPages; n++) { const page = await pdf.getPage(n); pageInfos.push({ page: { rotate: page.rotate }, base: page.getViewport({ scale: 1 }) }); }
    let taken = [];
    try { taken = doc.getForm().getFields().map(f => f.getName()); } catch { taken = [...S.existing]; }
    const fields = uniqueNames(S.items.map(it => {
      const vp = pageInfos[it.page - 1].base;
      return { type: it.type, page: it.page, x: it.cx * vp.width - it.w / 2, y: it.cy * vp.height - it.h / 2, w: it.w, h: it.h, name: it.name,
        required: !!it.required, def: it.def, options: it.options, editable: !!it.editable, maxLen: it.maxLen || 0, fontSize: it.fontSize || 0, tip: it.tip };
    }), taken);
    await writeFields(PDFLib, doc, fields, pageInfos, ctx.lang === 'de' ? {} : { dateTip: 'Date (DD.MM.YYYY)' });
    ctx.progress(0.9, { de: 'Wird gespeichert …', en: 'Saving …' });
    const { bytes, protectedAgain } = await saveLikeSource(doc, input);
    const renamed = fields.filter((f, i) => f.name !== (cleanName(S.items[i].name) || 'Feld'));
    if (renamed.length) ctx.note({ de: `${renamed.length} Feldname(n) kamen doppelt vor und wurden durchnummeriert, z. B. „${renamed[0].name}“.`, en: `${renamed.length} field name(s) were used twice and got a number, e.g. “${renamed[0].name}”.` });
    if (S.existing.length) ctx.note({ de: `Die ${S.existing.length} Felder, die die PDF schon hatte, sind unverändert geblieben.`, en: `The ${S.existing.length} fields the PDF already had are unchanged.` });
    if (protectedAgain) ctx.note({ de: 'Die Datei ist wieder mit demselben Passwort geschützt.', en: 'The file is protected again with the same password.' });
    ctx.note({ de: 'Die Felder lassen sich in jedem PDF-Programm ausfüllen – am Computer, auf dem Handy oder hier mit „PDF-Formular ausfüllen“.', en: 'The fields can be filled in with any PDF app – on a computer, on a phone or here with “Fill PDF form”.' });
    const suffix = ctx.lang === 'de' ? ' (Formular)' : ' (form)';
    const pagesUsed = new Set(S.items.map(i => i.page)).size;
    return { outputs: [{ name: ctx.fileName(input.name, suffix, 'pdf'), blob: pdfBlob(bytes), pages: doc.getPageCount(),
      note: ctx.t({ de: `${fields.length} ${fields.length === 1 ? 'Feld' : 'Felder'} auf ${pagesUsed} ${pagesUsed === 1 ? 'Seite' : 'Seiten'}`, en: `${fields.length} field${fields.length === 1 ? '' : 's'} on ${pagesUsed} page${pagesUsed === 1 ? '' : 's'}` }) }] };
  },
};

function build(stage, state, L) {
  const bump = () => { state.values.formRev = (state.values.formRev || 0) + 1; renderSummary(); renderList(); };
  const status = statusLine();
  const typeLabel = t => tr(L, TYPE[t].de, TYPE[t].en);
  const nextName = type => {
    const base = baseName(TYPE[type], L);
    const n = S.items.filter(i => i.type === type).length + 1;
    return n === 1 && type !== 'text' ? base : `${base} ${n}`;
  };

  // ------------------------------------------------ add chips
  function add(type, at = null) {
    const t = TYPE[type];
    const item = { id: `f${++S.seq}`, kind: 'field', free: true, type, page: S.placer.page, w: t.w, h: t.h, rot: 0, name: nextName(type), required: false,
      def: type === 'check' ? false : '', options: type === 'radio' || type === 'dropdown' ? defaultOptions(L, type) : [], cx: 0.5, cy: 0.3 + (S.items.filter(i => i.page === S.placer.page).length % 8) * 0.07 };
    if (at) Object.assign(item, at);
    S.placer.add(item);
    status.set('');
    bump();
    return item;
  }
  const chip = (t) => el('button', { type: 'button', class: 'sec-chip', dataset: { ftype: t.id }, onclick: () => add(t.id) }, ic(t.icon), tr(L, t.de, t.en));
  const chips = el('div', { class: 'sec-chips' }, TYPES.map(chip));
  const detectBtn = btn('wand', tr(L, 'Felder automatisch erkennen', 'Detect fields automatically'), () => detect(), { cls: 'wt-btn wt-btn-quiet' });
  detectBtn.dataset.detect = '';

  async function detect() {
    detectBtn.disabled = true;
    status.set(tr(L, 'Suche nach Linien, Kästchen und „Name: ____“ …', 'Looking for lines, boxes and “Name: ____” …'));
    try {
      const [{ detectFields, overlap }, geom, lib] = await Promise.all([import('../lib/shared/formfields.js'), import('../lib/shared/pagegeom.js'), loadPdfjs()]);
      geom.setPdfjs(lib);
      const names = L === 'de' ? {} : { text: 'Text field', multiline: 'Text area', check: 'Check box', sign: 'Signature' };
      let found = 0;
      for (let n = 1; n <= S.pdf.numPages; n++) {
        const page = await S.pdf.getPage(n);
        const base = page.getViewport({ scale: 1 });
        const mine = S.items.filter(i => i.page === n).map(i => ({ x: i.cx * base.width - i.w / 2, y: i.cy * base.height - i.h / 2, w: i.w, h: i.h }));
        const c = await detectFields(page, base, { shapes: geom.pageShapes, names });
        for (const f of c) {
          if (mine.some(m => overlap(m, f) > 0.25)) continue;
          S.items.push({ id: `f${++S.seq}`, kind: 'field', free: true, type: f.type, page: n, cx: (f.x + f.w / 2) / base.width, cy: (f.y + f.h / 2) / base.height,
            w: f.w, h: f.h, rot: 0, name: f.name, required: false, def: f.type === 'check' ? false : '', options: [], auto: true });
          found++;
        }
        page.cleanup?.();
      }
      S.placer.draw();
      bump();
      status.set(found ? tr(L, `${found} ${found === 1 ? 'Feld' : 'Felder'} erkannt. Prüf sie kurz – antippen zum Ändern, Löschen oder Umbenennen.`, `${found} field${found === 1 ? '' : 's'} detected. Check them quickly – tap to change, delete or rename.`)
        : tr(L, 'Keine Felder erkannt. Setz die Felder einfach selbst – tipp oben auf einen Feldtyp.', 'No fields detected. Just place them yourself – tap a field type above.'), found ? 'ok' : '');
    } catch (e) {
      console.warn('detect', e);
      status.set(tr(L, 'Die Erkennung hat nicht geklappt. Setz die Felder selbst.', 'Detection did not work. Place the fields yourself.'), 'error');
    } finally { detectBtn.disabled = false; }
  }

  // ------------------------------------------------ properties of the selected field
  const props = el('div', { class: 'sec-card', hidden: true });
  let propSeq = 0;
  function field(labelText, input, hint = null) {
    const id = input.id || `sec-cf-${++propSeq}`;
    input.id = id;
    return el('div', { class: 'wt-opt' }, el('label', { for: id }, labelText), input, hint ? el('p', { class: 'wt-opt-hint' }, hint) : null);
  }
  function renderProps(it) {
    clear(props);
    props.hidden = !it;
    if (!it) return;
    const changed = () => { S.placer.update(it); bump(); };
    const name = el('input', { class: 'wt-input', id: 'sec-cf-name', type: 'text', maxlength: '80', value: it.name, autocomplete: 'off' });
    name.addEventListener('input', () => {
      it.name = name.value;
      const lab = S.placer.root.querySelector('.sec-item.is-sel .sec-fld-name');
      if (lab) lab.textContent = it.name;
      renderList();
    });
    name.addEventListener('change', () => { it.name = cleanName(name.value) || it.name; name.value = it.name; changed(); });
    const typeSel = el('select', { class: 'wt-input', id: 'sec-cf-type' }, TYPES.map(t => el('option', { value: t.id, selected: t.id === it.type }, tr(L, t.de, t.en))));
    typeSel.addEventListener('change', () => {
      const t = TYPE[typeSel.value];
      it.type = t.id;
      if ((t.id === 'radio' || t.id === 'dropdown') && !it.options?.length) it.options = defaultOptions(L, t.id);
      if (t.id === 'check') { it.w = it.h = Math.min(it.w, it.h, 18); it.def = false; } else if (typeof it.def === 'boolean') it.def = '';
      if (t.id === 'radio') it.h = Math.max(it.h, it.options.length * RADIO_ROW);
      S.placer.draw(); S.placer.select(it); changed(); renderProps(it);
    });
    const req = el('input', { type: 'checkbox', id: 'sec-cf-req', checked: !!it.required, onchange: () => { it.required = req.checked; changed(); } });
    const grid = el('div', { class: 'sec-fld-props' }, field(tr(L, 'Feldname', 'Field name'), name, tr(L, 'Erscheint beim Ausfüllen als Hinweis und beim Auslesen der Daten.', 'Shown as a hint when filling in and when reading out the data.')),
      field(tr(L, 'Feldtyp', 'Field type'), typeSel));
    if (it.type === 'radio' || it.type === 'dropdown') {
      const opts = el('textarea', { class: 'wt-input', id: 'sec-cf-opts', rows: '4' });
      opts.value = (it.options || []).join('\n');
      opts.addEventListener('input', () => {
        it.options = [...new Set(opts.value.split('\n').map(s => s.trim()).filter(Boolean))].slice(0, 40);
        if (it.type === 'radio') { it.h = Math.max(RADIO_ROW, it.options.length * RADIO_ROW); }
        changed();
      });
      grid.append(field(tr(L, 'Auswahlmöglichkeiten (eine pro Zeile)', 'Choices (one per line)'), opts));
      if (it.type === 'dropdown') {
        const ed = el('input', { type: 'checkbox', id: 'sec-cf-edit', checked: !!it.editable, onchange: () => { it.editable = ed.checked; changed(); } });
        grid.append(el('label', { class: 'sec-check', for: 'sec-cf-edit' }, ed, el('span', {}, tr(L, 'Eigene Eingabe erlauben', 'Allow own entry'))));
      }
    }
    if (it.type === 'check') {
      const def = el('input', { type: 'checkbox', id: 'sec-cf-def', checked: !!it.def, onchange: () => { it.def = def.checked; changed(); } });
      grid.append(el('label', { class: 'sec-check', for: 'sec-cf-def' }, def, el('span', {}, tr(L, 'Schon angekreuzt', 'Ticked by default'))));
    } else if (it.type !== 'sign') {
      const def = el('input', { class: 'wt-input', id: 'sec-cf-def', type: 'text', maxlength: '200', value: it.def || '', autocomplete: 'off' });
      def.addEventListener('input', () => { it.def = def.value; changed(); });
      grid.append(field(tr(L, 'Vorausgefüllter Wert (optional)', 'Prefilled value (optional)'), def));
    }
    if (it.type === 'text' || it.type === 'multiline') {
      const max = el('input', { class: 'wt-input', id: 'sec-cf-max', type: 'number', min: '0', max: '9999', inputmode: 'numeric', value: it.maxLen || '' });
      max.addEventListener('input', () => { it.maxLen = Math.max(0, Math.min(9999, parseInt(max.value, 10) || 0)); changed(); });
      grid.append(field(tr(L, 'Höchstens Zeichen (leer = beliebig)', 'Max. characters (empty = any)'), max));
    }
    if (['text', 'multiline', 'dropdown', 'date'].includes(it.type)) {
      const fs = el('select', { class: 'wt-input', id: 'sec-cf-size' }, [0, 8, 9, 10, 11, 12, 14].map(v => el('option', { value: String(v), selected: (it.fontSize || 0) === v }, v ? `${v} pt` : tr(L, 'Automatisch', 'Automatic'))));
      fs.addEventListener('change', () => { it.fontSize = +fs.value; changed(); });
      grid.append(field(tr(L, 'Schriftgröße', 'Font size'), fs));
    }
    const tip = el('input', { class: 'wt-input', id: 'sec-cf-tip', type: 'text', maxlength: '160', value: it.tip || '', autocomplete: 'off', placeholder: tr(L, 'z. B. Bitte in Druckbuchstaben', 'e.g. Please use capital letters') });
    tip.addEventListener('input', () => { it.tip = tip.value; changed(); });
    grid.append(field(tr(L, 'Hilfetext beim Ausfüllen (optional)', 'Help text when filling in (optional)'), tip));
    grid.append(el('label', { class: 'sec-check', for: 'sec-cf-req' }, req, el('span', {}, tr(L, 'Pflichtfeld', 'Required field'))));
    const tb = el('div', { class: 'sec-toolbar' },
      btn('copy', tr(L, 'Duplizieren', 'Duplicate'), () => {
        const c = { ...it, id: `f${++S.seq}`, options: [...(it.options || [])], cy: Math.min(1, it.cy + (it.h + 8) / (S.placer.viewport?.height || 842)), name: nextName(it.type), auto: false };
        S.placer.add(c); bump();
      }),
      btn('trash', tr(L, 'Löschen', 'Delete'), () => { S.placer.remove(it); bump(); }));
    props.append(el('h3', { class: 'sec-h' }, ic(TYPE[it.type].icon), tr(L, `${typeLabel(it.type)} bearbeiten`, `Edit ${typeLabel(it.type).toLowerCase()}`)), grid, tb);
  }

  // ------------------------------------------------ placer
  S.placer = createPlacer({
    lang: L, pdf: S.pdf, items: S.items,
    onChange: () => bump(),
    onSelect: it => renderProps(it),
    label: it => `${typeLabel(it.type)} „${it.name}“`,
    hint: tr(L, 'Antippen zum Bearbeiten · ziehen zum Verschieben · Ecke unten rechts ändert Breite und Höhe · Pfeiltasten und Entf gehen auch',
      'Tap to edit · drag to move · bottom-right corner changes width and height · arrow keys and Delete work too'),
  });

  // ------------------------------------------------ list of all fields
  const listBox = el('details', { class: 'sec-card sec-fld-all' });
  const listUl = el('ul', { class: 'sec-fld-list' });
  const listSum = el('summary', {});
  listBox.append(listSum, listUl);
  function renderList() {
    listSum.textContent = tr(L, `Alle Felder (${S.items.length})`, `All fields (${S.items.length})`);
    listBox.hidden = !S.items.length;
    clear(listUl);
    [...S.items].sort((a, b) => a.page - b.page || a.cy - b.cy || a.cx - b.cx).forEach(it => {
      listUl.append(el('li', {}, el('button', { type: 'button', class: 'wt-btn wt-btn-text wt-btn-sm', onclick: () => {
        if (S.placer.page !== it.page) S.placer.nav.go(it.page);
        setTimeout(() => { S.placer.select(it); S.placer.root.querySelector('.sec-item.is-sel')?.focus({ preventScroll: false }); }, S.placer.page === it.page ? 0 : 350);
      } }, ic(TYPE[it.type].icon), `${it.name} · ${typeLabel(it.type)} · ${tr(L, 'Seite', 'page')} ${it.page}${it.required ? ' · ' + tr(L, 'Pflicht', 'required') : ''}`)));
    });
  }

  const summary = el('p', { class: 'sec-sub', aria: { live: 'polite' } });
  function renderSummary() {
    const n = S.items.length, p = new Set(S.items.map(i => i.page)).size;
    summary.textContent = n ? tr(L, `${n} ${n === 1 ? 'Feld' : 'Felder'} auf ${p} ${p === 1 ? 'Seite' : 'Seiten'}. Ziehen zum Verschieben, Ecke unten rechts für die Größe.`, `${n} field${n === 1 ? '' : 's'} on ${p} page${p === 1 ? '' : 's'}. Drag to move, bottom-right corner to resize.`)
      : tr(L, 'Noch keine Felder. Tippe auf einen Feldtyp oder lass Felder erkennen.', 'No fields yet. Tap a field type or let fields be detected.');
  }
  renderSummary(); renderList();

  clear(stage).append(
    el('div', { class: 'sec-card' }, el('h3', { class: 'sec-h' }, ic('form'), tr(L, 'Feld hinzufügen', 'Add a field')), chips,
      el('div', { class: 'sec-toolbar sec-toolbar-start' }, detectBtn),
      S.existing.length ? el('p', { class: 'sec-small' }, tr(L, `Diese PDF hat schon ${S.existing.length} Formularfelder – sie bleiben erhalten.`, `This PDF already has ${S.existing.length} form fields – they are kept.`)) : null),
    el('div', { class: 'sec-card' }, el('h3', { class: 'sec-h' }, ic('file'), tr(L, 'Platzieren', 'Place')), summary, S.placer.root),
    props, listBox, status.node,
    el('p', { class: 'sec-info' }, ic('shield'), tr(L,
      'Es entstehen echte PDF-Formularfelder: Wer die Datei öffnet, kann sie am Computer oder Handy ausfüllen, speichern und ausdrucken. Deine PDF wird nicht hochgeladen.',
      'This creates real PDF form fields: anyone who opens the file can fill it in on a computer or phone, save and print it. Your PDF is not uploaded.')));
  return status;
}
