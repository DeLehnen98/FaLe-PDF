// Dialoge der Textverarbeitung für Kopf-/Fußzeilen (drei Bereiche, Felder, erste/gerade Seiten anders,
// Seitenzahlformat und Startwert) und das Wasserzeichen.
import { $, $$, esc, openDialog } from '../ui.js';
import { HF_FIELDS, toAdvanced, toSimple } from './hfnorm.js';

const SETS = [['std', 'Standard'], ['first', 'Erste Seite'], ['even', 'Gerade Seiten']];
const PN_STYLES = [['1', '1, 2, 3 …'], ['i', 'i, ii, iii …'], ['I', 'I, II, III …'], ['a', 'a, b, c …'], ['A', 'A, B, C …']];
const PRESETS = [
  ['pn-c', 'Seitenzahl unten mittig', z => { z.f = ['', '{SEITE}', '']; }],
  ['pn-r', '„Seite X von Y“ unten rechts', z => { z.f = ['', '', 'Seite {SEITE} von {SEITEN}']; }],
  ['title-date', 'Titel oben links, Datum oben rechts', z => { z.h = ['{TITEL}', '', '{DATUM}']; }],
  ['clear', 'Alles leeren', z => { z.h = ['', '', '']; z.f = ['', '', '']; }],
];

/**
 * Advanced header/footer dialog. Resolves the new hf (simple format when nothing is lost), null to remove,
 * or undefined when cancelled.
 */
