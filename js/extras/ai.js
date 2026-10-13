// Optionale KI-Funktionen – nur wenn der Browser sie selbst auf dem Gerät anbietet (Chrome Built-in AI:
// Summarizer, Translator, LanguageDetector). Kein Server, keine Fake-Ausgabe: Ist nichts verfügbar, werden
// die Einträge gar nicht angezeigt. Weitere Anbieter (z. B. ein eigener Server) können später über
// registerProvider() ergänzt werden, ohne die Oberfläche zu ändern.
import { $, h, esc, toast, errorToast, openDialog } from '../ui.js';
import { oicon } from '../office/kinds.js';

/**
 * Provider interface:
 * { id, label, local: boolean,
 *   capabilities(): Promise<{summarize, translate, detect}>,
 *   summarize?(text, {onProgress, signal}): Promise<string>,
 *   translate?(text, {source, target, onProgress, signal}): Promise<string>,
 *   detect?(text): Promise<string|null> }
 */
const providers = [];
let capsP = null;
export function registerProvider(p) { if (p && p.id && !providers.some(x => x.id === p.id)) providers.push(p); capsP = null; }

export const LANGS = [['en', 'Englisch'], ['de', 'Deutsch'], ['fr', 'Französisch'], ['es', 'Spanisch'], ['it', 'Italienisch'], ['nl', 'Niederländisch'], ['pl', 'Polnisch'], ['tr', 'Türkisch'], ['uk', 'Ukrainisch'], ['ru', 'Russisch'], ['ar', 'Arabisch'], ['pt', 'Portugiesisch']];

// ---------------- Chrome built-in AI (on-device) ----------------
const builtin = {
  id: 'browser', label: 'Browser (auf dem Gerät)', local: true,
  async capabilities() {
    const out = { summarize: false, translate: false, detect: false };
    try {
      if ('Summarizer' in self) {
        // plain check first: avoids language warnings on devices without the on-device model
        out.summarize = (await self.Summarizer.availability()) !== 'unavailable';
      }
    } catch {}
    try {
      if ('Translator' in self) {
        const a = await self.Translator.availability({ sourceLanguage: 'de', targetLanguage: 'en' });
        out.translate = a !== 'unavailable';
      }
    } catch {}
    try {
      if ('LanguageDetector' in self) out.detect = (await self.LanguageDetector.availability()) !== 'unavailable';
    } catch {}
    return out;
  },
  async summarize(text, { onProgress, signal } = {}) {
    const monitor = m => m.addEventListener('downloadprogress', e => onProgress && onProgress(e.loaded, 'Modell wird auf dein Gerät geladen …'));
    let s;
    try { s = await self.Summarizer.create({ type: 'key-points', format: 'plain-text', length: 'medium', expectedInputLanguages: ['de', 'en'], outputLanguage: 'de', monitor, signal }); }
    catch { s = await self.Summarizer.create({ type: 'key-points', format: 'plain-text', length: 'medium', monitor, signal }); }
    try {
      const quota = s.inputQuota && Number.isFinite(s.inputQuota) ? Math.max(2000, s.inputQuota * 3) : 12000;
      const chunks = splitText(text, Math.min(quota, 12000));
      if (chunks.length === 1) return await s.summarize(chunks[0], { signal });
      const parts = [];
      for (let i = 0; i < chunks.length; i++) {
        onProgress && onProgress((i + 1) / (chunks.length + 1), `Teil ${i + 1} von ${chunks.length} …`);
        parts.push(await s.summarize(chunks[i], { signal }));
      }
      const joined = parts.join('\n');
      return joined.length > 12000 ? joined : await s.summarize(joined, { signal, context: 'Dies sind Zusammenfassungen einzelner Abschnitte eines Dokuments.' });
    } finally { try { s.destroy(); } catch {} }
  },
  async translate(text, { source = 'de', target = 'en', onProgress, signal } = {}) {
    const monitor = m => m.addEventListener('downloadprogress', e => onProgress && onProgress(e.loaded, 'Sprachpaket wird auf dein Gerät geladen …'));
    const t = await self.Translator.create({ sourceLanguage: source, targetLanguage: target, monitor, signal });
    try {
      const chunks = splitText(text, 1500);
      const out = [];
      for (let i = 0; i < chunks.length; i++) {
        onProgress && onProgress((i + 1) / chunks.length, `Abschnitt ${i + 1} von ${chunks.length} …`);
        out.push(await t.translate(chunks[i], { signal }));
      }
      return out.join('\n\n');
    } finally { try { t.destroy(); } catch {} }
  },
  async detect(text) {
    const d = await self.LanguageDetector.create();
    try { const r = await d.detect(text.slice(0, 2000)); return r && r[0] && r[0].confidence > 0.4 ? r[0].detectedLanguage : null; } finally { try { d.destroy(); } catch {} }
  },
};
registerProvider(builtin);

