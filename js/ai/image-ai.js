// „Bild übersetzen“: photo → on-device OCR (js/ocr/engine.js) → editable text → cloud translation.
// The photo itself never leaves the device – only the recognised text is sent.
import { $, h, esc, toast, pickFiles } from '../ui.js';
import { oicon } from '../office/kinds.js';
import * as C from './client.js';
import { statusCard, gate } from './common.js';
import { ensureCloud, showAiError, resultActions, progressNote } from './ui.js';
import { TARGET_LANGS, outputLang } from './config.js';

export async function mount(screen) {
  let go = null; // assigned below (status callbacks may fire earlier)
  const st = statusCard({ onChange: s => gate([go], s) });
  const wrap = h(`<div class="screen-inner ai-image">
    <div data-status></div>
    <div class="card card-pad ai-options">
      <div class="ai-photo-acts"><button class="btn btn-primary" type="button" data-cam>${oicon('camera')} Foto aufnehmen</button><button class="btn btn-ghost" type="button" data-pick>${oicon('image')} Bild wählen</button></div>
      <p class="muted small">Das Foto bleibt auf deinem Gerät: Der Text wird lokal erkannt (Deutsch/Englisch), nur der erkannte Text wird übersetzt.</p>
      <div class="ai-photo" data-photo hidden></div>
    </div>
    <p class="ai-prep muted small" data-prep hidden></p>
    <div class="card card-pad ai-options" data-textbox hidden>
      <label class="field"><span class="field-label">Erkannter Text (du kannst ihn korrigieren)</span><textarea class="input" rows="7" name="text" data-no-i18n></textarea></label>
      <label class="field"><span class="field-label">Übersetzen nach</span><select class="select" name="target">${TARGET_LANGS.map(([k, l]) => `<option value="${k}">${esc(l)}</option>`).join('')}</select></label>
    </div>
    <section class="card ai-result" data-result hidden><div class="ai-result-head"><strong>Übersetzung</strong></div><div class="ai-output" data-out data-no-i18n></div><div data-acts></div></section>
  </div>`);
  $('[data-status]', wrap).appendChild(st.el);
  const photo = $('[data-photo]', wrap), prep = $('[data-prep]', wrap), textbox = $('[data-textbox]', wrap), ta = $('[name=text]', wrap), out = $('[data-out]', wrap), result = $('[data-result]', wrap);
  $('[name=target]', wrap).value = outputLang();
  screen.body.appendChild(wrap);
  go = h(`<button class="btn btn-primary" type="button" data-go disabled>${oicon('translate')} Übersetzen</button>`);
  screen.setFoot([go]);
  let translation = '';
  $('[data-acts]', wrap).appendChild(resultActions(() => translation, { title: 'Bild-Übersetzung', sayLang: () => $('[name=target]', wrap).value }));
  let url = null;

  async function useFile(file) {
    if (!file) return;
    if (url) URL.revokeObjectURL(url);
    url = URL.createObjectURL(file);
    photo.hidden = false;
    photo.innerHTML = `<img src="${url}" alt="Ausgewähltes Foto">`;
    textbox.hidden = true; result.hidden = true; go.disabled = true;
    let engine = null;
    try { engine = await import('../ocr/engine.js'); } catch { engine = null; }
    if (!engine || typeof engine.recognize !== 'function') { toast('Die Texterkennung ist auf diesem Gerät nicht verfügbar.', 'error'); return; }
    progressNote(prep, 'Text wird auf deinem Gerät erkannt …');
    try {
      const r = await engine.recognize(file, { lang: 'deu+eng', signal: screen.signal, onProgress: p => progressNote(prep, `Text wird erkannt … ${p && typeof p.progress === 'number' ? Math.round(p.progress * 100) + ' %' : ''}`) });
      const text = String((r && r.text) || '').trim();
      if (!text) { toast('Auf dem Bild wurde kein Text gefunden. Versuche ein schärferes Foto.', 'error'); return; }
      ta.value = text;
      textbox.hidden = false;
      gate([go], st.state());
      textbox.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    } catch (e) { if (!(e && e.name === 'AbortError')) toast(e.userMessage || 'Die Texterkennung hat nicht geklappt.', 'error'); }
    finally { progressNote(prep, ''); }
  }
  $('[data-cam]', wrap).addEventListener('click', async () => { const f = await pickFiles({ accept: 'image/*', multiple: false, capture: 'environment' }); useFile(f[0]); });
  $('[data-pick]', wrap).addEventListener('click', async () => { const f = await pickFiles({ accept: 'image/*', multiple: false }); useFile(f[0]); });

  go.addEventListener('click', async () => {
    const text = ta.value.trim();
    if (!text) return;
    if (!await ensureCloud()) return;
    go.disabled = true;
    result.hidden = false;
    out.innerHTML = '<span class="ai-typing" aria-label="KI schreibt"><i></i><i></i><i></i></span>';
    try {
      const r = await C.runTask('image_translate', { text }, { target: $('[name=target]', wrap).value }, { stream: true, onDelta: (t, full) => { out.innerHTML = `<p>${esc(full).replace(/\n/g, '<br>')}</p>`; } });
      translation = r.output;
      out.innerHTML = `<p>${esc(translation).replace(/\n/g, '<br>')}</p>`;
    } catch (e) { result.hidden = true; showAiError(e); }
    finally { go.disabled = false; }
  });
  return () => { if (url) URL.revokeObjectURL(url); st.el._dispose && st.el._dispose(); };
}
