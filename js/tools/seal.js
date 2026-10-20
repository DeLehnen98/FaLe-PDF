// „Echtheits-Siegel“ (PDF+ Etappe 4): whoever opens a sealed PDF in FaLe sees at once whether it was changed after
// sealing – „Unverändert seit 20.10.2026“ or „Wurde nach dem Versiegeln geändert (Seite 2)“. No certificate to buy:
//  - a fingerprint (SHA-256) of every page: content, images and form XObjects, annotations with their appearance
//  - signed with a key that this device creates once (ECDSA P-256, private part never leaves the device);
//    the „Kennung“ (short form of the public key) shows that two sealed files come from the same sender
//  - stored in the catalog (/FaLeSeal, ignored by other programs); the file is saved without object streams so a
//    quick byte search finds the seal before anything is parsed.
// It is not a qualified electronic signature – the tool says so.
import * as db from '../db.js';
import { icon } from '../icons.js';
import { $, h, esc, toast, errorToast, progress } from '../ui.js';
import { resultCard } from '../components.js';
import { saveResult } from '../library.js';
import { loadEditable, loadPdfLib } from '../pdflib.js';
import { openToolDoc, updateFoot } from './common.js';
import { locale, t } from '../i18n/index.js';

const KEY = 'FaLeSeal';
const MARK = [47, 70, 97, 76, 101, 83, 101, 97, 108]; // "/FaLeSeal"
const DEVICE_KEY = 'seal-key';
const enc = new TextEncoder();
const hex = buf => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
const b64u = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64u = s => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)), c => c.charCodeAt(0));

/** Does the file carry a seal? (byte search, no parsing) */
export function hasSeal(bytes) {
  const n = bytes.length - MARK.length;
  outer: for (let i = 0; i <= n; i++) {
    if (bytes[i] !== 47) continue;
    for (let k = 1; k < MARK.length; k++) if (bytes[i + k] !== MARK[k]) continue outer;
    return true;
  }
  return false;
}

// ---------------------------------------------------------------- fingerprint
function rawOf(PDFLib, s) {
  const { PDFRawStream, PDFContentStream, decodePDFRawStream } = PDFLib;
  try {
    if (s instanceof PDFRawStream) return decodePDFRawStream(s).decode();
    if (PDFContentStream && s instanceof PDFContentStream) return s.getUnencodedContents();
    if (s && s.getContents) return s.getContents();
  } catch { /* undecodable filter (images): fall back to the stored bytes */ }
  try { return s.getContents ? s.getContents() : (s.contents || new Uint8Array(0)); } catch { return new Uint8Array(0); }
}

