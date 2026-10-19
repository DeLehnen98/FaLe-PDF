// Signer view for "#/u/<token>#k=<key>" – any browser, no install, no account.
// Decrypts the document locally, lets the signer fill their fields (signature drawn/typed via the
// app's signature dialog), builds the signed PDF + an audit page on the device, encrypts it with the
// same request key and uploads it. The server only learns "opened" / "signed" and the timestamps.
//
// Legal note shown to the signer and printed on the audit page: this is a simple electronic
// signature (einfache elektronische Signatur, Art. 3 Nr. 10 eIDAS) – no advanced/qualified signature.
import { h, esc, toast, formatSize } from '../ui.js';
import { PDF_HOST } from '../domains.js';
import { oicon } from '../office/kinds.js';
import { saveFile } from '../platform.js';
import { loadPdf } from '../pdfcore.js';
import { loadPdfLib, saveDoc } from '../pdflib.js';
import { keyFromFragment, openObject, sha256Hex, hasWebCrypto } from './crypto.js';
import { signApi, shareApi, downloadDecrypted, uploadEncrypted, online } from './api.js';
import { offlineBanner, progressBar, fmtDateTime, fmtUtc, shareErrorText, sicon } from './common.js';
import { mountPages } from './pages.js';
import { SIGNER_COLORS } from './signreq.js';
import { locale } from '../i18n/index.js'; // the date is written in the user's own format

const BASELINE = 0.946;
const todayDe = () => new Date().toLocaleDateString(locale(), { day: '2-digit', month: '2-digit', year: 'numeric' });

