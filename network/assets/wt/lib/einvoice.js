// E-Rechnung lesen: XRechnung / EN 16931 in both syntaxes – UBL 2.1 (Invoice, CreditNote) and UN/CEFACT CII
// (CrossIndustryInvoice, also the XML inside ZUGFeRD 2.x / Factur-X PDFs) – into one plain model, plus a
// plausibility check of the sums. Pure DOM (Trusted-Types-safe XML parser), no network; values are shown as written in the XML,
// never recomputed. Field numbers (BT-…) follow EN 16931.
import { parseXmlString } from './conv-domparse.js'; // DOMParser is blocked by Trusted Types on the tool pages

// ---------------------------------------------------------------- code lists (the common codes)
export const UNITS = {
  C62: ['Stück', 'pcs'], H87: ['Stück', 'pcs'], EA: ['Stück', 'each'], XPP: ['Stück', 'piece'], NAR: ['Anzahl', 'number'],
  HUR: ['Std.', 'hrs'], MIN: ['Min.', 'min'], SEC: ['Sek.', 'sec'], DAY: ['Tag', 'day'], WEE: ['Woche', 'week'], MON: ['Monat', 'month'], ANN: ['Jahr', 'year'],
  KGM: ['kg', 'kg'], GRM: ['g', 'g'], TNE: ['t', 't'], MTR: ['m', 'm'], CMT: ['cm', 'cm'], MMT: ['mm', 'mm'], KMT: ['km', 'km'],
  MTK: ['m²', 'm²'], MTQ: ['m³', 'm³'], LTR: ['l', 'l'], MLT: ['ml', 'ml'], KWH: ['kWh', 'kWh'], KWT: ['kW', 'kW'],
  LS: ['pauschal', 'lump sum'], SET: ['Satz', 'set'], PR: ['Paar', 'pair'], XPK: ['Packung', 'pack'], XBX: ['Karton', 'box'], XRO: ['Rolle', 'roll'],
  P1: ['%', '%'], E48: ['Leistung', 'service'], XSA: ['Sack', 'sack'], XPA: ['Paket', 'packet'],
};
export const PAYMENT_MEANS = {
  1: ['nicht festgelegt', 'not defined'], 10: ['Barzahlung', 'cash'], 20: ['Scheck', 'cheque'], 30: ['Überweisung', 'credit transfer'],
  31: ['Überweisung', 'debit transfer'], 42: ['Zahlung auf Bankkonto', 'payment to bank account'], 48: ['Kartenzahlung', 'bank card'],
  49: ['Lastschrift', 'direct debit'], 54: ['Kreditkarte', 'credit card'], 55: ['Debitkarte', 'debit card'], 57: ['Dauerauftrag', 'standing order'],
  58: ['SEPA-Überweisung', 'SEPA credit transfer'], 59: ['SEPA-Lastschrift', 'SEPA direct debit'], 68: ['Online-Zahlung', 'online payment'],
  97: ['Verrechnung', 'clearing between partners'], ZZZ: ['individuell vereinbart', 'mutually defined'],
};
export const DOC_TYPES = {
  326: ['Teilrechnung', 'Partial invoice'], 380: ['Rechnung', 'Invoice'], 381: ['Gutschrift', 'Credit note'], 383: ['Belastungsanzeige', 'Debit note'],
  384: ['Korrekturrechnung', 'Corrected invoice'], 386: ['Vorauszahlungsrechnung', 'Prepayment invoice'], 389: ['Gutschrift (vom Kunden ausgestellt)', 'Self-billed invoice'],
  875: ['Teilschlussrechnung', 'Partial construction invoice'], 876: ['Teilschlussrechnung', 'Partial final construction invoice'], 877: ['Schlussrechnung', 'Final construction invoice'],
};
export const VAT_CATS = {
  S: ['Normalsatz', 'standard rate'], Z: ['Nullsatz', 'zero rated'], E: ['steuerbefreit', 'exempt'], AE: ['Steuerschuldnerschaft des Leistungsempfängers', 'reverse charge'],
  K: ['innergemeinschaftliche Lieferung', 'intra-community supply'], G: ['Ausfuhr', 'export outside the EU'], O: ['nicht steuerbar', 'not subject to VAT'],
  L: ['IGIC (Kanaren)', 'IGIC (Canary Islands)'], M: ['IPSI (Ceuta/Melilla)', 'IPSI (Ceuta/Melilla)'],
};
const DIRECT_DEBIT = new Set(['49', '59']);
export const isDirectDebit = code => DIRECT_DEBIT.has(String(code || ''));
export const label = (map, code, lang) => { const v = map[String(code ?? '').trim()]; return v ? v[lang === 'de' ? 0 : 1] : String(code ?? ''); };