/** One page → SHA-256 over what it shows: contents, XObjects (recursively), annotations + appearances, size, rotation. */
async function pageFingerprint(PDFLib, page) {
  const { PDFName, PDFArray, PDFDict, PDFStream, PDFRef } = PDFLib;
  const parts = [];
  const push = x => parts.push(typeof x === 'string' ? enc.encode(x) : x);
  const node = page.node;
  push(`box ${page.getMediaBox ? JSON.stringify(page.getMediaBox()) : ''} rot ${page.getRotation().angle}\n`);
  const c = node.lookup(PDFName.of('Contents'));
  const list = c instanceof PDFArray ? Array.from({ length: c.size() }, (_, i) => c.lookup(i)) : c ? [c] : [];
  for (const s of list) { push(rawOf(PDFLib, s)); push('\n'); }
  const seen = new Set();
  const walkRes = (res, depth) => {
    if (!(res instanceof PDFDict) || depth > 8) return;
    const xo = res.lookup(PDFName.of('XObject'));
    if (!(xo instanceof PDFDict)) return;
    for (const [k, ref] of xo.entries()) {
      const tag = ref instanceof PDFRef ? ref.tag : null;
      if (tag && seen.has(tag)) { push(`xo ${k} same\n`); continue; }
      if (tag) seen.add(tag);
      const s = xo.lookup(k);
      if (!(s instanceof PDFStream)) continue;
      push(`xo ${k}\n`); push(rawOf(PDFLib, s));
      walkRes(s.dict.lookup(PDFName.of('Resources')), depth + 1);
    }
  };
  walkRes(node.Resources ? node.Resources() : node.lookup(PDFName.of('Resources')), 0);
  const annots = node.lookup(PDFName.of('Annots'));
  if (annots instanceof PDFArray) {
    for (let i = 0; i < annots.size(); i++) {
      const a = annots.lookup(i);
      if (!(a instanceof PDFDict)) continue;
      const str = k => { const v = a.lookup(PDFName.of(k)); return v == null ? '' : v.decodeText ? v.decodeText() : String(v); };
      push(`annot ${str('Subtype')} ${str('Rect')} ${str('Contents')} ${str('V')} ${str('AS')}\n`);
      const ap = a.lookup(PDFName.of('AP'));
      const n = ap instanceof PDFDict ? ap.lookup(PDFName.of('N')) : null;
      if (n instanceof PDFStream) push(rawOf(PDFLib, n));
      else if (n instanceof PDFDict) for (const [k] of n.entries()) { const s = n.lookup(k); if (s instanceof PDFStream) { push(`ap ${k}\n`); push(rawOf(PDFLib, s)); } }
    }
  }
  const total = parts.reduce((x, p) => x + p.length, 0);
  const all = new Uint8Array(total);
  let o = 0;
  for (const p of parts) { all.set(p, o); o += p.length; }
  return hex(await crypto.subtle.digest('SHA-256', all));
}

export async function fingerprints(PDFLib, pdfDoc) {
  const out = [];
  for (const p of pdfDoc.getPages()) out.push(await pageFingerprint(PDFLib, p));
  return out;
}

// ---------------------------------------------------------------- device key
const ALG = { name: 'ECDSA', namedCurve: 'P-256' };
const SIGN = { name: 'ECDSA', hash: 'SHA-256' };
const kennungOf = async pub => { const hx = hex(await crypto.subtle.digest('SHA-256', enc.encode(`${pub.x}.${pub.y}`))).toUpperCase(); return `${hx.slice(0, 4)}-${hx.slice(4, 8)}`; };

/** This device's seal key (created on first use): {privateKey, pub: {x, y}, kennung}. */
export async function deviceKey() {
  let k = await db.getDeviceSetting(DEVICE_KEY, null);
  if (!k || !k.privateKey || !k.pub) {
    const pair = await crypto.subtle.generateKey(ALG, false, ['sign', 'verify']);
    const jwk = await crypto.subtle.exportKey('jwk', pair.publicKey);
    k = { privateKey: pair.privateKey, pub: { x: jwk.x, y: jwk.y } };
    await db.putDeviceSetting(DEVICE_KEY, k);
  }
  return { ...k, kennung: await kennungOf(k.pub) };
}

const signedPart = s => JSON.stringify({ v: s.v, date: s.date, by: s.by, pages: s.pages, pub: s.pub });

// ---------------------------------------------------------------- seal + verify
/** Seal a PDF → new bytes. `by`: optional name shown to the recipient. */
export async function sealPdf(bytes, name, docKey, { by = '' } = {}) {
  const PDFLib = await loadPdfLib();
  const doc = await loadEditable(bytes, name, { key: docKey });
  doc.catalog.delete(PDFLib.PDFName.of(KEY)); // an older seal is replaced
  const key = await deviceKey();
  const seal = { v: 1, date: new Date().toISOString(), by: String(by || '').trim().slice(0, 80), pages: await fingerprints(PDFLib, doc), pub: key.pub };
  seal.sig = b64u(await crypto.subtle.sign(SIGN, key.privateKey, enc.encode(signedPart(seal))));
  const ctx = doc.context;
  const dataRef = ctx.register(ctx.flateStream(enc.encode(JSON.stringify({ app: 'FaLe PDF', ...seal })), {}));
  const dict = ctx.obj({ V: 1 });
  dict.set(PDFLib.PDFName.of('Data'), dataRef);
  dict.set(PDFLib.PDFName.of('About'), PDFLib.PDFString.of('FaLe PDF Echtheits-Siegel: zeigt in FaLe, ob die Datei nach dem Versiegeln verändert wurde'));
  doc.catalog.set(PDFLib.PDFName.of(KEY), dict);
  doc.setProducer('FaLe PDF');
  doc.setModificationDate(new Date());
  return { bytes: await doc.save({ useObjectStreams: false }), kennung: key.kennung, date: seal.date };
}

