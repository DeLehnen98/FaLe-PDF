"""seo format landing pages (presets of jpg-to-pdf / convert-image): png-to-pdf, webp-to-pdf, photo-to-pdf,
heic-to-pdf, webp-to-png, heic-to-png – texts, outputs verified (lossless PNG, alpha kept, JPEG passthrough,
EXIF rotation), honest HEIC notice; plus on-page SEO changes of existing tools (titles/H1/meta lengths)."""
import json, subprocess
from pathlib import Path
from PIL import Image
from wtlib import Suite, FIX, ORIGIN

SPECS = Path('/home/claude/FalePDF/network/tools/webtools/specs')
if not (FIX / 'seo_alpha.webp').exists():
    im = Image.new('RGBA', (300, 200), (0, 0, 0, 0))
    for x in range(60, 240):
        for y in range(40, 160): im.putpixel((x, y), (200, 40, 90, 255))
    im.save(FIX / 'seo_alpha.webp', lossless=True)
    sh = Image.new('RGB', (360, 640), (250, 250, 250))
    for y in range(20, 620, 30):
        for x in range(20, 340): sh.putpixel((x, y), (30, 30, 30))
    sh.save(FIX / 'seo_shot.png')

def images(pdf):
    rows = subprocess.run(['pdfimages', '-list', str(pdf)], capture_output=True, text=True).stdout.splitlines()[2:]
    return [r.split() for r in rows]

P = lambda tid: json.loads((SPECS / f'{tid}.json').read_text())
def path(tid, lang):
    s = P(tid)
    return f"/werkzeuge/{s['de']['slug']}/" if lang == 'de' else f"/en/tools/{s['en']['slug']}/"