// ---------------------------------------------------------------- errors
export class EInvoiceError extends Error {
  constructor(de, en) { super(en); this.userMessage = { de, en }; }
}

// ---------------------------------------------------------------- XML helpers (namespace-agnostic, by local name)
const kids = (el, name) => (el ? [...el.children].filter(c => c.localName === name) : []);
const child = (el, ...path) => path.reduce((e, n) => (e ? kids(e, n)[0] || null : null), el);
const all = (el, ...path) => {
  if (!el || !path.length) return [];
  const last = path[path.length - 1];
  const parent = path.length > 1 ? child(el, ...path.slice(0, -1)) : el;
  return kids(parent, last);
};
const txt = (el, ...path) => { const e = path.length ? child(el, ...path) : el; return e ? e.textContent.replace(/\s+/g, ' ').trim() : ''; };
const multiline = (el, ...path) => { const e = path.length ? child(el, ...path) : el; return e ? e.textContent.replace(/\r\n?/g, '\n').replace(/[ \t]+/g, ' ').trim() : ''; };
const amount = (el, ...path) => { const s = txt(el, ...path); if (!s) return null; const n = Number(s); return Number.isFinite(n) ? n : null; };
const attr = (el, name) => (el && el.getAttribute(name)) || '';
/** YYYY-MM-DD from UBL (ISO) or CII (format 102: YYYYMMDD). */
function isoDate(s) {
  s = String(s || '').trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = /^(\d{4})(\d{2})(\d{2})$/.exec(s);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : '';
}
const ciiDate = (el, ...path) => isoDate(txt(el, ...path, 'DateTimeString') || txt(el, ...path));

// ---------------------------------------------------------------- entry point
const MAX_XML = 20 * 1048576;

/** Parses XML text; returns the model or throws EInvoiceError. */
export function parseEInvoice(xmlText) {
  if (typeof xmlText !== 'string' || !xmlText.trim()) throw new EInvoiceError('Die Datei ist leer.', 'The file is empty.');
  if (xmlText.length > MAX_XML) throw new EInvoiceError('Die XML-Datei ist zu groß für eine Rechnung.', 'The XML file is too large for an invoice.');
  if (/<!DOCTYPE/i.test(xmlText.slice(0, 4096))) throw new EInvoiceError('Diese XML-Datei enthält eine DOCTYPE-Angabe und wird aus Sicherheitsgründen nicht gelesen.', 'This XML file contains a DOCTYPE declaration and is not read for security reasons.');
  const doc = parseXmlString(xmlText.replace(/^\uFEFF/, ''));
  if (doc.getElementsByTagName('parsererror').length) throw new EInvoiceError('Die XML-Datei ist beschädigt und lässt sich nicht lesen.', 'The XML file is damaged and cannot be read.');
  const root = doc.documentElement;
  let m;
  if (root.localName === 'Invoice' || root.localName === 'CreditNote') m = parseUbl(root);
  else if (root.localName === 'CrossIndustryInvoice') m = parseCii(root);
  else if (root.localName === 'CrossIndustryDocument') throw new EInvoiceError('Das ist eine ältere ZUGFeRD-1-Rechnung. Dieses Format wird hier nicht unterstützt – bitte den Absender um eine XRechnung oder ZUGFeRD 2.', 'This is an older ZUGFeRD 1 invoice. That format is not supported here – please ask the sender for an XRechnung or ZUGFeRD 2.');
  else throw new EInvoiceError('Das ist keine E-Rechnung. Erwartet wird eine XRechnung oder die XML aus einer ZUGFeRD-/Factur-X-Rechnung.', 'This is not an e-invoice. Expected an XRechnung or the XML from a ZUGFeRD/Factur-X invoice.');
  m.checks = checkInvoice(m);
  return m;
}

