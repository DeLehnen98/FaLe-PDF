// Tools: "Passwort festlegen" (AES-256 encryption + permissions) and "Passwort entfernen".
import { icon } from '../icons.js';
import { h, esc, toast, errorToast, progress, baseName } from '../ui.js';
import { resultCard } from '../components.js';
import { saveResult } from '../library.js';
import { loadEditable, loadProtected, loadPdfLib, saveDoc, saveProtected } from '../pdflib.js';
import { knownPassword } from '../pdfcore.js';
import { openToolDoc, proBadge, updateFoot } from './common.js';

function strength(pw) {
  if (!pw) return { score: 0, label: '' };
  let pool = 0;
  if (/[a-zäöüß]/.test(pw)) pool += 26;
  if (/[A-ZÄÖÜ]/.test(pw)) pool += 26;
  if (/\d/.test(pw)) pool += 10;
  if (/[^A-Za-z0-9äöüÄÖÜß]/.test(pw)) pool += 32;
  let bits = pw.length * Math.log2(Math.max(pool, 2));
  if (/^(.)\1+$/.test(pw) || /^(1234|passwort|password|qwert|abc)/i.test(pw)) bits = Math.min(bits, 12);
  const score = bits < 28 ? 1 : bits < 45 ? 2 : bits < 65 ? 3 : 4;
  return { score, label: ['', 'Schwach', 'Mittel', 'Gut', 'Sehr stark'][score] };
}

function pwField(name, label, { autocomplete = 'new-password', placeholder = '' } = {}) {
  return `<label class="field"><span class="field-label">${esc(label)}</span>
    <span class="pt-pw"><input class="input" type="password" name="${name}" autocomplete="${autocomplete}" placeholder="${esc(placeholder)}" spellcheck="false" autocapitalize="off">
    <button class="icon-btn" type="button" data-eye aria-label="Passwort anzeigen" aria-pressed="false">${icon('eye')}</button></span></label>`;
}

function wireEyes(root) {
  root.querySelectorAll('[data-eye]').forEach(b => b.addEventListener('click', () => {
    const inp = b.parentElement.querySelector('input');
    const show = inp.type === 'password';
    inp.type = show ? 'text' : 'password';
    b.setAttribute('aria-pressed', String(show));
    b.setAttribute('aria-label', show ? 'Passwort verbergen' : 'Passwort anzeigen');
    b.innerHTML = icon(show ? 'eyeOff' : 'eye');
  }));
}

async function inspect(bytes) {
  const PDFLib = await loadPdfLib();
  const { inspectEncryption } = await import('../pdfcrypt.js');
  try { return await inspectEncryption(PDFLib, bytes); } catch (e) { console.warn(e); return { encrypted: false }; }
}

/**
 * Encrypt a PDF with AES-256 (pure, reusable by the batch tool).
 * @returns {Promise<Uint8Array>}
 */
export async function protectPdf(bytes, { userPassword, ownerPassword = '', permissions = { printing: true, copying: true, editing: true }, name = 'Dokument', key = null, onProgress = null } = {}) {
  const pdfDoc = await loadEditable(bytes, name, { key });
  return saveProtected(pdfDoc, { userPassword, ownerPassword, permissions, onProgress });
}

