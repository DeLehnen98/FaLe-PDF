// „Was hat sich geändert?“ (#/ki/vergleichen): two versions of a document (old/new contract, tariff, terms) →
// the changes in plain words („alt → neu“). Only the text of the two chosen documents is sent.
import { $, h, esc, toast } from '../ui.js';
import { oicon } from '../office/kinds.js';
import * as C from './client.js';
import { statusCard, docPicker, docChip, getDoc, gate } from './common.js';
import { ensureCloud, showAiError, richText, resultActions, progressNote } from './ui.js';
import { docText } from './doctext.js';
import { outputLang } from './config.js';

const MAX = 16000; // per document (= api/_lib/tasks.js compare.maxInput)

export async function mount(screen, { params }) {
  const docs = { a: await getDoc(params.get('doc')), b: await getDoc(params.get('doc2')) };
  let go = null, ac = null;
  const st = statusCard({ onChange: s => gate([go], s) });
  const wrap = h(`<div class="screen-inner ai-compare">
    <div data-status></div>
    <section class="ai-cmp-slot" data-slot="a"><h2 class="section-title"><span class="ai-cmp-n">1</span> Ältere Fassung</h2><div data-box></div></section>
    <section class="ai-cmp-slot" data-slot="b"><h2 class="section-title"><span class="ai-cmp-n">2</span> Neuere Fassung</h2><div data-box></div></section>
    <p class="ai-prep muted small" data-prep hidden></p>
    <section class="card ai-result" data-result hidden>
      <div class="ai-result-head"><strong>Was hat sich geändert?</strong><span class="muted small" data-meta></span></div>
      <p class="ai-note-line" data-note hidden></p>
      <div class="ai-output" data-out data-no-i18n></div>
      <div data-acts></div>
    </section>
    <p class="ai-disclaimer">${oicon('info')}<span>KI kann Fehler machen. Prüfe Preise, Fristen und Bedingungen im Original – das ist keine Rechtsberatung.</span></p>
  </div>`);
  $('[data-status]', wrap).appendChild(st.el);
  screen.body.appendChild(wrap);
  const prep = $('[data-prep]', wrap), result = $('[data-result]', wrap), out = $('[data-out]', wrap), noteEl = $('[data-note]', wrap);

  const sync = () => history.replaceState(null, '', `#/ki/vergleichen${docs.a ? `?doc=${encodeURIComponent(docs.a.id)}` : ''}${docs.b ? `${docs.a ? '&' : '?'}doc2=${encodeURIComponent(docs.b.id)}` : ''}`);
  async function renderSlot(k) {
    const box = $(`[data-slot="${k}"] [data-box]`, wrap);
    box.innerHTML = '';
    if (docs[k]) { box.appendChild(docChip(docs[k], () => { docs[k] = null; sync(); renderSlot(k); updateGo(); })); return; }
    box.appendChild(await docPicker({
      title: '', hint: k === 'a' ? 'Zum Beispiel der bisherige Vertrag oder die alten Bedingungen.' : 'Zum Beispiel das neue Angebot oder die geänderten Bedingungen.',
      onPick: d => {
        if (docs[k === 'a' ? 'b' : 'a'] && docs[k === 'a' ? 'b' : 'a'].id === d.id) { toast('Wähle zwei verschiedene Dokumente.', 'error'); return; }
        docs[k] = d; sync(); renderSlot(k); updateGo();
        if (k === 'a' && !docs.b) $('[data-slot="b"]', wrap).scrollIntoView({ block: 'start', behavior: 'smooth' });
      },
    }));
  }
  await renderSlot('a'); await renderSlot('b');

  go = h(`<button class="btn btn-primary" type="button" data-go>${oicon('compare')} Vergleichen</button>`);
  screen.setFoot([go]);
  const updateGo = () => gate([go], st.state());
  updateGo();
  const title = d => d.name.replace(/\.[^.]+$/, '');
  $('[data-acts]', wrap).appendChild(resultActions(() => out.dataset.raw || '', {
    title: () => `Vergleich ${docs.a ? title(docs.a) : ''} – ${docs.b ? title(docs.b) : ''}`,
    heading: () => `Was hat sich geändert? ${docs.a ? title(docs.a) : ''} → ${docs.b ? title(docs.b) : ''}`,
    sayLang: () => outputLang(),
  }));

  go.addEventListener('click', async () => {
    if (ac) { ac.abort(); return; }
    if (!docs.a || !docs.b) { toast(!docs.a ? 'Wähle zuerst die ältere Fassung.' : 'Wähle noch die neuere Fassung.', 'error'); return; }
    if (!await ensureCloud()) return;
    ac = new AbortController();
    go.disabled = true;
    try {
      prep.hidden = false;
      const read = async (d, n) => (await docText(d, { signal: ac.signal, onProgress: (p, l) => progressNote(prep, `${n}: ${l} ${p ? Math.round(p * 100) + ' %' : ''}`) })).text;
      const ta = await read(docs.a, 'Dokument 1'), tb = await read(docs.b, 'Dokument 2');
      progressNote(prep, '');
      if (ta.trim().length < 40 || tb.trim().length < 40) throw Object.assign(new Error('short'), { userMessage: 'In einem der Dokumente steht zu wenig Text zum Vergleichen.' });
      if (ta.trim() === tb.trim()) { result.hidden = false; out.dataset.raw = 'Die beiden Dokumente haben genau denselben Text – es hat sich nichts geändert.'; out.innerHTML = richText(out.dataset.raw, { cite: false }); noteEl.hidden = true; return; }
      result.hidden = false;
      noteEl.hidden = true;
      out.dataset.raw = '';
      out.innerHTML = '<span class="ai-typing" aria-label="KI schreibt"><i></i><i></i><i></i></span>';
      result.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      const r = await C.runTask('compare', { a: ta.slice(0, MAX), b: tb.slice(0, MAX), titleA: docs.a.name, titleB: docs.b.name }, {}, {
        stream: true, signal: ac.signal, onDelta: (t, full) => { out.innerHTML = richText(full, { cite: false }); },
      });
      out.dataset.raw = r.output;
      out.innerHTML = richText(r.output, { cite: false });
      const notes = [];
      if (ta.length > MAX || tb.length > MAX) notes.push(`Die Dokumente sind sehr lang – verglichen wurden jeweils die ersten ca. ${MAX.toLocaleString('de-DE')} Zeichen.`);
      if (r.partial) notes.push(r.partialMessage);
      noteEl.hidden = !notes.length;
      noteEl.innerHTML = notes.length ? `${oicon('info')}<span>${esc(notes.join(' '))}</span>` : '';
      $('[data-meta]', wrap).textContent = 'Cloud-KI';
    } catch (e) {
      if (e && e.name === 'AbortError') toast('Abgebrochen', 'info');
      else { if (!out.dataset.raw) result.hidden = true; showAiError(e); }
    } finally { ac = null; go.disabled = false; progressNote(prep, ''); updateGo(); }
  });
  return () => { if (ac) ac.abort(); st.el._dispose && st.el._dispose(); };
}
