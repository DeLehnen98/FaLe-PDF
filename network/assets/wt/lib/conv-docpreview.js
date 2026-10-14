// Compact, safe preview of a document model (lib/shared/office/docmodel.js format) on the result card:
// headings, paragraphs with bold/italic, lists, tables and image placeholders – built with el(), no HTML.
import { el } from './dom.js';
import { previewSection } from './conv-common.js';

export function modelPreview(result, model, ctx, { title, maxBlocks = 60 } = {}) {
  const box = el('div', { class: 'cv-doc', tabindex: '0', aria: { label: ctx.t({ de: 'Vorschau des Dokuments', en: 'Document preview' }) } });
  let shown = 0, page = 1;
  let list = null;
  const runs = rs => rs.map(r => {
    if (r.br) return el('br');
    if (r.img) return el('span', { class: 'cv-doc-img' }, ctx.t({ de: 'Bild', en: 'Image' }));
    let n = document.createTextNode(r.text || '');
    if (r.i) n = el('em', {}, n);
    if (r.b) n = el('strong', {}, n);
    return n;
  });
  for (const b of model.blocks) {
    if (shown >= maxBlocks) break;
    if (b.type === 'pagebreak') { page++; list = null; box.append(el('div', { class: 'cv-doc-pb' }, ctx.t({ de: `Seite ${page}`, en: `Page ${page}` }))); continue; }
    if (b.type === 'table') {
      list = null;
      const t = el('table', { class: 'cv-table' });
      const tb = el('tbody');
      b.rows.slice(0, 8).forEach(row => tb.append(el('tr', {}, row.map(c => el('td', {}, c.blocks.flatMap(x => (x.runs ? runs(x.runs) : [])))))));
      t.append(tb);
      box.append(el('div', { class: 'cv-table-wrap' }, t));
      shown++;
      continue;
    }
    if (b.type !== 'para') continue;
    const content = runs(b.runs || []);
    if (b.list) {
      if (!list || list.dataset.root !== String(b.list.root) || list.tagName !== (b.list.ordered ? 'OL' : 'UL')) {
        list = el(b.list.ordered ? 'ol' : 'ul', { dataset: { root: String(b.list.root) } });
        if (b.list.ordered && b.list.index > 1) list.start = b.list.index;
        box.append(list);
      }
      list.append(el('li', {}, content));
    } else {
      list = null;
      const tag = /^h[1-3]$/.test(b.tag) ? `h${Math.min(6, +b.tag[1] + 3)}` : 'p';
      const node = el(tag, { class: /^h/.test(tag) ? 'cv-doc-h' : '' }, content);
      if (b.align === 'center' || b.align === 'right') node.classList.add('cv-doc-' + b.align);
      box.append(node);
    }
    shown++;
  }
  const total = model.blocks.filter(b => b.type === 'para' || b.type === 'table').length;
  const more = total > shown ? el('p', { class: 'cv-muted' }, ctx.t({ de: `… und ${total - shown} weitere Absätze`, en: `… and ${total - shown} more paragraphs` })) : null;
  previewSection(result, ctx.lang, title || { de: 'Erkannte Struktur', en: 'Detected structure' }, box, more);
}
