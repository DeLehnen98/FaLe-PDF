"""compress-image: quality + target size, formats, EXIF stripped + orientation applied, never larger,
before/after slider, live quality, share-first, batch of 30 phone photos (memory), DE/EN × phone/desktop."""
import io, shutil
from PIL import Image
from wtlib import Suite, FIX, OUT

PATHS = {'de': '/werkzeuge/bild-komprimieren/', 'en': '/en/tools/compress-image/'}
SHARE_STUB = """
navigator.canShare = () => true;
navigator.share = async (d) => { window.__shared = (d.files || []).map(f => f.name); };
"""

def img(path):
    im = Image.open(path); im.load(); return im

with Suite('compress-image') as s:
    for v in s.variants():
        page = s.open(v, PATHS[v.lang])
        shots = v.device == 'phone' and v.lang == 'de'
        if shots: s.shot(page, 'img_compress_phone_initial')
        s.pick(page, 'img/gps_photo.jpg', 'img/phone_big.jpg', 'img/meta.png', 'img/clean.jpg')
        s.wait_ready(page, 4)
        s.check_page(page)
        if shots: s.shot(page, 'img_compress_phone_configured', top='.wt-opts-sec')
        if not s.run(page):
            continue
        s.expect(page.locator('.wt-output').count() == 4, f'{v}: 4 outputs')
        s.expect(page.locator('.img-cmp-view').count() == 1, f'{v}: before/after view')
        s.expect(page.locator('.img-cmp-pick option').count() == 4, f'{v}: comparison picker with 4 images')
        if shots:
            s.shot(page, 'img_compress_phone_result', top='.wt-result')
            page.emulate_media(color_scheme='dark'); s.shot(page, 'img_compress_phone_result_dark', top='.wt-result'); page.emulate_media(color_scheme='light')
        s.check_page(page)
        out0 = s.download(page, 0)
        im = img(out0)
        s.expect(im.size == (600, 800), f'{v}: EXIF-6 photo must be rotated upright, got {im.size}')
        s.expect(not dict(im.getexif()), f'{v}: metadata must be stripped, got {dict(im.getexif())}')
        px = im.convert('RGB').getpixel((im.width - 15, im.height // 2))
        s.expect(px[0] > 150 and px[1] < 110, f'{v}: red band must be on the right after rotation, got {px}')
        out1 = s.download(page, 1)
        s.expect(out1.stat().st_size < (FIX / 'img/phone_big.jpg').stat().st_size, f'{v}: big photo must get smaller')
        # live quality change on the result card re-runs
        if v.device == 'desktop':
            before = page.locator('.wt-out-size').first.inner_text()
            page.locator('#wt-live-quality').fill('30')
            page.locator('#wt-live-quality').dispatch_event('change')
            page.wait_for_function("t => document.querySelector('.wt-out-size') && document.querySelector('.wt-out-size').innerText !== t", arg=before, timeout=30000)
            s.check_page(page)

    # target size + WebP + max edge, desktop DE
    ctx = s.context('desktop', 'de')
    page = s.open(ctx, PATHS['de'])
    s.pick(page, 'img/phone_big.jpg', 'img/panorama.jpg')
    s.wait_ready(page, 2)
    page.locator('input[name="wt-opt-mode"][value="target"]').check()
    page.fill('#wt-opt-target', '150')
    if s.run(page):
        for i in range(2):
            o = s.download(page, i)
            s.expect(o.stat().st_size <= 150 * 1024, f'target: {o.name} {o.stat().st_size} > 150 KB')
            s.expect(o.suffix == '.jpg', f'target keeps jpg {o.name}')
    page.locator('.wt-restart button').first.click()
    page.select_option('#wt-opt-format', 'webp')
    page.select_option('#wt-opt-maxSide', '1280')
    if s.run(page):
        o = s.download(page, 0)
        im = img(o)
        s.expect(o.suffix == '.webp' and max(im.size) == 1280, f'webp + 1280: {o.name} {im.size}')
    s.check_page(page)

    # never larger: an already small JPEG at quality 95 returns the original (stripped) with a note
    page = s.open(ctx, PATHS['de'])
    s.pick(page, 'img/tiny.png')
    s.wait_ready(page, 1)
    if s.run(page):
        o = s.download(page, 0)
        s.expect(o.stat().st_size <= (FIX / 'img/tiny.png').stat().st_size, f'never larger: {o.stat().st_size}')
        s.expect('nicht neu berechnet' in page.locator('.wt-result').inner_text(), 'note about keeping the original')

    # share first (Web Share stub) on the phone
    ctx = s.context('phone', 'de')
    ctx.add_init_script(SHARE_STUB)
    page = s.open(ctx, PATHS['de'])
    s.pick(page, 'img/clean.jpg')
    s.wait_ready(page, 1)
    if s.run(page):
        s.expect(s.primary(page).inner_text().strip() == 'Teilen', f'share first: primary is {s.primary(page).inner_text()!r}')
        s.primary(page).click()
        page.wait_for_function("() => window.__shared && window.__shared.length === 1")

    # 30 phone photos in one go (sequential processing, memory)
    many = OUT / 'img-many'; many.mkdir(parents=True, exist_ok=True)
    names = []
    for k in range(30):
        p = many / f'IMG_{k:04d}.jpg'
        if not p.exists(): shutil.copy(FIX / 'img/phone_big.jpg', p)
        names.append(str(p))
    ctx = s.context('phone', 'en')
    page = s.open(ctx, PATHS['en'])
    page.set_input_files('[data-wt-input]', names)
    s.wait_ready(page, 30, timeout=120000)
    page.select_option('#wt-opt-maxSide', '1920')
    if s.run(page, timeout=240000):
        s.expect(page.locator('.wt-output').count() == 30, '30 outputs')
        zp = s.download_click(page, page.locator('.wt-result-actions button').first)
        import zipfile
        z = zipfile.ZipFile(zp)
        s.expect(len(z.namelist()) == 30 and len(set(z.namelist())) == 30, f'zip with 30 unique names {len(z.namelist())}')
        s.notes.append(f'30 photos: {sum(i.compress_size for i in z.infolist()) // 1024} KB total')
    s.check_page(page)