// ---------------------------------------------------------------- UBL 2.1
function ublParty(p) {
  if (!p) return null;
  const a = child(p, 'PostalAddress');
  const taxes = all(p, 'PartyTaxScheme').map(t => ({ id: txt(t, 'CompanyID'), scheme: txt(t, 'TaxScheme', 'ID') }));
  return {
    name: txt(p, 'PartyLegalEntity', 'RegistrationName') || txt(p, 'PartyName', 'Name'),
    tradingName: txt(p, 'PartyName', 'Name'),
    street: txt(a, 'StreetName'), street2: txt(a, 'AdditionalStreetName'), extra: txt(a, 'AddressLine', 'Line'),
    zip: txt(a, 'PostalZone'), city: txt(a, 'CityName'), region: txt(a, 'CountrySubentity'), country: txt(a, 'Country', 'IdentificationCode'),
    vatId: (taxes.find(t => /^vat$/i.test(t.scheme)) || {}).id || '',
    taxNo: (taxes.find(t => !/^vat$/i.test(t.scheme)) || {}).id || '',
    regId: txt(p, 'PartyLegalEntity', 'CompanyID'),
    legalInfo: txt(p, 'PartyLegalEntity', 'CompanyLegalForm'),
    contact: { name: txt(p, 'Contact', 'Name'), phone: txt(p, 'Contact', 'Telephone'), email: txt(p, 'Contact', 'ElectronicMail') },
    endpoint: txt(p, 'EndpointID'),
    id: txt(p, 'PartyIdentification', 'ID'),
  };
}

