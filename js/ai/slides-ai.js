// „Folien per KI“: topic (and optionally a document) → JSON outline from the AI → the existing
// deck generator (js/office/outline.js) → editable presentation.
import { $, $$, h, esc, toast } from '../ui.js';
import { oicon } from '../office/kinds.js';
import * as C from './client.js';
import { statusCard, docChip, getDoc, gate, docPicker } from './common.js';
import { ensureCloud, showAiError, progressNote } from './ui.js';
import { docText } from './doctext.js';

/** AI outline JSON → outline text understood by parseOutline(). */
export function outlineToText(o) {
  const lines = [`# ${o.title}`];
  for (const s of o.slides || []) {
    lines.push(s.heading);
    for (const b of s.bullets || []) lines.push(`${'  '.repeat(Math.min(2, b.level || 0))}- ${b.text}`);
    if (s.notes) lines.push(`> ${s.notes.replace(/\n+/g, ' ')}`);
  }
  return lines.join('\n');
}

export async function mount(screen, { params }) {
  let doc = await getDoc(params.get('doc'));
  const [{ SLIDE_THEMES }, outline, { slidePreview }, slidesMod] = await Promise.all([
    import('../office/templates.js'), import('../office/outline.js'), import('../office/slide-render.js'), import('../office/slides.js'),
  ]);
  let go = null; // assigned below (status callbacks may fire earlier)
  const st = statusCard({ onChange: s => gate([go], s) });
  const wrap = h(`<div class="screen-inner ai-slides">
    <div data-status></div>
    <div class="card card-pad ai-options">
      <label class="field"><span class="field-label">Thema der Präsentation</span><input class="input" name="topic" maxlength="300" placeholder="z. B. Klimaschutz in unserer Schule" data-no-i18n></label>
      <div class="field"><span class="field-label">Grundlage (optional)</span><div data-docbox></div></div>
      <div class="field-row">
        <label class="field"><span class="field-label">Anzahl Inhaltsfolien</span><select class="select" name="count">${[4, 5, 6, 7, 8, 10, 12].map(n => `<option ${n === 6 ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
        <label class="field"><span class="field-label">Zielgruppe (optional)</span><input class="input" name="audience" maxlength="200" placeholder="z. B. Klasse 9, Kunden, Team" data-no-i18n></label>
      </div>
      <div class="field"><span class="field-label">Design</span><div class="ol-themes" role="radiogroup" aria-label="Design">${SLIDE_THEMES.map((t, i) => `<button type="button" class="theme-card ol-theme${i === 0 ? ' on' : ''}" role="radio" aria-checked="${i === 0}" data-theme="${t.id}" style="background:${t.bg};color:${t.title}"><span class="tc-bar" style="background:${t.accent}"></span><strong style="font-family:${t.font}">${t.name}</strong></button>`).join('')}</div></div>
    </div>
    <p class="ai-prep muted small" data-prep hidden></p>
    <section class="card ai-result" data-result hidden>
      <div class="ai-result-head"><strong data-count>Vorschau</strong><span class="ai-res-acts"><button class="btn btn-ghost btn-sm" type="button" data-edit>${oicon('edit')} Gliederung bearbeiten</button></span></div>
      <div class="ol-prev ai-slide-prev" data-prev></div>
    </section>
  </div>`);
  $('[data-status]', wrap).appendChild(st.el);
  const docBox = $('[data-docbox]', wrap), prev = $('[data-prev]', wrap), prep = $('[data-prep]', wrap), result = $('[data-result]', wrap);
  const renderDoc = async () => {
    docBox.innerHTML = '';
    if (doc) docBox.appendChild(docChip(doc, () => { doc = null; renderDoc(); }));
    else {
      const b = h(`<button class="btn btn-ghost btn-sm" type="button">${oicon('file')} Dokument als Grundlage wählen</button>`);
      b.addEventListener('click', async () => {
        const picker = await docPicker({ title: 'Grundlage wählen', onPick: d => { doc = d; renderDoc(); } });
        docBox.innerHTML = ''; docBox.appendChild(picker);
      });
      docBox.appendChild(b);
    }
  };
  await renderDoc();
  if (doc) $('[name=topic]', wrap).value = doc.name.replace(/\.[^.]+$/, '');
  let themeId = SLIDE_THEMES[0].id;
  $$('.ol-theme', wrap).forEach(b => b.addEventListener('click', () => { themeId = b.dataset.theme; $$('.ol-theme', wrap).forEach(x => { x.classList.toggle('on', x === b); x.setAttribute('aria-checked', String(x === b)); }); if (data) render(); }));
  screen.body.appendChild(wrap);

  go = h(`<button class="btn btn-primary" type="button" data-go>${oicon('sparkle')} Gliederung erstellen</button>`);
  const create = h(`<button class="btn btn-primary" type="button" data-create hidden>${oicon('kslides')} Präsentation erstellen</button>`);
  screen.setFoot([go, create]);
  gate([go], st.state());

  let data = null, deck = null;
  const opts = () => ({ themeId, title: data.title, subtitle: data.subtitle || '', agenda: true });
  function render() {
    deck = outline.buildDeck(outline.parseOutline(outlineToText(data)), opts());
    prev.innerHTML = '';
    $('[data-count]', wrap).textContent = `Vorschau · ${deck.slides.length} Folien`;
    const w = Math.floor(matchMedia('(max-width: 720px)').matches ? Math.max(120, (prev.clientWidth - 12) / 2) : 220);
    prev.style.setProperty('--olw', `${w}px`);
    deck.slides.forEach((sl, i) => { const it = h(`<div class="ol-slide"><span class="ol-num">${i + 1}</span></div>`); it.appendChild(slidePreview(deck, sl, w)); prev.appendChild(it); });
  }

  go.addEventListener('click', async () => {
    const topic = $('[name=topic]', wrap).value.trim();
    if (!topic && !doc) { toast('Bitte gib ein Thema ein oder wähle ein Dokument.', 'error'); $('[name=topic]', wrap).focus(); return; }
    if (!await ensureCloud()) return;
    go.disabled = true;
    try {
      let text = '';
      if (doc) { prep.hidden = false; text = (await docText(doc, { signal: screen.signal, onProgress: (p, l) => progressNote(prep, l) })).text.slice(0, 12000); }
      progressNote(prep, 'Die KI erstellt die Gliederung …');
      const r = await C.runTask('slides', { topic, text, audience: $('[name=audience]', wrap).value.trim() }, { count: +$('[name=count]', wrap).value });
      data = r.output;
      result.hidden = false;
      render();
      create.hidden = false;
      go.innerHTML = `${oicon('restore')} Neu erstellen`;
      result.scrollIntoView({ block: 'start', behavior: 'smooth' });
    } catch (e) { showAiError(e); }
    finally { go.disabled = false; progressNote(prep, ''); }
  });
  create.addEventListener('click', () => {
    if (!deck) return;
    slidesMod.slideHandoff.pres = deck;
    slidesMod.slideHandoff.name = (data.title || 'Präsentation').replace(/[\\/:*?"<>|]+/g, ' ').slice(0, 80);
    location.hash = '#/neu/praesentation?gliederung=1';
  });
  $('[data-edit]', wrap).addEventListener('click', () => {
    if (!data) return;
    const text = outlineToText(data);
    location.hash = '#/gliederung';
    // fill the outline editor once it is mounted
    let tries = 0;
    const t = setInterval(() => {
      const app = document.querySelector('.ol-app');
      if (app && app._outlineApi) { clearInterval(t); app._outlineApi.setText(text); }
      else if (++tries > 40) clearInterval(t);
    }, 100);
  });
  return () => st.el._dispose && st.el._dispose();
}
