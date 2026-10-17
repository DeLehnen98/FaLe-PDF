"""barcode-generator: EAN-13/EAN-8/UPC-A/Code 128/Code 39/ITF-14, check digits added/validated, input errors,
PNG (pHYs dpi) / SVG / PDF (real size) – every output decoded: OpenCV for EAN/UPC (independent), and the
scanline decoder for all types on the actual rendered files; plus node unit tests (seo_units.mjs)."""
import base64, json, subprocess
import cv2, numpy as np
from PIL import Image
from wtlib import Suite, OUT, HERE

PATHS = {'de': '/werkzeuge/barcode-generator/', 'en': '/en/tools/barcode-generator/'}

def rows_of(png):
    g = np.array(Image.open(png).convert('L'))
    h = g.shape[0]
    return [''.join('1' if p < 128 else '0' for p in g[int(h * f)]) for f in (0.3, 0.4, 0.2, 0.5)]

def scan(png, type_, check39=False):
    r = subprocess.run(['node', str(HERE / 'seo_bcdecode.mjs')], input=json.dumps({'type': type_, 'check39': check39, 'rows': rows_of(png)}), capture_output=True, text=True)
    return r.stdout.strip()

def cv_ean(png):
    """OpenCV's EAN/UPC reader (independent of our code); its detector is scale-sensitive, so try several sizes."""
    img = cv2.imread(str(png))
    d = cv2.barcode.BarcodeDetector()
    for target in (300, 400, 250, 500, 200, 700):
        sc = target / img.shape[1]
        im = cv2.resize(img, None, fx=sc, fy=sc, interpolation=cv2.INTER_AREA)
        im = cv2.copyMakeBorder(im, 60, 60, 60, 60, cv2.BORDER_CONSTANT, value=(255, 255, 255))
        ok, infos, types = d.detectAndDecodeWithType(im)[:3]
        found = [x for x in infos if x]
        if found: return found
    return []

def choose(page, t):
    page.locator(f'input[name="seo-bc-type"][value="{t}"]').check(force=True)