function parseUbl(root) {
  const credit = root.localName === 'CreditNote';
  const m = base('UBL', credit ? 'credit' : 'invoice');
  m.profile = txt(root, 'CustomizationID');
  m.typeCode = txt(root, credit ? 'CreditNoteTypeCode' : 'InvoiceTypeCode') || (credit ? '381' : '380');
  m.number = txt(root, 'ID');
  m.issueDate = isoDate(txt(root, 'IssueDate'));
  m.dueDate = isoDate(txt(root, 'DueDate')) || isoDate(txt(root, 'PaymentMeans', 'PaymentDueDate'));
  m.currency = txt(root, 'DocumentCurrencyCode') || 'EUR';
  m.taxCurrency = txt(root, 'TaxCurrencyCode');
  m.buyerRef = txt(root, 'BuyerReference');
  m.orderRef = txt(root, 'OrderReference', 'ID');
  m.contractRef = txt(root, 'ContractDocumentReference', 'ID');
  m.projectRef = txt(root, 'ProjectReference', 'ID');
  m.precedingRef = txt(root, 'BillingReference', 'InvoiceDocumentReference', 'ID');
  m.notes = all(root, 'Note').map(n => multiline(n)).filter(Boolean);
  m.period = { start: isoDate(txt(root, 'InvoicePeriod', 'StartDate')), end: isoDate(txt(root, 'InvoicePeriod', 'EndDate')) };
  m.deliveryDate = isoDate(txt(root, 'Delivery', 'ActualDeliveryDate'));
  m.seller = ublParty(child(root, 'AccountingSupplierParty', 'Party'));
  m.buyer = ublParty(child(root, 'AccountingCustomerParty', 'Party'));
  const payee = child(root, 'PayeeParty');
  if (payee) m.payee = { name: txt(payee, 'PartyName', 'Name') || txt(payee, 'PartyLegalEntity', 'RegistrationName') };
  const dl = child(root, 'Delivery', 'DeliveryLocation', 'Address');
  if (dl) m.delivery = { name: txt(root, 'Delivery', 'DeliveryParty', 'PartyName', 'Name'), street: txt(dl, 'StreetName'), zip: txt(dl, 'PostalZone'), city: txt(dl, 'CityName'), country: txt(dl, 'Country', 'IdentificationCode') };
  const pms = all(root, 'PaymentMeans');
  const pm = pms[0];
  m.payment = {
    meansCode: txt(pm, 'PaymentMeansCode'), meansText: attr(child(pm, 'PaymentMeansCode'), 'name'),
    reference: txt(pm, 'PaymentID'),
    iban: txt(pm, 'PayeeFinancialAccount', 'ID'), accountName: txt(pm, 'PayeeFinancialAccount', 'Name'), bic: txt(pm, 'PayeeFinancialAccount', 'FinancialInstitutionBranch', 'ID'),
    mandate: txt(pm, 'PaymentMandate', 'ID'), debitIban: txt(pm, 'PaymentMandate', 'PayerFinancialAccount', 'ID'),
    card: txt(pm, 'CardAccount', 'PrimaryAccountNumberID'),
    terms: all(root, 'PaymentTerms').map(t => multiline(t, 'Note')).filter(Boolean).join('\n'),
    creditorId: '',
  };
  for (const pid of all(child(root, 'AccountingSupplierParty', 'Party'), 'PartyIdentification')) {
    const id = child(pid, 'ID');
    if (id && /^SEPA$/i.test(attr(id, 'schemeID'))) m.payment.creditorId = txt(id);
  }
  m.allowances = all(root, 'AllowanceCharge').map(ac => ({
    charge: txt(ac, 'ChargeIndicator') === 'true', amount: amount(ac, 'Amount'), reason: txt(ac, 'AllowanceChargeReason') || txt(ac, 'AllowanceChargeReasonCode'),
    vatRate: amount(ac, 'TaxCategory', 'Percent'), vatCat: txt(ac, 'TaxCategory', 'ID'),
  }));
  const taxTotals = all(root, 'TaxTotal');
  const mainTax = taxTotals.find(t => attr(child(t, 'TaxAmount'), 'currencyID') === m.currency) || taxTotals[0];
  m.taxes = all(mainTax, 'TaxSubtotal').map(s => ({
    base: amount(s, 'TaxableAmount'), amount: amount(s, 'TaxAmount'), cat: txt(s, 'TaxCategory', 'ID'), rate: amount(s, 'TaxCategory', 'Percent'),
    reason: txt(s, 'TaxCategory', 'TaxExemptionReason') || txt(s, 'TaxCategory', 'TaxExemptionReasonCode'),
  }));
  const T = child(root, 'LegalMonetaryTotal');
  m.totals = {
    lines: amount(T, 'LineExtensionAmount'), net: amount(T, 'TaxExclusiveAmount'), gross: amount(T, 'TaxInclusiveAmount'),
    allowances: amount(T, 'AllowanceTotalAmount'), charges: amount(T, 'ChargeTotalAmount'), prepaid: amount(T, 'PrepaidAmount'),
    rounding: amount(T, 'PayableRoundingAmount'), payable: amount(T, 'PayableAmount'), tax: amount(mainTax, 'TaxAmount'),
  };
  // XRechnung extension (BG-DEX-09): amounts collected for third parties are added to the amount due
  m.thirdParty = all(root, 'PrepaidPayment').map(pp => ({ amount: amount(pp, 'PaidAmount'), text: txt(pp, 'InstructionID') || txt(pp, 'ID') })).filter(x => x.amount != null);
  m.lines = all(root, credit ? 'CreditNoteLine' : 'InvoiceLine').map(l => {
    const q = child(l, credit ? 'CreditedQuantity' : 'InvoicedQuantity');
    return {
      id: txt(l, 'ID'), name: txt(l, 'Item', 'Name'), desc: multiline(l, 'Item', 'Description'), note: multiline(l, 'Note'),
      qty: amount(q), unitCode: attr(q, 'unitCode'), price: amount(l, 'Price', 'PriceAmount'), baseQty: amount(l, 'Price', 'BaseQuantity'),
      net: amount(l, 'LineExtensionAmount'), vatRate: amount(l, 'Item', 'ClassifiedTaxCategory', 'Percent'), vatCat: txt(l, 'Item', 'ClassifiedTaxCategory', 'ID'),
      sellerId: txt(l, 'Item', 'SellersItemIdentification', 'ID'),
      period: { start: isoDate(txt(l, 'InvoicePeriod', 'StartDate')), end: isoDate(txt(l, 'InvoicePeriod', 'EndDate')) },
    };
  });
  m.attachments = all(root, 'AdditionalDocumentReference').map(r => {
    const bin = child(r, 'Attachment', 'EmbeddedDocumentBinaryObject');
    return { id: txt(r, 'ID'), desc: txt(r, 'DocumentDescription'), name: attr(bin, 'filename'), mime: attr(bin, 'mimeCode'), data: bin ? bin.textContent : '', uri: txt(r, 'Attachment', 'ExternalReference', 'URI') };
  }).filter(a => a.data || a.uri);
  return m;
}

