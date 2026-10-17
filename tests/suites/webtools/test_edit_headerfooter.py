"""header-footer: placeholders (DE/EN), token chips, Bates, skip cover, rotated + offset pages."""
from uni_testlib import UNI_WORDS, check_unicode_pdf
from edit_testlib import Suite, FIX, open_tool, wait_preview, set_value, added_box, pdfjs_added_box

PATHS = {'de': '/werkzeuge/kopf-und-fusszeile/', 'en': '/en/tools/header-footer-pdf/'}

with Suite('header-footer') as s:
    for v in s.variants():
        shots = v.device == 'phone' and v.lang == 'de'
        page = s.open(v, PATHS[v.lang])
        if shots: s.shot(page, 'header-footer_initial')
        s.pick(page, 'edit_rot.pdf'); s.wait_ready(page, 1)
        page.wait_for_selector('.ed-pv-cv', timeout=20000)
        # header centre via chip insertion
        page.locator('#wt-opt-hc').fill('Akte ' if v.lang == 'de' else 'File ')
        page.locator('#wt-opt-hc').focus()
        page.locator('.ed-tokens button').nth(4).click()  # {titel}/{title}
        s.expect(page.locator('#wt-opt-hc').input_value().endswith('{titel}' if v.lang == 'de' else '{title}'), f'{v}: chip inserted: {page.locator("#wt-opt-hc").input_value()}')
        wait_preview(page)
        if shots: s.shot(page, 'header-footer_configured', top='.wt-stage')
        s.check_page(page)
        out = s.run_and_download(page)
        if shots:
            s.shot(page, 'header-footer_result', top='.wt-result')
            page.emulate_media(color_scheme='dark'); s.shot(page, 'header-footer_result_dark', top='.wt-result'); page.emulate_media(color_scheme='light')
        s.check_page(page)
        if out:
            txt = s.pdf_text(out)
            word = ('Seite', 'von', 'Akte') if v.lang == 'de' else ('Page', 'of', 'File')
            for n in range(1, 5):
                s.expect(f'{word[0]} {n} {word[1]} 4' in txt, f'{v}: footer page {n}')
            s.expect(f'{word[2]} edit_rot' in txt, f'{v}: header with title fallback = file name')
            s.expect(txt.count('edit_rot') >= 8, f'{v}: file name in footer left')
            for n in range(1, 5):
                bb = added_box(FIX / 'edit_rot.pdf', out, n)
                s.expect(bb and bb[1] < 0.06 and bb[3] > 0.94, f'{v}: page {n} header + footer at visual top and bottom: {bb}')
        page.close()

    ctx = s.context('phone', 'de')
    page = open_tool(s, ctx, PATHS['de'], 'edit_120.pdf')
    for sl in ('fl', 'fr'):
        page.locator(f'#wt-opt-{sl}').fill('')
    page.locator('#wt-opt-hr').fill('{datum}')
    set_value(page, 'scope', 'skip')
    page.locator('label[for="wt-opt-bates"]').click()
    set_value(page, 'batesPrefix', 'AKTE-')
    set_value(page, 'batesDigits', '5')
    set_value(page, 'batesStart', '41')
    wait_preview(page)
    out = s.run_and_download(page)
    if out:
        txt = s.pdf_text(out)
        s.expect('AKTE-00041' in txt and 'AKTE-00159' in txt and 'AKTE-00160' not in txt, 'bates 41..159 on 119 pages')
        import datetime
        s.expect(datetime.date.today().strftime('%d.%m.%Y') in txt, 'date placeholder')
        s.expect(added_box(FIX / 'edit_120.pdf', out, 1) is None, 'cover untouched')
        s.expect('00160' in page.locator('.wt-result').inner_text(), 'note tells the next start number')
    page.close()

    page = open_tool(s, ctx, PATHS['de'], 'edit_offset.pdf')
    page.locator('#wt-opt-hl').fill('LINKS OBEN')
    page.locator('#wt-opt-fr').fill('')
    page.locator('#wt-opt-fl').fill('')
    out = s.run_and_download(page)
    if out:
        for n in (1, 2):
            bb = pdfjs_added_box(page, FIX / 'edit_offset.pdf', out, n)
            s.expect(bb and bb[0] < 0.1 and bb[1] < 0.1 and bb[2] < 0.5, f'offset page {n}: header left top {bb}')
    page.close()

    # Unicode in header and footer (serif chosen: falls back to the embedded sans face), no warning
    page = open_tool(s, ctx, PATHS['de'], 'text3.pdf')
    set_value(page, 'font', 'serif')
    page.locator('#wt-opt-hl').fill('Łukasz Kowalski-Müller')
    page.locator('#wt-opt-hr').fill('Ελληνικά Привет')
    page.locator('#wt-opt-fl').fill('Türkçe İğ €')
    page.locator('#wt-opt-fr').fill('')
    wait_preview(page)
    warn = page.locator('.ed-pv-warn')
    s.expect(not (warn.count() and warn.is_visible()), f'no warning for Unicode header: {warn.inner_text() if warn.count() else None}')
    out = s.run_and_download(page)
    if out:
        check_unicode_pdf(s, out, UNI_WORDS, 'header-footer')
    page.close()
