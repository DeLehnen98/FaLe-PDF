"""crop-image: aspect presets, rotate/flip, straighten, touch/mouse handle drag, keyboard, multi-image apply-all,
output pixel size + content (colour quadrants), format choice."""
import os
os.environ.setdefault('WT_PORT', '8790')
from PIL import Image
from wtlib import Suite

PATHS = {'de': '/werkzeuge/bild-zuschneiden/', 'en': '/en/tools/crop-image/'}
T = {'de': {'rr': 'Nach rechts drehen', 'all': 'Für alle Bilder übernehmen', 'fh': 'Horizontal spiegeln'},
     'en': {'rr': 'Rotate right', 'all': 'Apply to all images', 'fh': 'Flip horizontally'}}

def near(c, ref, tol=40):
    return all(abs(a - b) <= tol for a, b in zip(c, ref))
RED, GREEN, BLUE, YELLOW = (230, 30, 30), (30, 200, 30), (30, 30, 230), (240, 220, 20)

def drag(page, v, a, b, steps=8):
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

with Suite('new-crop-image') as s:
    for v in s.variants():
        t = T[v.lang]
        shots = v.device == 'phone' and v.lang == 'de'
        page = s.open(v, PATHS[v.lang])
        if shots: s.shot(page, 'crop-image_phone_initial')
        s.pick(page, 'new_quad.png')
        s.wait_ready(page, 1)
        page.wait_for_selector('.new-ed-crop')
        page.wait_for_timeout(300)
        # 1) 1:1 → centred 300 × 300, left column red/blue
        page.locator('.new-chip[data-aspect="1:1"]').click()
        s.expect('300 × 300' in page.locator('.new-ed-size').inner_text(), f'{v}: size label 300×300, got {page.locator(".new-ed-size").inner_text()}')
        if shots: s.shot(page, 'crop-image_phone_configured', top='.new-box')
        s.check_page(page)
        out = s.run_and_download(page)
        if out:
            im = Image.open(out).convert('RGB')
            s.expect(im.size == (300, 300), f'{v}: 1:1 size {im.size}')
            s.expect(near(im.getpixel((10, 10)), RED) and near(im.getpixel((290, 290)), YELLOW), f'{v}: 1:1 content {im.getpixel((10, 10))} {im.getpixel((290, 290))}')
            s.expect(out.suffix == '.png', f'{v}: keeps PNG')
        if shots: s.shot(page, 'crop-image_phone_result')
        page.locator('.wt-result button', has_text='Zurück' if v.lang == 'de' else 'Back').first.click()
        # 2) rotate right + free + drag the SE handle to the middle → about a quarter
        page.locator(f'button[aria-label="{t["rr"]}"]').click()
        page.locator('.new-chip[data-aspect="free"]').click()
        page.wait_for_timeout(200)
        page.locator('.new-ed-crop').scroll_into_view_if_needed()
        # make the frame full size first (free keeps the 1:1 frame): drag NW to the corner, SE to the corner
        fb = page.locator('.new-ed-frame').bounding_box()
        h = page.locator('.new-ed-h[data-h="nw"]').bounding_box()
        drag(page, v, (h['x'] + 22, h['y'] + 22), (fb['x'] - 5, fb['y'] - 5))
        h = page.locator('.new-ed-h[data-h="se"]').bounding_box()
        drag(page, v, (h['x'] + 22, h['y'] + 22), (fb['x'] + fb['width'] * 0.5, fb['y'] + fb['height'] * 0.5))
        lab = page.locator('.new-ed-size').inner_text()
        out = s.run_and_download(page)
        if out:
            im = Image.open(out).convert('RGB')
            s.expect(abs(im.size[0] - 150) <= 6 and abs(im.size[1] - 200) <= 6, f'{v}: rotated quarter size {im.size} (label {lab})')
            # after a clockwise turn the old bottom-left (blue) is top-left
            s.expect(near(im.getpixel((5, 5)), BLUE), f'{v}: rotated content {im.getpixel((5, 5))}')
        page.locator('.wt-result button', has_text='Zurück' if v.lang == 'de' else 'Back').first.click()
        # 3) keyboard: Ctrl+ArrowLeft shrinks width; straighten 10° keeps size and has no transparent/black corners
        page.locator('.new-ed-crop').focus()
        for _ in range(5): page.keyboard.press('Control+ArrowLeft')
        page.locator('#new-crop-angle').fill('10')
        page.locator(f'button[aria-label="{t["fh"]}"]').click()
        page.select_option('#wt-opt-format', 'jpg')
        out = s.run_and_download(page)
        if out:
            im = Image.open(out).convert('RGB')
            s.expect(out.suffix == '.jpg', f'{v}: jpg chosen')
            s.expect(im.size[0] < 150, f'{v}: keyboard shrink {im.size}')
            s.expect(sum(im.getpixel((1, 1))) > 60, f'{v}: straighten fills the corner {im.getpixel((1, 1))}')
        s.check_page(page)
        page.close()
    # multi-image apply-all (phone DE)
    ctx = s.context('phone', 'de', dark=True)
    page = s.open(ctx, PATHS['de'])
    s.pick(page, 'new_quad.png', 'landscape.jpg')
    s.wait_ready(page, 2)
    page.wait_for_selector('.new-thumb')
    page.locator('.new-chip[data-aspect="1:1"]').click()
    page.locator('button', has_text=T['de']['all']).click()
    s.shot(page, 'crop-image_phone_dark', top='.new-box')
    s.check_page(page)
    if s.run(page):
        outs = []
        for i in range(2): outs.append(s.download(page, i))
        for o in outs:
            im = Image.open(o)
            s.expect(abs(im.size[0] - im.size[1]) <= 1, f'apply-all square {o.name} {im.size}')
