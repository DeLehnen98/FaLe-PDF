// E-Rechnung erstellen: the invoice generator's data (lib/new-invoice.js) as UN/CEFACT CII XML –
//   'zugferd'   ZUGFeRD 2 / Factur-X profile EN 16931, embedded in a PDF/A-3b (pdfaFinish below)
//   'xrechnung' XRechnung 3.0 (CII syntax) for public-sector buyers (Leitweg-ID)
// Amounts come from computeTotals() (integer cents), so XML and PDF always show the same numbers.
// Element order follows the CII D16B schema; checked in the tests against the XSD, the EN 16931
// schematron (CEN) and the XRechnung schematron (KoSIT), PDF/A-3 + ZUGFeRD with Mustang/veraPDF.
import { computeTotals, parseNum, addDays, isoDate, cleanIban, ibanValid, KU_NOTE, EXEMPT_PRESETS, paymentText } from './new-invoice.js';

export const GUIDELINE = {
  zugferd: 'urn:cen.eu:en16931:2017',
  xrechnung: 'urn:cen.eu:en16931:2017#compliant#urn:xeinkauf.de:kosit:xrechnung_3.0',
};
export const XML_NAME = 'factur-x.xml';

// ---------------------------------------------------------------- code lists
const UNIT_CODES = [
  [/^(stk|stück|stueck|st|pcs|pc|piece|pieces|x|einheit|unit|units)\.?$/i, 'H87'],
  [/^(std|stunde|stunden|h|hr|hrs|hour|hours)\.?$/i, 'HUR'],
  [/^(min|minute|minuten|minutes)\.?$/i, 'MIN'],
  [/^(tag|tage|d|day|days|pt|personentag|personentage)\.?$/i, 'DAY'],
  [/^(woche|wochen|wk|week|weeks)\.?$/i, 'WEE'],
  [/^(monat|monate|mon|month|months|mtl)\.?$/i, 'MON'],
  [/^(jahr|jahre|year|years|jhr)\.?$/i, 'ANN'],
  [/^km\.?$/i, 'KMT'], [/^kg\.?$/i, 'KGM'], [/^g\.?$/i, 'GRM'], [/^t\.?$/i, 'TNE'],
  [/^(m|meter|lfm|lfd\. ?m)\.?$/i, 'MTR'], [/^(m2|m²|qm)\.?$/i, 'MTK'], [/^(m3|m³|cbm)\.?$/i, 'MTQ'],
  [/^(l|liter|litre)\.?$/i, 'LTR'], [/^kwh$/i, 'KWH'],
  [/^(pauschal|pausch|psch|pauschale|lump sum|flat|flat rate|ls)\.?$/i, 'LS'],
  [/^(satz|set|sets)\.?$/i, 'SET'], [/^(paar|pair|pairs)\.?$/i, 'PR'], [/^(packung|pck|pkg|pack)\.?$/i, 'XPK'],
  [/^%$/, 'P1'],
];
/** UN/ECE Rec 20 unit code for a typed unit ("Std." → HUR); unknown or empty → H87 (piece). */
export function unitCode(unit) {
  const u = String(unit || '').trim();
  if (!u) return 'H87';
  for (const [re, code] of UNIT_CODES) if (re.test(u)) return code;
  return 'H87';
}