// ---------------------------------------------------------------- UN/CEFACT CII (ZUGFeRD 2.x / Factur-X / XRechnung CII)
function ciiParty(p) {
  if (!p) return null;
  const a = child(p, 'PostalTradeAddress');
  const regs = all(p, 'SpecifiedTaxRegistration').map(r => ({ id: txt(r, 'ID'), scheme: attr(child(r, 'ID'), 'schemeID') }));
  return {
    name: txt(p, 'Name'), tradingName: txt(p, 'SpecifiedLegalOrganization', 'TradingBusinessName'),
    street: txt(a, 'LineOne'), street2: txt(a, 'LineTwo'), extra: txt(a, 'LineThree'),
    zip: txt(a, 'PostcodeCode'), city: txt(a, 'CityName'), region: txt(a, 'CountrySubDivisionName'), country: txt(a, 'CountryID'),
    vatId: (regs.find(r => r.scheme === 'VA') || {}).id || '', taxNo: (regs.find(r => r.scheme === 'FC') || {}).id || '',
    regId: txt(p, 'SpecifiedLegalOrganization', 'ID'), legalInfo: txt(p, 'Description'),
    contact: { name: txt(p, 'DefinedTradeContact', 'PersonName'), phone: txt(p, 'DefinedTradeContact', 'TelephoneUniversalCommunication', 'CompleteNumber'), email: txt(p, 'DefinedTradeContact', 'EmailURIUniversalCommunication', 'URIID') },
    endpoint: txt(p, 'URIUniversalCommunication', 'URIID'),
    id: txt(p, 'ID') || txt(p, 'GlobalID'),
  };
}

