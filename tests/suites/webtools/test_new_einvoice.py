"""invoice-generator as e-invoice: ZUGFeRD (PDF/A-3 + factur-x.xml, profile EN 16931) and XRechnung 3.0 (CII XML +
PDF view). The form lists what is still missing and blocks the button; the outputs are checked with the official
tools (tests/tools/einvoice: CII XSD, EN 16931 schematron, XRechnung schematron, Mustang/veraPDF) and read back
with the read-e-invoice library. Kleinunternehmer, discount + period, reverse charge, EN page."""
import os, re, subprocess, sys
os.environ.setdefault('WT_PORT', '8792')
from pathlib import Path
from wtlib import Suite

PATHS = {'de': '/werkzeuge/rechnung-schreiben/', 'en': '/en/tools/invoice-generator/'}
TOOLS = Path(__file__).resolve().parents[2] / 'tools' / 'einvoice'
VENDOR = TOOLS / 'vendor'
if not (VENDOR / 'mustang-cli.jar').exists():
    subprocess.run(['bash', str(TOOLS / 'setup.sh')], capture_output=True)
HAVE = (VENDOR / 'mustang-cli.jar').exists() and (VENDOR / 'xr-cii.xsl').exists()
XSD = next(iter((VENDOR / 'en16931' / 'cii' / 'schema').glob('*/uncoupled clm/CII/uncefact/data/standard/CrossIndustryInvoice_100pD16B.xsd')), None) if HAVE else None

def f(page, key, value):
    page.locator(f'input[id^="new-inv-{key}-"], textarea[id^="new-inv-{key}-"]').first.fill(value)

def item(page, i, desc, qty, price, vat=None, unit=None):
    li = page.locator('.new-item').nth(i)
    li.locator('textarea').fill(desc)
    li.locator('input[id^="new-inv-qty-"]').fill(qty)
    li.locator('input[id^="new-inv-price-"]').fill(price)
    if unit is not None: li.locator('input[id^="new-inv-unit-"]').fill(unit)
    if vat is not None:
        sel = li.locator('select[id^="new-inv-vat-"]')
        if sel.count(): sel.select_option(vat)
        else: li.locator('input[id^="new-inv-vat-"]').fill(vat)

def fmt(page, value):
    page.locator('select[id^="new-inv-eFormat-"]').select_option(value)

def sender(page):
    f(page, 'sName', 'Müller Webdesign'); f(page, 'sStreet', 'Bahnhofstraße 12'); f(page, 'sCity', '66111 Saarbrücken')
    f(page, 'sPhone', '0681 123456'); f(page, 'sMail', 'info@mueller-web.example'); f(page, 'taxNo', '040/123/45678')
    f(page, 'iban', 'DE89 3704 0044 0532 0130 00'); f(page, 'bic', 'COBADEFFXXX')

def validate_xml(s, path, xr, tag):
    if not HAVE:
        s.notes.append(f'{tag}: validators not installed – schema/schematron check skipped'); return
    x = subprocess.run(['java', str(TOOLS / 'XsdValidate.java'), str(XSD), str(path)], capture_output=True, text=True).stdout
    s.expect('XSD OK' in x, f'{tag}: CII schema: {x.strip()[-300:]}')
    r = subprocess.run([sys.executable, str(TOOLS / 'validate.py'), str(path)] + (['--xrechnung'] if xr else []), capture_output=True, text=True).stdout
    s.expect('RESULT OK' in r, f'{tag}: schematron ({"XRechnung" if xr else "EN 16931"}): {r.strip()[-600:]}')

def validate_pdf(s, path, tag):
    if not HAVE:
        s.notes.append(f'{tag}: Mustang not installed – PDF/A check skipped'); return
    rep = subprocess.run(['java', '-jar', str(VENDOR / 'mustang-cli.jar'), '--action', 'validate', '--source', str(path), '--disable-file-logging'], capture_output=True, text=True, timeout=600).stdout
    st = re.findall(r'<summary status="([^"]+)"', rep)
    s.expect(st and all(x == 'valid' for x in st), f'{tag}: Mustang/veraPDF: {st} {re.findall(r"<error[^>]*>[^<]*", rep)[:6]}')

def read_back(page, xml_text):
    return page.evaluate("""async x => { const m = await import('/assets/wt/lib/einvoice.js'); const inv = m.parseEInvoice(x);
      return { payable: inv.totals.payable, number: inv.number, warn: inv.checks.filter(c => !c.ok && c.level !== 'info').map(c => c.de), lines: inv.lines.length }; }""", xml_text)

def attachment(pdf):
    from pypdf import PdfReader
    r = PdfReader(str(pdf))
    a = r.attachments
    return {k: v[0] for k, v in a.items()}

