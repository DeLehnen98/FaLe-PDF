"""overlay-pdf: letterhead first page / following pages, under the text, rotated targets, image design."""
from pypdf import PdfReader
from edit_testlib import Suite, FIX, open_tool, wait_preview, set_value, check_radio, render

PATHS = {'de': '/werkzeuge/briefpapier-pdf/', 'en': '/en/tools/pdf-letterhead-overlay/'}
TEAL = (13, 115, 107)


def teal_share(img, box):
    w, h = img.size
    reg = img.crop((int(box[0] * w), int(box[1] * h), int(box[2] * w), int(box[3] * h)))
    px = list(reg.getdata())
    return sum(1 for p in px if abs(p[0] - TEAL[0]) < 40 and abs(p[1] - TEAL[1]) < 40 and abs(p[2] - TEAL[2]) < 40) / max(1, len(px))


with Suite('overlay-pdf') as s:
    for v in s.variants():
        shots = v.device == 'phone' and v.lang == 'de'
        page = s.open(v, PATHS[v.lang])
        if shots: s.shot(page, 'overlay-pdf_initial')
        s.pick(page, 'edit_letter.pdf'); s.wait_ready(page, 1)
        page.wait_for_selector('.ed-pv-cv', timeout=20000)
        wait_preview(page)
        s.expect(page.locator('.ed-pv-warn').is_visible(), f'{v}: asks for the letterhead')
        page.set_input_files('.ed-file >> nth=0 >> input[type=file]', str(FIX / 'edit_letterhead.pdf'))
        page.wait_for_function("() => document.getElementById('wt-opt-follow').value === 'page2'")
        wait_preview(page)
        if shots: s.shot(page, 'overlay-pdf_configured', top='.wt-stage')
        s.check_page(page)
        out = s.run_and_download(page)
        if shots:
            s.shot(page, 'overlay-pdf_result', top='.wt-result')
            page.emulate_media(color_scheme='dark'); s.shot(page, 'overlay-pdf_result_dark', top='.wt-result'); page.emulate_media(color_scheme='light')
        s.check_page(page)
        if out:
            r = PdfReader(str(out))
            t = [p.extract_text() for p in r.pages]
            s.expect('Erstseite' in t[0] and 'Brieftext Seite 1' in t[0], f'{v}: page 1 {t[0]!r}')
            s.expect(all('Folgeseite' in x and 'Erstseite' not in x for x in t[1:]), f'{v}: following pages {t[1:]}')
            # under: the letterhead is drawn before the letter text
            s.expect(t[0].index('Musterfirma') < t[0].index('Brieftext'), f'{v}: letterhead under the text')
            img = render(out, 1, 30)
            s.expect(teal_share(img, (0, 0, 1, 0.08)) > 0.8, f'{v}: teal header on page 1')
            ok, msg = s.qpdf_check(out); s.expect(ok, f'{v}: qpdf {msg}')
        page.close()

    ctx = s.context('phone', 'de')
    # rotated target pages, over, same design everywhere → header bar at the visual top of every page
    page = open_tool(s, ctx, PATHS['de'], 'edit_rot.pdf')
    page.set_input_files('.ed-file >> nth=0 >> input[type=file]', str(FIX / 'edit_letterhead.pdf'))
    page.wait_for_function("() => document.getElementById('wt-opt-follow').value === 'page2'")
    set_value(page, 'follow', 'same')
    check_radio(page, 'layer', 'over')
    check_radio(page, 'fit', 'stretch')
    out = s.run_and_download(page)
    if out:
        for n in range(1, 5):
            img = render(out, n, 30)
            s.expect(teal_share(img, (0, 0, 1, 0.06)) > 0.8, f'rotated page {n}: header at visual top ({teal_share(img, (0, 0, 1, 0.06)):.2f})')
    page.close()

    # image design + second file for following pages; follow = none
    page = open_tool(s, ctx, PATHS['de'], 'edit_letter.pdf')
    page.set_input_files('.ed-file >> nth=0 >> input[type=file]', str(FIX / 'edit_logo.png'))
    set_value(page, 'follow', 'none')
    wait_preview(page)
    out = s.run_and_download(page)
    if out:
        a, b = render(out, 1, 30), render(out, 2, 30)
        red = lambda im: sum(1 for p in im.getdata() if p[0] > 150 and p[1] < 120 and p[2] < 140)
        s.expect(red(a) > 1000 and red(b) == 0, f'logo only on page 1 ({red(a)}, {red(b)})')
    page.close()
