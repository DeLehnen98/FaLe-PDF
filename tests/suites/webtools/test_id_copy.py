"""id-copy: photos of an ID card's front and back (synthetic, tilted on a dark table) → straightened, real size
(85.6 × 54 mm) on one A4 PDF; "KOPIE" mark, black-out box burned in, greyscale, JPG output, passport format."""
import io, subprocess
from PIL import Image, ImageDraw, ImageFont
from wtlib import Suite, FIX
import pypdf

PATHS = {'de': '/werkzeuge/ausweis-kopieren/', 'en': '/en/tools/copy-id-card/'}
MM = 72 / 25.4


def card_photo(path, side):
    """A colourful card (ID-1 ratio) with text, perspective-tilted on a dark wooden table."""
    W, H = 1712, 1080
    card = Image.new('RGB', (W, H), (226, 232, 214) if side == 'front' else (214, 222, 236))
    d = ImageDraw.Draw(card)
    try:
        f = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', 70)
        s = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', 54)
    except OSError:
        f = s = ImageFont.load_default()
    d.rectangle([0, 0, W, 150], fill=(40, 90, 160))
    d.text((40, 35), 'MUSTERKARTE', fill='white', font=f)
    if side == 'front':
        d.rectangle([60, 220, 520, 860], fill=(150, 150, 160))
        d.text((600, 260), 'MUSTERMANN', fill=(20, 20, 20), font=f)
        d.text((600, 360), 'ERIKA', fill=(20, 20, 20), font=s)
        d.text((1250, 940), '123456', fill=(10, 10, 10), font=f)   # "access number" bottom right
    else:
        d.text((80, 300), 'ANSCHRIFT: MUSTERSTR. 1', fill=(20, 20, 20), font=s)
        d.text((80, 900), 'IDD<<T220001293<<<<<<<<<<<<<<<', fill=(20, 20, 20), font=s)
    bg = Image.new('RGB', (2400, 1800), (52, 38, 30))
    # perspective: card corners → tilted quad on the table
    quad = [(380, 330), (2020, 420), (1960, 1460), (330, 1330)]
    coeffs = _persp(quad, [(0, 0), (W, 0), (W, H), (0, H)])
    warped = card.transform(bg.size, Image.PERSPECTIVE, coeffs, Image.BICUBIC)
    mask = Image.new('L', (W, H), 255).transform(bg.size, Image.PERSPECTIVE, coeffs, Image.BICUBIC)
    bg.paste(warped, (0, 0), mask)
    bg.save(path, 'JPEG', quality=90)


def _persp(dst, src):
    import numpy as np
    A, B = [], []
    for (x, y), (u, v) in zip(dst, src):
        A += [[x, y, 1, 0, 0, 0, -u * x, -u * y], [0, 0, 0, x, y, 1, -v * x, -v * y]]
        B += [u, v]
    return np.linalg.solve(np.array(A, float), np.array(B, float)).tolist()


for side in ('front', 'back'):
    p = FIX / f'id_{side}.jpg'
    if not p.exists():
        card_photo(p, side)


def image_boxes(path):
    """Placed images as (width_mm, height_mm) from pdfimages (pixels / ppi), and the page count."""
    rows = subprocess.run(['pdfimages', '-list', str(path)], capture_output=True, text=True).stdout.strip().splitlines()[2:]
    out = []
    for r in rows:
        c = r.split()
        w, h, xppi, yppi = int(c[3]), int(c[4]), float(c[12]), float(c[13])
        out.append((w / xppi * 25.4, h / yppi * 25.4))
    return out, len(pypdf.PdfReader(str(path)).pages)


