"""pdf-viewer: opens right after picking (full screen), lazy page rendering, page jump, search with highlights
(right page + position), outline jump, thumbnails, zoom buttons / pinch (phone) / Ctrl+wheel (desktop), night mode,
print (all pages prepared), download = original, password-protected PDF, back button closes, scan → no matches."""
import os
os.environ.setdefault('WT_PORT', '8790')
from wtlib import Suite, FIX

PATHS = {'de': '/werkzeuge/pdf-oeffnen/', 'en': '/en/tools/pdf-viewer/'}
PRINT_STUB = "window.print = () => { window.__printed = document.querySelectorAll('.new-print img').length; };"

def zoom(page):
    return int(page.locator('.new-v-zoom').inner_text().replace('%', '').strip())

with Suite('new-pdf-viewer') as s:
    for v in s.variants():
        v.ctx.add_init_script(PRINT_STUB)
        de = v.lang == 'de'
        shots = v.device == 'phone' and de
        page = s.open(v, PATHS[v.lang])
        if shots: s.shot(page, 'pdf-viewer_phone_initial')
        s.pick(page, 'new_book.pdf')
        page.wait_for_selector('.new-v .new-v-page canvas', timeout=20000)
        s.expect(page.locator('.new-v-page').count() == 40, f'{v}: 40 page boxes')
        s.expect(page.locator('.new-v-page canvas').count() < 20, f'{v}: lazy rendering ({page.locator(".new-v-page canvas").count()} canvases)')
        if shots: s.shot(page, 'pdf-viewer_phone_reader')
        s.check_page(page)
        # page jump
        page.fill('#new-v-page', '40'); page.press('#new-v-page', 'Enter')
        page.wait_for_function("() => document.querySelector('.new-v-page[data-i=\"40\"] canvas')")
        # search
        page.locator('.new-v-top button[aria-controls="new-v-search"]').click()
        page.fill('#new-v-q', 'zebra'); page.press('#new-v-q', 'Enter')
        page.wait_for_function("() => /1 \\/ 1/.test(document.querySelector('.new-v-count').textContent)", timeout=15000)
        s.expect(page.locator('#new-v-page').input_value() == '27', f'{v}: search jumps to page 27')
        hl = page.locator('.new-v-page[data-i="27"] .new-v-hl.is-cur')
        s.expect(hl.count() == 1, f'{v}: highlight on page 27')
        if hl.count():
            pb = page.locator('.new-v-page[data-i="27"]').bounding_box(); hb = hl.bounding_box()
            fy = (hb['y'] - pb['y']) / pb['height']; fx = (hb['x'] - pb['x']) / pb['width']
            # line 6 (y = 640 pt of 842) → ~0.23 from top; "Zebra" near the end of the line
            s.expect(0.2 < fy < 0.27 and fx > 0.45, f'{v}: highlight position fx={fx:.2f} fy={fy:.2f}')
        if shots: s.shot(page, 'pdf-viewer_phone_search')
        page.fill('#new-v-q', 'Grüße'); page.press('#new-v-q', 'Enter')
        page.wait_for_function("() => /\\/ 1200/.test(document.querySelector('.new-v-count').textContent)", timeout=20000)
        page.press('#new-v-q', 'Escape')
        # outline
        page.locator('button[aria-controls="new-v-side"]').click()
        page.locator('.new-v-outline button', has_text='Kapitel 3').click()
        page.wait_for_timeout(300)
        s.expect(page.locator('#new-v-page').input_value() == '21', f'{v}: outline → page 21, got {page.locator("#new-v-page").input_value()}')
        # thumbnails
        if page.locator('#new-v-side[hidden]').count(): page.locator('button[aria-controls="new-v-side"]').click()
        page.locator('.new-v-side .new-chip', has_text='Seiten' if de else 'Pages').click()
        page.wait_for_selector('.new-v-thumbs img[src]', timeout=10000)
        if shots: s.shot(page, 'pdf-viewer_phone_thumbs')
        page.locator('.new-v-thumbs button[data-i="5"]').click()
        page.wait_for_timeout(200)
        s.expect(page.locator('#new-v-page').input_value() == '5', f'{v}: thumbnail → page 5')
        if not page.locator('#new-v-side[hidden]').count(): page.locator('button[aria-controls="new-v-side"]').click()
        # zoom
        z0 = zoom(page)
        page.locator('.new-v-bottom button[aria-label="{}"]'.format('Vergrößern' if de else 'Zoom in')).click()
        s.expect(zoom(page) > z0, f'{v}: zoom in {z0} → {zoom(page)}')
        z1 = zoom(page)
        if v.device == 'phone':
            b = page.locator('.new-v-scroll').bounding_box()
            cx, cy = b['x'] + b['width'] / 2, b['y'] + b['height'] / 2
            cdp = page.context.new_cdp_session(page)
            cdp.send('Input.dispatchTouchEvent', {'type': 'touchStart', 'touchPoints': [{'x': cx - 40, 'y': cy, 'id': 1}, {'x': cx + 40, 'y': cy, 'id': 2}]})
            for k in range(1, 9):
                cdp.send('Input.dispatchTouchEvent', {'type': 'touchMove', 'touchPoints': [{'x': cx - 40 - 10 * k, 'y': cy, 'id': 1}, {'x': cx + 40 + 10 * k, 'y': cy, 'id': 2}]})
            cdp.send('Input.dispatchTouchEvent', {'type': 'touchEnd', 'touchPoints': []})
            page.wait_for_timeout(200)
            s.expect(zoom(page) > z1 * 1.5, f'{v}: pinch zoom {z1} → {zoom(page)}')
        else:
            b = page.locator('.new-v-scroll').bounding_box()
            page.mouse.move(b['x'] + 200, b['y'] + 200)
            page.keyboard.down('Control'); page.mouse.wheel(0, -300); page.keyboard.up('Control')
            page.wait_for_timeout(200)
            s.expect(zoom(page) > z1, f'{v}: ctrl+wheel zoom {z1} → {zoom(page)}')
        page.locator('.new-v-zoom').click()  # back to fit
        s.check_page(page)
        # menu: night mode, print, download
        page.locator('button[aria-controls="new-v-menu"]').click()
        page.locator('.new-v-menu [role=menuitemcheckbox]').click()
        s.expect(page.locator('.new-v.is-night').count() == 1, f'{v}: night mode')
        if shots: s.shot(page, 'pdf-viewer_phone_night')
        page.locator('button[aria-controls="new-v-menu"]').click()
        page.locator('.new-v-menu button', has_text='Drucken' if de else 'Print').click()
        page.wait_for_function("() => window.__printed !== undefined", timeout=30000)
        s.expect(page.evaluate("() => window.__printed") == 40, f'{v}: print prepared all pages')
        page.locator('button[aria-controls="new-v-menu"]').click()
        out = s.download_click(page, page.locator('.new-v-menu button', has_text='Herunterladen' if de else 'Download'))
        s.expect(out.read_bytes() == (FIX / 'new_book.pdf').read_bytes(), f'{v}: download = original')
        s.expect(page.locator('.new-v-menu a[href^="https://"]').count() == 1, f'{v}: app link in menu')
        # back button closes the reader; "Read" re-opens it
        page.go_back()
        page.wait_for_selector('.new-v', state='detached')
        s.expect(page.url.endswith(PATHS[v.lang]), f'{v}: stays on the tool page after back: {page.url}')
        s.primary(page).click()
        page.wait_for_selector('.new-v .new-v-page canvas')
        page.keyboard.press('Escape')
        page.wait_for_selector('.new-v', state='detached')
        s.check_page(page)
        page.close()
    # password-protected + scan (no text)
    ctx = s.context('phone', 'de', dark=True)
    ctx.add_init_script(PRINT_STUB)
    page = s.open(ctx, PATHS['de'])
    s.pick(page, "new_book_enc.pdf")
    page.wait_for_selector('.wt-lock input')
    page.locator('.wt-lock input').fill('geheim'); page.locator('.wt-lock button').click()
    page.wait_for_selector('.new-v .new-v-page canvas', timeout=20000)
    s.expect(page.locator('.new-v-page').count() == 40, 'encrypted PDF opened')
    page.keyboard.press('Escape')
    page.wait_for_selector('.new-v', state='detached')
    s.shot(page, 'pdf-viewer_phone_dark', top='.wt-stage')
    s.pick(page, "new_scan_1p.pdf")
    page.wait_for_selector('.new-v .new-v-page canvas', timeout=20000)
    page.locator('.new-v-top button[aria-controls="new-v-search"]').click()
    page.fill('#new-v-q', 'Lieferung'); page.press('#new-v-q', 'Enter')
    page.wait_for_function("() => /Keine/.test(document.querySelector('.new-v-count').textContent)")
    s.check_page(page)
