// Tool: batch processing – run the same steps over many PDFs at once.
// Pick a ready-made recipe (e-mail, confidential, print, archive) or your own steps; they always run in a fixed,
// sensible order (remove pages → rotate → flatten → gray → watermark → page numbers → compress → hidden data →
// password), so there is nothing to wire up. Each step reuses the tested single tool (its run() on one file).
// A file that fails is skipped and listed in a report – the batch never stops because of one bad file.
// Locked PDFs without a password are skipped as well (tool flag skipLocked). Output names follow a pattern
// ({name}, {nr}, {datum}). Everything happens on this device; there is no file or hourly limit.
import { el } from '../lib/dom.js';
import { loadPdfLib, saveDoc, saveEncrypted } from '../lib/pdf.js';
import { InputFile } from '../lib/files.js';
import { defaults } from '../lib/options.js';
import { parsePages, PageRangeError } from '../lib/ranges.js';
import { ensureCss, tr, ic, btn, guardPrimary, statusLine, passwordInput, strengthMeter, generatePassword, passwordStrength, pdfBlob } from '../lib/sec-ui.js';

const LANG = (document.documentElement.lang || 'de').startsWith('en') ? 'en' : 'de';
const STORE = 'fale-wt-batch';
const secret = { pw: '', confirm: '' };
let ui = null;

// ---------------------------------------------------------------- steps (fixed order)
export const STEPS = [
  { id: 'del', label: { de: 'Seiten entfernen', en: 'Remove pages' } },
  { id: 'rotate', label: { de: 'Seiten drehen', en: 'Rotate pages' } },
  { id: 'flatten', label: { de: 'Formulare & Kommentare fixieren', en: 'Flatten forms & comments' } },
  { id: 'gray', label: { de: 'In Graustufen', en: 'To grayscale' } },
  { id: 'watermark', label: { de: 'Wasserzeichen', en: 'Watermark' } },
  { id: 'numbers', label: { de: 'Seitenzahlen', en: 'Page numbers' } },
  { id: 'compress', label: { de: 'Verkleinern', en: 'Compress' } },
  { id: 'strip', label: { de: 'Versteckte Daten entfernen', en: 'Remove hidden data' } },
  { id: 'protect', label: { de: 'Passwort setzen', en: 'Add a password' } },
];

export const PRESETS = {
  email: { steps: ['strip', 'compress'], compress: 'balanced', label: { de: 'Für E-Mail fertig machen', en: 'Ready for e-mail' },
    hint: { de: 'Verkleinern und versteckte Daten (Autor, Software, Anhänge) entfernen', en: 'Compress and remove hidden data (author, software, attachments)' } },
  send: { steps: ['strip', 'compress', 'protect'], compress: 'balanced', label: { de: 'Vertraulich verschicken', en: 'Send confidentially' },
    hint: { de: 'Wie „E-Mail“, dazu ein Passwort zum Öffnen (AES-256)', en: 'Like “e-mail”, plus a password to open (AES-256)' } },
  print: { steps: ['gray', 'numbers'], label: { de: 'Druckfertig in Graustufen', en: 'Print-ready in grayscale' },
    hint: { de: 'Farben in Grau umwandeln und Seitenzahlen ergänzen', en: 'Convert colours to gray and add page numbers' } },
  archive: { steps: ['flatten', 'compress'], compress: 'lossless', label: { de: 'Archivieren', en: 'Archive' },
    hint: { de: 'Formularwerte fest einbrennen, Dateistruktur verlustfrei aufräumen', en: 'Burn in form values, tidy the file structure losslessly' } },
};

/** Active steps (ids in the fixed order) for the option values. */
export function activeSteps(v) {
  const p = PRESETS[v.preset];
  const on = p ? new Set(p.steps) : new Set(STEPS.filter(s => v['s_' + s.id]).map(s => s.id));
  return STEPS.filter(s => on.has(s.id)).map(s => s.id);
}
const has = (v, id) => activeSteps(v).includes(id);
const level = v => (PRESETS[v.preset]?.compress) || v.level || 'balanced';