export async function mount(screen, { arg: token, hash }) {
  const wrap = h('<div class="screen-inner sh-signer-view"></div>');
  screen.body.appendChild(wrap);
  const off = offlineBanner();
  wrap.appendChild(off.el);
  const main = h('<div></div>');
  wrap.appendChild(main);
  const cleanups = [() => off.destroy()];
  const cleanup = () => cleanups.splice(0).forEach(fn => { try { fn(); } catch {} });

  const errorCard = (title, text, retry) => {
    main.innerHTML = '';
    const c = h(`<div class="card card-pad sh-recv-card sh-recv-error"><span class="sh-recv-ic warn">${oicon('info')}</span><h2>${esc(title)}</h2><p>${esc(text)}</p>
      <div class="sh-actions-row">${retry ? '<button class="btn btn-primary" type="button" data-retry>Erneut versuchen</button>' : ''}<a class="btn btn-ghost" href="#/start">Zu FaLe PDF</a></div></div>`);
    if (retry) c.querySelector('[data-retry]').addEventListener('click', retry);
    main.appendChild(c);
  };
  const L = keyFromFragment(hash);
  if (!hasWebCrypto()) { errorCard('Verschlüsselung nicht verfügbar', 'Dieser Browser unterstützt die nötige Verschlüsselung nicht (nur über HTTPS). Bitte öffne den Link in einem aktuellen Browser.'); return cleanup; }
  if (!/^[A-Za-z0-9_-]{24,64}$/.test(token || '') || !L) { errorCard('Link unvollständig', 'Der Link ist unvollständig. Bitte öffne den kompletten Link aus der Nachricht noch einmal.'); return cleanup; }

  async function start() {
    main.innerHTML = '<div class="v-loading"><div><span class="spinner dark" style="width:30px;height:30px"></span><span>Dokument wird geladen …</span></div></div>';
    if (!online()) { errorCard('Du bist offline', 'Zum Unterschreiben brauchst du eine Internetverbindung.', start); return; }
    let info;
    try { info = await signApi.open(token); }
    catch (e) {
      if (e.code === 'waiting') {
        const d = e.data || {};
        errorCard('Noch nicht an der Reihe', `Vor dir muss noch jemand unterschreiben (du bist Person ${(d.idx || 0) + 1} von ${d.count || '?'}). Öffne den Link später erneut.`, start);
      } else if (e.status === 404) errorCard('Anfrage nicht mehr verfügbar', 'Diese Unterschriftsanfrage ist abgelaufen oder wurde vom Absender gelöscht.');
      else errorCard('Das hat nicht geklappt', shareErrorText(e), start);
      return;
    }
    let docOpened;
    try { docOpened = await openObject(L, info.doc.header); }
    catch (e) { errorCard('Entschlüsselung fehlgeschlagen', shareErrorText(e)); return; }
    const meta = docOpened.meta || {};
    if (info.status === 'signed') { showDone(info, meta, null); return; }
    let src;
    try {
      const prog = progressBar('Lade und entschlüssele …');
      main.innerHTML = '';
      main.appendChild(prog.el);
      src = await downloadDecrypted(info.source, L, { onProgress: f => prog.set(f) });
    } catch (e) { errorCard('Das Dokument konnte nicht geladen werden', shareErrorText(e), start); return; }
    await showSigning(info, meta, new Uint8Array(await src.blob.arrayBuffer()), src.meta || {});
  }

  async function showSigning(info, meta, bytes, srcMeta) {
    const idx = info.idx;
    const me = (meta.signers || [])[idx] || { name: '' };
    const myFields = (meta.fields || []).filter(f => f.s === idx);
    const hashIn = await sha256Hex(bytes);
    main.innerHTML = '';
    const head = h(`<div class="card sh-sign-head">${sicon('signReq')}<div>
      <p class="sh-recv-kicker">${sicon('shareLock')} Unterschrift angefordert${info.count > 1 ? ` · Person ${idx + 1} von ${info.count}` : ''}</p>
      <h2 data-no-i18n>${esc(meta.name || 'Dokument')}</h2>
      <p>${meta.from ? `<strong data-no-i18n>${esc(meta.from)}</strong> bittet dich, dieses Dokument zu unterschreiben.` : 'Du wurdest gebeten, dieses Dokument zu unterschreiben.'} Für: <strong data-no-i18n>${esc(me.name)}</strong></p>
      ${meta.message ? `<blockquote class="sh-msg" data-no-i18n>${esc(meta.message)}</blockquote>` : ''}
      <p class="muted small">Gültig bis ${esc(fmtDateTime(info.expiresAt))} · ${formatSize(bytes.length)}</p></div></div>`);
    main.appendChild(head);
    const todo = h(`<div class="sh-todo card" aria-live="polite"></div>`);
    main.appendChild(todo);
    const stage = h('<div class="sh-sign-stage"></div>');
    main.appendChild(stage);
    const { pdf } = await loadPdf(bytes.slice(), { name: meta.name || 'Dokument' });
    cleanups.push(() => { try { pdf.destroy(); } catch {} });
    const values = new Map(); // field index → {kind:'image', sig} | {kind:'text', text}
    const els = [];
    const view = await mountPages(stage, pdf, { onLayout: () => els.forEach(placeEl) });
    cleanups.push(() => view.destroy());

    (meta.fields || []).forEach((f, fi) => {
      const page = view.pages[f.page - 1];
      if (!page) return;
      const mine = f.s === idx;
      let el;
      if (!mine) {
        const who = ((meta.signers || [])[f.s] || {}).name || `Person ${f.s + 1}`;
        el = h(`<div class="sh-ofield" style="--sc:${SIGNER_COLORS[f.s] || '#888'}" aria-hidden="true"><span>${f.s < idx ? '' : esc(who)}</span></div>`);
        if (f.s < idx) el.classList.add('done');
      } else if (f.type === 'sig') {
        el = h(`<button type="button" class="sh-ffield sh-ffield-sig" aria-label="Hier unterschreiben"><span class="sh-ffield-ph">${oicon('sign')} Unterschreiben</span></button>`);
        el.addEventListener('click', () => pickSignature(fi, el));
      } else {
        const init = f.type === 'date' ? todayDe() : f.type === 'name' ? me.name : '';
        el = h(`<input class="sh-ffield sh-ffield-text" type="text" maxlength="120" aria-label="${f.type === 'date' ? 'Datum' : f.type === 'name' ? 'Name' : 'Text'}" placeholder="${f.type === 'text' ? 'Text eingeben' : ''}">`);
        el.value = init;
        if (init) values.set(fi, { kind: 'text', text: init });
        el.addEventListener('input', () => { const v = el.value.trim(); if (v) values.set(fi, { kind: 'text', text: v }); else values.delete(fi); update(); });
      }
      el._f = f; el._fi = fi;
      page.layer.appendChild(el);
      els.push(el);
      placeEl(el);
    });

    function placeEl(el) {
      const f = el._f, s = view.scale;
      Object.assign(el.style, { left: `${f.x * s}px`, top: `${f.y * s}px`, width: `${f.w * s}px`, height: `${f.h * s}px` });
      if (el.classList.contains('sh-ffield-text')) el.style.fontSize = `${Math.max(9, Math.min(f.h * 0.62, 16)) * s}px`;
      else if (el.classList.contains('sh-ffield-sig')) el.style.fontSize = `${Math.max(8, Math.min(12, f.h * s * 0.34, (f.w * s) / 12))}px`;
    }

    async function pickSignature(fi, el) {
      const { pickAsset } = await import('../tools/sigstore.js');
      const sig = await pickAsset({ tab: 'signature', kinds: ['signature', 'initials'], title: 'Unterschreiben' });
      if (!sig) return;
      const prev = values.get(fi);
      if (prev && prev.sig && prev.sig.url) URL.revokeObjectURL(prev.sig.url);
      values.set(fi, { kind: 'image', sig });
      el.innerHTML = `<img src="${sig.url}" alt="Deine Unterschrift">`;
      el.classList.add('filled');
      update();
    }

    const confirmBox = h(`<div class="card card-pad sh-confirm">
      <label class="check sh-confirm-check"><input type="checkbox" data-agree><span><strong>Ich unterschreibe elektronisch.</strong> Ich habe das Dokument gelesen und bin einverstanden. Mir ist bewusst, dass dies eine einfache elektronische Signatur (eIDAS) ist – keine qualifizierte Signatur.</span></label>
      <button class="btn btn-primary btn-block" type="button" data-submit disabled>${oicon('sign')} Unterschreiben &amp; senden</button>
      <div data-prog></div>
      <p class="muted small">${sicon('shield')} Das unterschriebene PDF wird auf deinem Gerät erstellt, mit einer Protokollseite versehen und Ende-zu-Ende-verschlüsselt an den Absender zurückgegeben.</p></div>`);
    main.appendChild(confirmBox);
    const agree = confirmBox.querySelector('[data-agree]');
    const submit = confirmBox.querySelector('[data-submit]');
    agree.addEventListener('change', update);

    function update() {
      const missing = myFields.length - [...values.keys()].filter(fi => meta.fields[fi].s === idx).length;
      todo.innerHTML = myFields.length
        ? (missing > 0 ? `${oicon('info')}<span>Noch <strong>${missing}</strong> von ${myFields.length} Feldern auszufüllen. Tippe auf die markierten Felder im Dokument.</span>` : `${oicon('checkCircle')}<span>Alle Felder ausgefüllt. Bestätige unten und sende dein Dokument ab.</span>`)
        : `${oicon('info')}<span>Für dich sind keine Felder markiert.</span>`;
      todo.classList.toggle('ok', missing <= 0);
      submit.disabled = missing > 0 || !agree.checked;
    }
    update();
    const firstSig = els.find(e => e.classList.contains('sh-ffield-sig'));
    if (firstSig) setTimeout(() => firstSig.scrollIntoView({ block: 'center', behavior: 'smooth' }), 300);

    submit.addEventListener('click', async () => {
      submit.disabled = true; agree.disabled = true;
      const prog = progressBar('Erstelle das unterschriebene PDF …');
      confirmBox.querySelector('[data-prog]').appendChild(prog.el);
      try {
        const signedAt = new Date().toISOString();
        const { finalBytes, hashSigned } = await buildSigned({ bytes, meta, info, idx, values, view, me, hashIn, signedAt });
        const hashFinal = await sha256Hex(finalBytes);
        prog.set(0.15, 'Verschlüssele und sende …');
        const resMeta = { name: meta.name, type: 'application/pdf', size: finalBytes.length, signer: idx, signerName: me.name, signedAt, sha256Original: meta.sha256 || null, sha256Before: hashIn, sha256Signed: hashSigned, sha256Final: hashFinal };
        await uploadEncrypted(new Blob([finalBytes], { type: 'application/pdf' }), {
          ck: L, meta: resMeta,
          announce: async ({ size, chunks, header }) => { const r = await signApi.result(token, { size, chunks, header }); return { id: r.id, auth: token }; },
          onProgress: f => prog.set(0.15 + f * 0.8),
        });
        const fin = await signApi.finish(token);
        prog.set(1, 'Gesendet');
        showDone({ ...info, status: 'signed', signedAt: fin.signedAt }, meta, { bytes: finalBytes, hash: hashFinal });
      } catch (e) {
        prog.el.remove();
        submit.disabled = false; agree.disabled = false;
        toast(shareErrorText(e, 'Das Unterschreiben hat nicht geklappt. Bitte versuche es erneut.'), 'error', { timeout: 7000 });
      }
    });
    void srcMeta;
  }

  function showDone(info, meta, local) {
    cleanup();
    cleanups.push(() => off.destroy());
    main.innerHTML = '';
    const c = h(`<div class="card card-pad sh-recv-card">
      <span class="sh-recv-ic ok">${oicon('checkCircle')}</span>
      <h2>Unterschrieben – danke!</h2>
      <p>„<span data-no-i18n>${esc(meta.name || 'Dokument')}</span>“ wurde${info.signedAt ? ` am ${esc(fmtDateTime(info.signedAt))}` : ''} unterschrieben und verschlüsselt an den Absender zurückgegeben. Der Absender sieht den Status, sobald er FaLe PDF öffnet.</p>
      ${local ? `<p class="muted small sh-hash">SHA-256: <code data-no-i18n>${esc(local.hash)}</code></p>` : ''}
      <div class="sh-recv-acts"><button class="btn btn-soft" type="button" data-copy>${oicon('download')} Kopie herunterladen</button><a class="btn btn-ghost" href="#/start">FaLe PDF entdecken</a></div>
      <div data-prog></div></div>`);
    main.appendChild(c);
    c.querySelector('[data-copy]').addEventListener('click', async () => {
      const name = `${String(meta.name || 'Dokument').replace(/\.pdf$/i, '')} (unterschrieben).pdf`;
      if (local) { await saveFile(new Blob([local.bytes], { type: 'application/pdf' }), name, 'application/pdf'); return; }
      try {
        const r = await signApi.open(token);
        if (!r.result) throw new Error('none');
        const prog = progressBar('Lade und entschlüssele …');
        c.querySelector('[data-prog]').appendChild(prog.el);
        const res = await downloadDecrypted(r.result, L, { onProgress: f => prog.set(f) });
        prog.el.remove();
        await saveFile(res.blob, name, 'application/pdf');
      } catch (e) { toast(shareErrorText(e, 'Die Kopie ist nicht mehr verfügbar.'), 'error'); }
    });
  }

  await start();
  return cleanup;
}

