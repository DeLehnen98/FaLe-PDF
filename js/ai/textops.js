// Zusammenfassen (#/ki/zusammenfassen) and Übersetzen (#/ki/uebersetzen): document or pasted text,
// on-device (Chrome built-in AI, where available) or cloud AI; result as .docx / .txt / PDF.
import { $, $$, h, esc, toast } from '../ui.js';
import { oicon } from '../office/kinds.js';
import * as C from './client.js';
import { statusCard, docPicker, docChip, getDoc, gate } from './common.js';
import { ensureCloud, showAiError, richText, resultActions, engineSwitch, progressNote } from './ui.js';
import { docText } from './doctext.js';
import { AI_CONFIG, TARGET_LANGS, outputLang } from './config.js';

/** Split text into parts ≤ max chars at paragraph boundaries. */
export function splitParts(text, max) {
  const paras = String(text).split(/\n{2,}/);
  const parts = [];
  let cur = '';
  for (const p of paras) {
    if (cur && cur.length + p.length + 2 > max) { parts.push(cur); cur = ''; }
    if (p.length > max) { for (let i = 0; i < p.length; i += max) parts.push(p.slice(i, i + max)); continue; }
    cur += (cur ? '\n\n' : '') + p;
  }
  if (cur) parts.push(cur);
  return parts;
}

