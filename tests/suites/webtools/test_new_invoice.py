"""invoice-generator: § 14 UStG check, mixed 19/7 % + discount maths, Leistungszeitraum, Kleinunternehmer note,
0 % with exemption note, GiroCode decoded from the rendered PDF, IBAN validation, Unicode names, long invoices
(page breaks + "Seite x von y"), remember sender + number counter (opt-in), EN page (currency, tax label)."""
import os, re, subprocess
os.environ.setdefault('WT_PORT', '8790')
from PIL import Image
from wtlib import Suite, OUT, FIX

PATHS = {'de': '/werkzeuge/rechnung-schreiben/', 'en': '/en/tools/invoice-generator/'}

def f(page, key, value, n=0):
    page.locator(f'input[id^="new-inv-{key}-"], textarea[id^="new-inv-{key}-"]').nth(n).fill(value)

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

def flat(t): return re.sub(r'\s+', ' ', t)

def qr_text(s, page, pdf, caption):
    """Find the QR above its caption, sample the modules, decode in the browser (lib/img-qrdecode.js)."""
    dpi = 300
    bbox = subprocess.run(['pdftotext', '-bbox', '-f', '1', '-l', '9', str(pdf), '-'], capture_output=True, text=True).stdout
    pg = 0; hit = None
    for line in bbox.splitlines():
        if '<page ' in line: pg += 1
        m = re.search(r'yMin="([\d.]+)".*>' + caption + '<', line)
        if m and hit is None: hit = (pg, float(m.group(1)))
    if not hit: return None
    img = s.render(pdf, hit[0], dpi).convert('L')
    k = dpi / 72
    size = 28 * 72 / 25.4
    R = 595.28 - 20 * 72 / 25.4
    box = (int((R - size - 4) * k), int((hit[1] - 3.75 - size - 6) * k), int((R + 4) * k), int((hit[1] - 1) * k))
    q = img.crop(box)
    W, H = q.size
    dark = [(x, y) for y in range(H) for x in range(W) if q.getpixel((x, y)) < 128]
    x0 = min(p[0] for p in dark); x1 = max(p[0] for p in dark); y0 = min(p[1] for p in dark); y1 = max(p[1] for p in dark)
    run = 0
    while q.getpixel((x0 + run, y0 + 2)) < 128: run += 1
    px = run / 7
    n = round((x1 - x0 + 1) / px)
    px = (x1 - x0 + 1) / n
    m = [[q.getpixel((int(x0 + (cx + 0.5) * px), int(y0 + (cy + 0.5) * px))) < 128 for cx in range(n)] for cy in range(n)]
    return page.evaluate("async m => { const mod = await import('/assets/wt/lib/img-qrdecode.js'); return mod.decodeModules((x, y) => m[y][x], m.length); }", m)

