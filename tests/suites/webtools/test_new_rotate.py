"""rotate-image: lossless JPEG (EXIF orientation rewritten, scan data byte-identical, composed with an existing
orientation; minimal EXIF when none), PNG pixel rotation, re-encode mode, batch + single, unchanged skipped."""
import os
os.environ.setdefault('WT_PORT', '8790')
from PIL import Image, ImageOps
from wtlib import Suite, FIX

PATHS = {'de': '/werkzeuge/bild-drehen/', 'en': '/en/tools/rotate-image/'}
T = {'de': {'allr': 'Alle rechts', 'alll': 'Alle links', 'one': 'Rechts drehen'}, 'en': {'allr': 'All right', 'alll': 'All left', 'one': 'Rotate right'}}

def scan(b):
    i = b.find(b'\xff\xda')
    return b[i:]

def upright(p):
    return ImageOps.exif_transpose(Image.open(p)).convert('RGB')

def same(a, b, tol=12):
    if a.size != b.size: return False
    a = a.resize((40, 40)); b = b.resize((40, 40))
    return max(abs(x - y) for pa, pb in zip(a.getdata(), b.getdata()) for x, y in zip(pa, pb)) <= tol

with Suite('new-rotate-image') as s:
    for v in s.variants():
        t = T[v.lang]
        shots = v.device == 'phone' and v.lang == 'de'
        page = s.open(v, PATHS[v.lang])
        if shots: s.shot(page, 'rotate-image_phone_initial')
        s.pick(page, 'photo_exif6.jpg', 'new_quad.jpg', 'new_quad.png', 'landscape.jpg')
        s.wait_ready(page, 4)
        page.wait_for_selector('.new-rot-tile img[src]')
        s.expect(s.primary(page).is_disabled(), f'{v}: nothing to do yet → disabled')
        page.locator('button', has_text=t['allr']).click()
        # landscape.jpg back to unchanged: rotate it left once (single tile)
        tile = page.locator('.new-rot-tile', has_text='landscape.jpg')
        tile.locator('button').first.click()
        if shots: s.shot(page, 'rotate-image_phone_configured', top='.new-box')
        s.check_page(page)
        if s.run(page):
            if shots: s.shot(page, 'rotate-image_phone_result')
            outs = {}
            for i in range(page.locator('.wt-output').count()):
                p = s.download(page, i)
                outs[p.name] = p
            s.expect(len(outs) == 3, f'{v}: 3 outputs (unchanged skipped): {list(outs)}')
            o6 = next((p for n, p in outs.items() if n.startswith('photo_exif6')), None)
            if o6:
                s.expect(Image.open(o6).getexif().get(274) == 3, f'{v}: 6 + 90° → orientation 3, got {Image.open(o6).getexif().get(274)}')
                s.expect(scan(o6.read_bytes()) == scan((FIX / 'photo_exif6.jpg').read_bytes()), f'{v}: jpeg scan data identical')
                s.expect(same(upright(o6), upright(FIX / 'photo_exif6.jpg').rotate(-90, expand=True)), f'{v}: exif6 shown rotated right')
            oq = next((p for n, p in outs.items() if n.startswith('new_quad') and n.endswith('.jpg')), None)
            if oq:
                s.expect(Image.open(oq).getexif().get(274) == 6, f'{v}: plain jpeg gets orientation 6')
                s.expect(scan(oq.read_bytes()) == scan((FIX / 'new_quad.jpg').read_bytes()), f'{v}: quad jpeg scan identical')
            op = next((p for n, p in outs.items() if n.endswith('.png')), None)
            if op:
                im = Image.open(op).convert('RGB')
                s.expect(im.size == (300, 400), f'{v}: png rotated size {im.size}')
                s.expect(same(im, Image.open(FIX / 'new_quad.png').convert('RGB').rotate(-90, expand=True), 2), f'{v}: png pixels rotated')
        s.check_page(page)
        page.close()
    # re-encode mode
    ctx = s.context('phone', 'en', dark=True)
    page = s.open(ctx, PATHS['en'])
    s.pick(page, 'photo_exif6.jpg')
    s.wait_ready(page, 1)
    page.wait_for_selector('.new-rot-tile')
    page.locator('input[name="wt-opt-method"][value="pixels"]').check()
    page.locator('button', has_text=T['en']['alll']).click()
    s.shot(page, 'rotate-image_phone_dark', top='.new-box')
    out = s.run_and_download(page)
    if out:
        im = Image.open(out)
        s.expect(im.getexif().get(274) in (None, 1), 'pixels mode: no orientation')
        s.expect(same(im.convert('RGB'), upright(FIX / 'photo_exif6.jpg').rotate(90, expand=True), 20), 'pixels mode: rotated left')
    s.check_page(page)