with Suite('new-einvoice') as s:
    # ---------------------------------------------------------------- ZUGFeRD, DE phone
    for v in s.variants(langs=('de',)):
        page = s.open(v, PATHS['de'])
        page.wait_for_selector('.new-item')
        f(page, 'number', 'RE-2026-042')
        f(page, 'rName', 'Kiosk am See GmbH'); f(page, 'rStreet', 'Seeweg 3'); f(page, 'rCity', '66111 Saarbrücken')
        item(page, 0, 'Webdesign Startseite\nResponsive, drei Entwürfe', '12', '85', '19', 'Std.')
        page.locator('button', has_text='Position hinzufügen').click()
        item(page, 1, 'Fachbuch Webdesign', '2', '39,90', '7', 'Stk.')
        fmt(page, 'zugferd')
        page.wait_for_selector('.new-echeck')
        miss = page.locator('.new-echeck li.is-miss').count()
        s.expect(miss >= 2, f'{v}: e-invoice lists missing details ({miss})')
        s.expect(s.primary(page).is_disabled() and 'E-Rechnung' in page.locator('.wt-bar-hint').inner_text(), f'{v}: button blocked while details are missing')
        sender(page)
        s.expect(page.locator('.new-echeck li.is-miss').count() == 0 and 'Alles da' in page.locator('.new-echeck').inner_text(), f'{v}: all set: {page.locator(".new-echeck").inner_text()}')
        if v.device == 'phone': s.shot(page, 'invoice-generator_phone_einvoice', top='.new-ebox')
        s.check_page(page)
        out = s.run_and_download(page)
        if out:
            s.expect(out.name.endswith('(E-Rechnung).pdf'), f'{v}: file name {out.name}')
            att = attachment(out)
            s.expect(list(att) == ['factur-x.xml'], f'{v}: factur-x.xml attached: {list(att)}')
            xml = att.get('factur-x.xml', b'').decode('utf-8')
            xp = out.with_suffix('.xml'); xp.write_text(xml, encoding='utf-8')
            s.expect('urn:cen.eu:en16931:2017</ram:ID>' in xml and '<ram:GrandTotalAmount>1299.19</ram:GrandTotalAmount>' in xml, f'{v}: profile + total in XML')
            t = s.pdf_text(out)
            s.expect('1.299,19 €' in t and 'Kiosk am See GmbH' in t, f'{v}: visible invoice')
            fonts = subprocess.run(['pdffonts', str(out)], capture_output=True, text=True).stdout
            s.expect('Helvetica' not in fonts and fonts.count(' yes ') >= 1, f'{v}: all fonts embedded (PDF/A): {fonts}')
            validate_xml(s, xp, False, f'{v} ZUGFeRD')
            validate_pdf(s, out, f'{v} ZUGFeRD')
            rb = read_back(page, xml)
            s.expect(rb['payable'] == 1299.19 and rb['number'] == 'RE-2026-042' and not rb['warn'] and rb['lines'] == 2, f'{v}: read back by our reader: {rb}')
        page.close()

    # ---------------------------------------------------------------- XRechnung, DE desktop: Leitweg-ID, e-mails
    ctx = s.context('desktop', 'de')
    page = s.open(ctx, PATHS['de'])
    page.wait_for_selector('.new-item')
    f(page, 'number', '2026-100')
    f(page, 'rName', 'Kreisstadt Homburg'); f(page, 'rStreet', 'Am Forum 5'); f(page, 'rCity', '66424 Homburg')
    item(page, 0, 'Wartung Server', '10', '95', '19', 'Std.')
    f(page, 'discount', '5')
    page.locator('select[id^="new-inv-serviceMode-"]').select_option('period')
    f(page, 'from', '2026-09-01'); f(page, 'to', '2026-09-30')
    sender(page)
    fmt(page, 'xrechnung')
    page.wait_for_selector('.new-echeck')
    t = page.locator('.new-echeck').inner_text()
    s.expect('Leitweg-ID' in t and 'E-Mail-Adresse des Kunden' in t, f'XRechnung needs Leitweg-ID + buyer e-mail: {t}')
    s.expect(s.primary(page).is_disabled(), 'XRechnung blocked without Leitweg-ID')
    f(page, 'buyerRef', '04011000-12345-67'); f(page, 'rMail', 'rechnung@homburg.example')
    s.expect(page.locator('.new-echeck li.is-miss').count() == 0, f'XRechnung complete: {page.locator(".new-echeck").inner_text()}')
    s.shot(page, 'invoice-generator_desktop_xrechnung', top='.new-ebox')
    if s.run(page):
        s.expect(page.locator('.wt-output').count() == 2, 'XML + PDF view')
        xp = s.download(page, 0)
        xml = xp.read_text(encoding='utf-8')
        s.expect(xp.name.endswith('.xml') and 'xrechnung_3.0' in xml and '04011000-12345-67' in xml and 'schemeID="EM">rechnung@homburg.example' in xml, f'XRechnung content {xp.name}')
        s.expect('<ram:AllowanceTotalAmount>47.50</ram:AllowanceTotalAmount>' in xml and '<ram:GrandTotalAmount>1073.98</ram:GrandTotalAmount>' in xml and '<ram:BillingSpecifiedPeriod>' in xml, 'discount + period in XML')
        validate_xml(s, xp, True, 'XRechnung')
        pdf = s.download(page, 1)
        s.expect('(Ansicht)' in pdf.name and s.pdf_pages(pdf) >= 1, 'PDF view')
        rb = read_back(page, xml)
        s.expect(rb['payable'] == 1073.98 and not rb['warn'], f'XRechnung read back: {rb}')
        page.locator('.wt-restart button').first.click()

    # ---------------------------------------------------------------- Kleinunternehmer (only Steuernummer) as XRechnung
    page.locator('label', has_text='Kleinunternehmer').click()
    f(page, 'discount', '')
    if s.run(page):
        xp = s.download(page, 0)
        xml = xp.read_text(encoding='utf-8')
        s.expect('<ram:CategoryCode>E</ram:CategoryCode>' in xml and '§ 19 UStG' in xml and '<ram:ID>040/123/45678</ram:ID>' in xml, 'KU: category E, reason, tax number as seller id')
        validate_xml(s, xp, True, 'XRechnung KU')
        page.locator('.wt-restart button').first.click()
    page.close()

    # ---------------------------------------------------------------- reverse charge to Austria as ZUGFeRD
    page = s.open(ctx, PATHS['de'])
    page.wait_for_selector('.new-item')
    f(page, 'number', '2026-101')
    f(page, 'rName', 'Alpen Consult GmbH'); f(page, 'rStreet', 'Ring 1'); f(page, 'rCity', '1010 Wien'); f(page, 'rCountry', 'Österreich')
    item(page, 0, 'Beratung', '1', '1000', '0', 'pauschal')
    page.wait_for_selector('textarea[id^="new-inv-exemptNote-"]')
    page.locator('.new-chip', has_text='Reverse Charge').click()
    sender(page)
    fmt(page, 'zugferd')
    page.wait_for_selector('.new-echeck')
    t = page.locator('.new-echeck').inner_text()
    s.expect('USt-IdNr. des Kunden' in t and 'Deine USt-IdNr.' in t, f'reverse charge needs both VAT IDs: {t}')
    f(page, 'rVatId', 'ATU12345678'); f(page, 'vatId', 'DE123456789')
    out = s.run_and_download(page)
    if out:
        xml = attachment(out).get('factur-x.xml', b'').decode('utf-8')
        xp = out.with_suffix('.xml'); xp.write_text(xml, encoding='utf-8')
        s.expect('<ram:CategoryCode>AE</ram:CategoryCode>' in xml and '<ram:CountryID>AT</ram:CountryID>' in xml, 'reverse charge AE + AT')
        validate_xml(s, xp, False, 'ZUGFeRD reverse charge')
        validate_pdf(s, out, 'ZUGFeRD reverse charge')
    page.close()

    # ---------------------------------------------------------------- EN page: Factur-X in EUR
    for v in s.variants(langs=('en',), devices=('desktop',)):
        page = s.open(v, PATHS['en'])
        page.wait_for_selector('.new-item')
        f(page, 'number', 'INV-77')
        f(page, 'rName', 'Northwind Ltd'); f(page, 'rStreet', 'Rue de la Paix 1'); f(page, 'rCity', '75001 Paris'); f(page, 'rCountry', 'France')
        item(page, 0, 'Consulting', '3', '100', '20', 'hrs')
        f(page, 'sName', 'Jane Doe Design'); f(page, 'sStreet', 'Hauptstraße 1'); f(page, 'sCity', '10115 Berlin'); f(page, 'vatId', 'DE123456789')
        f(page, 'iban', 'DE89 3704 0044 0532 0130 00')
        fmt(page, 'zugferd')
        out = s.run_and_download(page)
        if out:
            xml = attachment(out).get('factur-x.xml', b'').decode('utf-8')
            xp = out.with_suffix('.xml'); xp.write_text(xml, encoding='utf-8')
            s.expect('<ram:GrandTotalAmount>360.00</ram:GrandTotalAmount>' in xml and 'unitCode="HUR"' in xml, f'{v}: EN Factur-X amounts + unit')
            validate_xml(s, xp, False, f'{v} Factur-X')
            validate_pdf(s, out, f'{v} Factur-X')
        page.close()
