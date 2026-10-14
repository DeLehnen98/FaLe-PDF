// Small stage controls for the edit tools: an extra file picker (watermark image, letterhead) and
// placeholder chips that insert tokens into the last focused text field.
import { el, icon, clear } from './dom.js';
import { InputFile } from './files.js';

/**
 * Extra file picker shown in the stage.
 * @returns {{root: HTMLElement, get: () => InputFile|null, clear: () => void}}
 */
export function filePicker({ lang, label, hint, accept, onFile, kinds = ['image', 'pdf'] }) {
  const de = lang !== 'en';
  let current = null;
  const id = 'ed-file-' + Math.random().toString(36).slice(2, 8);
  const input = el('input', { type: 'file', id, accept, tabindex: '-1', aria: { hidden: 'true', label } });
  const thumb = el('div', { class: 'ed-file-thumb', 'aria-hidden': 'true' }, icon('image'));
  const name = el('p', { class: 'ed-file-name' }, de ? 'Noch keine Datei gewählt' : 'No file chosen yet');
  const choose = el('button', { type: 'button', class: 'ed-chip', onclick: () => input.click() }, icon('plus'), de ? 'Wählen' : 'Choose');
  const rm = el('button', { type: 'button', class: 'wt-icon-btn', hidden: true, aria: { label: de ? 'Datei entfernen' : 'Remove file' }, onclick: () => set(null) }, icon('close'));
  const err = el('p', { class: 'wt-opt-err', hidden: true, role: 'alert' });
  const root = el('div', { class: 'ed-file' },
    el('p', { class: 'ed-label' }, label),
    el('div', { class: 'ed-file-row' }, thumb, name, choose, rm),
    hint ? el('p', { class: 'wt-opt-hint' }, hint) : null, err, input);
  input.addEventListener('change', async () => {
    const f = input.files && input.files[0];
    input.value = '';
    if (!f) return;
    const inp = await InputFile.from(f);
    if (!kinds.includes(inp.kind)) { showErr(de ? 'Dieses Format wird hier nicht unterstützt.' : 'This format is not supported here.'); return; }
    try {
      if (inp.kind === 'pdf') await inp.pageCount(); else await inp.imageInfo();
    } catch {
      showErr(de ? 'Die Datei lässt sich nicht öffnen (beschädigt oder mit Passwort geschützt).' : 'The file cannot be opened (damaged or password protected).');
      return;
    }
    set(inp);
  });
  function showErr(t) { err.textContent = t; err.hidden = false; }
  async function set(inp) {
    err.hidden = true;
    current?.release?.();
    current = inp;
    name.textContent = inp ? inp.name : (de ? 'Noch keine Datei gewählt' : 'No file chosen yet');
    name.title = inp ? inp.name : '';
    rm.hidden = !inp;
    choose.lastChild.textContent = inp ? (de ? 'Ändern' : 'Change') : (de ? 'Wählen' : 'Choose');
    clear(thumb).append(icon(inp?.kind === 'pdf' ? 'file' : 'image'));
    onFile?.(inp);
    if (inp) {
      try { const c = await inp.thumbnail(44); if (current === inp) clear(thumb).append(c); } catch { /* keep icon */ }
    }
  }
  return { root, get: () => current, set, input };
}

/**
 * Chips that insert placeholders like {seite} at the cursor of the last focused field among `ids`.
 */
export function tokenChips({ lang, title, tokens, fieldIds }) {
  let last = null;
  let wrap = null;
  // the chips follow the field being edited, so they stay within thumb reach on a phone
  document.addEventListener('focusin', ev => {
    if (!fieldIds.includes(ev.target?.id)) return;
    last = ev.target;
    const row = last.closest('.wt-opt');
    if (row && wrap && row.nextSibling !== wrap) row.after(wrap);
  });
  const row = el('div', { class: 'ed-row', role: 'group', aria: { label: title } });
  for (const t of tokens) {
    row.append(el('button', {
      type: 'button', class: 'ed-chip ed-chip-mono', title: t.label, aria: { label: `${t.token} – ${t.label}` },
      onpointerdown: ev => ev.preventDefault(), // keep the keyboard / focus in the field
      onclick: () => {
        const f = last && last.isConnected ? last : document.getElementById(fieldIds[0]);
        if (!f) return;
        const s = f.selectionStart ?? f.value.length, e = f.selectionEnd ?? f.value.length;
        f.value = f.value.slice(0, s) + t.token + f.value.slice(e);
        f.dispatchEvent(new Event('input', { bubbles: true }));
        f.focus();
        try { f.setSelectionRange(s + t.token.length, s + t.token.length); } catch { /* number inputs */ }
      },
    }, t.token));
  }
  wrap = el('div', { class: 'ed-tokens' }, el('p', { class: 'ed-label' }, title), row);
  return wrap;
}