/** Draw the signer's values into the PDF, then append the audit page. */
async function buildSigned({ bytes, meta, info, idx, values, view, me, hashIn, signedAt }) {
  const PDFLib = await loadPdfLib();
  const { StandardFonts, rgb, degrees } = PDFLib;
  const pdfDoc = await PDFLib.PDFDocument.load(bytes, { updateMetadata: false });
  const { makeSanitizer } = await import('../tools/common.js');
  const U = await import('../office/unifont.js');
  // names and values with letters beyond Western European (Łukasz, Şahin, Иван …): Liberation Sans subset
  const typed = [...values].map(([, v]) => (v && v.kind !== 'image' ? String(v.text || '') : '')).join('\n');
  let font = null;
  if (U.needsUnicode(typed)) { try { font = await U.uniFont(pdfDoc, { PDFLib }); } catch (e) { console.warn('unicode font', e); } }
  if (!font) font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const clean = makeSanitizer(font);
  const pages = pdfDoc.getPages();
  for (const [fi, v] of values) {
    const f = meta.fields[fi];
    if (!f || f.s !== idx) continue;
    const p = view.pages[f.page - 1];
    const target = pages[f.page - 1];
    if (!p || !target) continue;
    const rot = p.page.rotate || 0;
    if (v.kind === 'image') {
      const img = await pdfDoc.embedPng(new Uint8Array(await v.sig.blob.arrayBuffer()));
      const fit = Math.min(f.w / v.sig.w, f.h / v.sig.h) * 0.96;
      const iw = v.sig.w * fit, ih = v.sig.h * fit;
      const x = f.x + (f.w - iw) / 2, y = f.y + (f.h - ih) / 2;
      const [px, py] = p.base.convertToPdfPoint(x, y + ih);
      target.drawImage(img, { x: px, y: py, width: iw, height: ih, rotate: degrees(rot) });
    } else {
      // Chinese, Hindi, Arabic … (no embedded font has them): drawn as a picture instead of "?"
      const pic = U.needsTextImage(v.text);
      const txt = pic ? String(v.text).replace(/\n/g, ' ') : clean(v.text).replace(/\n/g, ' ');
      const wOf = sz => (pic ? U.measureTextImage(txt, sz) : font.widthOfTextAtSize(txt, sz));
      let size = Math.max(6, Math.min(f.h * 0.62, 14));
      while (size > 6 && wOf(size) > f.w - 4) size -= 0.5;
      const top = f.y + (f.h - size * 1.2) / 2;
      const [px, py] = p.base.convertToPdfPoint(f.x + 2, top + size * BASELINE);
      if (pic && await U.drawTextImage(target, pdfDoc, txt, { x: px, y: py, size, color: rgb(0.07, 0.07, 0.12), rotate: degrees(rot) })) continue;
      target.drawText(txt, { x: px, y: py, size, font, color: rgb(0.07, 0.07, 0.12), rotate: degrees(rot) });
    }
  }
  const signedBytes = await saveDoc(pdfDoc);
  const hashSigned = await sha256Hex(signedBytes);

  // ---- audit page (stays German/English bilingual: it is document content)
  const doc2 = await PDFLib.PDFDocument.load(signedBytes, { updateMetadata: false });
  let helv = await doc2.embedFont(StandardFonts.Helvetica);
  let bold = await doc2.embedFont(StandardFonts.HelveticaBold);
  if (U.needsUnicode([me.name, meta.name, meta.from].join('\n'))) {
    try { [helv, bold] = await Promise.all([U.uniFont(doc2, { PDFLib }), U.uniFont(doc2, { PDFLib, bold: true })]); } catch (e) { console.warn('unicode font', e); }
  }
  const mono = await doc2.embedFont(StandardFonts.Courier);
  const c2 = makeSanitizer(helv);
  const page = doc2.addPage([595.28, 841.89]);
  const ink = rgb(0.08, 0.09, 0.18), muted = rgb(0.35, 0.37, 0.48), accent = rgb(0.23, 0.22, 0.63);
  let y = 790;
  const line = (label, value, { font = helv, size = 10, monoVal = false } = {}) => {
    page.drawText(c2(label), { x: 56, y, size: 9, font: helv, color: muted });
    y -= 13;
    const val = monoVal ? String(value) : c2(String(value));
    const f = monoVal ? mono : font;
    const words = val.split(' ');
    let cur = '';
    const max = 483;
    for (const w of words) {
      const t = cur ? cur + ' ' + w : w;
      if (f.widthOfTextAtSize(t, size) > max && cur) { page.drawText(cur, { x: 56, y, size, font: f, color: ink }); y -= size + 4; cur = w; } else cur = t;
    }
    if (cur) { page.drawText(cur, { x: 56, y, size, font: f, color: ink }); y -= size + 4; }
    y -= 8;
  };
  page.drawRectangle({ x: 0, y: 812, width: 595.28, height: 30, color: accent });
  page.drawText('FaLe PDF', { x: 56, y: 822, size: 11, font: bold, color: rgb(1, 1, 1) });
  page.drawText(c2('Unterschriftsprotokoll / Signature audit trail'), { x: 56, y: y - 4, size: 17, font: bold, color: ink });
  y -= 34;
  const total = info.count || 1;
  line('Dokument / Document', meta.name || 'Dokument');
  line('Unterzeichner/in laut Anfrage / Signer (as named in the request)', `${me.name || '–'}${total > 1 ? `  (Person ${idx + 1} von ${total})` : ''}`);
  if (meta.from) line('Angefordert von / Requested by', meta.from);
  line('Anfrage erstellt (UTC, Server) / Request created', fmtUtc(info.createdAt));
  line('Dokument geöffnet (UTC, Server) / Document opened', fmtUtc(info.viewedAt));
  line('Unterschrieben (UTC, Gerät der unterzeichnenden Person) / Signed (UTC, signer device)', fmtUtc(signedAt));
  line('SHA-256 Original (wie vom Absender gesendet) / original as sent', meta.sha256 || '–', { monoVal: true, size: 8.5 });
  if (hashIn !== meta.sha256) line('SHA-256 vor dieser Unterschrift / before this signature', hashIn, { monoVal: true, size: 8.5 });
  line(`SHA-256 nach der Unterschrift (Seiten 1-${pages.length}, ohne diese Protokollseite) / after signing, without this page`, hashSigned, { monoVal: true, size: 8.5 });
  line('Bestätigung / Confirmation', '„Ich unterschreibe elektronisch“ wurde aktiv bestätigt. / "I sign electronically" was actively confirmed.');
  line('Art der Signatur / Signature type', 'Einfache elektronische Signatur (EES) im Sinne von Art. 3 Nr. 10 der eIDAS-Verordnung (EU) Nr. 910/2014. Keine fortgeschrittene oder qualifizierte elektronische Signatur; die Identität der unterzeichnenden Person wurde nicht geprüft. / Simple electronic signature under eIDAS; not an advanced or qualified signature, identity not verified.');
  line('Übertragung / Transmission', 'Ende-zu-Ende-verschlüsselt (AES-256-GCM) über FaLe PDF; der Server kennt weder Inhalt noch Namen. / End-to-end encrypted; the server cannot read content or names.');
  page.drawText(c2(`Erstellt mit FaLe PDF – ${PDF_HOST}`), { x: 56, y: 40, size: 8, font: helv, color: muted });
  const finalBytes = await saveDoc(doc2);
  return { finalBytes, hashSigned };
}
void shareApi;
