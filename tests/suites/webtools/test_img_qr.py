"""qr-code (no file intake): types (URL, Wi-Fi, vCard, geo …), live preview + self-test, contrast warning,
PNG/SVG/PDF outputs decoded independently with OpenCV, DE/EN × phone/desktop."""
import subprocess
import cv2, numpy as np
from PIL import Image
from wtlib import Suite, OUT

PATHS = {'de': '/werkzeuge/qr-code-erstellen/', 'en': '/en/tools/qr-code-generator/'}

def decode(path):
    img = cv2.imread(str(path))
    if img is None: return None
    if max(img.shape[:2]) < 400: img = cv2.resize(img, None, fx=4, fy=4, interpolation=cv2.INTER_NEAREST)
    val, pts, _ = cv2.QRCodeDetector().detectAndDecode(img)
    return val

with Suite('qr-code') as s:
    for v in s.variants():
        page = s.open(v, PATHS[v.lang])
        shots = v.device == 'phone' and v.lang == 'de'
        page.wait_for_selector('.img-qr')
        s.expect(page.locator('[data-wt-pick]').is_hidden(), f'{v}: no pick zone')
        s.expect(s.primary(page).is_disabled(), f'{v}: disabled without content')
        if shots: s.shot(page, 'img_qr_phone_initial')
        page.fill('#img-qr-url', 'fale.network/werkzeuge')
        page.wait_for_selector('.img-qr-test.is-ok')
        s.expect(not s.primary(page).is_disabled(), f'{v}: enabled with content')
        if shots: s.shot(page, 'img_qr_phone_configured', top='.img-qr')
        s.check_page(page)
        if not s.run(page): continue
        if shots:
            s.shot(page, 'img_qr_phone_result', top='.wt-result')
            page.emulate_media(color_scheme='dark'); s.shot(page, 'img_qr_phone_result_dark', top='.wt-result'); page.emulate_media(color_scheme='light')
        o = s.download(page, 0)
        s.expect(decode(o) == 'https://fale.network/werkzeuge', f'{v}: PNG decodes: {decode(o)!r}')
        s.expect(Image.open(o).size == (1024, 1024), f'{v}: 1024 px PNG {Image.open(o).size}')
        txt = page.locator('.wt-result').inner_text()
        s.expect('Selbsttest bestanden' in txt or 'Self-test passed' in txt, f'{v}: self-test note')
        s.check_page(page)

    ctx = s.context('desktop', 'de')
    page = s.open(ctx, PATHS['de'])
    page.wait_for_selector('.img-qr')
    # Wi-Fi as PDF (vector) → render + decode
    page.locator('input[name="img-qr-type"][value="wifi"]').check(force=True)
    page.fill('#img-qr-ssid', 'Gäste;WLAN'); page.fill('#img-qr-password', 'ge:heim"1')
    page.locator('input[name="wt-opt-format"][value="pdf"]').check()
    page.wait_for_selector('.img-qr-test.is-ok')
    if s.run(page):
        o = s.download(page, 0)
        w, h = s.page_sizes(o)[0]
        s.expect(abs(w - 141.73) < 1, f'50 mm PDF page {w}')
        png = OUT / 'qr-pdf.png'
        subprocess.run(['pdftoppm', '-r', '300', '-png', '-singlefile', str(o), str(png)[:-4]], check=True)
        s.expect(decode(png) == r'WIFI:T:WPA;S:Gäste\;WLAN;P:ge\:heim\"1;;', f'PDF Wi-Fi decodes: {decode(png)!r}')
        page.locator('.wt-restart button').first.click()
    # vCard as SVG → rasterize with ImageMagick and decode
    page.locator('input[name="img-qr-type"][value="vcard"]').check(force=True)
    page.fill('#img-qr-first', 'Erika'); page.fill('#img-qr-last', 'Musterfrau'); page.fill('#img-qr-phone', '+49 170 1234567')
    page.locator('input[name="wt-opt-format"][value="svg"]').check()
    if s.run(page):
        o = s.download(page, 0)
        png = OUT / 'qr-svg.png'
        import base64
        raster = s.browser.new_page(viewport={'width': 600, 'height': 600})
        raster.set_content('<body style="margin:0;background:#fff"><img style="width:600px;height:600px" src="data:image/svg+xml;base64,' + base64.b64encode(o.read_bytes()).decode() + '">')
        raster.wait_for_timeout(200); raster.screenshot(path=str(png)); raster.close()
        val = decode(png)
        s.expect(val and 'FN:Erika Musterfrau' in val and 'TEL;TYPE=CELL:+49 170 1234567' in val, f'SVG vCard decodes: {val!r}')
        page.locator('.wt-restart button').first.click()
    # inverted colours → warning + failing self-test
    page.locator('input[name="wt-opt-format"][value="png"]').check()
    page.locator('#wt-opt-dark').evaluate("e => { e.value = '#ffffff'; e.dispatchEvent(new Event('change')); }")
    page.locator('#wt-opt-light').evaluate("e => { e.value = '#000080'; e.dispatchEvent(new Event('change')); }")
    page.wait_for_selector('.img-qr-test.is-bad')
    s.expect('Heller Code' in page.locator('.img-qr').inner_text(), 'inverted colour warning')
    s.shot(page, 'img_qr_desktop_warning', top='.img-qr')
    # geo validation
    page.locator('#wt-opt-dark').evaluate("e => { e.value = '#1b2a6b'; e.dispatchEvent(new Event('change')); }")
    page.locator('#wt-opt-light').evaluate("e => { e.value = '#ffffff'; e.dispatchEvent(new Event('change')); }")
    page.locator('input[name="img-qr-type"][value="geo"]').check(force=True)
    page.fill('#img-qr-lat', '123'); page.fill('#img-qr-lon', '13,4')
    page.wait_for_timeout(200)
    s.expect(s.primary(page).is_disabled(), 'invalid geo disables saving')
    page.fill('#img-qr-lat', '52,52')
    page.wait_for_selector('.img-qr-test.is-ok')
    if s.run(page):
        s.expect(decode(s.download(page, 0)) == 'geo:52.52,13.4', 'geo payload')
    s.check_page(page)