/**
 * Check a sealed PDF → null (no seal) or {ok, date, by, kennung, own, changed: [page numbers], reason}
 * reason: '' | 'changed' (pages differ) | 'pages' (pages added/removed) | 'signature' (the seal itself was altered) | 'format'.
 */
export async function verifySeal(bytes, name, docKey) {
  if (!hasSeal(bytes)) return null;
  const PDFLib = await loadPdfLib();
  const doc = await loadEditable(bytes, name, { key: docKey });
  const dict = doc.catalog.lookup(PDFLib.PDFName.of(KEY));
  if (!(dict instanceof PDFLib.PDFDict)) return null;
  let s = null;
  try { s = JSON.parse(new TextDecoder().decode(rawOf(PDFLib, dict.lookup(PDFLib.PDFName.of('Data'))))); } catch { s = null; }
  if (!s || s.v !== 1 || !Array.isArray(s.pages) || !s.pub || !s.sig) return { ok: false, reason: 'format', changed: [] };
  const kennung = await kennungOf(s.pub);
  let sigOk = false;
  try {
    const pub = await crypto.subtle.importKey('jwk', { kty: 'EC', crv: 'P-256', x: s.pub.x, y: s.pub.y, ext: true }, ALG, false, ['verify']);
    sigOk = await crypto.subtle.verify(SIGN, pub, unb64u(s.sig), enc.encode(signedPart(s)));
  } catch { sigOk = false; }
  let own = false;
  try { own = (await db.getDeviceSetting(DEVICE_KEY, null) || {}).pub?.x === s.pub.x; } catch { /* no key yet */ }
  const base = { date: s.date, by: s.by || '', kennung, own };
  if (!sigOk) return { ...base, ok: false, reason: 'signature', changed: [] };
  const now = await fingerprints(PDFLib, doc);
  if (now.length !== s.pages.length) return { ...base, ok: false, reason: 'pages', changed: [], pagesThen: s.pages.length, pagesNow: now.length };
  const changed = now.map((x, i) => (x === s.pages[i] ? 0 : i + 1)).filter(Boolean);
  return { ...base, ok: !changed.length, reason: changed.length ? 'changed' : '', changed };
}

const dateText = iso => { try { return new Date(iso).toLocaleDateString(locale(), { day: '2-digit', month: '2-digit', year: 'numeric' }); } catch { return ''; } };

/** Title + detail for the viewer banner / the tool (already in the UI language – mark the element data-no-i18n). */
export function sealText(r) {
  const date = dateText(r.date);
  if (r.ok) {
    const k = r.own ? t('Kennung {k} (deine)', { k: r.kennung }) : t('Kennung {k}', { k: r.kennung });
    return { good: true, title: t('Unverändert seit {date}', { date }), detail: r.by ? `${t('Versiegelt von {name}', { name: r.by })} · ${k}` : k };
  }
  if (r.reason === 'signature' || r.reason === 'format') return { good: false, title: t('Das Siegel wurde verändert'), detail: t('Dieser Datei kann man nicht trauen – frag beim Absender nach.') };
  if (r.reason === 'pages') return { good: false, title: t('Nach dem Versiegeln geändert'), detail: t('Beim Versiegeln {a} Seiten, jetzt {b}.', { a: r.pagesThen, b: r.pagesNow }) };
  return { good: false, title: t('Nach dem Versiegeln geändert'), detail: r.changed.length === 1 ? t('Seite {n} ist anders als beim Versiegeln am {date}.', { n: r.changed[0], date }) : t('Seiten {list} sind anders als beim Versiegeln am {date}.', { list: r.changed.join(', '), date }) };
}

