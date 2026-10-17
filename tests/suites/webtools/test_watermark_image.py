"""Watermark photos: DE/EN × phone/desktop, live preview changes with the options, several photos at once
(JPG stays JPG, PNG stays PNG, same size), watermark pixels where expected (corner vs. all over), GPS gone,
smaller web copy, empty text blocks saving, no freeze."""
import numpy as np
from PIL import Image, ImageOps
from wtlib import Suite

P = ('/werkzeuge/bild-wasserzeichen/', '/en/tools/watermark-image/')


def diff_map(a, b):
    op = lambda x: x if isinstance(x, Image.Image) else Image.open(x)
    a = np.asarray(op(a).convert('L').resize((40, 40)), dtype=float)
    b = np.asarray(op(b).convert('L').resize((40, 40)), dtype=float)
    return np.abs(a - b) > 12


def preview_sig(page):
    return page.evaluate("() => { const c = document.querySelector('.img-wm-canvas'); return c.width > 10 ? c.toDataURL().length : 0; }")


with Suite('watermark-image') as s:
    for v in s.variants():
        page = s.open(v, P[0 if v.lang == 'de' else 1])
        s.pick(page, 'img/portrait.jpg')
        s.wait_ready(page, 1)
        page.wait_for_function("() => document.querySelector('.img-wm-canvas')?.width > 10")
        if v.device == 'phone' and v.lang == 'de':
            s.shot(page, 'watermark_image_phone', top='.img-wm-frame')
        s.check_page(page)
        page.close()

    ctx = s.context('desktop', 'de')
    page = s.open(ctx, P[0])
    s.pick(page, 'img/gps_photo.jpg', 'img/meta.png', 'img/panorama.jpg')
    s.wait_ready(page, 3)
    page.wait_for_function("() => document.querySelector('.img-wm-canvas')?.width > 10")
    sig0 = preview_sig(page)
    page.fill('#wt-opt-text', '© Erika Fotografie')
    page.wait_for_timeout(250)
    sig1 = preview_sig(page)
    s.expect(sig0 != sig1, 'preview follows the text')
    s.expect(page.locator('#img-wm-pick option').count() == 3, 'preview picker lists all photos')
    if s.run(page):
        outs = [s.download(page, i) for i in range(3)]
        names = sorted(o.name for o in outs)
        s.expect(any(n.endswith('.png') for n in names) and sum(n.endswith('.jpg') for n in names) == 2, f'formats kept {names}')
        src = {'gps_photo': 'fixtures/img/gps_photo.jpg', 'meta': 'fixtures/img/meta.png', 'panorama': 'fixtures/img/panorama.jpg'}
        for o in outs:
            key = next(k for k in src if o.name.startswith(k))
            s.expect(Image.open(o).size == ImageOps.exif_transpose(Image.open(src[key])).size, f'{o.name}: same size (upright)')
            if key == 'gps_photo':
                s.expect(not Image.open(o).getexif().get_ifd(0x8825), 'GPS removed')
            if key == 'panorama':
                d = diff_map(src[key], o)
                s.expect(d[28:, 20:].any() and not d[:20, :20].any(), f'corner watermark bottom right only ({d.sum()} cells)')
        page.locator('.wt-restart button').first.click()
    # all over the photo, smaller copy
    page.locator('label', has_text='Über das ganze Bild').click()
    page.locator('#wt-opt-maxSide').select_option('1080')
    if s.run(page):
        o = s.download(page, 2)
        im = Image.open(o)
        s.expect(max(im.size) == 1080, f'web copy 1080 px {im.size}')
        d = diff_map(Image.open('fixtures/img/panorama.jpg').resize(im.size), o)
        s.expect(all(q.any() for q in (d[:20, :20], d[:20, 20:], d[20:, :20], d[20:, 20:])), 'tiled watermark in every quarter')
        page.locator('.wt-restart button').first.click()
    page.fill('#wt-opt-text', '')
    page.wait_for_timeout(150)
    s.expect(s.primary(page).is_disabled(), 'empty text blocks saving')
    s.check_page(page)
    s.record_freeze(page)
    page.close()
