// Tool: PDF reader. Opens the chosen PDF in a full-screen reader (lib/new-viewer.js) right away – also
// password-protected files (the shell asks for the password on the file card first). The bar button
// re-opens the reader; run() is never needed but returns the file itself as a fallback.
import { el } from '../lib/dom.js';
import { ensureCss, T, svg, ICON } from '../lib/new-ui.js';

ensureCss();

let api = null;
const cfg = (() => { try { return JSON.parse(document.getElementById('wt-config')?.textContent || '{}'); } catch { return {}; } })();

export default {
  labels: { back_to_files: { de: 'Zurück', en: 'Back' } },
  options: [],
  mountStage(stage, state, ctx) { api = readerStage(stage, state, ctx); },
  onInputs(inputs) { api?.update(inputs); },
  status(values, inputs) {
    const i = inputs.find(x => !x.locked);
    return i ? { summary: i.name } : null;
  },
  async run(inputs) {
    // the bar button opens the reader (see readerStage); this is only reached without the stage
    return { outputs: inputs.map(i => ({ name: i.name, blob: i.file })) };
  },
};

function readerStage(stage, state, ctx) {
  const lang = ctx.lang;
  let viewer = null, current = null, opened = new WeakSet();
  const info = el('p', { class: 'new-muted' });
  const openBtn = el('button', { type: 'button', class: 'wt-btn wt-btn-primary', onclick: () => open() }, svg(ICON.book), T(lang, { de: 'Lesen', en: 'Read' }));
  const card = el('section', { class: 'new-box new-v-open', aria: { labelledby: 'new-v-h' } },
    el('h2', { id: 'new-v-h' }, T(lang, { de: 'Leseansicht', en: 'Reader' })), info, el('div', { class: 'new-row' }, openBtn),
    el('ul', { class: 'new-muted' },
      el('li', {}, T(lang, { de: 'Mit zwei Fingern zoomen, doppelt tippen zum Vergrößern.', en: 'Pinch to zoom, double-tap to enlarge.' })),
      el('li', {}, T(lang, { de: 'Lupe: im Text suchen – Treffer werden markiert.', en: 'Magnifier: search the text – matches are highlighted.' })),
      el('li', {}, T(lang, { de: 'Listen-Symbol: Inhaltsverzeichnis und Seitenübersicht.', en: 'List icon: table of contents and page overview.' })),
      el('li', {}, T(lang, { de: 'Drei Punkte: Nachtmodus, Drucken, Herunterladen.', en: 'Three dots: night mode, print, download.' }))));
  stage.append(card);

  // the bar's main button opens the reader instead of running the tool
  const bar = document.querySelector('.wt-bar');
  bar?.addEventListener('click', e => {
    if (e.target.closest('.wt-btn-primary') && state.phase === 'files') { e.preventDefault(); e.stopPropagation(); open(); }
  }, true);

  let opening = false;
  async function open() {
    if (!current || viewer || opening) return;
    opening = true;
    const input = current;
    opened.add(input);
    let pdf, openViewer;
    try {
      pdf = await input.pdfjs();
      ({ openViewer } = await import('../lib/new-viewer.js'));
    } catch (err) {
      opened.delete(input);
      // still locked: the shell asks for the password on the file card and calls onInputs afterwards
      info.textContent = err && err.name === 'PasswordError' ? T(lang, { de: 'Gib zuerst das Passwort der PDF ein.', en: 'Enter the PDF’s password first.' }) : T(lang, { de: 'Diese PDF konnte nicht geöffnet werden.', en: 'This PDF could not be opened.' });
      if (!(err && err.name === 'PasswordError')) console.warn(err);
      return;
    }
    finally { opening = false; }
    if (input !== current) return;
    viewer = openViewer({ pdf, name: input.name, lang, appUrl: cfg.app || '', getBlob: async () => input.file, onClose: () => { viewer = null; openBtn.focus(); } });
  }

  async function update(inputs = state.inputs) {
    const usable = inputs.filter(i => !i.error && !i.locked);
    const next = usable[0] || null;
    if (next !== current && viewer) { viewer.close(); viewer = null; }
    current = next;
    openBtn.disabled = !current;
    if (!current) { info.textContent = T(lang, { de: 'Gib zuerst das Passwort der PDF ein.', en: 'Enter the PDF’s password first.' }); return; }
    let pages = '';
    try { pages = await current.pageCount(); } catch { /* shown on the card */ }
    info.textContent = T(lang, { de: `${current.name}${pages ? ` · ${pages} ${pages === 1 ? 'Seite' : 'Seiten'}` : ''}`, en: `${current.name}${pages ? ` · ${pages} ${pages === 1 ? 'page' : 'pages'}` : ''}` });
    if (!opened.has(current)) open();
  }
  update();
  return { update };
}
