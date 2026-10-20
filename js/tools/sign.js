// Tool: fill forms & sign — AcroForm fields, free text, date, drawn signatures.
import * as db from '../db.js';
import { icon } from '../icons.js';
import { $, $$, h, esc, toast, errorToast, progress, openDialog, baseName, UserError, showMenu } from '../ui.js';
import { resultCard } from '../components.js';
import { getDocBytes, saveResult } from '../library.js';
import { loadPdf, renderPage } from '../pdfcore.js';
import { loadEditable, loadPdfLib, saveDoc } from '../pdflib.js';
import { updateFoot, ensureCss, hexToRgb } from './common.js';
import { pickAsset } from './sigstore.js';
import { needsUnicode, uniFont, drawTextImage } from '../office/unifont.js';
import { locale } from '../i18n/index.js'; // the date is written in the user's own format

const trackStat = (e, n = 1) => { import('../extras/stats.js').then(m => m.track(e, n)).catch(() => {}); };
import { matchProfile, profileMenuItems } from './profilefill.js';

const BASELINE = 0.946; // baseline offset (em) for Helvetica/Arial with line-height 1.2
/** Check mark / cross / dot for paper forms (drawn the same way in the PDF, see build()). */
const markSvg = sym => `<svg class="mk" data-sym="${sym}" viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="3.1" stroke-linecap="round" stroke-linejoin="round">${
  sym === 'cross' ? '<path d="M4.3 4.3l15.4 15.4M19.7 4.3L4.3 19.7"/>' : sym === 'dot' ? '<circle cx="12" cy="12" r="7.2" fill="currentColor" stroke="none"/>' : '<path d="M3.4 13.2l6.2 6 11-14.4"/>'}</svg>`;
const today = () => new Date().toLocaleDateString(locale(), { day: '2-digit', month: '2-digit', year: 'numeric' });

