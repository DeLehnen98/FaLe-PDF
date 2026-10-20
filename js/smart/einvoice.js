// E-Rechnung auf dem Handy: XRechnung-/ZUGFeRD-Dateien öffnen, lesbar machen und im Briefkasten-Assistenten mit den
// exakten Daten aus der XML auswerten (Betrag, Zahlungsziel, IBAN, Verwendungszweck) – ohne Texterkennung, offline.
// Lesen und Prüfen übernimmt die Bibliothek der FaLe Werkzeuge (network/assets/wt/lib/einvoice*.js, im App-Paket
// unter /network/assets/wt/ mitgeliefert, siehe scripts/vercel-build.mjs Schritt 2c).
const LIB = new URL('../../network/assets/wt/lib/', import.meta.url).href;
const loadReader = () => import(LIB + 'einvoice.js');
const loadPrinter = () => import(LIB + 'einvoice-pdf.js');

export const XML_ATTACHMENT = 'xrechnung.xml';
const MAX_XML = 20 * 1048576;

/** Could this file be an e-invoice XML (by name/type)? */
export function isXmlFile(file) {
  const n = String((file && file.name) || '').toLowerCase();
  const t = String((file && file.type) || '').toLowerCase();
  return n.endsWith('.xml') || t === 'application/xml' || t === 'text/xml';
}

const plainLang = () => {
  try { return (document.documentElement.lang || 'de').toLowerCase().startsWith('de') ? 'de' : 'en'; } catch { return 'de'; }
};

/** Parse XML text → model (throws an error with a German userMessage when it is no e-invoice). */
export async function parseXml(text) {
  const E = await loadReader();
  try {
    return E.parseEInvoice(text);
  } catch (e) {
    const msg = e && e.userMessage ? (plainLang() === 'de' ? e.userMessage.de : e.userMessage.en) : 'Die Datei ist keine lesbare E-Rechnung.';
    throw Object.assign(new Error(msg), { userMessage: msg });
  }
}

/** The e-invoice inside a PDF (ZUGFeRD / Factur-X, or a readable copy made by FaLe) → {model, xml} | null. */
export async function fromPdf(pdf) {
  try {
    const E = await loadReader();
    const xml = await E.xmlFromPdf(pdf);
    if (!xml) return null;
    return { model: E.parseEInvoice(xml), xml };
  } catch (e) { console.warn('E-Rechnung in der PDF', e); return null; }
}

/** XML e-invoice → readable PDF (invoice layout) with the original XML attached unchanged. → {bytes, model, name} */
export async function xmlToReadablePdf(text) {
  const model = await parseXml(text);
  const P = await loadPrinter();
  const { bytes } = await P.einvoicePdf(model, plainLang());
  const { loadPdfLib, saveDoc } = await import('../pdflib.js');
  const PDFLib = await loadPdfLib();
  const doc = await PDFLib.PDFDocument.load(bytes);
  const now = new Date();
  await doc.attach(new TextEncoder().encode(text), XML_ATTACHMENT, {
    mimeType: 'text/xml', description: 'E-Rechnung (Original-XML, unverändert)', creationDate: now, modificationDate: now,
    afRelationship: PDFLib.AFRelationship ? PDFLib.AFRelationship.Source : undefined,
  });
  const seller = (model.seller && model.seller.name) || '';
  const title = `${model.kind === 'credit' ? 'Gutschrift' : 'Rechnung'} ${model.number || ''}${seller ? ` – ${seller}` : ''}`.replace(/\s+/g, ' ').trim();
  doc.setTitle(title);
  const name = `${title.replace(/[\\/:*?"<>|]+/g, ' ').slice(0, 90).trim() || 'E-Rechnung'}.pdf`;
  return { bytes: await saveDoc(doc), model, name };
}

/** Import an XML e-invoice file into the library as a readable PDF. → library meta */
export async function importXmlFile(file, opts = {}) {
  if (!file || !file.size) throw Object.assign(new Error('empty'), { userMessage: `„${(file && file.name) || 'Datei'}“ ist leer.` });
  if (file.size > MAX_XML) throw Object.assign(new Error('big'), { userMessage: 'Die XML-Datei ist zu groß für eine Rechnung.' });
  const text = await file.text();
  const { bytes, name } = await xmlToReadablePdf(text);
  const { importPdf } = await import('../library.js');
  return importPdf(bytes, { ...opts, name, source: 'E-Rechnung' });
}

/** The original XML of an e-invoice PDF as a file (for the tax adviser / bookkeeping). */
export async function originalXml(pdf, baseName = 'E-Rechnung') {
  const E = await loadReader();
  const xml = await E.xmlFromPdf(pdf);
  if (!xml) return null;
  return new File([xml], `${String(baseName).replace(/\.pdf$/i, '')}.xml`, { type: 'application/xml' });
}

/**
 * Letter fields for the Briefkasten from the exact e-invoice data (overrides what the text analysis guessed).
 * → {f: partial fields, type, subtype, due: {date, kind, label} | null, directDebit, info}
 */
export async function letterData(model) {
  const E = await loadReader();
  const P = await loadPrinter();
  const s = model.seller || {};
  const addr = [[s.street, s.street2].filter(Boolean).join(' '), [s.zip, s.city].filter(Boolean).join(' ')].filter(Boolean).join(', ');
  const amount = model.totals.payable != null ? model.totals.payable : model.totals.gross;
  const credit = model.kind === 'credit';
  const f = {
    sender: s.name || '', senderAddress: addr, recipient: (model.buyer && model.buyer.name) || '', date: model.issueDate || '',
    subject: `${credit ? 'Gutschrift' : 'Rechnung'} ${model.number || ''}`.trim(),
    amount: amount != null && model.currency === 'EUR' ? amount : null, amountLabel: credit ? 'Gutschrift' : 'Zahlbetrag',
    iban: model.payment.iban ? P.formatIban(model.payment.iban) : '', bic: model.payment.bic || '',
    purpose: P.paymentReference(model, 'de'),
    phone: (s.contact && s.contact.phone) || '', email: (s.contact && s.contact.email) || '',
    rechnungsnummer: model.number || '',
    kundennummer: (model.buyer && model.buyer.id) || '',
  };
  const directDebit = E.isDirectDebit(model.payment.meansCode);
  const due = model.dueDate && !credit ? { date: model.dueDate, kind: 'zahlung', label: directDebit ? 'Lastschrift am' : 'Zahlungsziel' } : null;
  return {
    f, type: 'rechnung', subtype: null, due, directDebit,
    info: {
      profile: E.profileName(model), currency: model.currency, lines: model.lines.length, payable: P.payable(model),
      checks: (model.checks || []).map(c => ({ ok: !!c.ok, level: c.level, text: c.de })),
    },
  };
}
