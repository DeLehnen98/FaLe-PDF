// One search box over everything – runs on this device over the DECRYPTED names and metadata (file names,
// folders, albums, camera, year/month). The server is never asked: it could not read any of it anyway.
import { el, clear, icon } from '../dom.js';
import { t, tp } from '../i18n.js';
import * as E from '../engine.js';
import { itemRow } from './drive.js';
import { displayName } from './common.js';

const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
const MONTHS = {
  de: ['januar', 'februar', 'märz', 'april', 'mai', 'juni', 'juli', 'august', 'september', 'oktober', 'november', 'dezember'],
  en: ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'],
};

export function mount(main, { params, setTitle }) {
  setTitle(t('Suchen'));
  const wrap = el('div.view.search');
  main.appendChild(wrap);
  const input = el('input.input.search-input', { type: 'search', placeholder: t('Dateien, Ordner, Alben, Kamera, Jahr …'), value: params.get('q') || '', autocomplete: 'off', enterkeyhint: 'search', aria: { label: t('Suchen') } });
  const out = el('div.search-out', { aria: { live: 'polite' } });
  wrap.append(el('div.search-box', icon('search'), input), el('p.muted.small', icon('lock'), t('Die Suche läuft nur auf diesem Gerät.')), out);
  let timer = null;
  const run = () => {
    const q = norm(input.value.trim());
    history.replaceState(null, '', '#/suche' + (q ? '?q=' + encodeURIComponent(input.value.trim()) : ''));
    clear(out);
    if (!q) return;
    const words = q.split(/\s+/).filter(Boolean);
    const hay = n => {
      const parts = [n.name];
      if (n.meta && n.meta.exif) parts.push(n.meta.exif.make, n.meta.exif.model, n.meta.exif.lens);
      if (n.meta && n.meta.description) parts.push(n.meta.description);
      if (n.kind === 'photo' || (n.meta && n.meta.takenAt)) { const tk = E.takenOf(n); parts.push(String(tk.y), MONTHS.de[tk.mo - 1], MONTHS.en[tk.mo - 1]); }
      return norm(parts.filter(Boolean).join(' '));
    };
    const hits = [];
    for (const n of E.state.nodes.values()) {
      if (n.trashedAt || n.err) continue;
      const h = hay(n);
      if (words.every(w => h.includes(w))) hits.push(n);
    }
    const albums = [...E.state.albums.values()].filter(a => words.every(w => norm(a.name).includes(w)));
    hits.sort((a, b) => (a.kind === 'folder') !== (b.kind === 'folder') ? (a.kind === 'folder' ? -1 : 1) : norm(a.name).indexOf(words[0]) - norm(b.name).indexOf(words[0]) || a.name.localeCompare(b.name));
    out.append(el('p.muted', tp(hits.length + albums.length, '{n} Treffer', '{n} Treffer')));
    if (albums.length) out.append(el('h3.section-title', t('Alben')), el('div.items.list', albums.map(a => el('a.row', { href: '#/fotos/album/' + a.id }, el('span.row-open.static', el('span.thumb', icon('album')), el('span.row-text', el('span.row-name', a.name), el('span.row-meta', tp((E.state.members.get(a.id) || new Set()).size, '{n} Element', '{n} Elemente'))))))));
    const shown = hits.slice(0, 400);
    if (shown.length) {
      out.append(el('h3.section-title', t('Dateien und Fotos')));
      const box = el('div.items.list', { role: 'list' });
      for (const n of shown) {
        const path = E.pathOf(n.parent).map(displayName).join(' / ') || t('Meine Dateien');
        box.append(itemRow(n, { list: shown, extra: path }));
      }
      out.append(box);
      if (hits.length > shown.length) out.append(el('p.muted', t('Weitere Treffer – verfeinere die Suche.')));
    }
    if (!hits.length && !albums.length) out.append(el('div.empty', el('h3', t('Nichts gefunden')), el('p', t('Probiere einen anderen Begriff, einen Teil des Namens oder ein Jahr.'))));
  };
  input.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(run, 140); });
  setTimeout(() => input.focus(), 50);
  run();
  return { update(w) { if (w.has('nodes')) run(); } };
}
