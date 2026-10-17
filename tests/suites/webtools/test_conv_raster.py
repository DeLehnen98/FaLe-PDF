"""pdf-to-jpg / pdf-to-png (agent conv): page selection, dpi (incl. written density), quality, transparency,
rotated + mixed page sizes, ZIP of all pages, encrypted input, size estimate, phone cap at 600 dpi."""
import io, struct, zipfile
from PIL import Image
from wtlib import Suite, OUT

JPG = {'de': '/werkzeuge/pdf-in-jpg/', 'en': '/en/tools/pdf-to-jpg/'}
PNG = {'de': '/werkzeuge/pdf-in-png/', 'en': '/en/tools/pdf-to-png/'}
# conv_mixed.pdf: A4, A4 landscape rotated by 90° (→ portrait), A5, 400×400 pt
SIZES_PT = [(595.28, 841.89), (595.28, 841.89), (419.53, 595.28), (400, 400)]


def set_range(page, id_, value):
    page.evaluate("""([id, v]) => { const i = document.getElementById(id); i.value = String(v);
      i.dispatchEvent(new Event('input', {bubbles: true})); i.dispatchEvent(new Event('change', {bubbles: true})); }""", [id_, value])


def jfif_density(path):
    b = path.read_bytes()
    if b[6:11] == b'JFIF\0':
        return b[13], struct.unpack('>H', b[14:16])[0]
    return None


with Suite('conv-raster') as s:
    for v in s.variants():
        page = s.open(v, JPG[v.lang])
        shots = v.device == 'phone' and v.lang == 'de'
        if shots: s.shot(page, 'pdf-to-jpg_phone_initial')
        s.pick(page, 'conv_mixed.pdf')
        s.wait_ready(page, 1)
        # estimate in the bar
        page.wait_for_function("() => /ca\\.|approx\\./.test(document.querySelector('.wt-bar').textContent)", timeout=15000)
        bar = page.locator('.wt-bar').inner_text()
        s.expect('1240' in bar and '1754' in bar, f'{v}: estimate shows pixel size at 150 dpi: {bar!r}')
        set_range(page, 'wt-opt-dpi', 300)
        page.wait_for_function("() => document.querySelector('.wt-bar').textContent.includes('2480')", timeout=10000)
        if shots: s.shot(page, 'pdf-to-jpg_phone_configured', top='.wt-opts')
        s.check_page(page)
        if not s.run(page):
            continue
        n = page.locator('.wt-output').count()
        s.expect(n == 4, f'{v}: 4 images expected, got {n}')
        s.expect(page.locator('.cv-grid img').count() == 4, f'{v}: preview grid with 4 images')
        if shots:
            s.shot(page, 'pdf-to-jpg_phone_result', top='.wt-result')
            page.emulate_media(color_scheme='dark'); s.shot(page, 'pdf-to-jpg_phone_result_dark', top='.wt-result'); page.emulate_media(color_scheme='light')
        s.check_page(page)
        for i in range(4):
            out = s.download(page, i)
            im = Image.open(out)
            w, h = SIZES_PT[i]
            exp = (round(w * 300 / 72), round(h * 300 / 72))
            s.expect(abs(im.size[0] - exp[0]) <= 2 and abs(im.size[1] - exp[1]) <= 2, f'{v}: page {i + 1} size {im.size} != {exp}')
            s.expect(jfif_density(out) == (1, 300), f'{v}: JFIF density 300 dpi, got {jfif_density(out)}')
            s.expect(f'-{"Seite" if v.lang == "de" else "page"}-0{i + 1}.jpg' in out.name, f'{v}: name {out.name}')
        z = s.download_click(page, page.get_by_role('button', name='Alle als ZIP' if v.lang == 'de' else 'All as ZIP').first)
        s.expect(len(zipfile.ZipFile(z).namelist()) == 4, f'{v}: ZIP with 4 images')
        page.close()

    # single page selection → direct image; quality lower → smaller
    ctx = s.context('desktop', 'de')
    page = s.open(ctx, JPG['de'])
    s.pick(page, 'conv_report.pdf'); s.wait_ready(page, 1)
    page.fill('#wt-opt-pages', '2')
    sizes = []
    for q in (95, 50):
        set_range(page, 'wt-opt-quality', q)
        if not s.run(page): break
        s.expect(page.locator('.wt-output').count() == 1, 'one page selected → one image')
        o = s.download(page)
        s.expect(o.name == 'conv_report.jpg', f'single page name: {o.name}')
        sizes.append(o.stat().st_size)
        page.get_by_role('button', name='Zurück zu den Dateien').click() if page.get_by_role('button', name='Zurück zu den Dateien').count() else page.locator('.wt-restart button').first.click()
    if len(sizes) == 2: s.expect(sizes[1] < sizes[0] * 0.7, f'quality 50 should be much smaller: {sizes}')
    page.close()

    # encrypted input
    page = s.open(ctx, JPG['de'])
    s.pick(page, 'encrypted_aes256.pdf'); s.wait_ready(page, 1)
    page.fill('.wt-lock input', 'geheim'); page.click('.wt-lock button')
    page.wait_for_function("() => !document.querySelector('.wt-file.is-locked')")
    if s.run(page): s.expect(page.locator('.wt-output').count() == 3, 'encrypted: 3 pages')
    s.check_page(page)
    page.close()

    # PNG: transparency + phone cap at 600 dpi + dpi chunk
    for v in s.variants(devices=('phone',)):
        page = s.open(v, PNG[v.lang])
        shots = v.lang == 'de'
        if shots: s.shot(page, 'pdf-to-png_phone_initial')
        s.pick(page, 'conv_mixed.pdf'); s.wait_ready(page, 1)
        page.fill('#wt-opt-pages', '1, 4')
        page.locator('label[for=wt-opt-transparent]').click()
        if shots: s.shot(page, 'pdf-to-png_phone_configured', top='.wt-opts')
        if not s.run(page): continue
        s.expect(page.locator('.wt-output').count() == 2, f'{v}: 2 PNGs')
        if shots: s.shot(page, 'pdf-to-png_phone_result', top='.wt-result')
        o = s.download(page, 0)
        im = Image.open(o)
        s.expect(im.mode == 'RGBA' and im.getpixel((3, 3))[3] == 0, f'{v}: transparent corner expected, mode {im.mode} {im.getpixel((3, 3))}')
        dpi = im.info.get('dpi')
        s.expect(dpi and round(dpi[0]) == 150, f'{v}: PNG pHYs 150 dpi, got {dpi}')
        s.check_page(page)
        # 600 dpi on a phone: capped below 16 MP with a note
        page.locator('.wt-restart button').first.click()
        set_range(page, 'wt-opt-dpi', 600)
        if s.run(page):
            o = s.download(page, 0)
            im = Image.open(o)
            s.expect(im.size[0] * im.size[1] <= 16.2e6, f'{v}: phone cap {im.size}')
            s.expect(page.locator('.wt-note').count() >= 1 and ('verringert' in page.locator('.wt-result').inner_text() or 'reduced' in page.locator('.wt-result').inner_text()), f'{v}: cap note')
        page.close()
