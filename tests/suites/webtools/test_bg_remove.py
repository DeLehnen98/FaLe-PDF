"""remove-background (agent bg): on-device segmentation (U²-Netp / MODNet via onnxruntime-web in a worker).
Checks mask quality against ground truth (IoU > 0.9) on synthetic photos, backgrounds (transparent / colour /
blur / own picture), formats, trim, brush edits, batch, real photos, phone + desktop, DE + EN."""
import io
import numpy as np
from PIL import Image
from wtlib import Suite, FIX

PATHS = {'de': '/werkzeuge/hintergrund-entfernen/', 'en': '/en/tools/remove-background/'}
DONE = "() => /Motiv erkannt|Subject detected/.test(document.querySelector('.bg-status-text')?.textContent || '')"


def gt(name, size):
    return np.asarray(Image.open(FIX / 'bg' / f'{name}_gt.png').convert('L').resize(size, Image.BILINEAR)) >= 128


def iou(a, b):
    return (a & b).sum() / max(1, (a | b).sum())


def alpha_of(path):
    im = Image.open(path)
    return im, (np.asarray(im.convert('RGBA'))[..., 3] >= 128)


def opt(page, oid, value):
    page.locator(f'input[name="wt-opt-{oid}"][value="{value}"]').check()


with Suite('bg-remove') as s:
    for v in s.variants():
        page = s.open(v, PATHS[v.lang])
        if v.device == 'phone':
            s.shot(page, f'remove-background_{v.lang}_initial')
        s.pick(page, 'bg/bg_mug.jpg')
        s.wait_ready(page, 1)
        page.wait_for_function(DONE, timeout=180000)
        s.check_page(page)
        if v.device == 'phone' and v.lang == 'de':
            s.shot(page, 'remove-background_de_preview', top='.new-box')
        out = s.run_and_download(page)
        if out:
            im, a = alpha_of(out)
            s.expect(im.size == (1600, 1200) and im.mode == 'RGBA', f'{v}: full-size RGBA PNG ({im.size} {im.mode})')
            j = iou(a, gt('bg_mug', im.size))
            print(f'{v}: mug IoU {j:.4f}')
            s.expect(j > 0.9, f'{v}: mug IoU {j:.3f} > 0.9')
            s.expect(out.name.endswith('.png') and ('freigestellt' in out.name or 'cut out' in out.name), f'{v}: name {out.name}')
        s.expect(page.locator('.img-result-cmp').count() == 1, f'{v}: before/after slider shown')
        s.check_page(page)
        if v.device == 'phone' and v.lang == 'de':
            s.shot(page, 'remove-background_de_result', top='.wt-result')

        if v.lang == 'de' and v.device == 'phone':
            # colour background + JPG via the live options on the result card
            page.locator('.wt-live-opts input[name="wt-live-bg"][value="color"]').check()
            page.wait_for_selector('.wt-result:not([hidden])', timeout=60000)
            page.locator('#wt-live-format').select_option('jpg')
            page.wait_for_timeout(500)
            page.wait_for_selector('.wt-result:not([hidden]) .wt-output', timeout=60000)
            out = s.download(page, 0)
            im = Image.open(out)
            arr = np.asarray(im.convert('RGB')).astype(int)
            s.expect(out.suffix == '.jpg' and im.mode == 'RGB', f'jpg output ({out.name}, {im.mode})')
            s.expect((arr[5, 5] > 240).all() and (arr[-5, -5] > 240).all(), f'white background corners {arr[5,5]} {arr[-5,-5]}')
            c = arr[600, 700]
            s.expect(c[0] > 120 and c[1] < 90, f'mug stays red in the middle {c}')
        s.contexts and None

    # ---------------------------------------------------------------- deeper checks on one phone context
    ctx = s.context('phone', 'de', dark=True)
    page = s.open(ctx, PATHS['de'])
    s.pick(page, 'bg/bg_mug.jpg', 'bg/bg_ball.jpg', 'bg/bg_bottle.jpg')
    s.wait_ready(page, 3)
    page.wait_for_function(DONE, timeout=180000)
    s.shot(page, 'remove-background_de_dark_batch', top='.new-box')
    # brush: erase a small disc in the middle of the mug, keep a disc in the background (top-left)
    page.locator('.bg-view').scroll_into_view_if_needed()
    box = page.locator('.bg-view canvas').bounding_box()
    page.locator('.bg-modes button[data-mode="erase"]').click()
    def paint(fx, fy):
        page.locator('.bg-view').scroll_into_view_if_needed()
        box = page.locator('.bg-view canvas').bounding_box()
        x, y = box['x'] + box['width'] * fx, box['y'] + box['height'] * fy
        page.touchscreen.tap(x, y)
    page.locator('#bg-brush').fill('10')
    paint(0.47, 0.5)
    page.locator('.bg-modes button[data-mode="keep"]').click()
    paint(0.1, 0.12)
    page.wait_for_timeout(300)
    s.expect(page.evaluate("() => document.querySelector('.bg-view') !== null"), 'editor present')
    if s.run(page, timeout=300000):
        n = page.locator('.wt-output').count()
        s.expect(n == 3, f'batch: 3 outputs ({n})')
        for i, name in enumerate(['bg_mug', 'bg_ball', 'bg_bottle']):
            out = s.download(page, i)
            im, a = alpha_of(out)
            j = iou(a, gt(name, im.size))
            print(f'batch {name}: IoU {j:.4f}')
            if name == 'bg_mug':
                W, H = im.size
                s.expect(not a[int(H * 0.5), int(W * 0.47)], 'erase brush removed the middle of the mug')
                s.expect(a[int(H * 0.12), int(W * 0.1)], 'keep brush kept a background spot')
                s.expect(j > 0.85, f'mug IoU with edits {j:.3f}')
            else:
                s.expect(j > 0.9, f'batch {name}: IoU {j:.3f} > 0.9')
    s.check_page(page)

    # trim + blur + WebP; own background picture
    page = s.open(s.context('desktop', 'en'), PATHS['en'])
    s.pick(page, 'bg/bg_bottle.jpg')
    s.wait_ready(page, 1)
    page.wait_for_function(DONE, timeout=180000)
    opt(page, 'bg', 'blur')
    page.locator('#wt-opt-trim').check(force=True)
    page.locator('#wt-opt-format').select_option('webp')
    out = s.run_and_download(page)
    if out:
        im = Image.open(out)
        s.expect(out.suffix == '.webp', f'webp ({out.name})')
        w, h = im.size
        s.expect(300 < w < 520 and 1100 < h < 1300, f'trimmed to the bottle (+2 % margin): {im.size}')
        a = np.asarray(im.convert('RGBA'))[..., 3]
        s.expect(a.min() > 250, 'blurred background is opaque')
    page.locator('.wt-result .wt-btn', has_text='Back').first.click() if page.locator('.wt-result .wt-btn', has_text='Back').count() else page.go_back()
    page.wait_for_selector('#wt-opt-format', state='visible')
    opt(page, 'bg', 'image')
    page.locator('#wt-opt-trim').uncheck(force=True)
    page.set_input_files('#bg-file', str(FIX / 'bg' / 'bg_backdrop.jpg'))
    page.wait_for_selector('.bg-bgimg img:not([hidden])')
    page.locator('#wt-opt-format').select_option('png')
    out = s.run_and_download(page)
    if out:
        arr = np.asarray(Image.open(out).convert('RGBA')).astype(int)
        s.expect(arr[..., 3].min() > 250 and arr[10, 10, 2] > arr[10, 10, 0] + 30, f'own (bluish) picture behind the subject {arr[10,10]}')
        s.expect(arr[800, 600, 2] > 150 and arr[800, 600, 0] < 120, f'bottle stays blue {arr[800,600]}')
    s.check_page(page)

    # real photos (freely licensed): cat with the object model, astronaut with the person model
    page = s.open(s.context('desktop', 'de'), PATHS['de'])
    s.pick(page, 'bg/bg_real_astronaut.jpg')
    s.wait_ready(page, 1)
    page.wait_for_function(DONE, timeout=180000)
    opt(page, 'model', 'person')
    page.wait_for_function(DONE, timeout=180000)
    out = s.run_and_download(page)
    if out:
        im, a = alpha_of(out)
        print('astronaut (person model) fg fraction', round(a.mean(), 3))
        s.expect(a[98, 219] and a[402, 85] and not a[30, 30] and not a[50, 480], 'astronaut: face/suit kept, flag/rocket corner removed')
        s.expect(0.25 < a.mean() < 0.6, f'astronaut fg fraction {a.mean():.2f}')
    s.check_page(page)
print('ok')