const COUNTRIES = {
  DE: ['deutschland', 'germany', 'de', 'brd', 'bundesrepublik deutschland'], AT: ['österreich', 'oesterreich', 'austria', 'at'],
  CH: ['schweiz', 'switzerland', 'ch'], FR: ['frankreich', 'france', 'fr'], NL: ['niederlande', 'netherlands', 'holland', 'nl'],
  BE: ['belgien', 'belgium', 'be'], LU: ['luxemburg', 'luxembourg', 'lu'], IT: ['italien', 'italy', 'it'], ES: ['spanien', 'spain', 'es'],
  PL: ['polen', 'poland', 'pl'], CZ: ['tschechien', 'czechia', 'czech republic', 'cz'], DK: ['dänemark', 'daenemark', 'denmark', 'dk'],
  SE: ['schweden', 'sweden', 'se'], FI: ['finnland', 'finland', 'fi'], IE: ['irland', 'ireland', 'ie'], PT: ['portugal', 'pt'],
  GB: ['großbritannien', 'grossbritannien', 'vereinigtes königreich', 'united kingdom', 'uk', 'england', 'gb'], US: ['usa', 'vereinigte staaten', 'united states', 'us'],
  GR: ['griechenland', 'greece', 'gr'], HU: ['ungarn', 'hungary', 'hu'], SK: ['slowakei', 'slovakia', 'sk'], SI: ['slowenien', 'slovenia', 'si'],
  HR: ['kroatien', 'croatia', 'hr'], RO: ['rumänien', 'rumaenien', 'romania', 'ro'], BG: ['bulgarien', 'bulgaria', 'bg'], NO: ['norwegen', 'norway', 'no'],
  LI: ['liechtenstein', 'li'], EE: ['estland', 'estonia', 'ee'], LV: ['lettland', 'latvia', 'lv'], LT: ['litauen', 'lithuania', 'lt'], MT: ['malta', 'mt'], CY: ['zypern', 'cyprus', 'cy'],
  TR: ['türkei', 'tuerkei', 'turkey', 'türkiye', 'tr'],
};
/** ISO 3166-1 alpha-2 for a typed country (empty → DE); null when unknown. */
export function countryCode(s) {
  const t = String(s || '').trim().toLowerCase();
  if (!t) return 'DE';
  for (const [code, names] of Object.entries(COUNTRIES)) if (names.includes(t)) return code;
  return /^[a-z]{2}$/.test(t) ? t.toUpperCase() : null;
}
/** "66111 Saarbrücken" → {zip, city}. */
export function splitCity(s) {
  const t = String(s || '').trim();
  const m = /^(?:[A-Z]{1,2}[- ])?(\d{4,5})\s+(.+)$/.exec(t) || /^(.+?)\s+(\d{4,5})$/.exec(t);
  if (!m) return { zip: '', city: t };
  return /^\d/.test(m[1]) ? { zip: m[1], city: m[2].trim() } : { zip: m[2], city: m[1].trim() };
}

/** VAT category for a group: S (rate > 0), E (small business / other exemption), AE (reverse charge), K (EU), G (export). */
function zeroCategory(v) {
  if (v.noTax) return 'E';
  const note = String(v.exemptNote || '');
  const pre = EXEMPT_PRESETS.find(p => p.de === note.trim());
  if (pre) return { rc: 'AE', eu: 'K', export: 'G' }[pre.id];
  if (/reverse charge|steuerschuldnerschaft des leistungsempf/i.test(note)) return 'AE';
  if (/innergemeinschaftlich/i.test(note)) return 'K';
  if (/ausfuhr/i.test(note)) return 'G';
  return 'E';
}
const catOf = (v, rate) => (rate > 0 ? 'S' : zeroCategory(v));
function exemptionReason(v, cat) {
  if (cat === 'S') return '';
  if (v.noTax) return KU_NOTE;
  const note = String(v.exemptNote || '').trim();
  if (note) return note;
  return { AE: 'Steuerschuldnerschaft des Leistungsempfängers (Reverse Charge)', K: 'Steuerfreie innergemeinschaftliche Lieferung', G: 'Steuerfreie Ausfuhrlieferung', E: 'Steuerbefreit' }[cat];
}

// ---------------------------------------------------------------- checks (what the e-invoice still needs)
const has = s => !!String(s || '').trim();
/**
 * Missing details for an e-invoice in `format` ('zugferd' | 'xrechnung'), as [{id, de, en}].
 * Only things the user can fix in the form; the schema/business rules themselves are guaranteed by buildCii().
 */
