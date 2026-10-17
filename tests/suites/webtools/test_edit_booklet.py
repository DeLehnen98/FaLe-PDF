"""booklet: saddle-stitch order verified from the output (6 pages → 8 with blanks before the back), signatures, RTL."""
from edit_testlib import Suite, FIX, open_tool, wait_preview, set_value, check_radio, words
from booklet_order import reading_sequence, expected_pages

PATHS = {'de': '/werkzeuge/broschuere-drucken/', 'en': '/en/tools/pdf-booklet/'}


def sides(path):
    """[(left marker, right marker)] per output page; 0 = blank"""
    res = []
    for no, pw, ph, ws in words(path):
        l = r = 0
        for k, w in enumerate(ws):
            n = None
            if w[4].startswith('marker'): n = int(w[4][6:])
            elif w[4] == 'page' and k + 1 < len(ws) and ws[k + 1][4].isdigit(): n = int(ws[k + 1][4])
            if n is None: continue
            if (w[0] + w[2]) / 2 < pw / 2: l = n
            else: r = n
        res.append((l, r))
    return res


with Suite('booklet') as s:
    for v in s.variants():
        shots = v.device == 'phone' and v.lang == 'de'
        page = s.open(v, PATHS[v.lang])
        if shots: s.shot(page, 'booklet_initial')
        s.pick(page, 'edit_p6.pdf'); s.wait_ready(page, 1)
        page.wait_for_selector('.ed-pv-cv', timeout=20000)
        wait_preview(page)
        s.expect('2' in page.locator('.ed-pv-extra .ed-hint').inner_text(), f'{v}: blank page info')
        if shots: s.shot(page, 'booklet_configured', top='.wt-stage')
        s.check_page(page)
        out = s.run_and_download(page)
        if shots:
            s.shot(page, 'booklet_result', top='.wt-result')
            page.emulate_media(color_scheme='dark'); s.shot(page, 'booklet_result_dark', top='.wt-result'); page.emulate_media(color_scheme='light')
        s.check_page(page)
        if out:
            got = sides(out)
            # 6 pages + 2 blanks before the back cover: [1,2,3,4,5,_,_,6]
            want = [(6, 1), (2, 0), (0, 3), (4, 5)]
            s.expect(got == want, f'{v}: booklet order {got} != {want}')
            s.expect(reading_sequence(got) == expected_pages(6, 'beforeBack'), f'{v}: folded booklet reads 1..6: {reading_sequence(got)}')
            w, h = s.page_sizes(out)[0]
            s.expect(abs(w - 841.89) < 1 and abs(h - 595.28) < 1, f'{v}: A4 landscape sheets {w}x{h}')
            txt = page.locator('.wt-result').inner_text()
            s.expect(('kurzen Kante' in txt) if v.lang == 'de' else ('short edge' in txt), f'{v}: printing instructions')
        page.close()

    ctx = s.context('phone', 'de')
    page = open_tool(s, ctx, PATHS['de'], 'edit_120.pdf')
    set_value(page, 'signature', '4')
    check_radio(page, 'blanks', 'end')
    out = s.run_and_download(page)
    if out:
        txt_pages = s.pdf_pages(out)
        s.expect(txt_pages == 60, f'120 pages → 30 sheets = 60 sides, got {txt_pages}')
        ws = words(out)
        first = ' '.join(w[4] for w in ws[0][3])
        s.expect('16' in first and ' 1' in first, f'first side of first signature shows 16 | 1: {first}')
        allsides = sides(out)
        for b in range(8):
            chunk = allsides[b * 8:(b + 1) * 8]
            seq = reading_sequence(chunk)
            want = list(range(16 * b + 1, min(120, 16 * b + 16) + 1))
            s.expect(seq == want, f'signature {b + 1} reads {seq}')
    page.close()

    page = open_tool(s, ctx, PATHS['de'], 'edit_p10.pdf')
    check_radio(page, 'binding', 'right')
    check_radio(page, 'blanks', 'end')
    out = s.run_and_download(page)
    if out:
        got = sides(out)
        s.expect(reading_sequence(got, rtl=True) == expected_pages(10, 'end'), f'RTL reads 1..10: {reading_sequence(got, rtl=True)} from {got}')
    page.close()