// ---------------------------------------------------------------- tool
export async function mount(screen, { docId }) {
  const ctx = await openToolDoc(screen, docId, 'Echtheits-Siegel');
  if (!ctx) return;
  const { doc, bytes } = ctx;
  let state = null;
  try { state = await verifySeal(bytes, doc.name, docId); } catch (e) { console.warn('Siegel', e); }
  const key = await deviceKey();
  let profileName = '';
  try { const p = await (await import('../extras/profile.js')).getProfile(); profileName = p ? [p.vorname, p.nachname].filter(Boolean).join(' ') : ''; } catch {}

  const status = state ? sealText(state) : null;
  const wrap = h(`<div class="screen-inner pt-narrow">
    ${status ? `<div class="card seal-status ${status.good ? 'seal-good' : 'seal-bad'}" role="status" data-no-i18n><span class="seal-ic">${icon(status.good ? 'shield' : 'info')}</span>
      <div><strong>${esc(status.title)}</strong><p>${esc(status.detail)}</p></div></div>` : ''}
    <div class="card intro"><span class="tile-ic">${icon('shield')}</span><div><strong>${state ? 'Neu versiegeln' : 'PDF versiegeln'}</strong>
      <p>Wer die versiegelte PDF in FaLe öffnet, sieht sofort, ob sie danach verändert wurde – zum Beispiel bei Rechnungen, Verträgen oder Bescheinigungen. In anderen Programmen öffnet sie sich ganz normal.</p></div></div>
    <form class="card card-pad" data-form autocomplete="off">
      <label class="field"><span class="field-label">Versiegelt von (freiwillig)</span><input class="input" name="by" maxlength="80" value="${esc(profileName)}" placeholder="z. B. dein Name oder deine Firma"></label>
      <p class="hint">Deine Kennung: <b class="seal-kennung" data-no-i18n>${esc(key.kennung)}</b> – sie steht in jedem Siegel von diesem Gerät. Teile sie, damit Empfänger sie vergleichen können.</p>
    </form>
    <div class="notice">${icon('info')}<span>Das Siegel zeigt Änderungen an – es ist keine rechtsgültige elektronische Unterschrift. Dein Original bleibt unverändert, FaLe speichert eine neue Datei.</span></div>
    <div data-result></div></div>`);
  screen.body.appendChild(wrap);
  const btn = h(`<button class="btn btn-primary" type="button" data-run>${icon('shield')} Versiegeln</button>`);
  updateFoot(screen, [btn]);
  $('[data-form]', wrap).addEventListener('submit', e => { e.preventDefault(); btn.click(); });
  btn.addEventListener('click', async () => {
    btn.disabled = true;
    const prog = progress('Versiegele …');
    try {
      const r = await sealPdf(bytes, doc.name, docId, { by: $('[name=by]', wrap).value });
      const base = doc.name.replace(/\.pdf$/i, '').replace(/\s*\(versiegelt\)$/i, '');
      const res = await saveResult(r.bytes, `${base} (versiegelt).pdf`);
      const box = $('[data-result]', wrap);
      box.innerHTML = '';
      box.appendChild(resultCard(res, { from: docId, title: 'Versiegelt' }));
      box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      toast('Versiegelt – Änderungen fallen ab jetzt in FaLe sofort auf.', 'success', { timeout: 5000 });
    } catch (e) { errorToast(e, 'Versiegeln fehlgeschlagen.'); }
    finally { prog.done(); btn.disabled = false; }
  });
}
