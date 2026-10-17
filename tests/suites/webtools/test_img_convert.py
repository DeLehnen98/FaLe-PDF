"""convert-image + presets (png-to-jpg, jpg-to-png, webp-to-jpg, heic-to-jpg): formats, transparency →
background colour, capture date kept (EXIF only date), orientation, honest HEIC notice, DE/EN × phone/desktop."""
from PIL import Image
from wtlib import Suite

P = {'convert': {'de': '/werkzeuge/bild-umwandeln/', 'en': '/en/tools/convert-image/'},
     'png': {'de': '/werkzeuge/png-in-jpg/', 'en': '/en/tools/png-to-jpg/'},
     'jpg': {'de': '/werkzeuge/jpg-in-png/', 'en': '/en/tools/jpg-to-png/'},
     'webp': {'de': '/werkzeuge/webp-in-jpg/', 'en': '/en/tools/webp-to-jpg/'},
     'heic': {'de': '/werkzeuge/heic-in-jpg/', 'en': '/en/tools/heic-to-jpg/'}}
def img(p):
    im = Image.open(p); im.load(); return im

with Suite('convert-image') as s:
    for v in s.variants():
        shots = v.device == 'phone' and v.lang == 'de'
        page = s.open(v, P['convert'][v.lang])
        if shots: s.shot(page, 'img_convert_phone_initial')
        s.pick(page, 'img/gps_photo.jpg', 'img/logo.png', 'img/meta.webp', 'anim.gif', 'pic.bmp')
        s.wait_ready(page, 5)
        page.locator('input[name="wt-opt-to"][value="jpg"]').check()
        page.locator('#wt-opt-background').evaluate("e => { e.value = '#ff0000'; e.dispatchEvent(new Event('change')); }")
        if shots: s.shot(page, 'img_convert_phone_configured', top='.wt-opts-sec')
        s.check_page(page)
        if not s.run(page): continue
        s.expect(page.locator('.wt-output').count() == 5, f'{v}: 5 outputs')
        if shots:
            s.shot(page, 'img_convert_phone_result', top='.wt-result')
            page.emulate_media(color_scheme='dark'); s.shot(page, 'img_convert_phone_result_dark', top='.wt-result'); page.emulate_media(color_scheme='light')
        a = img(s.download(page, 0))
        ex = a.getexif()
        s.expect(a.format == 'JPEG' and a.size == (600, 800), f'{v}: jpg rotated {a.size}')
        s.expect(ex.get_ifd(0x8769).get(0x9003) == '2024:05:17 14:03:21' and not ex.get_ifd(0x8825) and 0x010F not in ex, f'{v}: only the date kept: {dict(ex)} {ex.get_ifd(0x8769)}')
        b = img(s.download(page, 1))
        s.expect(b.format == 'JPEG' and b.convert('RGB').getpixel((2, 2))[0] > 200 and b.convert('RGB').getpixel((2, 2))[1] < 60, f'{v}: transparent → red bg {b.convert("RGB").getpixel((2, 2))}')
        s.expect('Hintergrundfarbe' in page.locator('.wt-result').inner_text() or 'background colour' in page.locator('.wt-result').inner_text(), f'{v}: note about flattened transparency')
        s.check_page(page)

        # to PNG / WebP
        page.locator('.wt-restart button').first.click()
        page.locator('input[name="wt-opt-to"][value="png"]').check()
        if s.run(page):
            o = img(s.download(page, 1))
            s.expect(o.format == 'PNG' and o.mode == 'RGBA' and o.getpixel((2, 2))[3] == 0, f'{v}: png keeps alpha {o.mode}')

    # presets: target fixed, option hidden
    for key, fx, fmt in [('png', 'img/logo.png', 'JPEG'), ('jpg', 'img/gps_photo.jpg', 'PNG'), ('webp', 'img/meta.webp', 'JPEG')]:
        for lang in ('de', 'en'):
            ctx = s.context('phone', lang)
            page = s.open(ctx, P[key][lang])
            s.expect(page.locator('input[name="wt-opt-to"]').count() == 0 or page.locator('fieldset:has(input[name="wt-opt-to"])').is_hidden(), f'{key}/{lang}: target choice hidden')
            s.pick(page, fx)
            s.wait_ready(page, 1)
            if s.run(page):
                o = img(s.download(page, 0))
                s.expect(o.format == fmt, f'{key}/{lang}: {o.format} != {fmt}')
            s.check_page(page)
            if key == 'png' and lang == 'de': s.shot(page, 'img_png2jpg_phone_result', top='.wt-result')
    # wrong type on a preset page is rejected with a notice
    ctx = s.context('desktop', 'de')
    page = s.open(ctx, P['png']['de'])
    s.pick(page, 'img/clean.jpg')
    page.wait_for_selector('.wt-notice:not([hidden])')
    # HEIC: honest notice up front, file shows the HEIC hint in Chromium
    for lang in ('de', 'en'):
        ctx = s.context('phone', lang)
        page = s.open(ctx, P['heic'][lang])
        page.wait_for_selector('.img-heic-note')
        s.expect('Safari' in page.locator('.img-heic-note').inner_text(), f'heic/{lang}: honest notice')
        if lang == 'de': s.shot(page, 'img_heic_phone_initial')
        s.pick(page, 'iphone.heic')
        s.wait_ready(page, 1)
        card = page.locator('.wt-file')
        s.expect('is-error' in card.get_attribute('class') and 'HEIC' in card.inner_text(), f'heic/{lang}: HEIC hint on the card')
        s.expect(s.primary(page).is_disabled(), f'heic/{lang}: nothing to convert')
        if lang == 'de': s.shot(page, 'img_heic_phone_files')
        s.check_page(page)