// ------------------------------------------------------------------ Passwort festlegen
export async function mount(screen, { docId }) {
  const ctx = await openToolDoc(screen, docId, 'Passwort festlegen');
  if (!ctx) return;
  const { doc, bytes } = ctx;
  const state = await inspect(bytes);

  const wrap = h(`<div class="screen-inner pt-narrow">
    <div class="card intro"><span class="tile-ic">${icon('lock')}</span><div><strong>${esc(doc.name)}</strong>
      <p>Verschlüsselt mit <b>AES-256</b> – dem stärksten Verfahren des PDF-Standards. Die Datei lässt sich danach nur mit dem Passwort öffnen. ${proBadge()}</p></div></div>
    ${state.encrypted ? `<div class="notice">${icon('info')}<span>Dieses Dokument ist bereits geschützt (${esc(state.label || 'verschlüsselt')}). Du kannst hier ein neues Passwort festlegen oder den Schutz <a href="#/werkzeug/passwort-entfernen?doc=${esc(docId)}">entfernen</a>.</span></div>` : ''}
    <form class="card card-pad" data-form autocomplete="off" novalidate>
      <input type="text" name="username" value="${esc(doc.name)}" autocomplete="username" hidden>
      ${pwField('pw1', 'Passwort zum Öffnen')}
      <div class="pt-strength" data-strength aria-live="polite"><span class="pt-meter"><span></span></span><span class="pt-strength-label"></span></div>
      ${pwField('pw2', 'Passwort wiederholen')}
      <p class="field-error" data-err hidden></p>
      <details class="pt-details">
        <summary>${icon('settings')} Berechtigungen (optional)</summary>
        <div class="pt-details-body">
          <label class="check"><input type="checkbox" name="print" checked><span>Drucken erlauben</span></label>
          <label class="check"><input type="checkbox" name="copy" checked><span>Kopieren von Text und Bildern erlauben</span></label>
          <label class="check"><input type="checkbox" name="edit" checked><span>Bearbeiten erlauben (Seiten, Kommentare, Formulare)</span></label>
          ${pwField('owner', 'Berechtigungs-Passwort', { placeholder: 'leer = zufällig erzeugt' })}
          <p class="hint">Mit dem Berechtigungs-Passwort hat man immer alle Rechte. Die Einschränkungen werden von seriösen PDF-Programmen beachtet.</p>
        </div>
      </details>
    </form>
    <div class="notice">${icon('shield')}<span>Merke dir das Passwort gut: FaLe PDF speichert es nicht und es gibt keine Wiederherstellung. Die Verschlüsselung passiert ausschließlich auf deinem Gerät.</span></div>
    <div data-result></div></div>`);
  screen.body.appendChild(wrap);
  wireEyes(wrap);
  const form = wrap.querySelector('[data-form]');
  const pw1 = form.querySelector('[name=pw1]'), pw2 = form.querySelector('[name=pw2]'), owner = form.querySelector('[name=owner]');
  const err = wrap.querySelector('[data-err]');
  const meter = wrap.querySelector('[data-strength]');
  const btn = h(`<button class="btn btn-primary" type="button" data-run>${icon('lock')} Verschlüsseln</button>`);
  updateFoot(screen, [btn]);

  const update = () => {
    const s = strength(pw1.value);
    meter.dataset.score = String(s.score);
    meter.querySelector('.pt-strength-label').textContent = s.label ? `Stärke: ${s.label}` : '';
    err.hidden = true;
  };
  pw1.addEventListener('input', update);
  pw2.addEventListener('input', () => { err.hidden = true; });
  form.addEventListener('submit', e => { e.preventDefault(); btn.click(); });
  update();

  btn.addEventListener('click', async () => {
    const a = pw1.value, b = pw2.value;
    const fail = msg => { err.textContent = msg; err.hidden = false; toast(msg, 'error'); };
    if (!a) { fail('Bitte gib ein Passwort ein.'); pw1.focus(); return; }
    if (a.length < 4) { fail('Das Passwort sollte mindestens 4 Zeichen haben.'); pw1.focus(); return; }
    if (a !== b) { fail('Die Passwörter stimmen nicht überein.'); pw2.focus(); return; }
    if (owner.value && owner.value === a) { fail('Das Berechtigungs-Passwort muss sich vom Passwort zum Öffnen unterscheiden.'); owner.focus(); return; }
    btn.disabled = true;
    const prog = progress('Verschlüssele …');
    try {
      const out = await protectPdf(bytes, {
        userPassword: a,
        ownerPassword: owner.value,
        permissions: { printing: form.print.checked, copying: form.copy.checked, editing: form.edit.checked },
        name: doc.name, key: docId,
        onProgress: f => prog.set(`Verschlüssele … ${Math.round(f * 100)} %`),
      });
      prog.set('Speichere …');
      const res = await saveResult(out, `${baseName(doc.name)} (geschützt).pdf`);
      const box = wrap.querySelector('[data-result]');
      box.innerHTML = '';
      box.appendChild(resultCard(res, { from: docId, title: 'Mit Passwort geschützt', note: 'AES-256' }));
      box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      pw1.value = pw2.value = owner.value = '';
      update();
      toast('Die PDF ist jetzt passwortgeschützt.', 'success');
    } catch (e) { errorToast(e, 'Verschlüsseln fehlgeschlagen.'); }
    finally { prog.done(); btn.disabled = false; }
  });
}

