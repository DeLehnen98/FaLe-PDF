// Invoice model, maths (integer cents), checks (§ 14 UStG on the German page), GiroCode (EPC QR) and the
// PDF writer (DIN 5008 form B letter: window address field, information block, item table with page
// breaks and repeated header, totals per VAT rate, payment terms, bank details + QR, footer on every page).
import { loadPdfLib, saveDoc } from './pdf.js';
import { encodeQR, qrPdfOps } from './shared/qr.js';

// ---------------------------------------------------------------- numbers, dates
/** Number typed by a person. With lang 'de', "1.000" is a thousand and "1,500" one and a half. */
export function parseNum(s, lang = null) {
  if (typeof s === 'number') return Number.isFinite(s) ? s : NaN;
  let t = String(s ?? '').trim().replace(/\s|€|\$|£/g, '');
  if (!t) return NaN;
  if (/,\d{1,}$/.test(t) && t.includes('.')) t = t.replace(/\./g, '').replace(',', '.');   // 1.234,56
  else if (lang === 'de' && /^-?\d{1,3}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, '');       // 1.000 (de)
  else if (lang !== 'de' && /^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(t)) t = t.replace(/,/g, ''); // 1,234.56
  else t = t.replace(',', '.');
  return /^-?\d*\.?\d+$/.test(t) ? parseFloat(t) : NaN;
}
const round = v => Math.round(v + Math.sign(v) * 1e-9);
export const money = (cents, lang, currency = 'EUR') => new Intl.NumberFormat(lang === 'de' ? 'de-DE' : 'en-GB', { style: 'currency', currency }).format(cents / 100);
/** Unit price: like money(), but keeps up to 4 decimals when the price has them (0,333 € stays 0,333 €). */
export const unitMoney = (price, lang, currency = 'EUR') => (Math.abs(price * 100 - Math.round(price * 100)) < 1e-6 ? money(round(price * 100), lang, currency)
  : new Intl.NumberFormat(lang === 'de' ? 'de-DE' : 'en-GB', { style: 'currency', currency, minimumFractionDigits: 2, maximumFractionDigits: 4 }).format(price));
export const num = (v, lang) => new Intl.NumberFormat(lang === 'de' ? 'de-DE' : 'en-GB', { maximumFractionDigits: 3 }).format(v);
const pad = n => String(n).padStart(2, '0');
export const isoDate = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export function fmtDate(iso, lang) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
  if (!m) return '';
  return lang === 'de' ? `${m[3]}.${m[2]}.${m[1]}` : new Date(+m[1], +m[2] - 1, +m[3]).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
}
export function addDays(iso, days) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
  if (!m) return '';
  return isoDate(new Date(+m[1], +m[2] - 1, +m[3] + (+days || 0)));
}
/** Next invoice number: increments the last digit group, keeps its zero padding ("2026-007" → "2026-008"). */
export function nextNumber(last) {
  const s = String(last || '').trim();
  if (!s) return '';
  const m = /^(.*?)(\d+)(\D*)$/.exec(s);
  if (!m) return s + '-2';
  const n = String(+m[2] + 1).padStart(m[2].length, '0');
  return m[1] + n + m[3];
}

// ---------------------------------------------------------------- IBAN, GiroCode
export const cleanIban = s => String(s || '').replace(/\s+/g, '').toUpperCase();
export function ibanValid(s) {
  const iban = cleanIban(s);
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(iban)) return false;
  const r = (iban.slice(4) + iban.slice(0, 4)).replace(/[A-Z]/g, c => String(c.charCodeAt(0) - 55));
  let mod = 0;
  for (const ch of r) mod = (mod * 10 + +ch) % 97;
  return mod === 1;
}
export const formatIban = s => cleanIban(s).replace(/(.{4})/g, '$1 ').trim();
/** EPC069-12 "SEPA Credit Transfer" payload (version 002, UTF-8). */
export function girocodePayload({ name, iban, bic = '', cents, text = '' }) {
  const clip = (s, n) => String(s || '').replace(/[\r\n]+/g, ' ').trim().slice(0, n);
  const amount = cents > 0 && cents <= 99999999999 ? `EUR${(cents / 100).toFixed(2)}` : '';
  return ['BCD', '002', '1', 'SCT', clip(bic, 11).toUpperCase(), clip(name, 70), cleanIban(iban), amount, '', '', clip(text, 140)].join('\n');
}

