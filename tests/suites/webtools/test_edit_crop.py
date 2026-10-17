"""crop-pdf: auto trim per page, manual frame with handles + mm fields on rotated pages, odd/even, MediaBox option."""
import subprocess
from edit_testlib import Suite, FIX, open_tool, wait_preview, set_value, check_radio

PATHS = {'de': '/werkzeuge/pdf-zuschneiden/', 'en': '/en/tools/crop-pdf/'}
MM = 72 / 25.4


def boxes(path, kind='CropBox'):
    out = subprocess.run(['pdfinfo', '-box', '-f', '1', '-l', '999', str(path)], capture_output=True, text=True).stdout
    res = []
    for line in out.splitlines():
        if f'{kind}:' in line:
            res.append([float(x) for x in line.split(':')[1].split()])
    return res


def near(a, b, tol=2.5):
    return all(abs(x - y) <= tol for x, y in zip(a, b))


with Suite('crop-pdf') as s:
    for v in s.variants():
        shots = v.device == 'phone' and v.lang == 'de'
        page = s.open(v, PATHS[v.lang])
        if shots: s.shot(page, 'crop-pdf_initial')
        s.pick(page, 'edit_margins.pdf'); s.wait_ready(page, 1)
        page.wait_for_selector('.ed-pv-cv', timeout=20000)
        page.wait_for_selector('.ed-crop-auto:not([hidden])', timeout=20000)
        if shots: s.shot(page, 'crop-pdf_configured', top='.wt-stage')
        s.check_page(page)
        out = s.run_and_download(page)
        if shots:
            s.shot(page, 'crop-pdf_result', top='.wt-result')
            page.emulate_media(color_scheme='dark'); s.shot(page, 'crop-pdf_result_dark', top='.wt-result'); page.emulate_media(color_scheme='light')
        s.check_page(page)
        if out:
            cb = boxes(out)
            pad = 3 * MM
            # page 1: block 150..450 × 200..600, label text above it up to ≈ 624
            s.expect(near(cb[0][:3], [150 - pad, 200 - pad, 450 + pad], 3) and 615 < cb[0][3] < 640, f'{v}: page 1 crop {cb[0]}')
            s.expect(near(cb[1][:3], [100 - pad, 300 - pad, 300 + pad], 3) and 705 < cb[1][3] < 740, f'{v}: page 2 crop {cb[1]}')
            s.expect('Block one' in s.pdf_text(out), f'{v}: text kept')
            s.expect(boxes(out, 'MediaBox')[0] == [0, 0, 595.28, 841.89], f'{v}: MediaBox unchanged')
        page.close()

    # manual on rotated pages, even pages only, mm fields + handle drag
    ctx = s.context('phone', 'de')
    page = open_tool(s, ctx, PATHS['de'], 'edit_rot.pdf')
    check_radio(page, 'mode', 'manual')
    page.wait_for_selector('.ed-crop:not([hidden])')
    # drag the bottom-right handle up-left → bottom/right margins grow
    before = float(page.locator('#wt-opt-mr').input_value())
    page.locator('.ed-crop-h[data-h="se"]').scroll_into_view_if_needed()
    h = page.locator('.ed-crop-h[data-h="se"]').bounding_box()
    page.mouse.move(h['x'] + h['width'] / 2, h['y'] + h['height'] / 2)
    page.mouse.down(); page.mouse.move(h['x'] - 20, h['y'] - 30, steps=5); page.mouse.up()
    after = float(page.locator('#wt-opt-mr').input_value())
    s.expect(after > before, f'handle drag updates the mm field ({before} → {after})')
    s.shot(page, 'crop-pdf_manual', top='.wt-stage')
    for k, val in (('ml', '10'), ('mt', '20'), ('mr', '30'), ('mb', '40')):
        set_value(page, k, val)
    set_value(page, 'scope', 'even')
    page.locator('label[for="wt-opt-media"]').click()
    out = s.run_and_download(page)
    if out:
        cb = boxes(out); mb = boxes(out, 'MediaBox')
        W, H = 595.28, 841.89
        l, t, r, b = 10 * MM, 20 * MM, 30 * MM, 40 * MM
        s.expect(near(cb[0], [0, 0, W, H], 0.1) and near(cb[2], [0, 0, W, H], 0.1), f'odd pages untouched {cb[0]} {cb[2]}')
        # page 2: /Rotate 90 → visual top = PDF left, visual left = PDF bottom
        s.expect(near(cb[1], [t, l, W - b, H - r]), f'rot 90 crop {cb[1]}')
        # page 4: /Rotate 270 → visual top = PDF right, visual left = PDF top
        s.expect(near(cb[3], [b, r, W - t, H - l]), f'rot 270 crop {cb[3]}')
        s.expect(near(mb[1], cb[1]), 'MediaBox follows with the option')
    page.close()

    # offset CropBox: whole-page reset keeps the original area
    page = open_tool(s, ctx, PATHS['de'], 'edit_offset.pdf')
    check_radio(page, 'mode', 'manual')
    page.get_by_role('button', name='Ganze Seite').click()
    out = s.run_and_download(page)
    if out:
        cb = boxes(out)
        s.expect(near(cb[0], [-150, -50, 345.28, 691.89], 0.6) and near(cb[1], [-150, -50, 345.28, 691.89], 0.6), f'offset kept: {cb}')
    page.close()