export function eChecks(v, format) {
  const out = [];
  const miss = (id, de, en) => out.push({ id, de, en });
  const t = computeTotals(v);
  const seller = splitCity(v.sCity), buyer = splitCity(v.rCity);
  if (!has(v.sName)) miss('sName', 'Name deines Unternehmens', 'Your company name');
  if (!has(v.sStreet) || !seller.zip || !seller.city) miss('sCity', 'Deine Anschrift mit Straße, PLZ und Ort', 'Your address with street, postcode and town');
  if (countryCode(v.sCountry) == null) miss('sCountry', 'Dein Land als Name oder Ländercode (z. B. DE)', 'Your country as name or code (e.g. DE)');
  if (!has(v.taxNo) && !has(v.vatId)) miss('taxNo', 'Steuernummer oder USt-IdNr.', 'Tax number or VAT ID');
  if (!has(v.rName)) miss('rName', 'Name des Kunden', 'Customer name');
  if (!buyer.city || (format === 'xrechnung' && !buyer.zip)) miss('rCity', format === 'xrechnung' ? 'PLZ und Ort des Kunden' : 'Ort des Kunden', format === 'xrechnung' ? 'Customer postcode and town' : 'Customer town');
  if (countryCode(v.rCountry) == null) miss('rCountry', 'Land des Kunden als Name oder Ländercode (z. B. AT)', 'Customer country as name or code (e.g. AT)');
  if (!has(v.iban) || !ibanValid(v.iban)) miss('iban', 'Gültige IBAN (für die Zahlungsangaben)', 'A valid IBAN (for the payment details)');
  if ((v.currency || 'EUR') !== 'EUR' && v.lang === 'de') miss('currency', 'Währung Euro', 'Currency euro');
  if (!t.lines.some(l => l.ok)) miss('items', 'Mindestens eine vollständige Position', 'At least one complete line item');
  if (t.lines.some(l => l.ok && l.qtyN <= 0)) miss('items', 'Mengen größer als 0 (für Gutschriften gibt es eigene Belege)', 'Quantities above 0 (credit notes are separate documents)');
  if (t.gross <= 0 && t.lines.some(l => l.ok)) miss('items', 'Ein Rechnungsbetrag über 0', 'An invoice total above 0');
  const cats = new Set(t.groups.map(g => catOf(v, g.rate)));
  if ((cats.has('AE') || cats.has('K')) && !has(v.rVatId)) miss('rVatId', 'USt-IdNr. des Kunden (Pflicht bei Reverse Charge und EU-Lieferung)', 'Customer VAT ID (required for reverse charge and EU supplies)');
  if ((cats.has('AE') || cats.has('K') || cats.has('G')) && !has(v.vatId)) miss('vatId', 'Deine USt-IdNr. (Pflicht bei Reverse Charge, EU-Lieferung und Ausfuhr)', 'Your VAT ID (required for reverse charge, EU supplies and exports)');
  if (cats.has('K') && v.serviceMode === 'none') miss('serviceMode', 'Liefer- oder Leistungsdatum (Pflicht bei EU-Lieferung)', 'Date or period of supply (required for EU supplies)');
  if (cats.size > 1 && cats.has('E') && v.noTax) miss('items', 'Kleinunternehmer: alle Positionen ohne Umsatzsteuer', 'Small business: all items without VAT');
  if (format === 'xrechnung') {
    if (!has(v.buyerRef)) miss('buyerRef', 'Leitweg-ID bzw. Käuferreferenz des Kunden', 'Buyer reference (Leitweg-ID)');
    if (!has(v.sPhone) || String(v.sPhone).replace(/\D/g, '').length < 3) miss('sPhone', 'Deine Telefonnummer', 'Your phone number');
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(v.sMail || '').trim())) miss('sMail', 'Deine E-Mail-Adresse', 'Your e-mail address');
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(v.rMail || '').trim())) miss('rMail', 'E-Mail-Adresse des Kunden (Rechnungseingang)', 'Customer e-mail address (for invoices)');
  } else if (has(v.rMail) && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(v.rMail).trim())) miss('rMail', 'Gültige E-Mail-Adresse des Kunden', 'A valid customer e-mail address');
  return out.filter((c, i, a) => a.findIndex(x => x.id === c.id && x.de === c.de) === i);
}

