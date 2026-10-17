"""edit-pdf-text (PDF bearbeiten): text, ticks (tap again removes), highlight snapping to text, shapes,
rotated pages, undo/redo, change existing text, image, character warning – phone (touch) and desktop."""
import subprocess
from uni_testlib import UNI, UNI_WORDS, check_unicode_pdf
from edit_testlib import Suite, FIX, open_tool, wait_preview, pdfjs_added_box, content_count

PATHS = {'de': '/werkzeuge/pdf-bearbeiten/', 'en': '/en/tools/edit-pdf/'}


def pbox(page):
    page.locator('.ed-pv-page').scroll_into_view_if_needed()
    return page.locator('.ed-pv-page').bounding_box()


def tap(page, fx, fy, touch=False):
    b = pbox(page)
    x, y = b['x'] + fx * b['width'], b['y'] + fy * b['height']
    if touch: page.touchscreen.tap(x, y)
    else: page.mouse.click(x, y)


def drag(page, f0, f1, steps=8):
    b = pbox(page)
    page.mouse.move(b['x'] + f0[0] * b['width'], b['y'] + f0[1] * b['height'])
    page.mouse.down()
    page.mouse.move(b['x'] + f1[0] * b['width'], b['y'] + f1[1] * b['height'], steps=steps)
    page.mouse.up()


def tool(page, name):
    page.locator(f'.ed-tool[data-tool="{name}"]').click()


