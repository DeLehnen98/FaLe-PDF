// AI helpers inside the office editors:
//   writerAssist – „KI-Schreibhilfe“ in the document editor: selection → verbessern/kürzen/… with a
//                  word-diff preview; nothing changes until the user taps „Übernehmen“.
//   formulaAssist – „Formel-Assistent“ in the spreadsheet: description → German formula + explanation.
import { $, $$, h, esc, toast, openDialog } from '../ui.js';
import { oicon } from '../office/kinds.js';
import * as C from './client.js';
import { ensureCloud, showAiError, richText, loadAiCss, quotaWidget, copyText } from './ui.js';

// inside a dialog: no nested dialogs (they would queue) → toast, details after closing
function inlineError(e) {
  if (!e || e.name === 'AbortError') return;
  const more = ['quota_exhausted', 'budget_exhausted'].includes(e.code);
  toast(e.userMessage || 'Das hat nicht geklappt.', 'error', more ? { timeout: 7000, action: { label: 'Optionen', onClick: () => showAiError(e) } } : { timeout: 6000 });
}
function ready() {
  if (!C.online()) { toast('Du bist offline. Cloud-KI braucht eine Internetverbindung.', 'error'); return false; }
  return !C.cloudDisabled() && C.hasConsent();
}
import { diffHtml, diffStats } from './diff.js';

const MODES = [
  ['verbessern', 'Verbessern', 'sparkle'], ['kuerzen', 'Kürzen', 'minus'], ['erweitern', 'Erweitern', 'plus'],
  ['foermlicher', 'Förmlicher', 'letter'], ['lockerer', 'Lockerer', 'heart'], ['rechtschreibung', 'Rechtschreibung', 'spell'],
];
const MAX = 6000;

function blockOf(node, ed) {
  let n = node && node.nodeType === 3 ? node.parentNode : node;
  while (n && n !== ed && !/^(P|H[1-6]|LI|BLOCKQUOTE|TD|TH|DIV)$/.test(n.tagName)) n = n.parentNode;
  return n && n !== ed ? n : null;
}

