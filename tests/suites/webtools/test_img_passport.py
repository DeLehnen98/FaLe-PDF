"""passport-photo: templates, drag/wheel/keys positioning, background lightening, single photo 600 dpi,
10×15 sheet JPG (size, cut marks) and PDF (page size), honest note, DE/EN × phone/desktop."""
import numpy as np
from PIL import Image
from wtlib import Suite

PATHS = {'de': '/werkzeuge/passfoto/', 'en': '/en/tools/passport-photo/'}

with Suite('passport-photo') as s:
    for v in s.variants():
        page = s.open(v, PATHS[v.lang])
        shots = v.device == 'phone' and v.lang == 'de'
        if shots: s.shot(page, 'img_pp_phone_initial')
        s.pick(page, 'img/portrait.jpg')
        s.wait_ready(page, 1)
        page.wait_for_selector('.img-pp-frame')
        page.wait_for_function("() => document.querySelector('.img-pp-frame').offsetWidth > 100")
        s.expect(('Behörde' in page.locator('.img-pp').inner_text()) if v.lang == 'de' else ('authority' in page.locator('.img-pp').inner_text()), f'{v}: honest note')
        # drag the photo down a bit, keys, zoom slider
        fr = page.locator('.img-pp-frame'); fr.evaluate("e => e.scrollIntoView({block: 'center'})"); page.wait_for_timeout(200)
        b = fr.bounding_box()
        page.mouse.move(b['x'] + b['width'] / 2, b['y'] + b['height'] / 2); page.mouse.down()
        page.mouse.move(b['x'] + b['width'] / 2, b['y'] + b['height'] / 2 + 15, steps=3); page.mouse.up()
        fr.focus(); page.keyboard.press('ArrowUp'); page.keyboard.press('-')
        if shots: s.shot(page, 'img_pp_phone_configured', top='.img-pp')
        s.check_page(page)
        if not s.run(page): continue
        if shots:
            s.shot(page, 'img_pp_phone_result', top='.wt-result')
            page.emulate_media(color_scheme='dark'); s.shot(page, 'img_pp_phone_result_dark', top='.wt-result'); page.emulate_media(color_scheme='light')
        o = s.download(page, 0)
        im = Image.open(o)
        s.expect(o.suffix == '.jpg' and abs(im.width - 3543) <= 2 and abs(im.height - 2362) <= 2, f'{v}: sheet 10x15 @600dpi {im.size}')
        s.check_page(page)

    ctx = s.context('desktop', 'de')
    page = s.open(ctx, PATHS['de'])
    s.pick(page, 'img/portrait.jpg')
    s.wait_ready(page, 1)
    page.wait_for_selector('.img-pp-frame')
    page.locator('input[name="wt-opt-output"][value="single"]').check()
    page.locator('#img-pp-bg').check(force=True)
    page.wait_for_timeout(300)
    if s.run(page):
        im = Image.open(s.download(page, 0)).convert('RGB')
        s.expect(abs(im.width - 827) <= 1 and abs(im.height - 1063) <= 1, f'single 35x45 @600dpi {im.size}')
        px = im.getpixel((20, 20))
        s.expect(all(225 <= c <= 245 for c in px), f'background lightened to light grey {px}')
    page.locator('.wt-restart button').first.click()
    page.locator('input[name="wt-opt-template"][value="us"]').check()
    page.locator('input[name="wt-opt-output"][value="pdf"]').check()
    page.select_option('#wt-opt-count', '2')
    if s.run(page):
        o = s.download(page, 0)
        w, h = s.page_sizes(o)[0]
        s.expect(abs(w - 425.2) < 1 and abs(h - 283.5) < 1, f'PDF sheet 150x100 mm: {w}x{h}')
        r = s.render(o, 1, 72)
        a = np.array(r.convert('L'))
        s.expect((a < 200).mean() > 0.05, 'PDF has photos')
    s.check_page(page)
    # wheel zoom on desktop changes the zoom slider
    page.locator('.wt-restart button').first.click()
    z0 = page.locator('#img-pp-zoom').input_value()
    fr = page.locator('.img-pp-frame'); fr.evaluate("e => e.scrollIntoView({block: 'center'})"); page.wait_for_timeout(200); b = fr.bounding_box()
    page.mouse.move(b['x'] + b['width'] / 2, b['y'] + b['height'] / 2); page.mouse.wheel(0, -300); page.wait_for_timeout(200)
    s.expect(float(page.locator('#img-pp-zoom').input_value()) > float(z0), 'wheel zooms in')