// remembered recipe (never the password): becomes the default of the options
function saved() {
  try { return JSON.parse(localStorage.getItem(STORE) || 'null') || {}; } catch { return {}; }
}
const S = saved();
const def = (id, fallback) => (S[id] !== undefined && S[id] !== null ? S[id] : fallback);

/** Output name from the pattern: {name} original name, {nr} running number, {datum}/{date} today. */
export function outName(pattern, name, nr, total, date = new Date()) {
  const base = String(name || 'Datei').replace(/\.pdf$/i, '');
  const pad = String(nr).padStart(String(total).length < 2 ? 2 : String(total).length, '0');
  const iso = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  let out = String(pattern || '{name}').trim() || '{name}';
  if (!/\{(name|nr)\}/i.test(out)) out += ' {nr}';   // without {name}/{nr} every file would get the same name
  out = out.replace(/\{name\}/gi, base).replace(/\{nr\}/gi, pad).replace(/\{(datum|date)\}/gi, iso);
  out = out.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '-').replace(/\s+/g, ' ').trim().replace(/^\.+/, '') || base;
  return out.replace(/\.pdf$/i, '') + '.pdf';
}

/**
 * Pages to remove (0-based) for a document with `count` pages. Lenient across many files: numbers beyond the
 * end of a short file are ignored instead of failing ("letzte"/"last" = the last page of each file).
 */
export function pagesToRemove(text, count) {
  try { return [...new Set(parsePages(text, count))]; } catch (err) {
    if (!(err instanceof PageRangeError) || err.kind !== 'range') throw err;
    const src = String(text || '').toLowerCase().replace(/\b(letzte|last|ende|end)\b/g, String(count));
    return [...new Set(parsePages(src, 100000))].filter(i => i < count);
  }
}

// ---------------------------------------------------------------- options
const stepToggles = STEPS.map(s => ({
  id: 's_' + s.id, type: 'toggle', default: !!def('s_' + s.id, s.id === 'compress'),
  when: v => v.preset === 'custom', label: s.label,
}));

const OPTIONS = [
  {
    id: 'preset', type: 'radio', default: def('preset', 'email'), label: { de: 'Was soll mit allen Dateien passieren?', en: 'What should happen to all files?' },
    choices: [
      ...Object.entries(PRESETS).map(([value, p]) => ({ value, label: p.label, hint: p.hint })),
      { value: 'custom', label: { de: 'Eigene Schritte', en: 'Own steps' }, hint: { de: 'Schritte selbst auswählen – die Reihenfolge ergibt sich automatisch', en: 'Pick the steps yourself – the order is set automatically' } },
    ],
  },
  ...stepToggles,
  { id: 'delPages', type: 'text', default: def('delPages', '1'), maxLength: 80, when: v => has(v, 'del'),
    label: { de: 'Welche Seiten entfernen?', en: 'Which pages to remove?' }, placeholder: { de: 'z. B. 1 oder letzte oder 1, 3-4', en: 'e.g. 1 or last or 1, 3-4' },
    hint: { de: 'Gilt für jede Datei. Seiten, die eine kurze Datei nicht hat, werden ignoriert.', en: 'Applies to every file. Pages a short file doesn’t have are ignored.' },
    validate: (v, lang) => { try { pagesToRemove(v, 9999); return ''; } catch { return lang === 'en' ? 'Use page numbers like 1, 3-4 or “last”.' : 'Nutze Seitenzahlen wie 1, 3-4 oder „letzte“.'; } } },
  { id: 'rotate', type: 'select', default: def('rotate', 90), when: v => has(v, 'rotate'), label: { de: 'Drehen um', en: 'Rotate by' },
    choices: [{ value: 90, label: { de: '90° nach rechts', en: '90° right' } }, { value: 180, label: '180°' }, { value: 270, label: { de: '90° nach links', en: '90° left' } }] },
  { id: 'wmText', type: 'text', default: def('wmText', LANG === 'en' ? 'CONFIDENTIAL' : 'VERTRAULICH'), maxLength: 120, when: v => has(v, 'watermark'),
    label: { de: 'Text des Wasserzeichens', en: 'Watermark text' },
    validate: (v, lang) => (String(v || '').trim() ? '' : (lang === 'en' ? 'Enter a text.' : 'Gib einen Text ein.')) },
  { id: 'numPos', type: 'select', default: def('numPos', 'bc'), when: v => has(v, 'numbers'), label: { de: 'Seitenzahl', en: 'Page number' },
    choices: [{ value: 'bc', label: { de: 'Unten Mitte', en: 'Bottom centre' } }, { value: 'br', label: { de: 'Unten rechts', en: 'Bottom right' } }, { value: 'tr', label: { de: 'Oben rechts', en: 'Top right' } }] },
  { id: 'level', type: 'radio', default: def('level', 'balanced'), when: v => v.preset === 'custom' && v.s_compress, label: { de: 'Wie stark verkleinern?', en: 'How much to compress?' },
    choices: [
      { value: 'lossless', label: { de: 'Verlustfrei', en: 'Lossless' }, hint: { de: 'Sieht exakt gleich aus', en: 'Looks exactly the same' } },
      { value: 'balanced', label: { de: 'Ausgewogen', en: 'Balanced' }, hint: { de: 'Fotos kleiner, Text bleibt scharf – empfohlen', en: 'Smaller photos, sharp text – recommended' } },
      { value: 'strong', label: { de: 'Stark', en: 'Strong' }, hint: { de: 'Am kleinsten – Text wird zu Bild', en: 'Smallest – text becomes an image' } },
    ] },
  { id: 'pattern', type: 'text', default: def('pattern', '{name}'), maxLength: 120, label: { de: 'Dateinamen', en: 'File names' },
    hint: { de: '{name} = alter Name, {nr} = laufende Nummer, {datum} = heute. Beispiel: „{datum} {name}“.', en: '{name} = old name, {nr} = running number, {date} = today. Example: “{date} {name}”.' } },
];

