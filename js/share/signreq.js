// "Unterschrift anfordern" (sender side): place fields per signer, encrypt + upload the PDF, create
// the request and hand out one link per signer. Status screen: per-signer state, signed PDF → library.
//
// The document, its name, the message, signer names and field positions are encrypted with the
// request key (only in the links). The server stores ciphertext, the number of signers and
// timestamps (created / opened / signed). Signers sign one after another (sequential) – each next
// signer receives the version signed by the previous one.
import * as db from '../db.js';
import { h, esc, toast, confirmDialog, formatSize } from '../ui.js';
import { t } from '../i18n/index.js';
import { oicon } from '../office/kinds.js';
import { renderChooser } from '../screen.js';
import { getDocBytes } from '../library.js';
import { loadPdf } from '../pdfcore.js';
import { scheduleNotification } from '../platform.js';
import { b64u, newLinkKey, sha256Hex, hasWebCrypto } from './crypto.js';
import { shareApi, signApi, shareConfig, uploadEncrypted, downloadDecrypted, linkBase, online } from './api.js';
import { putEntry, getEntry, patchEntry, removeEntry, isExpired } from './registry.js';
import { offlineBanner, progressBar, linkBox, statusPill, fmtDateTime, expiryLabel, shareErrorText, sicon, copyToClipboard, shareText } from './common.js';
import { mountPages, makeDraggable } from './pages.js';

export const FIELD_TYPES = [
  { id: 'sig', label: 'Unterschrift', icon: 'sign', w: 170, h: 48 },
  { id: 'date', label: 'Datum', icon: 'calendar', w: 90, h: 22 },
  { id: 'name', label: 'Name', icon: 'contact', w: 150, h: 22 },
  { id: 'text', label: 'Text', icon: 'text', w: 150, h: 22 },
];
export const SIGNER_COLORS = ['#3B37A0', '#0B8F80', '#C2410C', '#9D174D', '#1D4ED8'];
const EXPIRY = [{ v: 604800, label: '7 Tage' }, { v: 1209600, label: '14 Tage' }, { v: 2592000, label: '30 Tage' }];