// ------------------------------------------------------------------ Passwort entfernen
export async function mountRemove(screen, { docId }) {
  const ctx = await openToolDoc(screen, docId, 'Passwort entfernen');
  if (!ctx) return;
  const { doc, bytes } = ctx;
  const state = await inspect(bytes);
  const wrap = h('<div class="screen-inner pt-narrow"></div>');
  screen.body.appendChild(wrap);

  if (!state.encrypted) {
    wrap.innerHTML = `<div class="empty"><div class="empty-art">${icon('unlock')}</div><h3>Kein Passwortschutz</h3>
      <p>„${esc(doc.name)}“ ist nicht verschlüsselt – du kannst es direkt öffnen, teilen und bearbeiten.</p>
      <a class="btn btn-soft" href="#/werkzeug/passwort?doc=${esc(docId)}">${icon('lock')} Stattdessen Passwort festlegen</a></div>`;
    updateFoot(screen, []);
    return;
  }
  if (state.unsupported) {
    wrap.innerHTML = `<div class="empty"><div class="empty-art">${icon('info')}</div><h3>Nicht unterstützt</h3><p>Diese PDF nutzt ${esc(state.unsupported)}. Das kann FaLe PDF nicht entschlüsseln.</p></div>`;
    updateFoot(screen, []);
    return;
  }
  const sessionPw = knownPassword(docId);
  const what = state.needsPassword
    ? `Geschützt mit Öffnen-Passwort (${esc(state.label)})${state.restricted ? ' und eingeschränkten Rechten' : ''}.`
    : `Ohne Öffnen-Passwort, aber mit eingeschränkten Rechten (${esc(state.label)}).`;
  wrap.innerHTML = `
    <div class="card intro"><span class="tile-ic">${icon('unlock')}</span><div><strong>${esc(doc.name)}</strong>
      <p>${what} Du erhältst eine ungeschützte Kopie – das Original bleibt unverändert. ${proBadge()}</p></div></div>
    <form class="card card-pad" data-form autocomplete="off" novalidate>
      <input type="text" name="username" value="${esc(doc.name)}" autocomplete="username" hidden>
      ${pwField('pw', state.needsPassword ? 'Passwort der PDF' : 'Berechtigungs-Passwort', { autocomplete: 'current-password' })}
      ${sessionPw && state.needsPassword ? '<p class="hint">Das in dieser Sitzung eingegebene Passwort ist bereits eingetragen.</p>' : ''}
      ${state.restricted ? '<p class="hint">Um auch die Einschränkungen (z. B. Drucken verboten) zu entfernen, ist das Berechtigungs-Passwort nötig.</p>' : ''}
      <p class="field-error" data-err hidden></p>
    </form>
    <div data-result></div>`;
  wireEyes(wrap);
  const form = wrap.querySelector('[data-form]');
  const pw = form.querySelector('[name=pw]');
  if (sessionPw && state.needsPassword) pw.value = sessionPw;
  const err = wrap.querySelector('[data-err]');
  const btn = h(`<button class="btn btn-primary" type="button">${icon('unlock')} Schutz entfernen</button>`);
  updateFoot(screen, [btn]);
  form.addEventListener('submit', e => { e.preventDefault(); btn.click(); });
  pw.addEventListener('input', () => { err.hidden = true; });

  btn.addEventListener('click', async () => {
    const fail = msg => { err.textContent = msg; err.hidden = false; toast(msg, 'error'); };
    if (!pw.value) { fail('Bitte gib das Passwort ein.'); pw.focus(); return; }
    btn.disabled = true;
    const prog = progress('Entschlüssele …');
    try {
      let pdfDoc;
      try {
        pdfDoc = await loadProtected(bytes, doc.name, { key: null, prompt: false, passwords: [pw.value] });
      } catch (e) {
        if (e && e.name === 'PasswordCancelled' || (e && /Passwort/.test(e.userMessage || ''))) { fail('Das Passwort ist falsch.'); return; }
        throw e;
      }
      const enc = pdfDoc.faleEncryption || {};
      if (pdfDoc.falePassword === '' && pw.value) { fail('Das Passwort ist falsch.'); return; }
      if (enc.restricted && !enc.owner) {
        fail('Dieses Passwort öffnet die Datei, hebt aber die Einschränkungen nicht auf. Bitte gib das Berechtigungs-Passwort ein.');
        return;
      }
      prog.set('Speichere …');
      pdfDoc.setTitle(pdfDoc.getTitle() || baseName(doc.name));
      const out = await saveDoc(pdfDoc);
      const res = await saveResult(out, `${baseName(doc.name)} (ohne Passwort).pdf`);
      const box = wrap.querySelector('[data-result]');
      box.innerHTML = '';
      box.appendChild(resultCard(res, { from: docId, title: 'Schutz entfernt' }));
      box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      toast('Ungeschützte Kopie gespeichert.', 'success');
    } catch (e) { errorToast(e, 'Entschlüsseln fehlgeschlagen.'); }
    finally { prog.done(); btn.disabled = false; }
  });
}
