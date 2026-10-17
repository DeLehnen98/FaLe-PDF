"""QR presets: Wi-Fi QR code and EPC QR code (GiroCode) pages in DE/EN × phone/desktop – type fixed (no type
switch), printable card as A6 and 4 on A4 with the details in plain text, codes on the card decode (OpenCV),
special characters and non-Latin network names survive, IBAN check, ECC option hidden for EPC, no freeze."""
import subprocess
import cv2
import pypdf
from wtlib import Suite, OUT

P = {
    'wifi': ('/werkzeuge/wlan-qr-code/', '/en/tools/wifi-qr-code/'),
    'epc': ('/werkzeuge/girocode-erstellen/', '/en/tools/epc-qr-code-generator/'),
}


def decode_all(png):
    img = cv2.imread(str(png))
    ok, vals, _, _ = cv2.QRCodeDetector().detectAndDecodeMulti(img)
    return sorted(v for v in (vals or []) if v)


def raster(pdf, name, dpi=200):
    out = OUT / name
    subprocess.run(['pdftoppm', '-r', str(dpi), '-png', '-singlefile', str(pdf), str(out)], check=True)
    return out.with_suffix('.png')


with Suite('qr-presets') as s:
    for v in s.variants():
        for kind, paths in P.items():
            page = s.open(v, paths[0 if v.lang == 'de' else 1])
            page.wait_for_selector('.img-qr')
            s.expect(page.locator('input[name="img-qr-type"]').count() == 0, f'{v} {kind}: no type switch')
            s.expect(page.locator('.wt-alt a').count() >= 1, f'{v} {kind}: pointer to the general generator')
            fmt = page.locator('input[name="wt-opt-format"]:checked').get_attribute('value')
            s.expect(fmt == ('card' if kind == 'wifi' else 'png'), f'{v} {kind}: default format {fmt}')
            s.check_page(page)
            page.close()

    ctx = s.context('desktop', 'de')
    # ---------------------------------------------------------------- Wi-Fi card, A6
    page = s.open(ctx, P['wifi'][0])
    page.wait_for_selector('#img-qr-ssid')
    page.fill('#img-qr-ssid', 'Gäste;WLAN'); page.fill('#img-qr-password', 'Il1O0:"x,y')
    page.fill('#img-qr-cardNote', 'Willkommen in der Ferienwohnung!')
    page.wait_for_selector('.img-qr-test.is-ok')
    s.expect(page.locator('#img-qr-cardNote').is_visible(), 'card text field visible for the card format')
    if s.run(page):
        f = s.download(page, 0)
        s.expect(f.name.startswith('WLAN-Karte'), f'file name {f.name}')
        w, h = s.page_sizes(f)[0]
        s.expect(abs(w - 297.6) < 1 and abs(h - 419.5) < 1, f'A6 page {w}×{h}')
        txt = pypdf.PdfReader(str(f)).pages[0].extract_text()
        s.expect('Gäste;WLAN' in txt and 'Il1O0:"x,y' in txt and 'Ferienwohnung' in txt, f'plain text on the card ({txt[:200]!r})')
        vals = decode_all(raster(f, 'wifi_card_a6'))
        s.expect(vals == [r'WIFI:T:WPA;S:Gäste\;WLAN;P:Il1O0\:\"x\,y;;'], f'card code decodes {vals}')
        ok, msg = s.qpdf_check(f); s.expect(ok, f'qpdf {msg}')
        page.locator('.wt-restart button').first.click()
    # 4 on A4, password not printed, a Greek network name (needs the Unicode font)
    page.fill('#img-qr-ssid', 'Καφενείο')
    page.locator('#img-qr-showpass').uncheck()
    page.locator('label', has_text='4 Karten auf A4').click()
    page.wait_for_selector('.img-qr-test.is-ok')
    if s.run(page):
        f = s.download(page, 0)
        w, h = s.page_sizes(f)[0]
        s.expect(abs(w - 595.3) < 1 and abs(h - 841.9) < 1, f'A4 page {w}×{h}')
        txt = pypdf.PdfReader(str(f)).pages[0].extract_text()
        s.expect(txt.count('Καφενείο') == 4 and 'Il1O0' not in txt, f'4 cards, Greek name, no password ({txt[:160]!r})')
        vals = decode_all(raster(f, 'wifi_card_a4', dpi=150))
        s.expect(len(vals) == 4 and all('S:Καφενείο;' in x for x in vals), f'4 codes decode {vals}')
        page.locator('.wt-restart button').first.click()
    # PNG still works, card field hidden
    page.locator('input[name="wt-opt-format"][value="png"]').check()
    s.expect(page.locator('#img-qr-cardNote').is_hidden(), 'card text hidden for PNG')
    s.record_freeze(page)
    page.close()

    # ---------------------------------------------------------------- GiroCode
    page = s.open(ctx, P['epc'][0])
    page.wait_for_selector('#img-qr-payee')
    s.expect(not page.locator('#wt-opt-ecc').is_visible(), 'no error-correction choice for EPC (fixed M)')
    page.fill('#img-qr-payee', 'Förderverein Grundschule e. V.')
    page.fill('#img-qr-iban', 'DE89 3704 0044 0532 0130 00')
    page.fill('#img-qr-amount', '12,50'); page.fill('#img-qr-purpose', 'Spende Sommerfest')
    page.wait_for_selector('.img-qr-test.is-ok')
    page.fill('#img-qr-iban', 'DE89 3704 0044 0532 0130 02')
    page.wait_for_timeout(200)
    s.expect('IBAN' in page.locator('.img-qr-empty').inner_text() and s.primary(page).is_disabled(), 'invalid IBAN blocks saving')
    page.fill('#img-qr-iban', 'DE89 3704 0044 0532 0130 00')
    page.wait_for_selector('.img-qr-test.is-ok')
    page.locator('input[name="wt-opt-format"][value="card"]').check()
    if s.run(page):
        f = s.download(page, 0)
        s.expect(f.name.startswith('GiroCode'), f'file name {f.name}')
        txt = pypdf.PdfReader(str(f)).pages[0].extract_text()
        s.expect('DE89 3704 0044 0532 0130 00' in txt and '12,50 €' in txt and 'Spende Sommerfest' in txt and 'Förderverein' in txt, f'card text ({txt[:240]!r})')
        vals = decode_all(raster(f, 'epc_card'))
        want = 'BCD\n002\n1\nSCT\n\nFörderverein Grundschule e. V.\nDE89370400440532013000\nEUR12.50\n\n\nSpende Sommerfest'
        s.expect(vals == [want], f'EPC card decodes {vals}')
    s.check_page(page)
    s.record_freeze(page)
    page.close()
