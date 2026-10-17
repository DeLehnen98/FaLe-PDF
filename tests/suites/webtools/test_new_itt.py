"""image-to-text: photo + screenshot (umlauts), several images with file headings, region (touch/mouse frame),
join lines, sideways photo, copy button, TXT output, phone/desktop DE/EN."""
import os
os.environ.setdefault('WT_PORT', '8790')
from wtlib import Suite

PATHS = {'de': '/werkzeuge/bild-in-text/', 'en': '/en/tools/image-to-text/'}

def drag(page, v, a, b, steps=6):
    if v.device == 'phone':
        cdp = page.context.new_cdp_session(page)
        cdp.send('Input.dispatchTouchEvent', {'type': 'touchStart', 'touchPoints': [{'x': a[0], 'y': a[1]}]})
        for k in range(1, steps + 1):
            cdp.send('Input.dispatchTouchEvent', {'type': 'touchMove', 'touchPoints': [{'x': a[0] + (b[0] - a[0]) * k / steps, 'y': a[1] + (b[1] - a[1]) * k / steps}]})
        cdp.send('Input.dispatchTouchEvent', {'type': 'touchEnd', 'touchPoints': []})
    else:
        page.mouse.move(*a); page.mouse.down()
        for k in range(1, steps + 1): page.mouse.move(a[0] + (b[0] - a[0]) * k / steps, a[1] + (b[1] - a[1]) * k / steps)
        page.mouse.up()

with Suite('new-image-to-text') as s:
    for v in s.variants():
        de = v.lang == 'de'
        shots = v.device == 'phone' and de
        v.ctx.grant_permissions(['clipboard-read', 'clipboard-write'])
        page = s.open(v, PATHS[v.lang])
        if shots: s.shot(page, 'image-to-text_phone_initial')
        s.pick(page, 'new_note.jpg', 'new_screen.png')
        s.wait_ready(page, 2)
        page.locator('input[name="wt-opt-lang"][value="deu"]').check()
        s.check_page(page)
        if s.run(page, timeout=240000):
            t = page.locator('#new-text-out').input_value()
            for w in ['=== new_note.jpg ===', '=== new_screen.png ===', 'Äpfel', 'übermorgen', 'Größe', 'Sonnenblume', 'grüner.löwe', 'mail.beispiel.de']:
                s.expect(w in t, f'{v}: text contains {w!r}')
            if shots: s.shot(page, 'image-to-text_phone_result', top='.wt-result')
            page.locator('.new-copy').click()
            page.wait_for_timeout(300)
            s.expect('✓' in page.locator('.new-textpanel').inner_text(), f'{v}: copied')
            clip = page.evaluate("() => navigator.clipboard.readText()")
            s.expect('Sonnenblume' in clip, f'{v}: clipboard content')
            out = s.download(page, 0)
            s.expect(out.suffix == '.txt' and 'Größe' in out.read_text(encoding='utf-8'), f'{v}: TXT output')
        page.close()
        # region on the screenshot: only the "Server" line
        page = s.open(v, PATHS[v.lang])
        s.pick(page, 'new_screen.png'); s.wait_ready(page, 1)
        page.locator('label[for="new-itt-region"]').click()
        page.wait_for_selector('.new-ed-crop:not([hidden])')
        page.locator('.new-ed-crop').scroll_into_view_if_needed()
        fb = page.locator('.new-ed-frame').bounding_box()
        h = page.locator('.new-ed-h[data-h="n"]').bounding_box()
        drag(page, v, (h['x'] + 22, h['y'] + 22), (h['x'] + 22, fb['y'] + fb['height'] * 0.43))
        h = page.locator('.new-ed-h[data-h="s"]').bounding_box()
        drag(page, v, (h['x'] + 22, h['y'] + 22), (h['x'] + 22, fb['y'] + fb['height'] * 0.57))
        if shots: s.shot(page, 'image-to-text_phone_configured', top='.new-box')
        s.expect('markierte Bereich' in page.locator('.wt-bar-hint').inner_text() if de else 'marked area' in page.locator('.wt-bar-hint').inner_text(), f'{v}: bar mentions the region')
        if s.run(page, timeout=180000):
            t = page.locator('#new-text-out').input_value()
            s.expect('mail.beispiel.de' in t and 'WLAN' not in t and 'Einstellungen' not in t, f'{v}: only the region: {t!r}')
        s.check_page(page)
        page.close()
    # sideways photo + join lines (phone EN dark)
    ctx = s.context('phone', 'en', dark=True)
    page = s.open(ctx, PATHS['en'])
    s.pick(page, 'new_note_side.jpg'); s.wait_ready(page, 1)
    page.locator('input[name="wt-opt-lang"][value="deu"]').check()
    page.locator('#wt-opt-join').check(force=True)
    s.shot(page, 'image-to-text_phone_dark', top='.wt-opts-sec')
    if s.run(page, timeout=240000):
        t = page.locator('#new-text-out').input_value()
        s.expect('Bestellung' in t and 'Äpfel' in t, f'sideways photo read: {t[:200]!r}')
        s.expect('rotated' in page.locator('.wt-result').inner_text(), 'rotation note')
    s.check_page(page)
