// Full-screen tool container.
import { icon } from './icons.js';
import { esc, h, $, choosePdfs } from './ui.js';
import * as db from './db.js';
import { thumbHtml, docMeta } from './components.js';
import { importFiles } from './library.js';

let current = null;

export function openScreen({ title, sub = '', onBack }) {
  closeScreen();
  const root = document.getElementById('tool-screen');
  root.innerHTML = '';
  const ac = new AbortController();
  const head = h(`<header class="screen-head">
      <button class="icon-btn" type="button" data-back aria-label="Zurück">${icon('back')}</button>
      <div class="grow"><h1 class="screen-title">${esc(title)}</h1><div class="sub">${esc(sub)}</div></div>
      <div class="screen-extra"></div></header>`);
  const body = h('<div class="screen-body"></div>');
  const foot = h('<footer class="screen-foot" hidden></footer>');
  root.append(head, body, foot);
  root.hidden = false;
  head.querySelector('[data-back]').addEventListener('click', () => (onBack ? onBack() : null));
  current = {
    root, head, body, foot, signal: ac.signal, cleanup: null,
    extra: head.querySelector('.screen-extra'),
    setTitle(t, s) {
      if (t != null) head.querySelector('.screen-title').textContent = t;
      if (s != null) head.querySelector('.sub').textContent = s;
    },
    setFoot(nodes, info = '') {
      foot.innerHTML = '';
      if (info) foot.appendChild(h(`<span class="foot-info">${esc(info)}</span>`));
      (nodes || []).forEach(n => foot.appendChild(n));
      foot.hidden = !(nodes && nodes.length) && !info;
    },
    _ac: ac,
  };
  return current;
}

export function closeScreen() {
  if (!current) return;
  try { current._ac.abort(); } catch {}
  try { current.cleanup && current.cleanup(); } catch (e) { console.warn(e); }
  current.root.hidden = true;
  current.root.innerHTML = '';
  current = null;
}

export function screenOpen() { return !!current; }
export function currentScreen() { return current; }

/** In-screen document chooser (used when a tool is opened without a document). */
export async function renderChooser(screen, { text = 'Wähle ein Dokument aus deiner Bibliothek oder öffne eine PDF von deinem Gerät.', onPick }) {
  const docs = await db.listDocs();
  const wrap = h(`<div class="screen-inner">
    <div class="card intro"><span class="tile-ic">${icon('file')}</span><div><strong>Dokument wählen</strong><p>${esc(text)}</p></div></div>
    <button class="btn btn-primary" type="button" data-dev>${icon('open')} Vom Gerät öffnen</button>
    <h2 class="section-title">Deine Dokumente</h2>
    <div class="doc-list chooser"></div></div>`);
  const list = $('.chooser', wrap);
  if (!docs.length) list.appendChild(h('<p class="panel-empty">Noch keine Dokumente vorhanden.</p>'));
  docs.forEach(d => {
    const b = h(`<button class="doc doc-open" type="button" style="padding:10px" data-id="${esc(d.id)}">${thumbHtml(d)}
      <span class="doc-info"><span class="doc-name">${esc(d.name)}</span><span class="doc-meta">${docMeta(d)}</span></span></button>`);
    b.addEventListener('click', () => onPick(d));
    list.appendChild(b);
  });
  $('[data-dev]', wrap).addEventListener('click', async () => {
    const files = await choosePdfs();
    if (!files.length) return;
    const added = await importFiles(files, { source: 'Gerät' });
    if (added[0]) onPick(added[0]);
  });
  screen.body.innerHTML = '';
  screen.body.appendChild(wrap);
  screen.setFoot([]);
}
