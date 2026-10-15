// Tool: CV builder (tabellarischer Lebenslauf). Section-by-section editing (accordions, big inputs), entries
// with reorder, section order and visibility, optional photo with circle/rectangle crop (drag + zoom, keyboard
// arrows), skills with levels, languages with CEFR levels, three designs with accent colour, live preview
// (pdf.js), 1–2+ pages auto-flow, Unicode. Opt-in local draft in IndexedDB (deletable), shared with the cover
// letter tool. PDF via lib/tpl-cv.js.
import { el, icon, T, s, form, userError, ensureCss, isoDate, note, entryList, pdfPreview, drafts, local, checkRow } from '../lib/tpl-core.js';
import { cvPdf, newCv, ACCENTS, SECTION_TITLES, SKILL_LEVELS, LANG_LEVELS, visibleSections, loadPhotoSource, cropBox, cropPhoto } from '../lib/tpl-cv.js';
import { missingWarning } from '../lib/unifont.js';

ensureCss();

export const DRAFT_KEY = 'cv';
export const DRAFT_FLAG = 'fale-wt-cv-draft';
let api = null;

export default {
  labels: { back_to_files: { de: 'Zurück zum Lebenslauf', en: 'Back to the CV' } },
  options: [],
  mountStage(stage, state, ctx) { api = cvStage(stage, state, ctx); },
  status(values) {
    const v = values.cv || {};
    const n = visibleSections(v).length;
    const summary = { de: `Lebenslauf · ${{ classic: 'Klassisch', modern: 'Modern', compact: 'Kompakt' }[v.design] || 'Modern'}`, en: `CV · ${{ classic: 'Classic', modern: 'Modern', compact: 'Compact' }[v.design] || 'Modern'}` };
    if (!s(v.name)) return { ok: false, summary, hint: { de: 'Noch nötig: dein Name.', en: 'Still needed: your name.' } };
    if (!n) return { ok: false, summary, hint: { de: 'Noch nötig: mindestens ein Abschnitt mit Inhalt, z. B. Berufserfahrung.', en: 'Still needed: at least one section with content, e.g. work experience.' } };
    return { summary };
  },
  async run(inputs, opts, ctx) {
    const v = opts.cv || {};
    if (!s(v.name)) throw userError('Bitte gib deinen Namen ein.', 'Please enter your name.');
    ctx.progress(0.3, { de: 'PDF wird erstellt …', en: 'Creating PDF …' });
    const { bytes, missing, pages } = await cvPdf(v, ctx.lang, (await api?.photo()) || null);
    const mw = missingWarning(missing);
    if (mw) ctx.note(mw);
    if (pages > 2) ctx.note({ de: `Dein Lebenslauf hat ${pages} Seiten. Üblich sind ein bis zwei – vielleicht passt das Design „Kompakt“ besser.`, en: `Your CV has ${pages} pages. One or two are usual – the “Compact” design might fit better.` });
    ctx.note({ de: 'Tipp: Mit „Bewerbung schreiben“ erstellst du ein passendes Anschreiben im selben Design und fügst danach alles mit deinen Zeugnissen zu einer Bewerbungsmappe zusammen.', en: 'Tip: write a matching cover letter in the same design, then merge everything with your certificates into one application PDF.' });
    const name = ctx.safeFileName(`${ctx.t({ de: 'Lebenslauf', en: 'CV' })} ${s(v.name)}.pdf`);
    return { outputs: [{ name, blob: new Blob([bytes], { type: 'application/pdf' }), pages }] };
  },
};