function splitText(text, max) {
  const paras = String(text).replace(/\r\n?/g, '\n').split(/\n{2,}|\n/).map(s => s.trim()).filter(Boolean);
  const out = [];
  let cur = '';
  for (const p of paras) {
    if (cur && (cur.length + p.length + 1) > max) { out.push(cur); cur = ''; }
    if (p.length > max) { for (let i = 0; i < p.length; i += max) out.push(p.slice(i, i + max)); continue; }
    cur += (cur ? '\n' : '') + p;
  }
  if (cur) out.push(cur);
  return out.length ? out : [''];
}

/** Which AI features can be offered right now. */
export function aiCapabilities() {
  if (!capsP) capsP = (async () => {
    const res = { summarize: false, translate: false, detect: false };
    for (const p of providers) {
      try { const c = await p.capabilities(); for (const k of Object.keys(res)) if (c[k]) res[k] = true; } catch {}
    }
    return res;
  })();
  return capsP;
}
async function providerFor(cap) {
  for (const p of providers) { try { if ((await p.capabilities())[cap] && p[cap === 'summarize' ? 'summarize' : cap === 'translate' ? 'translate' : 'detect']) return p; } catch {} }
  return null;
}
export async function summarizeText(text, opts) { const p = await providerFor('summarize'); if (!p) throw Object.assign(new Error('na'), { userMessage: 'Zusammenfassen ist auf diesem Gerät nicht verfügbar.' }); return p.summarize(text, opts); }
export async function translateText(text, opts) { const p = await providerFor('translate'); if (!p) throw Object.assign(new Error('na'), { userMessage: 'Übersetzen ist auf diesem Gerät nicht verfügbar.' }); return p.translate(text, opts); }
export async function detectLanguage(text) { const p = await providerFor('detect'); return p ? p.detect(text) : null; }

// ---------------- UI ----------------
async function docText(doc) {
  const db = await import('../db.js');
  let pages = await db.getText(doc.id);
  if (!pages || !pages.join('').trim()) {
    if ((doc.kind || 'pdf') === 'pdf') throw Object.assign(new Error('no text'), { userMessage: 'Diese PDF enthält keinen erkennbaren Text (z. B. ein Scan ohne Texterkennung).' });
    const blob = await db.getFile(doc.id);
    const { describeFile } = await import('../office/extract.js');
    const info = await describeFile(doc.kind, blob);
    pages = info && info.pages;
  }
  const text = (pages || []).join('\n\n').trim();
  if (!text) throw Object.assign(new Error('empty'), { userMessage: 'In dieser Datei wurde kein Text gefunden.' });
  return text;
}

export async function aiForDoc(doc, op) {
  try { return aiForText(await docText(doc), op, { title: doc.name }); } catch (e) { errorToast(e, 'Text konnte nicht gelesen werden.'); return null; }
}

