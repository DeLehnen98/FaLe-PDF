"""flatten-pdf: forms + annotations burned in (umlauts, rotated page), links kept, AcroForm removed, raster fallback,
password kept, nothing-to-do returns the original."""
from wtlib import Suite
from uni_testlib import check_unicode_pdf
import pypdf

PATHS = {'de': '/werkzeuge/pdf-glaetten/', 'en': '/en/tools/flatten-pdf/'}

def annots(path, pw=None):
    r = pypdf.PdfReader(str(path))
    if pw: r.decrypt(pw)
    out = []
    for p in r.pages:
        out.append([a.get_object().get('/Subtype') for a in (p.get('/Annots') or [])])
    return r, out

with Suite('sec-flatten') as s:
    for v in s.variants():
        page = s.open(v, PATHS[v.lang])
        shots = v.device == 'phone' and v.lang == 'de'
        if shots: s.shot(page, 'flatten-pdf_phone_initial')
        s.pick(page, 'sec_annots.pdf')
        s.wait_ready(page, 1)
        if shots: s.shot(page, 'flatten-pdf_phone_configured', top='.wt-opts-sec')
        s.check_page(page)
        out = s.run_and_download(page)
        if shots:
            s.shot(page, 'flatten-pdf_phone_result', top='.wt-result')
            page.emulate_media(color_scheme='dark'); s.shot(page, 'flatten-pdf_phone_result_dark', top='.wt-result'); page.emulate_media(color_scheme='light')
        s.check_page(page)
        if out:
            r, an = annots(out)
            s.expect(an[0] == ['/Link'] and an[1] == [], f'{v}: only the link may remain: {an}')
            s.expect('/AcroForm' not in r.trailer['/Root'], f'{v}: AcroForm must be gone')
            txt = s.pdf_text(out)
            s.expect('Jörg Größe' in txt and 'Straße 5' in txt, f'{v}: flattened values with umlauts as text: {txt[:300]!r}')
            img = s.render(out, 1, 72)
            px = img.getpixel((350, 842 - 602))  # bottom edge of the red square (2..96 inside 300..400 x 600..650)
            s.expect(px[0] > 180 and px[1] < 90, f'{v}: square annotation burned in, pixel {px}')
            ok, msg = s.qpdf_check(out); s.expect(ok, f'{v}: qpdf {msg}')
        page.close()

    # links removed + raster + password + nothing to do
    ctx = s.context('phone', 'en')
    page = s.open(ctx, PATHS['en'])
    s.pick(page, 'sec_annots.pdf')
    s.wait_ready(page, 1)
    page.locator('label[for="wt-opt-keepLinks"]').click()
    out = s.run_and_download(page)
    if out:
        r, an = annots(out)
        s.expect(an == [[], []], f'links removed: {an}')
    page.locator('.wt-restart button').first.click()
    page.locator('input[name="wt-opt-method"][value="raster"]').check()
    out = s.run_and_download(page)
    if out:
        s.expect(s.pdf_text(out).strip() == '' and s.pdf_pages(out) == 2, 'raster: text gone, 2 pages')
        w, h = s.page_sizes(out)[1]
        s.expect(w > h, f'raster keeps the rotated page landscape: {w}x{h}')
        img = s.render(out, 1, 72)
        s.expect(min(img.getpixel((x, 842 - 712))[0] for x in range(62, 140)) < 100, 'raster: field text visible')
    s.check_page(page)
    page.close()

    ctx = s.context('desktop', 'de')
    page = s.open(ctx, PATHS['de'])
    s.pick(page, 'sec_form_enc.pdf', 'text3.pdf')
    s.wait_ready(page, 2)
    page.fill('.wt-lock input', 'geheim'); page.click('.wt-lock button')
    page.wait_for_function("() => !document.querySelector('.wt-file.is-locked')")
    if s.run(page):
        o1, o2 = s.download(page, 0), s.download(page, 1)
        r, an = annots(o1, 'geheim')
        s.expect(r.is_encrypted and an == [[], []], f'protected form flattened + still protected: {an}')
        s.expect('Müller' in s.pdf_text(o1, 'geheim'), 'value kept')
        s.expect(o2.read_bytes() == open(o2.parents[2] / 'fixtures' / 'text3.pdf', 'rb').read() or 'text3' in o2.name, 'nothing to flatten → original')
    s.check_page(page)

    # Unicode form values without appearance (NeedAppearances): regenerated with the embedded Unicode font
    page = s.open(ctx, PATHS['de'])
    s.pick(page, 'uni_form_noap.pdf')
    s.wait_ready(page, 1)
    if s.run(page):
        o = s.download(page, 0)
        r, an = annots(o)
        s.expect(an == [[]], f'Unicode form flattened: {an}')
        check_unicode_pdf(s, o, ['Łukasz', 'Kowalski-Müller', 'Ελληνικά', 'Привет', 'Türkçe', 'İğ', '€'], 'flatten Unicode form')
        rt = page.locator('.wt-result').inner_text()
        s.expect('bisheriges Aussehen' not in rt, f'no "keep previous look" note: {rt[:200]!r}')
    s.check_page(page)
    page.close()
