// "Unterlagen anfordern": send a link, others upload documents to you – end-to-end encrypted, no account.
//   mount        #/teilen/anfordern            create a request (title, message, wanted documents, expiry)
//   mountStatus  #/teilen/unterlagen/<id>      received files: open, save, ZIP, delete; stop/allow uploads
//   mountUpload  #/r/<token>#k=<key>           uploader view (any browser, no install, no account)
// Crypto (js/share/crypto.js): the request header (title, message, list, the requester's PUBLIC key) is encrypted
// with the link key; every file is encrypted to the requester's public key (ECDH) – the link lets you upload,
// never download. The private key stays on the requester's device (registry entry).
import { t } from '../i18n/index.js';
import { h, esc, toast, formatSize, pickFiles, confirmDialog } from '../ui.js';
import { oicon, detectKind, openHash } from '../office/kinds.js';
import { saveFile } from '../platform.js';
import { b64u, newLinkKey, keyFromFragment, sealObject, openObject, parseHeader, newRequestKeys, uploadKey, ownerFileKey, hasWebCrypto } from './crypto.js';
import { requestApi, shareApi, shareConfig, uploadEncrypted, downloadDecrypted, linkBase, online } from './api.js';
import { putEntry, getEntry, patchEntry, removeEntry, isExpired } from './registry.js';
import { offlineBanner, progressBar, linkBox, fmtDateTime, expiryLabel, shareErrorText, sicon, copyToClipboard } from './common.js';

const EXPIRY = [{ v: 604800, label: '7 Tage' }, { v: 1209600, label: '14 Tage' }, { v: 2592000, label: '30 Tage' }];
const MAXFILES = [{ v: 10, label: '10' }, { v: 25, label: '25' }, { v: 50, label: '50' }];
const MAX_ITEMS = 20;
const TOKEN_RE = /^[A-Za-z0-9_-]{24,64}$/;
const clean = (s, n) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, n);

export const uploadUrl = entry => entry.url;
function inviteText(entry) {
  return entry.from ? t(`${entry.from} bittet dich, Unterlagen hochzuladen („${entry.name}“). Verschlüsselt, ohne Konto:`)
    : t(`Bitte lade hier deine Unterlagen hoch („${entry.name}“). Verschlüsselt, ohne Konto:`);
}

