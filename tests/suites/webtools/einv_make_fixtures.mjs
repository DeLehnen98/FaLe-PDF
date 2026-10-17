// E-invoice fixtures for test_einv.py (fixtures/einv/): XRechnung UBL (with an embedded PDF attachment and an
// allowance), XRechnung CII with SEPA direct debit, a UBL credit note, a ZUGFeRD/Factur-X PDF (CII XML attached
// as factur-x.xml), a UBL with wrong sums + invalid IBAN, an XML that is no invoice, an ordinary PDF and a
// ZUGFeRD 1 XML. All names, addresses and IBANs are invented / public test values.
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
const require = createRequire('/opt/npm-tools/node_modules/');
const { PDFDocument, StandardFonts, rgb, AFRelationship } = require('pdf-lib');
const OUT = new URL('./fixtures/einv/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

async function simplePdf(lines) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const p = doc.addPage([595.28, 841.89]);
  lines.forEach((t, i) => p.drawText(t, { x: 60, y: 760 - i * 22, size: i ? 12 : 20, font, color: rgb(0.1, 0.1, 0.2) }));
  return doc;
}

// ---------------------------------------------------------------- UBL
function ubl({ id = 'RE-2026-1042', iban = 'DE89370400440532013000', payable = '1525.29', line1 = '1020.00', attachment = '', credit = false } = {}) {
  const root = credit ? 'CreditNote' : 'Invoice';
  const lineTag = credit ? 'CreditNoteLine' : 'InvoiceLine';
  const qtyTag = credit ? 'CreditedQuantity' : 'InvoicedQuantity';
  const line = (n, qty, unit, name, desc, price, net, rate) => `
  <cac:${lineTag}><cbc:ID>${n}</cbc:ID><cbc:${qtyTag} unitCode="${unit}">${qty}</cbc:${qtyTag}><cbc:LineExtensionAmount currencyID="EUR">${net}</cbc:LineExtensionAmount>
    <cac:Item>${desc ? `<cbc:Description>${esc(desc)}</cbc:Description>` : ''}<cbc:Name>${esc(name)}</cbc:Name><cac:ClassifiedTaxCategory><cbc:ID>S</cbc:ID><cbc:Percent>${rate}</cbc:Percent><cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme></cac:ClassifiedTaxCategory></cac:Item>
    <cac:Price><cbc:PriceAmount currencyID="EUR">${price}</cbc:PriceAmount></cac:Price></cac:${lineTag}>`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<ubl:${root} xmlns:ubl="urn:oasis:names:specification:ubl:schema:xsd:${root}-2" xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2" xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
  <cbc:CustomizationID>urn:cen.eu:en16931:2017#compliant#urn:xeinkauf.de:kosit:xrechnung_3.0</cbc:CustomizationID>
  <cbc:ProfileID>urn:fdc:peppol.eu:2017:poacc:billing:01:1.0</cbc:ProfileID>
  <cbc:ID>${id}</cbc:ID>
  <cbc:IssueDate>2026-10-10</cbc:IssueDate>
  ${credit ? '' : '<cbc:DueDate>2099-10-24</cbc:DueDate>'}
  <cbc:${credit ? 'CreditNoteTypeCode' : 'InvoiceTypeCode'}>${credit ? '381' : '380'}</cbc:${credit ? 'CreditNoteTypeCode' : 'InvoiceTypeCode'}>
  <cbc:Note>Vielen Dank für Ihren Auftrag. Bei Fragen: Jana Müller, 0681 123456.</cbc:Note>
  <cbc:DocumentCurrencyCode>EUR</cbc:DocumentCurrencyCode>
  <cbc:BuyerReference>04011000-12345-67</cbc:BuyerReference>
  <cac:InvoicePeriod><cbc:StartDate>2026-09-01</cbc:StartDate><cbc:EndDate>2026-09-30</cbc:EndDate></cac:InvoicePeriod>
  <cac:OrderReference><cbc:ID>B-7781</cbc:ID></cac:OrderReference>
  ${credit ? '<cac:BillingReference><cac:InvoiceDocumentReference><cbc:ID>RE-2026-0999</cbc:ID></cac:InvoiceDocumentReference></cac:BillingReference>' : ''}
  ${attachment ? `<cac:AdditionalDocumentReference><cbc:ID>Stundenzettel</cbc:ID><cbc:DocumentDescription>Stundenzettel September</cbc:DocumentDescription><cac:Attachment><cbc:EmbeddedDocumentBinaryObject mimeCode="application/pdf" filename="stundenzettel-september.pdf">${attachment}</cbc:EmbeddedDocumentBinaryObject></cac:Attachment></cac:AdditionalDocumentReference>` : ''}
  <cac:AccountingSupplierParty><cac:Party>
    <cbc:EndpointID schemeID="EM">rechnung@mueller-it.example</cbc:EndpointID>
    <cac:PartyName><cbc:Name>Müller IT-Service</cbc:Name></cac:PartyName>
    <cac:PostalAddress><cbc:StreetName>Bahnhofstraße 12</cbc:StreetName><cbc:CityName>Saarbrücken</cbc:CityName><cbc:PostalZone>66111</cbc:PostalZone><cac:Country><cbc:IdentificationCode>DE</cbc:IdentificationCode></cac:Country></cac:PostalAddress>
    <cac:PartyTaxScheme><cbc:CompanyID>DE123456789</cbc:CompanyID><cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme></cac:PartyTaxScheme>
    <cac:PartyLegalEntity><cbc:RegistrationName>Müller IT-Service GmbH</cbc:RegistrationName><cbc:CompanyID>HRB 12345</cbc:CompanyID></cac:PartyLegalEntity>
    <cac:Contact><cbc:Name>Jana Müller</cbc:Name><cbc:Telephone>0681 123456</cbc:Telephone><cbc:ElectronicMail>jana@mueller-it.example</cbc:ElectronicMail></cac:Contact>
  </cac:Party></cac:AccountingSupplierParty>
  <cac:AccountingCustomerParty><cac:Party>
    <cbc:EndpointID schemeID="EM">einkauf@stadt.example</cbc:EndpointID>
    <cac:PostalAddress><cbc:StreetName>Rathausplatz 1</cbc:StreetName><cbc:CityName>Homburg</cbc:CityName><cbc:PostalZone>66424</cbc:PostalZone><cac:Country><cbc:IdentificationCode>DE</cbc:IdentificationCode></cac:Country></cac:PostalAddress>
    <cac:PartyLegalEntity><cbc:RegistrationName>Kreisstadt Homburg – Amt für IT</cbc:RegistrationName></cac:PartyLegalEntity>
  </cac:Party></cac:AccountingCustomerParty>
  <cac:PaymentMeans><cbc:PaymentMeansCode>58</cbc:PaymentMeansCode><cbc:PaymentID>${id}</cbc:PaymentID><cac:PayeeFinancialAccount><cbc:ID>${iban}</cbc:ID><cbc:Name>Müller IT-Service GmbH</cbc:Name><cac:FinancialInstitutionBranch><cbc:ID>COBADEFFXXX</cbc:ID></cac:FinancialInstitutionBranch></cac:PayeeFinancialAccount></cac:PaymentMeans>
  <cac:PaymentTerms><cbc:Note>Zahlbar innerhalb von 14 Tagen ohne Abzug.</cbc:Note></cac:PaymentTerms>
  <cac:AllowanceCharge><cbc:ChargeIndicator>false</cbc:ChargeIndicator><cbc:AllowanceChargeReason>Treuerabatt</cbc:AllowanceChargeReason><cbc:Amount currencyID="EUR">50.00</cbc:Amount><cac:TaxCategory><cbc:ID>S</cbc:ID><cbc:Percent>19</cbc:Percent><cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme></cac:TaxCategory></cac:AllowanceCharge>
  <cac:TaxTotal><cbc:TaxAmount currencyID="EUR">235.49</cbc:TaxAmount>
    <cac:TaxSubtotal><cbc:TaxableAmount currencyID="EUR">1210.00</cbc:TaxableAmount><cbc:TaxAmount currencyID="EUR">229.90</cbc:TaxAmount><cac:TaxCategory><cbc:ID>S</cbc:ID><cbc:Percent>19</cbc:Percent><cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme></cac:TaxCategory></cac:TaxSubtotal>
    <cac:TaxSubtotal><cbc:TaxableAmount currencyID="EUR">79.80</cbc:TaxableAmount><cbc:TaxAmount currencyID="EUR">5.59</cbc:TaxAmount><cac:TaxCategory><cbc:ID>S</cbc:ID><cbc:Percent>7</cbc:Percent><cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme></cac:TaxCategory></cac:TaxSubtotal>
  </cac:TaxTotal>
  <cac:LegalMonetaryTotal><cbc:LineExtensionAmount currencyID="EUR">1339.80</cbc:LineExtensionAmount><cbc:TaxExclusiveAmount currencyID="EUR">1289.80</cbc:TaxExclusiveAmount><cbc:TaxInclusiveAmount currencyID="EUR">1525.29</cbc:TaxInclusiveAmount><cbc:AllowanceTotalAmount currencyID="EUR">50.00</cbc:AllowanceTotalAmount><cbc:PayableAmount currencyID="EUR">${payable}</cbc:PayableAmount></cac:LegalMonetaryTotal>
  ${line(1, '12', 'HUR', 'Wartung Server', 'Monatliche Wartung, Updates und Überwachung', '85.00', line1, 19)}
  ${line(2, '1', 'C62', 'Lizenz Backup-Software', '', '240.00', '240.00', 19)}
  ${line(3, '2', 'C62', 'Fachbuch „Netzwerke“', '', '39.90', '79.80', 7)}
</ubl:${root}>
`;
}

// ---------------------------------------------------------------- CII (ZUGFeRD 2 / Factur-X EN 16931 / XRechnung CII)
function cii({ id, guideline, means, iban, debit = null, mandate = '', creditor = '', lines, taxes, totals, note }) {
  const li = lines.map((l, i) => `
    <ram:IncludedSupplyChainTradeLineItem>
      <ram:AssociatedDocumentLineDocument><ram:LineID>${i + 1}</ram:LineID></ram:AssociatedDocumentLineDocument>
      <ram:SpecifiedTradeProduct><ram:Name>${esc(l.name)}</ram:Name></ram:SpecifiedTradeProduct>
      <ram:SpecifiedLineTradeAgreement><ram:NetPriceProductTradePrice><ram:ChargeAmount>${l.price}</ram:ChargeAmount></ram:NetPriceProductTradePrice></ram:SpecifiedLineTradeAgreement>
      <ram:SpecifiedLineTradeDelivery><ram:BilledQuantity unitCode="${l.unit}">${l.qty}</ram:BilledQuantity></ram:SpecifiedLineTradeDelivery>
      <ram:SpecifiedLineTradeSettlement><ram:ApplicableTradeTax><ram:TypeCode>VAT</ram:TypeCode><ram:CategoryCode>S</ram:CategoryCode><ram:RateApplicablePercent>${l.rate}</ram:RateApplicablePercent></ram:ApplicableTradeTax>
        <ram:SpecifiedTradeSettlementLineMonetarySummation><ram:LineTotalAmount>${l.net}</ram:LineTotalAmount></ram:SpecifiedTradeSettlementLineMonetarySummation></ram:SpecifiedLineTradeSettlement>
    </ram:IncludedSupplyChainTradeLineItem>`).join('');
  return `<?xml version="1.0" encoding="UTF-8"?>
<rsm:CrossIndustryInvoice xmlns:rsm="urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100" xmlns:ram="urn:un:unece:uncefact:data:standard:ReusableAggregateBusinessInformationEntity:100" xmlns:udt="urn:un:unece:uncefact:data:standard:UnqualifiedDataType:100" xmlns:qdt="urn:un:unece:uncefact:data:standard:QualifiedDataType:100">
  <rsm:ExchangedDocumentContext><ram:GuidelineSpecifiedDocumentContextParameter><ram:ID>${guideline}</ram:ID></ram:GuidelineSpecifiedDocumentContextParameter></rsm:ExchangedDocumentContext>
  <rsm:ExchangedDocument><ram:ID>${id}</ram:ID><ram:TypeCode>380</ram:TypeCode><ram:IssueDateTime><udt:DateTimeString format="102">20261001</udt:DateTimeString></ram:IssueDateTime>
    <ram:IncludedNote><ram:Content>${esc(note)}</ram:Content></ram:IncludedNote></rsm:ExchangedDocument>
  <rsm:SupplyChainTradeTransaction>${li}
    <ram:ApplicableHeaderTradeAgreement>
      <ram:BuyerReference>K-2207</ram:BuyerReference>
      <ram:SellerTradeParty><ram:Name>Grünwerk Gartenbau</ram:Name>
        <ram:DefinedTradeContact><ram:PersonName>Lukas Becker</ram:PersonName><ram:TelephoneUniversalCommunication><ram:CompleteNumber>06841 98765</ram:CompleteNumber></ram:TelephoneUniversalCommunication><ram:EmailURIUniversalCommunication><ram:URIID>info@gruenwerk.example</ram:URIID></ram:EmailURIUniversalCommunication></ram:DefinedTradeContact>
        <ram:PostalTradeAddress><ram:PostcodeCode>66424</ram:PostcodeCode><ram:LineOne>Am Lindenhof 3</ram:LineOne><ram:CityName>Homburg</ram:CityName><ram:CountryID>DE</ram:CountryID></ram:PostalTradeAddress>
        <ram:SpecifiedTaxRegistration><ram:ID schemeID="FC">040/123/45678</ram:ID></ram:SpecifiedTaxRegistration>
        <ram:SpecifiedTaxRegistration><ram:ID schemeID="VA">DE987654321</ram:ID></ram:SpecifiedTaxRegistration>
      </ram:SellerTradeParty>
      <ram:BuyerTradeParty><ram:Name>Familie Schneider</ram:Name>
        <ram:PostalTradeAddress><ram:PostcodeCode>66117</ram:PostcodeCode><ram:LineOne>Feldweg 8</ram:LineOne><ram:CityName>Saarbrücken</ram:CityName><ram:CountryID>DE</ram:CountryID></ram:PostalTradeAddress>
      </ram:BuyerTradeParty>
    </ram:ApplicableHeaderTradeAgreement>
    <ram:ApplicableHeaderTradeDelivery><ram:ActualDeliverySupplyChainEvent><ram:OccurrenceDateTime><udt:DateTimeString format="102">20260928</udt:DateTimeString></ram:OccurrenceDateTime></ram:ActualDeliverySupplyChainEvent></ram:ApplicableHeaderTradeDelivery>
    <ram:ApplicableHeaderTradeSettlement>
      ${creditor ? `<ram:CreditorReferenceID>${creditor}</ram:CreditorReferenceID>` : ''}
      <ram:PaymentReference>${id}</ram:PaymentReference>
      <ram:InvoiceCurrencyCode>EUR</ram:InvoiceCurrencyCode>
      <ram:SpecifiedTradeSettlementPaymentMeans><ram:TypeCode>${means}</ram:TypeCode>
        ${debit ? `<ram:PayerPartyDebtorFinancialAccount><ram:IBANID>${debit}</ram:IBANID></ram:PayerPartyDebtorFinancialAccount>` : ''}
        ${iban ? `<ram:PayeePartyCreditorFinancialAccount><ram:IBANID>${iban}</ram:IBANID><ram:AccountName>Grünwerk Gartenbau</ram:AccountName></ram:PayeePartyCreditorFinancialAccount>` : ''}
      </ram:SpecifiedTradeSettlementPaymentMeans>
      ${taxes.map(t => `<ram:ApplicableTradeTax><ram:CalculatedAmount>${t.amount}</ram:CalculatedAmount><ram:TypeCode>VAT</ram:TypeCode><ram:BasisAmount>${t.base}</ram:BasisAmount><ram:CategoryCode>S</ram:CategoryCode><ram:RateApplicablePercent>${t.rate}</ram:RateApplicablePercent></ram:ApplicableTradeTax>`).join('\n      ')}
      <ram:SpecifiedTradePaymentTerms><ram:Description>${means === '59' ? 'Der Betrag wird am 15.10.2026 von Ihrem Konto abgebucht.' : 'Zahlbar bis 15.10.2026 ohne Abzug.'}</ram:Description><ram:DueDateDateTime><udt:DateTimeString format="102">20261015</udt:DateTimeString></ram:DueDateDateTime>${mandate ? `<ram:DirectDebitMandateID>${mandate}</ram:DirectDebitMandateID>` : ''}</ram:SpecifiedTradePaymentTerms>
      <ram:SpecifiedTradeSettlementHeaderMonetarySummation><ram:LineTotalAmount>${totals.lines}</ram:LineTotalAmount><ram:TaxBasisTotalAmount>${totals.net}</ram:TaxBasisTotalAmount><ram:TaxTotalAmount currencyID="EUR">${totals.tax}</ram:TaxTotalAmount><ram:GrandTotalAmount>${totals.gross}</ram:GrandTotalAmount><ram:DuePayableAmount>${totals.gross}</ram:DuePayableAmount></ram:SpecifiedTradeSettlementHeaderMonetarySummation>
    </ram:ApplicableHeaderTradeSettlement>
  </rsm:SupplyChainTradeTransaction>
</rsm:CrossIndustryInvoice>
`;
}
const garden = {
  lines: [
    { name: 'Rasen mähen und Kanten schneiden', qty: '6', unit: 'HUR', price: '45.00', net: '270.00', rate: 19 },
    { name: 'Grünschnitt-Entsorgung', qty: '1', unit: 'LS', price: '35.00', net: '35.00', rate: 19 },
  ],
  taxes: [{ base: '305.00', amount: '57.95', rate: 19 }],
  totals: { lines: '305.00', net: '305.00', tax: '57.95', gross: '362.95' },
};

const att = await simplePdf(['Stundenzettel September', 'Server-Wartung: 12 Stunden', 'Unterschrieben: J. Müller']);
const attB64 = Buffer.from(await att.save()).toString('base64');
writeFileSync(OUT + 'xrechnung_ubl.xml', ubl({ attachment: attB64 }));
writeFileSync(OUT + 'kaputt_summen.xml', ubl({ id: 'RE-2026-1043', iban: 'DE89370400440532013001', payable: '1625.29', line1: '1120.00' }));
writeFileSync(OUT + 'gutschrift_ubl.xml', ubl({ id: 'GS-2026-0007', credit: true }));
writeFileSync(OUT + 'xrechnung_cii_lastschrift.xml', cii({ id: '2026-0816', guideline: 'urn:cen.eu:en16931:2017#compliant#urn:xeinkauf.de:kosit:xrechnung_3.0', means: '59', iban: '', debit: 'DE02500105170137075030', mandate: 'MANDAT-0042', creditor: 'DE98ZZZ09999999999', note: 'Danke, dass Sie Grünwerk gewählt haben.', ...garden }));
const zxml = cii({ id: '2026-0815', guideline: 'urn:cen.eu:en16931:2017', means: '58', iban: 'DE02120300000000202051', note: 'Rechnung für Gartenarbeiten im September.', ...garden });
writeFileSync(OUT + 'factur-x.xml', zxml);
const z = await simplePdf(['Grünwerk Gartenbau – Rechnung 2026-0815', 'Rasen mähen und Kanten schneiden: 270,00 EUR', 'Grünschnitt-Entsorgung: 35,00 EUR', 'Gesamt: 362,95 EUR']);
await z.attach(Buffer.from(zxml), 'factur-x.xml', { mimeType: 'text/xml', description: 'Factur-X/ZUGFeRD invoice', afRelationship: AFRelationship.Alternative, creationDate: new Date('2026-10-01'), modificationDate: new Date('2026-10-01') });
writeFileSync(OUT + 'zugferd.pdf', await z.save());
writeFileSync(OUT + 'normal.pdf', await (await simplePdf(['Rechnung 77', 'Nur eine normale PDF ohne XML.'])).save());
writeFileSync(OUT + 'kein_einv.xml', '<?xml version="1.0" encoding="UTF-8"?>\n<config><setting name="a">1</setting></config>\n');
writeFileSync(OUT + 'zugferd1.xml', '<?xml version="1.0" encoding="UTF-8"?>\n<rsm:CrossIndustryDocument xmlns:rsm="urn:ferd:CrossIndustryDocument:invoice:1p0"><rsm:HeaderExchangedDocument/></rsm:CrossIndustryDocument>\n');
console.log('einv fixtures written to', OUT);