// ---------------------------------------------------------------- totals
/**
 * items: [{desc, qty, unit, price (net per unit), vat (%)}], discount (%), noTax (Kleinunternehmer / no tax)
 * → { lines: [{…, cents}], groups: [{rate, net, tax}], subtotal, discount, net, tax, gross }
 */
export function computeTotals(v) {
  const noTax = !!v.noTax;
  const lang = v.lang || null; // set by the form: how "1.000" / "1,500" are meant
  const d = Math.min(100, Math.max(0, parseNum(v.discount, lang) || 0));
  const lines = (v.items || []).map(it => {
    const qty = parseNum(it.qty, lang), price = parseNum(it.price, lang);
    const ok = String(it.desc || '').trim() && Number.isFinite(qty) && Number.isFinite(price);
    const rate = noTax ? 0 : Math.max(0, parseNum(it.vat, lang) || 0);
    return { ...it, qtyN: qty, priceN: price, rate, ok: !!ok, cents: ok ? round(qty * price * 100) : 0 };
  });
  const byRate = new Map();
  for (const l of lines) if (l.ok) byRate.set(l.rate, (byRate.get(l.rate) || 0) + l.cents);
  const subtotal = [...byRate.values()].reduce((s, c) => s + c, 0);
  const groups = [...byRate.entries()].sort((a, b) => b[0] - a[0]).map(([rate, sum]) => {
    const net = round(sum * (1 - d / 100));
    return { rate, sum, net, tax: round(net * rate / 100) };
  });
  const net = groups.reduce((s, g) => s + g.net, 0);
  const tax = groups.reduce((s, g) => s + g.tax, 0);
  return { lines, groups, subtotal, discountPct: d, discount: subtotal - net, net, tax, gross: net + tax };
}

// ---------------------------------------------------------------- checks
const has = s => !!String(s || '').trim();
/** Missing mandatory details – German page: § 14 Abs. 4 UStG; English page: a generic checklist. */
export function checks(v, lang) {
  const t = computeTotals(v);
  const de = lang === 'de';
  const list = [
    { ok: has(v.sName) && has(v.sStreet) && has(v.sCity), de: 'Name und Anschrift des leistenden Unternehmens', en: 'Your name and address' },
    { ok: has(v.rName) && has(v.rStreet) && has(v.rCity), de: 'Name und Anschrift des Leistungsempfängers', en: 'Customer name and address' },
    { ok: has(v.taxNo) || has(v.vatId), de: 'Steuernummer oder USt-IdNr.', en: 'Tax or VAT number', optional: !de },
    { ok: has(v.number), de: 'Fortlaufende Rechnungsnummer', en: 'Invoice number' },
    { ok: /^\d{4}-\d{2}-\d{2}$/.test(v.date || ''), de: 'Ausstellungsdatum', en: 'Invoice date' },
    { ok: v.serviceMode === 'none' ? !de : v.serviceMode === 'period' ? /^\d{4}-\d{2}-\d{2}$/.test(v.from || '') && /^\d{4}-\d{2}-\d{2}$/.test(v.to || '') : /^\d{4}-\d{2}-\d{2}$/.test(v.serviceDate || ''), de: 'Liefer- oder Leistungsdatum bzw. -zeitraum', en: 'Date or period of supply', optional: !de },
    { ok: t.lines.some(l => l.ok) && t.lines.every(l => l.ok || (!has(l.desc) && !has(l.price))), de: 'Menge und Art der Leistung (mindestens eine vollständige Position)', en: 'At least one complete line item' },
  ];
  if (de && !v.noTax && t.groups.some(g => g.rate === 0)) list.push({ ok: has(v.exemptNote), de: 'Hinweis auf die Steuerbefreiung (bei 0 %)', en: '' });
  return list.filter(c => de || c.en);
}

