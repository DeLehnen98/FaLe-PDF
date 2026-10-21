// Formular-Lotse: fills a PDF form question by question – every field explained in plain words and in the person's
// own language, the answer shown live in a picture of the form, entries checked on the spot.
//   1. Start: how many questions, the form's language, „Weitermachen“ for a started form
//   2. One question per screen: term (translated by the app's i18n), the label as printed, explanation, example,
//      input that fits (date with calendar, yes/no, choices as big buttons), profile values pre-filled
//   3. Overview: everything at a glance, empty required fields, free-text answers translated into the form's
//      language on request (cloud AI, only after consent and a look at what is sent)
//   4. The answers go into the form's own fields (still editable) → sign, send by post or fax, share
// Labels the offline glossary does not know can be explained by the cloud AI – only the labels are sent, never the
// answers. Answers are kept on the device as a draft until the form is written.
import * as db from '../db.js';
import { icon } from '../icons.js';
import { $, $$, h, esc, toast, errorToast, openDialog, baseName, UserError } from '../ui.js';
import { getDocBytes, saveResult } from '../library.js';
import { loadPdf, renderPage } from '../pdfcore.js';
import { loadEditable, loadPdfLib, saveDoc } from '../pdflib.js';
import { problem, parseDate } from '../tools/formcheck.js';
import { formatDate, todayIn } from './fields.js';
import { matchProfile } from '../tools/profilefill.js';
import { lang as uiLang, locale, LANG_NAMES } from '../i18n/index.js';
import { norm, translatable } from './glossary.js';
import { readForm } from './fields.js';

let cssDone = false;
function loadCss() {
  if (cssDone || typeof document === 'undefined') return;
  cssDone = true;
  const l = document.createElement('link');
  l.rel = 'stylesheet';
  l.href = new URL('../../css/lotse.css', import.meta.url).href;
  document.head.appendChild(l);
}

const ls = {
  get(k) { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode: no draft */ } },
  del(k) { try { localStorage.removeItem(k); } catch {} },
};
const DRAFT = id => 'fale-lotse:' + id;
const HELP = 'fale-lotse-help'; // AI explanations of labels (no personal data) – reused for the same label later
const DRAFT_DAYS = 30;
/** Old drafts (answers can be personal) do not stay on the device: anything older than DRAFT_DAYS goes. */
function sweepDrafts() {
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (!k || !k.startsWith('fale-lotse:')) continue;
      let d = null;
      try { d = JSON.parse(localStorage.getItem(k)); } catch { d = null; }
      if (!d || d.v !== 1 || Date.now() - (d.at || 0) > DRAFT_DAYS * 864e5) localStorage.removeItem(k);
    }
  } catch { /* storage blocked */ }
}
const PLACEHOLDER = /^(|-+|–|bitte (aus)?w(ä|ae)hlen.*|please (select|choose).*|auswahl|select|choose)$/i;
// letters the embedded fonts cannot show (Latin, Greek and Cyrillic work)
const UNSUPPORTED = /[^\u0000-ɏɐ-˿̀-ͯͰ-ϿЀ-ԯḀ-ỿ -⁯₠-⃏℀-⅏←-⇿−\s]/u;
const PLACE_EX = 'Berlin'; // example place (not translated)
const trackStat = (e, n = 1) => { import('../extras/stats.js').then(m => m.track(e, n)).catch(() => {}); };