with Suite('edit-pdf-text') as s:
    for v in s.variants():
        phone = v.device == 'phone'
        shots = phone and v.lang == 'de'
        page = s.open(v, PATHS[v.lang])
        if shots: s.shot(page, 'edit-pdf-text_initial')
        s.pick(page, 'edit_rot.pdf'); s.wait_ready(page, 1)
        page.wait_for_selector('.ed-pv-cv', timeout=20000)
        wait_preview(page)
        # text
        tool(page, 'text')
        tap(page, 0.3, 0.3, touch=phone)
        page.wait_for_selector('.ed-props textarea')
        page.locator('.ed-props textarea').fill('Hallo Welt äöü €')
        page.locator('.ed-props textarea').blur()
        # ticks: two, then tap the first again to remove it
        tool(page, 'check')
        tap(page, 0.2, 0.6, touch=phone)
        tap(page, 0.4, 0.6, touch=phone)
        page.wait_for_timeout(100)
        tap(page, 0.2, 0.6, touch=phone)
        s.expect(page.locator('.ed-svgobj').count() == 1, f'{v}: one tick left ({page.locator(".ed-svgobj").count()})')
        # rectangle + highlight over "Rotation 0" (text at 60 pt from left, 110 pt from top)
        tool(page, 'rect')
        drag(page, (0.55, 0.7), (0.8, 0.8))
        tool(page, 'hl')
        drag(page, (62 / 595, 100 / 842), (200 / 595, 102 / 842))
        page.wait_for_timeout(150)
        hs = page.evaluate("() => { const g = [...document.querySelectorAll('.ed-shapes g')].find(g => g.style.mixBlendMode); return g ? [...g.querySelectorAll('rect')].map(r => +r.getAttribute('height')) : []; }")
        s.expect(hs and all(h > 15 for h in hs), f'{v}: highlight snapped to the text line (heights {hs})')
        # arrow, then undo it
        tool(page, 'arrow')
        drag(page, (0.6, 0.4), (0.8, 0.3))
        n_before = page.locator('.ed-svgobj').count()
        page.locator('.ed-undo-row button').first.click()
        s.expect(page.locator('.ed-svgobj').count() == n_before - 1, f'{v}: undo removes the arrow')
        if shots: s.shot(page, 'edit-pdf-text_configured', top='.wt-stage')
        # page 2 (rotated 90°): date
        page.locator('.ed-pv-nav button').nth(1).click()
        wait_preview(page)
        tool(page, 'date')
        tap(page, 0.5, 0.5, touch=phone)
        page.wait_for_selector('.ed-props textarea')
        s.check_page(page)
        out = s.run_and_download(page)
        if shots:
            s.shot(page, 'edit-pdf-text_result', top='.wt-result')
            page.emulate_media(color_scheme='dark'); s.shot(page, 'edit-pdf-text_result_dark', top='.wt-result'); page.emulate_media(color_scheme='light')
        s.check_page(page)
        if out:
            txt = s.pdf_text(out)
            s.expect('Hallo Welt äöü €' in txt, f'{v}: typed text in PDF: {txt[:200]!r}')
            ok, msg = s.qpdf_check(out); s.expect(ok, f'{v}: qpdf {msg}')
            bb = pdfjs_added_box(page, FIX / 'edit_rot.pdf', out, 1)
            s.expect(bb and 0.25 < bb[0] < 0.33 and 0.25 < bb[1] < 0.33 and bb[2] > 0.75 and bb[3] > 0.75, f'{v}: page 1 edits where placed {bb}')
            s.expect(content_count(out, '/BM /Multiply') >= 1, f'{v}: highlight drawn with multiply blend')
            s.expect(content_count(out, 're') >= 1, f'{v}: shapes drawn')
            b2 = pdfjs_added_box(page, FIX / 'edit_rot.pdf', out, 2)
            s.expect(b2 and abs((b2[1] + b2[3]) / 2 - 0.5) < 0.06 and 0.45 < b2[0] < 0.56, f'{v}: date on rotated page 2 where tapped {b2}')
            s.expect(pdfjs_added_box(page, FIX / 'edit_rot.pdf', out, 3) is None, f'{v}: page 3 untouched')
        page.close()

    ctx = s.context('phone', 'de')
    # change existing text
    page = open_tool(s, ctx, PATHS['de'], 'text5.pdf')
    wait_preview(page)
    words = subprocess.run(['pdftotext', '-bbox', str(FIX / 'text5.pdf'), '-'], capture_output=True, text=True).stdout
    import re
    m = re.search(r'<page width="([\d.]+)" height="([\d.]+)">', words)
    pw, ph = float(m.group(1)), float(m.group(2))
    w = re.search(r'<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">Beta</word>', words)
    x0, y0, x1, y1 = map(float, w.groups())
    tool(page, 'replace')
    page.wait_for_timeout(300)
    tap(page, (x0 + x1) / 2 / pw, (y0 + y1) / 2 / ph, touch=True)
    page.wait_for_selector('.ed-props textarea')
    ta = page.locator('.ed-props textarea')
    s.expect(ta.input_value().startswith('Beta Seite 1'), f'replace: line text prefilled: {ta.input_value()!r}')
    # "Text ändern" with Unicode: Polish, Greek, Cyrillic, Turkish stay real text; only ✓ (no font has it) is warned
    ta.fill('Gamma Łukasz Kowalski-Müller\nΕλληνικά Привет\nTürkçe İğ € ✓')
    wt = page.locator('.ed-props .ed-pv-warn').inner_text()
    s.expect('✓' in wt and 'Ł' not in wt and 'Ж' not in wt, f'warning only for ✓: {wt!r}')
    ta.blur()
    s.shot(page, 'edit-pdf-text_replace', top='.wt-stage')
    out = s.run_and_download(page)
    if out:
        check_unicode_pdf(s, out, ['Gamma'] + UNI_WORDS, 'Text ändern')
        s.expect(page.locator('.wt-note').count() >= 2, 'notes: replaced ✓ + white-out honesty')
    page.close()

    # image + redo + nothing-added error
    page = open_tool(s, ctx, PATHS['de'], 'text3.pdf')
    page.locator('.wt-bar .wt-btn-primary').click()
    page.wait_for_selector('.wt-error:not([hidden])')
    s.expect('noch nichts' in page.locator('.wt-error').inner_text(), 'error when nothing added')
    page.locator('.wt-error .wt-btn-quiet').click()
    tool(page, 'image') if False else None
    page.set_input_files('.ed-edit ~ .ed-pv-extra input[type=file], .ed-pv-extra input[type=file]', str(FIX / 'edit_logo.png'))
    page.wait_for_selector('.ed-obj-img')
    page.locator('.ed-undo-row button').first.click()
    s.expect(page.locator('.ed-obj-img').count() == 0, 'undo removes the image')
    page.locator('.ed-undo-row button').nth(1).click()
    s.expect(page.locator('.ed-obj-img').count() == 1, 'redo brings it back')
    out = s.run_and_download(page)
    if out:
        imgs = subprocess.run(['pdfimages', '-list', str(out)], capture_output=True, text=True).stdout
        s.expect('smask' in imgs, 'image with transparency embedded')
    page.close()