with Suite('new-invoice') as s:
    for v in s.variants(langs=('de',)):
        shots = v.device == 'phone'
        page = s.open(v, PATHS['de'])
        page.wait_for_selector('.new-item')
        if shots: s.shot(page, 'invoice-generator_phone_initial')
        f(page, 'number', 'RE-2026-041')
        f(page, 'rName', 'Kiosk am See GmbH'); f(page, 'rStreet', 'Seeweg 3'); f(page, 'rCity', '66111 Saarbrücken')
        item(page, 0, 'Webdesign Startseite', '2', '50', '19', 'Std.')
        page.locator('button', has_text='Position hinzufügen').click()
        item(page, 1, 'Fachbuch Webdesign', '3', '10', '7', 'Stk.')
        f(page, 'discount', '10')
        page.locator('select[id^="new-inv-serviceMode-"]').select_option('period')
        f(page, 'from', '2026-09-01'); f(page, 'to', '2026-09-30')
        # check list still shows missing sender + tax number
        s.expect(page.locator('.new-check li.is-miss').count() >= 2, f'{v}: missing items listed')
        s.expect('Pflichtangaben' in page.locator('.wt-bar-hint').inner_text(), f'{v}: bar hints missing details')
        f(page, 'sName', 'Fabian Łukasz Müller'); f(page, 'sStreet', 'Hauptstraße 12'); f(page, 'sCity', '66111 Saarbrücken')
        f(page, 'taxNo', '040/123/45678')
        f(page, 'iban', 'DE89 3704 0044 0532 0130 00')
        s.expect(page.locator('.new-check li.is-miss').count() == 0, f'{v}: all mandatory details present: {page.locator(".new-check").inner_text()}')
        s.expect('135,99' in page.locator('.new-sum').inner_text(), f'{v}: live total 135,99: {page.locator(".new-sum").inner_text()}')
        # bad IBAN shows an error
        f(page, 'iban', 'DE89 3704 0044 0532 0130 01')
        s.expect(page.locator('.new-f-err:not([hidden])').count() == 1, f'{v}: IBAN error')
        f(page, 'iban', 'DE89 3704 0044 0532 0130 00')
        if v.device == 'phone':
            page.locator('label', has_text='Rechnungsnummer auf diesem Gerät hochzählen').click()
            page.locator('label', has_text='Absender, Bankdaten und Logo auf diesem Gerät merken').click()
            page.set_input_files('.new-box input[type=file]', str(FIX / 'new_quad.png'))
            page.wait_for_selector('.new-logo-prev:not([hidden])')
        if shots: s.shot(page, 'invoice-generator_phone_configured', top='.new-box')
        s.check_page(page)
        out = s.run_and_download(page)
        if out:
            t = flat(s.pdf_text(out))
            for need in ['Rechnung RE-2026-041', 'Kiosk am See GmbH', '01.09.2026 – 30.09.2026', '040/123/45678', 'Rabatt 10 %', '90,00 €', '17,10 €', '27,00 €', '1,89 €', '135,99 €', 'DE89 3704 0044 0532 0130 00', 'Łukasz', 'Zahlbar bis']:
                s.expect(need in t, f'{v}: PDF contains {need!r}')
            s.expect('§ 19' not in t, f'{v}: no KU note on a regular invoice')
            code = qr_text(s, page, out, 'Banking-App')
            s.expect(code and code.split('\n')[:8] == ['BCD', '002', '1', 'SCT', '', 'Fabian Łukasz Müller', 'DE89370400440532013000', 'EUR135.99'] and code.endswith('Rechnung RE-2026-041'), f'{v}: GiroCode payload {code!r}')
            fonts = subprocess.run(['pdffonts', str(out)], capture_output=True, text=True).stdout
            s.expect('Liberation' in fonts or 'Identity-H' in fonts, f'{v}: unicode font embedded for Ł')
            if shots:
                s.render(out, 1, 60).save(OUT / 'invoice_render.png')
                s.shot(page, 'invoice-generator_phone_result')
        s.check_page(page)
        if v.device == 'phone':
            # reload: sender + logo remembered, number counted up
            p2 = s.open(v, PATHS['de'])
            p2.wait_for_selector('.new-item')
            s.expect(p2.locator('input[id^="new-inv-number-"]').input_value() == 'RE-2026-042', f'{v}: next number {p2.locator("input[id^=new-inv-number-]").input_value()}')
            s.expect(p2.locator('input[id^="new-inv-sName-"]').input_value() == 'Fabian Łukasz Müller', f'{v}: sender remembered')
            s.expect(p2.locator('.new-logo-prev:not([hidden])').count() == 1, f'{v}: logo remembered')
            # Kleinunternehmer + many items → several pages
            f(p2, 'rName', 'Max Mustermann'); f(p2, 'rStreet', 'Weg 1'); f(p2, 'rCity', '10115 Berlin')
            p2.locator('label', has_text='Kleinunternehmer').click()
            for i in range(34):
                if i: p2.locator('button', has_text='Position hinzufügen').click()
                item(p2, i, f'Leistung Nummer {i + 1} mit einer etwas längeren Beschreibung, die umbrechen muss', '1', '10,50')
            out = s.run_and_download(p2)
            if out:
                t = flat(s.pdf_text(out))
                s.expect('§ 19 UStG' in t and 'USt.' not in t.replace('USt-IdNr', ''), f'{v}: KU note, no VAT')
                s.expect(s.pdf_pages(out) >= 2 and 'Seite 2 von' in t, f'{v}: multi page with page numbers ({s.pdf_pages(out)})')
                s.expect('357,00 €' in t, f'{v}: KU total 357,00')
            s.check_page(p2)
            p2.close()
        page.close()
    # 0 % needs an exemption note
    ctx = s.context('desktop', 'de')
    page = s.open(ctx, PATHS['de'])
    page.wait_for_selector('.new-item')
    item(page, 0, 'Beratung (Reverse Charge)', '1', '1000', '0')
    page.wait_for_selector('textarea[id^="new-inv-exemptNote-"]')
    s.expect(page.locator('.new-check li.is-miss', has_text='Steuerbefreiung').count() == 1, 'exemption note required at 0 %')
    page.locator('.new-chip', has_text='Reverse Charge').click()
    s.expect(page.locator('.new-check li.is-miss', has_text='Steuerbefreiung').count() == 0, 'exemption note filled')
    s.check_page(page)
    # EN page
    for v in s.variants(langs=('en',)):
        page = s.open(v, PATHS['en'])
        page.wait_for_selector('.new-item')
        f(page, 'number', 'INV-7')
        page.locator('select[id^="new-inv-currency-"]').select_option('GBP')
        f(page, 'taxLabel', 'VAT')
        item(page, 0, 'Consulting', '3', '100', '20', 'hrs')
        f(page, 'rName', 'ACME Ltd'); f(page, 'rStreet', '1 High St'); f(page, 'rCity', 'London')
        f(page, 'sName', 'Jane Doe'); f(page, 'sStreet', '2 Low Rd'); f(page, 'sCity', 'Leeds')
        f(page, 'iban', 'GB29 NWBK 6016 1331 9268 19')
        if v.device == 'phone': s.shot(page, 'invoice-generator_phone_en', top='.new-box')
        s.check_page(page)
        out = s.run_and_download(page)
        if out:
            t = flat(s.pdf_text(out))
            for need in ['Invoice INV-7', '£300.00', 'VAT 20 % on £300.00', '£60.00', '£360.00', 'Payment due by']:
                s.expect(need in t, f'{v}: EN PDF contains {need!r}')
            s.expect('UStG' not in t and 'Banking' not in t, f'{v}: no German law, no QR for GBP')
        page.close()
    ctx = s.context('phone', 'de', dark=True)
    page = s.open(ctx, PATHS['de'])
    page.wait_for_selector('.new-item')
    s.shot(page, 'invoice-generator_phone_dark', top='.new-box')
    s.check_page(page)