// ---------------------------------------------------------------- XML
const esc = s => String(s ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const amt = cents => (cents / 100).toFixed(2);
const d102 = iso => String(iso || '').replace(/-/g, '');
const num = (x, max = 4) => { const s = Number(x).toFixed(max).replace(/0+$/, '').replace(/\.$/, ''); return s === '-0' ? '0' : s; };
const rateStr = r => num(r, 2);

/**
 * CII XML for the invoice. Throws Error({userMessage}) when eChecks() is not empty.
 * @param v       invoice values (invoice-generator form)
 * @param format  'zugferd' | 'xrechnung'
 */
export function buildCii(v, format) {
  const missing = eChecks(v, format);
  if (missing.length) {
    const e = new Error('missing'); e.userMessage = { de: `Für die E-Rechnung fehlt noch: ${missing.map(m => m.de).join('; ')}.`, en: `The e-invoice still needs: ${missing.map(m => m.en).join('; ')}.` }; e.missing = missing;
    throw e;
  }
  const t = computeTotals(v);
  const cur = v.lang === 'de' ? 'EUR' : (v.currency || 'EUR');
  const lines = t.lines.filter(l => l.ok);
  const date = /^\d{4}-\d{2}-\d{2}$/.test(v.date || '') ? v.date : isoDate();
  const due = addDays(date, +v.terms || 0);
  const s = splitCity(v.sCity), b = splitCity(v.rCity);
  const sc = countryCode(v.sCountry), bc = countryCode(v.rCountry);
  const iban = cleanIban(v.iban);
  const X = [];
  const o = s2 => X.push(s2);

  o('<?xml version="1.0" encoding="UTF-8"?>');
  o('<rsm:CrossIndustryInvoice xmlns:rsm="urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100" xmlns:ram="urn:un:unece:uncefact:data:standard:ReusableAggregateBusinessInformationEntity:100" xmlns:qdt="urn:un:unece:uncefact:data:standard:QualifiedDataType:100" xmlns:udt="urn:un:unece:uncefact:data:standard:UnqualifiedDataType:100">');
  o('<rsm:ExchangedDocumentContext>');
  if (format === 'xrechnung') o('<ram:BusinessProcessSpecifiedDocumentContextParameter><ram:ID>urn:fdc:peppol.eu:2017:poacc:billing:01:1.0</ram:ID></ram:BusinessProcessSpecifiedDocumentContextParameter>');
  o(`<ram:GuidelineSpecifiedDocumentContextParameter><ram:ID>${GUIDELINE[format]}</ram:ID></ram:GuidelineSpecifiedDocumentContextParameter>`);
  o('</rsm:ExchangedDocumentContext>');

  o('<rsm:ExchangedDocument>');
  o(`<ram:ID>${esc(String(v.number).trim())}</ram:ID><ram:TypeCode>380</ram:TypeCode>`);
  o(`<ram:IssueDateTime><udt:DateTimeString format="102">${d102(date)}</udt:DateTimeString></ram:IssueDateTime>`);
  for (const n of [v.intro, v.closing]) if (has(n)) o(`<ram:IncludedNote><ram:Content>${esc(String(n).trim())}</ram:Content></ram:IncludedNote>`);
  o('</rsm:ExchangedDocument>');

  o('<rsm:SupplyChainTradeTransaction>');
  lines.forEach((l, i) => {
    const text = String(l.desc).trim();
    const [first, ...rest] = text.split(/\r?\n/);
    const cat = catOf(v, l.rate);
    o('<ram:IncludedSupplyChainTradeLineItem>');
    o(`<ram:AssociatedDocumentLineDocument><ram:LineID>${i + 1}</ram:LineID></ram:AssociatedDocumentLineDocument>`);
    o(`<ram:SpecifiedTradeProduct><ram:Name>${esc(first.trim() || text)}</ram:Name>${rest.join(' ').trim() ? `<ram:Description>${esc(rest.join('\n').trim())}</ram:Description>` : ''}</ram:SpecifiedTradeProduct>`);
    o(`<ram:SpecifiedLineTradeAgreement><ram:NetPriceProductTradePrice><ram:ChargeAmount>${num(l.priceN, 4)}</ram:ChargeAmount></ram:NetPriceProductTradePrice></ram:SpecifiedLineTradeAgreement>`);
    o(`<ram:SpecifiedLineTradeDelivery><ram:BilledQuantity unitCode="${unitCode(l.unit)}">${num(l.qtyN, 4)}</ram:BilledQuantity></ram:SpecifiedLineTradeDelivery>`);
    o(`<ram:SpecifiedLineTradeSettlement><ram:ApplicableTradeTax><ram:TypeCode>VAT</ram:TypeCode><ram:CategoryCode>${cat}</ram:CategoryCode><ram:RateApplicablePercent>${rateStr(l.rate)}</ram:RateApplicablePercent></ram:ApplicableTradeTax>`);
    o(`<ram:SpecifiedTradeSettlementLineMonetarySummation><ram:LineTotalAmount>${amt(l.cents)}</ram:LineTotalAmount></ram:SpecifiedTradeSettlementLineMonetarySummation></ram:SpecifiedLineTradeSettlement>`);
    o('</ram:IncludedSupplyChainTradeLineItem>');
  });

  // ---- agreement: buyer reference, seller, buyer
  o('<ram:ApplicableHeaderTradeAgreement>');
  if (has(v.buyerRef)) o(`<ram:BuyerReference>${esc(String(v.buyerRef).trim())}</ram:BuyerReference>`);
  o('<ram:SellerTradeParty>');
  // BR-CO-26: without a VAT ID the seller needs another identifier – small businesses usually only have the tax number
  if (!has(v.vatId) && has(v.taxNo)) o(`<ram:ID>${esc(String(v.taxNo).trim())}</ram:ID>`);
  o(`<ram:Name>${esc(String(v.sName).trim())}</ram:Name>`);
  if (has(v.sPhone) || has(v.sMail) || format === 'xrechnung') {
    o('<ram:DefinedTradeContact>');
    o(`<ram:PersonName>${esc(String(v.sContact || v.sName).trim())}</ram:PersonName>`);
    if (has(v.sPhone)) o(`<ram:TelephoneUniversalCommunication><ram:CompleteNumber>${esc(String(v.sPhone).trim())}</ram:CompleteNumber></ram:TelephoneUniversalCommunication>`);
    if (has(v.sMail)) o(`<ram:EmailURIUniversalCommunication><ram:URIID>${esc(String(v.sMail).trim())}</ram:URIID></ram:EmailURIUniversalCommunication>`);
    o('</ram:DefinedTradeContact>');
  }
  o(`<ram:PostalTradeAddress><ram:PostcodeCode>${esc(s.zip)}</ram:PostcodeCode><ram:LineOne>${esc(String(v.sStreet).trim())}</ram:LineOne><ram:CityName>${esc(s.city)}</ram:CityName><ram:CountryID>${sc}</ram:CountryID></ram:PostalTradeAddress>`);
  if (has(v.sMail)) o(`<ram:URIUniversalCommunication><ram:URIID schemeID="EM">${esc(String(v.sMail).trim())}</ram:URIID></ram:URIUniversalCommunication>`);
  if (has(v.taxNo)) o(`<ram:SpecifiedTaxRegistration><ram:ID schemeID="FC">${esc(String(v.taxNo).trim())}</ram:ID></ram:SpecifiedTaxRegistration>`);
  if (has(v.vatId)) o(`<ram:SpecifiedTaxRegistration><ram:ID schemeID="VA">${esc(String(v.vatId).replace(/\s+/g, '').toUpperCase())}</ram:ID></ram:SpecifiedTaxRegistration>`);
  o('</ram:SellerTradeParty>');
  o('<ram:BuyerTradeParty>');
  if (has(v.customerNo)) o(`<ram:ID>${esc(String(v.customerNo).trim())}</ram:ID>`);
  o(`<ram:Name>${esc(String(v.rName).trim())}</ram:Name>`);
  if (has(v.rAttn)) o(`<ram:DefinedTradeContact><ram:PersonName>${esc(String(v.rAttn).trim())}</ram:PersonName></ram:DefinedTradeContact>`);
  o(`<ram:PostalTradeAddress>${b.zip ? `<ram:PostcodeCode>${esc(b.zip)}</ram:PostcodeCode>` : ''}${has(v.rStreet) ? `<ram:LineOne>${esc(String(v.rStreet).trim())}</ram:LineOne>` : ''}<ram:CityName>${esc(b.city)}</ram:CityName><ram:CountryID>${bc}</ram:CountryID></ram:PostalTradeAddress>`);
  if (has(v.rMail)) o(`<ram:URIUniversalCommunication><ram:URIID schemeID="EM">${esc(String(v.rMail).trim())}</ram:URIID></ram:URIUniversalCommunication>`);
  if (has(v.rVatId)) o(`<ram:SpecifiedTaxRegistration><ram:ID schemeID="VA">${esc(String(v.rVatId).replace(/\s+/g, '').toUpperCase())}</ram:ID></ram:SpecifiedTaxRegistration>`);
  o('</ram:BuyerTradeParty>');
  o('</ram:ApplicableHeaderTradeAgreement>');

  // ---- delivery
  const cats = new Set(t.groups.map(g => catOf(v, g.rate)));
  o('<ram:ApplicableHeaderTradeDelivery>');
  if (cats.has('K')) o(`<ram:ShipToTradeParty><ram:Name>${esc(String(v.rName).trim())}</ram:Name><ram:PostalTradeAddress>${b.zip ? `<ram:PostcodeCode>${esc(b.zip)}</ram:PostcodeCode>` : ''}${has(v.rStreet) ? `<ram:LineOne>${esc(String(v.rStreet).trim())}</ram:LineOne>` : ''}<ram:CityName>${esc(b.city)}</ram:CityName><ram:CountryID>${bc}</ram:CountryID></ram:PostalTradeAddress></ram:ShipToTradeParty>`);
  const deliv = v.serviceMode === 'same' ? date : v.serviceMode === 'date' && /^\d{4}-\d{2}-\d{2}$/.test(v.serviceDate || '') ? v.serviceDate : '';
  if (deliv) o(`<ram:ActualDeliverySupplyChainEvent><ram:OccurrenceDateTime><udt:DateTimeString format="102">${d102(deliv)}</udt:DateTimeString></ram:OccurrenceDateTime></ram:ActualDeliverySupplyChainEvent>`);
  o('</ram:ApplicableHeaderTradeDelivery>');

  // ---- settlement
  o('<ram:ApplicableHeaderTradeSettlement>');
  o(`<ram:PaymentReference>${esc(String(v.number).trim())}</ram:PaymentReference>`);
  o(`<ram:InvoiceCurrencyCode>${cur}</ram:InvoiceCurrencyCode>`);
  o('<ram:SpecifiedTradeSettlementPaymentMeans><ram:TypeCode>58</ram:TypeCode>');
  o(`<ram:PayeePartyCreditorFinancialAccount><ram:IBANID>${iban}</ram:IBANID>${has(v.bankHolder) ? `<ram:AccountName>${esc(String(v.bankHolder).trim())}</ram:AccountName>` : ''}</ram:PayeePartyCreditorFinancialAccount>`);
  if (has(v.bic)) o(`<ram:PayeeSpecifiedCreditorFinancialInstitution><ram:BICID>${esc(String(v.bic).replace(/\s+/g, '').toUpperCase())}</ram:BICID></ram:PayeeSpecifiedCreditorFinancialInstitution>`);
  o('</ram:SpecifiedTradeSettlementPaymentMeans>');
  for (const g of t.groups) {
    const cat = catOf(v, g.rate);
    const reason = exemptionReason(v, cat);
    o(`<ram:ApplicableTradeTax><ram:CalculatedAmount>${amt(g.tax)}</ram:CalculatedAmount><ram:TypeCode>VAT</ram:TypeCode>${reason ? `<ram:ExemptionReason>${esc(reason)}</ram:ExemptionReason>` : ''}<ram:BasisAmount>${amt(g.net)}</ram:BasisAmount><ram:CategoryCode>${cat}</ram:CategoryCode><ram:RateApplicablePercent>${rateStr(g.rate)}</ram:RateApplicablePercent></ram:ApplicableTradeTax>`);
  }
  if (v.serviceMode === 'period' && /^\d{4}-\d{2}-\d{2}$/.test(v.from || '') && /^\d{4}-\d{2}-\d{2}$/.test(v.to || '')) {
    o(`<ram:BillingSpecifiedPeriod><ram:StartDateTime><udt:DateTimeString format="102">${d102(v.from)}</udt:DateTimeString></ram:StartDateTime><ram:EndDateTime><udt:DateTimeString format="102">${d102(v.to)}</udt:DateTimeString></ram:EndDateTime></ram:BillingSpecifiedPeriod>`);
  }
  if (t.discountPct > 0) {
    for (const g of t.groups) {
      const a = g.sum - g.net;
      if (a <= 0) continue;
      o(`<ram:SpecifiedTradeAllowanceCharge><ram:ChargeIndicator><udt:Indicator>false</udt:Indicator></ram:ChargeIndicator><ram:CalculationPercent>${num(t.discountPct, 2)}</ram:CalculationPercent><ram:BasisAmount>${amt(g.sum)}</ram:BasisAmount><ram:ActualAmount>${amt(a)}</ram:ActualAmount><ram:Reason>Rabatt ${num(t.discountPct, 2).replace('.', ',')} %</ram:Reason><ram:CategoryTradeTax><ram:TypeCode>VAT</ram:TypeCode><ram:CategoryCode>${catOf(v, g.rate)}</ram:CategoryCode><ram:RateApplicablePercent>${rateStr(g.rate)}</ram:RateApplicablePercent></ram:CategoryTradeTax></ram:SpecifiedTradeAllowanceCharge>`);
    }
  }
  const terms = paymentText(v, v.lang === 'de' ? 'de' : 'en', t) || (v.lang === 'de' ? 'Zahlbar ohne Abzug.' : 'Payable without deduction.');
  o(`<ram:SpecifiedTradePaymentTerms><ram:Description>${esc(terms)}</ram:Description><ram:DueDateDateTime><udt:DateTimeString format="102">${d102(due)}</udt:DateTimeString></ram:DueDateDateTime></ram:SpecifiedTradePaymentTerms>`);
  o('<ram:SpecifiedTradeSettlementHeaderMonetarySummation>');
  o(`<ram:LineTotalAmount>${amt(t.subtotal)}</ram:LineTotalAmount>`);
  if (t.discount > 0) { o('<ram:ChargeTotalAmount>0.00</ram:ChargeTotalAmount>'); o(`<ram:AllowanceTotalAmount>${amt(t.discount)}</ram:AllowanceTotalAmount>`); }
  o(`<ram:TaxBasisTotalAmount>${amt(t.net)}</ram:TaxBasisTotalAmount>`);
  o(`<ram:TaxTotalAmount currencyID="${cur}">${amt(t.tax)}</ram:TaxTotalAmount>`);
  o(`<ram:GrandTotalAmount>${amt(t.gross)}</ram:GrandTotalAmount>`);
  o(`<ram:DuePayableAmount>${amt(t.gross)}</ram:DuePayableAmount>`);
  o('</ram:SpecifiedTradeSettlementHeaderMonetarySummation>');
  o('</ram:ApplicableHeaderTradeSettlement>');
  o('</rsm:SupplyChainTradeTransaction>');
  o('</rsm:CrossIndustryInvoice>');
  return X.join('\n') + '\n';
}

// ---------------------------------------------------------------- PDF/A-3b + ZUGFeRD attachment
// sRGB v2 "micro" ICC profile (456 bytes, CC0, github.com/saucecontrol/Compact-ICC-Profiles) for the output intent.
const SRGB_ICC = 'AAAByGxjbXMCEAAAbW50clJHQiBYWVogB+IAAwAUAAkADgAdYWNzcE1TRlQAAAAAc2F3c2N0cmwAAAAAAAAAAAAAAAAAAPbWAAEAAAAA0y1oYW5knZEAPUCAsD1AdCyBnqUijgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAJZGVzYwAAAPAAAABfY3BydAAAAQwAAAAMd3RwdAAAARgAAAAUclhZWgAAASwAAAAUZ1hZWgAAAUAAAAAUYlhZWgAAAVQAAAAUclRSQwAAAWgAAABgZ1RSQwAAAWgAAABgYlRSQwAAAWgAAABgZGVzYwAAAAAAAAAFdVJHQgAAAAAAAAAAAAAAAHRleHQAAAAAQ0MwAFhZWiAAAAAAAADzVAABAAAAARbJWFlaIAAAAAAAAG+gAAA48gAAA49YWVogAAAAAAAAYpYAALeJAAAY2lhZWiAAAAAAAAAkoAAAD4UAALbEY3VydgAAAAAAAAAqAAAAfAD4AZwCdQODBMkGTggSChgMYg70Ec8U9hhqHC4gQySsKWoufjPrObM/1kZXTTZUdlwXZB1shnVWfo2ILJI2nKunjLLbvpnKx9dl5Hfx+f//';

const xmlEsc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const isoW3C = d => d.toISOString().replace(/\.\d{3}Z$/, 'Z');

function xmp({ title, author, producer, creator, created, modified, conformance }) {
  return `<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/">
 <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
  <rdf:Description rdf:about="" xmlns:pdfaid="http://www.aiim.org/pdfa/ns/id/">
   <pdfaid:part>3</pdfaid:part>
   <pdfaid:conformance>B</pdfaid:conformance>
  </rdf:Description>
  <rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/">
   <dc:format>application/pdf</dc:format>
   <dc:title><rdf:Alt><rdf:li xml:lang="x-default">${xmlEsc(title)}</rdf:li></rdf:Alt></dc:title>
   ${author ? `<dc:creator><rdf:Seq><rdf:li>${xmlEsc(author)}</rdf:li></rdf:Seq></dc:creator>` : ''}
  </rdf:Description>
  <rdf:Description rdf:about="" xmlns:pdf="http://ns.adobe.com/pdf/1.3/">
   <pdf:Producer>${xmlEsc(producer)}</pdf:Producer>
  </rdf:Description>
  <rdf:Description rdf:about="" xmlns:xmp="http://ns.adobe.com/xap/1.0/">
   <xmp:CreatorTool>${xmlEsc(creator)}</xmp:CreatorTool>
   <xmp:CreateDate>${isoW3C(created)}</xmp:CreateDate>
   <xmp:ModifyDate>${isoW3C(modified)}</xmp:ModifyDate>
  </rdf:Description>
  <rdf:Description rdf:about="" xmlns:fx="urn:factur-x:pdfa:CrossIndustryDocument:invoice:1p0#">
   <fx:DocumentType>INVOICE</fx:DocumentType>
   <fx:DocumentFileName>${XML_NAME}</fx:DocumentFileName>
   <fx:Version>1.0</fx:Version>
   <fx:ConformanceLevel>${conformance}</fx:ConformanceLevel>
  </rdf:Description>
  <rdf:Description rdf:about="" xmlns:pdfaExtension="http://www.aiim.org/pdfa/ns/extension/" xmlns:pdfaSchema="http://www.aiim.org/pdfa/ns/schema#" xmlns:pdfaProperty="http://www.aiim.org/pdfa/ns/property#">
   <pdfaExtension:schemas>
    <rdf:Bag>
     <rdf:li rdf:parseType="Resource">
      <pdfaSchema:schema>Factur-X PDFA Extension Schema</pdfaSchema:schema>
      <pdfaSchema:namespaceURI>urn:factur-x:pdfa:CrossIndustryDocument:invoice:1p0#</pdfaSchema:namespaceURI>
      <pdfaSchema:prefix>fx</pdfaSchema:prefix>
      <pdfaSchema:property>
       <rdf:Seq>
        <rdf:li rdf:parseType="Resource"><pdfaProperty:name>DocumentFileName</pdfaProperty:name><pdfaProperty:valueType>Text</pdfaProperty:valueType><pdfaProperty:category>external</pdfaProperty:category><pdfaProperty:description>name of the embedded XML invoice file</pdfaProperty:description></rdf:li>
        <rdf:li rdf:parseType="Resource"><pdfaProperty:name>DocumentType</pdfaProperty:name><pdfaProperty:valueType>Text</pdfaProperty:valueType><pdfaProperty:category>external</pdfaProperty:category><pdfaProperty:description>INVOICE</pdfaProperty:description></rdf:li>
        <rdf:li rdf:parseType="Resource"><pdfaProperty:name>Version</pdfaProperty:name><pdfaProperty:valueType>Text</pdfaProperty:valueType><pdfaProperty:category>external</pdfaProperty:category><pdfaProperty:description>The actual version of the Factur-X XML schema</pdfaProperty:description></rdf:li>
        <rdf:li rdf:parseType="Resource"><pdfaProperty:name>ConformanceLevel</pdfaProperty:name><pdfaProperty:valueType>Text</pdfaProperty:valueType><pdfaProperty:category>external</pdfaProperty:category><pdfaProperty:description>The conformance level of the embedded Factur-X data</pdfaProperty:description></rdf:li>
       </rdf:Seq>
      </pdfaSchema:property>
     </rdf:li>
    </rdf:Bag>
   </pdfaExtension:schemas>
  </rdf:Description>
 </rdf:RDF>
</x:xmpmeta>
<?xpacket end="w"?>`;
}

/**
 * Turn a pdf-lib document into PDF/A-3b with the ZUGFeRD/Factur-X XML attached and save it.
 * Fonts must already be embedded (the invoice writer uses the Unicode font for PDF/A).
 */
export async function pdfaFinish(doc, PDFLib, { xml, title, author = '', conformance = 'EN 16931' }) {
  const { PDFName, PDFHexString, PDFString, AFRelationship } = PDFLib;
  const ctx = doc.context;
  const now = new Date();
  now.setMilliseconds(0);
  const producer = 'FaLe Werkzeuge (fale.network)', creator = 'FaLe Werkzeuge – Rechnung schreiben';
  doc.setTitle(title, { showInWindowTitleBar: true });
  if (author) doc.setAuthor(author);
  doc.setProducer(producer);
  doc.setCreator(creator);
  doc.setCreationDate(now);
  doc.setModificationDate(now);

  // XMP metadata (uncompressed, as PDF/A requires readable packets)
  const meta = ctx.stream(new TextEncoder().encode(xmp({ title, author, producer, creator, created: now, modified: now, conformance })), { Type: 'Metadata', Subtype: 'XML' });
  doc.catalog.set(PDFName.of('Metadata'), ctx.register(meta));

  // output intent with an sRGB profile
  const icc = Uint8Array.from(atob(SRGB_ICC), c => c.charCodeAt(0));
  const iccRef = ctx.register(ctx.flateStream(icc, { N: 3 }));
  const intent = ctx.obj({ Type: 'OutputIntent', S: 'GTS_PDFA1', OutputConditionIdentifier: PDFString.of('sRGB IEC61966-2.1'), Info: PDFString.of('sRGB IEC61966-2.1'), DestOutputProfile: iccRef });
  doc.catalog.set(PDFName.of('OutputIntents'), ctx.obj([ctx.register(intent)]));

  // the invoice XML as associated file (Alternative = the XML is an equivalent of the visible invoice)
  await doc.attach(new TextEncoder().encode(xml), XML_NAME, {
    mimeType: 'text/xml', description: 'Factur-X/ZUGFeRD-Rechnung', creationDate: now, modificationDate: now, afRelationship: AFRelationship.Alternative,
  });

  // trailer file identifier (required by PDF/A)
  const idBytes = crypto.getRandomValues(new Uint8Array(16));
  const hex = [...idBytes].map(x => x.toString(16).padStart(2, '0')).join('');
  ctx.trailerInfo.ID = ctx.obj([PDFHexString.of(hex), PDFHexString.of(hex)]);

  return doc.save({ useObjectStreams: false, addDefaultPage: false, updateFieldAppearances: false });
}
void parseNum;