export async function mount(screen, { docId, params }) {
  const doc = await db.getDoc(docId);
  if (!doc) { screen.body.innerHTML = '<p class="panel-empty">Dokument nicht gefunden.</p>'; return; }
  screen.setTitle('Ausfüllen & unterschreiben', doc.name);
  await ensureCss();
  const bytes = await getDocBytes(docId);
  // optional personal profile (module provided by the app shell; hidden when missing/empty)
  let profile = null;
  try { const pm = await import('../extras/profile.js'); profile = pm && pm.getProfile ? await pm.getProfile() : null; } catch { profile = null; }
  if (profile && !Object.values(profile).some(v => typeof v === 'string' && v.trim())) profile = null;
  const { pdf } = await loadPdf(bytes.slice(), { name: doc.name, key: docId });
  // XFA-only authority form: here only its placeholder page exists, and saving would drop the form –
  // send the user to the form screen (fill in there, save "Als normale PDF", then sign that copy here)
  const { xfaKind } = await import('./xfaform.js');
  if (await xfaKind(pdf) === 'pure') {
    pdf.destroy();
    screen.body.innerHTML = `<div class="screen-inner"><div class="card xfa-info">${icon('form')}<div>
      <h2>Das ist ein Behörden-Formular</h2>
      <p>Es lässt sich nur im Formular-Bereich ausfüllen. Zum Unterschreiben: dort ausfüllen, „Als normale PDF“ speichern und die neue Datei hier öffnen.</p>
      <a class="btn btn-primary" href="#/werkzeug/behoerdenformular?doc=${esc(docId)}">${icon('form')} Formular ausfüllen</a></div></div></div>`;
    return;
  }
  let alive = true;

  // ---- form fields (pdf-lib) ----
  const PDFLib = await loadPdfLib();
  let fields = [];
  try {
    const probe = await loadEditable(bytes, doc.name, { key: docId });
    const form = probe.getForm();
    for (const f of form.getFields()) {
      const name = f.getName();
      let type = null, value = null, options = null;
      let label = '';
      try { const tu = f.acroField.dict.lookup(PDFLib.PDFName.of('TU')); if (tu && tu.decodeText) label = tu.decodeText(); } catch {}
      if (f instanceof PDFLib.PDFSignature) { fields.push({ name, type: 'sig', value: null, initial: null, options: null, readOnly: false, label }); continue; }
      if (f instanceof PDFLib.PDFTextField) { type = 'text'; value = f.getText() || ''; }
      else if (f instanceof PDFLib.PDFCheckBox) { type = 'check'; value = f.isChecked(); }
      else if (f instanceof PDFLib.PDFRadioGroup) { type = 'radio'; options = f.getOptions(); value = f.getSelected() || ''; }
      else if (f instanceof PDFLib.PDFDropdown) { type = 'select'; options = f.getOptions(); value = (f.getSelected() || [])[0] || ''; }
      else if (f instanceof PDFLib.PDFOptionList) { type = 'select'; options = f.getOptions(); value = (f.getSelected() || [])[0] || ''; }
      if (!type) continue;
      fields.push({ name, type, value, initial: value, options, readOnly: f.isReadOnly(), label });
    }
  } catch (e) { if (e instanceof UserError) throw e; console.warn('form probe', e); fields = []; }

  // ---- layout ----
  screen.body.style.cssText = 'display:flex;flex-direction:column;overflow:hidden';
  const tools = h(`<div class="sign-tools" role="toolbar" aria-label="Einfügen">
    ${fields.length ? `<button class="btn btn-ghost btn-sm" type="button" data-mode="form" aria-pressed="false">${icon('form')} Formular (${fields.length})</button>` : ''}
    <button class="btn btn-ghost btn-sm" type="button" data-mode="sign" aria-pressed="false">${icon('sign')} Unterschrift</button>
    <button class="btn btn-ghost btn-sm" type="button" data-mode="text" aria-pressed="false">${icon('text')} Text</button>
    <button class="btn btn-ghost btn-sm" type="button" data-mode="mark" aria-pressed="false">${icon('check')} Häkchen</button>
    <button class="btn btn-ghost btn-sm" type="button" data-mode="date" aria-pressed="false">${icon('calendar')} Datum</button>
    <button class="btn btn-ghost btn-sm" type="button" data-mode="initials" aria-pressed="false">${icon('pen')} Initialen</button>
    <button class="btn btn-ghost btn-sm" type="button" data-mode="stamp" aria-pressed="false">${icon('stamp')} Stempel</button>
    ${profile ? `<button class="btn btn-ghost btn-sm" type="button" data-mode="profile" aria-pressed="false">${icon('contact')} Aus meinem Profil</button>` : ''}
    <span class="sign-hint" data-hint aria-live="polite">${fields.length ? 'Fülle die Formularfelder aus oder füge Text und Unterschrift ein.' : 'Wähle ein Werkzeug und tippe auf die Seite.'}</span></div>`);
  const layout = h(`<div class="sign-layout"><div class="sign-stage" data-stage><div class="sign-pages" data-pages></div></div></div>`);
  // one bar at the bottom for everything about the selected item (big buttons instead of tiny handles on the page)
  const bar = h(`<div class="sign-bar" data-bar hidden role="region" aria-label="Auswahl bearbeiten"></div>`);
  screen.body.append(tools, layout, bar);
  const stage = $('[data-stage]', layout);
  const pagesBox = $('[data-pages]', layout);
  const hint = $('[data-hint]', tools);

  let panel = null;
  if (fields.length) {
    panel = h(`<aside class="form-panel" aria-label="Formularfelder"><div style="display:flex;justify-content:space-between;align-items:center;gap:8px">
      <h2>Formularfelder</h2><button class="icon-btn only-mobile" type="button" data-close aria-label="Schließen">${icon('close')}</button></div>
      <div data-autofill></div>
      <label class="check sign-flatten"><input type="checkbox" data-flatten checked><span>Felder beim Speichern fixieren (nicht mehr änderbar)</span></label>
      <div data-fields></div></aside>`);
    layout.appendChild(panel);
    const fbox = $('[data-fields]', panel);
    fields.forEach((f, i) => {
      const id = `ff-${i}`;
      let ctl;
      if (f.type === 'sig') ctl = `<div class="field"><span class="field-label">${esc(f.label || f.name)}</span><button class="btn btn-soft btn-sm" type="button" data-sigfield="${i}">${icon('sign')} Hier unterschreiben</button></div>`;
      else if (f.type === 'text') ctl = `<label class="field"><span class="field-label">${esc(f.name)}</span><input class="input" id="${id}" data-fi="${i}" value="${esc(f.value)}" ${f.readOnly ? 'disabled' : ''}></label>`;
      else if (f.type === 'check') ctl = `<label class="check"><input type="checkbox" id="${id}" data-fi="${i}" ${f.value ? 'checked' : ''} ${f.readOnly ? 'disabled' : ''}><span>${esc(f.name)}</span></label>`;
      else ctl = `<label class="field"><span class="field-label">${esc(f.name)}</span><select class="select" id="${id}" data-fi="${i}" ${f.readOnly ? 'disabled' : ''}>
          <option value="">– bitte wählen –</option>${f.options.map(o => `<option ${o === f.value ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select></label>`;
      fbox.insertAdjacentHTML('beforeend', ctl);
      if (f.type === 'text' && profile && !f.readOnly) {
        const m = matchProfile(f.name, f.label, profile, fields.map(x => x.name));
        if (m) {
          f.profileValue = m.value;
          fbox.lastElementChild.insertAdjacentHTML('beforeend', `<button type="button" class="sign-prof" data-prof="${i}" title="Aus meinem Profil: ${esc(m.label)}">${icon('contact')}<span>${esc(m.value)}</span></button>`);
        }
      }
    });
    fbox.addEventListener('click', e => {
      const pb = e.target.closest('[data-prof]');
      if (pb) {
        const f = fields[+pb.dataset.prof];
        setFieldValue(f, f.profileValue);
        return;
      }
      const sb = e.target.closest('[data-sigfield]');
      if (sb) signField(fields[+sb.dataset.sigfield]);
    });
    const matched = fields.filter(f => f.profileValue != null);
    if (matched.length) {
      const af = h(`<button class="btn btn-primary btn-sm btn-block sign-autofill" type="button">${icon('magic')} Formular automatisch ausfüllen (${matched.length})</button>`);
      af.addEventListener('click', () => {
        let n = 0;
        matched.forEach(f => { if (f.value !== f.profileValue) { setFieldValue(f, f.profileValue); n++; } });
        toast(n ? `${n} Feld${n === 1 ? '' : 'er'} aus deinem Profil ausgefüllt – bitte prüfen.` : 'Die Felder enthalten bereits deine Profildaten.', n ? 'success' : 'info', { timeout: 4500 });
      });
      $('[data-autofill]', panel).appendChild(af);
      $('[data-autofill]', panel).appendChild(h('<p class="hint" style="margin:6px 0 12px">Werte aus deinem Profil werden nur eingetragen – du prüfst sie vor dem Speichern.</p>'));
    }
    fbox.addEventListener('input', e => {
      const i = e.target.dataset.fi;
      if (i == null) return;
      const f = fields[+i];
      f.value = f.type === 'check' ? e.target.checked : e.target.value;
      updateFieldOverlays(f.name);
      markDirty();
    });
    fbox.addEventListener('focusin', e => { const i = e.target.dataset.fi; if (i != null) focusWidget(fields[+i].name); });
    $('[data-close]', panel).addEventListener('click', () => panel.classList.remove('open'));
  }

  // ---- pages ----
  const pageInfo = []; // {num, base (viewport @1), el, layer, canvasDone, widgets}
  let scale = 1;
  const items = [];
  let mode = null;
  let pendingSig = null; // {url, blob, w, h}
  let pendingText = null; // profile value {label, value}
  let selected = null;
  let dirty = false;
  let rev = 0, savedRev = -1; // see markDirty()

  let zoom = 1; // pinch / Ctrl+wheel zoom on top of "fit to width"
  function computeScale(base) {
    const avail = Math.max(260, Math.min(stage.clientWidth - 24, 920));
    return avail / base.width * zoom;
  }

  for (let n = 1; n <= pdf.numPages; n++) {
    const page = await pdf.getPage(n);
    if (!alive) return;
    const base = page.getViewport({ scale: 1 });
    const el = h(`<div class="sign-page" data-page="${n}" aria-label="Seite ${n}"><div class="sign-layer"></div></div>`);
    pagesBox.appendChild(el);
    pageInfo.push({ num: n, page, base, el, layer: $('.sign-layer', el), canvasDone: false, widgets: [] });
  }
  scale = computeScale(pageInfo[0].base);
  layoutPages();

  // ---- paper form without fields: find lines and boxes and make them fillable (js/tools/paperform.js) ----
  if (!fields.length) {
    const offer = h(`<div class="pf-offer card" role="region" aria-label="Papierformular">
      <span class="pf-ic">${icon('magic')}</span>
      <div class="pf-text"><strong>Ist das ein Papierformular?</strong><p data-pf-msg>${profile ? 'FaLe findet Linien und Kästchen, macht sie ausfüllbar und trägt deine Daten gleich ein. Alles bleibt auf deinem Gerät.' : 'FaLe findet Linien und Kästchen und macht sie ausfüllbar. Alles bleibt auf deinem Gerät.'}</p></div>
      <div class="pf-acts"><button class="btn btn-primary btn-sm" type="button" data-pf>${icon('magic')} Felder finden</button>
      <button class="icon-btn" type="button" data-pf-x aria-label="Hinweis schließen">${icon('close')}</button></div></div>`);
    stage.prepend(offer);
    let ctrl = null;
    const msg = $('[data-pf-msg]', offer), btn = $('[data-pf]', offer);
    const idleMsg = msg.textContent;
    $('[data-pf-x]', offer).addEventListener('click', () => { if (ctrl) ctrl.abort(); offer.remove(); });
    btn.addEventListener('click', async () => {
      if (ctrl) { ctrl.abort(); return; }
      ctrl = new AbortController();
      offer.classList.add('busy');
      btn.innerHTML = `${icon('close')} Abbrechen`;
      msg.textContent = 'Seite wird untersucht …';
      try {
        const { detectPaperFields } = await import('./paperform.js');
        const r = await detectPaperFields(pdf, {
          signal: ctrl.signal,
          onProgress: pr => { msg.textContent = pr.phase === 'ocr' ? `Beschriftungen werden gelesen … (Seite ${pr.page} von ${pr.total})` : `Seite ${pr.page} von ${pr.total} wird untersucht …`; },
        });
        if (!alive) return;
        if (!r.fields.length) {
          msg.textContent = 'Keine Linien oder Kästchen gefunden. Mit „Text“ und „Häkchen“ schreibst du direkt auf die Seite.';
          return;
        }
        msg.textContent = `${r.fields.length} Felder gefunden – Formular wird erstellt …`;
        const { writeFields } = await import('./formfields.js');
        const pdfDoc = await loadEditable(bytes, doc.name, { key: docId });
        await writeFields(PDFLib, pdfDoc, r.fields, r.pages);
        const res = await saveResult(await saveDoc(pdfDoc), `${baseName(doc.name)} (ausfüllbar).pdf`);
        trackStat('forms_detected');
        if (!alive) return;
        location.hash = `#/werkzeug/unterschreiben?doc=${res.id}&gefunden=${r.fields.length}${r.ocrMissing ? '&ohnetext=1' : ''}`;
      } catch (e) {
        if (e && e.name === 'AbortError') { msg.textContent = idleMsg; }
        else { errorToast(e, 'Die Felder konnten nicht erkannt werden.'); msg.textContent = idleMsg; }
      } finally {
        ctrl = null;
        if (offer.isConnected) { offer.classList.remove('busy'); btn.innerHTML = `${icon('magic')} Felder finden`; }
      }
    });
  }

  const io = new IntersectionObserver(entries => {
    entries.forEach(en => { if (en.isIntersecting) { io.unobserve(en.target); drawPage(pageInfo[+en.target.dataset.page - 1]); } });
  }, { root: stage, rootMargin: '600px 0px' });
  pageInfo.forEach(p => io.observe(p.el));

  async function drawPage(p) {
    try {
      const s = scale;
      // keep zoomed pages light on phones: at most ~3000 px wide
      const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1, 3000 / (p.base.width * s)));
      const canvas = await renderPage(p.page, { scale: s, dpr });
      if (!alive || (s !== scale && p.el.querySelector('canvas'))) return; // an older zoom level – a fresh one is on its way
      p.el.querySelector('canvas')?.remove();
      p.el.prepend(canvas);
      p.canvasDone = s === scale; // zoom changed meanwhile → draw again when visible
    } catch (e) { if (alive) console.warn(e); }
  }

  // widget rectangles for highlighting / previewing form values
  if (fields.length) {
    for (const p of pageInfo) {
      try {
        const annots = await p.page.getAnnotations({ intent: 'display' });
        annots.filter(a => a.subtype === 'Widget' && a.fieldName).forEach(a => {
          const [x1, y1] = p.base.convertToViewportPoint(a.rect[0], a.rect[1]);
          const [x2, y2] = p.base.convertToViewportPoint(a.rect[2], a.rect[3]);
          p.widgets.push({ name: a.fieldName, x: Math.min(x1, x2), y: Math.min(y1, y2), w: Math.abs(x2 - x1), h: Math.abs(y2 - y1), check: !!a.checkBox, radio: !!a.radioButton, exportValue: a.buttonValue || a.exportValue });
        });
      } catch (e) { console.warn('widgets', e); }
    }
    renderFieldOverlays();
  }

  function layoutPages() {
    pageInfo.forEach(p => {
      p.el.style.width = `${Math.floor(p.base.width * scale)}px`;
      p.el.style.height = `${Math.floor(p.base.height * scale)}px`;
    });
    items.forEach(placeItem);
    renderFieldOverlays();
  }

  function renderFieldOverlays() {
    pageInfo.forEach(p => {
      $$('.field-ov', p.layer).forEach(x => x.remove());
      p.widgets.forEach(w => {
        const f = fields.find(ff => ff.name === w.name);
        if (!f) return;
        const ov = h(`<button type="button" class="field-ov" data-field="${esc(w.name)}" aria-label="Feld ${esc(w.name)} bearbeiten"></button>`);
        Object.assign(ov.style, { position: 'absolute', left: `${w.x * scale}px`, top: `${w.y * scale}px`, width: `${w.w * scale}px`, height: `${w.h * scale}px` });
        ov._w = w;
        ov.addEventListener('click', e => {
          e.stopPropagation();
          if (f.type === 'sig') { signField(f); return; }
          if (f.type === 'check') {
            f.value = !f.value;
            const cb = panel && panel.querySelector(`[data-fi="${fields.indexOf(f)}"]`);
            if (cb) cb.checked = f.value;
            updateFieldOverlays(f.name);
            markDirty();
            return;
          }
          if (f.type === 'radio' && w.exportValue) {
            f.value = f.options.includes(w.exportValue) ? w.exportValue : f.value;
            const sel = panel && panel.querySelector(`[data-fi="${fields.indexOf(f)}"]`);
            if (sel) sel.value = f.value;
            updateFieldOverlays(f.name);
            markDirty();
            return;
          }
          openPanel();
          const ctl = panel && panel.querySelector(`[data-fi="${fields.indexOf(f)}"]`);
          if (ctl) setTimeout(() => ctl.focus(), 60);
        });
        p.layer.prepend(ov);
      });
    });
    fields.forEach(f => updateFieldOverlays(f.name));
  }

  function updateFieldOverlays(name) {
    const f = fields.find(ff => ff.name === name);
    $$('.field-ov', layout).filter(o => o.dataset.field === name).forEach(o => {
      const w = o._w;
      const changed = f.value !== f.initial;
      o.classList.toggle('changed', changed);
      if (f.type === 'text' || f.type === 'select') {
        o.textContent = changed ? String(f.value) : '';
        o.style.fontSize = `${Math.max(8, Math.min(w.h * 0.62, 14)) * scale}px`;
      } else if (f.type === 'check') {
        o.innerHTML = f.value ? icon('check') : '';
      } else if (f.type === 'radio') {
        o.innerHTML = f.value && f.value === w.exportValue ? '<span class="radio-dot"></span>' : '';
      } else if (f.type === 'sig') {
        o.classList.add('sig-ov');
        if (!o.innerHTML) o.innerHTML = `<span class="sig-ov-label">${icon('sign')} Unterschreiben</span>`;
      }
    });
  }

  function setFieldValue(f, v) {
    f.value = v;
    const ctl = panel && panel.querySelector(`[data-fi="${fields.indexOf(f)}"]`);
    if (ctl) ctl.value = v;
    updateFieldOverlays(f.name);
    markDirty();
  }

  async function signField(f) {
    const w = pageInfo.flatMap(p => p.widgets.map(x => ({ ...x, page: p.num }))).find(x => x.name === f.name);
    if (!w) return;
    const sig = await pickAsset({ tab: 'signature', title: 'Unterschreiben' });
    if (!sig) return;
    sig.keep = false;
    const fit = Math.min(w.w / sig.w, w.h / sig.h);
    const iw = sig.w * fit * 0.94, ih = sig.h * fit * 0.94;
    addItem({ kind: 'image', page: w.page, x: w.x + (w.w - iw) / 2, y: w.y + (w.h - ih) / 2, w: iw, h: ih, sig, sigField: f.name });
    if (panel && window.matchMedia('(max-width: 900px)').matches) panel.classList.remove('open');
  }

  function focusWidget(name) {
    const ov = $$('.field-ov', layout).find(o => o.dataset.field === name);
    $$('.field-ov.focus', layout).forEach(o => o.classList.remove('focus'));
    if (ov) { ov.classList.add('focus'); ov.scrollIntoView({ block: 'center', behavior: 'smooth' }); }
  }

  function openPanel() {
    if (!panel) return;
    panel.classList.add('open');
    panel.classList.remove('closed-desktop');
  }

  // ---- modes ----
  function setMode(m) {
    mode = m;
    $$('[data-mode]', tools).forEach(b => b.setAttribute('aria-pressed', String(b.dataset.mode === m)));
    pageInfo.forEach(p => p.el.classList.toggle('placing', !!m && m !== 'form'));
    hint.textContent = {
      text: 'Tippe auf die Stelle, an der der Text stehen soll.',
      date: 'Tippe auf die Stelle, an der das Datum stehen soll.',
      sign: 'Tippe auf die Stelle, an der die Unterschrift erscheinen soll.',
      initials: 'Tippe auf die Stelle, an der die Initialen erscheinen sollen.',
      stamp: 'Tippe auf die Stelle, an der der Stempel erscheinen soll.',
      profile: `Tippe auf die Stelle für „${pendingText ? pendingText.label : ''}“.`,
      mark: 'Tippe auf das Kästchen, in das das Häkchen soll.',
    }[m] || 'Elemente lassen sich verschieben und über den Griff unten rechts skalieren.';
    renderBar();
  }

  $$('[data-mode]', tools).forEach(b => b.addEventListener('click', async () => {
    const m = b.dataset.mode;
    if (m === 'form') {
      if (window.matchMedia('(max-width: 900px)').matches) panel.classList.toggle('open');
      else panel.classList.toggle('closed-desktop');
      return;
    }
    if (mode === m) { setMode(null); return; }
    if (m === 'sign' || m === 'initials' || m === 'stamp') {
      const sig = await pickAsset({ tab: m === 'sign' ? 'signature' : m, title: m === 'stamp' ? 'Stempel' : m === 'initials' ? 'Initialen' : 'Unterschrift' });
      if (!sig) return;
      sig.keep = false;
      pendingSig = sig;
    }
    if (m === 'profile') {
      const choice = await new Promise(resolve => {
        const items = profileMenuItems(profile).map(it => ({ label: `${it.label}: ${it.value}`, icon: 'contact', onClick: () => resolve(it) }));
        showMenu(b, items, { label: 'Aus meinem Profil' });
        const off = () => setTimeout(() => { if (!document.querySelector('.menu-layer')) resolve(null); }, 0);
        document.addEventListener('click', off, { once: true, capture: true });
      });
      if (!choice) return;
      pendingText = choice;
    }
    setMode(m);
  }));

  pagesBox.addEventListener('click', e => {
    const pageEl = e.target.closest('.sign-page');
    if (!pageEl) return;
    if (e.target.closest('.s-item, .field-ov')) return;
    const p = pageInfo[+pageEl.dataset.page - 1];
    if (!mode || mode === 'form') { select(null); return; }
    const r = pageEl.getBoundingClientRect();
    const x = (e.clientX - r.left) / scale;
    const y = (e.clientY - r.top) / scale;
    const placing = mode;
    setMode(null); // first, so the new item's controls (and its text field) stay in the bar
    if (placing === 'text' || placing === 'date' || (placing === 'profile' && pendingText)) {
      const fontSize = lastSize;
      const it = { kind: 'text', page: p.num, x, y: y - fontSize * 0.6, fontSize, color: lastColor, text: placing === 'date' ? today() : placing === 'profile' ? pendingText.value : '' };
      addItem(it, placing === 'text');
    } else if (placing === 'mark') {
      const size = 14;
      addItem({ kind: 'mark', sym: lastMark, page: p.num, x: x - size / 2, y: y - size / 2, size, color: lastColor });
    } else if ((placing === 'sign' || placing === 'initials' || placing === 'stamp') && pendingSig) {
      const w = Math.min(placing === 'initials' ? 70 : placing === 'stamp' ? 150 : 180, p.base.width * 0.4, pendingSig.w * 0.75);
      const hgt = w * (pendingSig.h / pendingSig.w);
      addItem({ kind: 'image', page: p.num, x: x - w / 2, y: y - hgt / 2, w, h: hgt, sig: pendingSig });
    }
  });

  function addItem(it, edit = false) {
    items.push(it);
    const p = pageInfo[it.page - 1];
    const el = it.kind === 'text'
      ? h(`<div class="s-item s-textbox"><span class="s-text" role="textbox" aria-label="Textfeld" data-cap="Text eingeben"></span></div>`)
      : it.kind === 'mark'
        ? h(`<div class="s-item s-mark" role="img" aria-label="Häkchen">${markSvg(it.sym)}</div>`)
        : h(`<div class="s-item s-image" role="img" aria-label="Unterschrift"><img src="${it.sig.url}" alt=""></div>`);
    el.insertAdjacentHTML('beforeend', `<button type="button" class="s-del" aria-label="Element entfernen">${icon('close')}</button>
      <button type="button" class="s-resize" aria-label="Größe ändern">${icon('resize')}</button>`);
    it.el = el;
    if (it.kind === 'text') $('.s-text', el).textContent = it.text;
    $('.s-del', el).addEventListener('click', e => { e.stopPropagation(); removeItem(it); });
    enableDrag(it);
    p.layer.appendChild(el);
    placeItem(it);
    select(it, { edit });
    markDirty();
  }

  function removeItem(it) {
    const i = items.indexOf(it);
    if (i < 0) return;
    items.splice(i, 1);
    it.el.remove();
    if (selected === it) { selected = null; renderBar(); }
    markDirty();
  }

  function placeItem(it) {
    const el = it.el;
    el.style.left = `${it.x * scale}px`;
    el.style.top = `${it.y * scale}px`;
    if (it.kind === 'text') {
      const t = $('.s-text', el);
      t.style.fontSize = `${it.fontSize * scale}px`;
      t.style.color = it.color || '#111111';
    } else if (it.kind === 'mark') {
      el.style.width = el.style.height = `${it.size * scale}px`;
      el.style.color = it.color || '#111111';
      const mk = el.querySelector('svg.mk');
      if (mk && mk.dataset.sym !== it.sym) mk.outerHTML = markSvg(it.sym);
    } else {
      el.style.width = `${it.w * scale}px`;
      el.style.height = `${it.h * scale}px`;
    }
  }

  function select(it, { edit = false } = {}) {
    const prev = selected;
    selected = it;
    items.forEach(x => x.el.classList.toggle('sel', x === it));
    if (prev && prev !== it && prev.kind === 'text' && !prev.text.trim()) removeItem(prev);
    renderBar({ edit });
  }

  function enableDrag(it) {
    const el = it.el;
    let start = null;
    el.addEventListener('pointerdown', e => {
      if (e.target.closest('.s-del')) return;
      const resize = !!e.target.closest('.s-resize');
      if (selected !== it) select(it);
      e.preventDefault();
      el.setPointerCapture(e.pointerId);
      start = { x: e.clientX, y: e.clientY, ix: it.x, iy: it.y, w: it.w, h: it.h, fs: it.fontSize, sz: it.size, resize, moved: false };
    });
    el.addEventListener('pointermove', e => {
      if (!start) return;
      const dx = (e.clientX - start.x) / scale, dy = (e.clientY - start.y) / scale;
      if (!start.moved && Math.hypot(dx * scale, dy * scale) < 4) return;
      start.moved = true;
      const p = pageInfo[it.page - 1];
      if (start.resize) {
        if (it.kind === 'text') it.fontSize = Math.max(6, Math.min(72, start.fs + dy * 0.6));
        else if (it.kind === 'mark') it.size = Math.max(6, Math.min(60, start.sz + (dx + dy) / 2));
        else {
          const ratio = start.h / start.w;
          it.w = Math.max(30, Math.min(p.base.width, start.w + dx));
          it.h = it.w * ratio;
        }
      } else {
        it.x = Math.max(-10, Math.min(p.base.width - 10, start.ix + dx));
        it.y = Math.max(-10, Math.min(p.base.height - 10, start.iy + dy));
      }
      placeItem(it);
    });
    const end = () => {
      if (!start) return;
      const wasMoved = start.moved, wasResize = start.resize;
      start = null;
      if (wasMoved) { markDirty(); renderBar(); }
      else if (!wasResize && it.kind === 'text') focusBarInput();
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
  }

  // ---- the bar: placing hint, or the controls of the selected item ----
  const SIZES = [8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 32, 40, 48];
  const INK = [{ c: '#111111', n: 'Schwarz' }, { c: '#1C3FAA', n: 'Blau' }, { c: '#0B6B3A', n: 'Grün' }];
  let lastColor = '#111111', lastSize = 12, lastMark = 'check';
  function focusBarInput() { const i = bar.querySelector('[data-bar-text]'); if (i) { i.focus(); try { i.setSelectionRange(i.value.length, i.value.length); } catch {} } }
  function renderBar({ edit = false } = {}) {
    const it = selected;
    if (!it && !mode) { bar.hidden = true; bar.innerHTML = ''; return; }
    bar.hidden = false;
    if (!it) {
      bar.innerHTML = `<div class="sb-row"><span class="sb-hint">${icon('info')}<span>${esc(hint.textContent)}</span></span>
        <button class="btn btn-ghost" type="button" data-bar-cancel>Abbrechen</button></div>`;
      bar.querySelector('[data-bar-cancel]').addEventListener('click', () => setMode(null));
      return;
    }
    const colors = it.kind === 'image' ? '' : `<span class="sb-colors" role="group" aria-label="Farbe">${INK.map(k => `<button type="button" class="sb-color" data-color="${k.c}" style="--c:${k.c}" aria-label="${k.n}" aria-pressed="${(it.color || '#111111') === k.c}"></button>`).join('')}</span>`;
    const sizeLbl = it.kind === 'text' ? `<span class="sb-size" aria-live="polite">${Math.round(it.fontSize)}</span>` : '';
    const syms = it.kind === 'mark' ? `<span class="seg sb-syms" role="group" aria-label="Zeichen">${['check', 'cross', 'dot'].map(k => `<button type="button" data-sym="${k}" aria-pressed="${it.sym === k}" aria-label="${{ check: 'Häkchen', cross: 'Kreuz', dot: 'Punkt' }[k]}">${markSvg(k)}</button>`).join('')}</span>` : '';
    const done = `<button class="btn btn-primary sb-btn" type="button" data-bar-done>${icon('check')}<span>Fertig</span></button>`;
    bar.innerHTML = `${it.kind === 'text' ? `<div class="sb-row sb-textrow"><input class="input sb-text" data-bar-text type="text" placeholder="Text eingeben" aria-label="Text" enterkeyhint="done" autocomplete="off" spellcheck="false">${done}</div>` : ''}
      <div class="sb-row">${syms}
        <span class="sb-sizes" role="group" aria-label="Größe"><button class="btn btn-ghost sb-btn" type="button" data-bar-size="-1" aria-label="Kleiner"><span class="sb-a small">A</span>−</button>${sizeLbl}<button class="btn btn-ghost sb-btn" type="button" data-bar-size="1" aria-label="Größer"><span class="sb-a">A</span>+</button></span>
        ${colors}
        <span class="grow"></span>
        <button class="btn btn-ghost sb-btn sb-del" type="button" data-bar-del aria-label="Löschen">${icon('trash')}<span>Löschen</span></button>
        ${it.kind === 'text' ? '' : done}</div>`;
    const input = bar.querySelector('[data-bar-text]');
    if (input) {
      input.value = it.text;
      input.addEventListener('input', () => { it.text = input.value; $('.s-text', it.el).textContent = it.text; markDirty(); });
      input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); select(null); } });
      // focus right away, inside the tap: iPhones only open the keyboard then, and nothing typed gets lost
      if (edit) focusBarInput();
    }
    bar.querySelectorAll('[data-bar-size]').forEach(b => b.addEventListener('click', () => {
      const up = b.dataset.barSize === '1';
      if (it.kind === 'text') {
        const i = SIZES.findIndex(v => v >= Math.round(it.fontSize));
        const cur = i < 0 ? SIZES.length - 1 : i;
        it.fontSize = SIZES[Math.max(0, Math.min(SIZES.length - 1, cur + (up ? (SIZES[cur] > it.fontSize ? 0 : 1) : -1)))];
        lastSize = it.fontSize;
        bar.querySelector('.sb-size').textContent = String(Math.round(it.fontSize));
      } else if (it.kind === 'mark') it.size = Math.max(6, Math.min(60, it.size * (up ? 1.25 : 0.8)));
      else {
        const p = pageInfo[it.page - 1];
        const k = up ? 1.15 : 0.87, ratio = it.h / it.w;
        const w = Math.max(30, Math.min(p.base.width, it.w * k));
        it.x -= (w - it.w) / 2; it.y -= (w * ratio - it.h) / 2; it.w = w; it.h = w * ratio;
      }
      placeItem(it); markDirty();
    }));
    bar.querySelectorAll('[data-color]').forEach(b => b.addEventListener('click', () => {
      it.color = lastColor = b.dataset.color;
      bar.querySelectorAll('[data-color]').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
      placeItem(it); markDirty();
    }));
    bar.querySelectorAll('button[data-sym]').forEach(b => b.addEventListener('click', () => {
      it.sym = lastMark = b.dataset.sym;
      bar.querySelectorAll('button[data-sym]').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
      placeItem(it); markDirty();
    }));
    bar.querySelector('[data-bar-del]').addEventListener('click', () => removeItem(it));
    bar.querySelector('[data-bar-done]').addEventListener('click', () => select(null));
  }

  const onKey = e => {
    if (!selected || e.target.closest('input, textarea, select, [contenteditable]')) return;
    if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); removeItem(selected); }
    if (e.key === 'Escape') select(null);
  };
  window.addEventListener('keydown', onKey);

  const onResize = () => {
    const s = computeScale(pageInfo[0].base);
    if (Math.abs(s - scale) / scale < 0.04) return;
    scale = s;
    pageInfo.forEach(p => { p.canvasDone = false; io.observe(p.el); });
    layoutPages();
  };
  const ro = new ResizeObserver(() => onResize());
  ro.observe(stage);

  // ---- zoom: two fingers (phones), Ctrl + wheel (computers); smooth CSS preview while pinching, sharp afterwards ----
  function setZoom(z, cx = stage.clientWidth / 2, cy = stage.clientHeight / 2) {
    z = Math.max(1, Math.min(4, z));
    if (Math.abs(z - zoom) < 0.01) return;
    const k = z / zoom;
    const sx = stage.scrollLeft, sy = stage.scrollTop;
    zoom = z;
    scale = computeScale(pageInfo[0].base);
    pageInfo.forEach(p => { p.canvasDone = false; io.observe(p.el); });
    layoutPages();
    stage.scrollLeft = (sx + cx) * k - cx;
    stage.scrollTop = (sy + cy) * k - cy;
  }
  let pinch = null;
  const tdist = tt => Math.hypot(tt[0].clientX - tt[1].clientX, tt[0].clientY - tt[1].clientY);
  stage.addEventListener('touchstart', e => {
    if (e.touches.length !== 2) return;
    const r = stage.getBoundingClientRect();
    pinch = { d: tdist(e.touches), z: zoom, f: 1, cx: (e.touches[0].clientX + e.touches[1].clientX) / 2 - r.left, cy: (e.touches[0].clientY + e.touches[1].clientY) / 2 - r.top };
    pagesBox.style.transformOrigin = `${stage.scrollLeft + pinch.cx}px ${stage.scrollTop + pinch.cy}px`;
  }, { passive: true });
  stage.addEventListener('touchmove', e => {
    if (!pinch || e.touches.length !== 2) return;
    e.preventDefault();
    pinch.f = Math.max(1 / pinch.z, Math.min(4 / pinch.z, tdist(e.touches) / pinch.d));
    pagesBox.style.transform = `scale(${pinch.f})`;
  }, { passive: false });
  stage.addEventListener('touchend', e => {
    if (!pinch || e.touches.length >= 2) return;
    const p = pinch;
    pinch = null;
    pagesBox.style.transform = '';
    setZoom(p.z * p.f, p.cx, p.cy);
  }, { passive: true });
  stage.addEventListener('wheel', e => {
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    const r = stage.getBoundingClientRect();
    setZoom(zoom * (e.deltaY < 0 ? 1.15 : 1 / 1.15), e.clientX - r.left, e.clientY - r.top);
  }, { passive: false });

  // ---- save ----
  const saveBtn = h(`<button class="btn btn-primary" type="button" data-save>${icon('check')} Speichern</button>`);
  // every change bumps `rev`; after saving, the state of that moment counts as saved (the result is a new file,
  // the marks stay on the page so the user can continue) – until the next change
  function markDirty(initial = false) {
    if (!initial) rev++;
    const content = items.some(i => i.kind === 'image' || (i.text && i.text.trim())) || fields.some(f => f.value !== f.initial);
    dirty = content && rev !== savedRev;
    saveBtn.disabled = !dirty;
    updateFoot(screen, [saveBtn], dirty ? 'Ungespeicherte Änderungen' : (content && rev === savedRev ? 'Gespeichert' : ''));
  }
  markDirty(true);

  // fresh from „Felder finden“: fill in the profile values right away and show the field list
  const found = params && +params.get('gefunden');
  if (found && fields.length) {
    let n = 0;
    fields.forEach(f => { if (f.profileValue != null && !f.value) { setFieldValue(f, f.profileValue); n++; } });
    openPanel();
    toast(n ? `${fields.length} Felder gefunden, ${n} mit deinen Daten ausgefüllt – bitte prüfen und dann speichern.` : `${fields.length} Felder gefunden – bitte ausfüllen und dann speichern.`, 'success', { timeout: 6500 });
    if (params.get('ohnetext') === '1') toast('Die Beschriftungen konnten nicht gelesen werden (Texterkennung nicht geladen). Die Felder heißen deshalb „Textfeld“.', 'info', { timeout: 7000 });
    try { history.replaceState(history.state, '', `#/werkzeug/unterschreiben?doc=${docId}`); screen.hashKey = location.hash; } catch { /* ignore */ }
  }

  saveBtn.addEventListener('click', async () => {
    saveBtn.disabled = true;
    const prog = progress('Speichere …');
    try {
      const out = await build();
      const signed = items.some(i => i.kind === 'image');
      const res = await saveResult(out, `${baseName(doc.name)} (${signed ? 'unterschrieben' : 'ausgefüllt'}).pdf`);
      if (signed) trackStat('docs_signed');
      const box = h('<div class="screen-inner" style="padding-top:0"></div>');
      box.appendChild(resultCard(res, { from: docId, title: signed ? 'Unterschrieben' : 'Ausgefüllt' }));
      $$('.result-card', stage).forEach(x => x.closest('.screen-inner').remove());
      stage.appendChild(box);
      box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      toast('Dokument gespeichert.', 'success');
      savedRev = rev;
      markDirty(true);
    } catch (e) { errorToast(e, 'Speichern fehlgeschlagen.'); }
    finally { prog.done(); saveBtn.disabled = !dirty; }
  });

  async function build() {
    const { StandardFonts, degrees, rgb } = PDFLib;
    const pdfDoc = await loadEditable(bytes, doc.name, { key: docId });
    // Helvetica (tiny, unchanged look) unless the text needs more than Western European letters (Polish, Turkish,
    // Czech, Cyrillic, Greek …): then Liberation Sans is embedded as a subset (js/office/unifont.js)
    const allText = fields.filter(f => f.type === 'text').map(f => String(f.value ?? '')).concat(items.filter(i => i.kind === 'text').map(i => i.text || '')).join('\n');
    let font = null;
    if (needsUnicode(allText)) { try { font = await uniFont(pdfDoc, { PDFLib }); } catch (e) { console.warn('unicode font', e); } }
    if (!font) font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const clean = makeSanitizer(font);
    // 1) form fields
    if (fields.length) {
      const form = pdfDoc.getForm();
      for (const f of fields) {
        if (f.readOnly) continue;
        try {
          if (f.type === 'sig') continue;
          if (f.type === 'text') form.getTextField(f.name).setText(clean(String(f.value)) || undefined);
          else if (f.type === 'check') { const cb = form.getCheckBox(f.name); f.value ? cb.check() : cb.uncheck(); }
          else if (f.type === 'radio') { if (f.value) form.getRadioGroup(f.name).select(f.value); }
          else if (f.type === 'select') {
            if (!f.value) continue;
            const fld = form.getField(f.name);
            fld.select(f.value);
          }
        } catch (e) { console.warn('field', f.name, e); }
      }
      try {
        form.updateFieldAppearances(font);
        const flat = !panel || !$('[data-flatten]', panel) || $('[data-flatten]', panel).checked;
        if (flat) form.flatten();
        else {
          // keep the form fillable, but signed signature fields are covered by the image: remove them
          const signedNames = new Set(items.filter(i => i.sigField).map(i => i.sigField));
          for (const fld of form.getFields()) if (signedNames.has(fld.getName())) { try { form.removeField(fld); } catch {} }
        }
      } catch (e) {
        console.warn('flatten', e);
        toast('Hinweis: Einige Formularfelder konnten nicht fixiert werden und bleiben bearbeitbar.', 'info', { timeout: 5000 });
      }
    }
    // 2) free text, date and signatures
    const pages = pdfDoc.getPages();
    const imgCache = new Map();
    for (const it of items) {
      const p = pageInfo[it.page - 1];
      const target = pages[it.page - 1];
      const rot = p.page.rotate || 0;
      if (it.kind === 'text') {
        if (!it.text.trim()) continue;
        const [px, py] = p.base.convertToPdfPoint(it.x, it.y + it.fontSize * BASELINE);
        // Chinese, Hindi, Arabic … (no embedded font has them): drawn as a picture instead of "?"
        const [cr, cg, cb] = hexToRgb(it.color || '#111111');
        if (await drawTextImage(target, pdfDoc, it.text.trim(), { x: px, y: py, size: it.fontSize, color: rgb(cr, cg, cb), rotate: degrees(rot) })) continue;
        const txt = clean(it.text.trim());
        target.drawText(txt, { x: px, y: py, size: it.fontSize, font, color: rgb(cr, cg, cb), rotate: degrees(rot) });
      } else if (it.kind === 'mark') {
        // vector check mark / cross / dot – sharp at any zoom, also in print
        const [cr, cg, cb] = hexToRgb(it.color || '#111111');
        const P = (rx, ry) => { const [a, b] = p.base.convertToPdfPoint(it.x + rx * it.size, it.y + ry * it.size); return { x: a, y: b }; };
        const line = (a, b) => target.drawLine({ start: a, end: b, thickness: it.size * 0.13, color: rgb(cr, cg, cb), lineCap: PDFLib.LineCapStyle.Round });
        if (it.sym === 'cross') { line(P(0.18, 0.18), P(0.82, 0.82)); line(P(0.82, 0.18), P(0.18, 0.82)); }
        else if (it.sym === 'dot') { const c = P(0.5, 0.5); target.drawCircle({ x: c.x, y: c.y, size: it.size * 0.3, color: rgb(cr, cg, cb) }); }
        else { line(P(0.14, 0.55), P(0.4, 0.8)); line(P(0.4, 0.8), P(0.88, 0.2)); }
      } else {
        let img = imgCache.get(it.sig);
        if (!img) { img = await pdfDoc.embedPng(new Uint8Array(await it.sig.blob.arrayBuffer())); imgCache.set(it.sig, img); }
        const [px, py] = p.base.convertToPdfPoint(it.x, it.y + it.h);
        target.drawImage(img, { x: px, y: py, width: it.w, height: it.h, rotate: degrees(rot) });
      }
    }
    return saveDoc(pdfDoc);
  }

  return () => {
    alive = false;
    io.disconnect();
    ro.disconnect();
    window.removeEventListener('keydown', onKey);
    pdf.destroy();
    items.forEach(it => { if (it.sig && it.sig.url && !it.sig.keep) URL.revokeObjectURL(it.sig.url); });
  };
}

function placeCaretEnd(el) {
  const r = document.createRange();
  r.selectNodeContents(el);
  r.collapse(false);
  const s = window.getSelection();
  s.removeAllRanges();
  s.addRange(r);
}

function makeSanitizer(font) {
  const ok = new Map();
  return text => {
    let out = '';
    for (const ch of String(text).normalize('NFC')) {
      if (!ok.has(ch)) {
        try { font.widthOfTextAtSize(ch, 10); font.encodeText(ch); ok.set(ch, true); } catch { ok.set(ch, false); }
      }
      out += ok.get(ch) ? ch : (ch === '\n' ? ' ' : '?');
    }
    return out;
  };
}
