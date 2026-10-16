// FaLe Vorlagen-Archiv (/vorlagen/, /en/templates/): instant search + Berufsfeld/Situation filter on the job
// directory, "copy text" on the example letters, offline caching via the site's service worker.
// Without JavaScript every page is complete: all jobs are listed, the letters are plain text and the
// "Vorlage verwenden" buttons are ordinary links (?vorlage=<id>) into the CV builder / cover letter tools.
import './lib/tt.js';
import { registerSW } from './lib/sw.js';

const cfgEl = document.getElementById('vl-config');

function init(cfg) {
  document.documentElement.classList.add('wt-js');
  if (cfg.page === 'section') directory(cfg);
  if (cfg.page === 'hub' && cfg.jump) jumpSearch(cfg);
  copyButtons(cfg);
  const idle = window.requestIdleCallback || (fn => setTimeout(fn, 1500));
  idle(() => { registerSW().catch(() => {}); });
}

const fold = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ß/g, 'ss');
// the build folds ä → ae etc.; fold the query the same way so "kuche" and "küche" both find "Küche"
const foldDe = s => String(s || '').toLowerCase().replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss');

// hub: the job search lives on the directory page – this box just opens it with ?q= (no form: CSP form-action 'none')
function jumpSearch(cfg) {
  const box = document.querySelector('[data-vl-jump]');
  const q = document.querySelector('[data-vl-jump-q]');
  if (!box || !q) return;
  box.hidden = false;
  const go = () => { const v = q.value.trim().slice(0, 80); location.href = cfg.jump + (v ? '?q=' + encodeURIComponent(v) : ''); };
  q.addEventListener('keydown', ev => { if (ev.key === 'Enter') { ev.preventDefault(); go(); } });
  document.querySelector('[data-vl-jump-go]')?.addEventListener('click', go);
}

function directory(cfg) {
  const q = document.querySelector('[data-vl-q]');
  const count = document.querySelector('[data-vl-count]');
  const nohits = document.querySelector('[data-vl-nohits]');
  const groups = [...document.querySelectorAll('[data-vl-group]')];
  const cards = [...document.querySelectorAll('.vl-card')];
  // haystack = synonyms from data-search + the visible card text (name, short line, situation pills), folded like the build
  const hays = new Map(cards.map(c => [c, `${c.dataset.search || ''} ${fold(foldDe(c.textContent))}`.replace(/\s+/g, ' ')]));
  const state = { field: '', level: '' };
  document.querySelectorAll('[data-vl-search], [data-vl-filter]').forEach(n => { n.hidden = false; });
  const params = new URLSearchParams(location.search);
  if (q && params.get('q')) q.value = params.get('q').slice(0, 80);
  for (const kind of ['field', 'level']) {
    const btns = [...document.querySelectorAll(`[data-vl-${kind}]`)];
    const want = params.get(kind === 'field' ? 'feld' : 'situation') || '';
    if (want && btns.some(b => b.dataset[`vl${kind[0].toUpperCase()}${kind.slice(1)}`] === want)) state[kind] = want;
    const sync = () => btns.forEach(b => b.setAttribute('aria-pressed', String(b.getAttribute(`data-vl-${kind}`) === state[kind])));
    btns.forEach(b => b.addEventListener('click', () => { state[kind] = b.getAttribute(`data-vl-${kind}`); sync(); apply(); }));
    sync();
  }
  // Berufsfelder are collapsible <details>: a search or filter opens the fields with hits; clearing it restores
  // whatever the visitor had opened by hand. A link to #feld-… opens that field.
  const userOpen = new Set();
  const autoSet = new WeakMap();   // details we opened/closed ourselves → their toggle event is not the visitor's
  for (const g of groups) {
    if (g.tagName !== 'DETAILS') continue;
    g.addEventListener('toggle', () => {
      if (autoSet.get(g) === g.open) { autoSet.delete(g); return; }
      autoSet.delete(g);
      if (g.open) userOpen.add(g); else userOpen.delete(g);
    });
  }
  function setOpen(g, open) {
    if (g.tagName !== 'DETAILS' || g.open === open) return;
    autoSet.set(g, open);
    g.open = open;
  }
  const fromHash = location.hash && groups.find(g => '#' + g.id === location.hash);
  if (fromHash && fromHash.tagName === 'DETAILS') { fromHash.open = true; userOpen.add(fromHash); }
  let timer = 0;
  q?.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(apply, 60); });
  q?.addEventListener('keydown', ev => { if (ev.key === 'Escape') { q.value = ''; apply(); } });

  function apply() {
    const words = (q ? q.value : '').trim().split(/\s+/).filter(Boolean).map(w => [fold(w), foldDe(w)]);
    let n = 0;
    for (const c of cards) {
      const hay = hays.get(c);
      const ok = (!state.field || c.dataset.field === state.field)
        && (!state.level || (c.dataset.levels || '').split(' ').includes(state.level))
        && words.every(([a, b]) => hay.includes(a) || hay.includes(b));
      c.hidden = !ok;
      if (ok) n++;
    }
    const filtering = words.length > 0 || !!state.field || !!state.level;
    for (const g of groups) {
      const any = [...g.querySelectorAll('.vl-card')].some(c => !c.hidden);
      g.hidden = !any;
      setOpen(g, filtering ? any : userOpen.has(g));
    }
    if (nohits) nohits.hidden = n > 0;
    if (count) count.textContent = n === 1 ? cfg.hit1 : String(cfg.hits || '{n}').replace('{n}', n);
    // keep the filter in the address bar (shareable), without adding history entries
    const p = new URLSearchParams();
    if (q && q.value.trim()) p.set('q', q.value.trim());
    if (state.field) p.set('feld', state.field);
    if (state.level) p.set('situation', state.level);
    const qs = p.toString();
    history.replaceState(history.state, '', location.pathname + (qs ? '?' + qs : '') + location.hash);
  }
  apply();
}

function copyButtons(cfg) {
  for (const btn of document.querySelectorAll('[data-vl-copy]')) {
    const target = document.getElementById(btn.dataset.vlCopy);
    if (!target) continue;
    btn.hidden = false;
    const label = btn.textContent;
    btn.addEventListener('click', async () => {
      const text = [...target.querySelectorAll('p')].map(p => p.innerText.trim()).filter(Boolean).join('\n\n');
      let ok = false;
      try { await navigator.clipboard.writeText(text); ok = true; } catch {
        try {
          const r = document.createRange(); r.selectNodeContents(target);
          const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r);
          ok = document.execCommand('copy'); sel.removeAllRanges();
        } catch { ok = false; }
      }
      if (ok) { btn.textContent = cfg.copied || '✓'; setTimeout(() => { btn.textContent = label; }, 1800); }
    });
  }
}

// last, so every const above (fold, foldDe, …) is initialised before init() runs
if (cfgEl) init(JSON.parse(cfgEl.textContent));