// ---------------------------------------------------------------- texts
export function words(lang, v) {
  const de = lang === 'de';
  return {
    title: de ? 'Rechnung' : 'Invoice',
    number: de ? 'Rechnungsnummer' : 'Invoice no.',
    date: de ? 'Rechnungsdatum' : 'Invoice date',
    service: de ? 'Leistungsdatum' : 'Date of supply',
    period: de ? 'Leistungszeitraum' : 'Period of supply',
    customer: de ? 'Kundennummer' : 'Customer no.',
    yourVat: de ? 'USt-IdNr. Kunde' : 'Customer VAT no.',
    pos: de ? 'Pos.' : 'No.',
    desc: de ? 'Beschreibung' : 'Description',
    qty: de ? 'Menge' : 'Qty',
    unit: de ? 'Einheit' : 'Unit',
    price: de ? 'Einzelpreis' : 'Unit price',
    vat: de ? 'USt.' : (v.taxLabel || 'VAT'),
    total: de ? 'Gesamt' : 'Amount',
    subtotal: de ? 'Zwischensumme (netto)' : 'Subtotal',
    discount: p => (de ? `Rabatt ${p} %` : `Discount ${p} %`),
    net: de ? 'Nettobetrag' : 'Net amount',
    netAt: r => (de ? `Netto ${r} %` : `Net at ${r} %`),
    taxAt: (r, base) => (de ? `zzgl. ${r} % USt. auf ${base}` : `${v.taxLabel || 'VAT'} ${r} % on ${base}`),
    gross: de ? 'Rechnungsbetrag' : 'Total due',
    totalNoTax: de ? 'Rechnungsbetrag' : 'Total due',
    page: (i, n) => (de ? `Seite ${i} von ${n}` : `Page ${i} of ${n}`),
    taxNo: de ? 'Steuernummer' : 'Tax no.',
    vatId: de ? 'USt-IdNr.' : 'VAT no.',
    bank: de ? 'Bankverbindung' : 'Bank details',
    qr: de ? 'Zum Bezahlen mit der Banking-App scannen (GiroCode)' : 'Scan with your banking app to pay (EPC QR)',
    continued: de ? 'Fortsetzung auf der nächsten Seite' : 'Continued on the next page',
  };
}
export const KU_NOTE = 'Steuerfreie Kleinunternehmerleistung gemäß § 19 UStG – im Rechnungsbetrag ist keine Umsatzsteuer enthalten.';
export const EXEMPT_PRESETS = [
  { id: 'rc', label: 'Reverse Charge', de: 'Steuerschuldnerschaft des Leistungsempfängers (Reverse Charge)' },
  { id: 'eu', label: 'EU-Lieferung', de: 'Steuerfreie innergemeinschaftliche Lieferung (§ 4 Nr. 1b UStG)' },
  { id: 'export', label: 'Ausfuhr', de: 'Steuerfreie Ausfuhrlieferung (§ 4 Nr. 1a UStG)' },
];
export function paymentText(v, lang, totals) {
  const de = lang === 'de';
  const days = +v.terms || 0;
  const due = addDays(v.date || isoDate(), days);
  const amt = money(totals.gross, lang, v.currency || 'EUR');
  if (totals.gross <= 0) return '';
  if (!days) return de ? `Zahlbar sofort nach Erhalt der Rechnung ohne Abzug (${amt}).` : `Please pay ${amt} on receipt of this invoice.`;
  return de ? `Zahlbar bis ${fmtDate(due, lang)} ohne Abzug.` : `Payment due by ${fmtDate(due, lang)} (${days} days).`;
}