// ================================================================ create
export async function mount(screen) {
  const wrap = h('<div class="screen-inner sh-create sh-rq-create"></div>');
  screen.body.appendChild(wrap);
  const off = offlineBanner(on => { const b = wrap.querySelector('[data-go]'); if (b) b.disabled = !on; });
  wrap.appendChild(off.el);
  if (!hasWebCrypto()) {
    wrap.appendChild(h('<div class="card card-pad"><strong>Dieser Browser kann nicht verschlüsseln.</strong><p class="muted">Unterlagen anfordern braucht eine HTTPS-Verbindung und einen aktuellen Browser.</p></div>'));
    return () => off.destroy();
  }
  const state = { expiresIn: 1209600, maxFiles: 25, items: [''] };
  const form = h(`<div data-part>
    <div class="card intro">${sicon('inbox')}<div><strong>Dateien von anderen bekommen</strong>
      <p>Du bekommst einen Link. Wer ihn öffnet, kann Dateien verschlüsselt bei dir hochladen – ohne Konto, ohne App. Öffnen kannst nur du, auf diesem Gerät.</p></div></div>
    <div class="card card-pad sh-opts">
      <label class="field"><span class="field-label">Wofür brauchst du die Unterlagen?</span>
        <input class="input" data-title maxlength="120" placeholder="z. B. Unterlagen für die Steuererklärung 2026" required></label>
      <label class="field"><span class="field-label">Dein Name (sieht die andere Person)</span>
        <input class="input" data-from maxlength="80" autocomplete="name" placeholder="z. B. Anna Muster oder Praxis Dr. Muster"></label>
      <label class="field"><span class="field-label">Nachricht (optional)</span>
        <textarea class="input sh-rq-msg" data-msg maxlength="1500" rows="3" placeholder="z. B. Bitte bis Ende des Monats hochladen. Danke!"></textarea></label>
      <div class="sh-opt"><span class="field-label" id="sh-rq-items-l">Welche Unterlagen? (optional)</span>
        <p class="hint">Die andere Person sieht eine Checkliste und kann jede Datei einem Punkt zuordnen.</p>
        <div class="sh-rq-items" role="group" aria-labelledby="sh-rq-items-l" data-items></div>
        <button class="btn btn-ghost btn-sm" type="button" data-add>${oicon('plus')} Punkt hinzufügen</button></div>
      <div class="sh-opt"><span class="field-label" id="sh-rq-exp-l">Hochladen möglich für</span>
        <div class="seg" role="group" aria-labelledby="sh-rq-exp-l">${EXPIRY.map(e => `<button type="button" data-exp="${e.v}" aria-pressed="${e.v === state.expiresIn}">${e.label}</button>`).join('')}</div></div>
      <div class="sh-opt"><span class="field-label" id="sh-rq-max-l">Höchstens Dateien</span>
        <div class="seg" role="group" aria-labelledby="sh-rq-max-l">${MAXFILES.map(e => `<button type="button" data-max="${e.v}" aria-pressed="${e.v === state.maxFiles}">${e.label}</button>`).join('')}</div></div>
    </div>
    <div class="sh-actions"><button class="btn btn-primary btn-block" type="button" data-go>${sicon('inbox')} Link zum Hochladen erstellen</button></div>
    <div data-prog></div>
    <div class="sh-e2e compact">${sicon('shareLock')}<div><strong>So bleiben die Unterlagen privat</strong>
      <p>Jede Datei wird schon auf dem Gerät der anderen Person verschlüsselt – mit einem Schlüssel, den nur dieses Gerät hier hat. Unser Server sieht weder Inhalte noch Dateinamen. Wer den Link hat, kann nur hochladen, nichts herunterladen. Alles wird nach Ablauf automatisch gelöscht.</p></div></div>
  </div>`);
  wrap.appendChild(form);
  const itemsBox = form.querySelector('[data-items]');
  const addBtn = form.querySelector('[data-add]');
  function drawItems() {
    itemsBox.innerHTML = '';
    state.items.forEach((v, i) => {
      const row = h(`<div class="sh-rq-item"><input class="input" maxlength="100" aria-label="${esc(t(`Unterlage ${i + 1}`))}" placeholder="${esc(i === 0 ? 'z. B. Lohnsteuerbescheinigung' : i === 1 ? 'z. B. Kontoauszug' : 'Weitere Unterlage')}">
        <button class="icon-btn" type="button" aria-label="${esc(t(`Unterlage ${i + 1} entfernen`))}" ${state.items.length < 2 ? 'disabled' : ''}>${oicon('close')}</button></div>`);
      const inp = row.querySelector('input');
      inp.value = v;
      inp.addEventListener('input', () => { state.items[i] = inp.value; });
      inp.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); addBtn.click(); } });
      row.querySelector('button').addEventListener('click', () => { state.items.splice(i, 1); drawItems(); });
      itemsBox.appendChild(row);
    });
    addBtn.hidden = state.items.length >= MAX_ITEMS;
  }
  addBtn.addEventListener('click', () => { if (state.items.length >= MAX_ITEMS) return; state.items.push(''); drawItems(); itemsBox.lastElementChild.querySelector('input').focus(); });
  drawItems();
  form.querySelectorAll('[data-exp]').forEach(b => b.addEventListener('click', () => { state.expiresIn = +b.dataset.exp; form.querySelectorAll('[data-exp]').forEach(x => x.setAttribute('aria-pressed', String(x === b))); }));
  form.querySelectorAll('[data-max]').forEach(b => b.addEventListener('click', () => { state.maxFiles = +b.dataset.max; form.querySelectorAll('[data-max]').forEach(x => x.setAttribute('aria-pressed', String(x === b))); }));
  const go = form.querySelector('[data-go]');
  go.disabled = !online();
  go.addEventListener('click', create);

  async function create() {
    const title = clean(form.querySelector('[data-title]').value, 120);
    if (!title) { toast('Bitte schreib kurz, wofür du die Unterlagen brauchst.', 'error'); form.querySelector('[data-title]').focus(); return; }
    const from = clean(form.querySelector('[data-from]').value, 80);
    const msg = String(form.querySelector('[data-msg]').value || '').trim().slice(0, 1500);
    const items = [...new Set(state.items.map(x => clean(x, 100)).filter(Boolean))];
    let cfg;
    try { cfg = await shareConfig(); } catch (e) { toast(shareErrorText(e), 'error', { timeout: 6000 }); return; }
    if (!cfg.configured) { toast('Teilen ist noch nicht eingerichtet – bitte versuche es später erneut.', 'info', { timeout: 6000 }); return; }
    form.querySelectorAll('button, input, textarea').forEach(x => { x.disabled = true; });
    const prog = progressBar('Schlüssel werden erzeugt …');
    form.querySelector('[data-prog]').appendChild(prog.el);
    try {
      const keys = await newRequestKeys();
      const L = newLinkKey();
      const meta = { title, from, msg, items, pub: keys.pub, created: new Date().toISOString() };
      const { header } = await sealObject(L, meta, { plainSize: 0, chunkSize: cfg.chunkSize });
      prog.set(0.6, 'Link wird erstellt …');
      const r = await requestApi.create({ header, expiresIn: state.expiresIn, maxFiles: Math.min(state.maxFiles, cfg.reqMaxFiles || 50) });
      const url = `${linkBase()}#/r/${r.upload}#k=${b64u.enc(L)}`;
      const entry = putEntry({ id: r.id, kind: 'req', name: title, from, items, createdAt: Date.now(), expiresAt: r.expiresAt, auth: r.auth, url, priv: keys.priv,
        maxFiles: r.maxFiles, maxBytes: r.maxBytes, lastCount: 0 });
      prog.set(1, 'Fertig');
      showCreated(entry);
    } catch (e) {
      prog.el.remove();
      form.querySelectorAll('button, input, textarea').forEach(x => { x.disabled = false; });
      drawItems();
      toast(shareErrorText(e, 'Der Link konnte nicht erstellt werden.'), 'error', { timeout: 6000 });
    }
  }

  function showCreated(entry) {
    form.remove();
    const box = h(`<div class="sh-done">
      <div class="card sh-success">${oicon('checkCircle')}<div><strong>Dein Link zum Hochladen ist bereit</strong>
        <p>Hochladen möglich bis ${esc(fmtDateTime(entry.expiresAt))} · höchstens ${entry.maxFiles} Dateien</p></div></div>
      <div data-link></div>
      <p class="hint sh-rq-keyhint">${oicon('shield')}<span>Die Dateien kannst du nur auf diesem Gerät in diesem Browser öffnen – hier liegt der Schlüssel. Lösch die Browserdaten nicht, bevor du alles gespeichert hast.</span></p>
      <div class="sh-actions sh-actions-row">
        <a class="btn btn-primary" href="#/teilen/unterlagen/${esc(entry.id)}">${sicon('inbox')} Eingang ansehen</a>
        <a class="btn btn-ghost" href="#/teilen">${oicon('link')} Übersicht</a>
      </div></div>`);
    box.querySelector('[data-link]').appendChild(linkBox(entry.url, { label: 'Link zum Hochladen', shareTitle: entry.name, shareText: inviteText(entry) }));
    wrap.insertBefore(box, wrap.querySelector('.sh-e2e'));
  }

  return () => off.destroy();
}

