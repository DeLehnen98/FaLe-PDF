"""remove-exif: shows GPS/camera/serial/etc. as text (no map, no requests), lossless strip for JPEG/PNG/WebP
(pixels identical + JPEG scan bytes identical), orientation kept, optional date, AVIF re-saved as JPG,
trailer removed, DE/EN × phone/desktop."""
import numpy as np
from PIL import Image
from wtlib import Suite, FIX

PATHS = {'de': '/werkzeuge/exif-entfernen/', 'en': '/en/tools/remove-exif-data/'}
def img(p):
    im = Image.open(p); im.load(); return im
def scan(b):
    i = b.find(b'\xff\xda'); return b[i:b.rfind(b'\xff\xd9') + 2]

with Suite('remove-exif') as s:
    for v in s.variants():
        page = s.open(v, PATHS[v.lang])
        shots = v.device == 'phone' and v.lang == 'de'
        if shots: s.shot(page, 'img_exif_phone_initial')
        s.pick(page, 'img/gps_photo.jpg', 'img/meta.png', 'img/meta.webp', 'img/clean.jpg', 'pic.avif')
        s.wait_ready(page, 5)
        page.wait_for_function("() => document.querySelectorAll('.img-exif-item').length === 5 && !/…|\\.\\.\\./.test(document.querySelector('.img-exif-sum').textContent)")
        txt = page.locator('.img-exif').inner_text()
        s.expect('52.520096, 13.410250' in txt, f'{v}: GPS coordinates as text')
        s.expect('SN-123456789' in txt and 'FaLeCam' in txt, f'{v}: serial + camera shown')
        s.expect(('3 von 5' in txt) if v.lang == 'de' else ('3 of 5' in txt), f'{v}: summary count: {page.locator(".img-exif-sum").inner_text()}')
        s.expect(page.locator('.img-exif-item').nth(3).locator('.img-chip-ok').count() == 1, f'{v}: clean photo marked as clean')
        if shots: s.shot(page, 'img_exif_phone_configured', top='.img-exif')
        s.check_page(page)
        if not s.run(page): continue
        if shots:
            s.shot(page, 'img_exif_phone_result', top='.wt-result')
            page.emulate_media(color_scheme='dark'); s.shot(page, 'img_exif_phone_result_dark', top='.wt-result'); page.emulate_media(color_scheme='light')
        s.check_page(page)
        o = s.download(page, 0)
        src = (FIX / 'img/gps_photo.jpg').read_bytes(); out = o.read_bytes()
        s.expect(scan(src) == scan(out), f'{v}: JPEG scan data must be identical')
        s.expect(b'SEFT' not in out and b'Musterstrasse' not in out and b'FaLeCam' not in out and b'http://ns.adobe.com' not in out, f'{v}: metadata/trailer bytes gone')
        im = img(o); ex = im.getexif()
        s.expect(dict(ex) == {274: 6} and not ex.get_ifd(0x8825), f'{v}: only orientation left: {dict(ex)}')
        s.expect(o.name == 'gps_photo.jpg', f'{v}: same file name {o.name}')
        for idx, name in [(1, 'meta.png'), (2, 'meta.webp')]:
            p = s.download(page, idx)
            a, b = img(FIX / 'img' / name), img(p)
            s.expect(np.array_equal(np.array(a.convert('RGBA')), np.array(b.convert('RGBA'))), f'{v}: {name} pixels identical')
            s.expect(not dict(b.getexif()) and not {k for k in b.info if k not in ('loop', 'background', 'timestamp', 'duration', 'dpi')}, f'{v}: {name} clean: {dict(b.getexif())} {b.info.keys()}')
        av = s.download(page, 4)
        s.expect(av.suffix == '.jpg' and img(av).format == 'JPEG', f'{v}: AVIF re-saved as JPG {av.name}')
        s.expect(('lossless' in page.locator('.wt-result').inner_text()) or ('verlustfrei' in page.locator('.wt-result').inner_text()), f'{v}: lossless note')

    # keep the date
    ctx = s.context('desktop', 'de')
    page = s.open(ctx, PATHS['de'])
    s.pick(page, 'img/phone_big.jpg')
    s.wait_ready(page, 1)
    page.locator('#wt-opt-keepDate').check(force=True)
    if s.run(page):
        o = s.download(page, 0); ex = img(o).getexif()
        s.expect(ex.get(274) == 6 and ex.get_ifd(0x8769).get(0x9003) == '2024:05:17 14:03:21' and 0x010F not in ex and not ex.get_ifd(0x8825), f'keepDate: {dict(ex)}')
        s.expect(scan(o.read_bytes()) == scan((FIX / 'img/phone_big.jpg').read_bytes()), 'keepDate: lossless')
    s.check_page(page)
