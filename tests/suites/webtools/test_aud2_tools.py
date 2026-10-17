"""aud2 regression tests (edit/security/image/everyday tools):
redaction finds secrets behind links and in comment authors; forms with escaped /DA and NeedAppearances render
in every viewer, sensible keyboards; letter address always inside the DIN window; passport JPEGs carry 600 dpi;
invoice reads German "1.000" as a thousand and names exactly what is missing; very large photos are reduced with
a note; OCR on an already searchable PDF gives a hint (no error card); the sticky bar never covers a field while
typing; the page scrolls over the scan photo; invoice maths unit tests (node)."""
import re, subprocess, sys
from pypdf import PdfReader
from PIL import Image
from wtlib import Suite, FIX, HERE, OUT

if not (FIX / 'aud2/hard_form.pdf').exists():
    subprocess.run([sys.executable, str(HERE / 'aud2_make_fixtures.py')], check=True, capture_output=True)

def tdrag(page, x0, y0, x1, y1, n=10):
    cdp = page.context.new_cdp_session(page)
    cdp.send('Input.dispatchTouchEvent', {'type': 'touchStart', 'touchPoints': [{'x': x0, 'y': y0}]})
    for i in range(1, n + 1):
        cdp.send('Input.dispatchTouchEvent', {'type': 'touchMove', 'touchPoints': [{'x': x0 + (x1 - x0) * i / n, 'y': y0 + (y1 - y0) * i / n}]})
    cdp.send('Input.dispatchTouchEvent', {'type': 'touchEnd', 'touchPoints': []})
    page.wait_for_timeout(300)

