"""resize-pdf: mixed sizes → A4 (auto orientation), rotated pages baked in, offset CropBox + bleed, annotations follow."""
import subprocess
from pypdf import PdfReader
from edit_testlib import Suite, FIX, open_tool, wait_preview, set_value, set_range, check_radio, render, dark_box

PATHS = {'de': '/werkzeuge/seitengroesse-aendern/', 'en': '/en/tools/resize-pdf/'}


def norm_box(img):
    b = dark_box(img)
    w, h = img.size
    return (b[0] / w, b[1] / h, b[2] / w, b[3] / h) if b else None


with Suite('resize-pdf') as s:
    for v in s.variants():
        shots = v.device == 'phone' and v.lang == 'de'
        page = s.open(v, PATHS[v.lang])
        if shots: s.shot(page, 'resize-pdf_initial')
        s.pick(page, 'edit_mixed.pdf'); s.wait_ready(page, 1)
        page.wait_for_selector('.ed-pv-cv', timeout=20000)
        wait_preview(page)
        s.expect('mm' in page.locator('.ed-pv-extra .ed-hint').inner_text(), f'{v}: preview status line')
        if shots: s.shot(page, 'resize-pdf_configured', top='.wt-stage')
        s.check_page(page)
        out = s.run_and_download(page)
        if shots:
            s.shot(page, 'resize-pdf_result', top='.wt-result')
            page.emulate_media(color_scheme='dark'); s.shot(page, 'resize-pdf_result_dark', top='.wt-result'); page.emulate_media(color_scheme='light')
        s.check_page(page)
        if out:
            sz = [tuple(round(x) for x in p) for p in s.page_sizes(out)]
            s.expect(sz == [(595, 842), (842, 595), (595, 842), (595, 842)], f'{v}: sizes {sz}')
            txt = s.pdf_text(out)
            s.expect('Mixed Letter' in txt and 'Mixed A5' in txt, f'{v}: text kept')
            ok, msg = s.qpdf_check(out); s.expect(ok, f'{v}: qpdf {msg}')
        page.close()

    ctx = s.context('phone', 'de')
    # rotated pages → A5, rotation baked in, look identical (same aspect ratio)
    page = open_tool(s, ctx, PATHS['de'], 'edit_rot.pdf')
    set_value(page, 'size', 'a5')
    out = s.run_and_download(page)
    if out:
        r = PdfReader(str(out))
        s.expect(all((p.get('/Rotate') or 0) == 0 for p in r.pages), 'rotation baked in')
        sz = [tuple(round(x) for x in p) for p in s.page_sizes(out)]
        s.expect(sz == [(420, 595), (595, 420), (420, 595), (595, 420)], f'A5 sizes {sz}')
        for n in range(1, 5):
            a, b = norm_box(render(FIX / 'edit_rot.pdf', n, 30)), norm_box(render(out, n, 30))
            s.expect(a and b and all(abs(x - y) < 0.03 for x, y in zip(a, b)), f'page {n} looks the same: {a} vs {b}')
    page.close()

    # offset CropBox + bleed + fill
    page = open_tool(s, ctx, PATHS['de'], 'edit_offset.pdf')
    check_radio(page, 'fit', 'fill')
    set_range(page, 'bleed', 3)
    out = s.run_and_download(page)
    if out:
        r = PdfReader(str(out))
        p = r.pages[0]
        s.expect([round(float(x), 1) for x in p.mediabox] == [0, 0, 612.3, 858.9], f'media with bleed {list(p.mediabox)}')
        s.expect([round(float(x), 1) for x in p.trimbox] == [8.5, 8.5, 603.8, 850.4], f'trim {list(p.trimbox)}')
        img = render(out, 1, 30)
        s.expect(dark_box(img) is not None, 'content visible')
    page.close()

    # annotations follow (form fields), custom size
    page = open_tool(s, ctx, PATHS['de'], 'form.pdf')
    set_value(page, 'size', 'custom')
    set_value(page, 'cw', '105')
    set_value(page, 'ch', '148')
    out = s.run_and_download(page)
    if out:
        src = PdfReader(str(FIX / 'form.pdf')).pages[0]
        dst = PdfReader(str(out)).pages[0]
        ra = [float(x) for x in src['/Annots'][0].get_object()['/Rect']]
        rb = [float(x) for x in dst['/Annots'][0].get_object()['/Rect']]
        sw = float(src.mediabox.width)
        k = (105 * 72 / 25.4) / sw
        s.expect(abs((rb[2] - rb[0]) - (ra[2] - ra[0]) * k) < 1.5, f'annotation scaled: {ra} → {rb} (k={k:.3f})')
    page.close()
