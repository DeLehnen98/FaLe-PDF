"""extract-images (agent conv): JPEG passthrough (byte-identical), PNG with alpha, grey JPEG, dedupe, min-size
filter, CMYK JPEG decoded, scanned page, no-images message."""
import subprocess, zipfile
from PIL import Image
from wtlib import Suite, OUT, FIX

P = {'de': '/werkzeuge/bilder-aus-pdf-extrahieren/', 'en': '/en/tools/extract-images-from-pdf/'}


def set_range(page, id_, value):
    page.evaluate("""([id, v]) => { const i = document.getElementById(id); i.value = String(v);
      i.dispatchEvent(new Event('input', {bubbles: true})); i.dispatchEvent(new Event('change', {bubbles: true})); }""", [id_, value])


def raw_jpegs(pdf):
    d = OUT / ('_raw_' + pdf.replace('.', '_'))
    d.mkdir(exist_ok=True)
    subprocess.run(['pdfimages', '-j', str(FIX / pdf), str(d / 'img')], check=True)
    return {p.read_bytes() for p in d.glob('*.jpg')}


with Suite('conv-extract') as s:
    originals = raw_jpegs('conv_images.pdf')
    for v in s.variants():
        page = s.open(v, P[v.lang])
        shots = v.device == 'phone' and v.lang == 'de'
        if shots: s.shot(page, 'extract-images_phone_initial')
        s.pick(page, 'conv_images.pdf')
        s.wait_ready(page, 1)
        if shots: s.shot(page, 'extract-images_phone_configured', top='.wt-opts')
        s.check_page(page)
        if not s.run(page):
            continue
        n = page.locator('.wt-output').count()
        s.expect(n == 4, f'{v}: 4 images expected (icon skipped, duplicate once), got {n}')
        if shots:
            s.shot(page, 'extract-images_phone_result', top='.wt-result')
            page.emulate_media(color_scheme='dark'); s.shot(page, 'extract-images_phone_result_dark', top='.wt-result'); page.emulate_media(color_scheme='light')
        s.check_page(page)
        outs = [s.download(page, i) for i in range(n)]
        jpgs = [o for o in outs if o.suffix == '.jpg']
        pngs = [o for o in outs if o.suffix == '.png']
        s.expect(len(jpgs) == 2 and len(pngs) == 2, f'{v}: 2 jpg + 2 png: {[o.name for o in outs]}')
        s.expect(all(o.read_bytes() in originals for o in jpgs), f'{v}: JPEGs must be byte-identical to the embedded ones')
        alpha = [Image.open(o) for o in pngs if Image.open(o).size == (300, 200)]
        s.expect(alpha and alpha[0].mode == 'RGBA' and alpha[0].getpixel((2, 2))[3] == 0 and alpha[0].getpixel((150, 30))[3] > 150, f'{v}: alpha kept in PNG')
        s.expect(any(Image.open(o).size == (400, 300) and Image.open(o).mode == 'L' for o in jpgs), f'{v}: grey JPEG kept')
        page.close()

    ctx = s.context('desktop', 'de')
    # min size 0 → the icon too; dedupe off → the second use of the photo is still the same object (once)
    page = s.open(ctx, P['de'])
    s.pick(page, 'conv_images.pdf'); s.wait_ready(page, 1)
    set_range(page, 'wt-opt-minSize', 0)
    if s.run(page):
        s.expect(page.locator('.wt-output').count() == 5, f'min size 0: 5 images, got {page.locator(".wt-output").count()}')
        z = s.download_click(page, page.get_by_role('button', name='Alle als ZIP').first)
        s.expect(len(zipfile.ZipFile(z).namelist()) == 5, 'ZIP with 5')
    page.close()
    # CMYK JPEG → decoded PNG; text-only PDF → friendly message; scan → full page image
    page = s.open(ctx, P['de'])
    s.pick(page, 'conv_cmyk.pdf'); s.wait_ready(page, 1)
    if s.run(page):
        o = s.download(page)
        im = Image.open(o)
        s.expect(o.suffix == '.png' and im.size == (200, 150), f'CMYK decoded to PNG: {o.name} {im.size}')
        # colours plausible (not inverted): top rows are dark-ish blue/red gradient start → compare with PIL decode
        ref = Image.open(FIX / 'conv_cmyk.jpg').convert('RGB').resize((20, 15))
        got = im.convert('RGB').resize((20, 15))
        diff = sum(abs(a - b) for p, q in zip(ref.get_flattened_data(), got.get_flattened_data()) for a, b in zip(p, q)) / (20 * 15 * 3)
        s.expect(diff < 40, f'CMYK colours plausible (mean diff {diff:.1f})')
    page.close()
    page = s.open(ctx, P['de'])
    s.pick(page, 'text3.pdf'); s.wait_ready(page, 1)
    page.locator('.wt-bar .wt-btn-primary').click()
    page.wait_for_selector('.wt-error:not([hidden])', timeout=30000)
    s.expect('keine eingebetteten Bilder' in page.locator('.wt-error').inner_text(), 'no images message')
    page.close()
    page = s.open(ctx, P['de'])
    s.pick(page, 'conv_scan.pdf'); s.wait_ready(page, 1)
    if s.run(page):
        o = s.download(page)
        s.expect(o.suffix == '.jpg' and Image.open(o).size == (1240, 1754), f'scan page: {o.name}')
    page.close()