// ---------------------------------------------------------------- running one step
const MODULES = {
  flatten: () => import('./flatten-pdf.js'),
  gray: () => import('./grayscale-pdf.js'),
  watermark: () => import('./watermark-pdf.js'),
  numbers: () => import('./add-page-numbers.js'),
  compress: () => import('./compress-pdf.js'),
};
const OVERRIDES = {
  flatten: () => ({}),
  gray: () => ({ method: 'keep' }),
  watermark: v => ({ kind: 'text', text: String(v.wmText || '').trim() }),
  numbers: v => ({ position: v.numPos || 'bc' }),
  compress: v => ({ level: level(v) }),
};

function asInput(blob, name, password) {
  const input = new InputFile(new File([blob], name, { type: 'application/pdf' }), 'pdf');
  input.password = password || null;
  return input;
}

/** Run a single tool's run() on one file; returns the resulting Blob. */
async function viaTool(id, input, v, sub) {
  const mod = (await MODULES[id]()).default;
  const opts = { ...defaults(mod.options || []), ...OVERRIDES[id](v) };
  const res = await mod.run([input], opts, sub);
  const out = (Array.isArray(res) ? res : res?.outputs || [])[0];
  if (!out?.blob) throw new Error('no output');
  return out.blob;
}

async function viaDoc(input, fn) {
  const PDFLib = await loadPdfLib();
  const doc = await input.pdfDoc();
  const r = await fn(doc, PDFLib);
  if (r === false) return null;   // nothing changed
  const bytes = input.password ? await saveEncrypted(doc, input.password) : await saveDoc(doc);
  return pdfBlob(bytes);
}

async function runStep(id, input, v, sub, notes) {
  switch (id) {
    case 'del':
      return viaDoc(input, (doc) => {
        const n = doc.getPageCount();
        const drop = pagesToRemove(v.delPages, n).sort((a, b) => b - a);
        if (!drop.length) { notes.push(tr(sub.lang, 'keine der Seiten vorhanden', 'none of the pages exist')); return false; }
        if (drop.length >= n) throw Object.assign(new Error('all pages'), { userMessage: { de: 'Dabei würden alle Seiten entfernt.', en: 'That would remove every page.' } });
        for (const i of drop) doc.removePage(i);
        notes.push(tr(sub.lang, `${drop.length} ${drop.length === 1 ? 'Seite' : 'Seiten'} entfernt`, `${drop.length} ${drop.length === 1 ? 'page' : 'pages'} removed`));
        return true;
      });
    case 'rotate':
      return viaDoc(input, (doc, PDFLib) => {
        const deg = Number(v.rotate) || 90;
        for (const p of doc.getPages()) p.setRotation(PDFLib.degrees(((p.getRotation().angle + deg) % 360 + 360) % 360));
        return true;
      });
    case 'strip': {
      // own save: saveDoc() would write producer/creator/date right back
      const PDFLib = await loadPdfLib();
      const doc = await input.pdfDoc();
      const { stripPrivate } = await import('../lib/sec-strip.js');
      await stripPrivate(PDFLib, doc);
      if (input.password) return pdfBlob(await saveEncrypted(doc, input.password));
      return pdfBlob(await doc.save({ useObjectStreams: true, addDefaultPage: false, updateFieldAppearances: false }));
    }
    default:
      return viaTool(id, input, v, sub);
  }
}

