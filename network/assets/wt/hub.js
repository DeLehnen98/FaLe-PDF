// FaLe Werkzeuge – hub page (/werkzeuge/, /en/tools/): instant search, category filter and the
// "what do you want to do with it?" chooser for files shared to the installed app (share target).
// Without JavaScript the page is a plain list of all tools grouped by category.
import './lib/tt.js';
import { el, icon } from './lib/dom.js';
import { accepted } from './lib/files.js';
import { formatSize } from './lib/format.js';
import { peekHandoff, setHandoffTarget, handoffFiles } from './lib/handoff.js';
import { registerSW } from './lib/sw.js';

const cfgEl = document.getElementById('wt-hub-config');
if (cfgEl) init(JSON.parse(cfgEl.textContent));

function init(cfg) {
  const lang = cfg.lang === 'en' ? 'en' : 'de';
  document.documentElement.classList.add('wt-js');
  const fold = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ß/g, 'ss');
  const searchBox = document.querySelector('[data-wt-search]');
  const q = document.querySelector('[data-wt-q]');
  const nohits = document.querySelector('[data-wt-nohits]');
  const live = document.querySelector('[data-wt-hublive]');
  const popular = document.querySelector('[data-wt-popular]');
  const sections = [...document.querySelectorAll('[data-wt-catsec]')];
  const chips = [...document.querySelectorAll('[data-wt-cat]')];
  let cat = '';

  if (searchBox && q) {
    searchBox.hidden = false;
    q.addEventListener('input', apply);
    q.addEventListener('keydown', ev => { if (ev.key === 'Escape') { q.value = ''; apply(); } });
  }
  for (const chip of chips) {
    chip.addEventListener('click', ev => {
      ev.preventDefault();
      cat = chip.dataset.wtCat;
      for (const c of chips) c.setAttribute('aria-current', c === chip ? 'true' : 'false');
      apply();
      history.replaceState(null, '', chip.getAttribute('href'));
      const target = cat ? sections.find(s => s.dataset.wtCatsec === cat) : popular;
      target?.scrollIntoView({ block: 'nearest' });
    });
  }
  // deep link to a category anchor (#bilder) → filter to it
  const fromHash = chips.find(c => c.getAttribute('href') === location.hash && c.dataset.wtCat);
  if (fromHash) fromHash.click();

  function apply() {
    const words = fold(q?.value).split(/\s+/).filter(Boolean);
    let hits = 0;
    for (const sec of sections) {
      let visible = 0;
      for (const card of sec.querySelectorAll('[data-wt-tool]')) {
        const hay = fold(card.dataset.search);
        const show = (!cat || card.dataset.cat === cat) && words.every(w => hay.includes(w));
        card.hidden = !show;
        if (show) visible++;
      }
      sec.hidden = visible === 0;
      hits += visible;
    }
    if (popular) popular.hidden = words.length > 0 || !!cat;
    if (nohits) nohits.hidden = hits > 0;
    if (live && words.length) live.textContent = lang === 'de' ? `${hits} ${hits === 1 ? 'Werkzeug' : 'Werkzeuge'} gefunden` : `${hits} ${hits === 1 ? 'tool' : 'tools'} found`;
  }

  // ---------------------------------------------------------------- files shared to the app
  const params = new URLSearchParams(location.search);
  if (params.has('geteilt') || params.has('shared')) showShared();

  async function showShared() {
    const box = document.querySelector('[data-wt-shared]');
    if (!box) return;
    history.replaceState(null, '', location.pathname + location.hash);
    box.hidden = false;
    const filesP = box.querySelector('[data-wt-shared-files]');
    const listEl = box.querySelector('[data-wt-shared-list]');
    const none = box.querySelector('[data-wt-shared-none]');
    const v = await peekHandoff();
    const files = v ? handoffFiles(v) : [];
    if (!files.length) {
      filesP.textContent = lang === 'de' ? 'Es wurden keine Dateien empfangen. Teile eine PDF oder ein Bild erneut mit „FaLe Werkzeuge“.' : 'No files were received. Share a PDF or an image with “FaLe Tools” again.';
      box.querySelector('h2').focus?.();
      return;
    }
    const total = files.reduce((s, f) => s + f.size, 0);
    filesP.textContent = `${files.map(f => f.name).join(', ')} · ${formatSize(total, lang)}`;
    const items = files.map(f => ({ name: f.name, type: f.type }));
    const fits = cfg.tools.filter(tool => (tool.multiple || files.length === 1) && items.every(it => accepted(it, tool.accepts)));
    for (const tool of fits) {
      const a = el('a', { href: tool.url, onclick: async ev => {
        ev.preventDefault();
        await setHandoffTarget(tool.id);
        location.href = tool.url + (lang === 'de' ? '?weiter=1' : '?continue=1');
      } }, el('span', { class: `wt-chip-ic tic-${tool.colour}` }, icon('arrow')), el('span', { class: 'wt-card-name' }, tool.name), el('span', { class: 'wt-card-desc' }, tool.short));
      listEl.append(el('li', { class: 'wt-card' }, a));
    }
    // a PDF fits ~40 tools – show the most used ones first, the rest on demand (phone screens!)
    const FIRST = 8;
    if (fits.length > FIRST + 2) {
      const rest = [...listEl.children].slice(FIRST);
      rest.forEach(li => { li.hidden = true; });
      const more = el('button', { type: 'button', class: 'wt-btn wt-btn-quiet wt-shared-more', onclick: () => {
        rest.forEach(li => { li.hidden = false; });
        more.remove();
        rest[0].querySelector('a')?.focus();
      } }, lang === 'de' ? `Alle ${fits.length} Werkzeuge anzeigen` : `Show all ${fits.length} tools`);
      listEl.after(more);
    }
    none.hidden = fits.length > 0;
    box.setAttribute('tabindex', '-1');
    box.focus();
  }

  window.addEventListener('load', () => setTimeout(registerSW, 1200));
}