/** opts: { ed: contenteditable root, range: last saved selection (Range|null), onChange() } */
export async function writerAssist({ ed, range = null, onChange } = {}) {
  loadAiCss();
  const sel = getSelection();
  let r = sel && sel.rangeCount && ed.contains(sel.anchorNode) && !sel.isCollapsed ? sel.getRangeAt(0).cloneRange() : null;
  if (!r && range && !range.collapsed && ed.contains(range.commonAncestorContainer)) r = range.cloneRange();
  if (!r) {
    // no selection: use the paragraph at the caret
    const anchor = (sel && sel.rangeCount && ed.contains(sel.anchorNode)) ? sel.anchorNode : range && range.startContainer;
    const blk = anchor && blockOf(anchor, ed);
    if (blk && blk.textContent.trim()) { r = document.createRange(); r.selectNodeContents(blk); }
  }
  if (!r || !r.toString().trim()) { toast('Markiere zuerst den Text, den die KI überarbeiten soll.', 'info', { timeout: 4500 }); return; }
  const original = r.toString();
  if (original.length > MAX) { toast(`Bitte markiere höchstens ca. ${MAX.toLocaleString('de-DE')} Zeichen auf einmal.`, 'error'); return; }
  // consent etc. first: dialogs are queued, so they cannot open on top of the assistant dialog
  if (!await ensureCloud()) return;
  let proposal = null, ac = null;
  const res = await openDialog({
    title: 'KI-Schreibhilfe', wide: true,
    body: `<div class="ai-assist">
      <div class="ai-assist-modes" role="group" aria-label="Was soll die KI tun?">${MODES.map(([id, l, ic]) => `<button class="btn btn-soft btn-sm" type="button" data-mode="${id}">${oicon(ic)} ${esc(l)}</button>`).join('')}
        <button class="btn btn-ghost btn-sm" type="button" data-explain>${oicon('info')} Erklären</button></div>
      <div class="ai-assist-src"><span class="field-label">Markierter Text</span><div class="ai-assist-text" data-no-i18n>${esc(original).replace(/\n/g, '<br>')}</div></div>
      <div class="ai-assist-out" data-out hidden><span class="field-label" data-outlabel>Vorschlag</span><div class="ai-diff" data-diff data-no-i18n></div><span class="muted small" data-stats></span></div>
      <div class="ai-assist-q" data-q></div>
      <p class="ai-prep muted small" data-prep hidden></p>
    </div>`,
    actions: [{ label: 'Verwerfen', value: 'cancel' }, { label: 'Übernehmen', value: 'ok', kind: 'btn-primary' }],
    validate: v => v !== 'ok' || !!proposal,
    onMount: dlg => {
      const okBtn = dlg.querySelector('.dlg-actions .btn-primary');
      okBtn.disabled = true;
      const outBox = $('[data-out]', dlg), diff = $('[data-diff]', dlg), stats = $('[data-stats]', dlg), prep = $('[data-prep]', dlg);
      if (C.hasConsent()) $('[data-q]', dlg).appendChild(quotaWidget({ compact: true }));
      const busy = (on, label) => { $$('[data-mode], [data-explain]', dlg).forEach(b => { b.disabled = on; }); prep.hidden = !on; prep.innerHTML = on ? `<span class="spinner dark"></span> ${esc(label)}` : ''; };
      $$('[data-mode]', dlg).forEach(b => b.addEventListener('click', async () => {
        if (!ready()) return;
        busy(true, 'Die KI überarbeitet den Text …');
        ac = new AbortController();
        try {
          const out = await C.runTask('rewrite', { text: original }, { mode: b.dataset.mode }, { signal: ac.signal });
          proposal = out.output;
          outBox.hidden = false;
          $('[data-outlabel]', dlg).textContent = 'Vorschlag (Änderungen markiert)';
          diff.innerHTML = diffHtml(original, proposal);
          const s = diffStats(original, proposal);
          stats.textContent = proposal === original ? 'Keine Änderungen nötig.' : `${s.added} Wörter neu, ${s.removed} entfernt${out.truncated ? ' · Text wurde gekürzt verarbeitet' : ''}`;
          okBtn.disabled = proposal === original;
        } catch (e) { inlineError(e); }
        finally { busy(false); ac = null; }
      }));
      $('[data-explain]', dlg).addEventListener('click', async () => {
        if (!ready()) return;
        busy(true, 'Die KI erklärt die Textstelle …');
        proposal = null; okBtn.disabled = true;
        outBox.hidden = false;
        $('[data-outlabel]', dlg).textContent = 'Erklärung';
        stats.textContent = '';
        ac = new AbortController();
        try {
          const context = (ed.innerText || '').slice(0, 2000);
          const out = await C.runTask('explain', { text: original, context }, {}, { stream: true, signal: ac.signal, onDelta: (t, full) => { diff.innerHTML = richText(full, { cite: false }); } });
          diff.innerHTML = richText(out.output, { cite: false });
        } catch (e) { inlineError(e); }
        finally { busy(false); ac = null; }
      });
      return { collect: () => proposal };
    },
  });
  if (ac) ac.abort();
  if (res.value !== 'ok' || !proposal) return;
  // apply as one undoable edit
  ed.focus();
  const s = getSelection();
  s.removeAllRanges();
  s.addRange(r);
  const paras = proposal.split(/\n{2,}/).map(p => p.trim()).filter(Boolean);
  if (paras.length <= 1 && !/\n/.test(original.trim())) document.execCommand('insertText', false, proposal.trim());
  else document.execCommand('insertHTML', false, paras.map(p => `<p>${esc(p).replace(/\n/g, '<br>')}</p>`).join(''));
  onChange && onChange();
  toast('Text übernommen – mit Rückgängig (Strg+Z) kannst du es zurücknehmen.', 'success', { timeout: 4500 });
}