function parseCii(root) {
  const m = base('CII', 'invoice');
  const ctx = child(root, 'ExchangedDocumentContext');
  m.profile = txt(ctx, 'GuidelineSpecifiedDocumentContextParameter', 'ID');
  const ed = child(root, 'ExchangedDocument');
  m.number = txt(ed, 'ID');
  m.typeCode = txt(ed, 'TypeCode') || '380';
  if (m.typeCode === '381') m.kind = 'credit';
  m.issueDate = ciiDate(ed, 'IssueDateTime');
  m.notes = all(ed, 'IncludedNote').map(n => multiline(n, 'Content')).filter(Boolean);
  const tx = child(root, 'SupplyChainTradeTransaction');
  const ag = child(tx, 'ApplicableHeaderTradeAgreement');
  const dv = child(tx, 'ApplicableHeaderTradeDelivery');
  const st = child(tx, 'ApplicableHeaderTradeSettlement');
  m.buyerRef = txt(ag, 'BuyerReference');
  m.orderRef = txt(ag, 'BuyerOrderReferencedDocument', 'IssuerAssignedID');
  m.contractRef = txt(ag, 'ContractReferencedDocument', 'IssuerAssignedID');
  m.projectRef = txt(ag, 'SpecifiedProcuringProject', 'ID');
  m.precedingRef = txt(st, 'InvoiceReferencedDocument', 'IssuerAssignedID');
  m.seller = ciiParty(child(ag, 'SellerTradeParty'));
  m.buyer = ciiParty(child(ag, 'BuyerTradeParty'));
  const payee = child(st, 'PayeeTradeParty');
  if (payee) m.payee = { name: txt(payee, 'Name') };
  m.deliveryDate = ciiDate(dv, 'ActualDeliverySupplyChainEvent', 'OccurrenceDateTime');
  const ship = child(dv, 'ShipToTradeParty');
  if (ship) { const a = child(ship, 'PostalTradeAddress'); m.delivery = { name: txt(ship, 'Name'), street: txt(a, 'LineOne'), zip: txt(a, 'PostcodeCode'), city: txt(a, 'CityName'), country: txt(a, 'CountryID') }; }
  m.currency = txt(st, 'InvoiceCurrencyCode') || 'EUR';
  m.taxCurrency = txt(st, 'TaxCurrencyCode');
  m.period = { start: ciiDate(st, 'BillingSpecifiedPeriod', 'StartDateTime'), end: ciiDate(st, 'BillingSpecifiedPeriod', 'EndDateTime') };
  const pm = child(st, 'SpecifiedTradeSettlementPaymentMeans');
  const terms = all(st, 'SpecifiedTradePaymentTerms');
  m.payment = {
    meansCode: txt(pm, 'TypeCode'), meansText: txt(pm, 'Information'), reference: txt(st, 'PaymentReference'),
    iban: txt(pm, 'PayeePartyCreditorFinancialAccount', 'IBANID') || txt(pm, 'PayeePartyCreditorFinancialAccount', 'ProprietaryID'),
    accountName: txt(pm, 'PayeePartyCreditorFinancialAccount', 'AccountName'), bic: txt(pm, 'PayeeSpecifiedCreditorFinancialInstitution', 'BICID'),
    mandate: txt(terms[0], 'DirectDebitMandateID'), debitIban: txt(pm, 'PayerPartyDebtorFinancialAccount', 'IBANID'),
    card: txt(pm, 'ApplicableTradeSettlementFinancialCard', 'ID'),
    terms: terms.map(t => multiline(t, 'Description')).filter(Boolean).join('\n'), creditorId: txt(st, 'CreditorReferenceID'),
  };
  m.dueDate = terms.map(t => ciiDate(t, 'DueDateDateTime')).find(Boolean) || '';
  m.allowances = all(st, 'SpecifiedTradeAllowanceCharge').map(ac => ({
    charge: txt(ac, 'ChargeIndicator', 'Indicator') === 'true', amount: amount(ac, 'ActualAmount'), reason: txt(ac, 'Reason') || txt(ac, 'ReasonCode'),
    vatRate: amount(ac, 'CategoryTradeTax', 'RateApplicablePercent'), vatCat: txt(ac, 'CategoryTradeTax', 'CategoryCode'),
  }));
  m.taxes = all(st, 'ApplicableTradeTax').map(t => ({
    base: amount(t, 'BasisAmount'), amount: amount(t, 'CalculatedAmount'), cat: txt(t, 'CategoryCode'), rate: amount(t, 'RateApplicablePercent'),
    reason: txt(t, 'ExemptionReason') || txt(t, 'ExemptionReasonCode'),
  }));
  const S = child(st, 'SpecifiedTradeSettlementHeaderMonetarySummation');
  const taxTotal = all(S, 'TaxTotalAmount');
  const tt = taxTotal.find(t => attr(t, 'currencyID') === m.currency) || taxTotal[0];
  m.totals = {
    lines: amount(S, 'LineTotalAmount'), net: amount(S, 'TaxBasisTotalAmount'), gross: amount(S, 'GrandTotalAmount'),
    allowances: amount(S, 'AllowanceTotalAmount'), charges: amount(S, 'ChargeTotalAmount'), prepaid: amount(S, 'TotalPrepaidAmount'),
    rounding: amount(S, 'RoundingAmount'), payable: amount(S, 'DuePayableAmount'), tax: tt ? amount(tt) : null,
  };
  m.lines = all(tx, 'IncludedSupplyChainTradeLineItem').map(l => {
    const q = child(l, 'SpecifiedLineTradeDelivery', 'BilledQuantity');
    const sa = child(l, 'SpecifiedLineTradeSettlement');
    return {
      id: txt(l, 'AssociatedDocumentLineDocument', 'LineID'), name: txt(l, 'SpecifiedTradeProduct', 'Name'), desc: multiline(l, 'SpecifiedTradeProduct', 'Description'),
      note: multiline(l, 'AssociatedDocumentLineDocument', 'IncludedNote', 'Content'),
      qty: amount(q), unitCode: attr(q, 'unitCode'),
      price: amount(l, 'SpecifiedLineTradeAgreement', 'NetPriceProductTradePrice', 'ChargeAmount'), baseQty: amount(l, 'SpecifiedLineTradeAgreement', 'NetPriceProductTradePrice', 'BasisQuantity'),
      net: amount(sa, 'SpecifiedTradeSettlementLineMonetarySummation', 'LineTotalAmount'),
      vatRate: amount(sa, 'ApplicableTradeTax', 'RateApplicablePercent'), vatCat: txt(sa, 'ApplicableTradeTax', 'CategoryCode'),
      sellerId: txt(l, 'SpecifiedTradeProduct', 'SellerAssignedID'),
      period: { start: ciiDate(sa, 'BillingSpecifiedPeriod', 'StartDateTime'), end: ciiDate(sa, 'BillingSpecifiedPeriod', 'EndDateTime') },
    };
  });
  m.attachments = all(ag, 'AdditionalReferencedDocument').map(r => {
    const bin = child(r, 'AttachmentBinaryObject');
    return { id: txt(r, 'IssuerAssignedID'), desc: txt(r, 'Name'), name: attr(bin, 'filename'), mime: attr(bin, 'mimeCode'), data: bin ? bin.textContent : '', uri: txt(r, 'URIID') };
  }).filter(a => a.data || a.uri);
  return m;
}

function base(syntax, kind) {
  return { syntax, kind, profile: '', typeCode: '', number: '', issueDate: '', dueDate: '', currency: 'EUR', taxCurrency: '', buyerRef: '', orderRef: '', contractRef: '',
    projectRef: '', precedingRef: '', notes: [], period: { start: '', end: '' }, deliveryDate: '', seller: null, buyer: null, payee: null, delivery: null,
    payment: {}, allowances: [], taxes: [], totals: {}, lines: [], attachments: [], thirdParty: [] };
}