with Suite('aud2-tools') as s:
    # 0) invoice maths (node)
    r = subprocess.run(['node', str(HERE / 'aud2_invoice_unit.mjs')], capture_output=True, text=True)
    s.expect(r.returncode == 0, f'invoice unit tests: {r.stdout[-400:]} {r.stderr[-300:]}')

    # 1) redaction: secret only in a mailto: link target and a comment author
    page = s.open(s.context('desktop', 'de'), '/werkzeuge/pdf-schwaerzen/')
    s.pick(page, 'aud2/redact_traps.pdf'); s.wait_ready(page, 1); page.wait_for_selector('.sec-page canvas')
    page.fill('#sec-red-term', 'Geheimnis'); page.press('#sec-red-term', 'Enter')
    page.wait_for_function("() => document.querySelectorAll('.sec-hit').length >= 3", timeout=20000)
    out = s.run_and_download(page)
    if out:
        q = OUT / 'aud2_red_q.pdf'
        subprocess.run(['qpdf', '--qdf', '--object-streams=disable', str(out), str(q)], capture_output=True)
        b = q.read_bytes().lower()
        s.expect(b'geheimnis' not in b, 'redacted term must not survive in a link target or comment author')
    s.check_page(page); page.close()

    # 2) form with escaped /DA (auto size), NeedAppearances, radio/comb/dropdown, Unicode, rotated page
    page = s.open(s.context('phone', 'de'), '/werkzeuge/pdf-formular-ausfuellen/')
    s.pick(page, 'aud2/hard_form.pdf'); s.wait_ready(page, 1)
    page.wait_for_selector('label:has-text("Titel")')
    attrs = lambda lbl: page.get_by_label(lbl, exact=True).evaluate('e => [e.type, e.inputMode, e.placeholder]')
    s.expect(attrs('Titel')[0] == 'text' and attrs('Titel')[1] != 'tel', f'"Titel" is not a phone field: {attrs("Titel")}')
    s.expect(attrs('Geburtsort')[1] != 'numeric' and not attrs('Geburtsort')[2], f'"Geburtsort" is not a date: {attrs("Geburtsort")}')
    s.expect(attrs('Geburtsdatum')[1] == 'numeric', 'birth date keeps the number keyboard')
    s.expect(attrs('Telefon')[0] == 'tel', 'phone keyboard for Telefon')
    page.get_by_label('Titel', exact=True).fill('Dr. Łukasz Ελληνικά Привет')
    page.get_by_label('Bemerkung', exact=True).fill('Zeile eins\nZeile zwei')
    page.get_by_label('PLZ', exact=True).fill('66111')
    page.get_by_label('verheiratet', exact=True).check()
    page.get_by_label('Bundesland', exact=True).select_option('Thüringen')
    page.get_by_label('Unterschrift Ort', exact=True).fill('Saarlouis')
    s.shot(page, 'aud2_form_keyboards', top='.wt-stage')
    out = s.run_and_download(page)
    if out:
        rt = page.locator('.wt-result').inner_text()
        s.expect('nicht darstellen' not in rt, f'no font warning: {rt[:300]}')
        rd = PdfReader(out); af = rd.trailer['/Root']['/AcroForm']
        s.expect('/NeedAppearances' not in af or not af['/NeedAppearances'], 'NeedAppearances switched off – appearances were written')
        s.expect('/LiberationSans' in af['/DR']['/Font'], f'Unicode font registered in /DR: {list(af["/DR"]["/Font"].keys())}')
        f = {k: v.get('/V') for k, v in rd.get_fields().items()}
        s.expect(f['Familienstand'] == '/verheiratet' and f['Bundesland'] == 'Thüringen' and f['PLZ'] == '66111', f'values {f}')
        t = subprocess.run(['pdftotext', '-layout', str(out), '-'], capture_output=True, text=True).stdout
        for w in ('Łukasz', 'Ελληνικά', 'Привет', 'Thüringen', 'Zeile zwei', 'Saarlouis'):
            s.expect(w in t, f'"{w}" shown by poppler: {t[:400]!r}')
    s.check_page(page); page.close()

    # 3) letter: long recipient lines + 6 address lines stay inside the window (x ≤ 105 mm, y ≤ 90 mm)
    page = s.open(s.context('phone', 'de'), '/werkzeuge/kuendigung-schreiben/')
    page.wait_for_selector('.img-lt-sec')
    for k, v in {'customer': 'K-1', 'rName': 'Deutsche Beispiel Telekommunikations- und Mobilfunkdienste Kundenservice GmbH',
                 'rAttn': 'Abteilung Vertragsbeendigungen und Kündigungseingang', 'rStreet': 'Postfach 10 20 30', 'rCity': '12345 Musterstadt',
                 'rCountry': 'Deutschland', 'sName': 'Erika Muster', 'sStreet': 'Weg 7', 'sCity': '66111 Saarbrücken', 'place': 'Saarbrücken'}.items():
        page.fill(f'#img-lt-{k}', v)
    out = s.run_and_download(page)
    if out:
        bb = subprocess.run(['pdftotext', '-bbox', '-f', '1', '-l', '1', str(out), '-'], capture_output=True, text=True).stdout
        words = [(float(a), float(b), float(c), float(d), w) for a, b, c, d, w in re.findall(r'xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">([^<]*)<', bb)]
        mm = lambda v: v / 72 * 25.4
        addr = [w for w in words if 62 <= mm(w[1]) <= 100 and mm(w[0]) < 110]
        s.expect(any('Deutschland' in w[4] for w in addr), f'country line present in the address field')
        bad = [w[4] for w in addr if mm(w[2]) > 105.5 or mm(w[3]) > 90.5]
        s.expect(not bad, f'address words outside the window: {bad}')
    s.check_page(page); page.close()

    # 4) passport photo: 600 dpi in the JPEG header (prints at the exact size)
    page = s.open(s.context('phone', 'de'), '/werkzeuge/passfoto/')
    s.pick(page, 'img/portrait.jpg'); s.wait_ready(page, 1)
    page.wait_for_function("() => document.querySelector('.img-pp-frame').offsetWidth > 100")
    page.locator('input[name="wt-opt-output"][value="single"]').check()
    if s.run(page):
        im = Image.open(s.download(page, 0))
        s.expect(im.size == (827, 1063) and tuple(round(x) for x in im.info.get('dpi', (0, 0))) == (600, 600), f'single photo 600 dpi: {im.size} {im.info.get("dpi")}')
    s.check_page(page); page.close()

    # 5) invoice: German "1.000" = 1000 €, precise bar hint, sticky bar does not cover the focused field (keyboard open)
    ctx = s.context('phone', 'de', viewport={'width': 360, 'height': 330})
    page = s.open(ctx, '/werkzeuge/rechnung-schreiben/')
    page.wait_for_selector('.new-item')
    hint = page.locator('.wt-bar-hint').inner_text()
    s.expect('Rechnungsnummer' not in hint and 'Position' in hint, f'hint names only what is missing (number is prefilled): {hint!r}')
    li = page.locator('.new-item').first
    li.locator('textarea').fill('Beratung'); li.locator('input[id^="new-inv-price-"]').fill('1.000')
    s.expect('1.190,00' in page.locator('.new-sum').inner_text(), f'1.000 € net + 19 %: {page.locator(".new-sum").inner_text()!r}')
    bad = page.evaluate("""() => { const b = document.querySelector('.wt-bar'); const out = [];
      for (const i of [...document.querySelectorAll('#wt-app input.wt-input, #wt-app textarea')].filter(e => e.offsetParent).slice(0, 14)) {
        i.focus(); const r = i.getBoundingClientRect(), br = b.getBoundingClientRect(); if (r.bottom > br.top + 2 && r.top < br.bottom) out.push(i.id); }
      return out; }""")
    s.expect(not bad, f'fields under the sticky bar while typing: {bad}')
    page.locator('input[id^="new-inv-rCity-"]').focus(); page.wait_for_timeout(200); s.shot(page, 'aud2_invoice_typing')
    page.locator('input[id^="new-inv-sName-"]').fill('Muster GmbH')
    page.evaluate('() => document.activeElement.blur()')
    out = s.run_and_download(page)
    if out:
        s.expect('1.190,00' in s.pdf_text(out), 'PDF total 1.190,00 €')
    s.check_page(page); page.close()

    # 6) 48 MP photo: reduction is said, not silent
    for path, needle in (('/werkzeuge/bild-komprimieren/', 'verkleinert'), ('/werkzeuge/bild-umwandeln/', 'verkleinert')):
        page = s.open(s.context('phone', 'de'), path)
        s.pick(page, 'aud2/big48mp.jpg'); s.wait_ready(page, 1)
        if s.run(page, timeout=120000):
            row = page.locator('.wt-output').first.inner_text()
            o = s.download(page, 0); im = Image.open(o)
            s.shot(page, 'aud2_bigphoto_note', top='.wt-result')
        s.expect(needle in row and f'{im.size[0]} × {im.size[1]}' in row, f'{path}: reduced size stated: {row!r} vs {im.size}')
        s.check_page(page); page.close()

    # 7) OCR: a PDF that already has text → hint in the bar, files view stays (no error card, nothing downloaded)
    page = s.open(s.context('phone', 'de'), '/werkzeuge/pdf-texterkennung/')
    s.pick(page, 'new_book.pdf'); s.wait_ready(page, 1)
    s.primary(page).click()
    page.wait_for_selector('.wt-bar-hint:not([hidden])', timeout=30000)
    s.expect(page.locator('.wt-error:not([hidden])').count() == 0, 'no error card')
    s.expect('bereits durchsuchbar' in page.locator('.wt-bar-hint').inner_text(), 'hint explains it')
    s.shot(page, 'aud2_ocr_hint')
    s.check_page(page); page.close()

    # 8) scan: the page scrolls when the finger is on the photo; corner handles still drag
    page = s.open(s.context('phone', 'de'), '/werkzeuge/dokument-scannen/')
    s.pick(page, 'img/doc_photo.jpg'); s.wait_ready(page, 1); page.wait_for_selector('.img-scan-handle')
    ed = page.locator('.img-scan-editor'); ed.scroll_into_view_if_needed(); e = ed.bounding_box(); sy = page.evaluate('scrollY')
    tdrag(page, e['x'] + e['width'] / 2, e['y'] + e['height'] / 2, e['x'] + e['width'] / 2, e['y'] + e['height'] / 2 - 200)
    s.expect(page.evaluate('scrollY') > sy + 100, 'page scrolls over the scan photo')
    h = page.locator('.img-scan-handle').first; h.scroll_into_view_if_needed(); hb = h.bounding_box(); sy = page.evaluate('scrollY')
    tdrag(page, hb['x'] + 24, hb['y'] + 24, hb['x'] + 54, hb['y'] + 64)
    hb2 = h.bounding_box()
    s.expect(abs(hb2['x'] - hb['x'] - 30) < 6 and abs(page.evaluate('scrollY') - sy) < 3, f'handle drags without scrolling ({hb2["x"] - hb["x"]})')
    s.shot(page, 'aud2_scan_phone')
    s.check_page(page); page.close()

    # 9) 200 % text at 360 px: page-turn buttons of the preview keep their 44 px touch size
    for path, f, sel in (('/werkzeuge/pdf-schwaerzen/', 'sec_private.pdf', '.sec-nav-btn'), ('/werkzeuge/broschuere-drucken/', 'edit_p10.pdf', '.ed-pv-nav .wt-icon-btn')):
        page = s.open(s.context('phone', 'de', viewport={'width': 320, 'height': 640}), path)
        page.evaluate("() => { document.documentElement.style.fontSize = '200%'; }")
        s.pick(page, f); s.wait_ready(page, 1); page.wait_for_selector(sel); page.wait_for_timeout(600)
        sizes = [page.locator(sel).nth(i).bounding_box() for i in range(page.locator(sel).count())]
        s.expect(sizes and all(b['width'] >= 43.5 and b['height'] >= 43.5 for b in sizes if b), f'{path}: nav buttons {[(round(b["width"]), round(b["height"])) for b in sizes if b]}')
        s.check_page(page); page.close()
