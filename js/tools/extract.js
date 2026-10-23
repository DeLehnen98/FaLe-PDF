// Tool: extract pages — pick pages (tap or range), save as one new PDF or as single-page files.
import { icon } from '../icons.js';
import { h, esc, toast, errorToast, progress, downloadBlob, baseName } from '../ui.js';
import { resultCard } from '../components.js';
import { saveResult } from '../library.js';
import { loadPdf, renderPage, renderThumb } from '../pdfcore.js';
import { loadEditable, loadPdfLib, saveDoc } from '../pdflib.js';
import { createZip } from '../zip.js';
import { openToolDoc, parseRange, tick, updateFoot } from './common.js';

function rangeString(nums) {
  const out = [];
  for (let i = 0; i < nums.length; i++) {
    let j = i;
    while (j + 1 < nums.length && nums[j + 1] === nums[j] + 1) j++;
    out.push(j > i ? `${nums[i]}-${nums[j]}` : `${nums[i]}`);
    i = j;
  }
  return out.join(', ');
}

export async function mount(screen, { docId }) {
  const ctx = await openToolDoc(screen, docId, 'Seiten extrahieren');
  if (!ctx) return;
  const { doc, bytes } = ctx;
  const { pdf } = await loadPdf(bytes.slice(), { name: doc.name, key: docId });
  const n = pdf.numPages;
  const sel = new Set();
  let alive = true;

  const wrap = h(`<div class="screen-inner">
    <div class="card intro"><span class="tile-ic">${icon('extract')}</span><div><strong>${esc(doc.name)}</strong>
      <p>Tippe Seiten an oder gib einen Bereich ein. Die ausgewählten Seiten werden als neue PDF gespeichert – das Original bleibt unverändert.</p></div></div>
    <div class="pt-extract-bar">
      <label class="field pt-range-field"><span class="field-label">Seiten</span>
        <input class="input" data-range placeholder="z. B. 1-3, 5" inputmode="text" aria-label="Seitenbereich"></label>
      <div class="seg" role="group" aria-label="Schnellauswahl">
        <button type="button" data-q="all">Alle</button><button type="button" data-q="odd">Ungerade</button>
        <button type="button" data-q="even">Gerade</button><button type="button" data-q="none">Keine</button>
      </div>
    </div>
    <div class="page-grid" data-grid></div>
    <h2 class="section-title">Ausgabe</h2>
    <div class="option-grid" role="radiogroup" aria-label="Ausgabe">
      <label class="radio-card"><input type="radio" name="out" value="one" checked><span><strong>Eine PDF</strong><span>Alle ausgewählten Seiten in einer neuen Datei.</span></span></label>
      <label class="radio-card"><input type="radio" name="out" value="single"><span><strong>Jede Seite einzeln</strong><span>Eine Datei pro Seite – zusätzlich als ZIP zum Herunterladen.</span></span></label>
    </div>
    <div data-result></div></div>`);
  screen.body.appendChild(wrap);
  const grid = wrap.querySelector('[data-grid]');
  const rangeIn = wrap.querySelector('[data-range]');
  const resultBox = wrap.querySelector('[data-result]');
  const btn = h(`<button class="btn btn-primary" type="button">${icon('extract')} Extrahieren</button>`);

  const io = new IntersectionObserver(entries => {
    entries.forEach(async en => {
      if (!en.isIntersecting) return;
      io.unobserve(en.target);
      try {
        const page = await pdf.getPage(+en.target.dataset.n);
        if (!alive) return;
        const c = await renderThumb(page, { width: 150, dpr: Math.min(2, window.devicePixelRatio || 1) });
        const box = en.target.querySelector('.pcard-thumb');
        box.innerHTML = '';
        box.appendChild(c);
        page.cleanup();
      } catch (e) { if (alive) console.warn(e); }
    });
  }, { root: screen.body, rootMargin: '400px 0px' });

  for (let i = 1; i <= n; i++) {
    const card = h(`<div class="pcard" data-n="${i}">
      <button class="pcard-thumb" type="button" aria-pressed="false" aria-label="Seite ${i} auswählen"><span class="spinner dark"></span></button>
      <span class="pcard-check" aria-hidden="true">${icon('check')}</span>
      <div class="pcard-foot"><span class="pcard-num">Seite ${i}</span></div></div>`);
    card.querySelector('.pcard-thumb').addEventListener('click', () => { if (sel.has(i)) sel.delete(i); else sel.add(i); sync(true); });
    grid.appendChild(card);
    io.observe(card);
    if (i % 50 === 0) await tick();
  }

  function sync(updateInput) {
    grid.querySelectorAll('.pcard').forEach(c => {
      const on = sel.has(+c.dataset.n);
      c.classList.toggle('selected', on);
      c.querySelector('.pcard-thumb').setAttribute('aria-pressed', String(on));
    });
    const nums = [...sel].sort((a, b) => a - b);
    if (updateInput) rangeIn.value = rangeString(nums);
    btn.disabled = !nums.length;
    updateFoot(screen, [btn], nums.length ? `${nums.length} von ${n} Seite${n === 1 ? '' : 'n'} ausgewählt` : 'Keine Seite ausgewählt');
  }

  rangeIn.addEventListener('input', () => {
    if (!rangeIn.value.trim()) { sel.clear(); sync(false); return; }
    const nums = parseRange(rangeIn.value, n);
    rangeIn.classList.toggle('invalid', !nums);
    if (!nums) return;
    sel.clear();
    nums.forEach(x => sel.add(x));
    sync(false);
  });
  wrap.querySelectorAll('[data-q]').forEach(b => b.addEventListener('click', () => {
    sel.clear();
    for (let i = 1; i <= n; i++) {
      if (b.dataset.q === 'all' || (b.dataset.q === 'odd' && i % 2) || (b.dataset.q === 'even' && !(i % 2))) sel.add(i);
    }
    sync(true);
  }));

  btn.addEventListener('click', async () => {
    const nums = [...sel].sort((a, b) => a - b);
    if (!nums.length) { toast('Bitte wähle mindestens eine Seite.', 'error'); return; }
    const single = wrap.querySelector('input[name="out"]:checked').value === 'single';
    btn.disabled = true;
    const prog = progress('Extrahiere Seiten …');
    try {
      const src = await loadEditable(bytes, doc.name, { key: docId });
      const { PDFDocument } = await loadPdfLib();
      const title = src.getTitle();
      resultBox.innerHTML = '';
      if (!single) {
        const out = await PDFDocument.create();
        const pages = await out.copyPages(src, nums.map(x => x - 1));
        pages.forEach(p => out.addPage(p));
        if (title) out.setTitle(title);
        const label = nums.length > 6 ? `${nums.length} Seiten` : `S. ${rangeString(nums)}`;
        const res = await saveResult(await saveDoc(out), `${baseName(doc.name)} – ${label}.pdf`);
        resultBox.appendChild(resultCard(res, { title: `${nums.length} Seite${nums.length === 1 ? '' : 'n'} extrahiert` }));
      } else {
        const files = [];
        const width = String(n).length;
        for (let k = 0; k < nums.length; k++) {
          prog.set(`Extrahiere Seite ${k + 1}/${nums.length} …`);
          const out = await PDFDocument.create();
          const [p] = await out.copyPages(src, [nums[k] - 1]);
          out.addPage(p);
          if (title) out.setTitle(title);
          const b = await saveDoc(out);
          const name = `${baseName(doc.name)} – Seite ${String(nums[k]).padStart(width, '0')}.pdf`;
          files.push({ name, data: b });
          if (nums.length <= 30) await saveResult(b, name);
          await tick();
        }
        const zip = await createZip(files);
        const card = h(`<div class="card result-card"><span class="tile-ic">${icon('split')}</span><div class="grow">
          <div class="result-title">${icon('check')} Extrahiert</div><div class="doc-name">${files.length} Einzelseite${files.length === 1 ? '' : 'n'}${nums.length <= 30 ? ' – in der Bibliothek gespeichert' : ''}</div></div>
          <div class="actions"><button class="btn btn-primary btn-sm" type="button" data-zip>${icon('download')} ZIP herunterladen</button>
          <a class="btn btn-ghost btn-sm" href="#/dateien">Zu den Dateien</a></div></div>`);
        card.querySelector('[data-zip]').addEventListener('click', () => downloadBlob(zip, `${baseName(doc.name)} – Seiten.zip`));
        resultBox.appendChild(card);
      }
      resultBox.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      toast('Seiten extrahiert.', 'success');
    } catch (e) { errorToast(e, 'Extrahieren fehlgeschlagen.'); }
    finally { prog.done(); btn.disabled = !sel.size; }
  });

  sync(true);
  return () => { alive = false; io.disconnect(); pdf.destroy(); };
}
