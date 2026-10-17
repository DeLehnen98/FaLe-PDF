"""resize-image: presets with crop + focal point (tap), pad, stretch, px keep aspect, percent, long edge,
no upscaling, EXIF orientation, batch, DE/EN × phone/desktop."""
from PIL import Image
from wtlib import Suite, FIX

PATHS = {'de': '/werkzeuge/bildgroesse-aendern/', 'en': '/en/tools/resize-image/'}
def img(p):
    im = Image.open(p); im.load(); return im

with Suite('resize-image') as s:
    for v in s.variants():
        page = s.open(v, PATHS[v.lang])
        shots = v.device == 'phone' and v.lang == 'de'
        if shots: s.shot(page, 'img_resize_phone_initial')
        s.pick(page, 'img/panorama.jpg', 'img/gps_photo.jpg')
        s.wait_ready(page, 2)
        # default: preset square 1:1, crop → focal stage visible
        s.expect(page.locator('.img-focus').is_visible(), f'{v}: focal point stage visible for square crop')
        page.wait_for_selector('.img-focus-img canvas')
        # tap near the right end of the panorama → crop moves right
        box = page.locator('.img-focus-pad').bounding_box()
        if v.device == 'phone': page.tap('.img-focus-pad', position={'x': box['width'] * 0.95, 'y': box['height'] / 2})
        else: page.click('.img-focus-pad', position={'x': box['width'] * 0.95, 'y': box['height'] / 2})
        page.wait_for_timeout(200)
        left = page.evaluate("() => parseFloat(document.querySelector('.img-focus-frame').style.left)")
        s.expect(left > 85, f'{v}: crop frame must move right, left={left}')
        if shots: s.shot(page, 'img_resize_phone_configured', top='.img-focus')
        s.check_page(page)
        if not s.run(page): continue
        a = img(s.download(page, 0))
        s.expect(a.size == (1080, 1080), f'{v}: square preset 1080x1080, got {a.size}')
        b = img(s.download(page, 1))
        s.expect(b.size == (1080, 1080), f'{v}: square from EXIF-6 photo {b.size}')
        if shots:
            s.shot(page, 'img_resize_phone_result', top='.wt-result')
            page.emulate_media(color_scheme='dark'); s.shot(page, 'img_resize_phone_result_dark', top='.wt-result'); page.emulate_media(color_scheme='light')
        s.check_page(page)

    ctx = s.context('desktop', 'de')
    page = s.open(ctx, PATHS['de'])
    s.pick(page, 'img/gps_photo.jpg')
    s.wait_ready(page, 1)
    def run_one(setup, expect_size, label, check=None):
        setup()
        if s.run(page):
            im = img(s.download(page, 0))
            s.expect(im.size == expect_size, f'{label}: expected {expect_size}, got {im.size}')
            if check: check(im)
            page.locator('.wt-restart button').first.click()
    # px width only, keep aspect (stored 800x600 rotated → 600x800)
    def px():
        page.locator('input[name="wt-opt-mode"][value="px"]').check(force=True); page.fill('#wt-opt-width', '300'); page.fill('#wt-opt-height', '')
    run_one(px, (300, 400), 'px width only')
    def px_box():
        page.fill('#wt-opt-width', '500'); page.fill('#wt-opt-height', '500')
    run_one(px_box, (375, 500), 'px box keep aspect')
    def px_pad():
        page.locator('#wt-opt-keepAspect').uncheck(force=True); page.locator('input[name="wt-opt-exact"][value="pad"]').check()
        page.locator('#wt-opt-background').evaluate("e => { e.value = '#00ff00'; e.dispatchEvent(new Event('change')); }")
    run_one(px_pad, (500, 500), 'pad', lambda im: s.expect(im.convert('RGB').getpixel((5, 250))[1] > 200 and im.convert('RGB').getpixel((5, 250))[0] < 60, f'pad colour {im.convert("RGB").getpixel((5, 250))}'))
    def stretch(): page.locator('input[name="wt-opt-exact"][value="stretch"]').check()
    run_one(stretch, (500, 500), 'stretch')
    def pct():
        page.locator('input[name="wt-opt-mode"][value="percent"]').check()
        page.locator('#wt-opt-percent').evaluate("e => { e.value = '25'; e.dispatchEvent(new Event('change')); }")
    run_one(pct, (150, 200), 'percent 25')
    def long_up():
        page.locator('input[name="wt-opt-mode"][value="long"]').check(force=True); page.fill('#wt-opt-long', '4000')
    run_one(long_up, (600, 800), 'no upscale for long edge')
    def long_up2():
        page.locator('#wt-opt-noUpscale').uncheck(force=True)
    run_one(long_up2, (3000, 4000), 'upscale allowed')
    def webp():
        page.fill('#wt-opt-long', '640'); page.select_option('#wt-opt-format', 'webp')
    run_one(webp, (480, 640), 'webp long 640')
    s.check_page(page)
    # validation: px mode without numbers disables the button
    page.locator('input[name="wt-opt-mode"][value="px"]').check(force=True); page.fill('#wt-opt-width', ''); page.fill('#wt-opt-height', '')
    s.expect(s.primary(page).is_disabled(), 'px without width/height must disable the button')