with Suite('barcode-generator') as s:
    u = subprocess.run(['node', str(HERE / 'seo_units.mjs')], capture_output=True, text=True)
    s.expect(u.returncode == 0, 'node unit tests: ' + (u.stdout + u.stderr)[-800:])
    for v in s.variants():
        shots = v.device == 'phone' and v.lang == 'de'
        page = s.open(v, PATHS[v.lang])
        page.wait_for_selector('.seo-bc')
        s.expect(page.locator('[data-wt-pick]').is_hidden() and s.primary(page).is_disabled(), f'{v}: no pick zone, disabled when empty')
        if shots: s.shot(page, 'seo_barcode_initial')
        page.fill('#seo-bc-value', '400638133393')
        page.wait_for_selector('.seo-bc .img-qr-test.is-ok')
        info = page.locator('.seo-bc .img-muted').first.inner_text()
        s.expect('4006381333931' in info and ('Prüfziffer 1' in info or 'Check digit 1' in info), f'{v}: check digit added {info!r}')
        if shots: s.shot(page, 'seo_barcode_configured', top='.seo-bc')
        s.check_page(page)
        if s.run(page):
            o = s.download(page, 0)
            s.expect(scan(o, 'ean13') == '4006381333931', f'{v}: PNG scanline decode')
            got = cv_ean(o)
            s.expect('4006381333931' in got, f'{v}: OpenCV reads EAN-13 {got}')
            dpi = Image.open(o).info.get('dpi')
            s.expect(dpi and round(dpi[0]) == 600, f'{v}: PNG carries 600 dpi {dpi}')
            txt = page.locator('.wt-result').inner_text()
            s.expect('Selbsttest bestanden' in txt or 'Self-test passed' in txt, f'{v}: self-test note')
            if shots:
                s.shot(page, 'seo_barcode_result', top='.wt-result')
                page.emulate_media(color_scheme='dark'); s.shot(page, 'seo_barcode_result_dark', top='.wt-result'); page.emulate_media(color_scheme='light')
        s.check_page(page)

    # every type × format on desktop
    ctx = s.context('desktop', 'de')
    page = s.open(ctx, PATHS['de']); page.wait_for_selector('.seo-bc')
    CASES = [('ean13', '5901234123457', '5901234123457'), ('ean8', '9638507', '96385074'), ('upca', '03600029145', '036000291452'),
             ('code128', 'FaLe-2024 0815/äb'.replace('ä', 'a'), 'FaLe-2024 0815/ab'), ('code39', 'art-4711', 'ART-4711'), ('itf14', '1540014128876', '15400141288763')]
    for type_, inp, data in CASES:
        choose(page, type_); page.fill('#seo-bc-value', inp)
        page.wait_for_selector('.seo-bc .img-qr-test.is-ok')
        for fmt in ('png', 'svg', 'pdf'):
            page.locator(f'input[name="wt-opt-format"][value="{fmt}"]').check(force=True)
            if not s.run(page): continue
            o = s.download(page, 0)
            if fmt == 'png': png = o
            elif fmt == 'svg':
                png = OUT / f'bc-{type_}-svg.png'
                r = s.browser.new_page(viewport={'width': 1400, 'height': 700})
                r.set_content('<body style="margin:0;background:#fff"><img id="i" style="width:1200px" src="data:image/svg+xml;base64,' + base64.b64encode(o.read_bytes()).decode() + '">')
                r.wait_for_timeout(200); r.locator('#i').screenshot(path=str(png)); r.close()
                s.expect('mm"' in o.read_text()[:400], f'{type_}: SVG has a physical size')
            else:
                png = OUT / f'bc-{type_}-pdf'
                subprocess.run(['pdftoppm', '-r', '600', '-png', '-singlefile', str(o), str(png)], check=True)
                png = png.with_suffix('.png')
                w, h = s.page_sizes(o)[0]
                mods = {'ean13': 113, 'ean8': 81, 'upca': 113}.get(type_)
                s.expect((abs(w - mods * 0.33 * 72 / 25.4) < 0.1 if mods else 70 < w < 400) and h > 40, f'{type_}: PDF page in real size {w}×{h} pt')
            got = scan(png, type_)
            s.expect(got == data, f'{type_} {fmt}: decodes {got!r} (want {data!r})')
            if type_ in ('ean13', 'ean8', 'upca') and fmt != 'svg':
                cv = cv_ean(png)
                s.expect(any(c.lstrip('0') == data.lstrip('0') for c in cv), f'{type_} {fmt}: OpenCV {cv}')
            page.locator('.wt-restart button').first.click()
    # Code 39 with mod-43, ITF-14 without bearer, no text
    choose(page, 'code39'); page.fill('#seo-bc-value', 'CODE39')
    page.locator('#wt-opt-check39').check(force=True)
    page.locator('input[name="wt-opt-format"][value="png"]').check(force=True)
    page.wait_for_selector('.seo-bc .img-qr-test.is-ok')
    if s.run(page):
        s.expect(scan(s.download(page, 0), 'code39', True) == 'CODE39W', 'code39 with mod-43 check W')
        page.locator('.wt-restart button').first.click()
    choose(page, 'itf14'); page.fill('#seo-bc-value', '00012345678905')
    page.locator('#wt-opt-bearer').uncheck(force=True); page.locator('#wt-opt-showText').uncheck(force=True)
    page.wait_for_selector('.seo-bc .img-qr-test.is-ok')
    if s.run(page):
        o = s.download(page, 0)
        s.expect(scan(o, 'itf14') == '00012345678905', 'itf14 without bearer/text')
        page.locator('.wt-restart button').first.click()
    page.locator('#wt-opt-showText').check(force=True)
    # errors
    choose(page, 'ean13'); page.fill('#seo-bc-value', '4006381333932'); page.wait_for_timeout(250)
    s.expect('Richtig wäre 1' in page.locator('.seo-bc').inner_text() and s.primary(page).is_disabled(), 'wrong check digit explained, disabled')
    s.expect(page.locator('#seo-bc-value').get_attribute('aria-invalid') == 'true', 'aria-invalid')
    s.shot(page, 'seo_barcode_desktop_error', top='.seo-bc')
    choose(page, 'code128'); page.fill('#seo-bc-value', 'Grüße'); page.wait_for_timeout(250)
    s.expect('ü' in page.locator('.seo-bc').inner_text() and s.primary(page).is_disabled(), 'code128 rejects umlauts')
    # colour warning
    choose(page, 'ean8'); page.fill('#seo-bc-value', '9638507')
    page.locator('#wt-opt-dark').evaluate("e => { e.value = '#ffffff'; e.dispatchEvent(new Event('change')); }")
    page.locator('#wt-opt-light').evaluate("e => { e.value = '#000000'; e.dispatchEvent(new Event('change')); }")
    page.wait_for_timeout(300)
    s.expect('Helle Striche' in page.locator('.seo-bc').inner_text(), 'inverted colour warning')
    s.check_page(page)