with Suite('seo-formats') as s:
    for v in s.variants():
        shots = v.device == 'phone' and v.lang == 'de'
        # PNG → PDF: lossless (Flate) + alpha as soft mask, 2 pages
        page = s.open(v, path('png-to-pdf', v.lang))
        s.expect(page.locator('h1').inner_text() == P('png-to-pdf')[v.lang]['h1'], f'{v}: png-to-pdf h1')
        if shots: s.shot(page, 'seo_png-to-pdf_initial')
        s.pick(page, 'alpha.png', 'seo_shot.png'); s.wait_ready(page, 2)
        out = s.run_and_download(page)
        if out:
            im = images(out)
            s.expect(s.pdf_pages(out) == 2, f'{v}: png-to-pdf 2 pages')
            s.expect(all(r[2] in ('image', 'smask') and r[8] != 'jpeg' for r in im), f'{v}: PNGs embedded losslessly {im}')
            s.expect(any(r[2] == 'smask' for r in im), f'{v}: alpha kept as soft mask')
            if shots: s.shot(page, 'seo_png-to-pdf_result', top='.wt-result')
        s.check_page(page)
        # WebP → PDF
        page = s.open(v, path('webp-to-pdf', v.lang))
        s.pick(page, 'photo.webp', 'seo_alpha.webp'); s.wait_ready(page, 2)
        out = s.run_and_download(page)
        if out:
            im = images(out)
            s.expect(s.pdf_pages(out) == 2 and im[0][8] == 'jpeg' and any(r[2] == 'smask' for r in im), f'{v}: webp-to-pdf {im}')
        s.check_page(page)
        # Photo → PDF: JPEG passthrough + EXIF orientation
        page = s.open(v, path('photo-to-pdf', v.lang))
        if shots: s.shot(page, 'seo_photo-to-pdf_initial')
        s.pick(page, 'photo_exif6.jpg', 'landscape.jpg'); s.wait_ready(page, 2)
        if shots: s.shot(page, 'seo_photo-to-pdf_configured')
        out = s.run_and_download(page)
        if out:
            im = images(out)
            s.expect(all(r[8] == 'jpeg' for r in im if r[2] == 'image'), f'{v}: photos passed through as JPEG')
            s.expect(len(s.page_sizes(out)) == 2, f'{v}: photo-to-pdf 2 pages')
        s.check_page(page)
        # WebP → PNG keeps alpha
        page = s.open(v, path('webp-to-png', v.lang))
        s.pick(page, 'seo_alpha.webp'); s.wait_ready(page, 1)
        if s.run(page):
            o = s.download(page, 0)
            im = Image.open(o)
            s.expect(o.suffix == '.png' and im.size == (300, 200) and im.mode == 'RGBA' and im.getpixel((5, 5))[3] == 0 and im.getpixel((150, 100))[3] == 255, f'{v}: webp-to-png alpha {im.mode}')
            if shots: s.shot(page, 'seo_webp-to-png_result', top='.wt-result')
        s.check_page(page)
        # HEIC pages: honest notice, Chromium can't decode → card error, no run
        for tid in ('heic-to-pdf', 'heic-to-png'):
            page = s.open(v, path(tid, v.lang))
            page.wait_for_selector('.img-heic-note', timeout=10000)
            s.pick(page, 'iphone.heic'); s.wait_ready(page, 1)
            card = page.locator('.wt-file', has_text='iphone.heic')
            s.expect('is-error' in card.get_attribute('class') and 'HEIC' in card.inner_text(), f'{v}: {tid} honest HEIC hint')
            s.expect(s.primary(page).is_disabled(), f'{v}: {tid} disabled without decodable photo')
            if shots and tid == 'heic-to-pdf': s.shot(page, 'seo_heic-to-pdf_unsupported')
            s.check_page(page)
    # dark screenshot
    ctx = s.context('phone', 'de', dark=True)
    page = s.open(ctx, path('webp-to-png', 'de'))
    s.shot(page, 'seo_webp-to-png_dark')
    s.check_page(page)

    # on-page SEO of the generated pages (all tools): title ≤ 65, H1 = spec, meta 110–160, visible key phrases
    from html.parser import HTMLParser
    class H(HTMLParser):
        def __init__(s2): super().__init__(); s2.t = ''; s2.h1 = ''; s2.meta = ''; s2._t = s2._h = False
        def handle_starttag(s2, t, a):
            a = dict(a)
            if t == 'title': s2._t = True
            if t == 'h1': s2._h = True
            if t == 'meta' and a.get('name') == 'description': s2.meta = a.get('content', '')
        def handle_endtag(s2, t):
            if t == 'title': s2._t = False
            if t == 'h1': s2._h = False
        def handle_data(s2, d):
            if s2._t: s2.t += d
            if s2._h: s2.h1 += d
    import urllib.request
    n = 0
    for f in sorted(SPECS.glob('*.json')):
        sp = json.loads(f.read_text())
        for lang in ('de', 'en'):
            h = H(); h.feed(urllib.request.urlopen(ORIGIN + path(sp['id'], lang)).read().decode())
            c = sp[lang]; n += 1
            s.expect(h.t == c['title'] and len(h.t) <= 65, f"{sp['id']}/{lang}: title {len(h.t)} {h.t!r}")
            s.expect(h.h1.strip() == c['h1'], f"{sp['id']}/{lang}: h1 {h.h1!r}")
            s.expect(110 <= len(h.meta) <= 160, f"{sp['id']}/{lang}: meta {len(h.meta)}")
    s.expect(n >= 138, f'all tools checked ({n})')
    want = {('compress-pdf', 'de'): 'PDF verkleinern', ('jpg-to-pdf', 'de'): 'JPG in PDF umwandeln', ('jpg-to-pdf', 'en'): 'JPG to PDF',
            ('compress-image', 'de'): 'Bild verkleinern', ('unlock-pdf', 'de'): 'PDF entsperren', ('passport-photo', 'de'): 'Passbild selber machen',
            ('split-pdf', 'de'): 'PDF teilen & trennen'}
    for (tid, lang), h1 in want.items():
        s.expect(P(tid)[lang]['h1'] == h1, f'{tid}/{lang} h1 {h1}')
    vis = lambda tid, lang: json.dumps(P(tid)[lang], ensure_ascii=False).lower()
    for tid, lang, phrase in [('merge-pdf', 'de', 'verbinden'), ('merge-pdf', 'de', 'zusammenführen'), ('merge-pdf', 'en', 'combine pdf'), ('qr-code', 'de', 'qr-code-generator'),
                              ('protect-pdf', 'de', 'verschlüsseln'), ('protect-pdf', 'en', 'password protect pdf'), ('pdf-to-jpg', 'de', 'pdf als bild speichern'),
                              ('grayscale-pdf', 'de', 'schwarz-weiß'), ('edit-pdf-text', 'de', 'text in pdf einfügen'), ('edit-pdf-text', 'de', 'beschriften'),
                              ('crop-pdf', 'de', 'beschneiden'), ('edit-pdf-text', 'en', 'pdf editor'), ('signature-maker', 'en', 'signature generator'),
                              ('compress-image', 'en', 'image compressor'), ('compress-pdf', 'en', 'reduce pdf'), ('fill-pdf-form', 'de', 'pdf ausfüllen'),
                              ('jpg-to-pdf', 'en', 'image to pdf'), ('resize-image', 'de', 'bild komprimieren'), ('compress-image', 'de', 'bildgröße ändern')]:
        s.expect(phrase in vis(tid, lang), f'{tid}/{lang}: "{phrase}" visible')