// ---------------------------------------------------------------- photo cropper
function photoCropper(lang, onChange) {
  const de = lang === 'de';
  let src = null, srcBlob = null, crop = { zoom: 1, cx: 0.5, cy: 0.42 }, shape = 'circle', out = null, outFor = '';
  const canvas = el('canvas', { width: 480, height: 640 });
  const view = el('div', { class: 'tpl-crop', tabindex: '0', role: 'img', dataset: { shape }, aria: { label: T(lang, { de: 'Bildausschnitt – ziehen zum Verschieben, Pfeiltasten zum Verschieben, Plus/Minus zum Zoomen', en: 'Photo crop – drag or use the arrow keys to move, plus/minus to zoom' }) } }, canvas);
  const zoom = el('input', { type: 'range', class: 'tpl-zoom', min: '1', max: '4', step: '0.01', value: '1', aria: { label: T(lang, { de: 'Zoom', en: 'Zoom' }) } });
  const fileIn = el('input', { type: 'file', accept: 'image/*', class: 'tpl-file-input', id: 'tpl-photo-file' });
  const pickBtn = el('label', { for: 'tpl-photo-file', class: 'wt-btn wt-btn-quiet' }, icon('image'), T(lang, { de: 'Foto wählen', en: 'Choose photo' }));
  const rmBtn = el('button', { type: 'button', class: 'wt-btn wt-btn-quiet', hidden: true, onclick: () => { src = null; srcBlob = null; out = null; draw(); onChange(); } }, icon('close'), T(lang, { de: 'Foto entfernen', en: 'Remove photo' }));
  const editor = el('div', { class: 'tpl-photo', hidden: true }, view, el('label', { class: 'img-muted' }, T(lang, { de: 'Zoom', en: 'Zoom' }), zoom));
  const msg = el('p', { class: 'img-muted', role: 'status' });
  const g = canvas.getContext('2d');
  const box = () => cropBox(src, crop, shape);
  function draw() {
    editor.hidden = !src; rmBtn.hidden = !src;
    if (!src) return;
    view.dataset.shape = shape;
    canvas.width = 480; canvas.height = shape === 'circle' ? 480 : 640;
    const b = box();
    g.drawImage(src, b.x, b.y, b.w, b.h, 0, 0, canvas.width, canvas.height);
  }
  let timer = 0;
  const changedSoon = () => { out = null; draw(); clearTimeout(timer); timer = setTimeout(onChange, 150); };
  zoom.addEventListener('input', () => { crop.zoom = +zoom.value; changedSoon(); });
  let drag = null;
  view.addEventListener('pointerdown', e => { if (!src) return; drag = { x: e.clientX, y: e.clientY, cx: crop.cx, cy: crop.cy }; try { view.setPointerCapture(e.pointerId); } catch { /* optional */ } });
  view.addEventListener('pointermove', e => {
    if (!drag) return;
    const r = view.getBoundingClientRect(), b = box();
    crop.cx = Math.min(1, Math.max(0, drag.cx - (e.clientX - drag.x) / r.width * b.w / src.width));
    crop.cy = Math.min(1, Math.max(0, drag.cy - (e.clientY - drag.y) / r.height * b.h / src.height));
    out = null; draw();
  });
  const endDrag = () => { if (drag) { drag = null; changedSoon(); } };
  view.addEventListener('pointerup', endDrag); view.addEventListener('pointercancel', endDrag);
  view.addEventListener('keydown', e => {
    if (!src) return;
    const st = 0.02 / crop.zoom;
    const k = { ArrowLeft: [-st, 0], ArrowRight: [st, 0], ArrowUp: [0, -st], ArrowDown: [0, st] }[e.key];
    if (k) { crop.cx = Math.min(1, Math.max(0, crop.cx + k[0])); crop.cy = Math.min(1, Math.max(0, crop.cy + k[1])); }
    else if (e.key === '+' || e.key === '=') { crop.zoom = Math.min(4, crop.zoom + 0.1); zoom.value = crop.zoom; }
    else if (e.key === '-') { crop.zoom = Math.max(1, crop.zoom - 0.1); zoom.value = crop.zoom; }
    else return;
    e.preventDefault(); changedSoon();
  });
  async function load(blob, c = null) {
    try {
      const cv = await loadPhotoSource(blob);
      src = cv; srcBlob = blob; crop = c || { zoom: 1, cx: 0.5, cy: 0.42 }; zoom.value = String(crop.zoom); out = null;
      msg.textContent = '';
      draw(); onChange();
    } catch (err) {
      console.warn('photo', err);
      msg.textContent = T(lang, { de: 'Dieses Bild kann dein Browser nicht öffnen. Versuch es mit JPG oder PNG.', en: 'Your browser can’t open this image. Try JPG or PNG.' });
    }
  }
  fileIn.addEventListener('change', () => { const f = fileIn.files?.[0]; fileIn.value = ''; if (f) load(f); });
  return {
    root: el('div', {}, el('div', { class: 'tpl-files' }, fileIn, pickBtn, rmBtn), msg, editor,
      el('p', { class: 'img-muted' }, T(lang, { de: 'Ein Foto ist freiwillig. Es bleibt auf deinem Gerät.', en: 'A photo is optional. It stays on your device.' }))),
    setShape(sh) { shape = sh; out = null; draw(); },
    has: () => !!src,
    state: () => (src ? { blob: srcBlob, crop: { ...crop } } : null),
    load,
    /** Cropped photo for the PDF: circle → PNG with transparent corners, rectangle → JPEG. Cached. */
    async export() {
      if (!src) return null;
      const key = JSON.stringify([crop, shape]);
      if (out && outFor === key) return out;
      out = await cropPhoto(src, crop, shape);
      outFor = key;
      return out;
    },
  };
}

