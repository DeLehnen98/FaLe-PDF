// Tool: remove the password / permission restrictions of PDFs you are allowed to open.
// The shell asks for the open password on the file card (it is only kept in this tab); restrictions
// without an open password are removed directly. Output: the same document without encryption.
import { el, clear } from '../lib/dom.js';
import { loadPdfLib, saveDoc } from '../lib/pdf.js';
import { ensureCss, tr, ic, pdfBlob, watchUnlock } from '../lib/sec-ui.js';

const info = new Map(); // input.id → inspection result

async function inspect(input) {
  if (info.has(input.id)) return info.get(input.id);
  const PDFLib = await loadPdfLib();
  const { inspectEncryption, PERM } = await import('../lib/shared/pdfcrypt.js');
  let r;
  try { r = await inspectEncryption(PDFLib, await input.bytes()); } catch { r = { encrypted: false, unreadable: true }; }
  if (r.encrypted && r.P != null) {
    r.denied = [];
    if (!(r.P & PERM.print)) r.denied.push('print');
    if (!(r.P & PERM.copy)) r.denied.push('copy');
    if (!(r.P & PERM.modify)) r.denied.push('modify');
    if (!(r.P & PERM.annotate)) r.denied.push('annotate');
    if (!(r.P & PERM.fillForms)) r.denied.push('forms');
  }
  info.set(input.id, r);
  return r;
}

const DENIED = {
  print: { de: 'Drucken', en: 'printing' }, copy: { de: 'Kopieren', en: 'copying' }, modify: { de: 'Ändern', en: 'changes' },
  annotate: { de: 'Kommentieren', en: 'comments' }, forms: { de: 'Formulare', en: 'forms' },
};

function describe(r, L, locked) {
  if (r.unreadable) return tr(L, 'Schutz wird nach dem Entsperren geprüft.', 'Protection is checked after unlocking.');
  if (!r.encrypted) return tr(L, 'Nicht geschützt – hier gibt es nichts zu entfernen.', 'Not protected – nothing to remove here.');
  const bits = [r.label || tr(L, 'verschlüsselt', 'encrypted')];
  bits.push(r.needsPassword ? tr(L, 'Passwort zum Öffnen', 'password to open') : tr(L, 'öffnet ohne Passwort', 'opens without a password'));
  if (r.denied?.length) bits.push(tr(L, 'eingeschränkt: ', 'restricted: ') + r.denied.map(d => DENIED[d][L === 'de' ? 'de' : 'en']).join(', '));
  return bits.join(' · ');
}

export default {
  options: [],

  mountStage(stage, state, ctx) {
    ensureCss();
    const L = ctx.lang;
    stage.classList.add('sec-stage');
    this._list = el('ul', { class: 'sec-list', aria: { label: tr(L, 'Schutz der Dateien', 'Protection of the files') } });
    stage.append(el('div', { class: 'sec-card' },
      el('h3', { class: 'sec-h' }, ic('unlock'), tr(L, 'Was entfernt wird', 'What will be removed')),
      this._list,
      el('p', { class: 'sec-info is-warn' }, ic('alert'), tr(L,
        'Entsperre nur Dokumente, die dir gehören oder für die du die Erlaubnis hast. Ein unbekanntes Passwort zum Öffnen kann dieses Werkzeug nicht knacken.',
        'Only unlock documents that are yours or that you have permission for. This tool cannot crack an unknown password to open.'))));
    this._state = state;
    this._lang = L;
    this.onInputs(state.inputs.filter(i => !i.error));
    watchUnlock(stage, state, inputs => this.onInputs(inputs));
  },

  async onInputs(inputs) {
    const list = this._list;
    if (!list) return;
    const L = this._lang;
    const all = this._state.inputs;
    for (const id of [...info.keys()]) if (!all.some(i => i.id === id)) info.delete(id);
    const rows = await Promise.all(all.filter(i => i.kind === 'pdf' && !i.error).map(async i => [i, await inspect(i)]));
    clear(list);
    for (const [i, r] of rows) {
      list.append(el('li', {}, el('span', { class: 'sec-li-name' }, i.name), el('span', { class: 'sec-li-meta' }, describe(r, L, i.locked))));
    }
  },

  async run(inputs, opts, ctx) {
    const outputs = [];
    let nothing = 0;
    for (let f = 0; f < inputs.length; f++) {
      const input = inputs[f];
      ctx.progress(f / inputs.length, { de: `Datei ${f + 1} von ${inputs.length}`, en: `File ${f + 1} of ${inputs.length}` });
      const r = await inspect(input);
      const doc = await input.pdfDoc();
      await ctx.tick();
      if (!doc.wtEncrypted && !r.encrypted) {
        nothing++;
        outputs.push({ name: input.name, blob: pdfBlob(await input.bytes()), unchanged: true,
          note: ctx.t({ de: 'War nicht geschützt – unverändert.', en: 'Was not protected – unchanged.' }) });
        continue;
      }
      const bytes = await saveDoc(doc);
      const suffix = ctx.lang === 'de' ? ' (entsperrt)' : ' (unlocked)';
      const what = r.needsPassword || input.password
        ? { de: 'Passwort und Einschränkungen entfernt', en: 'Password and restrictions removed' }
        : { de: 'Einschränkungen entfernt', en: 'Restrictions removed' };
      outputs.push({ name: ctx.fileName(input.name, suffix, 'pdf'), blob: pdfBlob(bytes), pages: doc.getPageCount(), note: ctx.t(what) });
      await ctx.tick();
    }
    if (nothing < inputs.length) ctx.note({ de: 'Die neue Datei ist nicht mehr verschlüsselt. Bewahre sie entsprechend sorgfältig auf.', en: 'The new file is no longer encrypted. Keep it safe accordingly.' });
    return { outputs };
  },
};
