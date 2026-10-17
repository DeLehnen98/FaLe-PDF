"""fill-pdf-form: all AcroForm field types incl. rotated page, umlauts rendered (pdftoppm) and extractable after
flattening, inputmode/type hints, preview tap → input, protected input, PDF without fields (detected lines)."""
from wtlib import Suite
from uni_testlib import UNI_WORDS, check_unicode_pdf, pdffonts
import pypdf

PATHS = {'de': '/werkzeuge/pdf-formular-ausfuellen/', 'en': '/en/tools/fill-pdf-form/'}

def field(page, label):
    return page.locator('.sec-field', has=page.locator(f'label:text-is("{label}")')).locator('input, textarea, select').first

def ink(img, box):
    x0, y0, x1, y1 = box
    return sum(1 for x in range(x0, x1) for y in range(y0, y1) if sum(img.getpixel((x, y))) < 300)

with Suite('sec-fill') as s:
    for v in s.variants():
        page = s.open(v, PATHS[v.lang])
        shots = v.device == 'phone' and v.lang == 'de'
        if shots: s.shot(page, 'fill-pdf-form_phone_initial')
        s.pick(page, 'sec_form.pdf')
        s.wait_ready(page, 1)
        page.wait_for_selector('.sec-form')
        page.wait_for_selector('.sec-page canvas')
        s.expect(page.locator('.sec-fieldset > legend').count() >= 2, f'{v}: grouped by page')
        s.expect(field(page, 'E-Mail').get_attribute('type') == 'email' and field(page, 'Telefon').get_attribute('type') == 'tel', f'{v}: keyboard hints')
        s.expect(field(page, 'Nachname').input_value() == 'Müller', f'{v}: existing value shown')
        # tap a field on the preview → focus its input
        if v.device == 'desktop':
            page.locator('.sec-fbox').first.click()
            s.expect(page.evaluate("() => document.activeElement?.id?.startsWith('sec-ff-')"), f'{v}: preview tap focuses input')
        field(page, 'Vorname').fill('Jürgen')
        field(page, 'Nachname').fill('Größe-Weiß')
        field(page, 'E-Mail').fill('j@beispiel.de')
        field(page, 'Bemerkung').fill('Zeile eins\nÄrger kostet 5 €')
        field(page, 'Kurs').select_option('Gold')
        field(page, 'Tage').select_option('Mittwoch')
        page.locator('.sec-field label', has_text='nein').click()
        page.locator('.sec-field label', has_text='Fotos').click()
        field(page, 'Ort').fill('Saarbrücken, 14.10.2026')
        if shots: s.shot(page, 'fill-pdf-form_phone_configured', top='.sec-form')
        s.check_page(page)
        out = s.run_and_download(page)
        if shots:
            s.shot(page, 'fill-pdf-form_phone_result', top='.wt-result')
            page.emulate_media(color_scheme='dark'); s.shot(page, 'fill-pdf-form_phone_result_dark', top='.wt-result'); page.emulate_media(color_scheme='light')
        s.check_page(page)
        if out:
            f = pypdf.PdfReader(str(out)).get_fields()
            vals = {k: f[k].get('/V') for k in f}
            s.expect(vals['Vorname'] == 'Jürgen' and vals['Nachname'] == 'Größe-Weiß' and vals['Kurs'] == 'Gold' and vals['Schwimmer'] in ('/nein', '/1') and vals['Fotos'] in ('/Yes', '/On'), f'{v}: values {vals}')
            s.expect(vals['Ort'] == 'Saarbrücken, 14.10.2026' and 'Mittwoch' in str(vals['Tage']), f'{v}: page-2 + list values {vals}')
            img = s.render(out, 1, 72)
            s.expect(ink(img, (172, 842 - 718, 300, 842 - 698)) > 40, f'{v}: Vorname appearance drawn')
            ok, msg = s.qpdf_check(out); s.expect(ok, f'{v}: qpdf {msg}')
        page.close()

    # flatten: text must be page content with umlauts
    ctx = s.context('phone', 'en')
    page = s.open(ctx, PATHS['en'])
    s.pick(page, 'sec_form.pdf')
    s.wait_ready(page, 1)
    page.wait_for_selector('.sec-form')
    field(page, 'Nachname').fill('Łukasz Kowalski-Müller')
    field(page, 'Ort').fill('Ελληνικά Привет Türkçe İğ €')
    page.locator('label[for="wt-opt-flatten"]').click()
    out = s.run_and_download(page)
    if out:
        t = s.pdf_text(out)
        r = pypdf.PdfReader(str(out))
        s.expect('Bronze' in t, f'flattened text: {t[:300]!r}')
        check_unicode_pdf(s, out, UNI_WORDS, 'flattened Unicode form')
        s.expect(not r.get_fields() and all(not p.get('/Annots') for p in r.pages), 'no fields after flattening')
        s.expect(r.pages[1].get('/Rotate') == 90, 'rotation kept')
    s.check_page(page)
    page.close()

    # AcroForm, not flattened: Unicode values get appearance streams with the embedded Unicode font (viewers show
    # them without regenerating), the values themselves are stored unchanged
    page = s.open(ctx, PATHS['en'])
    s.pick(page, 'sec_form.pdf')
    s.wait_ready(page, 1)
    page.wait_for_selector('.sec-form')
    field(page, 'Vorname').fill('Łukasz Ж Ω €')
    field(page, 'Nachname').fill('Kowalski-Müller Türkçe İğ')
    out = s.run_and_download(page)
    if out:
        r = pypdf.PdfReader(str(out))
        f = r.get_fields()
        s.expect(f['Vorname'].get('/V') == 'Łukasz Ж Ω €' and f['Nachname'].get('/V') == 'Kowalski-Müller Türkçe İğ', f'Unicode values stored: {f["Vorname"].get("/V")!r}')
        acro = r.trailer['/Root']['/AcroForm']
        s.expect(not acro.get('/NeedAppearances'), 'appearances generated, NeedAppearances not needed')
        s.expect('CID TrueType' in pdffonts(out), 'appearance uses the embedded Unicode subset')
        img = s.render(out, 1, 72)
        s.expect(ink(img, (172, 842 - 718, 300, 842 - 698)) > 40, 'Unicode Vorname appearance drawn (poppler)')
        ok, msg = s.qpdf_check(out); s.expect(ok, f'qpdf {msg}')
        rt = page.locator('.wt-result').inner_text()
        s.expect('cannot show' not in rt, f'no replacement note: {rt[:200]!r}')
        # the appearance stream really contains the text: flatten it with qpdf and extract
        import subprocess
        flat = out.parent / 'uni_flat.pdf'
        subprocess.run(['qpdf', '--flatten-annotations=all', str(out), str(flat)], check=False)
        t = s.pdf_text(flat)
        s.expect('Łukasz Ж Ω €' in t and 'Kowalski-Müller Türkçe İğ' in t, f'appearance text extractable: {t[:200]!r}')
    s.check_page(page)
    page.close()

    # protected input + PDF without fields
    ctx = s.context('desktop', 'de')
    page = s.open(ctx, PATHS['de'])
    s.pick(page, 'sec_form_enc.pdf')
    s.wait_ready(page, 1)
    page.fill('.wt-lock input', 'geheim'); page.click('.wt-lock button')
    page.wait_for_selector('.sec-form')
    field(page, 'Vorname').fill('Änne')
    out = s.run_and_download(page)
    if out:
        r = pypdf.PdfReader(str(out))
        s.expect(r.is_encrypted, 'stays encrypted')
        r.decrypt('geheim')
        s.expect(r.get_fields()['Vorname'].get('/V') == 'Änne', 'encrypted form filled')
    page.locator('.wt-restart button').nth(1).click()
    s.pick(page, 'sec_blank.pdf')
    s.wait_ready(page, 1)
    page.wait_for_selector('.sec-form')
    n = page.locator('.sec-field').count()
    s.expect(n >= 3, f'detected fields: {n}')
    page.locator('.sec-field input[type=text], .sec-field textarea').first.fill('Erika Muster-Öz Łukasz Привет')
    page.locator('.sec-field input[type=checkbox]').first.check() if page.locator('.sec-field input[type=checkbox]').count() else None
    if s.shot: s.shot(page, 'fill-pdf-form_desktop_detected', top='.sec-form')
    out = s.run_and_download(page)
    if out:
        s.expect('Erika Muster-Öz Łukasz Привет' in s.pdf_text(out), f'detected field written onto page: {s.pdf_text(out)[:200]!r}')
        s.expect('CID TrueType' in pdffonts(out), 'detected field: embedded Unicode subset')
    s.check_page(page)
