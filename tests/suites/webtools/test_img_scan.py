"""scan-to-pdf: edge detection on a skewed document photo, perspective correction (page aspect, white
paper), filters, rotation, corner drag with magnifier, keyboard corners, page order via file list, PDF page
size, JPG output, DE/EN × phone/desktop."""
import numpy as np
from PIL import Image
from wtlib import Suite, FIX, OUT

PATHS = {'de': '/werkzeuge/dokument-scannen/', 'en': '/en/tools/scan-to-pdf/'}
quad = [tuple(map(float, p.split(','))) for p in (FIX / 'img/doc_quad.txt').read_text().split()]

with Suite('scan-to-pdf') as s:
    for v in s.variants():
        page = s.open(v, PATHS[v.lang])
        shots = v.device == 'phone' and v.lang == 'de'
        if shots: s.shot(page, 'img_scan_phone_initial')
        s.pick(page, 'img/doc_photo.jpg', 'img/clean.jpg')
        s.wait_ready(page, 2)
        page.wait_for_selector('.img-scan-img canvas')
        page.wait_for_function("() => document.querySelector('.img-scan [role=status]').textContent.length > 5")
        # detected quad close to the real one
        got = page.evaluate("() => [...document.querySelectorAll('.img-scan-handle')].map(h => [parseFloat(h.style.left) / 100, parseFloat(h.style.top) / 100])")
        err = max(abs(a - b) for g, q in zip(got, quad) for a, b in zip(g, q))
        s.expect(err < 0.03, f'{v}: detected corners off by {err:.3f}: {got}')
        if shots: s.shot(page, 'img_scan_phone_configured', top='.img-scan')
        # drag a corner (shows the magnifier) and back
        h = page.locator('.img-scan-handle').nth(0)
        h.evaluate("e => e.scrollIntoView({block: 'center'})"); page.wait_for_timeout(300)
        b = h.bounding_box()
        page.mouse.move(b['x'] + 24, b['y'] + 24); page.mouse.down(); page.mouse.move(b['x'] + 60, b['y'] + 50, steps=4)
        s.expect(page.wait_for_selector('.img-scan-loupe:not([hidden])', timeout=3000) is not None, f'{v}: magnifier while dragging')
        if shots: s.shot(page, 'img_scan_phone_drag', top='.img-scan')
        page.mouse.move(b['x'] + 24, b['y'] + 24, steps=4); page.mouse.up()
        page.locator('.img-scan .img-btn-row button').nth(2).click()   # "detect automatically" restores the corners
        # result view
        page.locator('input[name="img-scan-mode"][value="result"]').check(force=True)
        page.wait_for_selector('.img-scan-pv')
        if shots: s.shot(page, 'img_scan_phone_preview', top='.img-scan')
        s.check_page(page)
        if not s.run(page): continue
        if shots:
            s.shot(page, 'img_scan_phone_result', top='.wt-result')
            page.emulate_media(color_scheme='dark'); s.shot(page, 'img_scan_phone_result_dark', top='.wt-result'); page.emulate_media(color_scheme='light')
        out = s.download(page, 0)
        s.expect(s.pdf_pages(out) == 2, f'{v}: 2 pages')
        w, hh = s.page_sizes(out)[0]
        s.expect(abs(w - 595.28) < 1 and abs(hh - 841.89) < 1, f'{v}: A4 page {w}x{hh}')
        im = s.render(out, 1, 50).convert('L')
        a = np.array(im)
        # page 1: warped document should fill most of the page, paper white, text dark
        s.expect(a[a.shape[0] // 2, 5:30].mean() > 200, f'{v}: page edge should be white paper, got {a[a.shape[0] // 2, 5:30].mean():.0f}')
        s.expect((a < 100).mean() > 0.01, f'{v}: text must remain visible')
        # perspective corrected: the inner frame's left edge is vertical (same x at 30 % and 70 % height)
        def left_edge(y):
            row = a[int(a.shape[0] * y)]
            xs = np.where(row[int(len(row) * 0.03):int(len(row) * 0.3)] < 110)[0]
            return xs[0] if len(xs) else -999
        e1, e2 = left_edge(0.3), left_edge(0.7)
        s.expect(abs(e1 - e2) <= 3 and e1 > 0, f'{v}: frame edge must be vertical after correction: {e1} vs {e2}')
        s.check_page(page)

    # rotate + black & white + JPG output, keyboard corner, desktop EN
    ctx = s.context('desktop', 'en')
    page = s.open(ctx, PATHS['en'])
    s.pick(page, 'img/doc_photo.jpg')
    s.wait_ready(page, 1)
    page.wait_for_selector('.img-scan-img canvas')
    page.locator('input[name="img-scan-filter"][value="bw"]').check(force=True)
    page.get_by_role('button', name='Rotate right').click()
    h = page.locator('.img-scan-handle').nth(2)
    before = h.evaluate("e => e.style.left")
    h.focus(); page.keyboard.press('ArrowLeft')
    s.expect(h.evaluate("e => e.style.left") != before, 'arrow key moves the corner')
    page.locator('input[name="wt-opt-output"][value="jpg"]').check()
    if s.run(page):
        o = s.download(page, 0)
        im = Image.open(o)
        s.expect(im.width > im.height * 1.2, f'rotated page must be landscape {im.size}')
        g = np.array(im.convert('L'))
        s.expect(((g < 40) | (g > 215)).mean() > 0.97, f'b/w filter: mostly pure black/white {((g < 40) | (g > 215)).mean():.3f}')
    s.check_page(page)
    # "as scanned" page size
    page.locator('.wt-restart button').first.click()
    page.locator('input[name="wt-opt-output"][value="pdf"]').check()
    page.locator('input[name="wt-opt-pageSize"][value="fit"]').check()
    if s.run(page):
        o = s.download(page, 0)
        w, hh = s.page_sizes(o)[0]
        s.expect(abs(w - 595.28) < 1 and 350 < hh < 470, f'as scanned (landscape page from the rotated doc): {w}x{hh}')
