"""jpg-to-pdf: all formats, EXIF rotation, JPEG passthrough, page size / orientation / margin, one PDF per image, HEIC message."""
import subprocess, zipfile
from wtlib import Suite

PATHS = {'de': '/werkzeuge/bild-in-pdf/', 'en': '/en/tools/jpg-to-pdf/'}
IMGS = ['photo_exif6.jpg', 'landscape.jpg', 'photo.webp', 'alpha.png', 'anim.gif', 'pic.bmp', 'pic.avif', 'iphone.heic']

with Suite('jpg-to-pdf') as s:
    for v in s.variants():
        page = s.open(v, PATHS[v.lang])
        shots = v.device == 'phone' and v.lang == 'de'
        if shots: s.shot(page, 'jpg_phone_initial')
        if v.device == 'phone':
            s.expect(page.locator('[data-wt-camera]').is_visible(), f'{v}: camera chip should be visible on touch devices')
        s.pick(page, *IMGS)
        s.wait_ready(page, len(IMGS))
        heic = page.locator('.wt-file', has_text='iphone.heic')
        s.expect('HEIC' in heic.inner_text() and 'is-error' in heic.get_attribute('class'), f'{v}: HEIC should show the honest hint')
        s.expect(not s.primary(page).is_disabled(), f'{v}: other images should still be usable')
        if shots: s.shot(page, 'jpg_phone_files', top='.wt-opts-sec')
        s.check_page(page)
        out = s.run_and_download(page)
        if shots:
            s.shot(page, 'jpg_phone_result', top='.wt-result')
            page.emulate_media(color_scheme='dark'); s.shot(page, 'jpg_phone_result_dark', top='.wt-result'); page.emulate_media(color_scheme='light')
        s.check_page(page)
        if not out: continue
        s.expect(s.pdf_pages(out) == 7, f'{v}: 7 pages expected, got {s.pdf_pages(out)}')
        sizes = s.page_sizes(out)
        s.expect(sizes[0][0] < sizes[0][1], f'{v}: EXIF-6 photo must give a portrait page {sizes[0]}')
        s.expect(sizes[1][0] > sizes[1][1], f'{v}: landscape photo → landscape page (auto) {sizes[1]}')
        im = s.render(out, 1, 40)
        px = im.getpixel((im.width // 2, int(im.height * 0.07)))
        s.expect(px[0] > 180 and px[2] < 90, f'{v}: EXIF-6 photo: red band must be on top, got {px}')
        im2 = s.render(out, 2, 40)
        px2 = im2.getpixel((im2.width // 2, int(im2.height * 0.12)))
        s.expect(px2[1] > 120 and px2[0] < 80, f'{v}: landscape photo: green band on top, got {px2}')
        lst = subprocess.run(['pdfimages', '-list', str(out)], capture_output=True, text=True).stdout.splitlines()[2:]
        first = lst[0].split()
        s.expect(first[3:5] == ['1200', '800'] and first[8] == 'jpeg', f'{v}: JPEG must be embedded unchanged (1200x800 jpeg): {first}')
        s.expect(any(l.split()[2] == 'smask' for l in lst), f'{v}: PNG alpha must become a soft mask')

    # page size "image size", no margin, one PDF per image → ZIP
    ctx = s.context('desktop', 'de')
    page = s.open(ctx, PATHS['de'])
    s.pick(page, 'photo_exif6.jpg', 'landscape.jpg')
    s.wait_ready(page, 2)
    page.locator('input[name="wt-opt-size"][value="fit"]').check()
    s.expect(page.locator('#wt-opt-orientation').is_hidden(), 'orientation select hidden for image size')
    page.select_option('#wt-opt-margin', 'none')
    page.locator('input[name="wt-opt-output"][value="each"]').check()
    s.run(page)
    s.expect(page.locator('.wt-output').count() == 2, 'one PDF per image')
    zp = s.download_click(page, page.locator('.wt-result-actions button').first)
    z = zipfile.ZipFile(zp)
    s.expect(sorted(z.namelist()) == ['landscape.pdf', 'photo_exif6.pdf'], f'zip names {z.namelist()}')
    one = s.download(page, 0)
    w, h = s.page_sizes(one)[0]
    s.expect(abs(w - 600) < 1 and abs(h - 900) < 1, f'image-size page should be 600x900 pt, got {w}x{h}')
    s.check_page(page)