// ---------------------------------------------------------------- profile name
export function profileName(m) {
  const p = String(m.profile || '');
  const v = /xrechnung_(\d+\.\d+)/i.exec(p);
  if (/xrechnung/i.test(p)) return `XRechnung${v ? ' ' + v[1] : ''}${m.syntax === 'CII' ? ' (CII)' : ' (UBL)'}`;
  if (/factur-x\.eu:1p0:extended|zugferd.*extended/i.test(p)) return 'ZUGFeRD / Factur-X EXTENDED';
  if (/basicwl/i.test(p)) return 'ZUGFeRD / Factur-X BASIC WL';
  if (/:basic\b|factur-x\.eu:1p0:basic/i.test(p)) return 'ZUGFeRD / Factur-X BASIC';
  if (/minimum/i.test(p)) return 'ZUGFeRD / Factur-X MINIMUM';
  if (/peppol/i.test(p)) return 'Peppol BIS Billing 3.0';
  if (/en16931/i.test(p)) return m.syntax === 'CII' ? 'ZUGFeRD / Factur-X EN 16931' : 'EN 16931 (UBL)';
  return m.syntax === 'CII' ? 'E-Rechnung (CII)' : 'E-Rechnung (UBL)';
}

// ---------------------------------------------------------------- plausibility
export function ibanValid(s) {
  const iban = String(s || '').replace(/\s+/g, '').toUpperCase();
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(iban)) return false;
  const r = (iban.slice(4) + iban.slice(0, 4)).replace(/[A-Z]/g, c => String(c.charCodeAt(0) - 55));
  let mod = 0;
  for (const ch of r) mod = (mod * 10 + +ch) % 97;
  return mod === 1;
}
const close = (a, b, tol = 0.011) => a != null && b != null && Math.abs(a - b) <= tol;
const sum = arr => arr.reduce((s, x) => s + (x || 0), 0);

/** [{ok, de, en, level: 'ok'|'warn'|'info'}] – only checks that can be decided from the file. */
export function checkInvoice(m) {
  const out = [];
  const add = (ok, de, en, level = ok ? 'ok' : 'warn') => out.push({ ok, de, en, level });
  const T = m.totals || {};
  const n = m.lines.length;
  if (!n) add(false, 'Die Rechnung enthält keine Positionen.', 'The invoice contains no line items.');
  if (T.lines != null && n) {
    const s = sum(m.lines.map(l => l.net));
    add(close(s, T.lines, 0.011 * Math.max(1, n)), close(s, T.lines, 0.011 * Math.max(1, n)) ? 'Die Positionen ergeben die Nettosumme.' : `Die Positionen ergeben ${s.toFixed(2)}, in der Rechnung steht ${T.lines.toFixed(2)}.`,
      close(s, T.lines, 0.011 * Math.max(1, n)) ? 'The line items add up to the net total.' : `The line items add up to ${s.toFixed(2)}, the invoice says ${T.lines.toFixed(2)}.`);
  }
  if (T.lines != null && T.net != null) {
    const exp = T.lines - (T.allowances || 0) + (T.charges || 0);
    if (!close(exp, T.net)) add(false, `Nettosumme passt nicht zu Abzügen/Zuschlägen (${exp.toFixed(2)} statt ${T.net.toFixed(2)}).`, `Net total does not match allowances/charges (${exp.toFixed(2)} instead of ${T.net.toFixed(2)}).`);
  }
  if (T.net != null && T.gross != null) {
    const tax = T.tax != null ? T.tax : sum(m.taxes.map(t => t.amount));
    const ok = close(T.net + tax, T.gross);
    add(ok, ok ? 'Netto + Umsatzsteuer ergibt den Bruttobetrag.' : `Netto + Umsatzsteuer ergibt ${(T.net + tax).toFixed(2)}, in der Rechnung steht ${T.gross.toFixed(2)}.`,
      ok ? 'Net + VAT equals the gross amount.' : `Net + VAT is ${(T.net + tax).toFixed(2)}, the invoice says ${T.gross.toFixed(2)}.`);
  }
  if (m.taxes.length) {
    const bad = m.taxes.filter(t => t.base != null && t.rate != null && t.amount != null && !close(t.base * t.rate / 100, t.amount, 0.011));
    const ok = !bad.length;
    add(ok, ok ? 'Die Umsatzsteuer ist richtig berechnet.' : `Die Umsatzsteuer zu ${bad.map(t => t.rate + ' %').join(', ')} weicht von der Rechnung ab.`,
      ok ? 'VAT is calculated correctly.' : `VAT at ${bad.map(t => t.rate + ' %').join(', ')} differs from the invoice.`);
    if (T.tax != null && !close(sum(m.taxes.map(t => t.amount)), T.tax, 0.011 * m.taxes.length)) add(false, 'Die Steuerbeträge ergeben nicht die Steuersumme.', 'The VAT amounts do not add up to the VAT total.');
  }
  if (T.gross != null && T.payable != null) {
    const exp = T.gross - (T.prepaid || 0) + (T.rounding || 0) + sum((m.thirdParty || []).map(x => x.amount));
    if (!close(exp, T.payable)) add(false, `Zahlbetrag passt nicht (erwartet ${exp.toFixed(2)}, steht ${T.payable.toFixed(2)}).`, `Amount due does not match (expected ${exp.toFixed(2)}, says ${T.payable.toFixed(2)}).`);
  }
  if (m.payment.iban) {
    const ok = ibanValid(m.payment.iban);
    add(ok, ok ? 'Die IBAN hat eine gültige Prüfziffer.' : 'Die IBAN hat eine ungültige Prüfziffer – bitte beim Absender nachfragen, bevor du überweist.',
      ok ? 'The IBAN has a valid check digit.' : 'The IBAN has an invalid check digit – ask the sender before you pay.');
  }
  if (!m.number) add(false, 'Rechnungsnummer fehlt.', 'Invoice number is missing.');
  if (!m.issueDate) add(false, 'Rechnungsdatum fehlt.', 'Invoice date is missing.');
  if (m.seller && !m.seller.vatId && !m.seller.taxNo) add(false, 'Weder USt-IdNr. noch Steuernummer des Absenders angegeben.', 'Neither VAT ID nor tax number of the seller is given.', 'info');
  return out;
}

