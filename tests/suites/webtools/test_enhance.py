"""enhance-photo: document mode brightens the paper (shadow gone), sharpen raises edge contrast, brighten lifts dark
photos, output keeps size and format, live strength change on the result re-runs, before/after slider, DE/EN."""
from PIL import Image, ImageFilter, ImageStat
import numpy as np
from wtlib import Suite, FIX

PATHS = {'de': '/werkzeuge/foto-verbessern/', 'en': '/en/tools/enhance-photo/'}


def make_fixtures():
    # dark, blurred photo with a shadow gradient over "paper" with text-like strokes
    if not (FIX / 'enh_doc.jpg').exists():
        w, h = 1200, 900
        y, x = np.mgrid[0:h, 0:w]
        paper = 200 - 110 * (x / w)            # shadow from right to left
        img = np.stack([paper, paper * 0.98, paper * 0.95], -1)
        for row in range(120, 800, 60):
            img[row:row + 8, 120:1080] *= 0.25   # text lines
        Image.fromarray(img.clip(0, 255).astype('uint8')).filter(ImageFilter.GaussianBlur(1.6)).save(FIX / 'enh_doc.jpg', quality=88)
    if not (FIX / 'enh_dark.png').exists():
        src = Image.open(FIX / 'img' / 'portrait.jpg').convert('RGB').resize((800, 1000))
        Image.eval(src, lambda v: int(v * 0.35)).save(FIX / 'enh_dark.png')


def luma(path, box=None):
    im = Image.open(path).convert('L')
    if box: im = im.crop(box)
    return ImageStat.Stat(im).mean[0]


def edge(path):
    a = np.asarray(Image.open(path).convert('L'), dtype=float)
    return float(np.abs(np.diff(a, axis=0)).mean())


make_fixtures()
with Suite('enhance-photo') as s:
    for v in s.variants():
        page = s.open(v, PATHS[v.lang])
        s.pick(page, 'enh_doc.jpg')
        s.wait_ready(page, 1)
        page.locator('input[name="wt-opt-mode"][value="document"]').check()
        s.check_page(page)
        out = s.run_and_download(page)
        if out:
            im = Image.open(out)
            s.expect(im.size == (1200, 900) and out.suffix == '.jpg', f'{v}: same size and format {im.size} {out.suffix}')
            # the shadowed (left) paper area is much brighter afterwards
            before, after = luma(FIX / 'enh_doc.jpg', (20, 20, 100, 100)), luma(out, (20, 20, 100, 100))
            s.expect(after > before + 40, f'{v}: shadow removed ({before:.0f} → {after:.0f})')
            s.expect(page.locator('.img-result-cmp').count() == 1, f'{v}: before/after slider')
        page.close()

    ctx = s.context('desktop', 'de')
    page = s.open(ctx, PATHS['de'])
    s.pick(page, 'enh_doc.jpg')
    s.wait_ready(page, 1)
    page.locator('input[name="wt-opt-mode"][value="sharpen"]').check()
    out = s.run_and_download(page)
    if out:
        s.expect(edge(out) > edge(FIX / 'enh_doc.jpg') * 1.15, f'sharpen raises edge contrast ({edge(FIX / "enh_doc.jpg"):.2f} → {edge(out):.2f})')
        # live: strength on the result → re-run
        first = out.stat().st_size
        page.locator('#wt-live-strength').fill('100')
        page.locator('#wt-live-strength').dispatch_event('input')
        page.locator('#wt-live-strength').dispatch_event('change')
        page.wait_for_timeout(500)
        page.wait_for_selector('.wt-result:not([hidden])', timeout=60000)
        out2 = s.download(page)
        s.expect(edge(out2) > edge(out), f'stronger setting sharpens more ({edge(out):.2f} → {edge(out2):.2f})')
    page.close()

    page = s.open(ctx, PATHS['de'])
    s.pick(page, 'enh_dark.png')
    s.wait_ready(page, 1)
    page.locator('input[name="wt-opt-mode"][value="brighten"]').check()
    out = s.run_and_download(page)
    if out:
        s.expect(out.suffix == '.png' and luma(out) > luma(FIX / 'enh_dark.png') + 25, f'dark photo brightened, PNG kept ({luma(FIX / "enh_dark.png"):.0f} → {luma(out):.0f})')
    s.check_page(page)
    page.close()