export async function mount(screen, { params, op }) {
  const isSum = op === 'summarize';
  let doc = await getDoc(params.get('doc'));
  let source = doc ? 'doc' : (params.get('text') ? 'text' : 'doc');
  const engine = await engineSwitch(isSum ? 'summarize' : 'translate');
  let go = null; // assigned below (status callbacks may fire earlier)
  const st = statusCard({ onChange: s => updateGate(s) });
  const wrap = h(`<div class="screen-inner ai-textops">
    <div data-status></div>
    <div class="seg ai-source" role="group" aria-label="Quelle">
      <button type="button" data-src="doc">${oicon('file')} Dokument</button><button type="button" data-src="text">${oicon('notes')} Text einfügen</button></div>
    <div data-srcbox></div>
    <div class="card card-pad ai-options">
      ${isSum ? `<div class="field"><span class="field-label">Art der Zusammenfassung</span>
        <div class="seg" role="group" aria-label="Art der Zusammenfassung"><button type="button" data-mode="kurz" aria-pressed="true">Kurz</button><button type="button" data-mode="stichpunkte" aria-pressed="false">Stichpunkte</button><button type="button" data-mode="ausfuehrlich" aria-pressed="false">Ausführlich</button></div></div>`
      : `<label class="field"><span class="field-label">Übersetzen nach</span><select class="select" name="target">${TARGET_LANGS.map(([k, l]) => `<option value="${k}">${esc(l)}</option>`).join('')}</select></label>`}
      <div class="field" data-engine-field><span class="field-label">Wo soll die KI rechnen?</span></div>
    </div>
    <p class="ai-prep muted small" data-prep hidden></p>
    <section class="card ai-result" data-result hidden>
      <div class="ai-result-head"><strong>${isSum ? 'Zusammenfassung' : 'Übersetzung'}</strong><span class="muted small" data-meta></span></div>
      <p class="ai-note-line" data-note hidden></p>
      <div class="ai-output" data-out data-no-i18n></div>
      <div data-more></div>
      <div data-acts></div>
    </section>
  </div>`);
  $('[data-status]', wrap).appendChild(st.el);
  const engineField = $('[data-engine-field]', wrap);
  engineField.appendChild(engine);
  engineField.hidden = !engine.hasLocal;
  const srcBox = $('[data-srcbox]', wrap), prep = $('[data-prep]', wrap), result = $('[data-result]', wrap), out = $('[data-out]', wrap);
  const noteEl = $('[data-note]', wrap), more = $('[data-more]', wrap), metaEl = $('[data-meta]', wrap);
  if (!isSum) $('[name=target]', wrap).value = outputLang() === 'de' ? 'en' : 'de';
  let mode = 'kurz';
  $$('[data-mode]', wrap).forEach(b => b.addEventListener('click', () => { mode = b.dataset.mode; $$('[data-mode]', wrap).forEach(x => x.setAttribute('aria-pressed', String(x === b))); }));
  let textArea = null;

  async function renderSource() {
    $$('[data-src]', wrap).forEach(b => b.setAttribute('aria-pressed', String(b.dataset.src === source)));
    srcBox.innerHTML = '';
    if (source === 'text') {
      textArea = h(`<label class="field ai-paste"><span class="field-label">Text</span><textarea class="input" rows="8" placeholder="Text hier einfügen …" data-no-i18n>${esc(params.get('text') || '')}</textarea></label>`);
      srcBox.appendChild(textArea);
    } else if (doc) {
      srcBox.appendChild(docChip(doc, () => { doc = null; renderSource(); }));
    } else {
      srcBox.appendChild(await docPicker({ title: 'Dokument wählen', onPick: d => { doc = d; history.replaceState(null, '', `#/ki/${isSum ? 'zusammenfassen' : 'uebersetzen'}?doc=${encodeURIComponent(d.id)}`); renderSource(); } }));
    }
  }
  $$('[data-src]', wrap).forEach(b => b.addEventListener('click', () => { source = b.dataset.src; renderSource(); }));
  await renderSource();
  screen.body.appendChild(wrap);

  go = h(`<button class="btn btn-primary" type="button" data-go>${oicon(isSum ? 'summary' : 'translate')} ${isSum ? 'Zusammenfassen' : 'Übersetzen'}</button>`);
  screen.setFoot([go]);
  function updateGate(s) {
    if (!go) return;
    if (engine.value() === 'device') { go.disabled = false; return; }
    gate([go], s);
  }
  engine.addEventListener('click', () => updateGate(st.state()));
  updateGate(st.state());

  let fullText = '', parts = [], partIdx = 0, translated = [], ac = null;
  const title = () => (doc && source === 'doc' ? doc.name.replace(/\.[^.]+$/, '') : 'Eigener Text');
  const acts = resultActions(() => (isSum ? out.dataset.raw || '' : translated.join('\n\n')), {
    title: () => `${title()} – ${isSum ? 'Zusammenfassung' : 'Übersetzung'}`,
    heading: () => (isSum ? `Zusammenfassung: ${title()}` : ''),
  });
  $('[data-acts]', wrap).appendChild(acts);

  async function getSourceText() {
    if (source === 'text') {
      const t = (textArea && $('textarea', textArea).value || '').trim();
      if (t.length < (isSum ? 40 : 1)) throw Object.assign(new Error('short'), { userMessage: isSum ? 'Bitte füge einen längeren Text ein.' : 'Bitte füge einen Text ein.' });
      return t;
    }
    if (!doc) throw Object.assign(new Error('nodoc'), { userMessage: 'Bitte wähle zuerst ein Dokument.' });
    prep.hidden = false;
    const r = await docText(doc, { signal: screen.signal, onProgress: (p, l) => progressNote(prep, `${l} ${p ? Math.round(p * 100) + ' %' : ''}`) });
    progressNote(prep, '');
    if (r.ocr) { prep.hidden = false; prep.textContent = 'Text wurde per Texterkennung (OCR) auf deinem Gerät gelesen.'; }
    return r.text;
  }

  async function runPart(i) {
    const useDevice = engine.value() === 'device';
    const target = isSum ? null : $('[name=target]', wrap).value;
    const chunk = isSum ? fullText.slice(0, AI_CONFIG.MAX_SUMMARY_CHARS) : parts[i];
    out.dataset.raw = '';
    if (useDevice) {
      const ai = await import('../extras/ai.js');
      progressNote(prep, 'Wird auf deinem Gerät berechnet …');
      prep.hidden = false;
      let res;
      if (isSum) res = await ai.summarizeText(chunk, { signal: ac.signal, onProgress: (p, m) => progressNote(prep, `${m || 'Wird berechnet …'} ${p ? Math.round(p * 100) + ' %' : ''}`) });
      else {
        const src = (await ai.detectLanguage(chunk).catch(() => null)) || 'de';
        if (src === target) throw Object.assign(new Error('same'), { userMessage: 'Ausgangs- und Zielsprache sind gleich.' });
        res = await ai.translateText(chunk, { source: src, target, signal: ac.signal, onProgress: (p, m) => progressNote(prep, `${m || ''} ${p ? Math.round(p * 100) + ' %' : ''}`) });
      }
      progressNote(prep, '');
      return { output: res, note: '', truncated: isSum && fullText.length > AI_CONFIG.MAX_SUMMARY_CHARS };
    }
    const r = await C.runTask(isSum ? 'summarize' : 'translate', { text: chunk, title: doc ? doc.name : '' }, isSum ? { mode } : { target }, {
      stream: true, signal: ac.signal,
      onDelta: (t, full) => { out.innerHTML = isSum ? richText(full, { cite: false }) : plain(full, translated); },
    });
    return r;
  }

  function plain(cur, done) { return [...done, cur].map(t => `<p>${esc(t).replace(/\n/g, '<br>')}</p>`).join(''); }

  function renderMore() {
    more.innerHTML = '';
    if (isSum || partIdx >= parts.length) return;
    const b = h(`<div class="ai-more"><span class="muted small">${partIdx} von ${parts.length} Teilen übersetzt.</span><button class="btn btn-soft btn-sm" type="button">${oicon('translate')} Nächsten Teil übersetzen</button></div>`);
    $('button', b).addEventListener('click', () => run(true));
    more.appendChild(b);
  }

  async function run(next = false) {
    if (ac) { ac.abort(); return; }
    if (engine.value() === 'cloud' && !await ensureCloud()) return;
    go.disabled = true;
    ac = new AbortController();
    try {
      if (!next) {
        fullText = await getSourceText();
        parts = isSum ? [fullText] : splitParts(fullText, AI_CONFIG.MAX_TRANSLATE_CHARS);
        partIdx = 0; translated = [];
        out.innerHTML = '<span class="ai-typing" aria-label="KI schreibt"><i></i><i></i><i></i></span>';
      }
      result.hidden = false;
      noteEl.hidden = true;
      result.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      const r = await runPart(partIdx);
      partIdx++;
      if (isSum) { out.dataset.raw = r.output; out.innerHTML = richText(r.output, { cite: false }); }
      else { translated.push(r.output); out.innerHTML = plain('', translated).replace(/<p><\/p>$/, ''); }
      const notes = [];
      if (isSum && fullText.length > AI_CONFIG.MAX_SUMMARY_CHARS) notes.push(`Das Dokument ist sehr lang – zusammengefasst wurden die ersten ca. ${AI_CONFIG.MAX_SUMMARY_CHARS.toLocaleString('de-DE')} Zeichen.`);
      else if (r.note) notes.push(r.note);
      if (r.cut) notes.push('Die Antwort wurde wegen ihrer Länge gekürzt.');
      if (r.partial) notes.push(r.partialMessage);
      noteEl.hidden = !notes.length;
      noteEl.innerHTML = notes.length ? `${oicon('info')}<span>${esc(notes.join(' '))}</span>` : '';
      metaEl.textContent = engine.value() === 'device' ? 'Auf dem Gerät berechnet' : 'Cloud-KI';
      renderMore();
    } catch (e) {
      if (e && e.name === 'AbortError') { toast('Abgebrochen', 'info'); }
      else { if (!translated.length && !(out.dataset.raw)) result.hidden = true; showAiError(e); }
    } finally {
      ac = null; go.disabled = false; progressNote(prep, '');
    }
  }
  go.addEventListener('click', () => run(false));
  return () => { if (ac) ac.abort(); st.el._dispose && st.el._dispose(); };
}