// ---------------------------------------------------------------- spreadsheet formula
/** opts: { sheet (workbook sheet), cell: 'B11', insert(formula) } */
export async function formulaAssist({ sheet, cell = '', insert } = {}) {
  loadAiCss();
  if (!await ensureCloud()) return;
  const { sheetToRows } = await import('../office/workbook.js');
  const { colName, toCanonical } = await import('../office/formula.js');
  const rows = sheet ? sheetToRows(sheet).slice(0, 6) : [];
  const headers = (rows[0] || []).map((v, c) => ({ col: colName(c), name: String(v || '').trim() })).filter(x => x.name).slice(0, 40);
  let result = null;
  const res = await openDialog({
    title: 'Formel-Assistent', wide: true,
    body: `<div class="ai-assist ai-formula">
      <label class="field"><span class="field-label">Was möchtest du berechnen?${cell ? ` (Ergebnis in ${esc(cell)})` : ''}</span>
        <textarea class="input" name="req" rows="3" maxlength="600" placeholder="z. B. Summe aller Umsätze in Spalte C, wenn in Spalte B „Berlin“ steht" data-no-i18n autofocus></textarea></label>
      ${headers.length ? `<p class="muted small">Spaltenüberschriften werden mitgesendet: ${headers.slice(0, 8).map(x => `<span data-no-i18n>${esc(x.col)} = ${esc(x.name)}</span>`).join(', ')}${headers.length > 8 ? ' …' : ''}</p>` : ''}
      ${rows.length > 1 ? '<label class="check"><input type="checkbox" name="sample"> Die ersten Zeilen als Beispiel mitsenden (genauere Formel)</label>' : ''}
      <button class="btn btn-soft btn-sm" type="button" data-go>${oicon('sparkle')} Formel erstellen</button>
      <div class="ai-formula-out" data-out hidden><code class="ai-formula-code" data-f data-no-i18n></code><button class="icon-btn" type="button" data-copy aria-label="Formel kopieren">${oicon('copy')}</button><p data-expl data-no-i18n></p><p class="ai-warn" data-warn hidden></p></div>
      <p class="ai-prep muted small" data-prep hidden></p>
    </div>`,
    actions: [{ label: 'Schließen', value: 'cancel' }, { label: cell ? `In ${cell} einfügen` : 'Einfügen', value: 'ok', kind: 'btn-primary' }],
    validate: v => v !== 'ok' || !!result,
    onMount: dlg => {
      const okBtn = dlg.querySelector('.dlg-actions .btn-primary');
      okBtn.disabled = true;
      const go = $('[data-go]', dlg), prep = $('[data-prep]', dlg), out = $('[data-out]', dlg);
      $('[data-copy]', dlg).addEventListener('click', () => result && copyText(result.formula));
      go.addEventListener('click', async () => {
        const req = $('[name=req]', dlg).value.trim();
        if (req.length < 3) { $('[name=req]', dlg).focus(); return; }
        if (!ready()) return;
        go.disabled = true; prep.hidden = false; prep.innerHTML = '<span class="spinner dark"></span> Die KI erstellt die Formel …';
        try {
          const withSample = $('[name=sample]', dlg) && $('[name=sample]', dlg).checked;
          const sample = withSample ? rows.map(r => r.map(x => String(x ?? '')).join('\t')).join('\n').slice(0, 1500) : '';
          const r = await C.runTask('formula', { request: req, cell, headers, sample });
          result = r.output;
          out.hidden = false;
          $('[data-f]', dlg).textContent = result.formula;
          $('[data-expl]', dlg).textContent = result.explanation;
          const warn = $('[data-warn]', dlg);
          let msg = '';
          if (result.unsupported && result.unsupported.length) msg = `Achtung: ${result.unsupported.join(', ')} kennt FaLe PDF noch nicht – in Excel funktioniert die Formel trotzdem.`;
          try { toCanonical(result.formula.replace(/^=/, '')); } catch { msg = msg || 'Die Formel sieht ungewöhnlich aus – bitte prüfe sie vor dem Einfügen.'; }
          warn.hidden = !msg; warn.textContent = msg;
          okBtn.disabled = false;
        } catch (e) { inlineError(e); }
        finally { go.disabled = false; prep.hidden = true; }
      });
      $('[name=req]', dlg).addEventListener('keydown', e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) go.click(); });
      return { collect: () => result };
    },
  });
  if (res.value === 'ok' && result && insert) insert(result.formula);
}