// ================================================================ requester: received files
async function decryptMeta(entry, file) {
  const hdr = parseHeader(file.header);
  if (typeof hdr.e !== 'string') throw new Error('no key');
  const ck = await ownerFileKey(entry.priv, hdr.e);
  return openObject(ck, file.header);
}

export async function mountStatus(screen, { arg: id }) {
  const entry = getEntry(id);
  const wrap = h('<div class="screen-inner sh-status sh-rq-status"></div>');
  screen.body.appendChild(wrap);
  if (!entry || entry.kind !== 'req' || !entry.priv) {
    wrap.appendChild(h(`<div class="empty"><div class="empty-art">${oicon('info')}</div><h3>Anfrage nicht gefunden</h3><p>Diese Anfrage ist auf diesem Gerät nicht gespeichert. Die hochgeladenen Dateien lassen sich nur auf dem Gerät öffnen, auf dem du die Anfrage erstellt hast.</p><a class="btn btn-ghost" href="#/teilen">Zur Übersicht</a></div>`));
    return null;
  }
  screen.setTitle('Unterlagen-Eingang', entry.name);
  const off = offlineBanner(on => { if (on) refresh(); });
  wrap.appendChild(off.el);
  const head = h(`<div class="card sh-status-head">${sicon('inbox')}<div><strong data-no-i18n>${esc(entry.name)}</strong>
    <span class="muted small" data-exp></span></div><button class="btn btn-ghost btn-sm" type="button" data-refresh>${oicon('undo')} Aktualisieren</button></div>`);
  wrap.appendChild(head);
  const linkCard = h(`<details class="card card-pad sh-rq-linkcard"><summary><strong>Link zum Hochladen</strong> <span class="muted small">kopieren, teilen, QR-Code</span></summary></details>`);
  linkCard.appendChild(linkBox(entry.url, { label: 'Link zum Hochladen', shareTitle: entry.name, shareText: inviteText(entry) }));
  wrap.appendChild(linkCard);
  const openRow = h(`<label class="card sh-rq-toggle"><input type="checkbox" data-open checked><span><strong>Neue Dateien annehmen</strong><span class="muted small" data-openhint>Wer den Link hat, kann gerade hochladen.</span></span></label>`);
  wrap.appendChild(openRow);
  const checklist = h('<div class="sh-rq-check" data-check hidden></div>');
  wrap.appendChild(checklist);
  const filesHead = h(`<h2 class="section-title">Eingegangene Dateien <span class="sh-rq-acts"><button class="btn btn-sm btn-soft" type="button" data-zip hidden>${oicon('download')} Alle als ZIP</button></span></h2>`);
  wrap.appendChild(filesHead);
  const list = h('<div class="sh-list" data-rqfiles></div>');
  wrap.appendChild(list);
  const prog = h('<div data-prog></div>');
  wrap.appendChild(prog);
  const acts = h(`<div class="sh-actions sh-actions-row"><button class="btn btn-danger-ghost" type="button" data-del>${oicon('trash')} Anfrage und alle Dateien löschen</button></div>`);
  wrap.appendChild(acts);
  wrap.appendChild(h(`<p class="muted small sh-local-note">${oicon('info')}<span>Der Server kennt nur, wie viele verschlüsselte Dateien wie groß sind und wann sie kamen – nicht Namen, Inhalte, Absender oder deine Nachricht. Nach Ablauf wird alles automatisch gelöscht.</span></p>`));

  const openBox = openRow.querySelector('[data-open]');
  openBox.addEventListener('change', async () => {
    const want = openBox.checked;
    openBox.disabled = true;
    try { await requestApi.close(entry.id, entry.auth, !want); toast(want ? 'Hochladen ist wieder möglich.' : 'Es können keine neuen Dateien mehr hochgeladen werden.', 'success'); await refresh(); }
    catch (e) { openBox.checked = !want; toast(shareErrorText(e), 'error'); }
    finally { openBox.disabled = false; }
  });
  head.querySelector('[data-refresh]').addEventListener('click', () => refresh());
  acts.querySelector('[data-del]').addEventListener('click', async () => {
    if (!(await confirmDialog('Anfrage löschen?', 'Alle hochgeladenen Dateien werden sofort vom Server gelöscht und der Link funktioniert nicht mehr. Dateien, die du schon gespeichert hast, bleiben erhalten.', { okLabel: 'Löschen', danger: true }))) return;
    try { await requestApi.remove(entry.id, entry.auth); } catch (e) { if (e.status !== 404) { toast(shareErrorText(e), 'error'); return; } }
    removeEntry(entry.id);
    toast('Anfrage gelöscht.', 'success');
    location.hash = '#/teilen';
  });

  const metas = new Map(); // file id → { meta, opened } | { error }
  const blobs = new Map();
  let last = null;

  async function fileBlob(f, bar) {
    if (blobs.has(f.id)) return blobs.get(f.id);
    const m = metas.get(f.id);
    const r = await downloadDecrypted(f, null, { opened: m.opened, onProgress: p => bar && bar.set(p) });
    const blob = new Blob([r.blob], { type: m.meta.type || 'application/octet-stream' });
    blobs.set(f.id, blob);
    return blob;
  }
  async function act(f, what, row) {
    const btns = row.querySelectorAll('button');
    btns.forEach(b => { b.disabled = true; });
    const bar = progressBar('Lade und entschlüssele …');
    row.after(bar.el);
    try {
      const m = metas.get(f.id).meta;
      const blob = await fileBlob(f, bar);
      const name = String(m.name || 'Datei');
      if (what === 'save') await saveFile(blob, name, blob.type);
      else {
        const { importFiles } = await import('../library.js');
        const docs = await importFiles([new File([blob], name, { type: blob.type })], { source: 'Unterlagen', any: true });
        if (docs[0]) { toast(t(`„${name}“ ist jetzt in deinen Dateien.`), 'success'); if (what === 'open') location.hash = openHash(docs[0]); }
      }
    } catch (e) {
      if (e && e.status === 404) { toast('Diese Datei ist nicht mehr auf dem Server.', 'error'); refresh(); }
      else toast(shareErrorText(e, 'Herunterladen fehlgeschlagen.'), 'error', { timeout: 6000 });
    } finally { bar.el.remove(); btns.forEach(b => { b.disabled = false; }); }
  }

  async function zipAll(files) {
    const btn = filesHead.querySelector('[data-zip]');
    btn.disabled = true;
    const bar = progressBar('Lade und entschlüssele …');
    prog.appendChild(bar.el);
    try {
      const ok = files.filter(f => metas.get(f.id) && metas.get(f.id).meta);
      const out = [];
      for (const [i, f] of ok.entries()) {
        const m = metas.get(f.id).meta;
        const blob = await fileBlob(f, { set: p => bar.set((i + p) / ok.length) });
        const folder = m.item ? clean(m.item, 60).replace(/[\\/:*?"<>|]/g, '_') + '/' : '';
        out.push({ name: folder + String(m.name || 'Datei').replace(/[\\/:*?"<>|]/g, '_'), data: blob });
      }
      const { createZip } = await import('../zip.js');
      const zip = await createZip(out);
      await saveFile(zip, `${clean(entry.name, 60).replace(/[\\/:*?"<>|]/g, '_') || 'Unterlagen'}.zip`, 'application/zip');
    } catch (e) { toast(shareErrorText(e, 'Herunterladen fehlgeschlagen.'), 'error', { timeout: 6000 }); }
    finally { bar.el.remove(); btn.disabled = false; }
  }

  function render(r) {
    const expired = isExpired(entry) || (r && !r.exists);
    head.querySelector('[data-exp]').textContent = expired ? t('Abgelaufen – die Daten wurden vom Server gelöscht.')
      : `${t('Erstellt am')} ${fmtDateTime(r && r.createdAt || new Date(entry.createdAt).toISOString())} · ${t(expiryLabel(entry.expiresAt))}`;
    linkCard.hidden = expired;
    openRow.hidden = expired;
    if (r && r.exists) {
      openBox.checked = !r.closed;
      openRow.querySelector('[data-openhint]').textContent = t(r.closed ? 'Hochladen ist pausiert – der Link zeigt einen Hinweis.' : 'Wer den Link hat, kann gerade hochladen.');
    }
    const files = r && r.exists ? r.files : [];
    // checklist of wanted documents
    const items = entry.items || [];
    checklist.hidden = !items.length || expired;
    checklist.innerHTML = '';
    if (items.length) {
      const got = new Set(files.map(f => metas.get(f.id)?.meta?.item).filter(Boolean));
      checklist.appendChild(h(`<div class="card card-pad"><strong>Angefordert</strong><ul class="sh-rq-checklist">${items.map(it => `<li class="${got.has(it) ? 'done' : ''}">${(got.has(it) ? oicon('checkCircle') : sicon('timer'))}<span data-no-i18n>${esc(it)}</span><span class="muted small">${got.has(it) ? esc(t('erhalten')) : esc(t('fehlt noch'))}</span></li>`).join('')}</ul></div>`));
    }
    list.innerHTML = '';
    filesHead.querySelector('[data-zip]').hidden = files.length < 2;
    if (!files.length) {
      list.appendChild(h(`<p class="panel-empty">${expired ? 'Keine Dateien mehr – die Anfrage ist abgelaufen.' : 'Noch keine Dateien. Schick den Link an die Person, von der du Unterlagen brauchst.'}</p>`));
      return;
    }
    files.forEach(f => {
      const m = metas.get(f.id);
      const meta = m && m.meta;
      const kind = meta ? detectKind({ name: meta.name || '', type: meta.type || '' }) : null;
      const sub = meta ? [formatSize(meta.size || 0), meta.from ? t(`von ${meta.from}`) : '', meta.item ? meta.item : '', fmtDateTime(f.createdAt)].filter(Boolean).join(' · ') : '';
      const row = h(`<article class="card sh-row sh-rq-file" data-file-id="${esc(f.id)}">
        <span class="sh-row-ic">${oicon(m && m.error ? 'info' : 'file')}</span>
        <div class="sh-row-main"><strong data-no-i18n>${esc(meta ? meta.name || 'Datei' : m && m.error ? t('Datei lässt sich nicht öffnen') : '…')}</strong>
          <span class="muted small" data-no-i18n>${esc(sub)}</span>
          ${meta && meta.note ? `<span class="sh-rq-note" data-no-i18n>${esc(meta.note)}</span>` : ''}</div>
        <div class="sh-row-acts">
          ${meta ? `<button class="icon-btn" type="button" data-save aria-label="${esc(t('Herunterladen'))}" title="${esc(t('Herunterladen'))}">${oicon('download')}</button>
          <button class="icon-btn" type="button" data-import aria-label="${esc(t('In Dateien speichern'))}" title="${esc(t('In Dateien speichern'))}">${oicon('folder')}</button>
          ${kind ? `<button class="icon-btn" type="button" data-open aria-label="${esc(t('Öffnen'))}" title="${esc(t('Öffnen'))}">${oicon('open')}</button>` : ''}` : ''}
          <button class="icon-btn" type="button" data-rm aria-label="${esc(t('Vom Server löschen'))}" title="${esc(t('Vom Server löschen'))}">${oicon('trash')}</button>
        </div></article>`);
      const on = (sel, fn) => { const b = row.querySelector(sel); if (b) b.addEventListener('click', fn); };
      on('[data-save]', () => act(f, 'save', row));
      on('[data-import]', () => act(f, 'import', row));
      on('[data-open]', () => act(f, 'open', row));
      on('[data-rm]', async () => {
        if (!(await confirmDialog('Datei löschen?', t(`„${meta ? meta.name : 'Datei'}“ wird sofort vom Server gelöscht.`), { okLabel: 'Löschen', danger: true }))) return;
        try { await requestApi.removeFile(entry.id, entry.auth, f.id); toast('Datei gelöscht.', 'success'); refresh(); }
        catch (e) { toast(shareErrorText(e), 'error'); }
      });
      list.appendChild(row);
    });
    filesHead.querySelector('[data-zip]').onclick = () => zipAll(files);
  }

  async function refresh() {
    if (!online() || isExpired(entry)) { render(last); return; }
    try {
      const r = await requestApi.status(entry.id, entry.auth);
      if (r.exists) {
        await Promise.all(r.files.filter(f => !metas.has(f.id)).map(async f => {
          try { const o = await decryptMeta(entry, f); metas.set(f.id, { meta: o.meta, opened: o }); }
          catch { metas.set(f.id, { error: true }); }
        }));
        patchEntry(entry.id, { lastCount: r.files.length, lastCheck: Date.now(), closed: r.closed });
      } else patchEntry(entry.id, { expiresAt: new Date().toISOString() });
      Object.assign(entry, getEntry(entry.id) || {});
      last = r;
      render(r);
    } catch (e) {
      render(last);
      if (e.code !== 'offline') toast(shareErrorText(e), 'error');
    }
  }
  render(null);
  await refresh();
  const timer = setInterval(() => { if (!document.hidden) refresh(); }, 20000);
  return () => { clearInterval(timer); off.destroy(); };
}

// ================================================================ uploader view (#/r/<token>#k=…)
export async function mountUpload(screen, { arg: token, hash }) {
  const wrap = h('<div class="screen-inner sh-receive sh-rq-upload"></div>');
  screen.body.appendChild(wrap);
  const off = offlineBanner();
  wrap.appendChild(off.el);
  const main = h('<div class="sh-recv-main"></div>');
  wrap.appendChild(main);
  wrap.appendChild(h(`<p class="muted small sh-recv-foot">${sicon('shield')}<span>Ende-zu-Ende-verschlüsselt: Jede Datei wird hier auf deinem Gerät verschlüsselt, bevor sie hochgeladen wird. Öffnen kann sie nur die Person, die dich gefragt hat – nicht wir und auch niemand sonst, der diesen Link hat. <a href="datenschutz.html" target="_blank" rel="noopener">Datenschutz</a></span></p>`));
  const L = keyFromFragment(hash);
  const errorCard = (title, text, retry) => {
    main.innerHTML = '';
    const c = h(`<div class="card card-pad sh-recv-card sh-recv-error"><span class="sh-recv-ic warn">${oicon('info')}</span><h2>${esc(title)}</h2><p>${esc(text)}</p>
      <div class="sh-actions-row">${retry ? '<button class="btn btn-primary" type="button" data-retry>Erneut versuchen</button>' : ''}<a class="btn btn-ghost" href="#/start">Zu FaLe PDF</a></div></div>`);
    if (retry) c.querySelector('[data-retry]').addEventListener('click', retry);
    main.appendChild(c);
  };
  if (!hasWebCrypto()) { errorCard('Verschlüsselung nicht verfügbar', 'Dieser Browser unterstützt die nötige Verschlüsselung nicht (nur über HTTPS). Bitte öffne den Link in einem aktuellen Browser.'); return () => off.destroy(); }
  if (!TOKEN_RE.test(token || '')) { errorCard('Ungültiger Link', 'Dieser Link ist nicht vollständig. Bitte kopiere ihn noch einmal komplett.'); return () => off.destroy(); }
  if (!L) { errorCard('Schlüssel fehlt', 'Der Link ist unvollständig – der Schlüssel fehlt. Bitte kopiere den kompletten Link inklusive des Teils nach „#k=“.'); return () => off.destroy(); }

  const SKEY = 'fale-rq-up-' + token.slice(0, 16);
  const sent = (() => { try { return JSON.parse(sessionStorage.getItem(SKEY) || '[]'); } catch { return []; } })();
  const saveSent = () => { try { sessionStorage.setItem(SKEY, JSON.stringify(sent.slice(-100))); } catch {} };
  let info = null, meta = null, cfg = null;
  let picked = []; // { file, item }

  async function load() {
    main.innerHTML = '<div class="v-loading"><div><span class="spinner dark" style="width:30px;height:30px"></span><span>Wird geladen …</span></div></div>';
    if (!online()) { errorCard('Du bist offline', 'Zum Hochladen brauchst du eine Internetverbindung.', load); return; }
    try { [info, cfg] = await Promise.all([requestApi.open(token), shareConfig()]); }
    catch (e) {
      if (e.status === 404) errorCard('Link nicht mehr gültig', 'Diese Anfrage ist abgelaufen oder wurde gelöscht. Bitte frag nach einem neuen Link.');
      else errorCard('Das hat nicht geklappt', shareErrorText(e), load);
      return;
    }
    try { meta = (await openObject(L, info.header)).meta || {}; }
    catch (e) { errorCard('Link beschädigt', shareErrorText(e, 'Der Schlüssel im Link passt nicht. Bitte prüfe, ob der Link vollständig kopiert wurde.')); return; }
    if (typeof meta.pub !== 'string') { errorCard('Link beschädigt', 'Diese Anfrage ist beschädigt. Bitte frag nach einem neuen Link.'); return; }
    show();
  }

  function show() {
    const items = Array.isArray(meta.items) ? meta.items.map(x => clean(x, 100)).filter(Boolean).slice(0, MAX_ITEMS) : [];
    const from = clean(meta.from, 80);
    const left = Math.max(0, info.maxFiles - info.files);
    main.innerHTML = '';
    const head = h(`<div class="card sh-sign-head sh-rq-head">${sicon('inbox')}<div>
      <p class="sh-recv-kicker">${sicon('shareLock')} ${esc(from ? t(`${from} bittet dich um Unterlagen`) : t('Du wirst um Unterlagen gebeten'))}</p>
      <h2 data-no-i18n>${esc(clean(meta.title, 120) || t('Unterlagen'))}</h2>
      ${meta.msg ? `<p class="sh-msg" data-no-i18n>${esc(String(meta.msg).slice(0, 1500))}</p>` : ''}
      <p class="muted small">${esc(t(`Hochladen möglich bis ${fmtDateTime(info.expiresAt)}`))} · ${esc(t(`max. ${Math.round(info.maxFileBytes / 1048576)} MB pro Datei`))}</p>
      ${items.length ? `<ul class="sh-rq-checklist">${items.map(it => `<li data-item="${esc(it)}">${sicon('timer')}<span data-no-i18n>${esc(it)}</span></li>`).join('')}</ul>` : ''}
    </div></div>`);
    main.appendChild(head);
    if (info.closed) {
      main.appendChild(h(`<div class="card card-pad sh-rq-closed">${oicon('info')}<div><strong>Hochladen ist gerade nicht möglich</strong><p class="muted">${esc(from ? t(`${from} nimmt im Moment keine neuen Dateien an.`) : t('Diese Anfrage nimmt im Moment keine neuen Dateien an.'))}</p></div></div>`));
      drawSent();
      return;
    }
    if (!left) {
      main.appendChild(h(`<div class="card card-pad sh-rq-closed">${oicon('info')}<div><strong>Die Anfrage ist voll</strong><p class="muted">Es wurden schon so viele Dateien hochgeladen, wie erlaubt sind.</p></div></div>`));
      drawSent();
      return;
    }
    const nameKey = 'fale-rq-name';
    let savedName = '';
    try { savedName = sessionStorage.getItem(nameKey) || ''; } catch {}
    const form = h(`<div class="card card-pad sh-rq-form">
      <label class="field"><span class="field-label">Dein Name</span><input class="input" data-name maxlength="80" autocomplete="name" placeholder="damit klar ist, von wem die Dateien sind"></label>
      <div class="sh-rq-pick"><button class="btn btn-primary" type="button" data-pick>${oicon('upload')} Dateien auswählen</button>
        <button class="btn btn-ghost" type="button" data-cam>${oicon('camera')} Foto aufnehmen</button>
        <span class="muted small">${esc(t(left === 1 ? 'noch 1 Datei möglich' : `noch ${left} Dateien möglich`))}</span></div>
      <div class="sh-rq-picked" data-picked></div>
      <label class="field" data-notebox hidden><span class="field-label">Nachricht (optional)</span><textarea class="input sh-rq-msg" data-note maxlength="1000" rows="2" placeholder="z. B. Den Kontoauszug reiche ich nächste Woche nach."></textarea></label>
      <button class="btn btn-primary btn-block" type="button" data-send hidden>${sicon('shareLock')} Verschlüsselt hochladen</button>
      <div data-prog></div></div>`);
    main.appendChild(form);
    const nameIn = form.querySelector('[data-name]');
    nameIn.value = savedName;
    nameIn.addEventListener('input', () => { try { sessionStorage.setItem(nameKey, nameIn.value); } catch {} });
    const add = files => {
      for (const f of files) {
        if (picked.length >= left) { toast(t(`Es sind nur noch ${left} Dateien möglich.`), 'error'); break; }
        if (f.size > info.maxFileBytes) { toast(t(`„${f.name}“ ist zu groß (max. ${Math.round(info.maxFileBytes / 1048576)} MB).`), 'error', { timeout: 6000 }); continue; }
        picked.push({ file: f, item: items.length === 1 ? items[0] : '' });
      }
      drawPicked();
    };
    form.querySelector('[data-pick]').addEventListener('click', async () => add(await pickFiles({ accept: '*/*', multiple: true })));
    form.querySelector('[data-cam]').addEventListener('click', async () => add(await pickFiles({ accept: 'image/*', multiple: false, capture: 'environment' })));
    form.querySelector('[data-send]').addEventListener('click', () => send(form));
    // drop files onto the card
    form.addEventListener('dragover', e => { e.preventDefault(); form.classList.add('drop'); });
    form.addEventListener('dragleave', () => form.classList.remove('drop'));
    form.addEventListener('drop', e => { e.preventDefault(); form.classList.remove('drop'); add([...(e.dataTransfer?.files || [])]); });

    function drawPicked() {
      const box = form.querySelector('[data-picked]');
      box.innerHTML = '';
      picked.forEach((p, i) => {
        const row = h(`<div class="sh-rq-prow"><span class="sh-row-ic">${oicon('file')}</span>
          <div class="sh-row-main"><strong data-no-i18n>${esc(p.file.name)}</strong><span class="muted small">${formatSize(p.file.size)}</span></div>
          <button class="icon-btn" type="button" aria-label="${esc(t(`${p.file.name} entfernen`))}">${oicon('close')}</button>
          ${items.length ? `<label class="sh-rq-assign"><select class="input" aria-label="${esc(t(`Gehört zu – ${p.file.name}`))}"><option value="">${esc(t('Gehört zu …'))}</option>${items.map(it => `<option value="${esc(it)}" ${p.item === it ? 'selected' : ''}>${esc(it)}</option>`).join('')}<option value="__other" ${p.item === '__other' ? 'selected' : ''}>${esc(t('Sonstiges'))}</option></select></label>` : ''}</div>`);
        const sel = row.querySelector('select');
        if (sel) sel.addEventListener('change', () => { p.item = sel.value; });
        row.querySelector('button').addEventListener('click', () => { picked.splice(i, 1); drawPicked(); });
        box.appendChild(row);
      });
      form.querySelector('[data-send]').hidden = !picked.length;
      form.querySelector('[data-notebox]').hidden = !picked.length;
      form.querySelector('[data-send]').textContent = '';
      form.querySelector('[data-send]').insertAdjacentHTML('beforeend', `${sicon('shareLock')} ${esc(t(picked.length === 1 ? 'Verschlüsselt hochladen' : `${picked.length} Dateien verschlüsselt hochladen`))}`);
    }
    drawSent();
  }

  async function send(form) {
    const from = clean(form.querySelector('[data-name]').value, 80);
    const note = String(form.querySelector('[data-note]').value || '').trim().slice(0, 1000);
    form.querySelectorAll('button, input, textarea, select').forEach(x => { x.disabled = true; });
    const bar = progressBar('Verschlüssele und lade hoch …');
    form.querySelector('[data-prog]').appendChild(bar.el);
    const total = picked.reduce((a, p) => a + p.file.size, 0) || 1;
    let doneBytes = 0, ok = 0;
    const failed = [];
    for (const p of [...picked]) {
      try {
        const uk = await uploadKey(meta.pub);
        const fmeta = { name: p.file.name, type: p.file.type || 'application/octet-stream', size: p.file.size, from, item: p.item === '__other' ? '' : p.item, note: ok === 0 && failed.length === 0 ? note : '', created: new Date().toISOString() };
        const up = await uploadEncrypted(p.file, {
          ck: uk.ck, meta: fmeta, extra: { e: uk.e },
          announce: body => requestApi.upload(token, body),
          onProgress: f => bar.set((doneBytes + f * p.file.size) / total * 0.99, t(`Lade „${p.file.name}“ hoch …`)),
        });
        await shareApi.finish(up.id, up.auth);
        sent.push({ id: up.id, auth: up.auth, name: p.file.name, size: p.file.size, item: fmeta.item, at: Date.now() });
        saveSent();
        picked.splice(picked.indexOf(p), 1);
        ok++;
      } catch (e) {
        failed.push(`${p.file.name}: ${shareErrorText(e)}`);
        if (e && ['closed', 'req_files', 'req_bytes', 'not_found'].includes(e.code)) break;
      }
      doneBytes += p.file.size;
    }
    bar.set(1, t('Fertig'));
    if (failed.length) toast(failed.join('\n'), 'error', { timeout: 9000 });
    if (ok) toast(t(ok === 1 ? 'Datei sicher hochgeladen.' : `${ok} Dateien sicher hochgeladen.`), 'success');
    try { info = await requestApi.open(token); } catch { /* keep the old state */ }
    show();
  }

  function drawSent() {
    if (!sent.length) return;
    const from = clean(meta.from, 80);
    const box = h(`<div class="card card-pad sh-rq-sent"><div class="sh-success-inline">${oicon('checkCircle')}<div><strong>${esc(t(sent.length === 1 ? 'Du hast 1 Datei hochgeladen' : `Du hast ${sent.length} Dateien hochgeladen`))}</strong>
      <p class="muted small">${esc(from ? t(`${from} kann sie jetzt öffnen. Du kannst diese Seite schließen.`) : t('Sie sind angekommen. Du kannst diese Seite schließen.'))}</p></div></div>
      <ul class="sh-rq-sentlist"></ul></div>`);
    const ul = box.querySelector('ul');
    sent.forEach(s => {
      const li = h(`<li><span data-no-i18n>${esc(s.name)}</span><span class="muted small">${formatSize(s.size)}${s.item ? ` · <span data-no-i18n>${esc(s.item)}</span>` : ''}</span>
        <button class="btn btn-ghost btn-sm" type="button">${oicon('undo')} Zurückziehen</button></li>`);
      li.querySelector('button').addEventListener('click', async () => {
        if (!(await confirmDialog('Datei zurückziehen?', t(`„${s.name}“ wird wieder gelöscht.`), { okLabel: 'Zurückziehen', danger: true }))) return;
        try { await requestApi.retract(s.id, s.auth); } catch (e) { toast(shareErrorText(e), 'error'); return; }
        sent.splice(sent.indexOf(s), 1); saveSent();
        toast('Datei zurückgezogen.', 'success');
        try { info = await requestApi.open(token); } catch {}
        show();
      });
      ul.appendChild(li);
    });
    main.appendChild(box);
    // mark items already covered in this session
    const got = new Set(sent.map(s => s.item).filter(Boolean));
    main.querySelectorAll('.sh-rq-head [data-item]').forEach(li => {
      if (got.has(li.dataset.item)) { li.classList.add('done'); li.querySelector('.ic')?.remove(); li.insertAdjacentHTML('afterbegin', oicon('checkCircle')); }
    });
  }

  await load();
  return () => off.destroy();
}

void copyToClipboard;
