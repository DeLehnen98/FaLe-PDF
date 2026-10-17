// Readable PDF of an e-invoice (model from lib/einvoice.js): sender/recipient, invoice details, line items
// with page breaks and repeated header, allowances/charges, totals exactly as in the XML, VAT breakdown,
// payment details with GiroCode (only for transfers in EUR with a valid IBAN), notes, the plausibility
// check and a footer that says the XML is the legally relevant original.
import { loadPdfLib, saveDoc } from './pdf.js';
import { encodeQR, qrPdfOps } from './shared/qr.js';
import { label, UNITS, PAYMENT_MEANS, DOC_TYPES, VAT_CATS, profileName, ibanValid, isDirectDebit } from './einvoice.js';

const mm = v => v * 72 / 25.4;

export function fmtDate(iso, lang) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
  if (!m) return '';
  return lang === 'de' ? `${m[3]}.${m[2]}.${m[1]}` : new Date(+m[1], +m[2] - 1, +m[3]).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}
export function fmtMoney(v, lang, cur) {
  if (v == null || !Number.isFinite(v)) return '';
  const loc = lang === 'de' ? 'de-DE' : 'en-GB';
  try { return new Intl.NumberFormat(loc, { style: 'currency', currency: cur || 'EUR', minimumFractionDigits: 2, maximumFractionDigits: 4 }).format(v); } catch { return `${new Intl.NumberFormat(loc, { minimumFractionDigits: 2, maximumFractionDigits: 4 }).format(v)} ${cur || ''}`.trim(); }
}
export const fmtNum = (v, lang) => (v == null ? '' : new Intl.NumberFormat(lang === 'de' ? 'de-DE' : 'en-GB', { maximumFractionDigits: 4 }).format(v));
export const formatIban = s => String(s || '').replace(/\s+/g, '').toUpperCase().replace(/(.{4})/g, '$1 ').trim();
export const unitLabel = (code, lang) => (code ? (UNITS[code] ? UNITS[code][lang === 'de' ? 0 : 1] : code) : '');
export const docTitle = (m, lang) => label(DOC_TYPES, m.typeCode || '380', lang) || (lang === 'de' ? 'Rechnung' : 'Invoice');

export function addressLines(p) {
  if (!p) return [];
  const cityLine = [p.zip, p.city].filter(Boolean).join(' ');
  return [p.name, p.tradingName && p.tradingName !== p.name ? p.tradingName : '', p.street, p.street2, p.extra, cityLine, p.region, p.country && p.country !== 'DE' ? p.country : ''].filter(x => String(x || '').trim());
}

export function girocodePayload({ name, iban, bic = '', amount, text = '' }) {
  const clip = (s, n) => String(s || '').replace(/[\r\n]+/g, ' ').trim().slice(0, n);
  const cents = Math.round((amount || 0) * 100);
  const amt = cents > 0 && cents <= 99999999999 ? `EUR${(cents / 100).toFixed(2)}` : '';
  return ['BCD', '002', '1', 'SCT', clip(bic, 11).toUpperCase(), clip(name, 70), String(iban || '').replace(/\s+/g, '').toUpperCase(), amt, '', '', clip(text, 140)].join('\n');
}

/** Can the amount be paid by transfer (GiroCode)? */
export function payable(m) {
  const p = m.payment || {};
  const amount = m.totals.payable != null ? m.totals.payable : m.totals.gross;
  return !isDirectDebit(p.meansCode) && m.currency === 'EUR' && ibanValid(p.iban) && amount > 0 && m.kind !== 'credit' ? amount : 0;
}
export const paymentReference = (m, lang) => (m.payment && m.payment.reference) || `${lang === 'de' ? 'Rechnung' : 'Invoice'} ${m.number || ''}`.trim();