export async function hfDialog(hfIn) {
  const A = toAdvanced(hfIn);
  const data = {
    std: { h: [...A.zones.h], f: [...A.zones.f] },
    first: A.first ? { h: [...A.first.h], f: [...A.first.f] } : { h: ['', '', ''], f: ['', '', ''] },
    even: A.even ? { h: [...A.even.h], f: [...A.even.f] } : { h: ['', '', ''], f: ['', '', ''] },
  };
  let diffFirst = !!A.first, diffEven = !!A.even, cur = 'std', lastInput = null;
  const zoneRow = (where, label) => `<div class="hf-row"><span class="field-label">${label}</span><div class="field-row three">${['Links', 'Mitte', 'Rechts'].map((l, k) => `<label class="field"><span class="field-label small">${l}</span><input class="input" data-z="${where}${k}" autocomplete="off" spellcheck="false"></label>`).join('')}</div></div>`;
  const r = await openDialog({
    title: 'Kopf- und Fußzeile', wide: true,
    body: `<div class="hf-dlg">
      <div class="seg hf-sets" role="tablist" aria-label="Seiten">${SETS.map(([k, l]) => `<button type="button" role="tab" data-set="${k}" aria-selected="${k === 'std'}">${l}</button>`).join('')}</div>
      <p class="hint hf-sethint" data-sethint></p>
      ${zoneRow('h', 'Kopfzeile')}
      ${zoneRow('f', 'Fußzeile')}
      <div class="hf-fields"><span class="muted small">Feld einfügen:</span>${HF_FIELDS.map(([tok, l]) => `<button type="button" class="chip" data-field="${tok}">${l}</button>`).join('')}</div>
      <div class="hf-fields"><span class="muted small">Schnellwahl:</span>${PRESETS.map(([k, l]) => `<button type="button" class="chip" data-preset="${k}">${l}</button>`).join('')}</div>
      <div class="check-row"><label class="check"><input type="checkbox" name="first" ${diffFirst ? 'checked' : ''}> Erste Seite anders</label><label class="check"><input type="checkbox" name="even" ${diffEven ? 'checked' : ''}> Gerade und ungerade Seiten anders</label></div>
      <div class="field-row"><label class="field"><span class="field-label">Seitenzahlen</span><select class="select" name="pnStyle">${PN_STYLES.map(([k, l]) => `<option value="${k}" ${(A.pnStyle || '1') === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
        <label class="field"><span class="field-label">Beginnen bei</span><input class="input" name="pnStart" type="number" min="0" max="9999" value="${esc(String(A.pnStart ?? 1))}"></label></div>
      <p class="hint">Felder wie „Seitenzahl“ werden auf jeder Seite automatisch ausgefüllt – auch in der .docx- und PDF-Datei.</p>
    </div>`,
    actions: [{ label: 'Entfernen', value: 'remove', kind: 'btn-danger-ghost' }, { label: 'Abbrechen', value: 'cancel' }, { label: 'Übernehmen', value: 'ok', kind: 'btn-primary', default: true }],
    onMount: dlg => {
      const inputs = $$('[data-z]', dlg);
      const load = () => {
        const d = data[cur];
        inputs.forEach(inp => { const w = inp.dataset.z[0], k = +inp.dataset.z[1]; inp.value = d[w][k] || ''; });
        $$('[data-set]', dlg).forEach(b => { b.setAttribute('aria-selected', String(b.dataset.set === cur)); b.disabled = (b.dataset.set === 'first' && !diffFirst) || (b.dataset.set === 'even' && !diffEven); });
        $('[data-sethint]', dlg).textContent = cur === 'first' ? 'Gilt nur für Seite 1 (z. B. Deckblatt). Leer lassen = keine Kopf-/Fußzeile auf Seite 1.' : cur === 'even' ? 'Gilt für Seite 2, 4, 6 … – die Standardzeilen dann für ungerade Seiten.' : (diffEven ? 'Gilt für ungerade Seiten.' : 'Gilt für alle Seiten.');
      };
      const store = () => { const d = data[cur]; inputs.forEach(inp => { d[inp.dataset.z[0]][+inp.dataset.z[1]] = inp.value; }); };
      inputs.forEach(inp => { inp.addEventListener('input', store); inp.addEventListener('focus', () => { lastInput = inp; }); });
      $$('[data-set]', dlg).forEach(b => b.addEventListener('click', () => { store(); cur = b.dataset.set; load(); }));
      $('[name=first]', dlg).addEventListener('change', e => { diffFirst = e.target.checked; if (!diffFirst && cur === 'first') cur = 'std'; if (diffFirst) cur = 'first'; load(); });
      $('[name=even]', dlg).addEventListener('change', e => { diffEven = e.target.checked; if (!diffEven && cur === 'even') cur = 'std'; if (diffEven) cur = 'even'; load(); });
      $$('[data-field]', dlg).forEach(b => b.addEventListener('mousedown', e => e.preventDefault()));
      $$('[data-field]', dlg).forEach(b => b.addEventListener('click', () => {
        const inp = lastInput || inputs[4];
        const tok = b.dataset.field;
        const a = inp.selectionStart ?? inp.value.length, z = inp.selectionEnd ?? inp.value.length;
        inp.value = inp.value.slice(0, a) + tok + inp.value.slice(z);
        inp.focus(); inp.setSelectionRange(a + tok.length, a + tok.length);
        store();
      }));
      $$('[data-preset]', dlg).forEach(b => b.addEventListener('click', () => { store(); PRESETS.find(p => p[0] === b.dataset.preset)[2](data[cur]); load(); }));
      load();
      return { collect: () => { store(); return { pnStyle: $('[name=pnStyle]', dlg).value, pnStart: Math.max(0, Math.min(9999, parseInt($('[name=pnStart]', dlg).value, 10) || 0)) }; } };
    },
  });
  if (r.value === 'remove') { return hfIn && hfIn.watermark ? { watermark: { ...hfIn.watermark } } : null; }
  if (r.value !== 'ok' || !r.data) return undefined;
  const out = { zones: data.std, pnStyle: r.data.pnStyle, pnStart: r.data.pnStart };
  if (diffFirst) out.first = data.first;
  if (diffEven) out.even = data.even;
  if (hfIn && hfIn.watermark) out.watermark = { ...hfIn.watermark };
  const trim = z => { z.h = z.h.map(t => t.trim()); z.f = z.f.map(t => t.trim()); };
  [out.zones, out.first, out.even].filter(Boolean).forEach(trim);
  const simple = toSimple(out);
  return simple || out;
}

const WM_PRESETS = ['ENTWURF', 'VERTRAULICH', 'MUSTER', 'KOPIE', 'NICHT KOPIEREN'];
const WM_COLORS = [['#B4B8CC', 'Grau'], ['#E05B5B', 'Rot'], ['#5B7BE0', 'Blau'], ['#3BA58F', 'Grün']];
/** Watermark dialog: resolves { text, color, opacity } | null (remove) | undefined (cancel). */
export async function watermarkDialog(cur) {
  const c = cur || { text: 'ENTWURF', color: '#B4B8CC', opacity: 0.45 };
  const r = await openDialog({
    title: 'Wasserzeichen',
    body: `<div class="wm-dlg">
      <div class="hf-fields">${WM_PRESETS.map(t => `<button type="button" class="chip" data-wm="${t}">${t}</button>`).join('')}</div>
      <label class="field"><span class="field-label">Text</span><input class="input" name="text" maxlength="40" value="${esc(c.text || '')}"></label>
      <div class="field-row"><label class="field"><span class="field-label">Farbe</span><select class="select" name="color">${WM_COLORS.map(([v, l]) => `<option value="${v}" ${c.color === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
        <label class="field"><span class="field-label">Deckkraft</span><select class="select" name="opacity">${[[0.25, 'Hell'], [0.45, 'Mittel'], [0.7, 'Kräftig']].map(([v, l]) => `<option value="${v}" ${Math.abs((c.opacity || 0.45) - v) < 0.05 ? 'selected' : ''}>${l}</option>`).join('')}</select></label></div>
      <p class="hint">Das Wasserzeichen erscheint schräg hinter dem Text auf jeder Seite – in der Seitenansicht, im PDF und in der .docx-Datei.</p>
    </div>`,
    actions: [{ label: 'Entfernen', value: 'remove', kind: 'btn-danger-ghost' }, { label: 'Abbrechen', value: 'cancel' }, { label: 'Übernehmen', value: 'ok', kind: 'btn-primary', default: true }],
    onMount: dlg => {
      $$('[data-wm]', dlg).forEach(b => b.addEventListener('click', () => { $('[name=text]', dlg).value = b.dataset.wm; }));
      return { collect: () => ({ text: $('[name=text]', dlg).value.trim().slice(0, 40), color: $('[name=color]', dlg).value, opacity: +$('[name=opacity]', dlg).value }) };
    },
  });
  if (r.value === 'remove') return null;
  if (r.value !== 'ok' || !r.data) return undefined;
  return r.data.text ? r.data : null;
}