// encryption needs its own save (no object streams, like protect-pdf)
async function protect(input) {
  const PDFLib = await loadPdfLib();
  const { encryptDocument } = await import('../lib/shared/pdfcrypt.js');
  const doc = await input.pdfDoc();
  doc.setModificationDate(new Date());
  await encryptDocument(PDFLib, doc, { userPassword: secret.pw, ownerPassword: '', permissions: { printing: true, copying: true, editing: true } });
  const bytes = await doc.save({ useObjectStreams: false, addDefaultPage: false, updateFieldAppearances: false });
  return pdfBlob(bytes);
}

function problem(v, L) {
  const steps = activeSteps(v);
  if (!steps.length) return tr(L, 'Wähle mindestens einen Schritt aus.', 'Choose at least one step.');
  if (steps.includes('protect')) {
    if (!secret.pw) return tr(L, 'Gib zuerst das Passwort für die Dateien ein oder lass dir eins erzeugen.', 'Enter the password for the files first or generate one.');
    if (secret.pw !== secret.confirm) return tr(L, 'Die beiden Passwörter stimmen nicht überein.', 'The two passwords don’t match.');
    if (passwordStrength(secret.pw).score === 0 && secret.pw.length < 4) return tr(L, 'Das Passwort ist zu kurz – nimm mindestens 4 Zeichen, besser deutlich mehr.', 'The password is too short – use at least 4 characters, ideally many more.');
  }
  return '';
}

const message = (err, ctx) => {
  if (err?.userMessage) return ctx.t(err.userMessage);
  if (err?.name === 'PasswordError') return tr(ctx.lang, 'Passwort fehlt oder ist falsch', 'Password missing or wrong');
  const m = String(err?.message || err || '');
  if (/encrypt|password/i.test(m)) return tr(ctx.lang, 'Die Datei ist geschützt', 'The file is protected');
  if (/memory|allocation|array buffer/i.test(m)) return tr(ctx.lang, 'Zu wenig Speicher für diese Datei', 'Not enough memory for this file');
  return tr(ctx.lang, 'Die Datei ist beschädigt oder keine gültige PDF', 'The file is damaged or not a valid PDF');
};

const fmtMB = (n, L) => (n / 1048576).toLocaleString(L === 'en' ? 'en-GB' : 'de-DE', { maximumFractionDigits: n < 10485760 ? 2 : 1 }) + ' MB';

