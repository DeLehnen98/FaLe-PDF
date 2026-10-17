"""watermark-pdf: text diagonal on rotated pages, tiled, image with transparency, under/over, page range."""
import subprocess
from uni_testlib import UNI, UNI_WORDS, check_unicode_pdf
from edit_testlib import Suite, FIX, open_tool, wait_preview, set_range, set_value, added_box, pdfjs_added_box, content_count, check_radio

PATHS = {'de': '/werkzeuge/wasserzeichen-einfuegen/', 'en': '/en/tools/watermark-pdf/'}

with Suite('watermark-pdf') as s:
    for v in s.variants():
        shots = v.device == 'phone' and v.lang == 'de'
        page = s.open(v, PATHS[v.lang])
        if shots: s.shot(page, 'watermark-pdf_initial')
        s.pick(page, 'edit_rot.pdf'); s.wait_ready(page, 1)
        page.wait_for_selector('.ed-pv-cv', timeout=20000)
        set_range(page, 'opacity', 50)
        wait_preview(page)
        if shots: s.shot(page, 'watermark-pdf_configured', top='.wt-stage')
        s.check_page(page)
        out = s.run_and_download(page)
        if shots:
            s.shot(page, 'watermark-pdf_result', top='.wt-result')
            page.emulate_media(color_scheme='dark'); s.shot(page, 'watermark-pdf_result_dark', top='.wt-result'); page.emulate_media(color_scheme='light')
        s.check_page(page)
        if out:
            word = 'VERTRAULICH' if v.lang == 'de' else 'CONFIDENTIAL'
            s.expect(content_count(out, f'({word}) Tj') == 4, f'{v}: watermark text on 4 pages')
            for no in range(1, 5):
                bb = added_box(FIX / 'edit_rot.pdf', out, no)
                # diagonal corner to corner, centred, 70 %: wide and tall
                s.expect(bb and abs((bb[0] + bb[2]) / 2 - 0.5) < 0.04 and abs((bb[1] + bb[3]) / 2 - 0.5) < 0.04, f'{v}: page {no} centred {bb}')
                s.expect(bb and bb[2] - bb[0] > 0.5 and bb[3] - bb[1] > 0.5, f'{v}: page {no} diagonal size {bb}')
            ok, msg = s.qpdf_check(out); s.expect(ok, f'{v}: qpdf {msg}')
        page.close()

    ctx = s.context('phone', 'de')
    # tiled, horizontal, under content, only page 2
    page = open_tool(s, ctx, PATHS['de'], 'edit_mixed.pdf')
    check_radio(page, 'layout', 'tile')
    set_value(page, 'rotation', '0')
    set_range(page, 'size', 40)
    check_radio(page, 'layer', 'under')
    set_value(page, 'scope', 'range')
    set_value(page, 'pages', '2')
    set_value(page, 'text', 'MUSTER')
    wait_preview(page)
    s.expect(page.locator('.ed-zones').is_hidden(), 'zones hidden when tiled')
    out = s.run_and_download(page)
    if out:
        n = content_count(out, '(MUSTER) Tj')
        s.expect(n >= 4, f'tiled: several copies ({n})')
        s.expect(added_box(FIX / 'edit_mixed.pdf', out, 1) is None, 'page 1 unchanged')
        bb = added_box(FIX / 'edit_mixed.pdf', out, 2)
        s.expect(bb and bb[0] < 0.1 and bb[2] > 0.9, f'tiled covers page 2: {bb}')
        s.expect(page.locator('.wt-note').count() >= 1, 'note about "under"')
    page.close()

    # image watermark at top left on offset/rotated page
    page = open_tool(s, ctx, PATHS['de'], 'edit_offset.pdf')
    check_radio(page, 'kind', 'image')
    page.wait_for_selector('.ed-file:not([hidden])')
    wait_preview(page)
    s.expect(page.locator('.ed-pv-warn').is_visible(), 'warn: choose an image')
    page.set_input_files('.ed-file input[type=file]', str(FIX / 'edit_logo.png'))
    page.wait_for_function("() => document.querySelector('.ed-file-name').textContent.includes('edit_logo')")
    set_value(page, 'rotation', '0')
    set_range(page, 'size', 30)
    set_range(page, 'opacity', 100)
    page.locator('.ed-zone-tl').click()
    wait_preview(page)
    s.shot(page, 'watermark-pdf_image', top='.wt-stage')
    out = s.run_and_download(page)
    if out:
        imgs = subprocess.run(['pdfimages', '-list', str(out)], capture_output=True, text=True).stdout
        s.expect('smask' in imgs, 'PNG alpha kept as soft mask')
        for n in (1, 2):
            bb = pdfjs_added_box(page, FIX / 'edit_offset.pdf', out, n)
            s.expect(bb and bb[0] < 0.1 and bb[1] < 0.12 and bb[2] < 0.45, f'image top-left on page {n}: {bb}')
    page.close()

    # Unicode watermark text (bold sans), real text in an embedded subset, no warning
    page = open_tool(s, ctx, PATHS['de'], 'text3.pdf')
    set_value(page, 'rotation', '0')
    set_range(page, 'size', 95)
    set_value(page, 'text', 'Łukasz Kowalski-Müller Ελληνικά')
    wait_preview(page)
    warn = page.locator('.ed-pv-warn')
    s.expect(not (warn.count() and warn.is_visible()), f'no warning for Unicode watermark: {warn.inner_text() if warn.count() else None}')
    out = s.run_and_download(page)
    if out:
        check_unicode_pdf(s, out, ['Łukasz', 'Kowalski-Müller', 'Ελληνικά'], 'watermark')
    page.close()
