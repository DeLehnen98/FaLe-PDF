"""add-page-numbers: positions on rotated / offset-CropBox pages, formats, skip, mirror, preview, password."""
from uni_testlib import UNI, UNI_WORDS, check_unicode_pdf
from edit_testlib import Suite, FIX, words, find, open_tool, wait_preview, set_range, set_value, added_box, pdfjs_added_box

PATHS = {'de': '/werkzeuge/seitenzahlen-einfuegen/', 'en': '/en/tools/add-page-numbers/'}

with Suite('add-page-numbers') as s:
    for v in s.variants():
        shots = v.device == 'phone' and v.lang == 'de'
        page = s.open(v, PATHS[v.lang])
        if shots: s.shot(page, 'add-page-numbers_initial')
        s.pick(page, 'edit_rot.pdf')
        s.wait_ready(page, 1)
        page.wait_for_selector('.ed-pv-cv', timeout=20000)
        wait_preview(page)
        s.expect(page.locator('.ed-zone').count() == 9, f'{v}: 9 position zones')
        # default bottom centre, format "Seite 1 von 10"
        set_value(page, 'format', 'page-of')
        wait_preview(page)
        # swipe/next to page 2 in the preview
        page.locator('.ed-pv-nav button').nth(1).click()
        wait_preview(page)
        s.expect(('2 von 4' if v.lang == 'de' else '2 of 4') in page.locator('.ed-pv-label').inner_text(), f'{v}: preview page 2')
        if shots: s.shot(page, 'add-page-numbers_configured', top='.wt-stage')
        s.check_page(page)
        out = s.run_and_download(page)
        if shots:
            s.shot(page, 'add-page-numbers_result', top='.wt-result')
            page.emulate_media(color_scheme='dark'); s.shot(page, 'add-page-numbers_result_dark', top='.wt-result'); page.emulate_media(color_scheme='light')
        s.check_page(page)
        if out:
            ok, msg = s.qpdf_check(out); s.expect(ok, f'{v}: qpdf {msg}')
            word = 'Seite' if v.lang == 'de' else 'Page'
            txt = s.pdf_text(out)
            for no in range(1, 5):
                s.expect(f"{word} {no} {'von' if v.lang == 'de' else 'of'} 4" in txt, f'{v}: text for page {no}')
                bb = added_box(FIX / 'edit_rot.pdf', out, no)
                s.expect(bb and bb[1] > 0.93 and abs((bb[0] + bb[2]) / 2 - 0.5) < 0.02, f'{v}: page {no}: number not at visual bottom centre: {bb}')
        page.close()

    # offset CropBox + rotation, top right, mirror, skip first page, roman numerals
    ctx = s.context('phone', 'de')
    page = open_tool(s, ctx, PATHS['de'], 'edit_offset.pdf')
    page.locator('.ed-zone-tr').click()
    s.expect(page.locator('.ed-zone-tr').get_attribute('aria-checked') == 'true', 'zone tr checked')
    set_value(page, 'format', 'roman-upper')
    set_value(page, 'scope', 'skip')
    set_value(page, 'skip', '0')
    set_value(page, 'start', '1')
    page.locator('label[for="wt-opt-mirror"]').click()
    s.expect(page.locator('#wt-opt-mirror').is_checked(), 'mirror on')
    out = s.run_and_download(page)
    if out:
        txt = s.pdf_text(out)
        s.expect('I' in txt.split() and 'II' in txt.split(), f'offset: roman numerals {txt.split()[-6:]}')
        b1 = pdfjs_added_box(page, FIX / 'edit_offset.pdf', out, 1)
        b2 = pdfjs_added_box(page, FIX / 'edit_offset.pdf', out, 2)
        s.expect(b1 and b1[1] < 0.1 and b1[2] > 0.85, f'offset p1 top right: {b1}')
        s.expect(b2 and b2[1] < 0.1 and b2[0] < 0.15, f'offset p2 (rotated, mirrored) top left: {b2}')
    page.close()

    # skip cover, custom text with Polish + a character no font here has (✓) → real ł, warning only for ✓
    page = open_tool(s, ctx, PATHS['de'], 'edit_120.pdf')
    set_value(page, 'scope', 'skip')
    set_value(page, 'skip', '1')
    set_value(page, 'format', 'custom')
    set_value(page, 'custom', 'Anlage ł {n}/{total} ✓')
    wait_preview(page)
    warn = page.locator('.ed-pv-warn')
    wt = warn.inner_text() if warn.count() and warn.is_visible() else ''
    s.expect('✓' in wt and 'ł' not in wt, f'warning only for the unsupported ✓: {wt!r}')
    out = s.run_and_download(page)
    if out:
        txt = s.pdf_text(out)
        s.expect('Anlage ł 1/119' in txt and 'Anlage ł 119/119' in txt, 'custom numbering 1..119 with real ł')
        first = words(out)[0][3]
        s.expect(not find(first, 'Anlage'), 'cover page must have no number')
        s.expect(page.locator('.wt-note').count() >= 1, 'result note about the replaced ✓')
    page.close()

    # Unicode: Polish, Greek, Cyrillic, Turkish, € stay real text (embedded subset), no warning
    page = open_tool(s, ctx, PATHS['en'], 'text3.pdf')
    set_value(page, 'format', 'custom')
    set_value(page, 'custom', UNI + ' {n}')
    wait_preview(page)
    warn = page.locator('.ed-pv-warn')
    s.expect(not (warn.count() and warn.is_visible()), f'no warning for Latin/Greek/Cyrillic: {warn.inner_text() if warn.count() else None}')
    out = s.run_and_download(page)
    if out:
        check_unicode_pdf(s, out, UNI_WORDS + ['€ 1'], 'page numbers')
        s.expect(page.locator('.wt-note').count() == 0, 'no replacement note')
    page.close()

    # password protected: stays protected
    page = s.open(ctx, PATHS['de'])
    s.pick(page, 'encrypted_aes256.pdf'); s.wait_ready(page, 1)
    page.fill('.wt-lock input', 'geheim'); page.click('.wt-lock button')
    page.wait_for_function("() => !document.querySelector('.wt-file.is-locked')")
    page.wait_for_selector('.ed-pv-cv', timeout=20000)
    out = s.run_and_download(page)
    if out:
        s.expect(s.pdf_info(out)['_rc'] != 0, 'result should need the password')
        s.expect('1' in s.pdf_text(out, 'geheim'), 'text with password')
    page.close()
