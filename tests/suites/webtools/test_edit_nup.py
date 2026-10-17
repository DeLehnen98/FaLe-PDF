"""n-up: reading orders, sheet count, rotated pages upright, page range, password kept."""
from edit_testlib import Suite, FIX, open_tool, wait_preview, set_value, set_range, check_radio, words, find, render, look_diff

PATHS = {'de': '/werkzeuge/mehrere-seiten-pro-blatt/', 'en': '/en/tools/pages-per-sheet/'}


def centres(path):
    res = []
    for no, pw, ph, ws in words(path):
        cs = {}
        for w in ws:
            if w[4].startswith('marker'):
                cs[int(w[4][6:])] = ((w[0] + w[2]) / 2 / pw, (w[1] + w[3]) / 2 / ph)
        res.append(cs)
    return res


with Suite('n-up') as s:
    for v in s.variants():
        shots = v.device == 'phone' and v.lang == 'de'
        page = s.open(v, PATHS[v.lang])
        if shots: s.shot(page, 'n-up_initial')
        s.pick(page, 'edit_p10.pdf'); s.wait_ready(page, 1)
        page.wait_for_selector('.ed-pv-cv', timeout=20000)
        wait_preview(page)
        s.expect(('1 von 3' if v.lang == 'de' else '1 of 3') in page.locator('.ed-pv-label').inner_text(), f'{v}: 3 sheets in preview')
        if shots: s.shot(page, 'n-up_configured', top='.wt-stage')
        s.check_page(page)
        out = s.run_and_download(page)
        if shots:
            s.shot(page, 'n-up_result', top='.wt-result')
            page.emulate_media(color_scheme='dark'); s.shot(page, 'n-up_result_dark', top='.wt-result'); page.emulate_media(color_scheme='light')
        s.check_page(page)
        if out:
            s.expect(s.pdf_pages(out) == 3, f'{v}: 3 sheets')
            c = centres(out)
            s.expect(sorted(c[0]) == [1, 2, 3, 4] and sorted(c[2]) == [9, 10], f'{v}: pages per sheet {[sorted(x) for x in c]}')
            p = c[0]
            s.expect(p[1][0] < p[2][0] and abs(p[1][1] - p[2][1]) < 0.02 and p[3][1] > p[1][1] + 0.3, f'{v}: Z order {p}')
            s.expect(s.page_sizes(out)[0] == (595.28, 841.89) or s.page_sizes(out)[0][0] < s.page_sizes(out)[0][1], f'{v}: portrait A4 for 4-up of portrait pages')
        page.close()

    ctx = s.context('phone', 'de')
    # column order, 6 per sheet, range
    page = open_tool(s, ctx, PATHS['de'], 'edit_p10.pdf')
    check_radio(page, 'per', '6')
    set_value(page, 'order', 'col')
    set_value(page, 'scope', 'range')
    set_value(page, 'pages', '10-5')
    out = s.run_and_download(page)
    if out:
        c = centres(out)
        s.expect(s.pdf_pages(out) == 1 and sorted(c[0]) == [5, 6, 7, 8, 9, 10], f'range 10-5 on one sheet: {c}')
        p = c[0]
        # auto orientation → landscape 3 × 2 grid; column order: 10 above 9, then 8 above 7 in the next column
        s.expect(abs(p[10][0] - p[9][0]) < 0.02 and p[10][1] < p[9][1] and abs(p[8][1] - p[10][1]) < 0.02 and p[8][0] > p[10][0] + 0.2 and p[6][0] > p[8][0] + 0.2, f'column order {p}')
    page.close()

    # rotated pages stay upright: 2 per sheet, one page per sheet each via range
    page = open_tool(s, ctx, PATHS['de'], 'edit_rot.pdf')
    check_radio(page, 'per', '2')
    page.locator('label[for="wt-opt-frame"]').click()
    out = s.run_and_download(page)
    if out:
        s.expect(s.pdf_pages(out) == 2, 'two sheets')
        for sheet in (1, 2):
            img = render(out, sheet, 50)
            for half, pg in ((0, 2 * sheet - 1), (1, 2 * sheet)):
                src = render(FIX / 'edit_rot.pdf', pg, 50)
                w, h = img.size
                region = (0, half / 2, 1, (half + 1) / 2) if h > w else (half / 2, 0, (half + 1) / 2, 1)
                d = look_diff(src, img, region)
                s.expect(d < 25, f'sheet {sheet} page {pg} looks like the original (diff {d:.1f})')
    page.close()

    page = s.open(ctx, PATHS['de'])
    s.pick(page, 'encrypted_aes256.pdf'); s.wait_ready(page, 1)
    page.fill('.wt-lock input', 'geheim'); page.click('.wt-lock button')
    page.wait_for_function("() => !document.querySelector('.wt-file.is-locked')")
    page.wait_for_selector('.ed-pv-cv', timeout=20000)
    out = s.run_and_download(page)
    if out:
        s.expect(s.pdf_info(out)['_rc'] != 0 and s.pdf_info(out, 'geheim')['_rc'] == 0, 'password kept')
    page.close()
