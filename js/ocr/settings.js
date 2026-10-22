// "Ich" page: OCR offline data row (status, size, download/remove) + licences of the OCR parts.
import { icon } from '../icons.js';
import { h, esc, toast, errorToast } from '../ui.js';
import { offlineStatus, downloadForOffline, clearOffline, approxBytes, mbLabel } from './assets.js';

export const OCR_LICENSES = [
  ['tesseract.js 6.0.1 – Texterkennung im Browser, Apache-2.0', 'vendor/tesseract/LICENSE.md'],
  ['tesseract.js-core 6.1.2 (Tesseract OCR als WebAssembly) – Apache-2.0; enthält Leptonica (BSD-2-Clause)', 'vendor/tesseract/core/LICENSE'],
  ['tessdata_fast – Sprachdaten Deutsch und Englisch des Tesseract-Projekts, Apache-2.0', 'vendor/tesseract/lang/LICENSE'],
];

export function mountOcrSettings(root) {
  try {
    import('../tools/common.js').then(m => m.ensureCss()).catch(() => {});
    // licence list
    const list = root.querySelector('.license-list');
    if (list && !list.querySelector('[data-ocr-lic]')) {
      OCR_LICENSES.forEach(([t, href]) => list.appendChild(h(`<li data-ocr-lic>${esc(t)} (<a href="${href}" target="_blank" rel="noopener">Lizenz</a>)</li>`)));
    }
    // settings row (before "Daten löschen")
    const group = root.querySelector('[data-ocr-slot]') || root.querySelector('.settings-group');
    if (!group || group.querySelector('[data-ocr-row]')) return;
    const row = h(`<div class="settings-row" data-ocr-row><div class="label"><strong>OCR-Daten für offline laden</strong>
        <span>Texterkennung (Deutsch + Englisch) ohne Internet nutzen.</span><span class="ocr-set-status" data-ocr-status>Status wird geprüft …</span></div>
      <button class="btn btn-soft btn-sm" type="button" data-ocr-load>${icon('download')} Laden</button></div>`);
    const clear = group.querySelector('[data-clear]');
    const before = clear ? clear.closest('.settings-row') : null;
    group.insertBefore(row, before);
    const btn = row.querySelector('[data-ocr-load]');
    const st = row.querySelector('[data-ocr-status]');
    const render = async () => {
      const s = await offlineStatus();
      st.classList.toggle('ok', s.mode === 'cached' || s.mode === 'bundled');
      if (s.mode === 'bundled') { st.textContent = 'In der App enthalten – funktioniert offline.'; btn.hidden = true; return; }
      if (s.mode === 'unsupported') { st.textContent = 'In diesem Browser nicht verfügbar.'; btn.disabled = true; return; }
      if (s.mode === 'cached') {
        st.textContent = `Geladen · ${mbLabel(s.bytes)} auf diesem Gerät`;
        btn.innerHTML = `${icon('trash')} Entfernen`;
        btn.dataset.state = 'cached';
      } else {
        st.textContent = s.mode === 'partial' ? `Teilweise geladen · ${mbLabel(s.bytes)} von ca. ${mbLabel(approxBytes())}` : `Nicht geladen · ca. ${mbLabel(approxBytes())}`;
        btn.innerHTML = `${icon('download')} Laden`;
        btn.dataset.state = 'missing';
      }
      btn.disabled = false;
    };
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      try {
        if (btn.dataset.state === 'cached') {
          await clearOffline();
          toast('OCR-Daten entfernt. Sie werden bei der nächsten Texterkennung neu geladen.', 'success');
        } else {
          await downloadForOffline(['deu', 'eng'], (d, t) => { st.textContent = `Wird geladen … ${Math.round((d / t) * 100)} %`; });
          toast('OCR-Daten geladen – die Texterkennung funktioniert jetzt offline.', 'success');
        }
      } catch (e) { errorToast(e, 'Die OCR-Daten konnten nicht geladen werden.'); }
      render();
    });
    render();
  } catch (e) { console.warn('ocr settings', e); }
}