// ---------------------------------------------------------------- stage
function cvStage(stage, state, ctx) {
  const lang = ctx.lang, de = lang === 'de';
  const v = (state.values.cv ||= newCv(lang));
  const pv = pdfPreview(lang);
  let saveOn = local.get(DRAFT_FLAG) === 1;
  let saveTimer = 0;
  const draftMsg = el('p', { class: 'img-muted', role: 'status' });
  const saveDraft = () => {
    if (!saveOn) return;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => { drafts.set(DRAFT_KEY, { v: JSON.parse(JSON.stringify(v)), photo: cropper.state(), savedAt: Date.now() }); }, 600);
  };
  const changed = (key) => {
    v.photoRev = (v.photoRev || 0) + (key === 'photo' ? 1 : 0);
    state.results.clear(); ctx.refresh();
    saveDraft();
    pv.schedule(async () => (await cvPdf(v, lang, await cropper.export())).bytes, 600);
  };
  const cropper = photoCropper(lang, () => changed('photo'));
  cropper.setShape(v.photoShape || 'circle');
  const root = el('div', { class: 'tpl-split' });
  const formCol = el('div', {});
  root.append(formCol, el('div', { class: 'tpl-side' }, el('section', { class: 'img-box tpl-sec', aria: { labelledby: 'tpl-h-pv' } }, el('h2', { class: 'img-h', id: 'tpl-h-pv' }, T(lang, { de: 'Vorschau', en: 'Preview' })), pv.root)));
  stage.append(root);

  function build() {
    const f = form(v, lang, changed);
    const acc = (id, title, open, ...kids) => {
      const d = el('details', { class: 'tpl-acc', id: `tpl-acc-${id}`, open }, el('summary', {}, el('span', { class: 'tpl-acc-t' }, T(lang, title))), el('div', { class: 'tpl-acc-body' }, ...kids));
      // phone: one section at a time keeps the page short
      d.addEventListener('toggle', () => { if (d.open && window.matchMedia('(max-width: 719px)').matches) formCol.querySelectorAll('details.tpl-acc[open]').forEach(o => { if (o !== d) o.open = false; }); });
      return d;
    };
    const ph = ph2 => ({ de: ph2[0], en: ph2[1] });
    const entrySec = (id, labels) => entryList({ items: v[id], lang, max: 30, labels: { add: labels.add, item: (i, e) => s(e.role) || s(e.org) || T(lang, labels.item) + ' ' + (i + 1) },
      make: () => ({ from: '', to: '', role: '', org: '', place: '', desc: '' }), onChange: () => changed(id),
      render: (e, i) => f.grid(
        f.field('from', { de: 'Von', en: 'From' }, { obj: e, id: `tpl-${id}-from-${i}`, placeholder: ph(['03/2021', '03/2021']), inputmode: 'numeric' }),
        f.field('to', { de: 'Bis (leer = heute)', en: 'To (empty = today)' }, { obj: e, id: `tpl-${id}-to-${i}`, placeholder: ph(['heute', 'present']) }),
        f.field('role', labels.role, { obj: e, id: `tpl-${id}-role-${i}`, wide: true }), f.field('org', labels.org, { obj: e, id: `tpl-${id}-org-${i}` }),
        f.field('place', { de: 'Ort', en: 'Place' }, { obj: e, id: `tpl-${id}-place-${i}` }),
        f.area('desc', { de: 'Aufgaben / Schwerpunkte (optional)', en: 'Tasks / highlights (optional)' }, { obj: e, id: `tpl-${id}-desc-${i}`, rows: 3, placeholder: { de: '- eine Aufgabe pro Zeile', en: '- one item per line' } })) });
    const skills = entryList({ items: v.skills, lang, max: 30, labels: { add: { de: 'Kenntnis hinzufügen', en: 'Add skill' }, item: (i, e) => s(e.name) || T(lang, { de: `Kenntnis ${i + 1}`, en: `Skill ${i + 1}` }) },
      make: () => ({ name: '', level: '3' }), onChange: () => changed('skills'),
      render: (e, i) => f.grid(f.field('name', { de: 'Kenntnis', en: 'Skill' }, { obj: e, id: `tpl-skills-name-${i}`, placeholder: ph(['z. B. Buchhaltung, Excel (XLSX), Python', 'e.g. accounting, Python']) }),
        f.select('level', { de: 'Niveau', en: 'Level' }, [0, 1, 2, 3, 4, 5].map(n => ({ value: String(n), label: n ? `${n}/5 – ${SKILL_LEVELS[lang][n]}` : T(lang, { de: 'ohne Angabe', en: 'not shown' }) })), { obj: e, id: `tpl-skills-level-${i}` })) });
    const langs = entryList({ items: v.langs, lang, max: 20, labels: { add: { de: 'Sprache hinzufügen', en: 'Add language' }, item: (i, e) => s(e.name) || T(lang, { de: `Sprache ${i + 1}`, en: `Language ${i + 1}` }) },
      make: () => ({ name: '', level: 'B1' }), onChange: () => changed('langs'),
      render: (e, i) => f.grid(f.field('name', { de: 'Sprache', en: 'Language' }, { obj: e, id: `tpl-langs-name-${i}` }),
        f.select('level', { de: 'Niveau (GER)', en: 'Level (CEFR)' }, Object.entries(LANG_LEVELS[lang]).map(([k, l]) => ({ value: k, label: l })), { obj: e, id: `tpl-langs-level-${i}` })) });
    // section order + visibility
    const orderList = el('ol', { class: 'tpl-order' });
    const drawOrder = () => {
      orderList.replaceChildren(...v.order.map((id, i) => {
        const name = T(lang, SECTION_TITLES[id]);
        const mv = d => { const j = i + d; [v.order[i], v.order[j]] = [v.order[j], v.order[i]]; drawOrder(); changed('order'); orderList.children[j]?.querySelector(d < 0 ? '.tpl-up' : '.tpl-down')?.focus(); };
        const b = (ic, lab, fn, dis, cls) => el('button', { type: 'button', class: 'tpl-ib ' + cls, disabled: dis, aria: { label: lab }, title: lab, onclick: fn }, icon(ic));
        const show = el('input', { type: 'checkbox', id: `tpl-show-${id}`, checked: !v.hide?.[id], aria: { label: T(lang, { de: `${name} anzeigen`, en: `Show ${name}` }) }, onchange: e => { v.hide = { ...v.hide, [id]: !e.target.checked }; changed('hide'); } });
        return el('li', {}, el('label', { for: `tpl-show-${id}` }, show), el('span', {}, name),
          b('up', T(lang, { de: `${name} nach oben`, en: `Move ${name} up` }), () => mv(-1), i === 0, 'tpl-up'), b('down', T(lang, { de: `${name} nach unten`, en: `Move ${name} down` }), () => mv(1), i === v.order.length - 1, 'tpl-down'));
      }));
    };
    drawOrder();
    const swatches = el('div', { class: 'tpl-colors', role: 'radiogroup', aria: { label: T(lang, { de: 'Akzentfarbe', en: 'Accent colour' }) } }, ACCENTS.map((c, i) => {
      const inp = el('input', { type: 'radio', name: 'tpl-accent', value: c, checked: v.accent === c, aria: { label: T(lang, { de: `Farbe ${i + 1}`, en: `Colour ${i + 1}` }) }, onchange: () => { v.accent = c; changed('accent'); } });
      const sw = el('span', {}); sw.style.background = c;
      return el('label', { class: 'tpl-swatch' }, inp, sw);
    }));
    const saveBox = checkRow({ id: 'tpl-save', label: { de: 'Entwurf auf diesem Gerät speichern', en: 'Save the draft on this device' }, checked: saveOn, lang,
      hint: { de: 'Speichert deine Angaben und das Foto nur in diesem Browser (IndexedDB), damit du später weitermachen kannst. Ausschalten löscht den Entwurf.', en: 'Keeps your details and photo only in this browser (IndexedDB) so you can continue later. Switching off deletes the draft.' },
      onChange: x => { saveOn = x; local.set(DRAFT_FLAG, x ? 1 : null); if (x) { saveDraft(); draftMsg.textContent = T(lang, { de: 'Entwurf wird auf diesem Gerät gespeichert.', en: 'The draft is saved on this device.' }); } else { drafts.del(DRAFT_KEY); draftMsg.textContent = T(lang, { de: 'Gespeicherter Entwurf gelöscht.', en: 'Saved draft deleted.' }); } } });
    const resetBtn = el('button', { type: 'button', class: 'wt-btn wt-btn-quiet', onclick: () => {
      if (!window.confirm(T(lang, { de: 'Alle Angaben im Formular löschen?', en: 'Clear everything in the form?' }))) return;
      const fresh = newCv(lang); for (const k of Object.keys(v)) delete v[k]; Object.assign(v, fresh);
      rebuild(); changed('reset');
    } }, icon('restart'), T(lang, { de: 'Formular leeren', en: 'Clear form' }));
    formCol.replaceChildren(
      acc('design', { de: '1. Design', en: '1. Design' }, true,
        f.seg('design', { de: 'Design', en: 'Design' }, [{ value: 'classic', label: { de: 'Klassisch', en: 'Classic' } }, { value: 'modern', label: { de: 'Modern', en: 'Modern' } }, { value: 'compact', label: { de: 'Kompakt', en: 'Compact' } }]),
        el('p', { class: 'img-seg-legend' }, T(lang, { de: 'Akzentfarbe', en: 'Accent colour' })), swatches),
      acc('person', { de: '2. Persönliche Angaben', en: '2. Personal details' }, false, f.grid(
        f.field('name', { de: 'Vor- und Nachname', en: 'Full name' }, { autocomplete: 'name', wide: true }), f.field('title', { de: 'Berufsbezeichnung (optional)', en: 'Job title (optional)' }, { wide: true }),
        f.field('street', { de: 'Straße und Hausnummer', en: 'Street and number' }, { autocomplete: 'address-line1' }), f.field('city', { de: 'PLZ und Ort', en: 'Postcode and town' }),
        f.field('phone', { de: 'Telefon', en: 'Phone' }, { type: 'tel', autocomplete: 'tel' }), f.field('email', { de: 'E-Mail', en: 'E-mail' }, { type: 'email', autocomplete: 'email' }),
        f.field('web', { de: 'Website / Profil (optional)', en: 'Website / profile (optional)' }), f.field('birth', { de: 'Geburtsdatum und -ort (optional)', en: 'Date of birth (optional)' }),
        f.field('nationality', { de: 'Staatsangehörigkeit (optional)', en: 'Nationality (optional)' })),
        el('h3', { class: 'img-seg-legend' }, T(lang, { de: 'Foto (optional)', en: 'Photo (optional)' })),
        f.seg('photoShape', { de: 'Zuschnitt', en: 'Shape' }, [{ value: 'circle', label: { de: 'Rund', en: 'Circle' } }, { value: 'rect', label: { de: 'Rechteck (3:4)', en: 'Rectangle (3:4)' } }], { onChange: x => cropper.setShape(x) }),
        cropper.root,
        de ? note('de', 'Angaben wie Foto, Geburtsdatum oder Staatsangehörigkeit sind in Deutschland freiwillig – viele lassen sie weg.') : note('en', 'In many countries a photo, date of birth or nationality is not expected on a CV – leave them out if unsure.')),
      acc('exp', SECTION_TITLES.exp, false, entrySec('exp', { add: { de: 'Station hinzufügen', en: 'Add position' }, item: { de: 'Station', en: 'Position' }, role: { de: 'Position', en: 'Position' }, org: { de: 'Arbeitgeber', en: 'Employer' } }).root),
      acc('edu', SECTION_TITLES.edu, false, entrySec('edu', { add: { de: 'Ausbildung hinzufügen', en: 'Add education' }, item: { de: 'Ausbildung', en: 'Education' }, role: { de: 'Abschluss / Studiengang', en: 'Degree / course' }, org: { de: 'Schule / Hochschule / Betrieb', en: 'School / university' } }).root),
      acc('courses', SECTION_TITLES.courses, false, entrySec('courses', { add: { de: 'Weiterbildung hinzufügen', en: 'Add training' }, item: { de: 'Weiterbildung', en: 'Training' }, role: { de: 'Kurs / Zertifikat', en: 'Course / certificate' }, org: { de: 'Anbieter', en: 'Provider' } }).root),
      acc('skills', SECTION_TITLES.skills, false, skills.root),
      acc('langs', SECTION_TITLES.langs, false, langs.root),
      acc('hobbies', SECTION_TITLES.hobbies, false, f.area('hobbies', { de: 'Interessen und Hobbys (optional)', en: 'Interests (optional)' }, { rows: 2, placeholder: { de: 'z. B. Laufen, Ehrenamt im Sportverein, Fotografie', en: 'e.g. running, volunteering, photography' } })),
      acc('order', { de: 'Reihenfolge und Abschluss', en: 'Order and finish' }, false,
        el('p', { class: 'img-muted' }, T(lang, { de: 'Abschnitte ein-/ausblenden und sortieren. Im Design „Modern“ stehen Kenntnisse, Sprachen und Interessen in der Seitenleiste.', en: 'Show, hide and sort sections. In the “Modern” design, skills, languages and interests go in the sidebar.' })),
        orderList,
        f.check('signLine', { de: 'Ort, Datum und Unterschriftslinie am Ende', en: 'Place, date and signature line at the end' }),
        f.grid(f.field('place', { de: 'Ort', en: 'Place' }), f.field('date', { de: 'Datum', en: 'Date' }, { type: 'date' }))),
      acc('save', { de: 'Entwurf speichern', en: 'Save draft' }, false, saveBox, draftMsg, el('div', { class: 'img-btn-row' }, resetBtn)));
  }
  function rebuild() { build(); }
  build();
  // restore an opt-in draft
  if (saveOn) {
    drafts.get(DRAFT_KEY).then(async d => {
      if (!d || !d.v) return;
      for (const k of Object.keys(v)) delete v[k];
      Object.assign(v, newCv(lang), d.v);
      if (d.photo?.blob) await cropper.load(d.photo.blob, d.photo.crop);
      cropper.setShape(v.photoShape || 'circle');
      rebuild();
      draftMsg.textContent = T(lang, { de: 'Gespeicherter Entwurf geladen.', en: 'Saved draft loaded.' });
      changed('restore');
    });
  }
  if (!v.date) v.date = isoDate();
  changed('init');
  return { photo: () => cropper.export() };
}