export async function einvoicePdf(m, lang) {
  const de = lang === 'de';
  const PDFLib = await loadPdfLib();
  const { PDFDocument, rgb, PDFName, PDFArray } = PDFLib;
  const doc = await PDFDocument.create();
  const uf = await import('./unifont.js');
  let font, bold;
  if (uf.needsUnicode(JSON.stringify({ ...m, attachments: null }))) {
    try { font = await uf.uniFont(doc, { PDFLib }); bold = await uf.uniFont(doc, { bold: true, PDFLib }); } catch (err) { console.warn(err); }
  }
  if (!font) { font = await uf.stdFont(doc, { PDFLib }); bold = await uf.stdFont(doc, { bold: true, PDFLib }); }
  const missing = new Set();
  const clean = (s, f = font) => { const r = uf.cleanText(String(s ?? ''), f); r.missing.forEach(c => missing.add(c)); return r.text; };
  const cur = m.currency || 'EUR';
  const M = v => fmtMoney(v, lang, cur);
  const PW = 595.28, PH = 841.89, L = mm(20), R = PW - mm(18), TW = R - L, BOTTOM = mm(22);
  const ink = rgb(0.09, 0.09, 0.12), grey = rgb(0.38, 0.38, 0.44), line = rgb(0.78, 0.78, 0.84), soft = rgb(0.95, 0.95, 0.97), warnC = rgb(0.7, 0.33, 0.0), okC = rgb(0.05, 0.5, 0.32);
  const pages = [];
  let page, y;
  const txt = (s, x, yy, { size = 9.5, f = font, color = ink, align = 'left' } = {}) => {
    const t = clean(s, f);
    if (!t) return 0;
    const w = f.widthOfTextAtSize(t, size);
    page.drawText(t, { x: align === 'right' ? x - w : align === 'center' ? x - w / 2 : x, y: yy, size, font: f, color });
    return w;
  };
  const wrap = (s, width, size = 9.5, f = font) => {
    const out = [];
    for (const para of clean(s, f).split('\n')) {
      let cur2 = '';
      for (const word of para.split(/\s+/).filter(Boolean)) {
        const t = cur2 ? cur2 + ' ' + word : word;
        if (f.widthOfTextAtSize(t, size) <= width || !cur2) {
          if (!cur2 && f.widthOfTextAtSize(t, size) > width) {
            let part = '';
            for (const ch of t) { if (f.widthOfTextAtSize(part + ch, size) > width && part) { out.push(part); part = ch; } else part += ch; }
            cur2 = part;
          } else cur2 = t;
        } else { out.push(cur2); cur2 = word; }
      }
      out.push(cur2);
    }
    return out.filter((l, i, a) => l || (i > 0 && i < a.length - 1));
  };
  const newPage = () => { page = doc.addPage([PW, PH]); pages.push(page); y = PH - mm(18); };
  const ensure = need => { if (y - need >= BOTTOM + 6) return false; newPage(); return true; };
  const heading = s => { ensure(30); y -= 6; txt(s, L, y, { size: 11, f: bold }); y -= 16; };
  newPage();

  // ---- title
  txt(docTitle(m, lang), L, y, { size: 18, f: bold });
  txt(m.number ? `${de ? 'Nr.' : 'No.'} ${m.number}` : '', R, y + 2, { size: 12, f: bold, align: 'right' });
  y -= 16;
  txt(de ? `Lesbare Darstellung einer E-Rechnung · ${profileName(m)}` : `Readable view of an e-invoice · ${profileName(m)}`, L, y, { size: 8.5, color: grey });
  y -= 22;

  // ---- parties side by side
  const colW = (TW - 20) / 2;
  const partyBlock = (title, p, x) => {
    let yy = y;
    txt(title, x, yy, { size: 8, f: bold, color: grey }); yy -= 13;
    for (const [i, s] of addressLines(p).entries()) for (const ln of wrap(s, colW, i === 0 ? 10.5 : 9.5, i === 0 ? bold : font)) { txt(ln, x, yy, { size: i === 0 ? 10.5 : 9.5, f: i === 0 ? bold : font }); yy -= i === 0 ? 13.5 : 12.5; }
    const extra = [];
    if (p && p.vatId) extra.push(`${de ? 'USt-IdNr.' : 'VAT ID'} ${p.vatId}`);
    if (p && p.taxNo) extra.push(`${de ? 'Steuernr.' : 'Tax no.'} ${p.taxNo}`);
    if (p && p.regId) extra.push(`${de ? 'Register' : 'Registration'} ${p.regId}`);
    if (p && p.contact) for (const s of [p.contact.name, p.contact.phone, p.contact.email]) if (s) extra.push(s);
    if (extra.length) yy -= 3;
    for (const s of extra) for (const ln of wrap(s, colW, 8.5)) { txt(ln, x, yy, { size: 8.5, color: grey }); yy -= 11; }
    return yy;
  };
  const y1 = partyBlock(de ? 'VON (RECHNUNGSSTELLER)' : 'FROM (SELLER)', m.seller, L);
  const y2 = partyBlock(de ? 'AN (RECHNUNGSEMPFÄNGER)' : 'TO (BUYER)', m.buyer, L + colW + 20);
  y = Math.min(y1, y2) - 12;

  // ---- details grid
  const info = [];
  const push = (k, v) => { if (String(v || '').trim()) info.push([k, v]); };
  push(de ? 'Rechnungsdatum' : 'Invoice date', fmtDate(m.issueDate, lang));
  push(de ? 'Fällig am' : 'Due date', fmtDate(m.dueDate, lang));
  if (m.period.start || m.period.end) push(de ? 'Leistungszeitraum' : 'Billing period', `${fmtDate(m.period.start, lang)} – ${fmtDate(m.period.end, lang)}`);
  push(de ? 'Lieferdatum' : 'Delivery date', fmtDate(m.deliveryDate, lang));
  push(de ? 'Käuferreferenz / Leitweg-ID' : 'Buyer reference', m.buyerRef);
  push(de ? 'Bestellnummer' : 'Order no.', m.orderRef);
  push(de ? 'Vertragsnummer' : 'Contract no.', m.contractRef);
  push(de ? 'Projekt' : 'Project', m.projectRef);
  push(de ? 'Bezieht sich auf Rechnung' : 'Refers to invoice', m.precedingRef);
  push(de ? 'Währung' : 'Currency', cur !== 'EUR' ? cur : '');
  if (info.length) {
    const half = Math.ceil(info.length / 2);
    page.drawRectangle({ x: L, y: y - half * 14 + 6, width: TW, height: half * 14 + 8, color: soft });
    info.forEach(([k, v], i) => {
      const x = i < half ? L + 8 : L + TW / 2 + 8, yy = y - (i % half) * 14;
      txt(k, x, yy, { size: 8.5, color: grey });
      txt(v, x + TW / 2 - 16, yy, { size: 9, f: bold, align: 'right' });
    });
    y -= half * 14 + 14;
  }

  // ---- line items
  const cols = [{ k: 'pos', w: 26 }, { k: 'desc', w: 0 }, { k: 'qty', w: 46, a: 'right' }, { k: 'unit', w: 42 }, { k: 'price', w: 66, a: 'right' }, { k: 'vat', w: 36, a: 'right' }, { k: 'total', w: 72, a: 'right' }];
  cols.find(c => c.k === 'desc').w = TW - cols.reduce((s, c) => s + c.w, 0);
  let cx = L;
  for (const c of cols) { c.x = cx; cx += c.w; }
  const W = { pos: de ? 'Pos.' : 'No.', desc: de ? 'Bezeichnung' : 'Description', qty: de ? 'Menge' : 'Qty', unit: de ? 'Einheit' : 'Unit', price: de ? 'Einzelpreis' : 'Unit price', vat: de ? 'USt.' : 'VAT', total: de ? 'Netto' : 'Net' };
  const cellX = c => (c.a === 'right' ? c.x + c.w - 4 : c.x + (c.k === 'pos' ? 2 : 4));
  const header = () => {
    page.drawRectangle({ x: L, y: y - 5, width: TW, height: 18, color: soft });
    for (const c of cols) txt(W[c.k], cellX(c), y, { size: 8.5, f: bold, align: c.a || 'left' });
    y -= 20;
  };
  heading(de ? 'Positionen' : 'Line items');
  header();
  const dw = cols.find(c => c.k === 'desc').w - 8;
  for (const l of m.lines) {
    const desc = [];
    for (const s of wrap(l.name || '', dw, 9.5, bold)) desc.push([s, bold, 9.5]);
    for (const s of wrap(l.desc || '', dw, 8.5)) desc.push([s, font, 8.5]);
    if (l.period && (l.period.start || l.period.end)) desc.push([`${fmtDate(l.period.start, lang)} – ${fmtDate(l.period.end, lang)}`, font, 8.5]);
    if (l.sellerId) desc.push([`${de ? 'Art.-Nr.' : 'Item no.'} ${l.sellerId}`, font, 8.5]);
    for (const s of wrap(l.note || '', dw, 8.5)) desc.push([s, font, 8.5]);
    const h = Math.max(1, desc.length) * 11.5 + 7;
    if (ensure(h)) header();
    const price = l.price != null ? M(l.price) + (l.baseQty && l.baseQty !== 1 ? ` / ${fmtNum(l.baseQty, lang)}` : '') : '';
    const vals = { pos: l.id || '', qty: fmtNum(l.qty, lang), unit: unitLabel(l.unitCode, lang), price, vat: l.vatRate != null ? `${fmtNum(l.vatRate, lang)} %` : (l.vatCat || ''), total: M(l.net) };
    for (const c of cols) {
      if (c.k === 'desc') desc.forEach(([s, f, size], i) => txt(s, cellX(c), y - i * 11.5, { size, f, color: f === bold ? ink : grey }));
      else txt(vals[c.k], cellX(c), y, { size: 9, align: c.a || 'left' });
    }
    y -= h;
    page.drawLine({ start: { x: L, y: y + 9 }, end: { x: R, y: y + 9 }, thickness: 0.4, color: line });
  }

  // ---- allowances / charges on document level
  if (m.allowances.length) {
    y -= 4;
    for (const a of m.allowances) {
      ensure(14);
      txt(`${a.charge ? (de ? 'Zuschlag' : 'Charge') : (de ? 'Abzug' : 'Allowance')}${a.reason ? ': ' + a.reason : ''}${a.vatRate != null ? ` (${fmtNum(a.vatRate, lang)} %)` : ''}`, L + 30, y, { size: 9 });
      txt((a.charge ? '+ ' : '– ') + M(a.amount), R - 4, y, { size: 9, align: 'right' });
      y -= 13;
    }
  }

  // ---- totals
  const T = m.totals;
  const rows = [];
  const row = (k, v, st) => { if (v != null && Number.isFinite(v)) rows.push([k, st === 'neg' ? '– ' + M(v) : M(v), st]); };
  row(de ? 'Summe der Positionen' : 'Sum of line items', T.lines);
  if (T.allowances) row(de ? 'Abzüge' : 'Allowances', T.allowances, 'neg');
  if (T.charges) row(de ? 'Zuschläge' : 'Charges', T.charges);
  row(de ? 'Nettobetrag' : 'Net amount', T.net);
  for (const t of m.taxes) {
    const cat = t.cat && t.cat !== 'S' ? ` – ${label(VAT_CATS, t.cat, lang)}` : '';
    row(`${de ? 'USt.' : 'VAT'} ${fmtNum(t.rate ?? 0, lang)} % ${de ? 'auf' : 'on'} ${M(t.base)}${cat}`, t.amount, 'small');
  }
  if (m.taxes.length > 1 || !m.taxes.length) row(de ? 'Umsatzsteuer gesamt' : 'Total VAT', T.tax);
  row(de ? 'Rechnungsbetrag (brutto)' : 'Invoice total (gross)', T.gross, T.prepaid || T.rounding ? null : 'bold');
  if (T.prepaid) row(de ? 'Bereits gezahlt' : 'Paid in advance', T.prepaid, 'neg');
  if (T.rounding) row(de ? 'Rundung' : 'Rounding', T.rounding);
  for (const x of m.thirdParty || []) row(`${de ? 'Zahlung für Dritte' : 'Collected for a third party'}${x.text ? ': ' + x.text : ''}`, x.amount);
  if (T.prepaid || T.rounding || (m.thirdParty || []).length || (T.payable != null && T.gross != null && Math.abs(T.payable - T.gross) > 0.001)) row(m.kind === 'credit' ? (de ? 'Gutschriftbetrag' : 'Amount credited') : (de ? 'Zahlbetrag' : 'Amount due'), T.payable, 'bold');
  ensure(rows.length * 15 + 16);
  y -= 6;
  const tx = L + TW * 0.38;
  for (const [k, v, st] of rows) {
    const size = st === 'small' ? 8.5 : st === 'bold' ? 11 : 9.5;
    if (st === 'bold') { page.drawLine({ start: { x: tx, y: y + 11 }, end: { x: R, y: y + 11 }, thickness: 1, color: ink }); y -= 3; }
    const kl = wrap(k, R - tx - 90, size, st === 'bold' ? bold : font);
    kl.forEach((s, i) => txt(s, tx, y - i * (size + 2), { size, f: st === 'bold' ? bold : font, color: st === 'small' ? grey : ink }));
    txt(v, R - 4, y, { size, f: st === 'bold' ? bold : font, align: 'right', color: st === 'small' ? grey : ink });
    y -= (st === 'bold' ? 18 : 14) + (kl.length - 1) * (size + 2);
  }
  const reasons = m.taxes.map(t => t.reason).filter(Boolean);
  for (const s of reasons) for (const ln of wrap(s, TW, 8.5)) { ensure(12); txt(ln, L, y, { size: 8.5, color: grey }); y -= 11; }

  // ---- payment
  const p = m.payment || {};
  const payLines = [];
  if (p.meansCode) payLines.push(`${de ? 'Zahlungsart' : 'Payment method'}: ${label(PAYMENT_MEANS, p.meansCode, lang)}${p.meansText && p.meansText !== label(PAYMENT_MEANS, p.meansCode, lang) ? ` (${p.meansText})` : ''}`);
  if (isDirectDebit(p.meansCode)) {
    payLines.push(de ? 'Der Betrag wird per Lastschrift eingezogen – du musst nichts überweisen.' : 'The amount will be collected by direct debit – you do not need to transfer anything.');
    if (p.mandate) payLines.push(`${de ? 'Mandatsreferenz' : 'Mandate reference'}: ${p.mandate}`);
    if (p.creditorId) payLines.push(`${de ? 'Gläubiger-ID' : 'Creditor ID'}: ${p.creditorId}`);
    if (p.debitIban) payLines.push(`${de ? 'Belastetes Konto' : 'Debited account'}: ${formatIban(p.debitIban)}`);
  } else {
    if (p.accountName || (m.payee && m.payee.name)) payLines.push(`${de ? 'Empfänger' : 'Payee'}: ${p.accountName || m.payee.name}`);
    if (p.iban) payLines.push(`IBAN ${formatIban(p.iban)}`);
    if (p.bic) payLines.push(`BIC ${p.bic}`);
    if (p.iban) payLines.push(`${de ? 'Verwendungszweck' : 'Reference'}: ${paymentReference(m, lang)}`);
  }
  if (m.dueDate) payLines.push(`${de ? 'Fällig am' : 'Due'} ${fmtDate(m.dueDate, lang)}`);
  const termLines = p.terms ? wrap(p.terms, TW - mm(40), 9) : [];
  const amt = payable(m);
  if (payLines.length || termLines.length) {
    const size = mm(28);
    heading(de ? 'Bezahlen' : 'Payment');
    ensure(Math.max(amt ? size + 24 : 0, (payLines.length + termLines.length) * 12.5));
    let by = y;
    for (const s of payLines) for (const ln of wrap(s, TW - (amt ? size + 20 : 0), 9.5)) { txt(ln, L, by, { size: 9.5 }); by -= 12.5; }
    for (const ln of termLines) { txt(ln, L, by, { size: 9, color: grey }); by -= 12; }
    if (amt) {
      const qr = encodeQR(girocodePayload({ name: p.accountName || (m.payee && m.payee.name) || (m.seller && m.seller.name), iban: p.iban, bic: p.bic, amount: amt, text: paymentReference(m, lang) }), { ecc: 'M' });
      const qx = R - size, qy = y - size + 10;
      const ops = qrPdfOps(qr, qx, qy, size, { border: 2 });
      const ctx = doc.context;
      const stream = ctx.register(ctx.flateStream('q\n' + ops + 'Q\n'));
      const KEY = PDFName.of('Contents');
      const raw = page.node.get(KEY), arr = page.node.lookup(KEY);
      if (arr instanceof PDFArray) arr.push(stream); else if (raw) page.node.set(KEY, ctx.obj([raw, stream])); else page.node.set(KEY, ctx.obj([stream]));
      const cap = wrap(de ? `GiroCode über ${M(amt)} – mit der Banking-App scannen` : `EPC QR for ${M(amt)} – scan with your banking app`, size + mm(10), 7);
      cap.forEach((s, i) => txt(s, R - size / 2, qy - 9 - i * 8.5, { size: 7, color: grey, align: 'center' }));
      by = Math.min(by, qy - 9 - cap.length * 8.5);
    }
    y = by - 6;
  }

  // ---- notes
  if (m.notes.length) {
    heading(de ? 'Hinweise' : 'Notes');
    for (const n of m.notes) { for (const ln of wrap(n, TW, 9)) { ensure(12); txt(ln, L, y, { size: 9 }); y -= 12; } y -= 4; }
  }
  if (m.delivery) {
    heading(de ? 'Lieferanschrift' : 'Delivery address');
    for (const s of addressLines(m.delivery)) { ensure(12); txt(s, L, y, { size: 9 }); y -= 12; }
  }

  // ---- check
  if (m.checks && m.checks.length) {
    heading(de ? 'Prüfung der Rechnung' : 'Invoice check');
    for (const c of m.checks) {
      const ls = wrap(de ? c.de : c.en, TW - 18, 9);
      ensure(ls.length * 12 + 2);
      page.drawCircle({ x: L + 5, y: y + 3, size: 3.2, color: c.ok ? okC : warnC });
      ls.forEach((s, i) => txt(s, L + 16, y - i * 12, { size: 9, color: c.ok ? ink : warnC }));
      y -= ls.length * 12 + 2;
    }
    ensure(14);
    y -= 2;
    for (const ln of wrap(de ? 'Geprüft wurden nur Summen, Steuerberechnung und IBAN. Ob die Leistung erbracht wurde und der Absender echt ist, kann nur der Empfänger prüfen.' : 'Only sums, VAT calculation and IBAN were checked. Whether the service was delivered and the sender is genuine can only be checked by the recipient.', TW, 8)) { txt(ln, L, y, { size: 8, color: grey }); y -= 10; }
  }

  // ---- footer
  pages.forEach((pg, i) => {
    page = pg;
    pg.drawLine({ start: { x: L, y: mm(14) }, end: { x: R, y: mm(14) }, thickness: 0.4, color: line });
    txt(de ? 'Lesbare Darstellung – rechtlich maßgeblich ist die XML-Datei der E-Rechnung. Erstellt im Browser mit FaleNetwork.' : 'Readable view – the XML file of the e-invoice is the legally relevant original. Created in the browser with FaleNetwork.', L, mm(14) - 10, { size: 7, color: grey });
    if (pages.length > 1) txt(de ? `Seite ${i + 1} von ${pages.length}` : `Page ${i + 1} of ${pages.length}`, R, mm(14) - 10, { size: 7, color: grey, align: 'right' });
  });

  const title = `${docTitle(m, lang)} ${m.number || ''}`.trim();
  doc.setTitle(clean(title));
  if (m.seller && m.seller.name) doc.setAuthor(clean(m.seller.name));
  doc.setLanguage(de ? 'de-DE' : 'en');
  const bytes = await saveDoc(doc, { title: clean(title) });
  return { bytes, pages: pages.length, missing: [...missing] };
}