/** Run summarize/translate on a text and show the result. op: 'summarize' | 'translate'. */
export async function aiForText(text, op, { title = 'Dokument' } = {}) {
  const caps = await aiCapabilities();
  if (!caps[op]) { toast('Diese Funktion ist auf diesem Gerät nicht verfügbar.', 'error'); return null; }
  const ac = new AbortController();
  let result = '';
  await openDialog({
    title: op === 'summarize' ? 'Zusammenfassung' : 'Übersetzung', wide: true,
    body: `<div class="ai-box">
      <p class="ai-note">${oicon('shield')}<span>Wird von deinem Browser direkt auf diesem Gerät berechnet – nichts wird hochgeladen. KI kann Fehler machen; prüfe wichtige Inhalte.</span></p>
      ${op === 'translate' ? `<div class="field-row"><label class="field"><span class="field-label">Von</span><select class="select" name="src"><option value="auto">Automatisch erkennen</option>${LANGS.map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select></label>
        <label class="field"><span class="field-label">Nach</span><select class="select" name="dst">${LANGS.map(([k, l]) => `<option value="${k}" ${k === 'en' ? 'selected' : ''}>${l}</option>`).join('')}</select></label></div>
        <button class="btn btn-primary btn-sm" type="button" data-go>${oicon('translate')} Übersetzen</button>` : ''}
      <p class="ai-status muted small" aria-live="polite"></p>
      <textarea class="input ai-out" readonly rows="12" aria-label="Ergebnis" hidden></textarea>
      <div class="row-actions ai-acts" hidden><button class="btn btn-ghost btn-sm" type="button" data-copy>${oicon('copy')} Kopieren</button><button class="btn btn-soft btn-sm" type="button" data-save>${oicon('kdoc')} Als Dokument speichern</button></div>
    </div>`,
    actions: [{ label: 'Schließen', value: 'cancel' }],
    onMount: dlg => {
      const status = $('.ai-status', dlg), out = $('.ai-out', dlg), acts = $('.ai-acts', dlg);
      const run = async () => {
        out.hidden = true; acts.hidden = true;
        status.textContent = 'Wird vorbereitet …';
        const onProgress = (p, msg) => { status.textContent = `${msg || 'Wird berechnet …'} ${p ? Math.round(p * 100) + ' %' : ''}`; };
        try {
          if (op === 'summarize') result = await summarizeText(text, { onProgress, signal: ac.signal });
          else {
            let src = $('[name=src]', dlg).value;
            if (src === 'auto') src = (await detectLanguage(text).catch(() => null)) || 'de';
            const dst = $('[name=dst]', dlg).value;
            if (src === dst) { status.textContent = 'Ausgangs- und Zielsprache sind gleich.'; return; }
            result = await translateText(text, { source: src, target: dst, onProgress, signal: ac.signal });
          }
          out.value = result; out.hidden = false; acts.hidden = false;
          status.textContent = `${text.length.toLocaleString('de-DE')} Zeichen verarbeitet.`;
        } catch (e) {
          if (e && e.name === 'AbortError') return;
          console.warn(e);
          status.textContent = e && e.userMessage ? e.userMessage : 'Das hat leider nicht geklappt. Eventuell ist die Sprache nicht verfügbar.';
        }
      };
      if (op === 'summarize') run(); else $('[data-go]', dlg).addEventListener('click', run);
      $('[data-copy]', dlg).addEventListener('click', async () => { try { await navigator.clipboard.writeText(result); toast('Kopiert', 'success'); } catch { out.select(); document.execCommand('copy'); } });
      $('[data-save]', dlg).addEventListener('click', async () => {
        try {
          const { textToHtml } = await import('../office/docmodel.js');
          const { htmlToModel } = await import('../office/docmodel.js');
          const { modelToDocx } = await import('../office/docx-write.js');
          const { saveFile } = await import('../library.js');
          const base = String(title).replace(/\.[a-z0-9]+$/i, '');
          const html = `<h1>${esc(op === 'summarize' ? 'Zusammenfassung' : 'Übersetzung')}: ${esc(base)}</h1>${textToHtml(result)}`;
          const blob = await modelToDocx(htmlToModel(html), { title: base });
          const meta = await saveFile({ blob: new Blob([blob], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }), name: `${base} – ${op === 'summarize' ? 'Zusammenfassung' : 'Übersetzung'}`, kind: 'docx' });
          toast(`„${meta.name}“ gespeichert`, 'success', { action: { label: 'Öffnen', onClick: () => { location.hash = `#/bearbeiten/${meta.id}`; } } });
        } catch (e) { errorToast(e, 'Speichern fehlgeschlagen.'); }
      });
      return { collect: () => null };
    },
  });
  ac.abort();
  return result || null;
}

export { h };