// ---------------------------------------------------------------- ZUGFeRD / Factur-X: XML inside a PDF
const XML_NAMES = /^(factur-x|zugferd-invoice|zugferd_invoice|xrechnung|order-x)\.xml$/i;
const INVOICE_ROOT = /<(\w+:)?(CrossIndustryInvoice|Invoice|CreditNote|CrossIndustryDocument)[\s>]/;
/**
 * The invoice XML embedded in a PDF (pdf.js document), or null. pdf.js ≥ 5 returns a Map of
 * {filename, description} and the bytes via getAttachmentContent(id); older versions an object with content.
 */
export async function xmlFromPdf(pdf) {
  const att = await pdf.getAttachments();
  const entries = att instanceof Map ? [...att.entries()] : Object.entries(att || {});
  const list = entries.map(([id, v]) => ({ id, filename: (v && v.filename) || id, content: v && v.content })).filter(a => /\.xml$/i.test(a.filename));
  const sorted = [...list.filter(a => XML_NAMES.test(a.filename)), ...list.filter(a => !XML_NAMES.test(a.filename))];
  const dec = new TextDecoder('utf-8');
  for (const a of sorted.slice(0, 10)) {
    let bytes = a.content;
    if (!bytes && typeof pdf.getAttachmentContent === 'function') { try { bytes = await pdf.getAttachmentContent(a.id); } catch { bytes = null; } }
    if (!bytes || bytes.length > MAX_XML) continue;
    const s = dec.decode(bytes);
    if (INVOICE_ROOT.test(s.slice(0, 200000).replace(/<!--[\s\S]*?-->/g, '').slice(0, 8192))) return s; // samples start with long licence comments
  }
  return null;
}

/** Decoded embedded attachments (base64 in the XML) – for downloading. */
export function decodeAttachments(m, max = 30 * 1048576) {
  const out = [];
  let total = 0;
  for (const a of m.attachments || []) {
    if (!a.data) continue;
    try {
      const bin = atob(a.data.replace(/\s+/g, ''));
      if (total + bin.length > max) break;
      total += bin.length;
      const u8 = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
      out.push({ name: a.name || `${a.id || 'Anhang'}${extFor(a.mime)}`, mime: a.mime || 'application/octet-stream', bytes: u8, desc: a.desc });
    } catch { /* broken base64 – skip */ }
  }
  return out;
}
function extFor(mime) {
  return { 'application/pdf': '.pdf', 'image/png': '.png', 'image/jpeg': '.jpg', 'text/csv': '.csv', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx', 'application/vnd.oasis.opendocument.spreadsheet': '.ods' }[mime] || '';
}