export async function mount(screen, { params }) {
  const docId = params.get('doc');
  if (!docId) {
    await renderChooser(screen, { text: 'Wähle die PDF, die unterschrieben werden soll.', onPick: d => location.replace(`#/teilen/unterschrift?doc=${d.id}`) });
    return null;
  }
  const doc = await db.getDoc(docId);
  if (!doc) { screen.body.innerHTML = '<p class="panel-empty">Dokument nicht gefunden.</p>'; return null; }
  if (doc.kind && doc.kind !== 'pdf') { screen.body.innerHTML = '<div class="screen-inner"><p class="panel-empty">Unterschriften kannst du nur für PDF-Dateien anfordern. Wandle das Dokument zuerst in eine PDF um.</p></div>'; return null; }
  screen.setTitle('Unterschrift anfordern', doc.name);
  if (doc.encrypted) {
    screen.body.innerHTML = '<div class="screen-inner"><div class="card card-pad"><strong>Diese PDF hat ein Passwort.</strong><p class="muted">Entferne zuerst das Passwort (⋮ → „Passwort entfernen“). Der Link wird ohnehin Ende-zu-Ende-verschlüsselt.</p></div></div>';
    return null;
  }
  if (!hasWebCrypto()) { screen.body.innerHTML = '<div class="screen-inner"><p class="panel-empty">Dieser Browser kann nicht verschlüsseln (nur über HTTPS).</p></div>'; return null; }
  const bytes = await getDocBytes(docId);
  const { pdf } = await loadPdf(bytes.slice(), { name: doc.name, key: docId });

  const signers = [{ name: '' }];
  const fields = []; // {s, type, page, x, y, w, h}
  let active = 0, mode = null;
  const state = { expiresIn: 1209600 };

  screen.body.classList.add('sh-sr-body');
  const layout = h(`<div class="sh-sr">
    <aside class="sh-sr-side">
      <div data-off></div>
      <section class="sh-sr-sec"><h2>1 · Wer unterschreibt?</h2><div data-signers></div>
        <button class="btn btn-ghost btn-sm" type="button" data-addsigner>${oicon('plus')} Weitere Person</button>
        <p class="hint" data-order hidden>Die Personen unterschreiben nacheinander in dieser Reihenfolge.</p></section>
      <section class="sh-sr-sec"><h2>2 · Felder setzen</h2>
        <p class="hint">Wähle ein Feld und tippe auf die Stelle im Dokument. Felder lassen sich verschieben.</p>
        <div class="sh-sr-tools" role="toolbar" aria-label="Feld einfügen">${FIELD_TYPES.map(f => `<button class="btn btn-ghost btn-sm" type="button" data-ftype="${f.id}" aria-pressed="false">${oicon(f.icon)} ${f.label}</button>`).join('')}</div>
        <p class="sh-sr-hint" data-hint aria-live="polite"></p></section>
      <section class="sh-sr-sec"><h2>3 · Nachricht &amp; Gültigkeit</h2>
        <label class="field"><span class="field-label">Dein Name (optional)</span><input class="input" data-from maxlength="80" placeholder="z. B. Max Mustermann" autocomplete="name"></label>
        <label class="field"><span class="field-label">Nachricht (optional)</span><textarea class="input" data-msg rows="3" maxlength="600" placeholder="z. B. Bitte bis Freitag unterschreiben – danke!"></textarea></label>
        <div class="sh-opt"><span class="field-label" id="sr-exp-l">Link gültig für</span>
          <div class="seg" role="group" aria-labelledby="sr-exp-l">${EXPIRY.map(e => `<button type="button" data-exp="${e.v}" aria-pressed="${e.v === state.expiresIn}">${e.label}</button>`).join('')}</div></div>
      </section>
      <div class="sh-sr-go"><button class="btn btn-primary btn-block" type="button" data-create>${sicon('send')} Anfrage erstellen</button>
        <p class="muted small">${sicon('shield')} Dokument, Namen und Nachricht werden Ende-zu-Ende-verschlüsselt. Es entsteht eine einfache elektronische Signatur mit Protokollseite.</p></div>
      <div data-prog></div>
    </aside>
    <div class="sh-sr-stage" data-stage></div>
  </div>`);
  screen.body.appendChild(layout);
  const off = offlineBanner(on => { layout.querySelector('[data-create]').disabled = !on; });
  layout.querySelector('[data-off]').appendChild(off.el);
  const stage = layout.querySelector('[data-stage]');
  const view = await mountPages(stage, pdf, { onLayout: () => fields.forEach(place) });
  const hint = layout.querySelector('[data-hint]');

  function renderSigners() {
    const box = layout.querySelector('[data-signers]');
    box.innerHTML = '';
    signers.forEach((s, i) => {
      const row = h(`<div class="sh-signer ${i === active ? 'active' : ''}" style="--sc:${SIGNER_COLORS[i]}">
        <button type="button" class="sh-signer-pick" aria-pressed="${i === active}" aria-label="Felder für Person ${i + 1} setzen"><span class="sh-dot"></span>${i + 1}</button>
        <input class="input" data-sname="${i}" maxlength="80" placeholder="Name der Person" value="${esc(s.name)}" aria-label="Name von Person ${i + 1}">
        ${signers.length > 1 ? `<button type="button" class="icon-btn" data-rm="${i}" aria-label="Person entfernen">${oicon('close')}</button>` : ''}</div>`);
      row.querySelector('.sh-signer-pick').addEventListener('click', () => { active = i; renderSigners(); });
      row.querySelector('input').addEventListener('input', e => { s.name = e.target.value; fields.filter(f => f.s === i).forEach(place); });
      row.querySelector('input').addEventListener('focus', () => { // no re-render here: it would steal the focus
        if (active === i) return;
        active = i;
        box.querySelectorAll('.sh-signer').forEach((r2, k) => { r2.classList.toggle('active', k === i); r2.querySelector('.sh-signer-pick').setAttribute('aria-pressed', String(k === i)); });
      });
      const rm = row.querySelector('[data-rm]');
      if (rm) rm.addEventListener('click', () => {
        signers.splice(i, 1);
        for (let k = fields.length - 1; k >= 0; k--) { if (fields[k].s === i) { fields[k].el.remove(); fields.splice(k, 1); } else if (fields[k].s > i) fields[k].s--; }
        active = Math.min(active, signers.length - 1);
        renderSigners(); fields.forEach(place);
      });
      box.appendChild(row);
    });
    layout.querySelector('[data-addsigner]').hidden = signers.length >= 5;
    layout.querySelector('[data-order]').hidden = signers.length < 2;
  }
  layout.querySelector('[data-addsigner]').addEventListener('click', () => { signers.push({ name: '' }); active = signers.length - 1; renderSigners(); setTimeout(() => layout.querySelector(`[data-sname="${active}"]`).focus(), 30); });
  renderSigners();

  function setMode(m) {
    mode = m;
    layout.querySelectorAll('[data-ftype]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.ftype === m)));
    view.pages.forEach(p => p.el.classList.toggle('placing', !!m));
    hint.textContent = m ? `Tippe auf die Stelle für das Feld „${FIELD_TYPES.find(f => f.id === m).label}“ (Person ${active + 1}).` : '';
  }
  layout.querySelectorAll('[data-ftype]').forEach(b => b.addEventListener('click', () => setMode(mode === b.dataset.ftype ? null : b.dataset.ftype)));
  layout.querySelectorAll('[data-exp]').forEach(b => b.addEventListener('click', () => { state.expiresIn = +b.dataset.exp; layout.querySelectorAll('[data-exp]').forEach(x => x.setAttribute('aria-pressed', String(x === b))); }));

  stage.addEventListener('click', e => {
    const pageEl = e.target.closest('.sh-page');
    if (!pageEl || !mode || e.target.closest('.sh-field')) return;
    const p = view.pages[+pageEl.dataset.page - 1];
    const r = pageEl.getBoundingClientRect();
    const t = FIELD_TYPES.find(f => f.id === mode);
    const x = (e.clientX - r.left) / view.scale, y = (e.clientY - r.top) / view.scale;
    const f = { s: active, type: mode, page: p.num, w: t.w, h: t.h, x: Math.max(0, Math.min(p.base.width - t.w, x - t.w / 2)), y: Math.max(0, Math.min(p.base.height - t.h, y - t.h / 2)) };
    addField(f);
    setMode(null);
  });

  function addField(f) {
    const el = h(`<div class="sh-field" role="group"><span class="sh-field-label"></span>
      <button type="button" class="sh-field-del" data-nodrag aria-label="Feld entfernen">${oicon('close')}</button><span class="sh-field-resize" data-resize aria-hidden="true"></span></div>`);
    f.el = el;
    el.querySelector('.sh-field-del').addEventListener('click', ev => { ev.stopPropagation(); fields.splice(fields.indexOf(f), 1); el.remove(); });
    makeDraggable(el, f, { getScale: () => view.scale, bounds: () => view.pages[f.page - 1].base, onChange: () => place(f) });
    view.pages[f.page - 1].layer.appendChild(el);
    fields.push(f);
    place(f);
  }
  function place(f) {
    const s = view.scale, el = f.el;
    Object.assign(el.style, { left: `${f.x * s}px`, top: `${f.y * s}px`, width: `${f.w * s}px`, height: `${f.h * s}px`, '--sc': SIGNER_COLORS[f.s] || SIGNER_COLORS[0] });
    el.style.setProperty('--sc', SIGNER_COLORS[f.s] || SIGNER_COLORS[0]);
    const who = signers[f.s] && signers[f.s].name.trim() ? signers[f.s].name.trim() : `Person ${f.s + 1}`;
    el.querySelector('.sh-field-label').textContent = `${FIELD_TYPES.find(t => t.id === f.type).label} · ${who}`;
    el.setAttribute('aria-label', `${FIELD_TYPES.find(t => t.id === f.type).label} für ${who}`);
  }

  layout.querySelector('[data-create]').addEventListener('click', create);

  async function create() {
    const names = signers.map(s => s.name.trim());
    const missing = names.findIndex(n => !n);
    if (missing >= 0) { toast(`Bitte gib den Namen von Person ${missing + 1} ein.`, 'error'); layout.querySelector(`[data-sname="${missing}"]`).focus(); return; }
    const noSig = signers.findIndex((_, i) => !fields.some(f => f.s === i && f.type === 'sig'));
    if (noSig >= 0) { toast(`Bitte setze mindestens ein Unterschriftsfeld für ${names[noSig]}.`, 'error', { timeout: 5000 }); active = noSig; renderSigners(); setMode('sig'); return; }
    if (!online()) { toast('Du bist offline. Teilen, Unterschriften anfordern und Übertragen brauchen eine Internetverbindung.', 'error'); return; }
    let cfg;
    try { cfg = await shareConfig(); } catch (e) { toast(shareErrorText(e), 'error', { timeout: 6000 }); return; }
    if (!cfg.configured) { toast('Teilen ist noch nicht eingerichtet – bitte versuche es später erneut.', 'info', { timeout: 6000 }); return; }
    if (bytes.length > cfg.maxBytes) { toast(`Die Datei ist zu groß (max. ${Math.round(cfg.maxBytes / 1048576)} MB).`, 'error'); return; }
    const btn = layout.querySelector('[data-create]');
    btn.disabled = true;
    const prog = progressBar('Verschlüssele und lade hoch …');
    layout.querySelector('[data-prog]').appendChild(prog.el);
    try {
      const L = newLinkKey();
      const sha = await sha256Hex(bytes);
      const meta = {
        name: doc.name, type: 'application/pdf', size: bytes.length, sha256: sha, created: new Date().toISOString(),
        from: layout.querySelector('[data-from]').value.trim(), message: layout.querySelector('[data-msg]').value.trim(),
        signers: names.map(n => ({ name: n })),
        fields: fields.map(f => ({ s: f.s, type: f.type, page: f.page, x: round(f.x), y: round(f.y), w: round(f.w), h: round(f.h) })),
      };
      const up = await uploadEncrypted(new Blob([bytes], { type: 'application/pdf' }), {
        ck: L, meta,
        announce: ({ size, chunks, header }) => shareApi.create({ kind: 'sign-doc', size, chunks, header, expiresIn: state.expiresIn }),
        onProgress: f => prog.set(f * 0.95),
      });
      await shareApi.finish(up.id, up.auth);
      const req = await signApi.create(up.id, up.auth, names.length);
      prog.set(1, 'Fertig');
      const key = b64u.enc(L);
      const entry = putEntry({
        id: req.id, kind: 'sign', name: doc.name, docLocalId: docId, createdAt: Date.now(), expiresAt: req.expiresAt, auth: up.auth, key,
        signers: names.map((n, i) => ({ name: n, url: `${linkBase()}#/u/${req.signers[i]}#k=${key}` })), lastStatus: names.map(() => 'open'),
        from: meta.from, message: meta.message,
      });
      cleanupAll();
      showCreated(screen, entry);
    } catch (e) {
      prog.el.remove();
      btn.disabled = false;
      toast(shareErrorText(e, 'Die Anfrage konnte nicht erstellt werden.'), 'error', { timeout: 6000 });
    }
  }

  let cleaned = false;
  function cleanupAll() { if (cleaned) return; cleaned = true; view.destroy(); off.destroy(); try { pdf.destroy(); } catch {} screen.body.classList.remove('sh-sr-body'); }
  return cleanupAll;
}

const round = v => Math.round(v * 100) / 100;

function inviteText(entry, i) {
  const s = entry.signers[i];
  const ask = entry.from ? t(`${entry.from} bittet dich, „${entry.name}“ zu unterschreiben.`) : t(`Bitte unterschreibe „${entry.name}“.`);
  return `${ask}${entry.message ? `\n${entry.message}` : ''}\n${t(`Link für ${s.name} (Ende-zu-Ende-verschlüsselt, ohne Konto):`)}`;
}

function showCreated(screen, entry) {
  screen.body.innerHTML = '';
  const wrap = h(`<div class="screen-inner sh-created">
    <div class="card sh-success">${oicon('checkCircle')}<div><strong>Anfrage erstellt</strong>
      <p>Sende jeder Person ihren Link – z. B. per WhatsApp oder E-Mail. Gültig bis ${esc(fmtDateTime(entry.expiresAt))}.</p></div></div>
    <div data-links></div>
    <div class="sh-actions sh-actions-row">
      <a class="btn btn-primary" href="#/teilen/anfrage/${esc(entry.id)}">${oicon('eye')} Status ansehen</a>
      <button class="btn btn-ghost" type="button" data-remind>${oicon('bell')} Erinnerung in 2 Tagen</button>
    </div></div>`);
  const box = wrap.querySelector('[data-links]');
  entry.signers.forEach((s, i) => {
    const sec = h(`<section class="sh-signer-link"><h3>${entry.signers.length > 1 ? `${i + 1}. ` : ''}<span data-no-i18n>${esc(s.name)}</span></h3></section>`);
    sec.appendChild(linkBox(s.url, { label: 'Link zum Unterschreiben', shareTitle: `Unterschrift: ${entry.name}`, shareText: inviteText(entry, i), qr: true }));
    box.appendChild(sec);
  });
  if (entry.signers.length > 1) box.appendChild(h('<p class="hint">Tipp: Person 2 kann erst unterschreiben, wenn Person 1 fertig ist – du kannst trotzdem schon alle Links verschicken.</p>'));
  wrap.querySelector('[data-remind]').addEventListener('click', () => remind(entry));
  screen.body.appendChild(wrap);
}

async function remind(entry) {
  try {
    const ok = await scheduleNotification({ id: `sign-${entry.id}`, at: Date.now() + 2 * 864e5, title: t('Unterschrift noch offen?'), body: `Prüfe den Status von „${entry.name}“.`, route: `#/teilen/anfrage/${entry.id}` });
    toast(ok ? 'Erinnerung in 2 Tagen geplant.' : 'Erinnerung gespeichert – sie erscheint, wenn du FaLe öffnest.', 'success', { timeout: 4500 });
  } catch (e) { toast('Die Erinnerung konnte nicht geplant werden.', 'error'); }
}

// ---------------------------------------------------------------- status screen (#/teilen/anfrage/<id>)
export async function mountStatus(screen, { arg: id }) {
  const entry = getEntry(id);
  const wrap = h('<div class="screen-inner sh-status"></div>');
  screen.body.appendChild(wrap);
  if (!entry || entry.kind !== 'sign') {
    wrap.appendChild(h(`<div class="empty"><div class="empty-art">${oicon('info')}</div><h3>Anfrage nicht gefunden</h3><p>Diese Anfrage ist auf diesem Gerät nicht gespeichert. Den Status siehst du nur auf dem Gerät, auf dem du sie erstellt hast.</p><a class="btn btn-ghost" href="#/teilen">Zur Übersicht</a></div>`));
    return null;
  }
  screen.setTitle('Unterschriftsanfrage', entry.name);
  const off = offlineBanner(on => { if (on) refresh(); });
  wrap.appendChild(off.el);
  const head = h(`<div class="card sh-status-head">${sicon('signReq')}<div><strong data-no-i18n>${esc(entry.name)}</strong>
    <span class="muted small" data-exp></span></div><button class="btn btn-ghost btn-sm" type="button" data-refresh>${oicon('undo')} Aktualisieren</button></div>`);
  wrap.appendChild(head);
  const list = h('<div class="sh-status-list"></div>');
  wrap.appendChild(list);
  const final = h('<div data-final></div>');
  wrap.appendChild(final);
  const acts = h(`<div class="sh-actions sh-actions-row">
    <button class="btn btn-ghost" type="button" data-remind>${oicon('bell')} Erinnerung in 2 Tagen</button>
    <button class="btn btn-danger-ghost" type="button" data-del>${oicon('trash')} Anfrage löschen</button></div>`);
  wrap.appendChild(acts);
  wrap.appendChild(h(`<p class="muted small sh-local-note">${oicon('info')}<span>Der Server kennt nur den Status (offen, angesehen, unterschrieben) und die Zeitpunkte – nicht das Dokument, die Namen oder deine Nachricht.</span></p>`));
  head.querySelector('[data-refresh]').addEventListener('click', () => refresh());
  acts.querySelector('[data-remind]').addEventListener('click', () => remind(entry));
  acts.querySelector('[data-del]').addEventListener('click', async () => {
    if (!(await confirmDialog('Anfrage löschen?', 'Das verschlüsselte Dokument und alle unterschriebenen Versionen werden sofort vom Server gelöscht. Die Links funktionieren danach nicht mehr. Bereits gespeicherte PDFs in deinen Dateien bleiben erhalten.', { okLabel: 'Löschen', danger: true }))) return;
    try { await signApi.remove(entry.id, entry.auth); } catch (e) { if (e.status !== 404) { toast(shareErrorText(e), 'error'); return; } }
    removeEntry(entry.id);
    toast('Anfrage gelöscht.', 'success');
    location.hash = '#/teilen';
  });

  let last = null;
  function render(r) {
    const expired = isExpired(entry) || (r && !r.exists);
    head.querySelector('[data-exp]').textContent = expired ? 'Abgelaufen – die Daten wurden vom Server gelöscht.' : `Erstellt am ${fmtDateTime(r && r.createdAt || new Date(entry.createdAt).toISOString())} · ${expiryLabel(entry.expiresAt)}`;
    list.innerHTML = '';
    entry.signers.forEach((s, i) => {
      const st = r && r.exists ? r.signers[i] : null;
      const status = expired && !(st && st.status === 'signed') ? 'expired' : st ? st.status : (entry.lastStatus || [])[i] || 'open';
      const row = h(`<div class="card sh-row sh-srow" data-signer="${i}"><span class="sh-row-ic" style="--sc:${SIGNER_COLORS[i]}">${entry.signers.length > 1 ? i + 1 : oicon('person')}</span>
        <div class="sh-row-main"><strong data-no-i18n>${esc(s.name)}</strong><span class="muted small">${st && st.signedAt ? `Unterschrieben am ${esc(fmtDateTime(st.signedAt))}` : st && st.viewedAt ? `Geöffnet am ${esc(fmtDateTime(st.viewedAt))}` : 'Noch nicht geöffnet'}</span></div>
        ${statusPill(status)}
        <div class="sh-row-acts">${!expired && status !== 'signed' ? `<button class="icon-btn" type="button" data-copy aria-label="Link kopieren">${oicon('copy')}</button><button class="icon-btn" type="button" data-share aria-label="Link teilen">${oicon('share')}</button>` : ''}</div></div>`);
      const cp = row.querySelector('[data-copy]'); if (cp) cp.addEventListener('click', () => copyToClipboard(s.url));
      const sh = row.querySelector('[data-share]'); if (sh) sh.addEventListener('click', () => shareText({ title: `Unterschrift: ${entry.name}`, text: inviteText(entry, i), url: s.url }));
      list.appendChild(row);
    });
    final.innerHTML = '';
    if (r && r.exists) {
      const done = r.signers.filter(s => s.result);
      const latest = done.length ? done[done.length - 1] : null;
      const all = r.signers.every(s => s.status === 'signed');
      if (latest) {
        const c = h(`<div class="card sh-final ${all ? 'complete' : ''}">${oicon(all ? 'checkCircle' : 'sign')}<div><strong>${all ? 'Alle haben unterschrieben' : `${done.length} von ${r.signers.length} unterschrieben`}</strong>
          <span class="muted small">Das unterschriebene PDF enthält eine Protokollseite (einfache elektronische Signatur).</span></div>
          <button class="btn btn-primary" type="button" data-save>${oicon('download')} ${all ? 'In Dateien speichern' : 'Zwischenstand speichern'}</button><div data-prog></div></div>`);
        c.querySelector('[data-save]').addEventListener('click', () => saveSigned(entry, latest.result, c, all));
        final.appendChild(c);
      }
    }
  }

  async function refresh() {
    if (!online() || isExpired(entry)) { render(null); return; }
    try {
      const r = await signApi.status(entry.id, entry.auth);
      last = r;
      if (r.exists) patchEntry(entry.id, { lastStatus: r.signers.map(s => s.status), lastCheck: Date.now() });
      else patchEntry(entry.id, { lastStatus: entry.signers.map(() => 'expired'), expiresAt: new Date().toISOString() });
      Object.assign(entry, getEntry(entry.id) || {});
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

async function saveSigned(entry, result, card, all) {
  const btn = card.querySelector('[data-save]');
  btn.disabled = true;
  const prog = progressBar('Lade und entschlüssele …');
  card.querySelector('[data-prog]').appendChild(prog.el);
  try {
    const { blob, meta } = await downloadDecrypted(result, b64u.dec(entry.key), { onProgress: f => prog.set(f) });
    const bytes = new Uint8Array(await blob.arrayBuffer());
    if (meta && meta.sha256Final) {
      const got = await sha256Hex(bytes);
      if (got !== meta.sha256Final) throw Object.assign(new Error('hash'), { userMessage: 'Die Prüfsumme stimmt nicht – die Datei wurde nicht gespeichert.' });
    }
    const { importPdf } = await import('../library.js');
    const base = entry.name.replace(/\.pdf$/i, '');
    const d = await importPdf(bytes, { name: `${base} (${all ? 'unterschrieben' : 'teilweise unterschrieben'}).pdf`, source: 'Empfangen', silent: true });
    prog.set(1, 'Gespeichert');
    toast('Unterschriebenes PDF in deinen Dateien gespeichert.', 'success', { action: { label: 'Öffnen', onClick: () => { location.hash = `#/ansicht/${d.id}`; } } });
    patchEntry(entry.id, { savedDocId: d.id });
  } catch (e) {
    prog.el.remove();
    toast(shareErrorText(e, 'Das unterschriebene PDF konnte nicht geladen werden.'), 'error', { timeout: 6000 });
  } finally { btn.disabled = false; }
}
void formatSize;