export async function mount(screen, { docId }) {
  const doc = await db.getDoc(docId);
  if (!doc) { screen.body.innerHTML = '<p class="panel-empty">Dokument nicht gefunden.</p>'; return; }
  screen.setTitle('Formular-Lotse', doc.name);
  loadCss();
  let bytes = await getDocBytes(docId);
  // filled in with FaLe earlier („Formular mit Gedächtnis“): the entries come back editable
  try {
    const fm = await import('../tools/formmemory.js');
    const PL = await loadPdfLib();
    const probe0 = await loadEditable(bytes, doc.name, { key: docId });
    if (fm.hasMemory(PL, probe0)) {
      const m = await fm.readMemory(PL, probe0);
      if (m && m.ok) { fm.restore(PL, probe0); bytes = await saveDoc(probe0); }
    }
  } catch (e) { if (e instanceof UserError) throw e; console.warn('Formular-Gedächtnis', e); }
  const { pdf } = await loadPdf(bytes.slice(), { name: doc.name, key: docId });
  const { xfaKind } = await import('../tools/xfaform.js');
  if (await xfaKind(pdf) === 'pure') {
    pdf.destroy();
    screen.body.innerHTML = `<div class="screen-inner"><div class="card xfa-info">${icon('form')}<div>
      <h2>Das ist ein Behörden-Formular</h2>
      <p>Es lässt sich nur im Formular-Bereich ausfüllen. Dort kannst du es öffnen, ausfüllen und als normale PDF speichern.</p>
      <a class="btn btn-primary" href="#/werkzeug/behoerdenformular?doc=${esc(docId)}">${icon('form')} Formular ausfüllen</a></div></div></div>`;
    return;
  }
  let alive = true;
  const PDFLib = await loadPdfLib();
  const { textItems } = await import('../tools/paperform.js');
  let F;
  try {
    const probe = await loadEditable(bytes, doc.name, { key: docId });
    F = await readForm({ PDFLib, probe, pdf, textItems });
  } catch (e) {
    if (e instanceof UserError) throw e;
    console.warn('Formular-Lotse', e);
    F = { questions: [], formLang: null, sigFields: 0, pages: [], total: 0 };
  }
  if (!alive) return;
  const Q = F.questions;
  const myLang = uiLang();
  let formLang = F.formLang;
  let profile = null;
  try { const pm = await import('../extras/profile.js'); profile = pm && pm.getProfile ? await pm.getProfile() : null; } catch { profile = null; }
  if (profile && !Object.values(profile).some(v => typeof v === 'string' && v.trim())) profile = null;

  // ---- state: answers live in the questions; the draft keeps them on the device until the form is written
  const src = {};   // id → 'profile' | 'today'
  const tr = {};    // id → { orig, text }  (translated answers)
  const ai = {};    // id → { term, explain, example, kind }  (AI explanations)
  let idx = 0;
  sweepDrafts();
  let draft = ls.get(DRAFT(docId));
  if (draft && (draft.v !== 1 || Date.now() - (draft.at || 0) > DRAFT_DAYS * 864e5)) { ls.del(DRAFT(docId)); draft = null; }
  const helpCache = ls.get(HELP) || {};
  const helpKey = q => `${myLang}|${norm(q.label)}`;
  Q.forEach(q => { const c = q.label && !q.gloss && helpCache[helpKey(q)]; if (c) ai[q.id] = c; });
  const applyDraft = () => {
    if (!draft) return;
    for (const q of Q) if (Object.prototype.hasOwnProperty.call(draft.answers || {}, q.id)) q.value = draft.answers[q.id];
    Object.assign(src, draft.src || {}); Object.assign(tr, draft.tr || {});
    if (draft.formLang && !formLang) formLang = draft.formLang;
    idx = Math.min(Math.max(0, draft.idx || 0), Math.max(0, Q.length - 1));
  };
  const prefill = () => {
    if (!profile) return;
    const names = Q.flatMap(q => [q.label, ...q.names]);
    const PERSONAL = ['name', 'place', 'placedate', 'date', 'zip', 'phone', 'mail', 'id', 'free'];
    for (const q of Q) {
      if (q.type !== 'text' || String(q.value || '').trim()) continue;
      // only fields the glossary recognises as the person's own data („Vorname des Kindes“ is not the user's name)
      if (!q.gloss || q.gloss.other || !PERSONAL.includes(q.gloss.kind)) continue;
      const m = matchProfile(q.label, q.tu || q.near, profile, names);
      if (m && m.value) { q.value = m.value; src[q.id] = 'profile'; }
    }
  };
  const save = () => {
    const answers = {};
    for (const q of Q) if (JSON.stringify(q.value) !== JSON.stringify(q.initial)) answers[q.id] = q.value;
    ls.set(DRAFT(docId), { v: 1, at: Date.now(), idx, answers, src, tr, formLang });
  };
  const answered = q => (Array.isArray(q.value) ? q.value.length > 0 : q.type === 'check' ? !!q.value : q.type === 'select' ? !!q.value && !PLACEHOLDER.test(String(q.value)) : String(q.value ?? '').trim() !== '');
  const kindOf = q => (q.gloss && q.gloss.kind) || (ai[q.id] && ai[q.id].kind) || null;
  const errOf = q => {
    if (q.type === 'select' && q.required && !answered(q)) return 'Bitte eine Auswahl treffen – das ist ein Pflichtfeld.';
    if (q.type === 'checks') return q.required && !q.value.length ? 'Bitte ankreuzen – das ist ein Pflichtfeld.' : null;
    const p = problem(q.rule || { required: q.required }, q.type === 'select' && PLACEHOLDER.test(String(q.value)) ? '' : q.value, q.type);
    if (p) return p;
    if (q.type === 'text' && UNSUPPORTED.test(String(q.value || ''))) {
      return translatable(kindOf(q)) && !(q.rule && q.rule.kind)
        ? 'Diese Schrift kann im Formular nicht dargestellt werden. Bitte schreib mit lateinischen Buchstaben – oder lass die Antwort in der Übersicht übersetzen.'
        : 'Diese Schrift kann im Formular nicht dargestellt werden. Bitte schreib mit lateinischen Buchstaben – zum Beispiel deinen Namen so, wie er im Pass steht.';
    }
    return null;
  };
  const needsTr = q => q.type === 'text' && answered(q) && !tr[q.id] && translatable(kindOf(q)) && !q.rule.kind
    && /\p{L}{3}/u.test(String(q.value)) && myLang !== (formLang || 'de');

  // ---- layout
  screen.body.classList.add('lotse-body');
  const root = h('<div class="lotse"></div>');
  screen.body.appendChild(root);
  const overviewBtn = h(`<button class="icon-btn" type="button" data-ov aria-label="Übersicht" title="Übersicht" hidden>${icon('pages')}</button>`);
  screen.extra.appendChild(overviewBtn);
  overviewBtn.addEventListener('click', () => showSummary());
  let onKey = null;
  const setKey = fn => { if (onKey) window.removeEventListener('keydown', onKey); onKey = alive ? fn : null; if (onKey) window.addEventListener('keydown', onKey); };

  // ---- page pictures for the preview (small cache: phones have little memory)
  const pageCache = new Map(); // `${n}@${s}` → canvas
  async function pageCanvas(n, s) {
    const key = `${n}@${s}`;
    if (pageCache.has(key)) { const c = pageCache.get(key); pageCache.delete(key); pageCache.set(key, c); return c; }
    const p = F.pages[n - 1];
    const c = await renderPage(p.page, { scale: s });
    pageCache.set(key, c);
    while (pageCache.size > 2) { const [k0, c0] = pageCache.entries().next().value; c0.width = c0.height = 0; pageCache.delete(k0); }
    return c;
  }

  /** Draw the part of the page around the question's field, the field highlighted and the answer written in. */
  async function drawLens(cv, q) {
    const p = F.pages[q.page - 1];
    if (!p) return;
    const W = p.base.width, H = p.base.height, r = q.rect;
    const cssW = Math.max(240, cv.parentElement ? cv.parentElement.clientWidth : 340);
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const padR = q.type === 'checks' || q.type === 'radio' || q.type === 'check' ? 90 : 30; // the words after the last box
    let cw = Math.max(320, Math.min(W, r.w + 190 + padR));
    let x0 = Math.max(0, Math.min(W - cw, r.x - 190 + Math.max(0, (cw - (r.w + 190 + padR)) / 2)));
    if (r.x + r.w + padR > x0 + cw) x0 = Math.max(0, Math.min(W - cw, r.x + r.w + padR - cw));
    let ch = Math.max(cw * 0.42, r.h + 60);
    ch = Math.min(ch, H, cw * 0.95);
    let y0 = Math.max(0, Math.min(H - ch, r.y + r.h / 2 - ch / 2));
    const k = cssW / cw;
    cv.style.width = cssW + 'px';
    cv.style.height = 'auto'; // keeps its shape when the screen gets narrower (max-width: 100%)
    cv.width = Math.round(cssW * dpr);
    cv.height = Math.round(ch * k * dpr);
    const s = Math.min(4, Math.ceil((k * dpr) * 4) / 4);
    const src = await pageCanvas(q.page, s);
    if (!alive || !cv.isConnected) return;
    const g = cv.getContext('2d');
    const sx = src.width / W;
    g.drawImage(src, x0 * sx, y0 * sx, cw * sx, ch * sx, 0, 0, cv.width, cv.height);
    const K = cv.width / cw;
    const R = { x: (r.x - x0) * K, y: (r.y - y0) * K, w: r.w * K, h: r.h * K };
    // everything around the field a little paler
    g.save();
    g.fillStyle = 'rgba(255,255,255,0.55)';
    g.beginPath(); g.rect(0, 0, cv.width, cv.height); g.rect(R.x - 3 * dpr, R.y - 3 * dpr, R.w + 6 * dpr, R.h + 6 * dpr);
    g.fill('evenodd');
    g.restore();
    const css = getComputedStyle(document.documentElement);
    const accent = (css.getPropertyValue('--primary') || '#3D34B8').trim() || '#3D34B8';
    g.lineWidth = 2.5 * dpr; g.strokeStyle = accent;
    g.fillStyle = 'rgba(61,52,184,0.08)';
    g.fillRect(R.x, R.y, R.w, R.h);
    g.strokeRect(R.x - 2 * dpr, R.y - 2 * dpr, R.w + 4 * dpr, R.h + 4 * dpr);
    // the answer, in pen blue
    g.fillStyle = '#1B2A8A'; g.strokeStyle = '#1B2A8A';
    const mark = rr => {
      const m = { x: (rr.x - x0) * K, y: (rr.y - y0) * K, w: rr.w * K, h: rr.h * K };
      g.lineWidth = Math.max(1.5, m.h * 0.12);
      g.beginPath(); g.moveTo(m.x + m.w * 0.2, m.y + m.h * 0.2); g.lineTo(m.x + m.w * 0.8, m.y + m.h * 0.8);
      g.moveTo(m.x + m.w * 0.8, m.y + m.h * 0.2); g.lineTo(m.x + m.w * 0.2, m.y + m.h * 0.8); g.stroke();
    };
    if (q.type === 'check' && q.value) mark(r);
    else if (q.type === 'checks') q.options.forEach(o => { if (q.value.includes(o.value) && o.rect) mark(o.rect); });
    else if (q.type === 'radio') { const o = q.options.find(x => x.value === q.value); if (o && o.rect) mark(o.rect); }
    else {
      const text = q.type === 'select' ? (PLACEHOLDER.test(String(q.value)) ? '' : (q.options.find(o => o.value === q.value) || {}).label || '') : String(q.value || '');
      if (text) {
        g.save();
        g.beginPath(); g.rect(R.x, R.y, R.w, R.h); g.clip();
        const fs = Math.min(R.h * (q.multiline ? 0.3 : 0.62), 13 * K);
        g.font = `${fs}px Helvetica, Arial, sans-serif`;
        g.textBaseline = 'middle';
        if (q.multiline) {
          const words = text.split(/\s+/); let line = '', y = R.y + fs * 0.9;
          for (const w of words) {
            const t2 = line ? line + ' ' + w : w;
            if (g.measureText(t2).width > R.w - 4 * K && line) { g.fillText(line, R.x + 2 * K, y); line = w; y += fs * 1.2; } else line = t2;
          }
          if (line) g.fillText(line, R.x + 2 * K, y);
        } else g.fillText(text, R.x + 2 * K, R.y + R.h / 2);
        g.restore();
      }
    }
  }

  // ---- views
  function frame(inner, foot = '', cls = '') {
    root.innerHTML = `<div class="lotse-scroll"><div class="lotse-wrap ${cls}">${inner}</div></div>${foot ? `<div class="lotse-foot"><div class="lotse-footin ${cls}">${foot}</div></div>` : ''}`;
    root.querySelector('.lotse-scroll').scrollTop = 0;
  }

  function showStart() {
    setKey(null);
    overviewBtn.hidden = true;
    if (!Q.length) return showNoFields();
    const req = Q.filter(q => q.required).length;
    const mins = Math.max(2, Math.round(Q.length * 0.35));
    const unknown = Q.filter(q => q.label && !q.gloss && !ai[q.id]).length;
    const langLine = formLang && formLang !== myLang
      ? `<p class="lotse-langs">${icon('text')}<span><span>Sprache des Formulars:</span> <b data-no-i18n>${esc(LANG_NAMES[formLang] || formLang.toUpperCase())}</b><br><span>Erklärt auf:</span> <b data-no-i18n>${esc(LANG_NAMES[myLang] || myLang)}</b></span></p>` : '';
    const hasDraft = draft && Object.keys(draft.answers || {}).length;
    frame(`
      <section class="lotse-start">
        <div class="lotse-hero" aria-hidden="true"><canvas class="lotse-hero-cv"></canvas></div>
        <h2 class="lotse-h">Ich führe dich durch dieses Formular</h2>
        <p class="lotse-lead">Frage für Frage – jedes Feld wird in einfachen Worten erklärt. Du siehst sofort, wo deine Antwort im Formular landet.</p>
        <ul class="lotse-facts">
          <li><b>${Q.length}</b> <span>${Q.length === 1 ? 'Frage' : 'Fragen'}</span></li>
          <li><b>${req}</b> <span>${req === 1 ? 'Pflichtfeld' : 'Pflichtfelder'}</span></li>
          <li><b>~${mins}</b> <span>Minuten</span></li>
        </ul>
        ${langLine}
        ${F.sigFields ? `<p class="lotse-note">${icon('sign')}<span>Am Ende unterschreibst du direkt auf dem Bildschirm.</span></p>` : ''}
        ${unknown && !aiOff() ? `<div class="lotse-card lotse-ai" data-ai-card>${icon('sparkle')}<div><strong>${unknown === 1 ? 'Eine Beschriftung kennt FaLe nicht auswendig' : `${unknown} Beschriftungen kennt FaLe nicht auswendig`}</strong>
          <p>Die KI kann sie erklären. Gesendet werden nur die Beschriftungen des Formulars – nicht deine Antworten.</p>
          <button class="btn btn-soft btn-sm" type="button" data-ai>${icon('sparkle')} Von der KI erklären lassen</button></div></div>` : ''}
        <p class="lotse-privacy">${icon('lock')}<span>Deine Antworten bleiben auf diesem Gerät.</span></p>
      </section>`,
    hasDraft
      ? `<button class="btn btn-ghost" type="button" data-new>Neu beginnen</button><button class="btn btn-primary btn-lg" type="button" data-go>${icon('play')} Weitermachen</button>`
      : `<button class="btn btn-primary btn-lg" type="button" data-go>${icon('play')} Los geht's</button>`);
    const cv = $('.lotse-hero-cv', root);
    drawHero(cv).catch(() => {});
    $('[data-go]', root).addEventListener('click', () => { if (hasDraft) { applyDraft(); } else { prefill(); idx = 0; } showQ(idx); });
    const nb = $('[data-new]', root);
    if (nb) nb.addEventListener('click', async () => {
      const c = await openDialog({
        title: 'Alle Antworten löschen?',
        body: '<p>Deine bisherigen Antworten zu diesem Formular werden gelöscht und du beginnst von vorn.</p>',
        actions: [{ label: 'Abbrechen', value: 'cancel', default: true }, { label: 'Löschen & neu beginnen', value: 'ok', kind: 'btn-danger' }],
      });
      if (c.value !== 'ok' || !alive) return;
      ls.del(DRAFT(docId)); draft = null; Q.forEach(q => { q.value = Array.isArray(q.initial) ? q.initial.slice() : q.initial; }); Object.keys(src).forEach(k => delete src[k]); Object.keys(tr).forEach(k => delete tr[k]); prefill(); idx = 0; showQ(0);
    });
    const ab = $('[data-ai]', root);
    if (ab) ab.addEventListener('click', async () => { if (await explainUnknown() && alive) showStart(); });
  }

  async function drawHero(cv) {
    const p = F.pages[0];
    if (!p) return;
    const cssW = Math.min(220, cv.parentElement.clientWidth || 220);
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const k = cssW / p.base.width;
    cv.style.width = cssW + 'px'; cv.style.height = Math.round(p.base.height * k) + 'px';
    cv.width = Math.round(cssW * dpr); cv.height = Math.round(p.base.height * k * dpr);
    const src = await renderPage(p.page, { scale: k * dpr });
    if (!cv.isConnected) return;
    const g = cv.getContext('2d');
    g.drawImage(src, 0, 0, cv.width, cv.height);
    src.width = src.height = 0;
    // the fields of page 1 as soft marks
    g.fillStyle = 'rgba(61,52,184,0.18)'; g.strokeStyle = 'rgba(61,52,184,0.65)'; g.lineWidth = dpr;
    Q.filter(q => q.page === 1).forEach(q => { const R = [q.rect.x * k * dpr, q.rect.y * k * dpr, q.rect.w * k * dpr, q.rect.h * k * dpr]; g.fillRect(...R); g.strokeRect(...R); });
  }

  function showNoFields() {
    frame(`<section class="lotse-start">
      <h2 class="lotse-h">Dieses Formular hat noch keine Felder</h2>
      <p class="lotse-lead">Bei Papierformularen, Scans und Fotos sucht FaLe die Linien und Kästchen und macht sie ausfüllbar. Danach führt dich der Lotse Frage für Frage durch. Alles bleibt auf deinem Gerät.</p>
      <p class="lotse-status" data-pf-msg role="status" aria-live="polite"></p></section>`,
    `<a class="btn btn-ghost" href="#/werkzeug/unterschreiben?doc=${esc(docId)}">${icon('text')} Frei beschriften</a><button class="btn btn-primary btn-lg" type="button" data-pf>${icon('magic')} Felder finden</button>`);
    const btn = $('[data-pf]', root), msg = $('[data-pf-msg]', root);
    let ctrl = null;
    btn.addEventListener('click', async () => {
      if (ctrl) { ctrl.abort(); return; }
      ctrl = new AbortController();
      btn.innerHTML = `${icon('close')} Abbrechen`;
      msg.textContent = 'Seite wird untersucht …';
      try {
        const { detectPaperFields } = await import('../tools/paperform.js');
        const r = await detectPaperFields(pdf, {
          signal: ctrl.signal,
          onProgress: pr => { msg.textContent = pr.phase === 'ocr' ? `Beschriftungen werden gelesen … (Seite ${pr.page} von ${pr.total})` : `Seite ${pr.page} von ${pr.total} wird untersucht …`; },
        });
        if (!alive) return;
        if (!r.fields.length) { msg.textContent = 'Keine Linien oder Kästchen gefunden. Mit „Frei beschriften“ schreibst du direkt auf die Seite.'; return; }
        msg.textContent = `${r.fields.length} Felder gefunden – Formular wird erstellt …`;
        const { writeFields } = await import('../tools/formfields.js');
        const pdfDoc = await loadEditable(bytes, doc.name, { key: docId });
        await writeFields(PDFLib, pdfDoc, r.fields, r.pages);
        const res = await saveResult(await saveDoc(pdfDoc), `${baseName(doc.name)} (ausfüllbar).pdf`);
        trackStat('forms_detected');
        if (!alive) return;
        location.hash = `#/werkzeug/formular-lotse?doc=${res.id}`;
      } catch (e) {
        if (!(e && e.name === 'AbortError')) errorToast(e, 'Die Felder konnten nicht erkannt werden.');
        msg.textContent = '';
      } finally {
        ctrl = null;
        if (btn.isConnected) btn.innerHTML = `${icon('magic')} Felder finden`;
      }
    });
  }

  function termOf(q) {
    const a = ai[q.id];
    if (q.gloss) return { term: q.gloss.term, explain: q.gloss.explain, ex: q.gloss.ex, ai: false, other: q.gloss.other };
    if (a) return { term: a.term, explain: a.explain, ex: a.example || '', ai: true, other: false };
    return { term: q.label || `Feld auf Seite ${q.page}`, explain: q.label ? '' : 'Die Beschriftung konnte nicht gelesen werden. Schau im Bild oben, was vor oder unter dem markierten Feld steht.', ex: '', ai: false, other: false, unknown: true };
  }

  function showQ(i) {
    idx = Math.max(0, Math.min(Q.length - 1, i));
    const q = Q[idx];
    save();
    overviewBtn.hidden = false;
    const t = termOf(q);
    const pct = Math.round((idx / Q.length) * 100);
    const showOrig = q.label && (t.ai || !q.gloss || norm(t.term) !== norm(q.label) || myLang !== 'de');
    const ex = q.gloss && q.gloss.kind === 'date' && !t.ex ? (formatDate('1961-03-12', q.rule.pattern) || '') : t.ex;
    const exText = q.gloss && q.gloss.kind === 'placedate' ? `${profile && profile.ort ? profile.ort : PLACE_EX}, ${todayIn(q.rule.pattern)}` : ex;
    const trHint = translatable(kindOf(q)) && q.type === 'text' && !q.rule.kind && myLang !== (formLang || 'de') && !aiOff();
    frame(`
      <div class="lotse-progress" role="progressbar" aria-valuemin="0" aria-valuemax="${Q.length}" aria-valuenow="${idx + 1}" aria-label="Fortschritt">
        <span class="lotse-count">Frage ${idx + 1} von ${Q.length}</span><span class="lotse-track"><span style="width:${pct}%"></span></span></div>
      <div class="lotse-q">
        <figure class="lotse-lens"><canvas aria-hidden="true"></canvas><figcaption>Hier im Formular · Seite ${q.page}</figcaption></figure>
        <div class="lotse-ask">
          <div class="lotse-termrow"><h2 class="lotse-term" id="lq-term"${(t.unknown && q.label) || t.ai ? ' data-no-i18n' : ''}>${esc(t.term)}</h2>
            ${'speechSynthesis' in window ? `<button class="icon-btn lotse-say" type="button" data-say aria-label="Vorlesen" title="Vorlesen">${icon('speaker')}</button>` : ''}</div>
          ${showOrig ? `<p class="lotse-orig"><span>Im Formular:</span> <q data-no-i18n>${esc(q.label)}</q></p>` : ''}
          ${q.required ? '<span class="lotse-req">Pflichtfeld</span>' : ''}
          ${t.other ? `<p class="lotse-other">${icon('info')}<span>Hier geht es nicht um dich, sondern um die Person, die im Formular genannt ist.</span></p>` : ''}
          ${t.explain ? `<p class="lotse-explain" id="lq-explain"${t.ai ? ' data-no-i18n' : ''}>${esc(t.explain)}</p>` : ''}
          ${t.ai ? '<p class="lotse-aibadge">Von der KI erklärt – bitte im Zweifel bei der Stelle nachfragen, die das Formular herausgibt.</p>' : ''}
          ${t.unknown && q.label && !aiOff() ? `<button class="btn btn-soft btn-sm lotse-whatis" type="button" data-ai>${icon('sparkle')} Was bedeutet das? (KI)</button>` : ''}
          ${exText ? `<p class="lotse-ex"><span>Beispiel:</span> <span data-no-i18n>${esc(exText)}</span></p>` : ''}
          <div class="lotse-input" data-in></div>
          <p class="lotse-msg" data-msg role="status" aria-live="polite" hidden></p>
          ${trHint ? '<p class="lotse-hint">Du kannst in deiner Sprache schreiben – in der Übersicht kann FaLe es dann übersetzen.</p>' : ''}
        </div>
      </div>`,
    `<button class="btn btn-ghost lotse-back" type="button" data-prev aria-label="Zurück" ${idx === 0 ? 'disabled' : ''}>${icon('chevronLeft')}<span class="lotse-btxt"> Zurück</span></button>
     <button class="btn btn-ghost lotse-skip" type="button" data-skip>Überspringen</button>
     <button class="btn btn-primary btn-lg" type="button" data-next>${idx === Q.length - 1 ? 'Zur Übersicht' : 'Weiter'} ${icon('chevronRight')}</button>`);
    const cv = $('.lotse-lens canvas', root);
    const redraw = () => drawLens(cv, q).catch(e => console.warn('lens', e));
    redraw();
    renderInput(q, $('[data-in]', root), redraw);
    const msg = $('[data-msg]', root);
    const showErr = () => { const e = errOf(q); msg.hidden = !e; msg.textContent = e || ''; return e; };
    if (answered(q)) showErr();
    $('[data-prev]', root).addEventListener('click', () => showQ(idx - 1));
    $('[data-skip]', root).addEventListener('click', () => (idx >= Q.length - 1 ? showSummary() : showQ(idx + 1)));
    const next = () => {
      const e = showErr();
      if (e && answered(q)) { msg.classList.add('shake'); setTimeout(() => msg.classList.remove('shake'), 400); return; } // a wrong entry stops here; an empty field may stay empty
      if (idx >= Q.length - 1) showSummary(); else showQ(idx + 1);
    };
    $('[data-next]', root).addEventListener('click', next);
    const say = $('[data-say]', root);
    if (say) say.addEventListener('click', () => speak([$('#lq-term', root), $('#lq-explain', root)].filter(Boolean).map(e => e.textContent).join('. ')));
    const wa = $('[data-ai]', root);
    if (wa) wa.addEventListener('click', async () => { if (await explainUnknown()) showQ(idx); });
    setKey(e => {
      if (e.key !== 'Enter' || e.isComposing) return;
      const tg = e.target;
      if (tg && tg.tagName === 'TEXTAREA' && !(e.ctrlKey || e.metaKey)) return;
      if (tg && (tg.tagName === 'BUTTON' || tg.tagName === 'A' || tg.tagName === 'SELECT')) return;
      if (tg && tg.closest && !tg.closest('.lotse')) return;
      e.preventDefault();
      next();
    });
    // keyboard users land in the input; on phones the keyboard would cover the explanation
    const first = $('[data-in] input, [data-in] textarea', root);
    if (first && matchMedia('(pointer: fine)').matches) first.focus({ preventScroll: true });
  }

  function renderInput(q, box, redraw) {
    const changed = () => { save(); redraw(); };
    const kind = kindOf(q);
    if (q.type === 'text') {
      const isDate = (q.rule.kind === 'date' || kind === 'date') && kind !== 'placedate';
      const ph = isDate ? (q.rule.pattern || 'dd.mm.yyyy').replace(/yyyy/i, 'JJJJ').replace(/yy/i, 'JJ').replace(/mm/i, 'MM').replace(/dd/i, 'TT') : '';
      const attrs = `${q.maxLen ? `maxlength="${q.maxLen}"` : ''} aria-labelledby="lq-term" ${q.required ? 'aria-required="true"' : ''} autocomplete="off" spellcheck="${kind === 'free' ? 'true' : 'false'}"`;
      const imode = q.rule.kind === 'iban' ? 'text' : q.rule.kind === 'zip' || kind === 'number' ? 'numeric' : kind === 'money' ? 'decimal' : kind === 'phone' ? 'tel' : q.rule.kind === 'mail' ? 'email' : 'text';
      box.innerHTML = q.multiline
        ? `<textarea class="input lotse-field" rows="4" ${attrs} data-no-i18n></textarea>`
        : `<div class="lotse-row"><input class="input lotse-field" type="text" inputmode="${imode}" ${ph ? `placeholder="${esc(ph)}"` : ''} ${attrs} data-no-i18n>
           ${isDate ? `<button class="btn btn-soft lotse-cal" type="button" data-cal aria-label="Kalender" title="Kalender">${icon('calendar')}</button><input type="date" class="lotse-date" tabindex="-1" aria-hidden="true">` : ''}</div>`;
      const inp = $('.lotse-field', box);
      inp.value = q.value || '';
      if (q.maxLen && (q.maxLen <= 40 || q.comb)) box.insertAdjacentHTML('beforeend', `<p class="lotse-hint">${q.comb ? `Höchstens ${q.maxLen} Zeichen – ein Zeichen pro Kästchen.` : `Höchstens ${q.maxLen} Zeichen.`}</p>`);
      inp.addEventListener('input', () => { q.value = inp.value; delete src[q.id]; if (tr[q.id]) delete tr[q.id]; changed(); });
      inp.addEventListener('blur', () => {
        if (isDate && inp.value.trim()) { const f = formatDate(inp.value, q.rule.pattern); if (f && f !== inp.value) { inp.value = f; q.value = f; changed(); } }
      });
      if (isDate) {
        const di = $('.lotse-date', box);
        $('[data-cal]', box).addEventListener('click', () => {
          const d = parseDate(inp.value, /^m/i.test(q.rule.pattern) ? 'mdy' : 'dmy');
          if (d && !d.bad) di.value = `${d.y}-${String(d.m).padStart(2, '0')}-${String(d.d).padStart(2, '0')}`;
          try { di.showPicker(); } catch { di.focus(); di.click(); }
        });
        di.addEventListener('change', () => { const f = formatDate(di.value, q.rule.pattern); if (f) { inp.value = f; q.value = f; delete src[q.id]; changed(); } });
      }
      // quick answers
      const chips = [];
      if (src[q.id] === 'profile') chips.push(`<span class="lotse-from">${icon('contact')} Aus deinem Profil – bitte prüfen</span>`);
      if (isDate && /datum|date|heute|today/i.test(norm(q.label)) && !/geburt|birth|seit|since|ausstell|issue|gueltig|valid|einreise|entry|einzug|auszug/i.test(norm(q.label))) chips.push(`<button class="chip" type="button" data-today>${icon('calendar')} Heute</button>`);
      if (q.gloss && q.gloss.kind === 'placedate') chips.push(`<button class="chip" type="button" data-placedate>${icon('calendar')} Ort und heutiges Datum</button>`);
      if (chips.length) box.insertAdjacentHTML('beforeend', `<div class="lotse-chips">${chips.join('')}</div>`);
      const td = $('[data-today]', box);
      if (td) td.addEventListener('click', () => { inp.value = todayIn(q.rule.pattern); q.value = inp.value; changed(); });
      const pd = $('[data-placedate]', box);
      if (pd) pd.addEventListener('click', () => { const place = profile && profile.ort ? profile.ort : ''; inp.value = `${place ? place + ', ' : ''}${todayIn(q.rule.pattern)}`; q.value = inp.value; changed(); inp.focus(); if (!place) inp.setSelectionRange(0, 0); });
      return;
    }
    if (q.type === 'check') {
      box.innerHTML = `<div class="lotse-yesno" role="group" aria-labelledby="lq-term">
        <button class="lotse-opt" type="button" data-v="1" aria-pressed="${q.value ? 'true' : 'false'}">${icon('check')} <span>Ja, ankreuzen</span></button>
        <button class="lotse-opt" type="button" data-v="0" aria-pressed="${q.value ? 'false' : 'true'}"><span class="lotse-box"></span> <span>Nein, leer lassen</span></button></div>`;
      $$('.lotse-opt', box).forEach(b => b.addEventListener('click', () => {
        q.value = b.dataset.v === '1';
        $$('.lotse-opt', box).forEach(x => x.setAttribute('aria-pressed', x === b ? 'true' : 'false'));
        changed();
      }));
      return;
    }
    // choices: radio (one), select (one), checks (several)
    const multi = q.type === 'checks';
    const opts = q.options.filter(o => !(q.type === 'select' && PLACEHOLDER.test(String(o.label))));
    if (q.type === 'select' && opts.length > 14) {
      box.innerHTML = `<select class="select lotse-field" aria-labelledby="lq-term" data-no-i18n><option value="">–</option>${opts.map(o => `<option value="${esc(o.value)}" ${o.value === q.value ? 'selected' : ''}>${esc(o.label)}</option>`).join('')}</select>`;
      const s = $('select', box);
      s.addEventListener('change', () => { q.value = s.value; changed(); });
      return;
    }
    const isOn = o => (multi ? q.value.includes(o.value) : q.value === o.value);
    box.innerHTML = `${multi ? '<p class="lotse-hint">Kreuze an, was zutrifft – auch mehreres.</p>' : ''}
      <div class="lotse-choices" role="${multi ? 'group' : 'radiogroup'}" aria-labelledby="lq-term">
      ${opts.map((o, i) => {
        const term = o.gloss ? o.gloss.term : '';
        const showTerm = term && (norm(term) !== norm(o.label) || myLang !== 'de');
        return `<button class="lotse-opt" type="button" data-i="${i}" ${multi ? `aria-pressed="${isOn(o)}"` : `role="radio" aria-checked="${isOn(o)}"`}>
          <span class="lotse-mark" aria-hidden="true">${icon('check')}</span>
          <span class="lotse-optx"><span class="lotse-optlab" data-no-i18n>${esc(o.label)}</span>${showTerm ? `<span class="lotse-optterm">${esc(term)}</span>` : ''}</span></button>`;
      }).join('')}
      ${!multi && !q.required ? `<button class="lotse-opt lotse-none" type="button" data-i="-1" role="radio" aria-checked="${!answered(q)}"><span class="lotse-mark" aria-hidden="true"></span><span class="lotse-optx"><span>Nichts auswählen</span></span></button>` : ''}
      </div>`;
    $$('.lotse-opt', box).forEach(b => b.addEventListener('click', () => {
      const i = +b.dataset.i;
      if (multi) {
        const v = opts[i].value;
        q.value = q.value.includes(v) ? q.value.filter(x => x !== v) : [...q.value, v];
        b.setAttribute('aria-pressed', String(q.value.includes(v)));
      } else {
        q.value = i < 0 ? '' : opts[i].value;
        $$('.lotse-opt', box).forEach(x => x.setAttribute('aria-checked', String(x === b)));
      }
      changed();
    }));
  }

  function speak(text) {
    try {
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.lang = locale();
      u.rate = 0.92;
      speechSynthesis.speak(u);
    } catch { /* no speech output */ }
  }

  const valueText = q => {
    if (q.type === 'check') return q.value ? '✕' : '';
    if (q.type === 'checks') return q.options.filter(o => q.value.includes(o.value)).map(o => o.label).join(', ');
    if (q.type === 'radio' || q.type === 'select') return answered(q) ? ((q.options.find(o => o.value === q.value) || {}).label || String(q.value)) : '';
    return String(q.value || '');
  };

  function showSummary() {
    setKey(null);
    save();
    overviewBtn.hidden = true;
    const missing = Q.filter(q => q.required && !answered(q));
    const wrong = Q.filter(q => answered(q) && errOf(q));
    const toTr = Q.filter(needsTr);
    const rows = Q.map((q, i) => {
      const t = termOf(q);
      const v = valueText(q);
      const err = errOf(q);
      return `<li class="lotse-sumrow${err ? ' bad' : ''}"><button type="button" data-q="${i}">
        <span class="lotse-sumterm"${(t.unknown && q.label) || t.ai ? ' data-no-i18n' : ''}>${esc(t.term)}</span>
        <span class="lotse-sumval">${q.type === 'check' && v ? '<span>angekreuzt</span>' : v ? `<span data-no-i18n>${esc(v)}</span>` : q.required ? '<em>Pflichtfeld – noch leer</em>' : '<em>leer</em>'}${tr[q.id] ? ' <span class="lotse-badge">übersetzt</span>' : ''}</span>
        ${err && v ? `<span class="lotse-sumerr">${esc(err)}</span>` : ''}
        ${tr[q.id] ? `<span class="lotse-sumorig" data-no-i18n>${esc(tr[q.id].orig)}</span>` : ''}
        </button>${tr[q.id] ? `<button class="btn btn-ghost btn-sm" type="button" data-undo="${i}">Rückgängig</button>` : ''}</li>`;
    }).join('');
    frame(`
      <h2 class="lotse-h">Alles im Blick</h2>
      <p class="lotse-lead">Tippe auf eine Zeile, um sie zu ändern.</p>
      ${missing.length ? `<p class="lotse-warn">${icon('info')}<span>${missing.length === 1 ? 'Ein Pflichtfeld ist noch leer. Formulare mit leeren Pflichtfeldern kommen oft zurück.' : `${missing.length} Pflichtfelder sind noch leer. Formulare mit leeren Pflichtfeldern kommen oft zurück.`}</span></p>` : ''}
      ${wrong.length ? `<p class="lotse-warn">${icon('info')}<span>${wrong.length === 1 ? 'Eine Angabe sieht nicht richtig aus – bitte prüfen.' : `${wrong.length} Angaben sehen nicht richtig aus – bitte prüfen.`}</span></p>` : ''}
      ${toTr.length && !aiOff() ? `<div class="lotse-card lotse-ai">${icon('sparkle')}<div><strong>${toTr.length === 1 ? 'Eine Antwort ist vielleicht nicht in der Sprache des Formulars' : `${toTr.length} Antworten sind vielleicht nicht in der Sprache des Formulars`}</strong>
        <p>Die KI kann sie übersetzen. Du siehst vorher genau, was gesendet wird.</p>
        <button class="btn btn-soft btn-sm" type="button" data-tr>${icon('sparkle')} Antworten übersetzen</button></div></div>` : ''}
      <ol class="lotse-sum">${rows}</ol>`,
    `<button class="btn btn-ghost lotse-back" type="button" data-back aria-label="Zurück">${icon('chevronLeft')}<span class="lotse-btxt"> Zurück</span></button><button class="btn btn-primary btn-lg" type="button" data-write>${icon('form')} Ins Formular eintragen</button>`, 'narrow');
    $$('[data-q]', root).forEach(b => b.addEventListener('click', () => showQ(+b.dataset.q)));
    $$('[data-undo]', root).forEach(b => b.addEventListener('click', () => { const q = Q[+b.dataset.undo]; q.value = tr[q.id].orig; delete tr[q.id]; save(); showSummary(); }));
    $('[data-back]', root).addEventListener('click', () => showQ(Math.min(idx, Q.length - 1)));
    const tb = $('[data-tr]', root);
    if (tb) tb.addEventListener('click', async () => { if (await translateAnswers(toTr) && alive) showSummary(); });
    $('[data-write]', root).addEventListener('click', e => writeForm(e.currentTarget));
  }

  // ---- cloud AI (only on tap, with consent, showing what is sent)
  function aiOff() { try { return localStorage.getItem('fale-ai-hidden') === '1'; } catch { return false; } }

  async function explainUnknown() {
    const list = Q.filter(q => q.label && !q.gloss && !ai[q.id]).slice(0, 36); // more: tap again (one answer must fit)
    if (!list.length) return false;
    const r = await openDialog({
      title: 'Beschriftungen erklären lassen?', wide: true,
      body: `<p>Diese Beschriftungen aus dem Formular werden an die Cloud-KI gesendet. Deine Antworten und das Dokument selbst werden nicht gesendet.</p>
        <ul class="lotse-send" data-no-i18n>${list.map(q => `<li>${esc(q.label)}</li>`).join('')}</ul>`,
      actions: [{ label: 'Abbrechen', value: 'cancel' }, { label: 'Senden & erklären', value: 'ok', kind: 'btn-primary', default: true }],
    });
    if (r.value !== 'ok') return false;
    const ui = await import('../ai/ui.js');
    if (!(await ui.ensureCloud())) return false;
    const { progress } = await import('../ui.js');
    const prog = progress('Die KI liest die Beschriftungen …');
    try {
      const C = await import('../ai/client.js');
      const ids = new Map(list.map((q, i) => [`q${i + 1}`, q]));
      const res = await C.runTask('form_help', { fields: list.map((q, i) => ({ id: `q${i + 1}`, label: q.label, options: (q.options || []).map(o => o.label).slice(0, 8) })) }, { lang: myLang });
      if (!alive) return false;
      const out = res.output || {};
      let n = 0;
      for (const f of out.fields || []) {
        const q = ids.get(f.id);
        if (!q) continue;
        ai[q.id] = { term: f.term, explain: f.explain, example: f.example || '', kind: f.kind || '' };
        helpCache[helpKey(q)] = ai[q.id];
        n++;
      }
      const keys = Object.keys(helpCache);
      if (keys.length > 400) keys.slice(0, keys.length - 400).forEach(k => delete helpCache[k]);
      ls.set(HELP, helpCache);
      if (!formLang && out.form_lang) formLang = out.form_lang;
      toast(n === 1 ? 'Eine Beschriftung erklärt.' : n ? `${n} Beschriftungen erklärt.` : 'Die KI konnte nichts erklären.', n ? 'success' : 'info', { timeout: 3500 });
      return n > 0;
    } catch (e) { ui.showAiError(e); return false; } finally { prog.done(); }
  }

  async function translateAnswers(list) {
    const items = list.slice(0, 30).map((q, i) => ({ id: `a${i + 1}`, q, label: q.label, text: String(q.value).slice(0, 600) }));
    const target = formLang || 'de';
    const r = await openDialog({
      title: 'Antworten übersetzen?', wide: true,
      body: `<p>Diese Antworten werden an die Cloud-KI gesendet und in die Sprache des Formulars übersetzt. Danach kannst du jede Übersetzung prüfen und rückgängig machen.</p>
        <ul class="lotse-send" data-no-i18n>${items.map(x => `<li><b>${esc(x.label || '')}</b> ${esc(x.text)}</li>`).join('')}</ul>`,
      actions: [{ label: 'Abbrechen', value: 'cancel' }, { label: 'Senden & übersetzen', value: 'ok', kind: 'btn-primary', default: true }],
    });
    if (r.value !== 'ok') return false;
    const ui = await import('../ai/ui.js');
    if (!(await ui.ensureCloud())) return false;
    const { progress } = await import('../ui.js');
    const prog = progress('Die Antworten werden übersetzt …');
    try {
      const C = await import('../ai/client.js');
      const res = await C.runTask('form_answers', { items: items.map(({ id, label, text }) => ({ id, label, text })) }, { target });
      if (!alive) return false;
      let n = 0;
      for (const it of (res.output && res.output.items) || []) {
        const x = items.find(y => y.id === it.id);
        if (!x || !it.text) continue;
        tr[x.q.id] = { orig: String(x.q.value), text: it.text };
        x.q.value = it.text;
        n++;
      }
      save();
      toast(n === 1 ? 'Eine Antwort übersetzt – bitte kurz prüfen.' : n ? `${n} Antworten übersetzt – bitte kurz prüfen.` : 'Es wurde nichts übersetzt.', n ? 'success' : 'info', { timeout: 4000 });
      return n > 0;
    } catch (e) { ui.showAiError(e); return false; } finally { prog.done(); }
  }

  // ---- write the answers into the form
  async function writeForm(btn) {
    const missing = Q.filter(q => q.required && !answered(q));
    if (missing.length) {
      const r = await openDialog({
        title: 'Pflichtfelder sind noch leer',
        body: `<p>${missing.length === 1 ? 'Ein Pflichtfeld ist noch leer. Du kannst das Formular trotzdem speichern und später ergänzen.' : `${missing.length} Pflichtfelder sind noch leer. Du kannst das Formular trotzdem speichern und später ergänzen.`}</p>`,
        actions: [{ label: 'Ausfüllen', value: 'fill', kind: 'btn-primary', default: true }, { label: 'Trotzdem speichern', value: 'ok' }],
      });
      if (r.value === 'fill') { showQ(Q.indexOf(missing[0])); return; }
      if (r.value !== 'ok') return;
    }
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner" aria-hidden="true"></span> Wird eingetragen …';
    try {
      const { needsUnicode, uniFont, cleanText } = await import('../office/unifont.js');
      const pdfDoc = await loadEditable(bytes, doc.name, { key: docId });
      const form = pdfDoc.getForm();
      const texts = Q.filter(q => q.type === 'text').map(q => String(q.value || ''));
      let font = null;
      if (needsUnicode(texts.join('\n'))) { try { font = await uniFont(pdfDoc, { PDFLib }); } catch (e) { console.warn('unicode font', e); } }
      if (!font) font = await pdfDoc.embedFont(PDFLib.StandardFonts.Helvetica);
      const lost = new Set();
      for (const q of Q) {
        try {
          if (q.type === 'text') {
            let v = String(q.value ?? '');
            const c = cleanText(v, font);
            c.missing.forEach(ch => lost.add(ch));
            v = c.text;
            if (q.maxLen && v.length > q.maxLen) v = v.slice(0, q.maxLen);
            if (!q.multiline) v = v.replace(/\s*\n\s*/g, ' ');
            form.getTextField(q.names[0]).setText(v || undefined);
          } else if (q.type === 'check') { const cb = form.getCheckBox(q.names[0]); q.value ? cb.check() : cb.uncheck(); }
          else if (q.type === 'checks') q.names.forEach(n => { const cb = form.getCheckBox(n); q.value.includes(n) ? cb.check() : cb.uncheck(); });
          else if (q.type === 'radio') { const rg = form.getRadioGroup(q.names[0]); q.value ? rg.select(q.value) : rg.clear(); }
          else if (q.type === 'select') {
            const f = form.getField(q.names[0]);
            if (String(q.value ?? '') === String(q.initial ?? '')) continue; // untouched: a list with several marked entries keeps them all
            if (q.value && !PLACEHOLDER.test(String(q.value))) f.select(q.value);
            else if (typeof f.clear === 'function') f.clear(); // „Nichts auswählen“: no old choice stays in the form
          }
        } catch (e) { console.warn('field', q.id, e); }
      }
      try { form.updateFieldAppearances(font); } catch (e) { console.warn('appearances', e); }
      const res = await saveResult(await saveDoc(pdfDoc), `${baseName(doc.name)} (ausgefüllt).pdf`);
      ls.del(DRAFT(docId));
      draft = null;
      if (lost.size) toast(`Einige Schriftzeichen konnten nicht ins Formular übernommen werden: ${[...lost].slice(0, 8).join(' ')}`, 'info', { timeout: 7000 });
      if (!alive) return;
      showDone(res);
    } catch (e) {
      errorToast(e, 'Das Formular konnte nicht gespeichert werden.');
      if (btn.isConnected) { btn.disabled = false; btn.innerHTML = `${icon('form')} Ins Formular eintragen`; }
    }
  }

  async function showDone(res) {
    setKey(null);
    overviewBtn.hidden = true;
    let ways = { post: false, fax: false };
    try { const P = await import('../post/api.js'); ways = { post: P.postKnown() === true, fax: P.faxKnown() === true }; } catch {}
    frame(`<section class="lotse-start lotse-done">
      <div class="lotse-done-ic" aria-hidden="true">${icon('check')}</div>
      <h2 class="lotse-h">Fertig – deine Angaben stehen im Formular</h2>
      <p class="lotse-lead"><span>Gespeichert als:</span> <b data-no-i18n>${esc(res.name)}</b><br><span>Die Felder bleiben änderbar.</span></p>
      ${F.sigFields ? '<p class="lotse-note">Jetzt fehlt nur noch deine Unterschrift.</p>' : ''}
      <div class="lotse-acts">
        <a class="btn btn-primary btn-lg" href="#/werkzeug/unterschreiben?doc=${esc(res.id)}${F.sigFields ? '' : '&modus=sign'}">${icon('sign')} Jetzt unterschreiben</a>
        <a class="btn btn-soft" href="#/ansicht/${esc(res.id)}">${icon('open')} Ansehen</a>
        ${ways.post ? `<button class="btn btn-soft" type="button" data-post>${icon('mail')} Per Post senden</button>` : ''}
        ${ways.fax ? `<button class="btn btn-soft" type="button" data-fax>${icon('print')} Per Fax senden</button>` : ''}
        <button class="btn btn-ghost" type="button" data-share>${icon('share')} Teilen</button>
      </div></section>`);
    const send = async way => {
      try {
        const b = await getDocBytes(res.id);
        if (way === 'fax') await (await import('../post/fax.js')).sendByFax({ docId: res.id, name: res.name, bytes: b });
        else await (await import('../post/send.js')).sendByPost({ docId: res.id, name: res.name, bytes: b });
      } catch (e) { errorToast(e, 'Das hat nicht geklappt.'); }
    };
    const pb = $('[data-post]', root); if (pb) pb.addEventListener('click', () => send('post'));
    const fb = $('[data-fax]', root); if (fb) fb.addEventListener('click', () => send('fax'));
    $('[data-share]', root).addEventListener('click', async () => { const C = await import('../components.js'); C.shareDoc(res); });
  }

  showStart();

  return () => {
    alive = false;
    setKey(null);
    try { speechSynthesis.cancel(); } catch {}
    pageCache.forEach(c => { c.width = c.height = 0; });
    pageCache.clear();
    try { pdf.destroy(); } catch {}
  };
}
