// "Sicher teilen": pick a file → encrypt on the device → upload ciphertext → link with the key in the fragment.
import * as db from '../db.js';
import { t } from '../i18n/index.js';
import { h, esc, toast, formatSize, pickFiles, confirmDialog } from '../ui.js';
import { oicon } from '../office/kinds.js';
import { fileThumb } from '../office/filerow.js';
import { b64u, newLinkKey, newKdf, contentKey, hasWebCrypto } from './crypto.js';
import { shareApi, shareConfig, uploadEncrypted, linkBase, online } from './api.js';
import { putEntry, removeEntry } from './registry.js';
import { e2eNote, offlineBanner, progressBar, linkBox, fmtDateTime, shareErrorText, sicon } from './common.js';

const EXPIRY = [{ v: 3600, label: '1 Stunde' }, { v: 86400, label: '1 Tag' }, { v: 604800, label: '7 Tage' }];
const LIMITS = [{ v: 1, label: '1×' }, { v: 5, label: '5×' }, { v: 0, label: 'Unbegrenzt' }];

export async function mount(screen, { params }) {
  const wrap = h('<div class="screen-inner sh-create"></div>');
  screen.body.appendChild(wrap);
  const off = offlineBanner(on => { const b = wrap.querySelector('[data-go]'); if (b) b.disabled = !on || !picked; });
  wrap.appendChild(off.el);
  if (!hasWebCrypto()) {
    wrap.appendChild(h('<div class="card card-pad"><strong>Dieser Browser kann nicht verschlüsseln.</strong><p class="muted">Sicheres Teilen braucht eine HTTPS-Verbindung und einen aktuellen Browser.</p></div>'));
    return () => off.destroy();
  }
  let picked = null; // { blob, name, type, docId }
  const docId = params.get('doc');
  if (docId) {
    const meta = await db.getDoc(docId).catch(() => null);
    const blob = meta ? await db.getFile(docId).catch(() => null) : null;
    if (meta && blob) picked = { blob, name: meta.name, type: blob.type || '', doc: meta };
  }
  const state = { expiresIn: 86400, limit: 5, pw: false };

  function render() {
    wrap.querySelectorAll('[data-part]').forEach(n => n.remove());
    if (!picked) { renderPicker(); return; }
    const form = h(`<div data-part>
      <div class="card sh-filecard">${picked.doc ? fileThumb(picked.doc) : `<span class="doc-thumb kind">${oicon('file')}</span>`}
        <div class="sh-filecard-info"><strong data-no-i18n>${esc(picked.name)}</strong><span class="muted small">${formatSize(picked.blob.size)}</span></div>
        <button class="btn btn-ghost btn-sm" type="button" data-change>Andere Datei</button></div>
      <div class="card card-pad sh-opts">
        <div class="sh-opt"><span class="field-label" id="sh-exp-l">Gültig für</span>
          <div class="seg" role="group" aria-labelledby="sh-exp-l">${EXPIRY.map(e => `<button type="button" data-exp="${e.v}" aria-pressed="${e.v === state.expiresIn}">${e.label}</button>`).join('')}</div></div>
        <div class="sh-opt"><span class="field-label" id="sh-lim-l">Downloads</span>
          <div class="seg" role="group" aria-labelledby="sh-lim-l">${LIMITS.map(e => `<button type="button" data-lim="${e.v}" aria-pressed="${e.v === state.limit}">${e.label}</button>`).join('')}</div></div>
        <div class="sh-opt sh-opt-pw">
          <label class="check"><input type="checkbox" data-pwtoggle ${state.pw ? 'checked' : ''}><span>Zusätzlich mit Passwort schützen</span></label>
          <div data-pwbox ${state.pw ? '' : 'hidden'}>
            <label class="field"><span class="field-label">Passwort</span><input class="input" type="password" data-pw autocomplete="new-password" minlength="6" placeholder="mindestens 6 Zeichen"></label>
            <p class="hint">Sende das Passwort auf einem anderen Weg als den Link (z. B. per Anruf oder SMS). Ohne Passwort lässt sich die Datei nicht öffnen – auch nicht von uns.</p>
          </div>
        </div>
      </div>
      <div class="sh-actions"><button class="btn btn-primary btn-block" type="button" data-go>${sicon('shareLock')} Verschlüsseln &amp; Link erstellen</button></div>
      <div data-prog></div>
    </div>`);
    wrap.appendChild(form);
    { const n = e2eNote({ compact: true }); n.dataset.part = '1'; wrap.appendChild(n); }
    form.querySelector('[data-change]').addEventListener('click', () => { picked = null; render(); });
    form.querySelectorAll('[data-exp]').forEach(b => b.addEventListener('click', () => { state.expiresIn = +b.dataset.exp; form.querySelectorAll('[data-exp]').forEach(x => x.setAttribute('aria-pressed', String(x === b))); }));
    form.querySelectorAll('[data-lim]').forEach(b => b.addEventListener('click', () => { state.limit = +b.dataset.lim; form.querySelectorAll('[data-lim]').forEach(x => x.setAttribute('aria-pressed', String(x === b))); }));
    form.querySelector('[data-pwtoggle]').addEventListener('change', e => { state.pw = e.target.checked; form.querySelector('[data-pwbox]').hidden = !state.pw; if (state.pw) form.querySelector('[data-pw]').focus(); });
    const go = form.querySelector('[data-go]');
    go.disabled = !online();
    go.addEventListener('click', () => create(form));
  }

  async function renderPicker() {
    const docs = await db.listFiles().catch(() => []);
    const box = h(`<div data-part>
      <div class="card intro">${sicon('shareLock')}<div><strong>Datei wählen</strong><p>Wähle eine Datei aus deiner Bibliothek oder von deinem Gerät. Sie wird vor dem Hochladen verschlüsselt.</p></div></div>
      <button class="btn btn-primary" type="button" data-dev>${oicon('upload')} Vom Gerät wählen</button>
      <h2 class="section-title">Deine Dateien</h2><div class="doc-list sh-pick"></div></div>`);
    const list = box.querySelector('.sh-pick');
    if (!docs.length) list.appendChild(h('<p class="panel-empty">Noch keine Dateien vorhanden.</p>'));
    docs.slice(0, 60).forEach(d => {
      const b = h(`<button class="doc doc-open" type="button" style="padding:10px" data-id="${esc(d.id)}">${fileThumb(d)}<span class="doc-info"><span class="doc-name">${esc(d.name)}</span><span class="doc-meta">${formatSize(d.size)}</span></span></button>`);
      b.addEventListener('click', async () => {
        const blob = await db.getFile(d.id);
        if (!blob) { toast('Datei nicht gefunden.', 'error'); return; }
        picked = { blob, name: d.name, type: blob.type || '', doc: d };
        render();
      });
      list.appendChild(b);
    });
    box.querySelector('[data-dev]').addEventListener('click', async () => {
      const [f] = await pickFiles({ accept: '*/*', multiple: false });
      if (!f) return;
      picked = { blob: f, name: f.name, type: f.type || '' };
      render();
    });
    wrap.appendChild(box);
    { const n = e2eNote({ compact: true }); n.dataset.part = '1'; wrap.appendChild(n); }
  }

  async function create(form) {
    const go = form.querySelector('[data-go]');
    const pw = state.pw ? form.querySelector('[data-pw]').value : '';
    if (state.pw && pw.length < 6) { toast('Das Passwort braucht mindestens 6 Zeichen.', 'error'); form.querySelector('[data-pw]').focus(); return; }
    let cfg;
    try { cfg = await shareConfig(); } catch (e) { toast(shareErrorText(e), 'error', { timeout: 6000 }); return; }
    if (!cfg.configured) { toast('Teilen ist noch nicht eingerichtet – bitte versuche es später erneut.', 'info', { timeout: 6000 }); return; }
    if (picked.blob.size > cfg.maxBytes) { toast(`Die Datei ist zu groß (max. ${Math.round(cfg.maxBytes / 1048576)} MB).`, 'error', { timeout: 6000 }); return; }
    go.disabled = true;
    form.querySelectorAll('button, input').forEach(x => { x.disabled = true; });
    const prog = progressBar('Verschlüssele und lade hoch …');
    form.querySelector('[data-prog]').appendChild(prog.el);
    try {
      const L = newLinkKey();
      const kdf = state.pw ? newKdf() : null;
      const ck = await contentKey(L, kdf, pw);
      const meta = { name: picked.name, type: picked.type || 'application/octet-stream', size: picked.blob.size, created: new Date().toISOString() };
      const up = await uploadEncrypted(picked.blob, {
        ck, meta, kdf,
        announce: ({ size, chunks, header }) => shareApi.create({ kind: 'file', size, chunks, header, expiresIn: state.expiresIn, maxDownloads: state.limit || null }),
        onProgress: f => prog.set(f * 0.98),
      });
      const fin = await shareApi.finish(up.id, up.auth);
      prog.set(1, 'Fertig');
      const url = `${linkBase()}#/s/${up.id}#k=${b64u.enc(L)}`;
      const entry = putEntry({ id: up.id, kind: 'file', name: picked.name, size: picked.blob.size, createdAt: Date.now(), expiresAt: fin.object.expiresAt, maxDownloads: up.maxDownloads, auth: up.auth, url, pw: !!kdf });
      showDone(entry);
    } catch (e) {
      prog.el.remove();
      form.querySelectorAll('button, input').forEach(x => { x.disabled = false; });
      toast(shareErrorText(e, 'Der Link konnte nicht erstellt werden.'), 'error', { timeout: 6000 });
    }
  }

  function showDone(entry) {
    wrap.querySelectorAll('[data-part]').forEach(n => n.remove());
    const box = h(`<div data-part class="sh-done">
      <div class="card sh-success">${oicon('checkCircle')}<div><strong>Dein sicherer Link ist bereit</strong>
        <p>Gültig bis ${esc(fmtDateTime(entry.expiresAt))} · ${entry.maxDownloads ? `${entry.maxDownloads}× herunterladbar` : 'beliebig oft herunterladbar'}${entry.pw ? ' · mit Passwort' : ''}</p></div></div>
      <div data-link></div>
      ${entry.pw ? '<p class="hint sh-pwhint">Vergiss nicht, das Passwort separat zu senden.</p>' : ''}
      <div class="sh-actions sh-actions-row">
        <a class="btn btn-ghost" href="#/teilen">${oicon('link')} Meine Links</a>
        <button class="btn btn-danger-ghost" type="button" data-revoke>${oicon('trash')} Link löschen</button>
      </div></div>`);
    box.querySelector('[data-link]').appendChild(linkBox(entry.url, { shareTitle: entry.name, shareText: t(`Ich habe dir „${entry.name}“ sicher geteilt (Ende-zu-Ende-verschlüsselt mit FaLe PDF):`) }));
    box.querySelector('[data-revoke]').addEventListener('click', async () => {
      if (!(await revokeShare(entry))) return;
      location.hash = '#/teilen';
    });
    wrap.appendChild(box);
  }

  render();
  return () => off.destroy();
}

/** Delete a share on the server (and locally). Returns true when done. */
export async function revokeShare(entry, { ask = true } = {}) {
  if (ask && !(await confirmDialog('Link löschen?', `Die verschlüsselte Datei „${entry.name}“ wird sofort vom Server gelöscht. Der Link funktioniert danach nicht mehr.`, { okLabel: 'Link löschen', danger: true }))) return false;
  try {
    await shareApi.remove(entry.id, entry.auth);
    removeEntry(entry.id);
    toast('Link gelöscht.', 'success');
    return true;
  } catch (e) { toast(shareErrorText(e, 'Der Link konnte nicht gelöscht werden.'), 'error'); return false; }
}
