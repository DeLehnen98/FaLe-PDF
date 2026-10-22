// „Text verbessern“ (#/ki/verbessern): paste a text (an e-mail, a letter, a post) → verbessern, kürzen, förmlicher …
// The proposal shows what changed (word diff); „Neuer Text“ shows it clean for copying, saving or reading aloud.
import { $, $$, h, esc, toast } from '../ui.js';
import { oicon } from '../office/kinds.js';
import * as C from './client.js';
import { statusCard, gate } from './common.js';
import { ensureCloud, showAiError, resultActions } from './ui.js';
import { diffHtml, diffStats } from './diff.js';
import { outputLang } from './config.js';

export const REWRITE_MODES = [
  ['verbessern', 'Verbessern', 'sparkle'], ['rechtschreibung', 'Rechtschreibung', 'spell'], ['kuerzen', 'Kürzen', 'minus'],
  ['foermlicher', 'Förmlicher', 'letter'], ['lockerer', 'Freundlicher', 'heart'], ['erweitern', 'Ausführlicher', 'plus'],
];
const MAX = 6000;

export async function mount(screen, { params }) {
  let go = null;
  const st = statusCard({ onChange: s => gate([go], s) });
  const wrap = h(`<div class="screen-inner ai-rewrite">
    <div data-status></div>
    <div class="card card-pad">
      <label class="field"><span class="field-label">Dein Text</span>
        <textarea class="input" name="text" rows="8" maxlength="${MAX}" placeholder="z. B. eine E-Mail an den Vermieter, eine Nachricht an den Verein oder einen Absatz aus einem Brief …" data-no-i18n>${esc(params.get('text') || '')}</textarea>
        <span class="hint" data-count></span></label>
      <div class="field"><span class="field-label">Was soll die KI tun?</span>
        <div class="seg seg-grid ai-rw-modes" role="group" aria-label="Was soll die KI tun?">${REWRITE_MODES.map(([id, l], i) => `<button type="button" data-mode="${id}" aria-pressed="${i === 0}">${esc(l)}</button>`).join('')}</div></div>
    </div>
    <section class="card ai-result" data-result hidden>
      <div class="ai-result-head"><strong>Vorschlag</strong><span class="muted small" data-stats></span></div>
      <div class="seg ai-rw-view" role="group" aria-label="Ansicht"><button type="button" data-view="diff" aria-pressed="true">Änderungen zeigen</button><button type="button" data-view="clean" aria-pressed="false">Neuer Text</button></div>
      <div class="ai-diff ai-rw-out" data-out data-no-i18n></div>
      <div data-acts></div>
      <button class="btn btn-ghost btn-sm" type="button" data-use>${oicon('restore')} Mit dem Vorschlag weiterarbeiten</button>
    </section>
    <p class="ai-disclaimer">${oicon('info')}<span>Gesendet wird nur dieser Text. KI kann Fehler machen – lies den Vorschlag, bevor du ihn verschickst.</span></p>
  </div>`);
  $('[data-status]', wrap).appendChild(st.el);
  screen.body.appendChild(wrap);
  const ta = $('[name=text]', wrap), count = $('[data-count]', wrap), result = $('[data-result]', wrap), out = $('[data-out]', wrap), stats = $('[data-stats]', wrap);
  const showCount = () => { const n = ta.value.length; count.textContent = n > MAX * 0.8 ? `${n.toLocaleString('de-DE')} von ${MAX.toLocaleString('de-DE')} Zeichen` : ''; };
  ta.addEventListener('input', showCount);
  showCount();
  let mode = 'verbessern', view = 'diff', original = '', proposal = '', ac = null;
  $$('[data-mode]', wrap).forEach(b => b.addEventListener('click', () => { mode = b.dataset.mode; $$('[data-mode]', wrap).forEach(x => x.setAttribute('aria-pressed', String(x === b))); }));
  const paint = () => {
    $$('[data-view]', wrap).forEach(b => b.setAttribute('aria-pressed', String(b.dataset.view === view)));
    out.innerHTML = view === 'diff' ? diffHtml(original, proposal) : esc(proposal).replace(/\n/g, '<br>');
  };
  $$('[data-view]', wrap).forEach(b => b.addEventListener('click', () => { view = b.dataset.view; paint(); }));
  $('[data-acts]', wrap).appendChild(resultActions(() => proposal, { title: () => 'Verbesserter Text', sayLang: () => outputLang() }));
  $('[data-use]', wrap).addEventListener('click', () => { ta.value = proposal; showCount(); result.hidden = true; ta.focus(); toast('Der Vorschlag steht jetzt oben – du kannst ihn weiter bearbeiten.', 'info'); });

  go = h(`<button class="btn btn-primary" type="button" data-go>${oicon('sparkle')} Text überarbeiten</button>`);
  screen.setFoot([go]);
  gate([go], st.state());
  go.addEventListener('click', async () => {
    if (ac) return;
    const text = ta.value.trim();
    if (text.length < 3) { toast('Schreib oder füge zuerst einen Text ein.', 'error'); ta.focus(); return; }
    if (!await ensureCloud()) return;
    go.disabled = true;
    ac = new AbortController();
    const label = go.innerHTML;
    go.innerHTML = `<span class="spinner"></span> Die KI überarbeitet …`;
    try {
      const r = await C.runTask('rewrite', { text }, { mode }, { signal: ac.signal });
      original = text; proposal = String(r.output || '').trim();
      const s = diffStats(original, proposal);
      stats.textContent = proposal === original ? 'Keine Änderungen nötig.' : `${s.added} Wörter neu, ${s.removed} entfernt${r.truncated ? ' · nur der Anfang wurde bearbeitet' : ''}`;
      view = 'diff';
      paint();
      result.hidden = false;
      result.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    } catch (e) { if (!e || e.name !== 'AbortError') showAiError(e); }
    finally { ac = null; go.disabled = false; go.innerHTML = label; gate([go], st.state()); }
  });
  return () => { if (ac) ac.abort(); st.el._dispose && st.el._dispose(); };
}