export default {
  options: OPTIONS,
  skipLocked: true,
  stageAfterOptions: true,

  status(v, inputs, L) {
    const steps = activeSteps(v);
    const names = steps.map(id => tr(L, STEPS.find(s => s.id === id).label.de, STEPS.find(s => s.id === id).label.en));
    const locked = inputs.filter(i => i.locked).length;
    return {
      summary: names.length ? names.join(' → ') : null,
      hint: locked ? tr(L, `${locked} geschützte ${locked === 1 ? 'Datei wird' : 'Dateien werden'} übersprungen – gib das Passwort auf der Karte ein, um sie einzuschließen.`,
        `${locked} protected ${locked === 1 ? 'file is' : 'files are'} skipped – enter the password on the card to include ${locked === 1 ? 'it' : 'them'}.`) : null,
      ok: inputs.some(i => !i.locked),
    };
  },

  mountStage(stage, state, ctx) {
    ensureCss();
    const L = ctx.lang;
    const bump = () => { state.values.pwRev = (state.values.pwRev || 0) + 1; state.results?.clear?.(); ctx.refresh(); };
    const status = statusLine();
    const meter = strengthMeter(L, 'bt-pw-meter');
    const pw = passwordInput({ id: 'bt-pw', lang: L, label: tr(L, 'Passwort für alle Dateien', 'Password for all files'), describedby: 'bt-pw-meter',
      onInput: x => { secret.pw = x; meter.update(x); status.set(''); pw.input.removeAttribute('aria-invalid'); bump(); } });
    const confirm = passwordInput({ id: 'bt-pw2', lang: L, label: tr(L, 'Passwort wiederholen', 'Repeat password'),
      onInput: x => { secret.confirm = x; status.set(''); confirm.input.removeAttribute('aria-invalid'); bump(); } });
    const gen = btn('dice', tr(L, 'Sicheres Passwort erzeugen', 'Generate a strong password'), () => {
      const x = generatePassword();
      pw.setValue(x); confirm.setValue(x);
      if (pw.input.type === 'password') pw.eye.click();
      status.set(tr(L, 'Neues Passwort erzeugt. Notiere es – ohne Passwort lassen sich die Dateien nicht mehr öffnen.', 'New password generated. Write it down – without it the files can’t be opened any more.'), 'ok');
    });
    const box = el('div', { class: 'sec-card', dataset: { btPw: '' } },
      el('h3', { class: 'sec-h' }, ic('lock'), tr(L, 'Passwort zum Öffnen', 'Password to open')),
      pw.node, meter.node, confirm.node, el('div', { class: 'sec-row' }, gen),
      el('p', { class: 'sec-info' }, ic('shield'), tr(L, 'AES-256. Alle Dateien bekommen dasselbe Passwort. Es bleibt auf deinem Gerät und wird nicht gespeichert.',
        'AES-256. All files get the same password. It stays on your device and is not stored.')));
    const order = el('ol', { class: 'bt-order', aria: { label: tr(L, 'Ablauf je Datei', 'Steps per file') } });
    const orderBox = el('div', { class: 'sec-card bt-flow' }, el('h3', { class: 'sec-h' }, ic('list'), tr(L, 'Ablauf je Datei', 'Steps per file')), order,
      el('p', { class: 'sec-small' }, tr(L, 'Klappt eine Datei nicht, geht es mit der nächsten weiter – am Ende siehst du, was übersprungen wurde.',
        'If a file fails, the batch carries on with the next one – at the end you see what was skipped.')));
    stage.classList.add('sec-stage');
    stage.append(orderBox, box, status.node);
    const sync = () => {
      const v = state.values;
      box.hidden = !has(v, 'protect');
      order.replaceChildren(...activeSteps(v).map(id => { const s = STEPS.find(x => x.id === id); return el('li', {}, tr(L, s.label.de, s.label.en)); }));
      orderBox.hidden = !order.children.length;
      try { const keep = { ...v }; delete keep.pwRev; localStorage.setItem(STORE, JSON.stringify(keep)); } catch { /* private mode */ }
    };
    ui = { pw, confirm, meter, status, sync };
    sync();
    guardPrimary(stage, state, () => problem(state.values, L), msg => {
      status.set(msg, 'error');
      if (has(state.values, 'protect')) {
        const target = !secret.pw ? pw.input : confirm.input;
        target.setAttribute('aria-invalid', 'true'); target.focus();
      }
      status.node.scrollIntoView({ block: 'center' });
    });
  },

  onOptionsChange() { ui?.sync(); },

  onInputs(inputs) {
    if (!inputs.length && ui) { // new start: forget the password
      secret.pw = ''; secret.confirm = '';
      ui.pw.input.value = ''; ui.confirm.input.value = ''; ui.meter.update('');
    }
  },

  async run(inputs, v, ctx) {
    const L = ctx.lang;
    const msg = problem(v, L);
    if (msg) throw Object.assign(new Error(msg), { userMessage: { de: msg, en: msg }, stay: true });
    const steps = activeSteps(v);
    const files = inputs.filter(i => !i.locked);
    const skippedLocked = inputs.filter(i => i.locked);
    const outputs = [], failed = [], log = [];
    const total = files.length;
    const now = new Date();
    let before = 0, after = 0;
    for (let f = 0; f < total; f++) {
      const src = files[f];
      const label = (k) => ({ de: `Datei ${f + 1} von ${total} · ${STEPS.find(s => s.id === steps[k]).label.de}`, en: `File ${f + 1} of ${total} · ${STEPS.find(s => s.id === steps[k]).label.en}` });
      let cur = src, blob = null;
      const notes = [];
      try {
        for (let k = 0; k < steps.length; k++) {
          ctx.throwIfAborted();
          ctx.progress((f + k / steps.length) / total, label(k));
          const sub = {
            ...ctx, notes: [],
            note(text) { this.notes.push(ctx.t(text)); },
            progress: (x, text) => ctx.progress((f + (k + Math.max(0, Math.min(1, x || 0))) / steps.length) / total, label(k)),
          };
          const out = steps[k] === 'protect' ? await protect(cur) : await runStep(steps[k], cur, v, sub, notes);
          if (out) {
            blob = out;
            cur = asInput(out, src.name, steps[k] === 'protect' ? secret.pw : src.password);
          }
          await ctx.tick();
        }
        if (!blob) blob = src.file;
        const name = outName(v.pattern, src.name, f + 1, total, now);
        before += src.size; after += blob.size;
        outputs.push({ name, blob, before: steps.includes('compress') ? src.size : null, note: notes.join(' · ') || null });
        log.push(`OK      ${src.name} → ${name} (${fmtMB(src.size, L)} → ${fmtMB(blob.size, L)})${notes.length ? ' – ' + notes.join(', ') : ''}`);
      } catch (err) {
        if (err?.name === 'AbortError' || ctx.signal?.aborted) throw err;
        console.warn(err);
        const why = message(err, ctx);
        failed.push({ name: src.name, why });
        log.push(`${tr(L, 'FEHLER', 'FAILED')}  ${src.name} – ${why}`);
      }
      cur = null; blob = null;
      await ctx.tick();
    }
    for (const i of skippedLocked) {
      failed.push({ name: i.name, why: tr(L, 'geschützt, kein Passwort eingegeben', 'protected, no password entered') });
      log.push(`${tr(L, 'ÜBERSPRUNGEN', 'SKIPPED')}  ${i.name} – ${tr(L, 'geschützt, kein Passwort eingegeben', 'protected, no password entered')}`);
    }
    if (failed.length) {
      const head = tr(L, `FaLe Stapelverarbeitung – ${now.toLocaleString('de-DE')}`, `FaLe batch processing – ${now.toLocaleString('en-GB')}`);
      const recipe = tr(L, 'Schritte: ', 'Steps: ') + steps.map(id => tr(L, STEPS.find(s => s.id === id).label.de, STEPS.find(s => s.id === id).label.en)).join(' → ');
      const text = [head, recipe, '', ...log, '', tr(L, `${outputs.length} fertig, ${failed.length} nicht verarbeitet.`, `${outputs.length} done, ${failed.length} not processed.`)].join('\r\n');
      outputs.push({ name: tr(L, 'Bericht.txt', 'Report.txt'), blob: new Blob(['﻿' + text], { type: 'text/plain;charset=utf-8' }) });
      const list = failed.slice(0, 5).map(x => `${x.name} (${x.why})`).join(', ') + (failed.length > 5 ? ' …' : '');
      ctx.note(tr(L, `${failed.length} ${failed.length === 1 ? 'Datei wurde' : 'Dateien wurden'} nicht verarbeitet: ${list}. Details stehen im Bericht.`,
        `${failed.length} ${failed.length === 1 ? 'file was' : 'files were'} not processed: ${list}. Details are in the report.`));
    }
    if (outputs.length > (failed.length ? 1 : 0) && after < before) {
      ctx.note(tr(L, `Zusammen ${fmtMB(before, L)} → ${fmtMB(after, L)}.`, `Together ${fmtMB(before, L)} → ${fmtMB(after, L)}.`));
    }
    if (steps.includes('protect')) ctx.note(tr(L, 'Teste eine Datei einmal mit dem Passwort, bevor du die Originale löschst.', 'Test one file with the password before deleting the originals.'));
    return { outputs };
  },
};
