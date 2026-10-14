// Tool: rotate PDF pages – all, selected, only landscape/portrait, or tap the button on a single page.
// Lossless: only the page's /Rotate value changes, the content stays byte-identical.
import { loadPdfLib } from '../lib/pdf.js';
import { el } from '../lib/dom.js';
import { PageStage, saveLike, pdfBlob, userError, norm } from '../lib/org-common.js';

let stage = null;
let values = null;

function store() {
  const rot = {};
  stage.items.forEach((it, i) => { if (it.rot) rot[i] = it.rot; });
  values.rot = rot;
}

function targets() {
  const sel = stage.items.filter(it => stage.grid.selected.has(it.id));
  return sel.length ? sel : stage.items;
}

function turn(list, deg) {
  for (const it of list) it.rot = norm(it.rot + deg);
  stage.grid.refresh();
  store();
  sync();
}

function landscape(it) {
  const s = stage.size(it);
  if (!s) return false;
  const l = s[0] > s[1] * 1.02;
  return it.rot % 180 ? !l : l;
}
function portrait(it) {
  const s = stage.size(it);
  if (!s) return false;
  const p = s[1] > s[0] * 1.02;
  return it.rot % 180 ? !p : p;
}

function sync() {
  if (!stage?.input) return;
  const de = stage.lang === 'de';
  const sel = stage.grid.selected.size;
  const turned = stage.items.filter(it => it.rot).length;
  stage.tb.bar.classList.toggle('is-active', sel > 0);
  stage.info([
    sel ? (de ? `${sel} ausgewählt – Drehen wirkt nur auf diese` : `${sel} selected – rotation applies to these`) : (de ? 'Drehen wirkt auf alle Seiten' : 'Rotation applies to all pages'),
    el('small', {}, turned ? (de ? `${turned} ${turned === 1 ? 'Seite' : 'Seiten'} gedreht` : `${turned} ${turned === 1 ? 'page' : 'pages'} rotated`) : (de ? 'Tippe Seiten an, um nur diese zu drehen' : 'Tap pages to rotate only those')),
  ]);
  stage.tb.btn('none').disabled = !sel;
  stage.tb.btn('reset').disabled = !turned;
}

function select(fn) {
  stage.grid.setSelected(stage.items.filter(fn).map(it => it.id));
  sync();
}

export default {
  options: [],

  mountStage(host, state, ctx) {
    values = state.values;
    values.rot = {};
    const t = ctx.t;
    stage = new PageStage(host, ctx, {
      mode: 'select',
      buttons: [
        { id: 'left', icon: 'rotl', label: t({ de: '90° nach links drehen', en: 'Rotate 90° left' }), short: t({ de: 'Links', en: 'Left' }), onClick: () => turn(targets(), -90) },
        { id: 'right', icon: 'rotr', label: t({ de: '90° nach rechts drehen', en: 'Rotate 90° right' }), short: t({ de: 'Rechts', en: 'Right' }), primary: true, onClick: () => turn(targets(), 90) },
        { id: 'half', icon: 'rot180', label: t({ de: 'Um 180° drehen', en: 'Rotate 180°' }), short: '180°', onClick: () => turn(targets(), 180) },
        { id: 'land', icon: 'landscape', label: t({ de: 'Alle Querformat-Seiten auswählen', en: 'Select all landscape pages' }), short: t({ de: 'Quer', en: 'Landscape' }), compact: true, onClick: () => select(landscape) },
        { id: 'port', icon: 'portrait', label: t({ de: 'Alle Hochformat-Seiten auswählen', en: 'Select all portrait pages' }), short: t({ de: 'Hoch', en: 'Portrait' }), compact: true, onClick: () => select(portrait) },
        { id: 'none', icon: 'none', label: t({ de: 'Auswahl aufheben', en: 'Clear selection' }), onClick: () => select(() => false) },
        { id: 'reset', icon: 'undo', label: t({ de: 'Alle Drehungen zurücksetzen', en: 'Reset all rotations' }), onClick: () => { stage.items.forEach(it => { it.rot = 0; }); stage.grid.refresh(); store(); sync(); } },
      ],
      hint: { de: 'Der Drehknopf auf jeder Seite dreht nur diese Seite. Text und Bildqualität bleiben unverändert.', en: 'The round button on each page rotates just that page. Text and image quality stay untouched.' },
      grid: {
        ariaLabel: t({ de: 'Seiten – antippen zum Auswählen', en: 'Pages – tap to select' }),
        cardTools: [{ id: 'rot', icon: 'rotr', label: (item, i) => t({ de: `Seite ${i + 1} nach rechts drehen`, en: `Rotate page ${i + 1} right` }) }],
        onTool: (id, item) => turn([item], 90),
        onKey: (action, item) => turn(stage.grid.selected.has(item.id) ? targets() : [item], action === 'rotl' ? -90 : 90),
        sub: item => (item.rot ? `${item.rot}°` : null),
        onSelect: sync,
      },
      onLoad: () => { values.rot = {}; sync(); },
    });
  },

  async onInputs(inputs) { if (stage) await stage.setInputs(inputs); },

  async run(inputs, opts, ctx) {
    const input = inputs[0];
    const rot = opts.rot || {};
    const keys = Object.keys(rot).filter(k => rot[k]);
    if (!keys.length) throw userError('Drehe zuerst mindestens eine Seite – mit den Pfeilen oben oder dem Knopf auf einer Seite.', 'Rotate at least one page first – with the arrows above or the button on a page.');
    const PDFLib = await loadPdfLib();
    const doc = await input.pdfDoc();
    const pages = doc.getPages();
    for (const k of keys) {
      const p = pages[+k];
      if (p) p.setRotation(PDFLib.degrees(norm(p.getRotation().angle + rot[k])));
    }
    ctx.progress(0.6, { de: 'Wird gespeichert …', en: 'Saving …' });
    await ctx.tick();
    const bytes = await saveLike(doc, input, ctx);
    return { outputs: [{ name: ctx.fileName(input.name, ctx.lang === 'de' ? ' (gedreht)' : ' (rotated)', 'pdf'), blob: pdfBlob(bytes), pages: pages.length }] };
  },
};