// ---------------------------------------------------------------- PDF
const mm = v => v * 72 / 25.4;

/**
 * @param v       invoice data
 * @param lang    'de' | 'en'
 * @param logo    {bytes, type} | null
 * @returns {Promise<{bytes: Uint8Array, pages: number, missing: string[]}>}
 */
export async function invoicePdf(v, lang, logo = null) {
  const PDFLib = await loadPdfLib();
  const { PDFDocument, rgb, PDFName, PDFArray } = PDFLib;
  const de = lang === 'de';
  const cur = de ? 'EUR' : (v.currency || 'EUR');
  const W = words(lang, v);
  const tot = computeTotals(v);
  const doc = await PDFDocument.create();
  // fonts: the standard Helvetica when every character fits (WinAnsi), else Liberation Sans (Unicode subset)
  const uf = await import('./unifont.js');
  const all = JSON.stringify(v);
  let font, bold;
  if (uf.needsUnicode(all)) {
    try { font = await uf.uniFont(doc, { PDFLib }); bold = await uf.uniFont(doc, { bold: true, PDFLib }); } catch (err) { console.warn(err); }
  }
  if (!font) { font = await uf.stdFont(doc, { PDFLib }); bold = await uf.stdFont(doc, { bold: true, PDFLib }); }
  const missing = new Set();
  const clean = (s, f = font) => { const r = uf.cleanText(String(s ?? ''), f); r.missing.forEach(c => missing.add(c)); return r.text; };
  const PW = 595.28, PH = 841.89, L = mm(25), R = PW - mm(20), TW = R - L, BOTTOM = mm(32);
  const ink = rgb(0.09, 0.09, 0.12), grey = rgb(0.38, 0.38, 0.44), line = rgb(0.75, 0.75, 0.8), soft = rgb(0.95, 0.95, 0.97);
  const pages = [];
  let page, y;
  const txt = (s, x, yy, { size = 10, f = font, color = ink, align = 'left' } = {}) => {
    const t = clean(s, f);
    if (!t) return 0;
    const w = f.widthOfTextAtSize(t, size);
    page.drawText(t, { x: align === 'right' ? x - w : align === 'center' ? x - w / 2 : x, y: yy, size, font: f, color });
    return w;
  };
  const wrap = (s, width, size = 10, f = font) => {
    const out = [];
    for (const para of clean(s, f).split('\n')) {
      let cur2 = '';
      for (const word of para.split(/\s+/).filter(Boolean)) {
        const t = cur2 ? cur2 + ' ' + word : word;
        if (f.widthOfTextAtSize(t, size) <= width || !cur2) {
          // a single over-long word is broken by characters
          if (!cur2 && f.widthOfTextAtSize(t, size) > width) {
            let part = '';
            for (const ch of t) { if (f.widthOfTextAtSize(part + ch, size) > width && part) { out.push(part); part = ch; } else part += ch; }
            cur2 = part;
          } else cur2 = t;
        } else { out.push(cur2); cur2 = word; }
      }
      out.push(cur2);
    }
    return out;
  };
  const newPage = () => {
    page = doc.addPage([PW, PH]);
    pages.push(page);
    // fold and punch marks (DIN 5008)
    for (const yy of [105, 210]) page.drawLine({ start: { x: mm(3), y: PH - mm(yy) }, end: { x: mm(8), y: PH - mm(yy) }, thickness: 0.4, color: line });
    page.drawLine({ start: { x: mm(3), y: PH - mm(148.5) }, end: { x: mm(10), y: PH - mm(148.5) }, thickness: 0.4, color: line });
    y = PH - mm(20);
  };
  newPage();

  // ---- letterhead: logo (top left) + sender (top right)
  if (logo) {
    try {
      const img = logo.type === 'image/png' ? await doc.embedPng(logo.bytes) : await doc.embedJpg(logo.bytes);
      const maxW = mm(60), maxH = mm(22);
      const k = Math.min(maxW / img.width, maxH / img.height);
      page.drawImage(img, { x: L, y: PH - mm(12) - img.height * k, width: img.width * k, height: img.height * k });
    } catch (err) { console.warn('logo', err); }
  }
  let hy = PH - mm(16);
  const head = [[v.sName, 11.5, bold], [v.sStreet, 9], [v.sCity, 9], [v.sCountry, 9], [v.sPhone, 9], [v.sMail, 9], [v.sWeb, 9]].filter(r => String(r[0] || '').trim());
  for (const [s, size, f] of head) { txt(s, R, hy, { size, f: f || font, align: 'right', color: f ? ink : grey }); hy -= size * 1.35; }

  // ---- address field (45 mm from the top, return line + recipient)
  const ret = [v.sName, v.sStreet, v.sCity].map(s => String(s || '').trim()).filter(Boolean).join(' · ');
  if (ret) {
    let r = clean(ret);
    while (r.length > 4 && font.widthOfTextAtSize(r, 7) > mm(80)) r = r.slice(0, -2);
    page.drawText(r, { x: L, y: PH - mm(45 + 17.7) + 2, size: 7, font, color: grey });
    page.drawLine({ start: { x: L, y: PH - mm(45 + 17.7) }, end: { x: L + font.widthOfTextAtSize(r, 7), y: PH - mm(45 + 17.7) }, thickness: 0.3, color: grey });
  }
  let ay = PH - mm(45 + 17.7) - 14;
  for (const s of [v.rName, v.rAttn, v.rStreet, v.rCity, v.rCountry].filter(x => String(x || '').trim()).slice(0, 6)) { txt(s, L, ay, { size: 10.5 }); ay -= 13.5; }

  // ---- information block (x = 125 mm, from 50 mm)
  const info = [[W.number, v.number], [W.date, fmtDate(v.date, lang)]];
  if (v.serviceMode === 'period' && v.from && v.to) info.push([W.period, `${fmtDate(v.from, lang)} – ${fmtDate(v.to, lang)}`]);
  else if (v.serviceMode === 'date' && v.serviceDate) info.push([W.service, fmtDate(v.serviceDate, lang)]);
  else if (v.serviceMode === 'same') info.push([W.service, fmtDate(v.date, lang)]);
  if (String(v.customerNo || '').trim()) info.push([W.customer, v.customerNo]);
  if (String(v.rVatId || '').trim()) info.push([W.yourVat, v.rVatId]);
  let iy = PH - mm(50);
  const ix = mm(125);
  for (const [k, val] of info) {
    txt(k, ix, iy, { size: 8.5, color: grey });
    txt(val, R, iy, { size: 9, align: 'right', f: k === W.number ? bold : font });
    iy -= 13;
  }

  // ---- subject + intro
  y = Math.min(PH - mm(98.5), ay - 16, iy - 10);
  txt(`${W.title} ${String(v.number || '').trim()}`.trim(), L, y, { size: 15, f: bold });
  y -= 22;
  for (const ln of wrap(v.intro || '', TW, 10)) { if (ln) txt(ln, L, y); y -= 13.5; }
  if (String(v.intro || '').trim()) y -= 6;

  // ---- item table
  const showTax = !v.noTax;
  const cols = showTax
    ? [{ k: 'pos', w: 24 }, { k: 'desc', w: 0 }, { k: 'qty', w: 44, a: 'right' }, { k: 'unit', w: 40 }, { k: 'price', w: 70, a: 'right' }, { k: 'vat', w: 34, a: 'right' }, { k: 'total', w: 74, a: 'right' }]
    : [{ k: 'pos', w: 24 }, { k: 'desc', w: 0 }, { k: 'qty', w: 48, a: 'right' }, { k: 'unit', w: 46 }, { k: 'price', w: 78, a: 'right' }, { k: 'total', w: 80, a: 'right' }];
  const fixed = cols.reduce((s, c) => s + c.w, 0);
  cols.find(c => c.k === 'desc').w = TW - fixed;
  let cx = L;
  for (const c of cols) { c.x = cx; cx += c.w; }
  const cellX = c => (c.a === 'right' ? c.x + c.w - 4 : c.x + (c.k === 'pos' ? 0 : 4));
  const header = () => {
    page.drawRectangle({ x: L, y: y - 5, width: TW, height: 18, color: soft });
    for (const c of cols) txt(W[c.k], cellX(c), y, { size: 8.5, f: bold, align: c.a || 'left' });
    y -= 20;
  };
  const ensure = need => {
    if (y - need >= BOTTOM) return false;
    txt(W.continued, R, BOTTOM - 4, { size: 8, color: grey, align: 'right' });
    newPage();
    return true;
  };
  header();
  let posNo = 0;
  for (const l of tot.lines) {
    if (!l.ok) continue;
    posNo++;
    const dl = wrap(l.desc, cols.find(c => c.k === 'desc').w - 8, 9.5);
    const h = Math.max(1, dl.length) * 12.5 + 6;
    if (ensure(h)) header();
    const vals = { pos: String(posNo), qty: num(l.qtyN, lang), unit: l.unit || '', price: unitMoney(l.priceN, lang, cur), vat: `${num(l.rate, lang)} %`, total: money(l.cents, lang, cur) };
    for (const c of cols) {
      if (c.k === 'desc') dl.forEach((s, i) => txt(s, cellX(c), y - i * 12.5, { size: 9.5 }));
      else txt(vals[c.k], cellX(c), y, { size: 9.5, align: c.a || 'left' });
    }
    y -= h;
    page.drawLine({ start: { x: L, y: y + 9 }, end: { x: R, y: y + 9 }, thickness: 0.4, color: line });
  }

  // ---- totals (right column)
  const rows = [];
  const multi = tot.groups.length > 1;
  if (tot.discountPct > 0) {
    rows.push([W.subtotal, money(tot.subtotal, lang, cur)]);
    rows.push([W.discount(num(tot.discountPct, lang)), '− ' + money(tot.discount, lang, cur)]);
  }
  if (showTax) {
    rows.push([W.net, money(tot.net, lang, cur)]);
    for (const g of tot.groups) {
      if (multi) rows.push([W.netAt(num(g.rate, lang)), money(g.net, lang, cur), 'small']);
      rows.push([W.taxAt(num(g.rate, lang), money(g.net, lang, cur)), money(g.tax, lang, cur)]);
    }
  }
  rows.push([showTax ? W.gross : W.totalNoTax, money(tot.gross, lang, cur), 'bold']);
  if (ensure(rows.length * 15 + 20)) { /* totals on the new page */ }
  y -= 4;
  const tx = L + TW * 0.38;
  for (const [k, val, st] of rows) {
    if (st === 'bold') { page.drawLine({ start: { x: tx, y: y + 11 }, end: { x: R, y: y + 11 }, thickness: 1, color: ink }); y -= 3; }
    txt(k, tx, y, { size: st === 'small' ? 8.5 : st === 'bold' ? 11 : 9.5, f: st === 'bold' ? bold : font, color: st === 'small' ? grey : ink });
    txt(val, R - 4, y, { size: st === 'small' ? 8.5 : st === 'bold' ? 11 : 9.5, f: st === 'bold' ? bold : font, align: 'right', color: st === 'small' ? grey : ink });
    y -= st === 'bold' ? 18 : 14.5;
  }
  y -= 8;

  // ---- notes
  const notes = [];
  if (de && v.noTax) notes.push(KU_NOTE);
  if (de && !v.noTax && tot.groups.some(g => g.rate === 0) && String(v.exemptNote || '').trim()) notes.push(v.exemptNote);
  const pay = paymentText(v, lang, tot);
  if (pay) notes.push(pay);
  if (String(v.closing || '').trim()) notes.push(v.closing);
  for (const n of notes) {
    const ls = wrap(n, TW, 9.5);
    if (ensure(ls.length * 13 + 6)) { /* continue */ }
    for (const ln of ls) { txt(ln, L, y, { size: 9.5 }); y -= 13; }
    y -= 5;
  }

  // ---- bank details + GiroCode
  const iban = cleanIban(v.iban);
  if (iban) {
    const qrOk = v.girocode && cur === 'EUR' && ibanValid(iban) && tot.gross > 0;
    const size = mm(28);
    if (ensure((qrOk ? size : 50) + 10)) { /* new page */ }
    let by = y - 2;
    txt(W.bank, L, by, { size: 9.5, f: bold }); by -= 13;
    for (const s of [v.bankHolder || v.sName, v.bankName, `IBAN ${formatIban(iban)}`, v.bic ? `BIC ${String(v.bic).toUpperCase()}` : '', de ? `Verwendungszweck: Rechnung ${v.number || ''}` : `Reference: Invoice ${v.number || ''}`].filter(x => String(x || '').trim())) { txt(s, L, by, { size: 9.5 }); by -= 13; }
    if (qrOk) {
      const payload = girocodePayload({ name: v.bankHolder || v.sName, iban, bic: v.bic, cents: tot.gross, text: `${W.title} ${v.number || ''}`.trim() });
      const qr = encodeQR(payload, { ecc: 'M' });
      const qx = R - size, qy = y - size;
      const ops = qrPdfOps(qr, qx, qy, size, { border: 2 });
      const ctx = doc.context;
      const stream = ctx.register(ctx.flateStream('q\n' + ops + 'Q\n'));
      const KEY = PDFName.of('Contents');
      const raw = page.node.get(KEY);
      const arr = page.node.lookup(KEY);
      if (arr instanceof PDFArray) arr.push(stream); else if (raw) page.node.set(KEY, ctx.obj([raw, stream])); else page.node.set(KEY, ctx.obj([stream]));
      const cap = wrap(W.qr, size + mm(14), 7);
      cap.forEach((s, i) => txt(s, R - size / 2, qy - 9 - i * 8.5, { size: 7, color: grey, align: 'center' }));
      by = Math.min(by, qy - 9 - cap.length * 8.5);
    }
    y = by - 6;
  }

  // ---- footer on every page + page numbers
  const fcols = [
    [v.sName, v.sStreet, v.sCity, v.sCountry],
    [v.taxNo ? `${W.taxNo}: ${v.taxNo}` : '', v.vatId ? `${W.vatId}: ${v.vatId}` : '', v.sPhone, v.sMail],
    iban ? [v.bankName, `IBAN ${formatIban(iban)}`, v.bic ? `BIC ${String(v.bic).toUpperCase()}` : ''] : [],
  ].map(c => c.filter(x => String(x || '').trim()));
  pages.forEach((p, i) => {
    page = p;
    p.drawLine({ start: { x: L, y: mm(24) }, end: { x: R, y: mm(24) }, thickness: 0.4, color: line });
    const cw = TW / 3;
    fcols.forEach((c, k) => c.slice(0, 4).forEach((s, j) => {
      let t = clean(s);
      while (t.length > 3 && font.widthOfTextAtSize(t, 7) > cw - 6) t = t.slice(0, -2);
      p.drawText(t, { x: L + k * cw, y: mm(24) - 10 - j * 9, size: 7, font, color: grey });
    }));
    if (pages.length > 1) txt(W.page(i + 1, pages.length), R, PH - mm(10), { size: 8, color: grey, align: 'right' });
  });

  const title = `${W.title} ${v.number || ''}`.trim();
  doc.setTitle(clean(title));
  if (String(v.sName || '').trim()) doc.setAuthor(clean(v.sName));
  doc.setLanguage(de ? 'de-DE' : 'en');
  const bytes = await saveDoc(doc, { title: clean(title) });
  return { bytes, pages: pages.length, missing: [...missing] };
}
