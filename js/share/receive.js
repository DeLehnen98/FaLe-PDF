// Recipient view for "#/s/<id>#k=<key>": works in any browser without installing anything.
// The key is read from the URL fragment (never sent to the server); decryption happens here.
import { h, esc, toast, formatSize } from '../ui.js';
import { oicon, detectKind, openHash } from '../office/kinds.js';
import { saveFile } from '../platform.js';
import { keyFromFragment, contentKey, openObject, parseHeader, hasWebCrypto } from './crypto.js';
import { shareApi, downloadDecrypted, online } from './api.js';
import { offlineBanner, progressBar, fmtDateTime, shareErrorText, sicon } from './common.js';

export async function mount(screen, { arg: id, hash }) {
  const wrap = h('<div class="screen-inner sh-receive"></div>');
  screen.body.appendChild(wrap);
  const off = offlineBanner();
  wrap.appendChild(off.el);
  const main = h('<div class="sh-recv-main"></div>');
  wrap.appendChild(main);
  wrap.appendChild(h(`<p class="muted small sh-recv-foot">${sicon('shield')}<span>Ende-zu-Ende-verschlüsselt: Der Schlüssel steht nur im Link hinter dem # und wird nie an den Server gesendet. Entschlüsselt wird hier auf deinem Gerät. <a href="datenschutz.html" target="_blank" rel="noopener">Datenschutz</a></span></p>`));

  const L = keyFromFragment(hash);
  const errorCard = (title, text, retry) => {
    main.innerHTML = '';
    const c = h(`<div class="card card-pad sh-recv-card sh-recv-error"><span class="sh-recv-ic warn">${oicon('info')}</span><h2>${esc(title)}</h2><p>${esc(text)}</p>
      <div class="sh-actions-row">${retry ? '<button class="btn btn-primary" type="button" data-retry>Erneut versuchen</button>' : ''}<a class="btn btn-ghost" href="#/start">Zu FaLe PDF</a></div></div>`);
    if (retry) c.querySelector('[data-retry]').addEventListener('click', retry);
    main.appendChild(c);
  };
  if (!hasWebCrypto()) { errorCard('Verschlüsselung nicht verfügbar', 'Dieser Browser unterstützt die nötige Verschlüsselung nicht (nur über HTTPS). Bitte öffne den Link in einem aktuellen Browser.'); return () => off.destroy(); }
  if (!/^[A-Za-z0-9_-]{16,32}$/.test(id || '')) { errorCard('Ungültiger Link', 'Dieser Link ist nicht vollständig. Bitte kopiere ihn noch einmal komplett.'); return () => off.destroy(); }
  if (!L) { errorCard('Schlüssel fehlt', 'Der Link ist unvollständig – der Schlüssel fehlt. Bitte kopiere den kompletten Link inklusive des Teils nach „#k=“.'); return () => off.destroy(); }

  let obj = null, opened = null, blob = null, meta = null;

  async function load() {
    main.innerHTML = '<div class="v-loading"><div><span class="spinner dark" style="width:30px;height:30px"></span><span>Wird geladen …</span></div></div>';
    if (!online()) { errorCard('Du bist offline', 'Zum Öffnen des Links brauchst du eine Internetverbindung.', load); return; }
    let r;
    try { r = await shareApi.info(id); }
    catch (e) {
      if (e.status === 404) errorCard('Link nicht mehr verfügbar', 'Dieser Link ist abgelaufen oder wurde vom Absender gelöscht. Die Datei ist nicht mehr auf dem Server.');
      else errorCard('Das hat nicht geklappt', shareErrorText(e), load);
      return;
    }
    obj = r.object;
    if (r.exhausted) { errorCard('Download-Limit erreicht', 'Diese Datei wurde bereits so oft heruntergeladen, wie der Absender erlaubt hat.'); return; }
    let hdr;
    try { hdr = parseHeader(obj.header); } catch (e) { errorCard('Unbekanntes Format', shareErrorText(e)); return; }
    if (hdr.k) askPassword(hdr); else unlock('');
  }

  function askPassword(hdr, wrong = false) {
    main.innerHTML = '';
    const c = h(`<form class="card card-pad sh-recv-card"><span class="sh-recv-ic">${oicon('lock')}</span><h2>Passwort erforderlich</h2>
      <p>Der Absender hat diese Datei zusätzlich mit einem Passwort geschützt.</p>
      <label class="field"><span class="field-label">Passwort</span><input class="input" type="password" data-pw autocomplete="off" required></label>
      ${wrong ? '<p class="text-danger small" role="alert">Das Passwort ist falsch – bitte versuche es erneut.</p>' : ''}
      <button class="btn btn-primary btn-block" type="submit">${oicon('unlock')} Entsperren</button></form>`);
    c.addEventListener('submit', e => { e.preventDefault(); unlock(c.querySelector('[data-pw]').value, hdr); });
    main.appendChild(c);
    setTimeout(() => c.querySelector('[data-pw]').focus(), 50);
  }

  async function unlock(pw, hdr = null) {
    try {
      const ck = await contentKey(L, hdr ? hdr.k : null, pw);
      opened = await openObject(ck, obj.header);
      meta = opened.meta || {};
      showFile();
    } catch (e) {
      if (e.code === 'wrong_key' && hdr && hdr.k) { askPassword(hdr, true); return; }
      errorCard('Entschlüsselung fehlgeschlagen', shareErrorText(e));
    }
  }

  function showFile() {
    const name = String(meta.name || 'Datei');
    const kind = detectKind({ name, type: meta.type || '' });
    const left = obj.maxDownloads != null ? Math.max(0, obj.maxDownloads - obj.downloads) : null;
    main.innerHTML = '';
    const c = h(`<div class="card card-pad sh-recv-card">
      <span class="sh-recv-ic ok">${oicon('file')}</span>
      <p class="sh-recv-kicker">${sicon('shareLock')} Sicher geteilt mit dir</p>
      <h2 class="sh-recv-name" data-no-i18n>${esc(name)}</h2>
      <p class="muted">${formatSize(meta.size || obj.size)} · verfügbar bis ${esc(fmtDateTime(obj.expiresAt))}${left != null ? ` · ${left === 1 ? 'noch 1 Download' : `noch ${left} Downloads`}` : ''}</p>
      <div class="sh-recv-acts">
        <button class="btn btn-primary" type="button" data-dl>${oicon('download')} Herunterladen</button>
        ${kind ? `<button class="btn btn-soft" type="button" data-open>${oicon('open')} In FaLe öffnen</button>` : ''}
      </div>
      <div data-prog></div>
      ${left != null ? '<p class="hint">Jedes Herunterladen bzw. Öffnen zählt als ein Download.</p>' : ''}
    </div>`);
    main.appendChild(c);
    // the recipient may not know FaLe PDF yet: one quiet line about it (no pop-up, no tracking)
    main.appendChild(h(`<div class="card sh-invite"><span class="sh-invite-ic">${oicon('file')}</span><div class="grow"><strong>Selbst sicher teilen, unterschreiben und PDFs bearbeiten?</strong>
      <span>FaLe PDF: PDFs lesen, ausfüllen und unterschreiben – ohne Konto.</span></div><a class="btn btn-soft btn-sm" href="#/start">Ausprobieren</a></div>`));
    c.querySelector('[data-dl]').addEventListener('click', () => act('download', c));
    const ob = c.querySelector('[data-open]');
    if (ob) ob.addEventListener('click', () => act('open', c));
  }

  async function fetchBlob(card) {
    if (blob) return blob;
    const prog = progressBar('Lade und entschlüssele …');
    card.querySelector('[data-prog]').appendChild(prog.el);
    try {
      const r = await shareApi.open(id);
      const res = await downloadDecrypted({ ...r.object, ticket: r.ticket }, null, { opened, onProgress: f => prog.set(f) });
      blob = new Blob([res.blob], { type: meta.type || res.blob.type || 'application/octet-stream' });
      prog.set(1, 'Entschlüsselt');
      setTimeout(() => prog.el.remove(), 1200);
      return blob;
    } catch (e) {
      prog.el.remove();
      if (e.code === 'exhausted') { errorCard('Download-Limit erreicht', 'Diese Datei wurde bereits so oft heruntergeladen, wie der Absender erlaubt hat.'); return null; }
      if (e.status === 404) { errorCard('Link nicht mehr verfügbar', 'Dieser Link ist abgelaufen oder wurde vom Absender gelöscht.'); return null; }
      toast(shareErrorText(e, 'Herunterladen fehlgeschlagen.'), 'error', { timeout: 6000 });
      return null;
    }
  }

  async function act(what, card) {
    card.querySelectorAll('.sh-recv-acts button').forEach(b => { b.disabled = true; });
    try {
      const b = await fetchBlob(card);
      if (!b) return;
      const name = String(meta.name || 'Datei');
      if (what === 'download') await saveFile(b, name, b.type);
      else {
        const { importFiles } = await import('../library.js');
        const docs = await importFiles([new File([b], name, { type: b.type })], { source: 'Empfangen', any: true });
        if (docs[0]) location.hash = openHash(docs[0]);
      }
    } finally { card.querySelectorAll('.sh-recv-acts button').forEach(x => { x.disabled = false; }); }
  }

  await load();
  return () => off.destroy();
}