with Suite('id-copy') as s:
    for v in s.variants():
        page = s.open(v, PATHS[v.lang])
        s.pick(page, 'id_front.jpg', 'id_back.jpg')
        s.wait_ready(page, 2)
        page.wait_for_selector('.img-scan-handle')
        head = page.locator('#img-scan-h').inner_text()
        s.expect(head in ('Vorderseite', 'Front'), f'{v}: side names ({head})')
        s.expect('erkannt' in page.locator('.img-scan .img-muted[role=status]').inner_text() or 'found' in page.locator('.img-scan .img-muted[role=status]').inner_text(), f'{v}: card edges detected')
        if v.lang == 'de' and v.device == 'desktop':
            # black out the "access number" (bottom right of the front)
            page.locator('.id-redact summary').click()
            page.wait_for_selector('.id-redact-surface', timeout=20000)
            surf = page.locator('.id-redact-surface').first
            surf.scroll_into_view_if_needed()
            b = surf.bounding_box()
            page.mouse.move(b['x'] + b['width'] * 0.70, b['y'] + b['height'] * 0.84)
            page.mouse.down(); page.mouse.move(b['x'] + b['width'] * 0.97, b['y'] + b['height'] * 0.97, steps=6); page.mouse.up()
            s.expect(page.locator('.id-redact-rect:not(.is-live)').count() == 1, 'one black-out box drawn')
        s.check_page(page)
        out = s.run_and_download(page)
        if out:
            boxes, n = image_boxes(out)
            s.expect(n == 1 and len(boxes) == 2, f'{v}: both sides on one page ({n} pages, {boxes})')
            for w, h in boxes:
                s.expect(abs(w - 85.6) < 0.6 and abs(h - 53.98) < 0.6, f'{v}: real size 85.6 × 54 mm ({w:.1f} × {h:.1f} mm)')
            ok, msg = s.qpdf_check(out); s.expect(ok, f'{v}: qpdf {msg}')
        page.close()

    # JPG output: black box burned in, KOPIE mark (red pixels), greyscale option
    ctx = s.context('desktop', 'de')
    page = s.open(ctx, PATHS['de'])
    s.pick(page, 'id_front.jpg')
    s.wait_ready(page, 1)
    page.wait_for_selector('.img-scan-handle')
    page.locator('.id-redact summary').click()
    page.wait_for_selector('.id-redact-surface', timeout=20000)
    surf = page.locator('.id-redact-surface').first
    surf.scroll_into_view_if_needed()
    b = surf.bounding_box()
    page.mouse.move(b['x'] + b['width'] * 0.70, b['y'] + b['height'] * 0.84)
    page.mouse.down(); page.mouse.move(b['x'] + b['width'] * 0.97, b['y'] + b['height'] * 0.97, steps=6); page.mouse.up()
    page.locator('input[name="wt-opt-output"][value="jpg"]').check()
    page.fill('#wt-opt-purpose', 'Nur Mietvertrag')
    page.select_option('#wt-opt-for', 'landlord')
    out = s.run_and_download(page)
    if out:
        im = Image.open(out).convert('RGB')
        W, H = im.size
        s.expect(abs(W / H - 85.6 / 53.98) < 0.02 and W >= 1000, f'card format {W}×{H}')
        px = im.getpixel((int(W * 0.85), int(H * 0.92)))
        s.expect(max(px) < 30, f'black-out burned in {px}')
        reds = sum(1 for x in range(0, W, 8) for y in range(0, H, 8) if (lambda p: p[0] - p[1] > 35 and p[0] - p[2] > 35)(im.getpixel((x, y))))
        s.expect(reds > 50, f'KOPIE mark visible ({reds} reddish samples)')
    page.close()

    ctx = s.context('phone', 'de')
    page = s.open(ctx, PATHS['de'])
    s.pick(page, 'id_front.jpg')
    s.wait_ready(page, 1)
    page.locator('input[name="wt-opt-color"][value="gray"]').check()
    page.locator('input[name="wt-opt-output"][value="jpg"]').check()
    page.locator('label[for="wt-opt-mark"]').click()   # no mark
    out = s.run_and_download(page)
    if out:
        im = Image.open(out).convert('RGB')
        sample = [im.getpixel((x, y)) for x in range(0, im.width, 37) for y in range(0, im.height, 37)]
        s.expect(all(abs(p[0] - p[1]) < 6 and abs(p[1] - p[2]) < 6 for p in sample), 'greyscale output')
    # passport format
    page.close()
    page = s.open(ctx, PATHS['de'])
    s.pick(page, 'id_front.jpg')
    s.wait_ready(page, 1)
    page.locator('input[name="wt-opt-format"][value="passport"]').check()
    out = s.run_and_download(page)
    if out:
        boxes, n = image_boxes(out)
        s.expect(len(boxes) == 1 and abs(boxes[0][0] - 125) < 0.6 and abs(boxes[0][1] - 88) < 0.6, f'passport 125 × 88 mm {boxes}')
    s.check_page(page)
    page.close()
